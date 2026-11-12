/**
 * The Updates tab, exercised in a real DOM (jsdom) against a scripted panel.
 *
 * "Update panel now" is the one button whose own success takes the panel away:
 * a few seconds after the click the updater stops the process the page is
 * talking to. What the operator is told in those seconds cannot be seen in a
 * static render, so this mounts the real component — with the real toast and
 * confirm providers — and plays the panel's side of the conversation:
 *
 *   - a click starts the update, and the restart that follows is not an error
 *   - an update that stops before its first step says so, and why
 *   - before the first step the tab says "starting", never "Step 0/7"
 *   - a start request that is never answered is not announced as a failure,
 *     and the outcome is reported once the panel answers again
 *   - a second click is refused and the page shows the run that is going
 *
 *   npm test
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  launchFailureState,
  launchStartingState,
  parseUpdateState,
  updateIsRunning,
  updateProgress,
  updateSummary,
  type UpdateLaunch,
  type UpdateState,
} from "../src/lib/panel-update";

let dom: JSDOM;
const realSetTimeout = globalThis.setTimeout;

before(() => {
  dom = new JSDOM("<!doctype html><html><body></body></html>", {
    pretendToBeVisual: true,
    url: "http://panel.test/",
  });
  // Node 22 exposes some of these as getter-only globals, so define them.
  const set = (name: string, value: unknown) =>
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  set("window", dom.window);
  set("document", dom.window.document);
  set("navigator", dom.window.navigator);
  set("HTMLElement", dom.window.HTMLElement);
  set("Event", dom.window.Event);
  set("IS_REACT_ACT_ENVIRONMENT", true);

  // Toasts dismiss themselves after several seconds. Those timers must not
  // keep the test process alive once the assertions are done.
  set("setTimeout", (handler: () => void, ms?: number, ...args: unknown[]) => {
    const timer: unknown = realSetTimeout(handler, ms, ...args);
    if (typeof ms === "number" && ms >= 1_000) (timer as NodeJS.Timeout).unref();
    return timer;
  });
});

after(() => {
  Object.defineProperty(globalThis, "setTimeout", {
    value: realSetTimeout,
    configurable: true,
    writable: true,
  });
  dom.window.close();
});

// ── The panel's side ─────────────────────────────────────────────────────────

const NOW = Date.parse("2026-11-06T10:00:00Z");
const UPDATER = "/opt/gsm-panel/public/update.sh";

interface StatusOptions {
  now?: number;
  commit?: string;
  logTail?: string;
  updater?: Record<string, unknown>;
}

/** A status exactly as GET /api/system/update sends it. */
function status(state: UpdateState | null, options: StatusOptions = {}) {
  const now = options.now ?? NOW;
  return {
    ok: true,
    now,
    panel: {
      version: "1.4.0",
      commit: options.commit ?? "abc1234",
      branch: "main",
      installDir: "/opt/gsm-panel",
      installedVersion: null,
      lastUpdate: null,
      port: "3000",
    },
    updater: {
      path: UPDATER,
      wrapperPath: "/usr/local/bin/gsm-self-update",
      present: true,
      wrapperPresent: true,
      isRoot: false,
      sudoAllowed: true,
      canUpdate: true,
      reason: null,
      command: "sudo -n /usr/local/bin/gsm-self-update",
      ...options.updater,
    },
    state,
    running: updateIsRunning(state, now),
    progress: updateProgress(state),
    summary: updateSummary(state, now),
    logTail: options.logTail ?? "",
  };
}

/** A state the updater published. */
function published(overrides: Record<string, unknown>): UpdateState {
  const parsed = parseUpdateState({
    status: "running",
    phase: "step-2",
    step: 2,
    totalSteps: 7,
    message: "Stopping panel",
    startedAt: "2026-11-06T09:59:58Z",
    updatedAt: "2026-11-06T09:59:59Z",
    finishedAt: null,
    branch: "main",
    fromCommit: "abc1234",
    toCommit: null,
    exitCode: null,
    error: null,
    ...overrides,
  });
  assert.ok(parsed);
  return parsed;
}

