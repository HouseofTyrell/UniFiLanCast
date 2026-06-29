import { NetworkSnapshot, DeviceType } from '../types';
import { computeStats } from '../utils/stats';
import { formatBitrateStr } from '../utils/format';
import './TopTalkers.css';

const TYPE_COLOR: Record<DeviceType, string> = {
  gateway: 'var(--type-gateway)',
  switch: 'var(--type-switch)',
  ap: 'var(--type-ap)',
  client: 'var(--type-client)',
  server: 'var(--type-client)',
  unknown: 'var(--text-dim)',
};

const TYPE_ICON: Record<DeviceType, string> = {
  gateway: '⊙',
  switch: '⧉',
  ap: '📡',
  client: '●',
  server: '▤',
  unknown: '?',
};

interface Props {
  snapshot: NetworkSnapshot | null;
  onSelect?: (id: string) => void;
}

export function TopTalkers({ snapshot, onSelect }: Props) {
  const stats = computeStats(snapshot);
  const talkers = stats.topTalkers;
  const max = talkers.length > 0 ? talkers[0].rate : 1;

  return (
    <div className="talkers glass">
      <div className="talkers-header">
        <span className="talkers-title">Top talkers</span>
        <span className="talkers-total tabular">{formatBitrateStr(stats.totalThroughput)}</span>
      </div>

      {talkers.length === 0 ? (
        <div className="talkers-empty">No active traffic</div>
      ) : (
        <ul className="talkers-list">
          {talkers.map(t => (
            <li
              key={t.device.id}
              className="talker"
              onClick={() => onSelect?.(t.device.id)}
              role={onSelect ? 'button' : undefined}
            >
              <span className="talker-icon" style={{ color: TYPE_COLOR[t.device.type] }}>
                {TYPE_ICON[t.device.type]}
              </span>
              <div className="talker-body">
                <div className="talker-row">
                  <span className="talker-name">{t.device.name}</span>
                  <span className="talker-rate tabular">{formatBitrateStr(t.rate)}</span>
                </div>
                <div className="talker-bar">
                  <div
                    className="talker-bar-fill"
                    style={{
                      width: `${Math.max(3, (t.rate / max) * 100)}%`,
                      background: TYPE_COLOR[t.device.type],
                    }}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
