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
NetworkVisualization (canvas)           web/src/utils/visualization.ts
   + dashboard panels                   web/src/components/
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
- **NetworkVisualization** (`utils/visualization.ts`) — the canvas renderer. Sized to its **stage** container (between the rails) via `ResizeObserver`. Responsibilities: layout (`computeRadialTargets` — the tiered hub-and-cluster layout), eased + drifting node motion, node/link/weather rendering, hit-testing, focus pass, color modes, and **usage-driven sizing** (`setUsageMap` → `usageLevel`).
- **App.tsx** — owns shared state: filter, selection, color mode, and the **global usage window** (drives panels *and* node sizing). Lays out the rail/stage/rail grid.
- **Panels** — Header HUD, WanChart (data-usage window), DeviceDetail, TopTalkers, Segments (VLAN), Events, Legend, Controls, TimePlayback.

## Key semantics & gotchas (read before touching rates)

- **Units.** Everything is normalized to **bits/sec** internally. The Integration API's device `statistics/latest.uplink.txRateBps`/`rxRateBps` are already **bits/sec**; the legacy `stat/sta` client `tx_bytes-r`/`rx_bytes-r` are **bytes/sec** — the adapter multiplies the latter by 8. Display volumes (`/api/usage`) are **bytes** (÷8 from bit-rate integration).
- **Client down/up.** For a *client*, the controller's `tx_bytes` is the **download** (AP→client), the reverse of the gateway's uplink convention. The adapter swaps client tx/rx so `rxBytes` = download everywhere.
- **API key.** A *local Network Integration* key (Network app → Control Plane → Integrations) works against `/proxy/network/integration/v1` **and** the legacy `/proxy/network/api/...`. A `unifi.ui.com` cloud key only works against `api.ui.com` and returns 401 locally.
- **Type definitions are duplicated** between `server/src/models/types.ts` and `web/src/types/index.ts` — keep them in sync (a known tech-debt item).

## Build & run

`npm run dev` runs both workspaces (concurrently). Server: `tsx watch`. Web: Vite. `npm run build` builds both (`tsc` + `vite build`). Secrets via `.env`; data in `<repo>/data` (gitignored).
