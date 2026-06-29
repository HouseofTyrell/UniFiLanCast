import { WanPoint } from '../hooks/useRollingData';
import { formatBitrate } from '../utils/format';
import './WanChart.css';

interface Props {
  data: WanPoint[];
}

const W = 248;
const H = 56;

function path(points: number[], max: number): string {
  if (points.length < 2) return '';
  const stepX = W / (points.length - 1);
  return points
    .map((v, i) => `${i === 0 ? 'M' : 'L'} ${(i * stepX).toFixed(1)} ${(H - (v / max) * H).toFixed(1)}`)
    .join(' ');
}

export function WanChart({ data }: Props) {
  const downs = data.map(d => d.down);
  const ups = data.map(d => d.up);
  const max = Math.max(1, ...downs, ...ups) * 1.15;
  const lastDown = downs[downs.length - 1] ?? 0;
  const lastUp = ups[ups.length - 1] ?? 0;
  const dDown = formatBitrate(lastDown);
  const dUp = formatBitrate(lastUp);

  return (
    <div className="wan glass">
      <div className="wan-head">
        <span className="wan-title">WAN throughput</span>
      </div>
      <div className="wan-legend">
        <span className="wan-stat">
          <span className="wan-dot down" />↓ <b className="tabular">{dDown.value}</b>
          <span className="wan-unit">{dDown.unit}</span>
        </span>
        <span className="wan-stat">
          <span className="wan-dot up" />↑ <b className="tabular">{dUp.value}</b>
          <span className="wan-unit">{dUp.unit}</span>
        </span>
      </div>
      <svg className="wan-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="WAN throughput trend">
        <path d={`${path(downs, max)} L ${W} ${H} L 0 ${H} Z`} fill="rgba(93,210,240,0.10)" stroke="none" />
        <path d={path(downs, max)} fill="none" stroke="var(--accent-down)" strokeWidth="1.5" strokeLinejoin="round" />
        <path d={path(ups, max)} fill="none" stroke="var(--accent-up)" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
