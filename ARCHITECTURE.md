# Architecture

UniFiLanCast is a two-part TypeScript app: a **Node/Fastify backend** that polls a UniFi controller and serves a normalized network model, and a **React/Vite frontend** that renders it as a live canvas constellation. This document is the source of truth for how the pieces fit — read it before adding features so you don't rebuild something that exists.

## Data flow (end to end)

```
UniFi controller
   │  (X-API-KEY, read-only)
   ▼
Adapter (IntegrationApiAdapter)         server/src/adapters/
   │  normalize → Device / Link / NetworkEvent
   ▼
DataManager  ── capture loop (~5s) ──►  WeatherEngine (computes weather signals)
   │                                    Store (SQLite: snapshots, devices, events)
   │                                    AlertManager (webhook on qualifying events)
   ▼
Fastify routes  (REST + SSE)            server/src/routes/api.ts
   │  /api/snapshot, /api/stream, /api/history, /api/usage, /api/usage/devices, ...
   ▼
Frontend hooks   useNetworkData (SSE), useRollingData, useDeviceUsages
   │
   ▼
ReactorEngine (canvas, default)         web/src/utils/reactor/engine.ts
NetworkVisualization (canvas)           web/src/utils/visualization.ts
   + view chrome / dashboard panels     web/src/components/
```

## Backend (`server/`)

- **Adapters** (`adapters/`) implement `NetworkAdapter` (`initialize / fetchData / getStatus / destroy`) and normalize a source into `{ devices, links, events }`.
  - `IntegrationApiAdapter` — the primary one. Uses the local Integration API (`/proxy/network/integration/v1`, `X-API-KEY`) for devices, topology (`uplink.deviceId`), and per-device `statistics/latest` (rates, CPU/load). It **also** hits the legacy `stat/sta` endpoint (same key) to enrich **per-client** traffic, signal, VLAN, vendor, OS, and session totals. It throttles controller calls to its polling interval and caches between fetches.
  - `MockAdapter`, `SiteManagerAdapter` (cloud, inventory-only), `LocalNetworkAdapter` (legacy user/pass) also exist.
- **DataManager** — runs a single **capture loop** (default 5s) so history accrues even with no client connected. Each tick: collect adapter data → compute weather → persist (throttled snapshot write, device upsert, events) → emit `update`. Also exposes `getHistory`, `getWanUsage(minutes, deviceId?)`, and `getDeviceUsages(minutes)` (rate→bytes integration over persisted history).
- **WeatherEngine** — turns the device/link model into weather signals (storm/heat/fog/lightning) using adaptive, relative scaling.
- **Store** — `better-sqlite3`, WAL mode. Tables: `snapshots` (JSON blob per timestamp), `devices` (inventory with `first_seen`/`last_seen`/`known`), `events`. Prunes by retention.
- **AlertManager** — consumes per-tick events, gates by rule + severity, throttles/dedupes, and POSTs to a Discord/Slack/generic webhook.
- **index.ts** — config loading (`.env` + `config.json` discovered up the tree), adapter wiring, optional Basic-auth `onRequest` hook, static serving in production.

## Frontend (`web/`)

- **Hooks** — `useNetworkData` (SSE + status/history fetches), `useRollingData` (live WAN buffer + events feed), `useDeviceUsages` (per-device usage map for the selected window).
- **NetworkVisualization** (`utils/visualization.ts`) — the canvas renderer (eased + drifting node motion, node/link/weather rendering, focus pass, color modes, DPI viewport). The **pure, canvas-independent logic is extracted into `utils/viz/`** so it's unit-tested without a canvas:
  - `viz/layout.ts` — `computeRadialLayout()`: the tiered hub-and-cluster target positions.
  - `viz/scale.ts` — `rateLevel` / `usageScale` / `tierMaxUsage` / `nodeRadius`: activity + usage-driven sizing.
  - `viz/hitTest.ts` — `pickNodeAt()`: nearest-node hit-testing.
  The class applies these results to live nodes and owns only the rendering/animation state.
