import { NetworkSnapshot } from '../types';
import { computeStats } from '../utils/stats';
import { formatBitrate } from '../utils/format';
import { ConnState } from '../hooks/useNetworkData';
import './Header.css';

interface HeaderProps {
  snapshot: NetworkSnapshot | null;
  connState: ConnState;
  stale: boolean;
  site?: string;
}

function connBadge(connState: ConnState, stale: boolean): { cls: string; label: string } {
  if (connState === 'connecting') return { cls: 'down', label: 'Connecting…' };
  if (connState === 'reconnecting') return { cls: 'down', label: 'Reconnecting…' };
  if (stale) return { cls: 'stale', label: 'Stale' };
  return { cls: 'live', label: 'Live' };
}

function Rate({ bps, label, direction }: { bps: number; label: string; direction: 'down' | 'up' }) {
  const { value, unit } = formatBitrate(bps);
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

export function Header({ snapshot, connState, stale, site }: HeaderProps) {
  const stats = computeStats(snapshot);
  const badge = connBadge(connState, stale);

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
        <Rate bps={stats.wanDown} label="WAN download" direction="down" />
        <Rate bps={stats.wanUp} label="WAN upload" direction="up" />
        <div className="hdr-divider" />
        <Stat value={stats.infraCount} label="Devices" />
        <Stat value={stats.clientCount} label="Clients" />
        <Stat value={stats.onlineCount} label="Online" tone="online" />
        {stats.offlineCount > 0 && <Stat value={stats.offlineCount} label="Offline" tone="bad" />}
      </div>

      <div className={`header-conn ${badge.cls}`}>
        <span className="header-conn-dot" />
        {badge.label}
      </div>
    </header>
  );
}
