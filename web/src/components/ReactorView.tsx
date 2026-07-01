import { useEffect, useRef, useState } from 'react';
import { NetworkSnapshot } from '../types';
import { useDeviceUsages } from '../hooks/useDeviceUsages';
import { WanPoint } from '../hooks/useRollingData';
import { IDLE_BPS } from '../utils/format';
import { Sparkline } from './Sparkline';
import {
  ReactorEngine,
  ReactorTelemetry,
  ReactorOptions,
  DEFAULT_REACTOR_OPTIONS,
  fmtBpsShort,
  fmtBytes,
} from '../utils/reactor/engine';

const WINDOWS: Array<{ label: string; minutes: number }> = [
  { label: '5m', minutes: 5 },
  { label: '15m', minutes: 15 },
  { label: '30m', minutes: 30 },
  { label: '1h', minutes: 60 },
  { label: '2h', minutes: 120 },
  { label: '8h', minutes: 480 },
];

interface Props {
  snapshot: NetworkSnapshot | null;
  history?: WanPoint[];
  onClose: () => void;
}

const SPARK_POINTS = 30; // ~2.5 min of recent WAN throughput at 5s cadence

const mono = "'JetBrains Mono',monospace";

/** HUD rate readout: real value, or "Idle" when essentially nothing is flowing. */
function hudRate(bps: number | undefined): string {
  if (bps == null) return '—';
  return bps < IDLE_BPS ? 'Idle' : fmtBpsShort(bps) + 'bps';
}

function uptime(ms: number): string {
  const hrs = Math.floor(ms / 3600000);
  const mins = Math.floor(ms / 60000) % 60;
  return `${hrs}h ${String(mins).padStart(2, '0')}m`;
}

/**
 * Full-screen "Reactor Overview" — a faithful canvas port of the design, driven
 * by live device data. Toggled from the dashboard; Esc or the exit button returns.
 */
