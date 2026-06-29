# Roadmap

Where UniFiLanCast is and where it's going. **Check the "Shipped" list before building anything** — most of the original roadmap is already done; don't rebuild it.

## ✅ Shipped

- **Real hardware** via the local Network Integration API (`IntegrationApiAdapter`) + legacy `stat/sta` per-client enrichment.
- **Persistence** — SQLite store (history, device inventory with first-seen, events) surviving restarts; continuous capture loop.
- **Bandwidth** — live per-device + WAN throughput; **windowed data usage** (5m–8h) for WAN, per device, and **driving node sizing**.
- **Dashboard** — live HUD header, WAN trend chart, Top Talkers, VLAN Segments, live Events feed, device-detail panel.
- **Visualization** — tiered + organic-clustered constellation, weather effects (flow/heat/fog/lightning), activity-based prominence + focus pass, VLAN coloring, monoline device icons, ambient depth.
- **Alerting** — webhook dispatcher (Discord/Slack/generic) with severity gating + throttle/dedup.
- **Auth** — optional HTTP Basic over the whole app.
- **Mock mode** for hardware-free development.
- **Time playback** of recent history.

## 🔜 Near-term roadmap

| Feature | Why | Notes |
|---|---|---|
| **Prometheus `/metrics`** | #1 homelab integration ask | Export device/throughput/usage gauges; Grafana-friendly. |
| **Plain-English status line + calm/alarm global state** | Non-technical viewers & NOC glanceability | One-sentence "all healthy / N issues" banner derived from weather signals. |
| **Kiosk mode** | Wall-display use | URL param to hide rails/controls, auto-rotate focus. |
| **Per-port switch stats** | Drill-down depth | Port utilization, speed, PoE; needs Integration API port data. |
| **Security: new-device allowlist + acknowledge** | Turn detection into action | Ack unknown devices; segmentation audit (clients on unexpected VLANs). |
| **Export** | Sharing/reporting | PNG snapshot, CSV device list, JSON history. |
| **Custom weather thresholds** | Tunability | UI to set storm/heat/fog/lightning thresholds. |

## 🌥️ Later / larger

- **Multi-site & multi-tenancy / RBAC** (MSP use) — site selector, per-tenant scoping.
- **WAN speed-test integration** — periodic Ookla/ speedtest trend.
- **Device grouping** — custom groups by MAC/IP pattern with visual regions.
- **Mobile companion / push notifications.**

## 🧹 Tech debt

A full multi-dimension code review (architecture, correctness, security, performance, quality) was run; findings were adversarially verified against the code. Status below.

### ✅ Addressed (commit `b803223`)
- **Security defaults** — bind `127.0.0.1` by default + fail-closed when LAN-exposed without auth (SEC-1); harden/validate/atomic `POST /api/config` (SEC-2); redact secrets from `GET /api/config` (SEC-3); restrict CORS (SEC-4); default `verifySsl: true` (SEC-5); clamp `/api/history` input (SEC-8).
- **Correctness** — AlertManager throttles only on successful delivery (COR-1); SSE reconnect timer cleanup (COR-5); bounded event-dedupe set (COR-8); `usageLevel` range guard (COR-7).
- **Performance/rendering** — `devicePixelRatio` applied, fixing blurry Retina canvas (PERF-1); SSE serialize-once (PERF-6); `getDeviceUsages` map reuse (PERF-7); single long-lived rAF loop (PERF-8).

### ⏳ Remaining (prioritized)
- [~] **Automated tests** — Vitest is set up in both workspaces and gates every push via `npm run ci`; 28 tests cover the rate→bytes integration, config validation/redaction/secret-preservation, alert delivery/throttle, formatting, and VLAN coloring. _Remaining: adapter normalization fixtures (legacy unit conversion / client direction), React hook tests (SSE cleanup), layout math, and coverage thresholds._
- [ ] **Usage-integration cadence** — store (30s) vs in-memory (5s) sampling diverge; `dt>180s` gaps silently dropped → under-counted totals. Make cadence explicit/consistent; clamp rather than drop gaps (COR-3).
- [ ] **`fetchData` drops events captured between polls** when capture cadence < poll cadence — buffer & drain, or validate the config combination (COR-2).
- [ ] **Client rate/counter unit ambiguity** for clients with no legacy match — always set `rxBytes/txBytes` to rates, keep cumulative in totals (COR-4).
- [ ] **Vanished devices never marked offline** + O(n²) device lookup in `recordStateChange` (COR-6); pagination dedupe (COR-9); `assoc_time` via `toMs` (COR-10).
- [ ] **`getHistory` re-parses all snapshots per usage request** — add a narrow `device_samples` table / SQL projection, or cache parsed history (PERF-2/3).
- [ ] **Per-frame full layout recompute + allocations** — gate `computeRadialTargets` on a topology/size signature; reuse scratch buffers (PERF-4/5).
- [ ] **Duplicated type definitions** between `server/src/models/types.ts` and `web/src/types/index.ts` — shared package to prevent drift.
- [ ] **`visualization.ts` is a ~950-line god-module** — split layout / rendering / weather / hit-testing.
- [ ] **No config schema validation on load** — validate `config.json` at startup (zod) with clear errors.
- [ ] **Webhook SSRF hardening** (block private targets) (SEC-6); normalize `CONFIG_PATH`/`DATA_DIR` (SEC-7).
- [x] **Local CI** — `npm run ci` (typecheck + build + tests-when-present) wired to a git `pre-push` hook via `.githooks`. _(GitHub Actions + automated Docker builds deferred.)_
- [ ] **Lint** — ESLint was never actually installed/configured (the old `lint` scripts were dead and have been removed); add a flat ESLint config and fold it into `npm run ci`.
- [ ] **API docs** — OpenAPI/Swagger for the REST surface.

---

Have an idea? Open an issue with the use case. See [README.md](README.md) for setup and [ARCHITECTURE.md](ARCHITECTURE.md) for how it's built.