- **ReactorEngine** (`utils/reactor/engine.ts`) — the default full-screen view. A self-contained canvas class: gateway core, infra on a rotating spine ring, three VLAN buses with clients arced around them; own rAF loop, eased rates, hit-testing, and a telemetry callback that feeds the React chrome (`ReactorView.tsx`). Features: per-VLAN **uplink breakdown** (`uplinksFor`) + on-filter **physical-path overlay** (`drawUplinkPaths`, device → access switch/AP → gateway), a **quiet filter** (dims sub-`ACTIVE_BPS` nodes with a 10s activity hold), >1 GB **data-used labels**, and Gbps/TB-scale readouts.
- **App.tsx** — opens on the Reactor (`reactorOpen` defaults true; Exit/`Esc` → dashboard). Owns shared state: filter, selection, color mode, and the **global usage window** (drives panels *and* node sizing). Lays out the rail/stage/rail grid for the dashboard.
- **Panels** — Header HUD (+ down/up `Sparkline`, "Idle" under ~50 Kbps), WanChart (data-usage window), DeviceDetail, TopTalkers, Segments (VLAN), Events, Legend, Controls, TimePlayback.

## Key semantics & gotchas (read before touching rates)

- **Units.** Everything is normalized to **bits/sec** internally. The Integration API's device `statistics/latest.uplink.txRateBps`/`rxRateBps` are already **bits/sec**; the legacy `stat/sta` client `tx_bytes-r`/`rx_bytes-r` are **bytes/sec** — the adapter multiplies the latter by 8. Display volumes (`/api/usage`) are **bytes** (÷8 from bit-rate integration). Device rates use **only** true rate fields — never a cumulative counter fallback (which would spike to multi-Gbps on a poll missing the rate).
- **Wired clients.** Wired stations report traffic under **`wired-*`** keys (`wired-tx_bytes`, `wired-tx_bytes-r`, …) while the bare keys come back null — `extractLegacyClientRate` accepts either. Missing this made wired PCs read as zero activity.
- **Live per-client rate = counter delta.** The adapter derives each client's live rate from the **change in its cumulative byte counters between polls** (`deltaRate`, guarded against resets/short intervals), falling back to the reported `*-r` rate only on the first sample. UniFi's `*-r` field is coarse and under-reports active streams. (Note: UniFi's per-client counters can miss some LAN/inter-VLAN egress — a host's upload to another VLAN may not be attributed to it even when the receiver's download is; this is a controller-side limit, not recoverable from client stats.)
- **Client down/up.** For a *client*, the controller's `tx_bytes` is the **download** (infra→client), the reverse of the gateway's uplink convention. The adapter swaps client tx/rx so `rxBytes` = download everywhere.
- **API key.** A *local Network Integration* key (Network app → Control Plane → Integrations) works against `/proxy/network/integration/v1` **and** the legacy `/proxy/network/api/...`. A `unifi.ui.com` cloud key only works against `api.ui.com` and returns 401 locally.
- **Type definitions are duplicated** between `server/src/models/types.ts` and `web/src/types/index.ts` — keep them in sync (a known tech-debt item).

## Build & run

`npm run dev` runs both workspaces (concurrently). Server: `tsx watch`. Web: Vite. `npm run build` builds both (`tsc` + `vite build`). Secrets via `.env`; data in `<repo>/data` (gitignored).

## Deployment

Production ships as a **single container** (root `Dockerfile`, multi-stage). The build context is the repo root so the npm-workspace lockfile is usable; the build stage carries the `better-sqlite3` native toolchain. At runtime the **server serves the web bundle as static files** (`@fastify/static` from `<cwd>/public`, populated from `web/dist`), so the same origin serves the API, SSE, and UI — no reverse proxy, so SSE needs no special tuning. `docker compose` mounts `config.json` and a named `unifi-data` volume (SQLite), auto-loads `.env`, and sets `HOST=0.0.0.0` + `ALLOW_INSECURE_BIND=1` while restricting exposure via a `127.0.0.1` host port mapping.
