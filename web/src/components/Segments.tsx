import { NetworkSnapshot } from '../types';
import { vlanColor } from '../utils/vlan';
import { formatBitrateStr } from '../utils/format';
import './Segments.css';

interface Props {
  snapshot: NetworkSnapshot | null;
}

interface Seg {
  vlan: number;
  name: string;
  clients: number;
  rate: number; // bits/sec
}

export function Segments({ snapshot }: Props) {
  const byVlan = new Map<number, Seg>();
  for (const d of snapshot?.devices ?? []) {
    if (d.type !== 'client' || d.vlanId === undefined) continue;
    let s = byVlan.get(d.vlanId);
    if (!s) {
      s = { vlan: d.vlanId, name: d.network || `VLAN ${d.vlanId}`, clients: 0, rate: 0 };
      byVlan.set(d.vlanId, s);
    }
    s.clients++;
    s.rate += (d.txBps || 0) + (d.rxBps || 0);
  }
  const segs = [...byVlan.values()].sort((a, b) => b.rate - a.rate || b.clients - a.clients);
  if (segs.length === 0) return null;
  const maxRate = Math.max(1, ...segs.map(s => s.rate));

  return (
    <div className="segments glass">
      <div className="segments-head">
        <span className="segments-title">Segments</span>
        <span className="segments-sub">{segs.length} VLANs</span>
      </div>
      <ul className="segments-list">
        {segs.map(s => (
          <li className="segment" key={s.vlan}>
            <span className="segment-dot" style={{ background: vlanColor(s.vlan) }} />
            <div className="segment-body">
              <div className="segment-row">
                <span className="segment-name">{s.name}</span>
                <span className="segment-count tabular">{s.clients}</span>
              </div>
              <div className="segment-bar">
                <div
                  className="segment-bar-fill"
                  style={{ width: `${Math.max(3, (s.rate / maxRate) * 100)}%`, background: vlanColor(s.vlan) }}
                />
              </div>
            </div>
            <span className="segment-rate tabular">{formatBitrateStr(s.rate)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