export function ReactorView({ snapshot, history, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<ReactorEngine | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [tel, setTel] = useState<ReactorTelemetry | null>(null);
  const [opts, setOpts] = useState<ReactorOptions>(DEFAULT_REACTOR_OPTIONS);
  const [showControls, setShowControls] = useState(false);
  const [minutes, setMinutes] = useState(60);
  const deviceUsage = useDeviceUsages(minutes);

  const setOpt = (k: keyof ReactorOptions, v: number | boolean) =>
    setOpts(o => ({ ...o, [k]: v }));
  // backdrop-filter blur re-blurs the animated canvas every compositor frame at
  // the display's refresh rate — a large, fixed GPU cost. Skip it in low power.
  const glassBlur = (px: number) => (opts.powerMode === 'full' ? `blur(${px}px)` : undefined);
  const toggleFilter = (key: string) =>
    engineRef.current?.setFilter(tel?.filterSeg === key ? null : key);

  const canvasXY = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onMove = (e: React.MouseEvent) => {
    const { x, y } = canvasXY(e);
    const hit = engineRef.current?.hover(x, y);
    if (canvasRef.current) canvasRef.current.style.cursor = hit ? 'pointer' : 'default';
  };
  const onClick = (e: React.MouseEvent) => {
    const { x, y } = canvasXY(e);
    engineRef.current?.click(x, y);
  };

  const gatewayName =
    snapshot?.devices.find(d => d.type === 'gateway')?.name || 'Network';

  // Engine lifecycle — mount ONCE (no unstable deps, or it recreates the engine
  // on every parent render and loses its accumulated device state).
  useEffect(() => {
    const engine = new ReactorEngine();
    engineRef.current = engine;
    engine.setOptions(DEFAULT_REACTOR_OPTIONS);
    engine.setTelemetry(setTel);
    if (canvasRef.current) engine.attach(canvasRef.current);
    engine.start();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      engine.stop();
      engineRef.current = null;
    };
  }, []);

  // Feed live devices to the engine on every snapshot.
  useEffect(() => {
    if (snapshot) engineRef.current?.setDevices(snapshot.devices);
  }, [snapshot]);

  // Push control changes to the engine.
  useEffect(() => {
    engineRef.current?.setOptions(opts);
  }, [opts]);

  // Feed the windowed per-device usage (data used over the selected period).
  useEffect(() => {
    engineRef.current?.setUsageWindow(deviceUsage);
  }, [deviceUsage]);

  const spot = tel?.spotlight ?? null;
  const pinned = !!spot?.pinned;
  const recent = (history ?? []).slice(-SPARK_POINTS);
  const downSeries = recent.map(p => p.down);
  const upSeries = recent.map(p => p.up);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: '#050607',
        fontFamily: "'Inter',system-ui,sans-serif",
        color: '#e7ecf7',
        zIndex: 200,
      }}
    >
      <style>{`
        @keyframes reactor-livepulse{0%,100%{opacity:1}50%{opacity:0.25}}
        @keyframes reactor-spotin{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
      `}</style>

      <canvas
        ref={canvasRef}
        onMouseMove={onMove}
        onClick={onClick}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
      />

      {/* TOP TOTALS STRIP */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 74,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 104px 0 28px',
          background:
            'linear-gradient(180deg,rgba(7,9,12,0.92) 0%,rgba(7,9,12,0.55) 70%,rgba(7,9,12,0) 100%)',
          pointerEvents: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div
            style={{
              width: 9,
              height: 9,
              borderRadius: '50%',
              background: '#46e6a0',
              boxShadow: '0 0 10px #46e6a0',
              animation: 'reactor-livepulse 2.4s ease-in-out infinite',
            }}
          />
          <div
            style={{
              fontFamily: mono,
              fontSize: 13,
              letterSpacing: '0.26em',
              textTransform: 'uppercase',
              color: '#8a94a6',
            }}
          >
            {gatewayName} · Reactor
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 30 }}>
          <Hud label="▼ DOWN" labelColor="#5a93b8" value={hudRate(tel?.downBps)} color={tel && tel.downBps < IDLE_BPS ? '#6c7689' : '#7fdcff'} series={downSeries} sparkColor="#7fdcff" />
          <Hud label="▲ UP" labelColor="#b8902f" value={hudRate(tel?.upBps)} color={tel && tel.upBps < IDLE_BPS ? '#6c7689' : '#f5c969'} series={upSeries} sparkColor="#f5c969" />
          <Divider />
          <Hud label="DEVICES" labelColor="#6c7689" value={tel ? String(tel.devices) : '—'} color="#e7ecf7" />
          <Hud label="VLANS" labelColor="#6c7689" value={tel ? String(tel.vlans) : '—'} color="#e7ecf7" />
          <Divider />
          <Hud label="UPTIME" labelColor="#6c7689" value={tel ? uptime(tel.uptimeMs) : '—'} color="#e7ecf7" />
        </div>
      </div>

      {/* EXIT */}
      <button
        onClick={onClose}
        style={{
          position: 'absolute',
          top: 18,
          right: 24,
          zIndex: 2,
          appearance: 'none',
          cursor: 'pointer',
          fontFamily: mono,
          fontSize: 11,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: '#8a94a6',
          background: 'rgba(11,13,18,0.7)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 8,
          padding: '6px 12px',
          backdropFilter: glassBlur(10),
        }}
        title="Exit Reactor (Esc)"
      >
        ✕ Exit
      </button>

      {/* DATA-USED WINDOW */}
      <div
        style={{
          position: 'absolute',
          left: 28,
          top: 84,
          zIndex: 2,
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          background: 'rgba(11,13,18,0.7)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 9,
          padding: '6px 8px 6px 11px',
          backdropFilter: glassBlur(10),
        }}
      >
        <span style={{ fontFamily: mono, fontSize: 10.5, letterSpacing: '0.16em', color: '#7a8498' }}>
          DATA USED
        </span>
        <select
          value={minutes}
          onChange={e => setMinutes(Number(e.target.value))}
          style={{
            appearance: 'none',
            cursor: 'pointer',
            fontFamily: mono,
            fontSize: 11,
            fontWeight: 600,
            color: '#e7ecf7',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.14)',
            borderRadius: 6,
            padding: '3px 8px',
          }}
        >
          {WINDOWS.map(w => (
            <option key={w.minutes} value={w.minutes} style={{ background: '#0b0d12' }}>
              last {w.label}
            </option>
          ))}
        </select>
      </div>

      {/* TOP TALKER SPOTLIGHT */}
      <div
        style={{
          position: 'absolute',
          left: 28,
          bottom: 28,
          width: 286,
          background: 'rgba(11,13,18,0.82)',
          border: '1px solid rgba(255,255,255,0.09)',
          borderRadius: 16,
          padding: '16px 18px 17px',
          backdropFilter: glassBlur(16),
          boxShadow: '0 24px 60px -24px rgba(0,0,0,0.9)',
          pointerEvents: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div
            style={{
              fontFamily: mono,
              fontSize: 11,
              letterSpacing: '0.24em',
              color: pinned ? spot?.segColor ?? '#7a8498' : '#7a8498',
            }}
          >
            {pinned ? 'PINNED' : 'TOP TALKER'}
          </div>
          {pinned ? (
            <button
              onClick={() => engineRef.current?.clearSelection()}
              style={{
                pointerEvents: 'auto',
                appearance: 'none',
                cursor: 'pointer',
                background: 'transparent',
                border: 'none',
                color: '#7a8498',
                fontFamily: mono,
                fontSize: 12,
                padding: 0,
              }}
              title="Release pin"
            >
              ✕
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 5 }}>
              {Array.from({ length: tel?.spotCount ?? 0 }).map((_, i) => {
                const active = i === (tel?.spotIndex ?? -1);
                return (
                  <span
                    key={i}
                    style={{
                      width: active ? 14 : 5,
                      height: 5,
                      borderRadius: 3,
                      background: active ? spot?.segColor ?? '#5dd2f0' : 'rgba(255,255,255,0.2)',
                      transition: 'all .3s',
                    }}
                  />
                );
              })}
            </div>
          )}
        </div>
        <div key={spot?.id} style={{ animation: 'reactor-spotin 0.4s ease' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 3 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: spot?.segColor ?? '#5dd2f0', flex: 'none' }} />
            <div
              style={{
                fontSize: 19,
                fontWeight: 600,
                letterSpacing: '-0.01em',
                color: '#f4f7fc',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {spot?.name ?? '—'}
            </div>
          </div>
          <div style={{ fontFamily: mono, fontSize: 11, color: '#6c7689', marginBottom: 14, paddingLeft: 19 }}>
            {spot
              ? spot.type === 'client'
                ? `${spot.segLabel.toUpperCase()} · ${spot.conn === 'wifi' ? 'WiFi' : 'Wired'}${spot.online ? '' : ' · OFFLINE'}`
                : `${spot.type.toUpperCase()}${spot.parent ? ` · ↑ ${spot.parent}` : ''}`
              : '—'}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <SpotStat label="▼ DOWN" labelColor="#5a93b8" bg="rgba(125,220,255,0.08)" border="rgba(125,220,255,0.16)" color="#7fdcff" value={spot ? fmtBpsShort(spot.downBps) : '—'} />
            <SpotStat label="▲ UP" labelColor="#b8902f" bg="rgba(245,201,105,0.07)" border="rgba(245,201,105,0.16)" color="#f5c969" value={spot ? fmtBpsShort(spot.upBps) : '—'} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 11, fontFamily: mono, fontSize: 11 }}>
            <span style={{ color: '#6c7689' }}>
              USED <span style={{ color: '#aeb8cc' }}>{spot ? fmtBytes(spot.usedBytes) : '—'}</span>
            </span>
            <span style={{ color: '#6c7689', visibility: spot?.conn === 'wifi' ? 'visible' : 'hidden' }}>
              SIGNAL <span style={{ color: '#aeb8cc' }}>{spot?.signal ? `${spot.signal} dBm` : '—'}</span>
            </span>
          </div>
        </div>
      </div>

      {/* CONTROLS */}
      <button
        onClick={() => setShowControls(s => !s)}
        style={{
          position: 'absolute',
          top: 52,
          right: 24,
          zIndex: 2,
          appearance: 'none',
          cursor: 'pointer',
          fontFamily: mono,
          fontSize: 11,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: showControls ? '#ffce7a' : '#8a94a6',
          background: 'rgba(11,13,18,0.7)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 8,
          padding: '5px 11px',
          backdropFilter: glassBlur(10),
        }}
      >
        ⚙ Controls
      </button>
      {showControls && (
        <div
          style={{
            position: 'absolute',
            top: 84,
            right: 24,
            zIndex: 2,
            width: 224,
            background: 'rgba(11,13,18,0.9)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 12,
            padding: '14px 16px',
            backdropFilter: glassBlur(16),
            boxShadow: '0 24px 60px -24px rgba(0,0,0,0.9)',
          }}
        >
          <Slider label="Motion" value={opts.motion} min={0} max={2.5} step={0.05} onChange={v => setOpt('motion', v)} />
          <Slider label="Speed" value={opts.speed} min={0.25} max={2} step={0.05} onChange={v => setOpt('speed', v)} />
          <Slider label="Intensity" value={opts.intensity} min={0.4} max={1.8} step={0.05} onChange={v => setOpt('intensity', v)} />
          <Slider label="Spotlight dwell" value={opts.spotlightDwell} min={2} max={12} step={0.5} unit="s" onChange={v => setOpt('spotlightDwell', v)} />
          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, fontFamily: mono, fontSize: 11, color: '#aeb8cc', cursor: 'pointer' }}>
            Node readouts
            <input type="checkbox" checked={opts.showReadouts} onChange={e => setOpt('showReadouts', e.target.checked)} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, fontFamily: mono, fontSize: 11, color: '#aeb8cc', cursor: 'pointer' }} title="Show nodes under 1 Mbps at full brightness instead of dimming them">
            Show &lt; 1 Mbps
            <input type="checkbox" checked={opts.showQuiet} onChange={e => setOpt('showQuiet', e.target.checked)} />
          </label>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, fontFamily: mono, fontSize: 11, color: '#aeb8cc' }} title="Power: Eco repaints only on updates (idle GPU); Low is ~12fps; Full has glow + blur (highest GPU).">
            <span>Power</span>
            <select
              value={opts.powerMode}
              onChange={e => setOpts(o => ({ ...o, powerMode: e.target.value as ReactorOptions['powerMode'] }))}
              style={{
                appearance: 'none',
                cursor: 'pointer',
                fontFamily: mono,
                fontSize: 11,
                fontWeight: 600,
                color: '#e7ecf7',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.14)',
                borderRadius: 6,
                padding: '3px 8px',
              }}
            >
              <option value="eco" style={{ background: '#0b0d12' }}>Eco (lowest)</option>
              <option value="low" style={{ background: '#0b0d12' }}>Low</option>
              <option value="full" style={{ background: '#0b0d12' }}>Full</option>
            </select>
          </div>
        </div>
      )}

      {/* VLAN LEGEND + FILTER */}
      <div
        style={{
          position: 'absolute',
          right: 28,
          bottom: 28,
          zIndex: 2,
          width: 214,
          background: 'rgba(11,13,18,0.82)',
          border: '1px solid rgba(255,255,255,0.09)',
          borderRadius: 14,
          padding: '13px 14px',
          backdropFilter: glassBlur(16),
          boxShadow: '0 24px 60px -24px rgba(0,0,0,0.9)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 9 }}>
          <span style={{ fontFamily: mono, fontSize: 11, letterSpacing: '0.22em', color: '#7a8498' }}>SEGMENTS</span>
          {tel?.filterSeg && (
            <button
              onClick={() => engineRef.current?.setFilter(null)}
              style={{ appearance: 'none', cursor: 'pointer', background: 'transparent', border: 'none', color: '#7a8498', fontFamily: mono, fontSize: 10, padding: 0 }}
              title="Clear filter"
            >
              CLEAR
            </button>
          )}
        </div>
        {(tel?.segments ?? []).map(s => {
          const active = tel?.filterSeg === s.key;
          const dimmed = !!tel?.filterSeg && !active;
          // Active segment shows its full access breakdown; otherwise the top 2.
          const uplinks = active ? s.uplinks : s.uplinks.slice(0, 2);
          const moreCount = active ? 0 : s.uplinks.length - uplinks.length;
          return (
            <div key={s.key} style={{ marginBottom: 4, opacity: dimmed ? 0.45 : 1, transition: 'opacity .2s' }}>
              <button
                onClick={() => toggleFilter(s.key)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  width: '100%',
                  appearance: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  background: active ? 'rgba(255,255,255,0.06)' : 'transparent',
                  border: '1px solid ' + (active ? 'rgba(255,255,255,0.16)' : 'transparent'),
                  borderRadius: 8,
                  padding: '5px 7px',
                  transition: 'background .2s',
                }}
                title={`Isolate ${s.label}`}
              >
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: s.color, flex: 'none', boxShadow: `0 0 8px ${s.color}` }} />
                <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600, color: '#e7ecf7' }}>{s.label}</span>
                <span style={{ fontFamily: mono, fontSize: 11, color: '#8090a4' }}>{s.count}</span>
              </button>
              {uplinks.length > 0 && (
                <div style={{ padding: '2px 7px 2px 25px' }}>
                  {uplinks.map(u => (
                    <div
                      key={u.name}
                      style={{ display: 'flex', gap: 6, fontFamily: mono, fontSize: 10, color: '#727d92', lineHeight: 1.5 }}
                      title={`${u.count} on ${u.name}`}
                    >
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        ↳ {u.name}
                      </span>
                      <span style={{ color: '#8b96ab' }}>{u.count}</span>
                    </div>
                  ))}
                  {moreCount > 0 && (
                    <div style={{ fontFamily: mono, fontSize: 10, color: '#5a6373', paddingLeft: 14 }}>
                      +{moreCount} more
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {!!tel?.offline && (
          <div style={{ marginTop: 6, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.07)', fontFamily: mono, fontSize: 11, color: '#6c7689' }}>
            <span style={{ color: '#5a6373' }}>○</span> {tel.offline} offline
          </div>
        )}
      </div>
    </div>
  );
}

function Slider({ label, value, min, max, step, unit = 'x', onChange }: { label: string; value: number; min: number; max: number; step: number; unit?: string; onChange: (v: number) => void }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: mono, fontSize: 10.5, color: '#8a94a6', marginBottom: 3 }}>
        <span>{label}</span>
        <span style={{ color: '#aeb8cc' }}>{value.toFixed(2)}{unit}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: '#f5a623' }}
      />
    </div>
  );
}

function Hud({
  label,
  labelColor,
  value,
  color,
  series,
  sparkColor,
}: {
  label: string;
  labelColor: string;
  value: string;
  color: string;
  series?: number[];
  sparkColor?: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
      <div style={{ fontFamily: mono, fontSize: 11, letterSpacing: '0.18em', color: labelColor }}>{label}</div>
      <div style={{ fontFamily: mono, fontSize: 24, fontWeight: 600, color, lineHeight: 1.1 }}>{value}</div>
      {series && series.length > 1 && (
        <Sparkline values={series} color={sparkColor ?? color} width={64} height={16} />
      )}
    </div>
  );
}
function Divider() {
  return <div style={{ width: 1, height: 34, background: 'rgba(255,255,255,0.1)' }} />;
}
function SpotStat(p: { label: string; labelColor: string; bg: string; border: string; color: string; value: string }) {
  return (
    <div style={{ flex: 1, background: p.bg, border: `1px solid ${p.border}`, borderRadius: 9, padding: '8px 10px' }}>
      <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: '0.14em', color: p.labelColor, marginBottom: 2 }}>{p.label}</div>
      <div style={{ fontFamily: mono, fontSize: 18, fontWeight: 600, color: p.color }}>{p.value}</div>
    </div>
  );
}
