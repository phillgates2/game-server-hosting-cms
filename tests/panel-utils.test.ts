import test from "node:test";
import assert from "node:assert/strict";
import { groupServersByNode, sortServersForPanel, summarizeServerStatus } from "../src/components/panels/serverPanelUtils.ts";

test("sortServersForPanel prioritizes running and installing servers", () => {
  const servers = [
    { id: 1, status: "stopped" },
    { id: 2, status: "running" },
    { id: 3, status: "installing" },
    { id: 4, status: "install_failed" },
  ] as Array<{ id: number; status: string; name?: string }>;

  const ordered = sortServersForPanel(servers as any);

  assert.deepEqual(ordered.map((server) => server.id), [2, 3, 4, 1]);
});

test("summarizeServerStatus returns counts for each meaningful state", () => {
  const servers = [
    { id: 1, status: "running" },
    { id: 2, status: "stopped" },
    { id: 3, status: "installing" },
    { id: 4, status: "install_failed" },
    { id: 5, status: "running" },
  ];

  const summary = summarizeServerStatus(servers as any);

  assert.deepEqual(summary, { running: 2, stopped: 1, installing: 1, install_failed: 1 });
});

test("groupServersByNode groups servers by node name and keeps sorted servers", () => {
  const servers = [
    { id: 1, status: "stopped", name: "Zulu", nodeName: "Bravo", nodeId: 2 },
    { id: 2, status: "running", name: "Alpha", nodeName: "Alpha", nodeId: 1 },
    { id: 3, status: "installing", name: "Beta", nodeName: null, nodeId: null },
    { id: 4, status: "running", name: "Charlie", nodeName: "Alpha", nodeId: 1 },
  ];

  const grouped = groupServersByNode(servers as any);

  assert.deepEqual(grouped.map((group) => group.nodeName), ["Alpha", "Bravo", "Unassigned"]);
  assert.deepEqual(grouped[0].servers.map((server) => server.id), [2, 4]);
});
