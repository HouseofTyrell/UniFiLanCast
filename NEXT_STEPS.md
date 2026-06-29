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

> This list is being refreshed by a full multi-dimension code review (architecture, correctness, security, performance, quality). High-value items will be folded in here as they're triaged.

Known going in:
- [ ] **No automated tests** — add Vitest (web) + a backend test runner; cover the rate→bytes integration, the adapter unit reconciliation, and layout math.
- [ ] **Duplicated type definitions** between `server/src/models/types.ts` and `web/src/types/index.ts` — risk of drift; consider a shared package.
- [ ] **`visualization.ts` is a ~950-line god-module** — split layout / rendering / weather / hit-testing.
- [ ] **`getHistory` re-parses all snapshots per usage request** — cache or push aggregation into SQL.
- [ ] **No config schema validation** — validate `config.json` on load (zod) with clear errors.
- [ ] **CI/CD** — GitHub Actions for build + lint + tests; automated Docker builds.
- [ ] **API docs** — OpenAPI/Swagger for the REST surface.

---

Have an idea? Open an issue with the use case. See [README.md](README.md) for setup and [ARCHITECTURE.md](ARCHITECTURE.md) for how it's built.
