# Next Steps & Enhancements

This document outlines potential improvements and features for the Network Weather Map.

## High Priority

### 1. Top Talkers Dashboard
**Description**: Show top 10 devices by bandwidth usage with real-time graphs.

**Implementation**:
- Add a new panel in the UI showing ranked devices
- Track bandwidth over rolling 5-minute window
- Display sparklines for each device
- Allow clicking to highlight device on map

**Estimated effort**: 4-6 hours

---

### 2. Per-Port Statistics
**Description**: Detailed switch port utilization and status.

**Implementation**:
- Extend Local Network adapter to fetch port stats
- Add drill-down view when clicking switches
- Show port utilization, speed, duplex, PoE status
- Identify which devices are on which ports

**Estimated effort**: 6-8 hours

---

### 3. Alert Integration (Discord/Slack)
**Description**: Send notifications when network events occur.

**Implementation**:
- Add webhook configuration to config.json
- Create alert dispatcher in backend
- Define alert rules (device offline, high latency, etc.)
- Add throttling to prevent alert spam
- Support Discord, Slack, and generic webhooks

**Example config**:
```json
{
  "alerts": {
    "discord": {
      "enabled": true,
      "webhookUrl": "https://discord.com/api/webhooks/...",
      "rules": {
        "deviceOffline": true,
        "highLatency": { "threshold": 200 },
        "packetLoss": { "threshold": 5 }
      }
    }
  }
}
```

**Estimated effort**: 8-10 hours

---

## Medium Priority

### 4. Advanced Analytics Dashboard
**Description**: Historical bandwidth trends, device uptime, client patterns.

**Implementation**:
- Add persistent storage (SQLite or PostgreSQL)
- Create analytics queries for trends
- Add charts using Chart.js or Recharts
- Show daily/weekly/monthly views

**Estimated effort**: 12-16 hours

---

### 5. Custom Weather Rules
**Description**: Let users configure thresholds for weather effects.

**Implementation**:
- Add settings panel in UI
- Allow customization of:
  - Storm threshold (utilization %)
  - Fog threshold (packet loss %)
  - Heat threshold (traffic bytes)
  - Lightning threshold (latency ms)
- Save preferences in localStorage or server config

**Estimated effort**: 4-6 hours

---

### 6. Export Features
**Description**: Export network data and visualizations.

**Features**:
- Screenshot map as PNG
- Export device list to CSV
- Export historical data to JSON
- Generate PDF report with statistics

**Implementation**:
- Use html2canvas for screenshots
- Add export buttons in UI
- Create PDF template with device summary

**Estimated effort**: 6-8 hours

---

## Low Priority

### 7. Mobile Companion App
**Description**: React Native app for iOS/Android.

**Features**:
- View network status
- Receive push notifications
- Quick device search
- Alert acknowledgment

**Estimated effort**: 40-60 hours

---

### 8. Multi-Site Support
**Description**: Visualize multiple UniFi sites simultaneously.

**Implementation**:
- Extend adapters to handle multiple sites
- Add site selector in UI
- Show aggregate statistics
- Support switching between sites

**Estimated effort**: 10-12 hours

---

### 9. VLAN Visualization
**Description**: Color-code devices by VLAN membership.

**Implementation**:
- Fetch VLAN data from adapters
- Add VLAN color mapping in config
- Apply colors to nodes and links
- Add VLAN filter in UI

**Estimated effort**: 4-6 hours

---

### 10. Guest Network Detection
**Description**: Highlight guest devices differently.

**Implementation**:
- Detect guest networks by SSID or VLAN
- Apply special styling (dotted border, different color)
- Add "guests only" filter
- Show guest count in status panel

**Estimated effort**: 3-4 hours

---

### 11. WAN Speed Test Integration
**Description**: Show internet bandwidth over time.

**Implementation**:
- Add speedtest integration (speedtest-cli or Ookla API)
- Run periodic speed tests (configurable interval)
- Display WAN bandwidth graph
- Show upload/download trends

**Estimated effort**: 6-8 hours

---

### 12. Device Grouping
**Description**: Custom device organization and labeling.

**Implementation**:
- Add device groups in config (e.g., "Office", "IoT", "Media")
- Assign devices to groups by MAC/IP patterns
- Visual grouping on map with colored regions
- Group-based filtering

**Example config**:
```json
{
  "groups": {
    "office": {
      "name": "Office Devices",
      "color": "#007aff",
      "patterns": ["192.168.1.1*", "Office-*"]
    },
    "iot": {
      "name": "IoT Devices",
      "color": "#ff9500",
      "patterns": ["192.168.2.*", "*-IoT-*"]
    }
  }
}
```

**Estimated effort**: 8-10 hours

---

## Technical Debt

### Code Quality
- [ ] Add comprehensive unit tests (Jest for backend, Vitest for frontend)
- [ ] Add E2E tests (Playwright)
- [ ] Improve error handling in adapters
- [ ] Add retry logic with exponential backoff
- [ ] Implement proper rate limiting

### Performance
- [ ] Add Redis caching for API responses
- [ ] Implement WebSocket instead of SSE for lower latency
- [ ] Optimize canvas rendering for 100+ devices
- [ ] Add device clustering for large networks
- [ ] Lazy load history data

### Documentation
- [ ] Add JSDoc comments to all functions
- [ ] Create API documentation (OpenAPI/Swagger)
- [ ] Add architecture diagrams
- [ ] Create video tutorial
- [ ] Write contribution guidelines

### DevOps
- [ ] Add CI/CD pipeline (GitHub Actions)
- [ ] Automated Docker builds
- [ ] Version tagging and releases
- [ ] Health check endpoints
- [ ] Prometheus metrics export

---

## Community Ideas

Have a feature request? Open an issue on GitHub with:
- Clear description of the feature
- Use case / why it's useful
- (Optional) Implementation suggestions

**Priority is determined by**:
- Community interest (upvotes on issues)
- Implementation complexity
- Maintainability impact

---

## Getting Started with Contributing

1. Pick a feature from this list
2. Open an issue to discuss approach
3. Fork the repo and create a feature branch
4. Implement with tests
5. Submit a pull request

See README.md for development setup instructions.
