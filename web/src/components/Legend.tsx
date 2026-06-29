import { NetworkSnapshot } from '../types';
import { ColorMode, vlanColor } from '../utils/vlan';
import './Legend.css';

const WEATHER = [
  { key: 'down', glyph: '→', color: 'var(--accent-down)', label: 'Download', desc: 'flow in' },
  { key: 'up', glyph: '←', color: 'var(--accent-up)', label: 'Upload', desc: 'flow out' },
  { key: 'heat', glyph: '●', color: 'var(--type-gateway)', label: 'Heat', desc: 'device load' },
  { key: 'fog', glyph: '◐', color: 'var(--text-dim)', label: 'Fog', desc: 'offline / loss' },
  { key: 'lightning', glyph: '⚡', color: 'var(--accent-warn)', label: 'Lightning', desc: 'latency spike' },
];

const TYPES = [
  { color: 'var(--type-gateway)', label: 'Gateway' },
  { color: 'var(--type-switch)', label: 'Switch' },
  { color: 'var(--type-ap)', label: 'Access point' },
  { color: 'var(--type-client)', label: 'Client' },
];

interface Props {
  snapshot: NetworkSnapshot | null;
  colorMode: ColorMode;
  onColorModeChange: (mode: ColorMode) => void;
}

export function Legend({ snapshot, colorMode, onColorModeChange }: Props) {
  // Distinct VLANs present among clients.
  const vlans = new Map<number, string>();
  for (const d of snapshot?.devices ?? []) {
    if (d.type === 'client' && d.vlanId !== undefined && !vlans.has(d.vlanId)) {
      vlans.set(d.vlanId, d.network || `VLAN ${d.vlanId}`);
    }
  }
  const vlanList = [...vlans.entries()].sort((a, b) => a[0] - b[0]);

  return (
    <div className="legend glass">
      <div className="legend-toggle">
        <span className="legend-toggle-label">Color by</span>
        <div className="legend-seg">
          <button
            className={colorMode === 'type' ? 'on' : ''}
            onClick={() => onColorModeChange('type')}
          >
            Type
          </button>
          <button
            className={colorMode === 'vlan' ? 'on' : ''}
            onClick={() => onColorModeChange('vlan')}
          >
            VLAN
          </button>
        </div>
      </div>

      <div className="legend-swatches">
        {colorMode === 'type'
          ? TYPES.map(t => (
              <div className="legend-row" key={t.label}>
                <span className="legend-swatch" style={{ background: t.color }} />
                <span className="legend-label">{t.label}</span>
              </div>
            ))
          : vlanList.length === 0
            ? <div className="legend-empty">No VLAN data</div>
            : vlanList.map(([id, name]) => (
                <div className="legend-row" key={id}>
                  <span className="legend-swatch" style={{ background: vlanColor(id) }} />
                  <span className="legend-label">{name}</span>
                  <span className="legend-desc">VLAN {id}</span>
                </div>
              ))}
      </div>

      <div className="legend-weather">
        {WEATHER.map(it => (
          <div className="legend-row" key={it.key}>
            <span className="legend-glyph" style={{ color: it.color }}>{it.glyph}</span>
            <span className="legend-label">{it.label}</span>
            <span className="legend-desc">{it.desc}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
