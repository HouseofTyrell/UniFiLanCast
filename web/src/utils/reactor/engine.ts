import { Device } from '../../types';

// ── formatting (shared with the React chrome) ────────────────────────────────
export const fmtBps = (bps: number) => {
  if (bps >= 1e6) return (bps / 1e6).toFixed(bps >= 1e7 ? 0 : 1) + ' Mbps';
  if (bps >= 1e3) return (bps / 1e3).toFixed(0) + ' Kbps';
  return Math.max(0, Math.round(bps)) + ' bps';
};
export const fmtBpsShort = (bps: number) => {
  if (bps >= 1e6) return (bps / 1e6).toFixed(bps >= 1e7 ? 0 : 1) + 'M';
  if (bps >= 1e3) return (bps / 1e3).toFixed(0) + 'K';
  return Math.max(0, Math.round(bps)) + '';
};
export const fmtBytes = (b: number) => {
  if (b >= 1e9) return (b / 1e9).toFixed(1) + ' GB';
  if (b >= 1e6) return (b / 1e6).toFixed(0) + ' MB';
  if (b >= 1e3) return (b / 1e3).toFixed(0) + ' KB';
  return Math.round(b) + ' B';
};

const SEG_COLORS: Record<string, string> = { trusted: '#5dd2f0', iot: '#3fd9a6', default: '#f2b441' };
export const SEGS = [
  { key: 'trusted', label: 'Trusted', color: SEG_COLORS.trusted },
  { key: 'iot', label: 'IoT', color: SEG_COLORS.iot },
  { key: 'default', label: 'Default', color: SEG_COLORS.default },
];
export const segColor = (k: string) => SEG_COLORS[k] || '#8b92f2';

/** Map a live device's VLAN/network to one of the three reactor segments. */
function segOf(d: Device): string {
  const n = `${d.network || ''}`.toLowerCase();
  if (n.includes('trust')) return 'trusted';
  if (n.includes('iot')) return 'iot';
  return 'default';
}

export interface ReactorOptions {
  motion: number;
  speed: number;
  intensity: number;
  spotlightDwell: number;
  showReadouts: boolean;
}
export const DEFAULT_REACTOR_OPTIONS: ReactorOptions = {
  motion: 1,
  speed: 1,
  intensity: 1,
  spotlightDwell: 5,
  showReadouts: true,
};

interface RDev {
  id: string;
  name: string;
  type: Device['type'];
  parent?: string;
  conn: 'wired' | 'wifi';
  targetD: number;
  targetU: number;
  dBps: number;
  uBps: number;
  used: number; // bytes over the active window (or cumulative total as fallback)
  totalUsed: number; // cumulative session total (fallback)
  signal: number;
  seg: string;
  online: boolean;
  phase: number;
  dl: number;
  ul: number;
  act: number;
  _x?: number;
  _y?: number;
  _r?: number;
}

export interface ReactorSpotlight {
  id: string;
  name: string;
  seg: string;
  segLabel: string;
  segColor: string;
  type: string;
  conn: 'wired' | 'wifi';
  downBps: number;
  upBps: number;
  usedBytes: number;
  signal: number;
  online: boolean;
  parent?: string;
  pinned: boolean;
}

export interface ReactorTelemetry {
  downBps: number;
  upBps: number;
  devices: number;
  vlans: number;
  uptimeMs: number;
  spotIndex: number;
  spotCount: number;
  spotlight: ReactorSpotlight | null;
  segments: Array<{ key: string; label: string; color: string; count: number; online: number }>;
  offline: number;
  filterSeg: string | null;
}

const APP_START = Date.now();

/**
 * Faithful canvas port of the "Reactor Overview" design: a radial reactor with
 * the gateway as core, infra on a spine ring, VLANs as buses, and clients on
 * two arcs per sector — driven by live device data instead of the mock set.
 */
export class ReactorEngine {
  private canvas?: HTMLCanvasElement;
  private ctx?: CanvasRenderingContext2D;
  private dpr = Math.min(2, window.devicePixelRatio || 1);
  private CW = 0;
  private CH = 0;
  private raf?: number;
  private watch?: ReturnType<typeof setInterval>;
  private clock = 0;
  private last = 0;
  private lastFrameTs?: number;
  private lastHud = -1;

  private opts: ReactorOptions = { ...DEFAULT_REACTOR_OPTIONS };
  private devices: RDev[] = [];
  private byId: Record<string, RDev> = {};
  private clients: RDev[] = [];
  private infra: RDev[] = [];
  private gw?: RDev;
  private maxClientUsed = 1;
  private dust: Array<{ x: number; y: number; a: number; r: number; d: number; p: number }> = [];