const LAUNCH: UpdateLaunch = {
  launchedAt: "2026-11-06T09:59:59.500Z",
  pid: 4321,
  startTime: "987654",
  noBackup: false,
  logged: true,
  error: null,
};

/** The run that was on screen before anything is clicked. */
const PREVIOUS = published({
  status: "success",
  phase: "done",
  step: 7,
  message: "Update complete — the panel is healthy",
  startedAt: "2026-11-05T08:00:00Z",
  updatedAt: "2026-11-05T08:01:10Z",
  finishedAt: "2026-11-05T08:01:10Z",
  fromCommit: "9990000",
  toCommit: "abc1234",
  exitCode: 0,
});

const STOPPING = published({});

const FINISHED = published({
  status: "success",
  phase: "done",
  step: 7,
  message: "Update complete — the panel is healthy",
  updatedAt: "2026-11-06T10:01:05Z",
  finishedAt: "2026-11-06T10:01:05Z",
  toCommit: "def5678",
  exitCode: 0,
});
const AFTER = Date.parse("2026-11-06T10:01:10Z");

const FETCH_REFUSED =
  "[GSM] Checking for updates...\n[!] Fetching origin/main failed — checking the configured remote...\n[✗] Cannot fetch origin/main. Check the branch and your internet connection, then try again.\n";

/** Shown while the page waits to learn what became of an unanswered click. */
const WAITING_BANNER = "The panel did not answer the request to start the update.";

const ALREADY_RUNNING =
  "An update is already running. Watch its progress here; the panel restarts when it finishes.";

function json(code: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: code,
    headers: { "Content-Type": "application/json" },
  });
}

/** Stands in for the panel: what GET reports, and how the next POST is answered. */
class FakePanel {
  /** What GET answers with. `null`: the panel is not answering at all. */
  current: ReturnType<typeof status> | null;
  /** How POST is answered. `null`: the request is never answered. */
  onStart: (() => Response) | null = null;
  readonly requests: { method: string; body: unknown }[] = [];

  constructor(initial: ReturnType<typeof status>) {
    this.current = initial;
  }

  /** The bodies of the start requests received so far. */
  starts(): unknown[] {
    return this.requests.filter((r) => r.method === "POST").map((r) => r.body);
  }

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    assert.equal(String(input), "/api/system/update");
    const method = (init?.method ?? "GET").toUpperCase();
    this.requests.push({ method, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (method === "POST") {
      if (!this.onStart) throw new TypeError("fetch failed");
      return this.onStart();
    }
    if (!this.current) throw new TypeError("fetch failed");
    return json(200, this.current);
  };
}

// ── The operator's side ──────────────────────────────────────────────────────

async function open(panel: FakePanel) {
  const { createElement, act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { ToastProvider } = await import("../src/components/ToastProvider");
  const { ConfirmProvider } = await import("../src/components/ConfirmDialog");
  const { default: UpdatesPanel } = await import("../src/components/panels/UpdatesPanel");

  Object.defineProperty(globalThis, "fetch", { value: panel.fetch, configurable: true, writable: true });

  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);

  /** Let requests, their state updates and the renders they cause finish. */
  const settle = async () => {
    for (let i = 0; i < 3; i += 1) {
      await act(async () => {
        await new Promise((resolve) => realSetTimeout(resolve, 5));
      });
    }
  };

  const button = (label: string): HTMLButtonElement | null =>
    Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.trim() === label) ?? null;

  const click = async (label: string) => {
    const target = button(label);
    assert.ok(target, `there is a "${label}" button`);
    assert.equal(target.disabled, false, `"${label}" can be clicked`);
    await act(async () => target.click());
    await settle();
  };

  await act(async () => {
    root.render(
      createElement(ToastProvider, null, createElement(ConfirmProvider, null, createElement(UpdatesPanel)))
    );
  });
  await settle();

