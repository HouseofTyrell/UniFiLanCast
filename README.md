# UniFi Network Weather Map

A real-time network visualization dashboard that displays your UniFi network as an animated "weather map" - where network traffic appears as wind, outages as fog, and performance issues as lightning.

![Network Weather Map](https://img.shields.io/badge/status-stable-green) ![TypeScript](https://img.shields.io/badge/TypeScript-100%25-blue)

## Features

- **Real-time Visualization**: Live network topology with animated weather effects
- **Multi-Source Support**: Works with UniFi Site Manager API (cloud) and Local Network API
- **Weather Effects**:
  - 🌪️ **Storm/Wind**: High traffic utilization with animated flow particles
  - 🌫️ **Fog**: Packet loss and offline devices
  - 🔥 **Heat**: Device load and high traffic
  - ⚡ **Lightning**: Latency spikes and sudden network events
- **Interactive Features**:
  - Hover tooltips with device details
  - Search by name, IP, or MAC address
  - Filters (wired/WiFi/issues only)
  - Live event feed
- **Time Playback**: Replay last 60 minutes of network history
- **Mock Mode**: Built-in mock adapter for testing without UniFi hardware
- **Docker Ready**: Easy deployment via Docker Compose

## Architecture

```
┌─────────────────────────────────────────────┐
│           Frontend (React + Canvas)         │
│  ┌─────────────────────────────────────┐   │
│  │  Weather Visualization Engine        │   │
│  │  - Force-directed layout             │   │
│  │  - Particle effects                  │   │
│  │  - Interactive controls              │   │
│  └─────────────────────────────────────┘   │
└──────────────────┬──────────────────────────┘
                   │ SSE/REST
┌──────────────────▼──────────────────────────┐
│        Backend (Node + Fastify)             │
│  ┌─────────────────────────────────────┐   │
│  │  Data Manager + Weather Engine       │   │
│  │  - Normalizes adapter data           │   │
│  │  - Computes weather signals          │   │
│  │  - In-memory history buffer          │   │
│  └──────────────┬──────────────────────┘   │
│                 │                            │
│  ┌──────────────▼──────────────────────┐   │
│  │  Pluggable Adapters                  │   │
│  │  ┌────────────────────────────────┐ │   │
│  │  │ Mock Adapter (default)         │ │   │
│  │  │ Site Manager API Adapter       │ │   │
│  │  │ Local Network API Adapter      │ │   │
│  │  └────────────────────────────────┘ │   │
│  └─────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

## Quick Start

### Development (Windows or Linux/Mac)

**Prerequisites:**
- Node.js 18+ (recommended: 20.x)
- npm or yarn

**1. Clone and install dependencies:**

```bash
git clone <your-repo-url>
cd UniFiLanCast
npm install
```

**2. Create configuration file:**

```bash
cp config.example.json config.json
```

**3. Start in development mode (mock data):**

```bash
npm run dev
```

This starts:
- Backend server on `http://localhost:3001`
- Frontend dev server on `http://localhost:5173`

Open `http://localhost:5173` to view the dashboard.

### Production Deployment (Docker)

**Prerequisites:**
- Docker and Docker Compose

**1. Create your config file:**

```bash
cp config.example.json config.json
```

**2. Edit `config.json` with your UniFi credentials (see Configuration section below)**

**3. Start services:**

```bash
docker-compose up -d
```

**4. Access dashboard:**

Open `http://localhost:8080`

The server API is available at `http://localhost:3001/api`

## Configuration

Edit `config.json` to configure data sources:

```json
{
  "adapters": {
    "mock": {
      "enabled": true,
      "deviceCount": 30
    },
    "siteManager": {
      "enabled": false,
      "apiKey": "YOUR_SITE_MANAGER_API_KEY",
      "pollingInterval": 15000
    },
    "localNetwork": {
      "enabled": false,
      "baseUrl": "https://192.168.1.1",
      "username": "YOUR_USERNAME",
      "password": "YOUR_PASSWORD",
      "pollingInterval": 5000,
      "useProxyPrefix": true,
      "verifySsl": false
    }
  },
  "server": {
    "port": 3001,
    "historyRetentionMinutes": 60,
    "logLevel": "info"
  }
}
```

### Adapter Configuration

#### Mock Adapter (Default)
- **Purpose**: Testing without UniFi hardware
- **deviceCount**: Number of simulated devices (default: 30)
- Generates realistic traffic patterns, random outages, and latency spikes

#### Site Manager API Adapter
- **Purpose**: Official UniFi cloud API (read-only)
- **apiKey**: Your Site Manager API key from [account.ui.com](https://account.ui.com)
- **pollingInterval**: How often to fetch data (milliseconds, default: 15000)
- **Features**: Device inventory, ISP metrics, basic health

#### Local Network API Adapter
- **Purpose**: Direct connection to UniFi Network Application
- **baseUrl**: Your controller URL (e.g., `https://192.168.1.1`)
- **username/password**: Local admin credentials
- **useProxyPrefix**: Set to `true` for UniFi OS consoles (UDM/UCG), `false` for classic controllers
- **verifySsl**: Set to `false` for self-signed certificates
- **pollingInterval**: How often to fetch data (milliseconds, default: 5000)
- **Features**: Full device inventory, active clients, traffic stats, health metrics

### Using Multiple Adapters

You can enable multiple adapters simultaneously. The system will merge data intelligently:

```json
{
  "adapters": {
    "mock": {
      "enabled": false
    },
    "siteManager": {
      "enabled": true,
      "apiKey": "your-key"
    },
    "localNetwork": {
      "enabled": true,
      "baseUrl": "https://192.168.1.1",
      "username": "admin",
      "password": "password"
    }
  }
}
```

## API Reference

### REST Endpoints

**GET /api/snapshot**
- Returns current network state
- Response: `NetworkSnapshot` object with devices, links, events, and weather signals

**GET /api/history?minutes=60**
- Returns historical network samples
- Query params: `minutes` (default: 60)
- Response: Array of `HistorySample` objects

**GET /api/status**
- Returns adapter connection status
- Response: Array of `AdapterStatus` objects

**GET /api/stream**
- Server-Sent Events stream for live updates
- Emits `NetworkSnapshot` on each update (~every 5 seconds)

## Project Structure

```
UniFiLanCast/
├── server/                    # Backend (Node + TypeScript)
│   ├── src/
│   │   ├── adapters/         # Data source adapters
│   │   │   ├── MockAdapter.ts
│   │   │   ├── SiteManagerAdapter.ts
│   │   │   └── LocalNetworkAdapter.ts
│   │   ├── models/           # Data models
│   │   │   ├── types.ts
│   │   │   └── adapter.ts
│   │   ├── routes/           # API routes
│   │   │   └── api.ts
│   │   ├── utils/            # Utilities
│   │   │   ├── weatherEngine.ts
│   │   │   └── logger.ts
│   │   ├── DataManager.ts    # Central data coordinator
│   │   └── index.ts          # Entry point
│   ├── package.json
│   ├── tsconfig.json
│   └── Dockerfile
├── web/                       # Frontend (React + Vite)
│   ├── src/
│   │   ├── components/       # UI components
│   │   │   ├── NetworkCanvas.tsx
│   │   │   ├── Controls.tsx
│   │   │   └── TimePlayback.tsx
│   │   ├── hooks/            # React hooks
│   │   │   └── useNetworkData.ts
│   │   ├── types/            # TypeScript types
│   │   │   └── index.ts
│   │   ├── utils/            # Utilities
│   │   │   └── visualization.ts
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── package.json
│   ├── vite.config.ts
│   └── Dockerfile
├── config.example.json        # Example configuration
├── docker-compose.yml
├── package.json               # Workspace root
└── README.md
```

## Development

### Running Tests

```bash
# Backend
cd server
npm test

# Frontend
cd web
npm test
```

### Building

```bash
# Build all
npm run build

# Build backend only
npm run build:server

# Build frontend only
npm run build:web
```

### Linting

```bash
cd server && npm run lint
cd web && npm run lint
```

## Troubleshooting

### "Connection lost" error
- Check that the backend server is running
- Verify firewall settings allow connections to port 3001
- Check browser console for CORS errors

### No devices appearing
- Verify adapter configuration in `config.json`
- Check adapter status in the UI (should show green)
- Review server logs for authentication errors
- If using Local Network adapter, ensure credentials are correct

### Self-signed certificate errors (Local Network)
- Set `"verifySsl": false` in config.json
- For UniFi OS consoles, ensure `"useProxyPrefix": true`

### Rate limiting from UniFi API
- Increase `pollingInterval` in config.json
- Site Manager API: Use 15000ms or higher
- Local Network API: Use 5000ms or higher

## Performance Tuning

### Backend
- Adjust `historyRetentionMinutes` to control memory usage
- Increase `pollingInterval` to reduce API calls
- Set `logLevel` to `"warn"` in production

### Frontend
- The canvas rendering is capped at 60 FPS
- Particle effects are automatically throttled based on device count
- Use filters to reduce visible nodes for better performance

## Security Notes

- **Never commit `config.json`** - It's in `.gitignore` by default
- Store credentials as environment variables in production:
  ```bash
  SITE_MANAGER_API_KEY=your-key
  LOCAL_UNIFI_USERNAME=admin
  LOCAL_UNIFI_PASSWORD=password
  ```
- Use read-only API keys where possible
- Enable SSL verification (`verifySsl: true`) when using trusted certificates
- Run behind a reverse proxy (nginx/Caddy) for HTTPS in production

## Next Steps & Future Enhancements

### Planned Features
1. **Top Talkers Dashboard**: Show devices with highest bandwidth usage
2. **Per-Port Statistics**: Detailed switch port utilization graphs
3. **Alert Integration**: Send notifications to Discord/Slack/email
4. **Advanced Analytics**:
   - Bandwidth trending over time
   - Device uptime statistics
   - Client connection history
5. **Custom Weather Rules**: User-defined thresholds for weather effects
6. **Export Features**:
   - Screenshot network map
   - Export metrics to CSV/JSON
   - Generate PDF reports
7. **Mobile App**: React Native companion app
8. **Multi-Site Support**: Visualize multiple UniFi sites simultaneously
9. **VLANs Visualization**: Color-code devices by VLAN
10. **Guest Network Detection**: Highlight guest devices
11. **Speedtest Integration**: Show WAN bandwidth over time
12. **Device Groups**: Custom grouping and labeling

### Contributing
Pull requests welcome! Please ensure:
- TypeScript strict mode compliance
- Tests for new features
- Updated documentation

## License

MIT License - See LICENSE file for details

## Acknowledgments

- Built with [Fastify](https://www.fastify.io/) and [React](https://react.dev/)
- Inspired by traditional weather maps and network monitoring tools
- UniFi is a trademark of Ubiquiti Inc.

## Support

For issues, questions, or feature requests:
- Open an issue on GitHub
- Check existing issues for solutions
- Review server logs for detailed error messages

---

**Enjoy your Network Weather Map!** 🌦️📡