  private spotList: RDev[] = [];
  private spotIdx = 0;
  private spotT = 0;
  private spotDev?: RDev;

  // Interaction state.
  private hoveredId: string | null = null;
  private selectedId: string | null = null;
  private filterSeg: string | null = null;
  // Per-device data used over the selected window (bytes); when empty, `used`
  // falls back to the cumulative session total.
  private usageWindow: Record<string, { down: number; up: number }> = {};
  // Clickable node hit-boxes, rebuilt each frame from the drawn positions.
  private hitBoxes: Array<{ id: string; x: number; y: number; r: number; kind: 'device' | 'bus'; seg?: string }> = [];

  private onTelemetry?: (t: ReactorTelemetry) => void;

  private INT = 1;
  private MO = 1;
  private SHOW = true;

  constructor() {
    this.seedField();
  }

  setOptions(o: Partial<ReactorOptions>) {
    this.opts = { ...this.opts, ...o };
  }
  setTelemetry(cb: (t: ReactorTelemetry) => void) {
    this.onTelemetry = cb;
  }

  // ── interaction ──────────────────────────────────────────────────────────--
  private pick(x: number, y: number) {
    let best: (typeof this.hitBoxes)[number] | null = null;
    let bestD = Infinity;
    for (const b of this.hitBoxes) {
      const d = Math.hypot(x - b.x, y - b.y);
      const hit = Math.max(b.r, 10) + 3;
      if (d <= hit && d < bestD) {
        best = b;
        bestD = d;
      }
    }
    return best;
  }
  /** Hover at CSS coords; returns true if a node is under the cursor. */
  hover(x: number, y: number): boolean {
    const b = this.pick(x, y);
    this.hoveredId = b ? b.id : null;
    return !!b;
  }
  /** Click at CSS coords: pin a device's detail, or toggle a VLAN filter. */
  click(x: number, y: number) {
    const b = this.pick(x, y);
    if (!b) {
      this.selectedId = null;
      return;
    }
    if (b.kind === 'bus') {
      this.filterSeg = this.filterSeg === b.seg ? null : b.seg ?? null;
    } else {
      this.selectedId = this.selectedId === b.id ? null : b.id;
    }
    this.emitTelemetry();
  }
  setFilter(seg: string | null) {
    this.filterSeg = seg;
    this.emitTelemetry();
  }
  clearSelection() {
    this.selectedId = null;
    this.emitTelemetry();
  }

  // ── helpers ────────────────────────────────────────────────────────────────
  private hex = (h: string): [number, number, number] => {
    h = h.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  };
  private rgba = (h: string, a: number) => {
    const [r, g, b] = this.hex(h);
    return `rgba(${r},${g},${b},${a})`;
  };
  private mix = (h: string, t: number, a: number) => {
    const [r, g, b] = this.hex(h);
    const m = (c: number) => Math.round(c + (t - c) * a);
    return `rgb(${m(r)},${m(g)},${m(b)})`;
  };
  private lighten = (h: string, a: number) => this.mix(h, 255, a);
  private darken = (h: string, a: number) => this.mix(h, 0, a);
  private clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
  private hash = (s: string) => {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return ((h % 1000) / 1000) * Math.PI * 2;
  };
  private logLevel = (bps: number) => {
    if (bps <= 0) return 0;
    const lo = Math.log10(4e4),
      hi = Math.log10(1.2e8);
    return this.clamp((Math.log10(bps) - lo) / (hi - lo));
  };
  private colorOf = (d: RDev) => {
    if (d.type === 'gateway') return '#f5a623';
    if (d.type === 'ap') return '#46d6a0';
    if (d.type === 'switch') return '#4da8e8';
    return segColor(d.seg);
  };

