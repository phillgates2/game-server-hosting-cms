/**
 * Tests for the one-click agent deployment.
 *
 * The deploy executes shell on a remote machine, so the command building is
 * pure and pinned here — quoting against injection, the key-charset guard
 * (heredoc breakout), and the key-vs-password transport choice.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  shellQuote,
  sshPrefix,
  scpPrefix,
  buildDeployScript,
  deployPreflight,
} from "../src/lib/node-deploy";

describe("shellQuote", () => {
  test("passes simple values through", () => {
    assert.equal(shellQuote("abc123"), "'abc123'");
  });

  test("neutralises single quotes and command injection", () => {
    const q = shellQuote("it's a trap; rm -rf /");
    assert.ok(!q.includes("'; "), "no breakout sequence");
    // The quoted form must be one safe shell word.
    assert.match(q, /^'([^']|'\\'')*'$/);
  });

  test("handles backticks and dollar signs", () => {
    const q = shellQuote("`whoami` $(id)");
    assert.equal(q, "'`whoami` $(id)'");
  });
});

describe("sshPrefix / scpPrefix", () => {
  test("key auth uses BatchMode=yes and -i", () => {
    const p = sshPrefix(22, { keyPath: "/root/.ssh/id_rsa" });
    assert.equal(p.cmd, "ssh");
    assert.ok(p.args.includes("-i"));
    assert.ok(p.args.includes("/root/.ssh/id_rsa"));
    assert.ok(p.args.includes("BatchMode=yes"));
    assert.deepEqual(p.env, {});
  });

  test("password auth goes through sshpass -e with SSHPASS in env, never argv", () => {
    const p = sshPrefix(2222, { password: "hunter2" });
    assert.equal(p.cmd, "sshpass");
    assert.ok(p.args.includes("-e"));
    assert.ok(!p.args.includes("hunter2"), "password must not be in argv");
    assert.equal(p.env.SSHPASS, "hunter2");
    assert.ok(p.args.includes("2222"));
  });

  test("scp mirrors the ssh transport choice", () => {
    const key = scpPrefix(22, { keyPath: "/k" });
    assert.equal(key.cmd, "scp");
    assert.ok(key.args.includes("-P"));
    const pass = scpPrefix(22, { password: "p" });
    assert.equal(pass.cmd, "sshpass");
    assert.ok(pass.args.includes("scp"));
  });

  test("no credentials throws", () => {
    assert.throws(() => sshPrefix(22, {}), /neither an SSH key path nor a password/);
    assert.throws(() => scpPrefix(22, {}), /neither an SSH key path nor a password/);
  });
});

describe("buildDeployScript", () => {
  const params = {
    sshUser: "deploy",
    hostname: "box1",
    sshPort: 22,
    agentKey: "abcd1234efgh5678",
    agentPort: 8787,
    serversRoot: "/opt/gameservers",
    panelUrl: "https://panel.example.com",
    nodeId: 7,
  };

  test("writes env, unit, permissions and starts the service", () => {
    const s = buildDeployScript(params);
    assert.match(s, /GSM_AGENT_KEY=abcd1234efgh5678/);
    assert.match(s, /GSM_SERVERS_ROOT=\/opt\/gameservers/);
    assert.match(s, /GSM_NODE_ID=7/);
    assert.match(s, /chmod 600 "\$HOME\/gsm-agent\/gsm-agent.env"/);
    assert.match(s, /systemctl --user daemon-reload/);
    assert.match(s, /systemctl --user restart gsm-agent/);
    assert.match(s, /WantedBy=default.target/);
  });

  test("refuses keys that could break the quoted heredoc", () => {
    assert.throws(() => buildDeployScript({ ...params, agentKey: "GSMENV\nevil=1" }), /8-128/);
    assert.throws(() => buildDeployScript({ ...params, agentKey: "has space" }), /8-128/);
    assert.throws(() => buildDeployScript({ ...params, agentKey: "short" }), /8-128/);
    assert.throws(() => buildDeployScript({ ...params, agentKey: "$(rm -rf /)" }), /8-128/);
  });

  test("accepts generated-style keys", () => {
    const s = buildDeployScript({ ...params, agentKey: "a1b2c3d4e5f6a1b2c3d4e5f6" });
    assert.match(s, /GSM_AGENT_KEY=a1b2c3d4e5f6a1b2c3d4e5f6/);
  });
});

describe("deployPreflight", () => {
  test("requires hostname, user, and some credential", () => {
    assert.equal(deployPreflight({ hostname: null, sshUser: "u", sshKeyPath: "/k", sshPassword: null }).ok, false);
    assert.equal(deployPreflight({ hostname: "h", sshUser: null, sshKeyPath: "/k", sshPassword: null }).ok, false);
    assert.equal(deployPreflight({ hostname: "h", sshUser: "u", sshKeyPath: null, sshPassword: null }).ok, false);
    assert.equal(deployPreflight({ hostname: "h", sshUser: "u", sshKeyPath: "/k", sshPassword: null }).ok, true);
    assert.equal(deployPreflight({ hostname: "h", sshUser: "u", sshKeyPath: null, sshPassword: "p" }).ok, true);
  });
});