  return {
    host,
    button,
    click,
    /** Everything the operator can read, toasts included. */
    text: () => (host.textContent ?? "").replace(/\s+/g, " "),
    /** Click the button and confirm the dialog. */
    startUpdate: async () => {
      await click("Update panel now");
      await click("Update now");
    },
    /** What the next poll does: ask the panel for its status. */
    poll: () => click("Refresh status"),
    close: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

describe("the Updates tab", () => {
  test("a click starts the update, and the restart that follows is not an error", async () => {
    const panel = new FakePanel(status(PREVIOUS));
    const ui = await open(panel);
    try {
      assert.match(ui.text(), /The panel updated successfully/);
      assert.match(ui.text(), /9990000 → abc1234/);

      // The updater reports its first steps, the request is answered — and by
      // then the updater is already stopping the panel: nothing answers after.
      panel.onStart = () => {
        panel.current = null;
        return json(200, {
          startedAt: LAUNCH.launchedAt,
          ...status(STOPPING, { logTail: "━━━ Step 2/7: Stopping panel ━━━\n" }),
        });
      };

      await ui.click("Update panel now");
      assert.match(ui.text(), /Update the panel now\?/, "asks before doing it");
      assert.deepEqual(panel.starts(), [], "nothing is started by the first click alone");
      await ui.click("Update now");

      assert.deepEqual(panel.starts(), [{ confirm: "update", noBackup: false }]);
      assert.match(ui.text(), /Update started/);
      assert.match(ui.text(), /Updating the panel…/);
      assert.match(ui.text(), /Step 2\/7: Stopping panel/);
      assert.ok(ui.host.querySelector('[role="progressbar"]'), "progress is shown");
      assert.match(ui.text(), /━━━ Step 2\/7: Stopping panel ━━━/, "with the updater's output");
      assert.equal(ui.button("Update in progress…")?.disabled, true, "no second update can be started");
      assert.ok(!ui.text().includes("9990000 → abc1234"), "the previous run is no longer what is shown");

      // The panel is down for the build. That is the update working.
      await ui.poll();
      assert.match(ui.text(), /The panel is restarting to finish the update/);
      assert.ok(!ui.text().includes("Could not reach the panel"), "a restart is not reported as an error");
      assert.equal(ui.host.querySelector('[role="alert"]'), null);
      assert.ok(!ui.text().includes("Could not start the update"));

      // It comes back on the new version.
      panel.current = status(FINISHED, { now: AFTER, commit: "def5678" });
      await ui.poll();
      assert.match(ui.text(), /The panel updated successfully/);
      assert.match(ui.text(), /abc1234 → def5678/);
      assert.match(ui.text(), /Panel updated/);
      assert.ok(!ui.text().includes("The panel is restarting"));
      assert.ok(ui.button("Reload the panel to pick up the new version →"), "offers to load the new code");
      assert.equal(ui.button("Update panel now")?.disabled, false);
    } finally {
      await ui.close();
    }
  });

  test("an update that stops before its first step says so, and why", async () => {
    const panel = new FakePanel(status(PREVIOUS));
    const ui = await open(panel);
    try {
      const stopped = launchFailureState(LAUNCH, FETCH_REFUSED);
      panel.onStart = () => {
        panel.current = status(stopped, { logTail: FETCH_REFUSED });
        return json(500, {
          error: `The update did not start: ${stopped.error}`,
          ...status(stopped, { logTail: FETCH_REFUSED }),
        });
      };
      await ui.startUpdate();

      assert.ok(!ui.text().includes("Update started"), "nothing claims that it started");
      assert.match(ui.text(), /Could not start the update/);
      assert.match(ui.text(), /The update did not start/);
      assert.match(ui.text(), /Cannot fetch origin\/main\. Check the branch and your internet connection/);
      assert.match(ui.text(), /the panel was never stopped and is still running the version shown above/);
      assert.match(ui.text(), /sudo bash \/opt\/gsm-panel\/public\/update\.sh/);
      assert.match(ui.text(), /\[GSM\] Checking for updates\.\.\./, "the updater's output is shown");

      assert.ok(
        !ui.text().includes("The panel updated successfully"),
        "the previous run's success is not left on screen as if it were this one's"
      );
      assert.equal(ui.host.querySelector('[role="progressbar"]'), null);
      assert.equal(ui.button("Update panel now")?.disabled, false, "the button can be used again");
    } finally {
      await ui.close();
    }
  });

  test("before the updater's first step the tab says it is starting", async () => {
    const panel = new FakePanel(status(PREVIOUS));
    const ui = await open(panel);
    try {
      const starting = launchStartingState(LAUNCH);
      panel.onStart = () => {
        panel.current = status(starting, { logTail: "[GSM] Checking for updates...\n" });
        return json(200, {
          startedAt: LAUNCH.launchedAt,
          ...status(starting, { logTail: "[GSM] Checking for updates...\n" }),
        });
      };
      await ui.startUpdate();

      assert.match(ui.text(), /Starting the update…/);
      assert.match(ui.text(), /Fetching the latest code and checking the installation/);
      assert.ok(!/Step 0/.test(ui.text()), "no step is claimed before one is reported");
      assert.equal(ui.button("Update in progress…")?.disabled, true, "a second click cannot launch another");
      assert.ok(!ui.text().includes("The panel updated successfully"));

      // The same holds for a page that is opened while it is starting.
      const second = await open(panel);
      try {
        assert.match(second.text(), /Starting the update…/);
        assert.equal(second.button("Update in progress…")?.disabled, true);
      } finally {
        await second.close();
      }
    } finally {
      await ui.close();
    }
  });

  test("a start request that is never answered is not announced as a failure", async () => {
    const panel = new FakePanel(status(PREVIOUS));
    const ui = await open(panel);
    try {
      // The updater stopped the panel before the request was answered.
      panel.onStart = null;
      panel.current = null;
      await ui.startUpdate();

      assert.equal(panel.starts().length, 1);
      assert.ok(!ui.text().includes("Could not start the update"), "silence is not a refusal");
      assert.match(ui.text(), /Waiting for the panel/);
      assert.ok(ui.text().includes(WAITING_BANNER));
      assert.ok(!ui.text().includes("Could not reach the panel"));
      assert.equal(ui.host.querySelector('[role="alert"]'), null);

      // Still down: keeps waiting, says nothing new.
      await ui.poll();
      assert.ok(ui.text().includes(WAITING_BANNER));
      assert.equal(ui.host.querySelector('[role="alert"]'), null);

      // The panel answers again, mid-update.
      panel.current = status(
        published({ phase: "step-6", step: 6, message: "Building production bundle", updatedAt: "2026-11-06T10:00:40Z" }),
        { now: Date.parse("2026-11-06T10:00:45Z") }
      );
      await ui.poll();
      assert.match(ui.text(), /Update started/);
      assert.match(ui.text(), /Step 6\/7: Building production bundle/);
      assert.ok(!ui.text().includes(WAITING_BANNER), "the waiting notice is gone");
      assert.equal(ui.button("Update in progress…")?.disabled, true);
    } finally {
      await ui.close();
    }
  });

  test("when an unanswered request came to nothing, the tab says that too", async () => {
    const panel = new FakePanel(status(PREVIOUS));
    const ui = await open(panel);
    try {
      panel.onStart = null;
      panel.current = null;
      await ui.startUpdate();
      assert.match(ui.text(), /Waiting for the panel/);

      // The panel is back and still reports the run from before the click.
      panel.current = status(PREVIOUS, { now: NOW + 20_000 });
      await ui.poll();
      assert.match(ui.text(), /The update did not start/);
      assert.match(ui.text(), /reports that no update ran\. Try again\./);
      assert.ok(!ui.text().includes("Update started"));
      assert.ok(!ui.text().includes(WAITING_BANNER), "the waiting notice is gone");
      assert.equal(ui.button("Update panel now")?.disabled, false);
    } finally {
      await ui.close();
    }
  });

  test("an unanswered request that ended in a failure is reported as that failure", async () => {
    const panel = new FakePanel(status(PREVIOUS));
    const ui = await open(panel);
    try {
      panel.onStart = null;
      panel.current = null;
      await ui.startUpdate();

      panel.current = status(
        published({
          status: "failed",
          phase: "step-6",
          step: 6,
          message: "Building production bundle",
          updatedAt: "2026-11-06T10:00:50Z",
          finishedAt: "2026-11-06T10:00:50Z",
          exitCode: 1,
          error: "The updater stopped on step 6/7 (step-6), exit code 1.",
        }),
        { now: Date.parse("2026-11-06T10:00:55Z") }
      );
      await ui.poll();
      assert.match(ui.text(), /The update failed/);
      assert.match(ui.text(), /The updater stopped on step 6\/7 \(step-6\), exit code 1\./);
      assert.ok(!ui.text().includes("Update started"));
      // It did start; it failed later. Neither "could not start" nor "did not
      // start" would be true.
      assert.ok(!ui.text().includes("Could not start the update"));
      assert.ok(!ui.text().includes("The update did not start"));
      assert.ok(!ui.text().includes(WAITING_BANNER), "the waiting notice is gone");
      assert.equal(ui.button("Update panel now")?.disabled, false);
    } finally {
      await ui.close();
    }
  });

  test("a second click while an update is running is refused, and the run is shown", async () => {
    const panel = new FakePanel(status(PREVIOUS));
    const ui = await open(panel);
    try {
      // Somebody else started one a moment ago; this page has not polled yet.
      panel.onStart = () => {
        panel.current = status(STOPPING);
        return json(409, { error: ALREADY_RUNNING, state: STOPPING });
      };
      await ui.startUpdate();

      assert.match(ui.text(), /Could not start the update/);
      assert.match(ui.text(), /An update is already running/);
      assert.match(ui.text(), /Step 2\/7: Stopping panel/, "the page catches up with the run that is going");
      assert.equal(ui.button("Update in progress…")?.disabled, true);
    } finally {
      await ui.close();
    }
  });

  test("the backup can be skipped, and cancelling starts nothing", async () => {
    const panel = new FakePanel(status(PREVIOUS));
    const ui = await open(panel);
    try {
      panel.onStart = () => {
        panel.current = status(STOPPING);
        return json(200, { startedAt: LAUNCH.launchedAt, ...status(STOPPING) });
      };

      await ui.click("Update panel now");
      assert.match(ui.text(), /A backup is taken first/);
      await ui.click("Cancel");
      assert.deepEqual(panel.starts(), []);
      assert.ok(!ui.text().includes("Update the panel now?"));

      const skip = ui.host.querySelector<HTMLInputElement>('input[type="checkbox"]');
      assert.ok(skip);
      const { act } = await import("react");
      await act(async () => skip.click());

      await ui.click("Update panel now");
      assert.match(ui.text(), /The pre-update backup is DISABLED for this run/);
      await ui.click("Update now");
      assert.deepEqual(panel.starts(), [{ confirm: "update", noBackup: true }]);
    } finally {
      await ui.close();
    }
  });

  test("the reload hint appears when the panel's code changed under an open page", async () => {
    const panel = new FakePanel(status(PREVIOUS));
    const ui = await open(panel);
    try {
      await ui.poll();
      assert.equal(ui.button("Reload the panel to pick up the new version →"), null);

      // Updated from a shell while this page stayed open.
      panel.current = status(FINISHED, { now: AFTER, commit: "def5678" });
      await ui.poll();
      assert.ok(ui.button("Reload the panel to pick up the new version →"));
    } finally {
      await ui.close();
    }
  });

  test("an install that cannot update itself says why, and what to run instead", async () => {
    const reason =
      "The panel runs without root and its sudo rule for the update helper is missing. Re-run the updater from a shell to restore it.";
    const panel = new FakePanel(
      status(null, { updater: { sudoAllowed: false, canUpdate: false, reason, command: null } })
    );
    const ui = await open(panel);
    try {
      assert.equal(ui.button("Update panel now")?.disabled, true);
      assert.match(ui.text(), /This install cannot update itself from the panel\./);
      assert.ok(ui.text().includes(reason));
      assert.match(ui.text(), /sudo bash \/opt\/gsm-panel\/public\/update\.sh --force/);
      assert.match(ui.text(), /No update has been run from the panel yet/);
    } finally {
      await ui.close();
    }
  });
});