  // ── data ─────────────────────────────────────────────────────────────────--
  /** Map the live snapshot devices into the reactor model (preserving smoothing). */
  setDevices(devices: Device[]) {
    const prev = this.byId;
    const mapped: RDev[] = devices.map(d => {
      const p = prev[d.id];
      return {
        id: d.id,
        name: d.name,
        type: d.type,
        parent: d.parentDeviceId,
        conn: d.wiredOrWifi === 'wired' ? 'wired' : 'wifi',
        targetD: Math.max(0, d.rxBps || 0),
        targetU: Math.max(0, d.txBps || 0),
        dBps: p ? p.dBps : Math.max(0, d.rxBps || 0),
        uBps: p ? p.uBps : Math.max(0, d.txBps || 0),
        totalUsed: (d.totalRxBytes || 0) + (d.totalTxBytes || 0),
        used: this.usedFor(d.id, (d.totalRxBytes || 0) + (d.totalTxBytes || 0)),
        signal: d.rssi ?? 0,
        seg: segOf(d),
        online: d.online !== false,
        phase: this.hash(d.id),
        dl: 0,
        ul: 0,
        act: 0,
        _x: p?._x,
        _y: p?._y,
      };
    });
    this.devices = mapped;
    this.byId = {};
    mapped.forEach(d => (this.byId[d.id] = d));
    this.gw = mapped.find(d => d.type === 'gateway');
    this.clients = mapped.filter(d => d.type === 'client');
    this.infra = mapped.filter(d => d.type === 'switch' || d.type === 'ap');
    this.maxClientUsed = Math.max(1, ...this.clients.map(c => c.used));
    this.refreshSpotList();
  }

  /** Data used (bytes) for a device: windowed if available, else the total. */
  private usedFor(id: string, totalUsed: number): number {
    const m = this.usageWindow;
    if (m && Object.keys(m).length > 0) {
      const u = m[id];
      return u ? (u.down || 0) + (u.up || 0) : 0;
    }
    return totalUsed;
  }

  /** Set the per-device windowed usage (bytes); recomputes `used` + sizing. */
  setUsageWindow(map: Record<string, { down: number; up: number }>) {
    this.usageWindow = map || {};
    for (const d of this.devices) d.used = this.usedFor(d.id, d.totalUsed);
    this.maxClientUsed = Math.max(1, ...this.clients.map(c => c.used));
  }

  private seedField() {
    let s = 2025;
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    this.dust = Array.from({ length: 140 }, () => ({
      x: rnd(),
      y: rnd(),
      a: 0.03 + rnd() * 0.06,
      r: 0.5 + rnd() * 1.1,
      d: rnd(),
      p: rnd() * 6.28,
    }));
  }
  private sizeFor(used: number, max: number, rmin: number, rmax: number) {
    if (used <= 0 || max <= 0) return rmin;
    const hi = Math.log10(max),
      lo = Math.log10(max * 0.0015);
    return rmin + this.clamp((Math.log10(used) - lo) / (hi - lo)) * (rmax - rmin);
  }

  private groups() {
    return SEGS.map(s => ({
      key: s.key,
      label: s.label,
      color: s.color,
      devices: this.clients.filter(c => c.seg === s.key),
    }));
  }
  private groupAgg(g: { devices: RDev[] }) {
    let d = 0,
      u = 0,
      used = 0,
      on = 0;
    for (const x of g.devices) {
      d += x.dBps;
      u += x.uBps;
      used += x.used;
      if (x.online) on++;
    }
    return { d, u, used, on, dl: this.logLevel(d), ul: this.logLevel(u) };
  }
  private gMaxUsed(G: Array<{ devices: RDev[] }>) {
    return Math.max(1, ...G.map(g => this.groupAgg(g).used));
  }

  private refreshSpotList() {
    this.spotList = [...this.clients]
      .filter(c => c.online)
      .sort((a, b) => b.dBps + b.uBps - (a.dBps + a.uBps))
      .slice(0, 6);
    if (this.spotIdx >= this.spotList.length) this.spotIdx = 0;
  }

