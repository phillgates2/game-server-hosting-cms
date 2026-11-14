import { test, describe, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  discordBotInviteUrl,
  discordChannelPreview,
  discordFormChanges,
  discordFormFromConfig,
  discordFormPayload,
  validateDiscordForm,
  type DiscordConfigResponse,
} from "../src/lib/discord-form";

const config: DiscordConfigResponse = {
  panelWebhook: "https://discord.com/api/webhooks/123456/abc-DEF",
  panelWebhookValid: true,
  hasBotToken: true,
  guildId: "123456789012345678",
  categoryId: "",
  autoChannel: true,
  channelPrefix: "gs-",
  extraServers: "",
  masterUrls: "master0.etmaster.net",
  botReady: true,
  oauthClientId: "234567890123456789",
  oauthConfigured: true,
  bot: { state: "online", tag: "GameServer Manager", error: null, since: 1, commandsHandled: 0, lastCommandAt: null },
};

describe("Discord form helpers", () => {
  test("saved secrets are never copied into the draft", () => {
    const form = discordFormFromConfig(config);
    assert.equal(form.botToken, "");
    assert.equal(form.oauthClientSecret, "");
    assert.deepEqual(discordFormChanges(form, form), []);
  });

  test("only changed fields are sent, including a deliberate false or empty webhook", () => {
    const saved = discordFormFromConfig(config);
    const draft = { ...saved, autoChannel: false, panelWebhook: "", guildId: `  ${saved.guildId}  ` };
    const changes = discordFormChanges(draft, saved);
    assert.deepEqual(changes.map((c) => c.key), ["panelWebhook", "autoChannel"]);
    assert.deepEqual(discordFormPayload(draft, changes), { panelWebhook: "", autoChannel: false });
  });

  test("a new secret is trimmed and sent only when entered", () => {
    const saved = discordFormFromConfig(config);
    const draft = { ...saved, botToken: "  new-token  ", guildId: "987654321098765432" };
    const payload = discordFormPayload(draft, discordFormChanges(draft, saved));
    assert.deepEqual(payload, { botToken: "new-token", guildId: "987654321098765432" });
    assert.equal("oauthClientSecret" in payload, false);
  });

  test("validation matches the API's ID rules and the integration's webhook validator", () => {
    const form = discordFormFromConfig(config);
    assert.deepEqual(validateDiscordForm(form), {});
    const errors = validateDiscordForm({ ...form, panelWebhook: "https://evil.example/hook", guildId: "#general", categoryId: "123", oauthClientId: "not-an-id" });
    assert.deepEqual(Object.keys(errors).sort(), ["categoryId", "guildId", "oauthClientId", "panelWebhook"]);
    assert.equal(validateDiscordForm({ ...form, panelWebhook: "https://discordapp.com/api/webhooks/1/a" }).panelWebhook, undefined);
  });

  test("invite links request the implemented permissions, never Administrator", () => {
    const basic = new URL(discordBotInviteUrl("123456789012345678")!);
    assert.equal(basic.origin, "https://discord.com");
    assert.equal(basic.searchParams.get("scope"), "bot");
    assert.equal(basic.searchParams.get("permissions"), "536955920");
    const et = new URL(discordBotInviteUrl("123456789012345678", true)!);
    assert.equal(et.searchParams.get("permissions"), "939617296");
    assert.equal(discordBotInviteUrl("a-bot-token"), null);
    assert.equal(discordBotInviteUrl(""), null);
  });

  test("channel preview uses the production normaliser and length limit", () => {
    assert.equal(discordChannelPreview("gs-"), "#gs-my-game-server");
    assert.equal(discordChannelPreview("", "  !!!  "), "#game-server");
    assert.ok(discordChannelPreview("x".repeat(120)).length <= 101);
  });
});

let dom: JSDOM;
const roots: Array<{ unmount: () => void; host: HTMLElement }> = [];
const originalFetch = globalThis.fetch;

before(() => {
  dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://panel.example", pretendToBeVisual: true });
  const set = (name: string, value: unknown) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  set("window", dom.window);
  set("document", dom.window.document);
  set("navigator", dom.window.navigator);
  set("HTMLElement", dom.window.HTMLElement);
  set("HTMLInputElement", dom.window.HTMLInputElement);
  set("KeyboardEvent", dom.window.KeyboardEvent);
  set("Event", dom.window.Event);
  set("IS_REACT_ACT_ENVIRONMENT", true);
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
});

afterEach(async () => {
  const { act } = await import("react");
  for (const root of roots.splice(0)) {
    await act(async () => root.unmount());
    root.host.remove();
  }
  globalThis.fetch = originalFetch;
});

after(() => dom.window.close());

async function flush(ms = 30) {
  const { act } = await import("react");
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
}

async function click(element: Element | null | undefined) {
  assert.ok(element, "control exists");
  const { act } = await import("react");
  await act(async () => { (element as HTMLElement).click(); });
}

async function type(id: string, value: string) {
  const input = document.getElementById(id) as HTMLInputElement | null;
  assert.ok(input, `${id} exists`);
  const { act } = await import("react");
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}

