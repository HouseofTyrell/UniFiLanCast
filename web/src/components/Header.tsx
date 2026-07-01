import { NetworkSnapshot } from '../types';
import { computeStats } from '../utils/stats';
import { formatBitrate } from '../utils/format';
import { ConnState } from '../hooks/useNetworkData';
import { WanPoint } from '../hooks/useRollingData';
import './Header.css';

interface HeaderProps {
  snapshot: NetworkSnapshot | null;
  connState: ConnState;
  stale: boolean;
  site?: string;
  history?: WanPoint[];
  onReactor?: () => void;
}

const SPARK_POINTS = 30; // ~2.5 min of recent WAN throughput at 5s cadence

/** Tiny inline area sparkline of the most recent throughput samples. */
function Sparkline({ values, color }: { values: number[]; color: string }) {
  const w = 62;
  const h = 24;
  const pad = 2;
  if (values.length < 2) return <span className="hdr-spark" style={{ width: w, height: h }} />;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const n = values.length;
  const px = (i: number) => pad + (i / (n - 1)) * (w - pad * 2);
  const py = (v: number) => h - pad - ((v - min) / range) * (h - pad * 2);
  const line = values.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ');
  const area = `${px(0).toFixed(1)},${h} ${line} ${px(n - 1).toFixed(1)},${h}`;
  return (
    <svg
      className="hdr-spark"
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polygon points={area} fill={color} opacity="0.13" />
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={px(n - 1)} cy={py(values[n - 1])} r="1.7" fill={color} />
    </svg>
  );
}

function connBadge(connState: ConnState, stale: boolean): { cls: string; label: string } {
  if (connState === 'connecting') return { cls: 'down', label: 'Connecting…' };
  if (connState === 'reconnecting') return { cls: 'down', label: 'Reconnecting…' };
  if (stale) return { cls: 'stale', label: 'Stale' };
  return { cls: 'live', label: 'Live' };
}

function Rate({
  bps,
  label,
  direction,
  series,
}: {
  bps: number;
  label: string;
  direction: 'down' | 'up';
  series?: number[];
}) {
  const { value, unit } = formatBitrate(bps);
  const color = direction === 'down' ? 'var(--accent-down)' : 'var(--accent-up)';
  return (
    <div className="hdr-rate">
      <span className={`hdr-rate-arrow ${direction}`}>{direction === 'down' ? '↓' : '↑'}</span>
      <div className="hdr-rate-body">
        <div className="hdr-rate-value tabular">
          {value}
          <span className="hdr-rate-unit">{unit}</span>
        </div>
        <div className="hdr-stat-label">{label}</div>
      </div>
      {series && series.length > 1 && <Sparkline values={series} color={color} />}
    </div>
  );
}

function Stat({ value, label, tone }: { value: number; label: string; tone?: string }) {
  return (
    <div className="hdr-stat">
      <div className={`hdr-stat-value tabular ${tone ?? ''}`}>{value}</div>
      <div className="hdr-stat-label">{label}</div>
    </div>
  );
}

export function Header({ snapshot, connState, stale, site, history, onReactor }: HeaderProps) {
  const stats = computeStats(snapshot);
  const badge = connBadge(connState, stale);
  const recent = (history ?? []).slice(-SPARK_POINTS);
  const downSeries = recent.map(p => p.down);
  const upSeries = recent.map(p => p.up);

  return (
    <header className="header">
      <div className="header-logo">
        <img src="/icons/logo-icon.svg" alt="" className="header-logo-icon" />
        <div className="header-title-block">
          <h1 className="header-title">UniFiLanCast</h1>
          <span className="header-subtitle">
            Network Weather Map{site ? ` · ${site}` : ''}
          </span>
        </div>
      </div>

      <div className="header-stats">
        <Rate bps={stats.wanDown} label="WAN download" direction="down" series={downSeries} />
        <Rate bps={stats.wanUp} label="WAN upload" direction="up" series={upSeries} />
        <div className="hdr-divider" />
        <Stat value={stats.infraCount} label="Devices" />
        <Stat value={stats.clientCount} label="Clients" />
        <Stat value={stats.onlineCount} label="Online" tone="online" />
        {stats.offlineCount > 0 && <Stat value={stats.offlineCount} label="Offline" tone="bad" />}
      </div>

      <div className="header-right">
        {onReactor && (
          <button className="header-reactor" onClick={onReactor} title="Open the Reactor view">
            ◎ Reactor
          </button>
        )}
        <div className={`header-conn ${badge.cls}`}>
          <span className="header-conn-dot" />
          {badge.label}
        </div>
      </div>
    </header>
  );
}
