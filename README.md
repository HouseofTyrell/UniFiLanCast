# UniFiLanCast — Network Weather Map

A real-time, ambient visualization dashboard for your UniFi network. It renders your network as a living **constellation** — gateway on top, switches and access points below, and each device's clients clustered beneath it — animated as a "weather map" where traffic is wind, device load is heat, outages are fog, and latency spikes are lightning.

![status](https://img.shields.io/badge/status-active-green) ![TypeScript](https://img.shields.io/badge/TypeScript-100%25-blue)

> Connects to real UniFi hardware via the **local Network Integration API** (read-only API key). No cloud dependency required.

---

## Highlights

- **Live + historical bandwidth** — per-device download/upload, WAN throughput, and a **data-usage window** (5m / 15m / 30m / 1h / 2h / 8h). The selected window drives the panels *and* the node sizing, so the heaviest users over the window stand out even when momentarily idle.
- **Tiered + clustered layout** — gateway → switches/APs → each hub's own clients in an organic cluster beneath it; busy devices grow, brighten, and label themselves; idle ones recede.
- **Per-client detail** — click any node for live rate, windowed usage, session totals, signal, channel, VLAN, vendor (OUI), OS, IP/MAC, connected-since, and experience score.
- **VLAN coloring** — toggle to color clients by segment, with a per-VLAN throughput/segments panel.
- **Weather effects** — directional download/upload flow strands, device-load heat glow, offline fog, latency lightning bolts.
- **Dashboard** — live HUD, WAN trend chart, top talkers, segments, and a live events feed framing the constellation.
- **Persistence** — SQLite store keeps history, a device inventory with first-seen, and an event log across restarts.
- **Alerting** — webhook notifications (Discord / Slack / generic) with severity gating + throttling.
- **Auth** — optional HTTP Basic auth over the whole app.
- **Mock mode** — runs with simulated devices, no hardware required.

See [ARCHITECTURE.md](ARCHITECTURE.md) for how it's built and [NEXT_STEPS.md](NEXT_STEPS.md) for the roadmap.

---

## Quick start (development)

**Prerequisites:** Node.js 18+ (20.x recommended), npm.

```bash
git clone https://github.com/HouseofTyrell/UniFiLanCast.git
cd UniFiLanCast
npm install
cp config.example.json config.json
npm run dev
```

- Backend API → `http://localhost:3001`
- Frontend → `http://localhost:5173`

Out of the box it runs in **mock mode** (simulated devices). To connect real hardware, see [Connecting to real hardware](#connecting-to-real-hardware).

### Production (Docker)

```bash
cp config.example.json config.json   # edit for your network
docker-compose up -d                  # dashboard on http://localhost:8080
```

> The server binds **`127.0.0.1` by default** and refuses to start LAN-exposed without auth (fail-closed). To reach it from other hosts (including across a Docker bridge), set `server.host: "0.0.0.0"` in `config.json` **and** enable `auth`.

---

## Connecting to real hardware

UniFiLanCast talks to your controller through the **local UniFi Network Integration API** using an API key.

1. Open the **UniFi Network application** (e.g. `https://10.0.0.1`) → **Settings → Control Plane → Integrations** → **Create API Key**. Copy it.
   - ⚠️ This is a *local Network* key, distinct from a `unifi.ui.com` cloud/account key. A cloud key returns `401` against the local `/proxy/network/integration/v1` API. See [unifi-integration-api-vs-cloud-key](#) notes in `ARCHITECTURE.md`.
2. Provide the key via the env var named in config (default `UNIFI_API_KEY`). The server auto-loads a gitignored `.env`:
   ```bash
   echo "UNIFI_API_KEY=your-key-here" > .env
   ```
3. Enable the adapter in `config.json`:
   ```json
   "integrationApi": { "enabled": true, "baseUrl": "https://10.0.0.1", "apiKeyEnv": "UNIFI_API_KEY", "verifySsl": false }
   ```
4. Restart (`npm run dev`). The same key also authenticates the legacy `stat/sta` endpoint, which the adapter uses to enrich **per-client** traffic, signal, VLAN, vendor, and totals.

The machine running the server must be able to reach the controller on the LAN.

---

## Configuration

Edit `config.json` (copied from `config.example.json`). Secrets should come from environment variables, not the file.

| Section | Key | Notes |
|---|---|---|
| `adapters.integrationApi` | `enabled`, `baseUrl`, `apiKey` / `apiKeyEnv`, `siteId?`, `pollingInterval?`, `verifySsl?` | **Recommended.** Local Integration API + per-client enrichment. |
| `adapters.mock` | `enabled`, `deviceCount` | Simulated devices, no hardware. |
| `adapters.siteManager` | `enabled`, `apiKey`, `pollingInterval` | UniFi cloud Site Manager API (inventory only — no per-client traffic). |
| `adapters.localNetwork` | `enabled`, `baseUrl`, `username`, `password`, … | Legacy username/password local API. |
| `server` | `port`, `historyRetentionMinutes` (default 1440), `logLevel`, `dataDir?` | SQLite store lives in `dataDir` (default `<repo>/data`). |
| `auth` | `enabled`, `username`, `password` / `passwordEnv` | Optional HTTP Basic auth over API + UI. Disabled by default. |
| `alerts` | `enabled`, `webhookUrl` / `webhookEnv`, `format` (`auto`/`discord`/`slack`/`json`), `throttleSeconds`, `minSeverity`, `rules` | Webhook alerts. Disabled by default. |

### Environment variables

| Var | Purpose |
|---|---|
| `UNIFI_API_KEY` | Integration API key (default name; override with `apiKeyEnv`). |
| `UNIFI_ALERT_WEBHOOK` | Alert webhook URL (default name; override with `webhookEnv`). |
| `UNIFI_AUTH_PASSWORD` | Basic-auth password (default name; override with `passwordEnv`). |
| `CONFIG_PATH` | Explicit path to `config.json` (otherwise auto-discovered up the tree). |
| `DATA_DIR` | Override the SQLite data directory. |
| `LOG_LEVEL`, `NODE_ENV` | Logging / production static-file serving. |

`.env` (gitignored) is auto-loaded at startup, and `config.json` is found whether the server runs from the repo root or `server/`.

---

## API reference

| Endpoint | Description |
|---|---|
| `GET /api/snapshot` | Current network state (devices, links, events, weather). |
| `GET /api/stream` | Server-Sent Events stream of snapshots (~5s). |
| `GET /api/history?minutes=N` | Persisted history samples. |
| `GET /api/usage?minutes=N[&deviceId=ID]` | Total data down/up over the window (WAN, or a specific device) + a downsampled series. |
| `GET /api/usage/devices?minutes=N` | Per-device data usage over the window (drives node sizing). |
| `GET /api/status` | Adapter connection status. |
| `GET /api/config` · `POST /api/config` | Read / write the configuration file. |

All rates are normalized to **bits/sec** internally; volumes are reported in **bytes**. (Note: the Integration API reports device rates in bits/sec, but the legacy `stat/sta` client fields are bytes/sec — the adapter reconciles these. For clients, the controller's `tx_bytes` is *download*, the reverse of the gateway convention; the adapter swaps it so "↓ = download" everywhere.)

---

## Project layout

```
server/   Node + Fastify + TypeScript
  src/
    adapters/        MockAdapter, IntegrationApiAdapter, SiteManagerAdapter, LocalNetworkAdapter
    DataManager.ts   capture loop, snapshots, usage integration
    Store.ts         SQLite persistence (history, devices, events)
    AlertManager.ts  webhook alerting
    routes/api.ts    REST + SSE
    utils/weatherEngine.ts
web/      React + Vite + HTML5 canvas
  src/
    utils/visualization.ts   the constellation renderer (layout, nodes, links, weather)
    components/              Header, NetworkCanvas, DeviceDetail, WanChart, Segments, TopTalkers, Events, Legend, Controls, TimePlayback
    hooks/                  useNetworkData (SSE), useRollingData, useDeviceUsages
```

---

## Development

```bash
npm run build          # build server + web
npm run typecheck      # tsc --noEmit, both workspaces
npm run ci             # local CI gate: typecheck + build (+ tests when present)
```

### Local CI

`npm install` wires a **git `pre-push` hook** (via `core.hooksPath=.githooks`) that runs `npm run ci` before every push, so broken builds never reach the remote. If you cloned and the hook isn't active, run:

```bash
git config core.hooksPath .githooks
```

Bypass in an emergency with `git push --no-verify`. CI is **local-only** for now (no GitHub Actions).

> ⚠️ There is no automated test suite yet — `npm run ci` already runs `npm test` (a no-op until test scripts exist), so adding Vitest later needs no CI changes. See [NEXT_STEPS.md](NEXT_STEPS.md). Keep server and web type definitions in sync.

---

## Security notes

- The server **binds `127.0.0.1` by default** and **refuses to start LAN-exposed (`server.host`) with `auth.enabled: false`** — a fail-closed default. To expose it, set `server.host: "0.0.0.0"` and enable auth (ideally behind a reverse proxy with HTTPS).
- `GET /api/config` **redacts secrets**; `POST /api/config` validates input and writes atomically. Still, gate the app behind auth before exposing it.
- `verifySsl` **defaults to `true`** — set it to `false` explicitly (or pin a CA) for a controller's self-signed cert.
- Never commit `config.json` or `.env` (both gitignored). Use a read-only API key, sourced from an env var.

## License

MIT — see [LICENSE](LICENSE). UniFi is a trademark of Ubiquiti Inc.
