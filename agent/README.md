# GSM Node Agent

A zero-dependency process (Node 18+ only) that runs on a **remote** game-server
machine so the panel can control servers there — start/stop/restart/status,
log tail, disk usage — and receives its heartbeats.

The panel talks to it through the node's stored **API URL** + **API key**
(Nodes panel). Nothing here needs the panel's database.

## Quick start

```bash
# on the remote machine
export GSM_AGENT_PORT=8787
export GSM_AGENT_KEY="$(openssl rand -hex 24)"   # paste this into the node's API key
export GSM_SERVERS_ROOT=/opt/gameservers         # all install paths must live inside
node gsm-agent.mjs
```

Then in the panel, set the node's **API URL** to `http://<that-machine>:8787`
and the **API key** to the same secret, and hit **Test Connection**.

### Heartbeats (optional but recommended)

Point the agent back at the panel so the node shows live metrics and online
status:

```bash
export GSM_PANEL_URL="https://panel.example.com"
export GSM_NODE_ID=4                # the node's id in the panel
export GSM_HEARTBEAT_SECONDS=15
```

## systemd unit

```ini
[Unit]
Description=GSM Node Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=GSM_AGENT_PORT=8787
Environment=GSM_AGENT_KEY=__paste_the_key_here__
Environment=GSM_SERVERS_ROOT=/opt/gameservers
Environment=GSM_PANEL_URL=https://panel.example.com
Environment=GSM_NODE_ID=4
ExecStart=/usr/bin/node /opt/gsm-agent/gsm-agent.mjs
Restart=always
RestartSec=5
# Hardening
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/opt/gameservers

[Install]
WantedBy=multi-user.target
```

## Security model

- Every request must present the API key in `x-api-key`; it is compared
  constant-time and checked **before** any routing.
- Every `installPath` is re-rooted against `GSM_SERVERS_ROOT` — `..`
  traversal, absolute paths elsewhere and escapes all resolve to `null`
  and are refused, so a forged request cannot touch anything outside the
  game-server tree.
- Request bodies are capped at 1 MB. Unknown routes answer 404.
- The agent binds all interfaces so the panel can reach it; firewall the
  port down to the panel's address (`ufw allow from <panel-ip> to any port 8787`).

## What the panel uses it for

| Panel feature | Agent endpoint |
|---|---|
| Start / Stop / Restart / status poll | `POST /rpc/process` |
| Console log tail | `POST /rpc/log` |
| Test Connection button | `POST /rpc/ping` |
| Node metrics / online status | agent → panel `heartbeat` |

Scheduled **restarts** run through the agent too. Scheduled *backup / update /
command* still need the agent's file APIs and are reported as failures for
remote servers until that lands.