async function mount(options: { failFirstLoad?: boolean } = {}) {
  const { createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { ConfirmProvider } = await import("../src/components/ConfirmDialog");
  const DiscordSettings = (await import("../src/components/panels/DiscordSettings")).default;
  const current = { ...config };
  const posts: Array<{ url: string; body: Record<string, unknown> }> = [];
  let loads = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || "GET";
    if (method === "POST") {
      const body = JSON.parse(String(init?.body || "{}"));
      posts.push({ url, body });
      if (url.endsWith("/discord") && !body.action) {
        Object.assign(current, body);
        if (body.botToken) current.hasBotToken = true;
        if (body.oauthClientSecret) current.oauthConfigured = Boolean(current.oauthClientId);
        current.botReady = Boolean(current.hasBotToken && current.guildId);
      }
      return new Response(JSON.stringify({ ok: true, updated: 1, guildName: "Test Community", intervalMinutes: body.minutes }), { status: 200 });
    }
    if (url.endsWith("/boards")) return new Response(JSON.stringify({ intervalMinutes: 3, botReady: true, servers: [] }), { status: 200 });
    loads++;
    if (options.failFirstLoad && loads === 1) return new Response(JSON.stringify({ error: "Permission denied" }), { status: 403 });
    return new Response(JSON.stringify(current), { status: 200 });
  }) as typeof fetch;

  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push({ host, unmount: () => root.unmount() });
  const { act } = await import("react");
  await act(async () => {
    root.render(createElement(ConfirmProvider, null, createElement(DiscordSettings, null, createElement("div", { id: "discord-existing-servers", tabIndex: -1 }, "Existing servers"))));
  });
  await flush();
  return { posts, current, loads: () => loads };
}

describe("Discord settings screen", () => {
  test("opens on the guide and supports keyboard tab navigation", async () => {
    await mount();
    assert.equal(document.getElementById("discord-tab-guide")?.getAttribute("aria-selected"), "true");
    assert.match(document.body.textContent || "", /Webhook quick start/);
    const { act } = await import("react");
    await act(async () => {
      document.getElementById("discord-tab-guide")!.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    assert.equal(document.getElementById("discord-tab-notifications")?.getAttribute("aria-selected"), "true");
    assert.equal(document.activeElement?.id, "discord-tab-notifications");
    assert.ok(document.getElementById("discord-panel-webhook"));
  });

  test("drafts survive tab changes and save only changed fields without echoing secrets", async () => {
    const { posts } = await mount();
    await click(document.getElementById("discord-tab-notifications"));
    await type("discord-panel-webhook", "https://discord.com/api/webhooks/999/new-token");
    await click(document.getElementById("discord-tab-bot"));
    assert.ok(document.getElementById("discord-bot-token"));
    assert.equal((document.getElementById("discord-bot-token") as HTMLInputElement).value, "");
    await type("discord-guild-id", "987654321098765432");
    await click(document.getElementById("discord-tab-notifications"));
    assert.equal((document.getElementById("discord-panel-webhook") as HTMLInputElement).value, "https://discord.com/api/webhooks/999/new-token");
    await click(document.querySelector('button[type="submit"][form="discord-settings-form"]'));
    await flush();
    assert.equal(posts.length, 1);
    assert.deepEqual(posts[0].body, { panelWebhook: "https://discord.com/api/webhooks/999/new-token", guildId: "987654321098765432" });
    assert.match(document.body.textContent || "", /Discord settings saved/);
  });

  test("invalid saves jump to the offending field and never reach the API", async () => {
    const { posts } = await mount();
    await click(document.getElementById("discord-tab-notifications"));
    await type("discord-panel-webhook", "not-a-webhook");
    await click(document.getElementById("discord-tab-guide"));
    await click(document.querySelector('button[type="submit"][form="discord-settings-form"]'));
    await flush(120);
    assert.equal(posts.length, 0);
    assert.equal(document.getElementById("discord-tab-notifications")?.getAttribute("aria-selected"), "true");
    assert.equal(document.activeElement?.id, "discord-panel-webhook");
    assert.equal(document.getElementById("discord-panel-webhook")?.getAttribute("aria-invalid"), "true");
  });

  test("a failed load is visible and Retry can recover", async () => {
    await mount({ failFirstLoad: true });
    assert.match(document.body.textContent || "", /Discord settings unavailable/);
    await click([...document.querySelectorAll("button")].find((button) => button.textContent === "Try again"));
    await flush();
    assert.ok(document.getElementById("discord-tab-guide"));
  });

  test("board interval is an immediate action, separate from credential saving", async () => {
    const { posts } = await mount();
    await click(document.getElementById("discord-tab-boards"));
    await flush();
    const select = document.getElementById("discord-board-interval") as HTMLSelectElement;
    const { act } = await import("react");
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(select, "5");
      select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
    await click([...document.querySelectorAll("button")].find((button) => button.textContent === "Apply interval"));
    await flush();
    assert.equal(posts.length, 1);
    assert.equal(posts[0].url, "/api/settings/discord/boards");
    assert.deepEqual(posts[0].body, { action: "interval", minutes: 5 });
    assert.match(document.body.textContent || "", /Refresh interval saved/);
  });
});
