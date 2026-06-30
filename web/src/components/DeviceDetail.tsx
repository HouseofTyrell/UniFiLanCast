import { useEffect, useState } from 'react';
import { Device, DeviceType } from '../types';
import { formatBitrateStr, formatBytes, formatSince } from '../utils/format';
import './DeviceDetail.css';

const WINDOWS: Array<{ label: string; minutes: number }> = [
  { label: '5m', minutes: 5 },
  { label: '15m', minutes: 15 },
  { label: '30m', minutes: 30 },
  { label: '1h', minutes: 60 },
  { label: '2h', minutes: 120 },
  { label: '8h', minutes: 480 },
];

const TYPE_COLOR: Record<DeviceType, string> = {
  gateway: 'var(--type-gateway)',
  switch: 'var(--type-switch)',
  ap: 'var(--type-ap)',
  client: 'var(--type-client)',
  server: 'var(--type-client)',
  unknown: 'var(--text-dim)',
};

const TYPE_LABEL: Record<DeviceType, string> = {
  gateway: 'Gateway',
  switch: 'Switch',
  ap: 'Access Point',
  client: 'Client',
  server: 'Server',
  unknown: 'Device',
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <div className="dd-row">
      <span className="dd-row-label">{label}</span>
      <span className="dd-row-value">{value}</span>
    </div>
  );
}

/** Signal strength in dBm → 0..4 bars. */
function signalBars(dbm: number): number {
  if (dbm >= -55) return 4;
  if (dbm >= -67) return 3;
  if (dbm >= -75) return 2;
  if (dbm >= -82) return 1;
  return 0;
}

interface Props {
  device: Device | null;
  onClose: () => void;
  minutes: number;
  onMinutesChange: (m: number) => void;
}

export function DeviceDetail({ device, onClose, minutes, onMinutesChange }: Props) {
  const [usage, setUsage] = useState<{ downBytes: number; upBytes: number } | null>(null);
  const deviceId = device?.id;

  useEffect(() => {
    if (!deviceId) {
      setUsage(null);
      return;
    }
    let cancelled = false;
    setUsage(null);
    const fetchUsage = async () => {
      try {
        const res = await fetch(`/api/usage?minutes=${minutes}&deviceId=${encodeURIComponent(deviceId)}`);
        if (!res.ok) return;
        const u = await res.json();
        if (!cancelled) setUsage({ downBytes: u.downBytes, upBytes: u.upBytes });
      } catch {
        /* transient */
      }
    };
    fetchUsage();
    const id = setInterval(fetchUsage, 15000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [deviceId, minutes]);

  if (!device) return null;
  const color = TYPE_COLOR[device.type];
  const isClient = device.type === 'client';
  const down = device.rxBps || 0;
  const up = device.txBps || 0;
  const totalDown = device.totalRxBytes;
  const totalUp = device.totalTxBytes;
  const bars = device.rssi !== undefined ? signalBars(device.rssi) : -1;

  return (
    <div className="dd glass">
      <div className="dd-head">
        <span className="dd-dot" style={{ background: color, boxShadow: `0 0 10px ${color}` }} />
        <div className="dd-title-block">
          <div className="dd-title">{device.name}</div>
          <div className="dd-subtitle">
            {TYPE_LABEL[device.type]}
            {device.vendor ? ` · ${device.vendor}` : ''}
            {device.osName ? ` · ${device.osName}` : ''}
          </div>
        </div>
        <button className="dd-close" onClick={onClose} aria-label="Close">×</button>
      </div>

      {/* Live rate */}
      <div className="dd-rates">
        <div className="dd-rate">
          <span className="dd-rate-arrow down">↓</span>
          <div>
            <div className="dd-rate-val tabular">{formatBitrateStr(down)}</div>
            <div className="dd-rate-cap">download</div>
          </div>
        </div>
        <div className="dd-rate">
          <span className="dd-rate-arrow up">↑</span>
          <div>
            <div className="dd-rate-val tabular">{formatBitrateStr(up)}</div>
            <div className="dd-rate-cap">upload</div>
          </div>
        </div>
      </div>

      {/* Data used over a selectable window */}
      <div className="dd-usage-head">
        <span className="dd-usage-title">Data used</span>
        <select
          className="dd-usage-window"
          value={minutes}
          onChange={e => onMinutesChange(Number(e.target.value))}
        >
          {WINDOWS.map(w => (
            <option key={w.minutes} value={w.minutes}>last {w.label}</option>
          ))}
        </select>
      </div>
      <div className="dd-totals">
        <div className="dd-total">
          <span className="dd-total-cap">Downloaded</span>
          <span className="dd-total-val tabular">{usage ? formatBytes(usage.downBytes) : '—'}</span>
        </div>
        <div className="dd-total">
          <span className="dd-total-cap">Uploaded</span>
          <span className="dd-total-val tabular">{usage ? formatBytes(usage.upBytes) : '—'}</span>
        </div>
      </div>

      {/* Cumulative session data */}
      {(totalDown !== undefined || totalUp !== undefined) && (
        <div className="dd-session">
          <span>This session: ↓ {formatBytes(totalDown || 0)} · ↑ {formatBytes(totalUp || 0)}</span>
        </div>
      )}

      <div className="dd-section">
        <Row label="Status" value={
          <span style={{ color: device.online ? 'var(--accent-online)' : 'var(--accent-bad)' }}>
            {device.online ? 'Online' : 'Offline'}
          </span>
        } />
        <Row label="Connection" value={
          device.wiredOrWifi === 'wifi' ? `WiFi · ${device.ssid || 'unknown SSID'}` :
          device.wiredOrWifi === 'wired' ? 'Wired' : undefined
        } />
        {bars >= 0 && (
          <Row label="Signal" value={
            <span className="dd-signal">
              <span className="dd-bars">
                {[0, 1, 2, 3].map(i => (
                  <span key={i} className={`dd-bar ${i < bars ? 'on' : ''}`} style={{ height: `${(i + 1) * 3 + 3}px` }} />
                ))}
              </span>
              <span className="tabular">{device.rssi} dBm</span>
            </span>
          } />
        )}
        <Row label="Channel" value={device.channel} />
        <Row label="Network" value={device.vlanId !== undefined ? `VLAN ${device.vlanId}` : undefined} />
        <Row label="Experience" value={device.experience !== undefined ? `${device.experience}%` : undefined} />
      </div>

      <div className="dd-section">
        <Row label="IP" value={device.ip} />
        <Row label="MAC" value={device.mac ? <span className="tabular dd-mac">{device.mac}</span> : undefined} />
        <Row label="Connected" value={device.connectedSince ? `${formatSince(device.connectedSince)} ago` : undefined} />
        {device.latencyMs !== undefined && <Row label="Latency" value={`${device.latencyMs.toFixed(0)} ms`} />}
      </div>

      {/* Infrastructure load */}
      {!isClient && (device.cpuPct !== undefined || device.loadAvg !== undefined || device.memPct !== undefined) && (
        <div className="dd-section">
          <Row label="CPU" value={device.cpuPct !== undefined ? `${device.cpuPct.toFixed(0)}%` : undefined} />
          <Row label="Memory" value={device.memPct !== undefined ? `${device.memPct.toFixed(0)}%` : undefined} />
          <Row label="Load" value={device.loadAvg !== undefined ? device.loadAvg.toFixed(2) : undefined} />
        </div>
      )}
    </div>
  );
}
