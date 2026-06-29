import { useEffect, useState } from 'react';
import { WanPoint } from '../hooks/useRollingData';
import { formatBitrate, formatBytes } from '../utils/format';
import './WanChart.css';

interface Props {
  data: WanPoint[];
}

const W = 248;
const H = 50;

const WINDOWS: Array<{ label: string; minutes: number }> = [
  { label: '5m', minutes: 5 },
  { label: '15m', minutes: 15 },
  { label: '30m', minutes: 30 },
  { label: '1h', minutes: 60 },
  { label: '2h', minutes: 120 },
  { label: '8h', minutes: 480 },
];

interface Usage {
  downBytes: number;
  upBytes: number;
  series: Array<{ t: number; down: number; up: number }>;
}

function path(points: number[], max: number): string {
  if (points.length < 2) return '';
  const stepX = W / (points.length - 1);
  return points
    .map((v, i) => `${i === 0 ? 'M' : 'L'} ${(i * stepX).toFixed(1)} ${(H - (v / max) * H).toFixed(1)}`)
    .join(' ');
}

export function WanChart({ data }: Props) {
  const [minutes, setMinutes] = useState(60);
  const [usage, setUsage] = useState<Usage | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchUsage = async () => {
      try {
        const res = await fetch(`/api/usage?minutes=${minutes}`);
        if (!res.ok) return;
        const u = await res.json();
        if (!cancelled) setUsage(u);
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
  }, [minutes]);

  // Live rate from the rolling buffer (instant); usage totals from the window.
  const last = data[data.length - 1];
  const liveDown = formatBitrate(last?.down ?? 0);
  const liveUp = formatBitrate(last?.up ?? 0);

  const series = usage?.series ?? [];
  const downs = series.map(d => d.down);
  const ups = series.map(d => d.up);
  const max = Math.max(1, ...downs, ...ups) * 1.15;

  return (
    <div className="wan glass">
      <div className="wan-head">
        <span className="wan-title">Data usage</span>
        <select
          className="wan-window"
          value={minutes}
          onChange={e => setMinutes(Number(e.target.value))}
        >
          {WINDOWS.map(w => (
            <option key={w.minutes} value={w.minutes}>last {w.label}</option>
          ))}
        </select>
      </div>

      <div className="wan-totals">
        <div className="wan-total">
          <span className="wan-total-cap"><span className="wan-dot down" />Downloaded</span>
          <span className="wan-total-val tabular">{usage ? formatBytes(usage.downBytes) : '—'}</span>
        </div>
        <div className="wan-total">
          <span className="wan-total-cap"><span className="wan-dot up" />Uploaded</span>
          <span className="wan-total-val tabular">{usage ? formatBytes(usage.upBytes) : '—'}</span>
        </div>
      </div>

      <svg className="wan-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="WAN throughput trend">
        {downs.length > 1 && (
          <>
            <path d={`${path(downs, max)} L ${W} ${H} L 0 ${H} Z`} fill="rgba(93,210,240,0.10)" stroke="none" />
            <path d={path(downs, max)} fill="none" stroke="var(--accent-down)" strokeWidth="1.5" strokeLinejoin="round" />
            <path d={path(ups, max)} fill="none" stroke="var(--accent-up)" strokeWidth="1.5" strokeLinejoin="round" />
          </>
        )}
      </svg>

      <div className="wan-live">
        <span>now</span>
        <span className="tabular">↓ {liveDown.value} {liveDown.unit}</span>
        <span className="tabular">↑ {liveUp.value} {liveUp.unit}</span>
      </div>
    </div>
  );
}
