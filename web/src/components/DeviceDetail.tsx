import { Device, DeviceType } from '../types';
import { formatBitrateStr, formatBytes, formatSince } from '../utils/format';
import './DeviceDetail.css';

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
}

export function DeviceDetail({ device, onClose }: Props) {
  if (!device) return null;
  const color = TYPE_COLOR[device.type];
  const isClient = device.type === 'client';
  const down = device.rxBytes || 0;
  const up = device.txBytes || 0;
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

      {/* Cumulative session data */}
      {(totalDown !== undefined || totalUp !== undefined) && (
        <div className="dd-totals">
          <div className="dd-total">
            <span className="dd-total-cap">Total down</span>
            <span className="dd-total-val tabular">{formatBytes(totalDown || 0)}</span>
          </div>
          <div className="dd-total">
            <span className="dd-total-cap">Total up</span>
            <span className="dd-total-val tabular">{formatBytes(totalUp || 0)}</span>
          </div>
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