  // ── lifecycle ───────────────────────────────────────────────────────────────
  attach(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }
  start() {
    this.last = performance.now();
    this.clock = 0;
    const tick = () => this.frame();
    this.raf = requestAnimationFrame(tick);
    this.watch = setInterval(() => {
      if (this.lastFrameTs === undefined || performance.now() - this.lastFrameTs > 200) this.frame();
    }, 200);
  }
  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.watch) clearInterval(this.watch);
    this.raf = undefined;
    this.watch = undefined;
  }

  private ensureCtx() {
    const c = this.canvas;
    if (!c) return null;
    const r = c.getBoundingClientRect();
    const cw = Math.max(640, Math.round(r.width)),
      ch = Math.max(360, Math.round(r.height));
    if (c !== this.canvas || cw !== this.CW || ch !== this.CH || !this.ctx) {
      this.CW = cw;
      this.CH = ch;
      c.width = cw * this.dpr;
      c.height = ch * this.dpr;
      this.ctx = c.getContext('2d') || undefined;
    }
    if (!this.ctx) return null;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    return this.ctx;
  }

  private frame() {
    const ts = performance.now();
    if (this.lastFrameTs !== undefined && ts - this.lastFrameTs < 6) {
      this.raf = requestAnimationFrame(() => this.frame());
      return;
    }
    this.lastFrameTs = ts;
    try {
      this.frameBody();
    } catch {
      /* keep the loop alive */
    }
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => this.frame());
  }

  private frameBody() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const sp = this.opts.speed ?? 1;
    this.clock += dt * sp;
    const t = this.clock;
    this.INT = this.opts.intensity ?? 1;
    this.MO = this.opts.motion ?? 1;
    this.SHOW = this.opts.showReadouts ?? true;

    this.updateRates(dt);

    this.spotT += dt;
    const dwell = this.opts.spotlightDwell ?? 5;
    // Rotation pauses while a node is pinned (clicked).
    if (this.spotList.length && !this.selectedId) {
      if (this.spotT >= dwell) {
        this.spotT = 0;
        this.spotIdx = (this.spotIdx + 1) % this.spotList.length;
        if (this.spotIdx === 0) this.refreshSpotList();
      }
    }
    if (Math.floor(t * 4) !== this.lastHud) {
      this.lastHud = Math.floor(t * 4);
      this.emitTelemetry();
    }
    const ctx = this.ensureCtx();
    if (!ctx) return;
    try {
      this.drawReactor(ctx, this.CW, this.CH, t);
    } catch {
      /* swallow draw errors */
    }
  }

  /** Ease live rates toward the latest snapshot value, then derive levels. */
  private updateRates(dt: number) {
    const k = this.clamp(dt * 3.5, 0, 1);
    for (const d of this.devices) {
      if (!d.online) {
        d.dBps = 0;
        d.uBps = 0;
        d.dl = 0;
        d.ul = 0;
        d.act = 0;
        continue;
      }
      d.dBps += (d.targetD - d.dBps) * k;
      d.uBps += (d.targetU - d.uBps) * k;
      d.dl = this.logLevel(d.dBps);
      d.ul = this.logLevel(d.uBps);
      d.act = Math.max(d.dl, d.ul);
    }
  }

  private emitTelemetry() {
    if (!this.onTelemetry) return;
    let d = 0,
      u = 0,
      on = 0,
      offline = 0;
    for (const c of this.clients) {
      d += c.dBps;
      u += c.uBps;
      if (c.online) on++;
      else offline++;
    }
    for (const _ of this.infra) on++;
    if (this.gw) on++;

    // Pinned selection wins; otherwise the rotating spotlight.
    const sel = this.selectedId ? this.byId[this.selectedId] : undefined;
    const sd = sel || this.spotList[this.spotIdx];
    this.spotDev = sd;
    const segLabelOf = (k: string) => SEGS.find(s => s.key === k)?.label || k;

    this.onTelemetry({
      downBps: d,
      upBps: u,
      devices: on,
      vlans: this.groups().filter(g => g.devices.length).length,
      uptimeMs: Date.now() - APP_START,
      spotIndex: this.spotIdx,
      spotCount: this.spotList.length,
      filterSeg: this.filterSeg,
      offline,
      segments: this.groups().map(g => {
        const a = this.groupAgg(g);
        return { key: g.key, label: g.label, color: g.color, count: g.devices.length, online: a.on };
      }),
      spotlight: sd
        ? {
            id: sd.id,
            name: sd.name,
            seg: sd.seg,
            segLabel: segLabelOf(sd.seg),
            segColor: segColor(sd.seg),
            type: sd.type,
            conn: sd.conn,
            downBps: sd.dBps,
            upBps: sd.uBps,
            usedBytes: sd.used,
            signal: sd.signal,
            online: sd.online,
            parent: sd.parent ? this.byId[sd.parent]?.name : undefined,
            pinned: !!sel,
          }
        : null,
    });
  }

  // ── drawing (ported) ─────────────────────────────────────────────────────--
  private node(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
    color: string,
    dl: number,
    ul: number,
    o: any = {}
  ) {
    const TAU = Math.PI * 2,
      INT = this.INT;
    r = Math.max(0.5, r || 0);
    dl = Math.max(0, dl || 0);
    ul = Math.max(0, ul || 0);
    const off = o.online === false;
    if (o.glow !== false && !off) {
      const heat = o.heat || 0;
      const gr = r * (2.0 + heat * 1.4) * (1 + 0.06 * Math.sin((o.t || 0) * 3 + x * 0.05));
      const str = this.clamp((0.1 + Math.max(dl, ul) * 0.5 + heat * 0.4) * INT, 0, 0.72);
      const g = ctx.createRadialGradient(x, y, r * 0.3, x, y, gr);
      g.addColorStop(0, this.rgba(o.glowColor || color, str));
      g.addColorStop(1, this.rgba(o.glowColor || color, 0));
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, gr, 0, TAU);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    if (off) {
      ctx.fillStyle = '#1c2129';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#39414f';
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      return;
    }
    const b = ctx.createRadialGradient(x - r * 0.32, y - r * 0.32, r * 0.1, x, y, r);
    b.addColorStop(0, this.lighten(color, 0.38));
    b.addColorStop(1, this.darken(color, 0.46));
    ctx.fillStyle = b;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.lineWidth = Math.max(1, r * 0.12);
    ctx.strokeStyle = this.lighten(color, 0.5);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.stroke();
    const ar = r + Math.max(4, r * 0.42);
    this.arc(ctx, x, y, ar, -Math.PI / 2, dl, '#5dd2f0');
    this.arc(ctx, x, y, ar, Math.PI / 2, ul, '#f2b441');
  }
  private arc(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    ar: number,
    center: number,
    lvl: number,
    col: string
  ) {
    ar = Math.max(0.5, ar || 0);
    lvl = Math.max(0, lvl || 0);
    ctx.lineCap = 'round';
    ctx.lineWidth = 2;
    ctx.strokeStyle = this.rgba(col, 0.1);
    ctx.beginPath();
    ctx.arc(x, y, ar, center - 0.39 * Math.PI, center + 0.39 * Math.PI);
    ctx.stroke();
    if (lvl <= 0.02) return;
    const span = lvl * Math.PI * 0.42;
    ctx.lineWidth = 2.6;
    ctx.strokeStyle = this.rgba(col, 0.3 + lvl * 0.6);
    ctx.shadowColor = col;
    ctx.shadowBlur = 9 * lvl * this.INT;
    ctx.beginPath();
    ctx.arc(x, y, ar, center - span, center + span);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  private labelName(ctx: CanvasRenderingContext2D, x: number, y: number, d: RDev, r: number, bright: boolean) {
    const ly = y + r + 7;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = '600 12px Inter,sans-serif';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(5,6,7,0.92)';
    ctx.strokeText(d.name, x, ly);
    ctx.fillStyle = d.online ? (bright ? '#f4f7fc' : '#cdd6e8') : '#5a6373';
    ctx.fillText(d.name, x, ly);
    if (this.SHOW && d.online) {
      ctx.font = '500 10.5px "JetBrains Mono",monospace';
      const tx = `↓${fmtBpsShort(d.dBps)} ↑${fmtBpsShort(d.uBps)}`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(5,6,7,0.92)';
      ctx.strokeText(tx, x, ly + 14);
      ctx.fillStyle = '#8090a4';
      ctx.fillText(tx, x, ly + 14);
    }
  }
  private conduit(
    ctx: CanvasRenderingContext2D,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    dl: number,
    ul: number,
    t: number,
    wd: number,
    off: boolean
  ) {
    ctx.strokeStyle = off ? 'rgba(80,90,110,0.06)' : 'rgba(120,140,180,0.12)';
    ctx.lineWidth = wd;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    if (off) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const packets = (lvl: number, col: string, dir: number) => {
      if (lvl < 0.05) return;
      const n = 2 + Math.round(lvl * 4);
      for (let i = 0; i < n; i++) {
        let f = (t * (0.25 + lvl * 0.7) * dir + i / n) % 1;
        if (f < 0) f += 1;
        const px = x1 + (x2 - x1) * f,
          py = y1 + (y2 - y1) * f;
        ctx.fillStyle = this.rgba(col, 0.7 * lvl + 0.2);
        ctx.shadowColor = col;
        ctx.shadowBlur = 6;
        ctx.fillRect(px - 1.4, py - 1.4, 3.2, 3.2);
        ctx.shadowBlur = 0;
      }
    };
    packets(dl, '#5dd2f0', 1);
    packets(ul, '#f2b441', -1);
    ctx.restore();
  }
  private reactorNode(ctx: CanvasRenderingContext2D, d: RDev, color: string, max: number, t: number) {
    const r = this.sizeFor(d.used, max, 3.5, 10);
    d._r = r;
    if (d.online) {
      const fill = this.clamp(
        (Math.log10(Math.max(1, d.used)) - Math.log10(max * 0.0015)) /
          (Math.log10(max) - Math.log10(max * 0.0015))
      );
      const gr = r + 5;
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.beginPath();
      ctx.arc(d._x!, d._y!, gr, 0, 6.28);
      ctx.stroke();
      ctx.strokeStyle = this.rgba(color, 0.8);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(d._x!, d._y!, gr, -Math.PI / 2, -Math.PI / 2 + fill * 6.28);
      ctx.stroke();
    }
    this.node(ctx, d._x!, d._y!, r, color, d.dl, d.ul, {
      t,
      heat: 0.1 + d.act * 0.3,
      glow: d.act > 0.05,
      online: d.online,
    });
  }
  private reactorBus(ctx: CanvasRenderingContext2D, g: any, t: number) {
    const r = 15;
    const max = this.gMaxUsed(this.groups());
    const fill = this.clamp(
      (Math.log10(Math.max(1, g._agg.used)) - Math.log10(max * 0.0015)) /
        (Math.log10(max) - Math.log10(max * 0.0015))
    );
    const gr = r + 6;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.arc(g._x, g._y, gr, 0, 6.28);
    ctx.stroke();
    ctx.strokeStyle = this.rgba(g.color, 0.85);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(g._x, g._y, gr, -Math.PI / 2, -Math.PI / 2 + fill * 6.28);
    ctx.stroke();
    this.node(ctx, g._x, g._y, r, g.color, g._agg.dl, g._agg.ul, { t, heat: 0.32, glowColor: g.color });
    const ly = g._y + gr + 9;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = '700 14px Inter,sans-serif';
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'rgba(5,6,7,0.92)';
    const head = g.label.toUpperCase() + ' · ' + g._agg.on;
    ctx.strokeText(head, g._x, ly);
    ctx.fillStyle = g.color;
    ctx.fillText(head, g._x, ly);
    if (this.SHOW) {
      ctx.font = '500 11px "JetBrains Mono",monospace';
      const tx = `↓${fmtBpsShort(g._agg.d)} ↑${fmtBpsShort(g._agg.u)} · ${fmtBytes(g._agg.used)}`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(5,6,7,0.92)';
      ctx.strokeText(tx, g._x, ly + 18);
      ctx.fillStyle = '#9aa6ad';
      ctx.fillText(tx, g._x, ly + 18);
    }
  }
  private reticle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, col: string, t: number) {
    ctx.save();
    const pulse = 0.5 + 0.5 * Math.sin(t * 3);
    ctx.strokeStyle = this.rgba(col, 0.5 + 0.4 * pulse);
    ctx.lineWidth = 1.6;
    for (let k = 0; k < 4; k++) {
      const a0 = (k * Math.PI) / 2 + t * 0.6;
      ctx.beginPath();
      ctx.arc(x, y, r, a0 + 0.3, a0 + Math.PI / 2 - 0.3);
      ctx.stroke();
    }
    const tick = 4;
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2 + t * 0.6;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * (r - tick), y + Math.sin(a) * (r - tick));
      ctx.lineTo(x + Math.cos(a) * (r + tick), y + Math.sin(a) * (r + tick));
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawReactor(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
    ctx.fillStyle = '#070809';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(120,150,200,0.045)';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 42) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y < h; y += 42) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    for (const s of this.dust) {
      const sx = (((s.x * w + Math.sin(t * 0.15 + s.p) * 22 * this.MO) % w) + w) % w;
      const sy = (((s.y * h + t * 5 * s.d) % h) + h) % h;
      ctx.fillStyle = `rgba(150,170,210,${s.a})`;
      ctx.fillRect(sx, sy, s.r, s.r);
    }
    if (!this.gw || !this.clients.length) return;
    const cx = w / 2;
    const G = this.groups();
    const MO = this.MO;
    // Fit the reactor into the region NOT occupied by the chrome: the HUD +
    // data-used pill on top, and the spotlight (bottom-left) + legend
    // (bottom-right) cards at the bottom. Center it there and stretch it
    // horizontally (the sides are card-free) to fill the wide empty margins
    // without any node going under a panel.
    const OUTER = 0.57;
    // Chrome the reactor must avoid: the HUD/pill on top and the two bottom-
    // CORNER cards (spotlight bottom-left, legend bottom-right). Approximated
    // from their actual on-screen boxes.
    const topInset = Math.min(150, 30 + h * 0.1) + 12;
    const nodeMargin = 42; // node radius + label below the outer ring
    // Card clearance corners (inner-top corner of each card + a gap).
    const leftCard = { x: 330, y: h - 226 - nodeMargin };
    const rightCard = { x: w - 244, y: h - 174 - nodeMargin };
    const padSide = 30;
    const SX = 1.85; // horizontal stretch (positions only — nodes stay round)
    const maxHalfW = w / 2 - padSide;
    // For a candidate center `c`, the largest vertical radius whose ellipse
    // (width = radius·SX) still clears the top, the bottom edge, the width, and
    // both corner cards.
    const cornerHV = (card: { x: number; y: number }, c: number) => {
      const dy = card.y - c;
      if (dy <= 0) return Infinity;
      return Math.hypot(Math.abs(card.x - cx) / SX, dy);
    };
    const vRadiusAt = (c: number) =>
      Math.min(c - topInset, h - 22 - c, maxHalfW / SX, cornerHV(leftCard, c), cornerHV(rightCard, c));
    let cy = (topInset + h) / 2;
    let halfV = 0;
    for (let c = topInset + 60; c < h - 60; c += 4) {
      const hv = vRadiusAt(c);
      if (hv > halfV) {
        halfV = hv;
        cy = c;
      }
    }
    halfV = Math.max(80, halfV);
    const base = Math.max(80, halfV / OUTER);
    const sx = SX;
    // Room below the ellipse's bottom that the card-free center can grow into.
    const bottomRoom = Math.max(0, h - 26 - (cy + halfV));
    const vg = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.12, cx, cy, Math.max(w, h) * 0.6);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.72)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);
    const spinRot = t * 0.05 * MO;
    this.infra.forEach((d, i) => {
      const a = spinRot - Math.PI / 2 + (i / Math.max(1, this.infra.length)) * 6.28;
      d._x = cx + Math.cos(a) * base * 0.13 * sx;
      d._y = cy + Math.sin(a) * base * 0.13;
    });
    const busRot = t * 0.035 * MO;
    const Rb = base * 0.28;
    const GA: any[] = G.map((g, i) => {
      const agg = this.groupAgg(g);
      const a = busRot - Math.PI / 2 + (i / G.length) * 6.28;
      return { ...g, _agg: agg, _x: cx + Math.cos(a) * Rb * sx, _y: cy + Math.sin(a) * Rb, _a: a };
    });
    const Rc1 = base * 0.43,
      Rc2 = base * 0.57;
    for (const g of GA) {
      const cl = g.devices as RDev[];
      const sectorHalf = (Math.PI / G.length) * 0.84;
      cl.forEach((c, i) => {
        const ring = i % 2;
        const idx = Math.floor(i / 2);
        const cnt = Math.ceil(cl.length / 2);
        const frac = cnt > 1 ? idx / (cnt - 1) : 0.5;
        const a = g._a + (frac - 0.5) * 2 * sectorHalf + Math.sin(t * 0.4 + c.phase) * 0.04 * MO;
        const rr = (ring ? Rc2 : Rc1) + Math.sin(t * 0.5 + c.phase * 1.4) * 9 * MO;
        c._x = cx + Math.cos(a) * rr * sx;
        c._y = cy + Math.sin(a) * rr;
      });
    }
    // Fill the card-free center-bottom band: nudge lower clients down into the
    // empty space below the ellipse, tapering to zero near the card columns so
    // no node slides under the spotlight (left) or legend (right) panels.
    if (bottomRoom > 8) {
      const taper = 90; // px over which the push fades as a node nears a card
      for (const g of GA) {
        for (const c of g.devices as RDev[]) {
          const y = c._y!;
          if (y <= cy) continue;
          const down = Math.min(1, (y - cy) / halfV); // how far down the node sits
          const lc = Math.min(1, Math.max(0, (c._x! - leftCard.x) / taper));
          const rc = Math.min(1, Math.max(0, (rightCard.x - c._x!) / taper));
          const clear = Math.min(lc, rc); // 0 near a card column, 1 mid-span
          c._y = y + bottomRoom * down * clear * 0.85;
        }
      }
    }
    this.hitBoxes = [];
    const dim = (key: string) => (this.filterSeg && key !== this.filterSeg ? 0.1 : 1);

    for (const d of this.infra) this.conduit(ctx, cx, cy, d._x!, d._y!, d.dl, d.ul, t, 2.2, false);
    for (const g of GA) {
      ctx.globalAlpha = dim(g.key);
      for (const c of g.devices as RDev[]) this.conduit(ctx, g._x, g._y, c._x!, c._y!, c.dl, c.ul, t, 1.3, !c.online);
    }
    ctx.globalAlpha = 1;

    for (const g of GA) {
      ctx.globalAlpha = dim(g.key);
      for (const c of g.devices as RDev[]) {
        this.reactorNode(ctx, c, this.colorOf(c), this.maxClientUsed, t);
        this.hitBoxes.push({ id: c.id, x: c._x!, y: c._y!, r: c._r || 6, kind: 'device' });
      }
    }
    ctx.globalAlpha = 1;

    const sd = this.spotDev;
    if (sd && sd._x !== undefined && sd.online) this.reticle(ctx, sd._x!, sd._y!, (sd._r || 6) + 12, segColor(sd.seg), t);

    const labelSet = new Set<string>();
    for (const g of GA) {
      const top = [...(g.devices as RDev[])].filter(d => d.online).sort((a, b) => b.used - a.used).slice(0, 2);
      top.forEach(d => labelSet.add(d.id));
    }
    if (sd) labelSet.add(sd.id);
    if (this.hoveredId) labelSet.add(this.hoveredId);
    for (const g of GA) {
      ctx.globalAlpha = dim(g.key);
      for (const c of g.devices as RDev[])
        if (labelSet.has(c.id)) this.labelName(ctx, c._x!, c._y!, c, (c._r || 6) + (c.online ? 5 : 0), !!(sd && c.id === sd.id));
    }
    ctx.globalAlpha = 1;

    for (const d of this.infra) {
      this.node(ctx, d._x!, d._y!, d.type === 'ap' ? 12 : 9, this.colorOf(d), d.dl, d.ul, { t, glow: d.type === 'ap' });
      this.hitBoxes.push({ id: d.id, x: d._x!, y: d._y!, r: d.type === 'ap' ? 12 : 9, kind: 'device' });
    }
    for (const g of GA) {
      ctx.globalAlpha = this.filterSeg && g.key !== this.filterSeg ? 0.4 : 1;
      this.reactorBus(ctx, g, t);
      this.hitBoxes.push({ id: 'bus:' + g.key, x: g._x, y: g._y, r: 15, kind: 'bus', seg: g.key });
    }
    ctx.globalAlpha = 1;
    const flare = 0.4 + 0.5 * this.gw.act;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const cg = ctx.createRadialGradient(cx, cy, 4, cx, cy, base * 0.16);
    cg.addColorStop(0, this.rgba('#ffce7a', 0.6 * flare * this.INT));
    cg.addColorStop(0.5, this.rgba('#f2615c', 0.18 * flare * this.INT));
    cg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(cx, cy, base * 0.16, 0, 6.28);
    ctx.fill();
    ctx.restore();
    for (let k = 0; k < 2; k++) {
      ctx.strokeStyle = this.rgba('#f5a623', 0.4 - k * 0.15);
      ctx.lineWidth = 2;
      const rr = 30 + k * 9;
      const offr = t * (0.6 - k * 0.3) * (k ? -1 : 1) * MO;
      for (let s = 0; s < 3; s++) {
        ctx.beginPath();
        ctx.arc(cx, cy, rr, offr + s * 2.09, offr + s * 2.09 + 1.2);
        ctx.stroke();
      }
    }
    this.node(ctx, cx, cy, 24, '#f5a623', this.gw.dl, this.gw.ul, { t, heat: 0.6, glowColor: '#ffce7a' });
    const load = this.clamp((this.gw.dBps + this.gw.uBps) / 1.6e8);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.arc(cx, cy, 36, 0, 6.28);
    ctx.stroke();
    ctx.strokeStyle = '#ffd27a';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, 36, -Math.PI / 2, -Math.PI / 2 + load * 6.28);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = '600 13px Inter,sans-serif';
    ctx.fillStyle = '#ffe7bd';
    ctx.fillText((this.gw.name || 'GATEWAY').toUpperCase(), cx, cy + 44);
    ctx.font = '600 11px "JetBrains Mono",monospace';
    ctx.fillStyle = '#caa86e';
    ctx.fillText(`LOAD ${(load * 100).toFixed(0)}%`, cx, cy + 60);
    this.hitBoxes.push({ id: this.gw.id, x: cx, y: cy, r: 24, kind: 'device' });

    // Hover highlight + persistent selection ring.
    const box = (id: string | null) => (id ? this.hitBoxes.find(b => b.id === id) : undefined);
    const hb = box(this.hoveredId);
    if (hb && hb.id !== this.selectedId) {
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(hb.x, hb.y, hb.r + 6, 0, 6.28);
      ctx.stroke();
    }
    const sb = box(this.selectedId);
    if (sb) {
      const col = sb.seg ? segColor(sb.seg) : '#ffffff';
      ctx.strokeStyle = this.rgba(col, 0.9);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sb.x, sb.y, sb.r + 7, 0, 6.28);
      ctx.stroke();
    }
  }
}
