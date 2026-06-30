import { useEffect, useRef, useState } from 'react';
import { NetworkSnapshot } from '../types';
import {
  ReactorEngine,
  ReactorTelemetry,
  DEFAULT_REACTOR_OPTIONS,
  fmtBpsShort,
  fmtBytes,
} from '../utils/reactor/engine';

interface Props {
  snapshot: NetworkSnapshot | null;
  onClose: () => void;
}

const mono = "'JetBrains Mono',monospace";

function uptime(ms: number): string {
  const hrs = Math.floor(ms / 3600000);
  const mins = Math.floor(ms / 60000) % 60;
  return `${hrs}h ${String(mins).padStart(2, '0')}m`;
}

/**
 * Full-screen "Reactor Overview" — a faithful canvas port of the design, driven
 * by live device data. Toggled from the dashboard; Esc or the exit button returns.
 */
export function ReactorView({ snapshot, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<ReactorEngine | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [tel, setTel] = useState<ReactorTelemetry | null>(null);

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

  const spot = tel?.spotlight ?? null;

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
          <Hud label="▼ DOWN" labelColor="#5a93b8" value={tel ? fmtBpsShort(tel.downBps) + 'bps' : '—'} color="#7fdcff" />
          <Hud label="▲ UP" labelColor="#b8902f" value={tel ? fmtBpsShort(tel.upBps) + 'bps' : '—'} color="#f5c969" />
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
          backdropFilter: 'blur(10px)',
        }}
        title="Exit Reactor (Esc)"
      >
        ✕ Exit
      </button>

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
          backdropFilter: 'blur(16px)',
          boxShadow: '0 24px 60px -24px rgba(0,0,0,0.9)',
          pointerEvents: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontFamily: mono, fontSize: 11, letterSpacing: '0.24em', color: '#7a8498' }}>TOP TALKER</div>
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
            {spot ? `${spot.seg.toUpperCase()} · ${spot.conn === 'wifi' ? 'WiFi' : 'Wired'}` : '—'}
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
    </div>
  );
}

function Hud({ label, labelColor, value, color }: { label: string; labelColor: string; value: string; color: string }) {
  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{ fontFamily: mono, fontSize: 11, letterSpacing: '0.18em', color: labelColor }}>{label}</div>
      <div style={{ fontFamily: mono, fontSize: 24, fontWeight: 600, color, lineHeight: 1.1 }}>{value}</div>
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
