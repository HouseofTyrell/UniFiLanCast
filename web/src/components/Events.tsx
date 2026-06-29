import { NetworkEvent } from '../types';
import './Events.css';

interface Props {
  events: NetworkEvent[];
}

const ICON: Record<string, string> = {
  new_device: '✦',
  offline: '○',
  device_reconnect: '●',
  latency_spike: '⚡',
  wan_issue: '▲',
};

function ago(ts: number): string {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

export function Events({ events }: Props) {
  return (
    <div className="events glass">
      <div className="events-head">
        <span className="events-title">Live events</span>
        <span className="events-count">{events.length}</span>
      </div>
      {events.length === 0 ? (
        <div className="events-empty">Watching for changes…</div>
      ) : (
        <ul className="events-list">
          {events.slice(0, 7).map((e, i) => (
            <li className={`event sev-${e.severity}`} key={`${e.ts}-${i}`}>
              <span className="event-icon">{ICON[e.type] || '·'}</span>
              <span className="event-msg">{e.message}</span>
              <span className="event-ago tabular">{ago(e.ts)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
