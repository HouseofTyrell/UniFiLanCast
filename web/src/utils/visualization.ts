import {
  Device,
  DeviceType,
  Link,
  WeatherSignals,
  VisualizationNode,
  Filter,
} from '../types';
import { formatBitrateStr } from './format';
import { vlanColor, ColorMode } from './vlan';

// "Observatory" palette — must mirror theme.css. Light is emitted from the
// data; the chrome stays neutral.
const PALETTE = {
  gateway: '#f5a623',
  switch: '#4da8e8',
  ap: '#3fd9a6',
  client: '#8b92f2',
  offline: '#2a2f3d',
  ice: '#5dd2f0',
  amber: '#f2b441',
  bad: '#f2615c',
  heat: '#ff7a45', // device-load heat — distinct from the gateway's gold
};

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function withAlpha(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
function mix(hex: string, target: number, amt: number): string {
  const [r, g, b] = hexToRgb(hex);
  const m = (c: number) => Math.round(c + (target - c) * amt);
  return `rgb(${m(r)}, ${m(g)}, ${m(b)})`;
}
const lighten = (hex: string, amt: number) => mix(hex, 255, amt);
const darken = (hex: string, amt: number) => mix(hex, 0, amt);

export class NetworkVisualization {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private nodes: Map<string, VisualizationNode> = new Map();
  private hoveredNode: VisualizationNode | null = null;
  private selectedId: string | null = null;
  private colorMode: ColorMode = 'type';
  private animationFrame = 0;

  // Radial-tree layout geometry (computed each frame).
  private layoutCx = 0;
  private layoutCy = 0;
  private ringRadii: number[] = [];

  // Ambient starfield dust (seeded once; d = depth for parallax, p = twinkle phase).
  private stars: Array<{ x: number; y: number; a: number; r: number; d: number; p: number }> = [];

  // Stable drift phase per node id.
  private phaseCache = new Map<string, number>();
  // Time-smoothed activity (0..1) per device id.
  private activityCache = new Map<string, number>();
  // Per-device data usage over the selected window (bytes), and per-type maxima.
  private usageMap: Record<string, { down: number; up: number }> = {};
  private maxClientUsage = 0;
  private maxInfraUsage = 0;

  // Focus pass: ids of the hovered/selected node + ancestors (or null).
  private focusSet: Set<string> | null = null;

  // Active lightning bolts (decay over a few hundred ms).
  private bolts: Array<{ fromId: string; toId: string; born: number }> = [];
  private lastBoltAt = new Map<string, number>();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.seedStars();
    this.resize();
  }

  private seedStars() {
    // Deterministic pseudo-random so the field doesn't reshuffle each frame.
    let s = 1337;
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    this.stars = Array.from({ length: 220 }, () => {
      const d = rnd(); // depth: 0 = far/dim/slow, 1 = near/bright/fast
      return {
        x: rnd(),
        y: rnd(),
        a: 0.03 + d * 0.1,
        r: 0.6 + d * 1.2,
        d,
        p: rnd() * Math.PI * 2,
      };
    });
  }

  /** Normalize a rate (bits/sec) to 0..1 on a log scale (~50Kbps..~50Mbps). */
  private rateLevel(bps: number): number {
    if (bps <= 0) return 0;
    const lo = Math.log10(50_000);
    const hi = Math.log10(50_000_000);
    return Math.max(0, Math.min(1, (Math.log10(bps) - lo) / (hi - lo)));
  }

  /** Combined throughput level (download + upload). */
  private trafficLevel(device: Device): number {
    return this.rateLevel((device.txBytes || 0) + (device.rxBytes || 0));
  }

  /** Per-device usage over the window; drives node size/brightness when present. */
  setUsageMap(map: Record<string, { down: number; up: number }>) {
    this.usageMap = map || {};
    this.maxClientUsage = 0;
    this.maxInfraUsage = 0;
    for (const [id, u] of Object.entries(this.usageMap)) {
      const total = (u.down || 0) + (u.up || 0);
      const type = this.nodes.get(id)?.device.type;
      if (type === 'client') this.maxClientUsage = Math.max(this.maxClientUsage, total);
      else if (type && type !== 'gateway') this.maxInfraUsage = Math.max(this.maxInfraUsage, total);
    }
  }

  /** Normalize a device's windowed usage to 0..1, relative to its tier's max. */
  private usageLevel(device: Device): number {
    const u = this.usageMap[device.id];
    const bytes = u ? (u.down || 0) + (u.up || 0) : 0;
    if (bytes <= 0) return 0;
    const max = device.type === 'client' ? this.maxClientUsage : this.maxInfraUsage;
    if (max <= 0) return 0;
    const lo = Math.log10(Math.max(1e5, max * 0.003));
    const hi = Math.log10(max);
    return Math.max(0, Math.min(1, (Math.log10(bytes) - lo) / Math.max(0.001, hi - lo)));
  }

  /**
   * Advance the time-smoothed activity for every device once per frame. When a
   * usage window is active, size/brightness reflect DATA USED over the window;
   * otherwise they fall back to the live rate. Easing makes changes glide.
   */
  private tickActivity(devices: Device[]) {
    const useUsage = Object.keys(this.usageMap).length > 0;
    for (const d of devices) {
      const raw = useUsage ? this.usageLevel(d) : this.trafficLevel(d);
      const prev = this.activityCache.get(d.id);
      this.activityCache.set(d.id, prev === undefined ? raw : prev + (raw - prev) * 0.05);
    }
  }

  /** Read the smoothed activity (0..1) for a device. */
  private nodeActivity(device: Device): number {
    return this.activityCache.get(device.id) ?? this.trafficLevel(device);
  }

  resize() {
    // Size the drawing buffer to the canvas's CSS box (the stage column),
    // accounting for device pixel ratio for crisp rendering.
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(rect.width));
    this.canvas.height = Math.max(1, Math.round(rect.height));
  }

  updateLayout(devices: Device[], _links: Link[]) {
    const box = this.layoutBox();
    this.tickActivity(devices);

    for (const device of devices) {
      let node = this.nodes.get(device.id);
      const radius = this.getNodeRadius(device, this.nodeActivity(device));
      if (!node) {
        // New nodes spawn at the center and ease out to their target.
        node = { device, x: box.cx, y: box.cy, vx: 0, vy: 0, radius };
        this.nodes.set(device.id, node);
      } else {
        node.device = device;
        node.radius = radius;
      }
    }

    const deviceIds = new Set(devices.map(d => d.id));
    for (const [id] of this.nodes) {
      if (!deviceIds.has(id)) this.nodes.delete(id);
    }

    this.computeRadialTargets(devices, box);

    // Ease toward target plus a slow, gentle Lissajous drift. Low easing +
    // small slow drift = an organic float, not a jittery bounce.
    const t = this.animationFrame;
    for (const node of this.nodes.values()) {
      if (node.targetX === undefined || node.targetY === undefined) continue;
      const ph = this.nodePhase(node.device.id);
      const amp = node.device.type === 'client' ? 3.2 : 2;
      const dx = Math.sin(t * 0.006 + ph) * amp;
      const dy = Math.cos(t * 0.0047 + ph * 1.7) * amp;
      node.x += (node.targetX + dx - node.x) * 0.05;
      node.y += (node.targetY + dy - node.y) * 0.05;
    }
  }

  /** Stable per-node phase (0..2π) so each node drifts on its own rhythm. */
  private nodePhase(id: string): number {
    let cached = this.phaseCache.get(id);
    if (cached === undefined) {
      let h = 0;
      for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
      cached = ((h % 1000) / 1000) * Math.PI * 2;
      this.phaseCache.set(id, cached);
    }
    return cached;
  }

  /** Usable drawing area: full canvas minus the header. */
  private layoutBox() {
    // The canvas is now the centered stage between the rails, so a uniform fit
    // (no anisotropic stretch) keeps the constellation circular and composed.
    const pad = 28;
    const cx = this.canvas.width / 2;
    const cy = this.canvas.height / 2;
    const halfW = this.canvas.width / 2 - pad;
    const halfH = this.canvas.height / 2 - pad;
    return { cx, cy, maxR: Math.min(halfW, halfH), halfW, halfH };
  }

  /**
   * Hybrid tiered + clustered layout: the gateway on top, switches/APs in a row
   * beneath it, and each hub's own clients packed into a grid directly below it.
   * Hubs get horizontal room proportional to their client count, and the
   * busiest hub is centered. Order is stable, so traffic never reshuffles seats.
   */
  private computeRadialTargets(
    devices: Device[],
    _box: { cx: number; cy: number; maxR: number; halfW: number; halfH: number }
  ) {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const padX = 48;
    const left = padX;
    const usableW = Math.max(1, W - padX * 2);
    const cx = W / 2;

    const gateway = devices.find(d => d.type === 'gateway');
    const infra = devices
      .filter(d => d.type !== 'client' && d.type !== 'gateway')
      .sort((a, b) => a.name.localeCompare(b.name));
    const infraIds = new Set(infra.map(d => d.id));

    // Group clients by their owning hub (parent if it's infra, else the gateway).
    const byOwner = new Map<string, Device[]>();
    for (const d of devices) {
      if (d.type !== 'client') continue;
      const owner = d.parentDeviceId && infraIds.has(d.parentDeviceId) ? d.parentDeviceId : 'gw';
      (byOwner.get(owner) || byOwner.set(owner, []).get(owner)!).push(d);
    }
    for (const arr of byOwner.values()) arr.sort((a, b) => a.id.localeCompare(b.id));

    // One column per infra hub (+ a gateway column if any clients hang off it).
    type Col = { node?: Device; clients: Device[] };
    const cols: Col[] = infra.map(d => ({ node: d, clients: byOwner.get(d.id) || [] }));
    const gwClients = byOwner.get('gw') || [];
    if (gwClients.length) cols.push({ node: undefined, clients: gwClients });

    // Arrange columns biggest-in-the-center so the dominant cluster is centered.
    const bySize = [...cols].sort((a, b) => b.clients.length - a.clients.length);
    const ordered: Col[] = new Array(bySize.length);
    let li = Math.floor((bySize.length - 1) / 2);
    let ri = li + 1;
    bySize.forEach((c, i) => {
      if (i % 2 === 0) ordered[li--] = c;
      else ordered[ri++] = c;
    });

    // Band width ∝ client count (softened) so big clusters get room but small
    // hubs still get a visible slot.
    const weightOf = (c: Col) => Math.sqrt(c.clients.length) + 0.9;
    const totalW = ordered.reduce((s, c) => s + weightOf(c), 0) || 1;

    const gatewayY = 58;
    const infraY = 162;
    const clientTop = 244;
    const clientBottom = H - 60;
    const clientH = clientBottom - clientTop;

    let curX = left;
    for (const c of ordered) {
      const bandW = (usableW * weightOf(c)) / totalW;
      const bandCx = curX + bandW / 2;
      if (c.node) {
        const node = this.nodes.get(c.node.id);
        if (node) {
          node.targetX = bandCx;
          node.targetY = infraY;
        }
      }
      // Pack this hub's clients into an organic phyllotaxis (sunflower) cluster
      // hanging below it — a natural blob, not a rigid grid. Spacing adapts so
      // the blob fits both its band width and the vertical space.
      const n = c.clients.length;
      if (n > 0) {
        const sqn = Math.sqrt(n);
        const cspace = Math.min(28, (bandW * 0.46) / sqn, (clientH * 0.46) / sqn);
        const discR = cspace * sqn;
        const clusterY = clientTop + discR + 14;
        const rot = this.nodePhase(c.node ? c.node.id : 'gw');
        c.clients.forEach((d, i) => {
          const node = this.nodes.get(d.id);
          if (!node) return;
          const rr = cspace * Math.sqrt(i + 0.5);
          const ang = i * 2.399963 + rot;
          const ph = this.nodePhase(d.id);
          node.targetX = bandCx + Math.cos(ang) * rr + Math.cos(ph) * 5;
          node.targetY = clusterY + Math.sin(ang) * rr + Math.sin(ph * 1.7) * 5;
        });
      }
      curX += bandW;
    }

    if (gateway) {
      const node = this.nodes.get(gateway.id);
      if (node) {
        node.targetX = cx;
        node.targetY = gatewayY;
      }
    }

    this.layoutCx = cx;
    this.layoutCy = (gatewayY + clientBottom) / 2;
    this.ringRadii = [];
  }

  render(
    devices: Device[],
    links: Link[],
    weather: WeatherSignals,
    filter: Filter
  ) {
    this.animationFrame++;

    // Filter devices
    const filteredDevices = this.applyFilter(devices, filter);
    const filteredDeviceIds = new Set(filteredDevices.map(d => d.id));

    // Filter links
    const filteredLinks = links.filter(
      link =>
        filteredDeviceIds.has(link.fromId) && filteredDeviceIds.has(link.toId)
    );

    // Update layout (computes ring geometry used by the background)
    this.updateLayout(filteredDevices, filteredLinks);

    // When a node is hovered/selected, compute its uplink path so we can dim
    // everything else (the focus pass).
    this.focusSet = this.computeFocusSet();

    // Background: radial vignette + concentric radar rings
    this.drawBackground();

    // Render links with weather effects
    for (const link of filteredLinks) {
      this.renderLink(link, weather);
    }

    // Lightning bolts (from latency/spike events), drawn over links.
    this.updateBolts(weather);
    this.renderBolts();

    // Render nodes back-to-front by activity, so busy devices sit on top and
    // idle ones recede into the background.
    const drawList = filteredDevices
      .map(d => this.nodes.get(d.id))
      .filter((n): n is VisualizationNode => !!n)
      .sort((a, b) => this.nodeActivity(a.device) - this.nodeActivity(b.device));
    for (const node of drawList) {
      this.renderNode(node, weather);
    }

    // Render hover tooltip
    if (this.hoveredNode) {
      this.renderTooltip(this.hoveredNode);
    }
  }

  /** ids of the focused node + its ancestors to the gateway, or null. */
  private computeFocusSet(): Set<string> | null {
    const focusId = this.selectedId || this.hoveredNode?.device.id || null;
    if (!focusId) return null;
    const set = new Set<string>();
    let cur: string | undefined = focusId;
    let guard = 0;
    while (cur && !set.has(cur) && guard++ < 50) {
      set.add(cur);
      cur = this.nodes.get(cur)?.device.parentDeviceId;
    }
    return set;
  }

  private drawBackground() {
    const { ctx } = this;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const cx = this.layoutCx || w / 2;
    const cy = this.layoutCy || h / 2;
    const maxR = this.ringRadii.length ? this.ringRadii[this.ringRadii.length - 1] : Math.min(w, h) / 2;

    // Deep base + vignette.
    ctx.fillStyle = '#070910';
    ctx.fillRect(0, 0, w, h);

    // Off-center "nebula" — a large soft glow giving the void a center of
    // gravity (anchored near the mass center, nudged up-left).
    const nx = cx - maxR * 0.18;
    const ny = cy - maxR * 0.12;
    const neb = ctx.createRadialGradient(nx, ny, 0, nx, ny, maxR * 1.5);
    neb.addColorStop(0, 'rgba(34, 48, 86, 0.5)');
    neb.addColorStop(0.5, 'rgba(18, 26, 48, 0.28)');
    neb.addColorStop(1, 'rgba(6, 7, 13, 0)');
    ctx.fillStyle = neb;
    ctx.fillRect(0, 0, w, h);

    // Layered parallax starfield with a gentle twinkle and corner falloff.
    ctx.save();
    for (const star of this.stars) {
      const drift = this.animationFrame * (0.004 + star.d * 0.02);
      const sx = ((star.x * w + drift) % w + w) % w;
      const sy = (star.y * h) % h;
      const tw = 0.7 + 0.3 * Math.sin(this.animationFrame * 0.02 + star.p);
      // Fade slightly toward the vignette corners.
      const dist = Math.hypot(sx - cx, sy - cy) / (Math.hypot(w, h) / 2);
      const a = star.a * tw * (1 - dist * 0.4);
      ctx.fillStyle = `rgba(180, 200, 235, ${Math.max(0, a)})`;
      ctx.beginPath();
      ctx.arc(sx, sy, star.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

  }

  private renderLink(link: Link, _weather: WeatherSignals) {
    const fromNode = this.nodes.get(link.fromId);
    const toNode = this.nodes.get(link.toId);
    if (!fromNode || !toNode) return;
    const ctx = this.ctx;

    // Focus pass: a link is lit only if both endpoints are in the focus set.
    const focusDim =
      this.focusSet && !(this.focusSet.has(link.fromId) && this.focusSet.has(link.toId))
        ? 0.18
        : 1;

    // Control point nudged outward from center so the graph fans organically.
    const mx = (fromNode.x + toNode.x) / 2;
    const my = (fromNode.y + toNode.y) / 2;
    const nx = mx - this.layoutCx;
    const ny = my - this.layoutCy;
    const nl = Math.hypot(nx, ny) || 1;
    const bow = 14;
    const cxp = mx + (nx / nl) * bow;
    const cyp = my + (ny / nl) * bow;

    // Perpendicular, so the two directional strands run as separate lines.
    const dx = toNode.x - fromNode.x;
    const dy = toNode.y - fromNode.y;
    const dl = Math.hypot(dx, dy) || 1;
    const px = -dy / dl;
    const py = dx / dl;

    const strand = (off: number) => {
      ctx.beginPath();
      ctx.moveTo(fromNode.x + px * off, fromNode.y + py * off);
      ctx.quadraticCurveTo(cxp + px * off, cyp + py * off, toNode.x + px * off, toNode.y + py * off);
      ctx.stroke();
    };

    const child = toNode.device;
    const downLvl = this.rateLevel(child.rxBytes || 0);
    const upLvl = this.rateLevel(child.txBytes || 0);
    const sep = 2.6;

    ctx.save();
    ctx.globalAlpha = focusDim;

    // Faint base for both strands so idle links still read.
    ctx.lineWidth = 1;
    ctx.strokeStyle = withAlpha(this.getNodeColor(child), 0.14);
    strand(sep);
    strand(-sep);

    // Download strand (ice) flows parent → child.
    if (downLvl > 0.05) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = withAlpha(PALETTE.ice, 0.25 + downLvl * 0.5);
      ctx.lineWidth = 1 + downLvl * 2.2;
      ctx.shadowColor = PALETTE.ice;
      ctx.shadowBlur = 6 * downLvl;
      const dash = 4 + downLvl * 6;
      ctx.setLineDash([dash, dash * 2.4]);
      ctx.lineDashOffset = -(this.animationFrame * (1 + downLvl * 3)) % 100000;
      strand(sep);
    }

    // Upload strand (amber) flows child → parent.
    if (upLvl > 0.05) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = withAlpha(PALETTE.amber, 0.25 + upLvl * 0.5);
      ctx.lineWidth = 1 + upLvl * 2.2;
      ctx.shadowColor = PALETTE.amber;
      ctx.shadowBlur = 6 * upLvl;
      const dash = 4 + upLvl * 6;
      ctx.setLineDash([dash, dash * 2.4]);
      ctx.lineDashOffset = (this.animationFrame * (1 + upLvl * 3)) % 100000;
      strand(-sep);
    }

    ctx.setLineDash([]);
    ctx.restore();
  }

  private renderNode(node: VisualizationNode, weather: WeatherSignals) {
    const { device } = node;
    const ctx = this.ctx;
    const TAU = Math.PI * 2;
    const fog = weather.fogLevel[device.id] || 0;
    const heat = weather.heat[device.id] || 0;
    const online = device.online;
    const isClient = device.type === 'client';
    const active = this.nodeActivity(device);
    const color = this.getNodeColor(device);
    const r = node.radius;
    const hovered = this.hoveredNode === node || this.selectedId === device.id;
    const selected = this.selectedId === device.id;

    // Activity prominence: what's moving data dominates; idle switches recede.
    // The gateway stays the anchor.
    const prominence =
      device.type === 'gateway' ? 1 : isClient ? 0.34 + active * 0.66 : 0.34 + active * 0.66;
    // Focus pass: dim anything outside the hovered/selected node's path.
    const focusDim = this.focusSet && !this.focusSet.has(device.id) ? 0.22 : 1;

    ctx.save();
    // Fog fades a degraded device toward the background.
    const baseAlpha = (online ? 1 : 0.5) * (1 - fog * 0.45) * prominence * focusDim;
    ctx.globalAlpha = baseAlpha;

    // (1) Bloom halo — additive, fades to transparent-of-hue. Skipped for idle
    // clients and offline nodes so the outer ring reads as a starfield.
    const showBloom = online && (!isClient || active > 0.04 || heat > 0.12 || hovered);
    if (showBloom) {
      const heatColor = heat > 0.5 ? PALETTE.bad : heat > 0.15 ? PALETTE.heat : color;
      const breathe = 1 + Math.sin(this.animationFrame * 0.04 + node.x * 0.05) * 0.06;
      const haloR = r * (2.3 + heat * 1.4) * breathe;
      const strength = Math.min(0.6, Math.max(0.18, heat * 0.55, active * 0.45) + (hovered ? 0.25 : 0));
      const halo = ctx.createRadialGradient(node.x, node.y, r * 0.3, node.x, node.y, haloR);
      halo.addColorStop(0, withAlpha(heatColor, strength));
      halo.addColorStop(1, withAlpha(heatColor, 0));
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(node.x, node.y, haloR, 0, TAU);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }

    // (2) Body — radial-shaded orb (fake top-left light) or graphite if offline.
    if (online) {
      const body = ctx.createRadialGradient(node.x - r * 0.3, node.y - r * 0.3, r * 0.1, node.x, node.y, r);
      body.addColorStop(0, lighten(color, 0.3));
      body.addColorStop(1, darken(color, 0.42));
      ctx.fillStyle = body;
    } else {
      ctx.fillStyle = PALETTE.offline;
    }
    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, TAU);
    ctx.fill();

    // (3) Ring — node color at high lightness, with a soft self-glow.
    ctx.lineWidth = isClient ? 1 : 1.5;
    ctx.strokeStyle = online ? lighten(color, 0.45) : '#4a5163';
    if (online && !isClient) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 10;
    }
    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, TAU);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Monoline glyph engraved into the orb, tinted to its hue (infra + bigger
    // clients only — tiny idle dots stay clean).
    if (r >= 11) {
      this.drawGlyph(device.type, node.x, node.y, r, color, baseAlpha * (online ? 1 : 0.55));
    }

    // WiFi signal pip.
    if (!isClient && device.wiredOrWifi === 'wifi' && device.rssi) {
      const s = Math.max(0, (device.rssi + 90) / 60);
      ctx.fillStyle = s > 0.6 ? PALETTE.ap : s > 0.3 ? PALETTE.amber : PALETTE.bad;
      ctx.beginPath();
      ctx.arc(node.x + r - 4, node.y - r + 4, 2.5, 0, TAU);
      ctx.fill();
    }

    // Hover / selection ring.
    if (hovered) {
      ctx.strokeStyle = PALETTE.ice;
      ctx.lineWidth = selected ? 2.5 : 2;
      ctx.shadowColor = PALETTE.ice;
      ctx.shadowBlur = selected ? 16 : 12;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + (selected ? 7 : 5), 0, TAU);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // Labels for infrastructure, featured (active) clients, and hovered/selected.
    if (!isClient || hovered || active > 0.1) {
      const label = device.name.length > 22 ? device.name.slice(0, 21) + '…' : device.name;
      ctx.font = '500 11px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const ly = node.y + r + 5;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(6, 7, 13, 0.9)';
      ctx.strokeText(label, node.x, ly);
      ctx.fillStyle = hovered ? '#f2f5fc' : 'rgba(197, 204, 222, 0.9)';
      ctx.fillText(label, node.x, ly);
    }

    ctx.restore();
  }

  /** A clean monoline device glyph, drawn centered and tinted to the node hue. */
  private drawGlyph(type: DeviceType, x: number, y: number, r: number, color: string, alpha: number) {
    const ctx = this.ctx;
    const TAU = Math.PI * 2;
    const s = r * 0.62;
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha *= alpha;
    ctx.strokeStyle = lighten(color, 0.62);
    ctx.fillStyle = lighten(color, 0.62);
    ctx.lineWidth = Math.max(1, r * 0.09);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    if (type === 'gateway') {
      // Router: rounded body + two antennas + status dots.
      const w = s * 1.5, h = s * 0.8;
      this.roundRect(-w / 2, -h / 2 + s * 0.25, w, h, h * 0.32);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-w * 0.24, -h / 2 + s * 0.25); ctx.lineTo(-w * 0.34, -s);
      ctx.moveTo(w * 0.24, -h / 2 + s * 0.25); ctx.lineTo(w * 0.34, -s);
      ctx.stroke();
      for (const dx of [-0.22, 0.22]) {
        ctx.beginPath(); ctx.arc(w * dx, s * 0.25, r * 0.06, 0, TAU); ctx.fill();
      }
    } else if (type === 'switch') {
      // Switch: rounded body with a row of ports.
      const w = s * 1.7, h = s * 1;
      this.roundRect(-w / 2, -h / 2, w, h, r * 0.13);
      ctx.stroke();
      const n = 4;
      for (let i = 0; i < n; i++) {
        const px = -w / 2 + (w * (i + 0.5)) / n;
        ctx.strokeRect(px - r * 0.07, h * 0.06, r * 0.14, h * 0.3);
      }
    } else if (type === 'ap') {
      // Access point: broadcast arcs + a dot.
      for (let i = 1; i <= 2; i++) {
        ctx.beginPath();
        ctx.arc(0, s * 0.55, s * 0.42 * i, Math.PI * 1.25, Math.PI * 1.75);
        ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(0, s * 0.55, r * 0.09, 0, TAU); ctx.fill();
    } else {
      // Client: a small monitor outline.
      const w = s * 1.3, h = s * 0.95;
      this.roundRect(-w / 2, -h / 2, w, h, r * 0.12);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-w * 0.2, h / 2 + r * 0.16); ctx.lineTo(w * 0.2, h / 2 + r * 0.16);
      ctx.stroke();
    }
    ctx.restore();
  }

  private renderTooltip(node: VisualizationNode) {
    const { device } = node;
    const ctx = this.ctx;
    const padding = 12;
    const lineHeight = 18;
    const accent = this.getNodeColor(device);

    const title = device.name;
    const sub: string[] = [];
    const rate = (device.txBytes || 0) + (device.rxBytes || 0);
    if (rate > 0) {
      sub.push(`↓ ${formatBitrateStr(device.rxBytes || 0)}   ↑ ${formatBitrateStr(device.txBytes || 0)}`);
    }
    sub.push(device.ip || device.type);
    if (device.wiredOrWifi === 'wifi' && device.ssid) sub.push(device.ssid);
    if (!device.online) sub.push('Offline');
    sub.push('click for details');

    ctx.save();
    ctx.font = '600 13px Inter, system-ui, sans-serif';
    const titleW = ctx.measureText(title).width;
    ctx.font = '12px Inter, system-ui, sans-serif';
    const subW = Math.max(0, ...sub.map(s => ctx.measureText(s).width));
    const width = Math.max(titleW, subW) + padding * 2;
    const height = padding * 2 + lineHeight + sub.length * lineHeight;

    let x = node.x + node.radius + 12;
    let y = node.y - height / 2;
    if (x + width > this.canvas.width) x = node.x - node.radius - width - 12;
    if (y < 76) y = 76;
    if (y + height > this.canvas.height) y = this.canvas.height - height - 8;

    // Glass panel with a colored top edge.
    this.roundRect(x, y, width, height, 10);
    ctx.fillStyle = 'rgba(16, 20, 33, 0.92)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = accent;
    this.roundRect(x, y, width, 3, 10);
    ctx.fill();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = '600 13px Inter, system-ui, sans-serif';
    ctx.fillStyle = '#f2f5fc';
    ctx.fillText(title, x + padding, y + padding);
    ctx.font = '12px Inter, system-ui, sans-serif';
    sub.forEach((s, i) => {
      ctx.fillStyle = i === sub.length - 1 ? '#4e576e' : '#95a0b6';
      ctx.fillText(s, x + padding, y + padding + lineHeight + i * lineHeight);
    });
    ctx.restore();
  }

  private roundRect(x: number, y: number, w: number, h: number, r: number) {
    const ctx = this.ctx;
    const rad = Math.min(r, h / 2, w / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }

  private updateBolts(weather: WeatherSignals) {
    const now = Date.now();
    // Spawn a bolt for each fresh lightning event (throttled per device).
    for (const e of weather.lightningEvents) {
      if (now - e.ts > 600) continue;
      const last = this.lastBoltAt.get(e.deviceId) ?? 0;
      if (now - last < 1200) continue;
      const node = this.nodes.get(e.deviceId);
      if (!node) continue;
      const parentId = node.device.parentDeviceId;
      this.bolts.push({ fromId: parentId && this.nodes.has(parentId) ? parentId : e.deviceId, toId: e.deviceId, born: now });
      this.lastBoltAt.set(e.deviceId, now);
    }
    // Expire old bolts (~280ms life).
    this.bolts = this.bolts.filter(b => now - b.born < 280);
  }

  private renderBolts() {
    const now = Date.now();
    const ctx = this.ctx;
    for (const bolt of this.bolts) {
      const from = this.nodes.get(bolt.fromId);
      const to = this.nodes.get(bolt.toId);
      if (!from || !to) continue;
      const age = (now - bolt.born) / 280;
      const alpha = Math.max(0, 1 - age);

      // Jagged midpoint-displacement polyline.
      const segs = 7;
      const pts: Array<[number, number]> = [];
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const len = Math.hypot(dx, dy) || 1;
      const px = -dy / len;
      const py = dx / len;
      for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        const jitter = i === 0 || i === segs ? 0 : (Math.sin(i * 99.7 + bolt.born) * 0.5) * 14;
        pts.push([from.x + dx * t + px * jitter, from.y + dy * t + py * jitter]);
      }

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      // Outer glow.
      ctx.strokeStyle = withAlpha(PALETTE.bad, alpha * 0.6);
      ctx.lineWidth = 5;
      ctx.shadowColor = PALETTE.bad;
      ctx.shadowBlur = 14;
      this.strokePath(pts);
      // White-hot core.
      ctx.strokeStyle = withAlpha('#ffffff', alpha);
      ctx.lineWidth = 1.5;
      ctx.shadowBlur = 0;
      this.strokePath(pts);
      // Flash at the struck node.
      const flash = ctx.createRadialGradient(to.x, to.y, 0, to.x, to.y, to.radius * 3);
      flash.addColorStop(0, withAlpha(PALETTE.bad, alpha * 0.5));
      flash.addColorStop(1, withAlpha(PALETTE.bad, 0));
      ctx.fillStyle = flash;
      ctx.beginPath();
      ctx.arc(to.x, to.y, to.radius * 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private strokePath(pts: Array<[number, number]>) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
  }

  private applyFilter(devices: Device[], filter: Filter): Device[] {
    return devices.filter(device => {
      if (filter.wiredOnly && device.wiredOrWifi !== 'wired') return false;
      if (filter.wifiOnly && device.wiredOrWifi !== 'wifi') return false;
      if (filter.issuesOnly && device.online) return false;

      if (filter.search) {
        const search = filter.search.toLowerCase();
        return (
          device.name.toLowerCase().includes(search) ||
          device.ip?.toLowerCase().includes(search) ||
          device.mac?.toLowerCase().includes(search)
        );
      }

      return true;
    });
  }

  private getNodeRadius(device: Device, activity?: number): number {
    const a = activity ?? this.trafficLevel(device);
    switch (device.type) {
      case 'gateway':
        // The WAN anchor stays prominent regardless.
        return 24;
      case 'switch':
      case 'ap':
        // Idle switches recede; ones actually carrying traffic grow.
        return 11 + a * 11;
      case 'client':
        // Idle clients are small ~5px dots; the busiest grow to ~21px.
        return 5 + a * 16;
      default:
        return 12 + a * 8;
    }
  }

  private getNodeColor(device: Device): string {
    // VLAN mode colors clients by segment; infrastructure keeps its type color.
    if (this.colorMode === 'vlan' && device.type === 'client' && device.vlanId !== undefined) {
      return vlanColor(device.vlanId);
    }
    switch (device.type) {
      case 'gateway':
        return PALETTE.gateway;
      case 'switch':
        return PALETTE.switch;
      case 'ap':
        return PALETTE.ap;
      case 'client':
        return PALETTE.client;
      default:
        return '#8e8e93';
    }
  }

  handleMouseMove(x: number, y: number) {
    this.hoveredNode = null;

    for (const node of this.nodes.values()) {
      const dx = x - node.x;
      const dy = y - node.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance <= node.radius) {
        this.hoveredNode = node;
        break;
      }
    }
  }

  getHoveredNode(): VisualizationNode | null {
    return this.hoveredNode;
  }

  /** Return the device id at a point, or null. Pads the radius for small dots. */
  hitTest(x: number, y: number): string | null {
    let best: { id: string; d: number } | null = null;
    for (const node of this.nodes.values()) {
      const d = Math.hypot(x - node.x, y - node.y);
      const hit = Math.max(node.radius, 9);
      if (d <= hit && (!best || d < best.d)) best = { id: node.device.id, d };
    }
    return best ? best.id : null;
  }

  setSelected(id: string | null) {
    this.selectedId = id;
  }

  setColorMode(mode: ColorMode) {
    this.colorMode = mode;
  }
}
