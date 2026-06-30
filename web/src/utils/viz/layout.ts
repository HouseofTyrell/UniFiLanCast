import { Device } from '../../types';

export interface LayoutResult {
  /** Target position per device id (only ids present in `devices`). */
  targets: Map<string, { x: number; y: number }>;
  layoutCx: number;
  layoutCy: number;
}

/**
 * Hybrid tiered + clustered layout (pure): gateway on top, switches/APs in a
 * row beneath it, and each hub's own clients packed into an organic phyllotaxis
 * cluster directly below it. Hubs get horizontal room ∝ client count and the
 * busiest hub is centered; ordering is stable so traffic never reshuffles seats.
 *
 * `phaseFor` supplies the stable per-id drift phase (so the result is
 * deterministic and testable without a canvas).
 */
export function computeRadialLayout(
  devices: Device[],
  W: number,
  H: number,
  phaseFor: (id: string) => number
): LayoutResult {
  const targets = new Map<string, { x: number; y: number }>();
  const set = (id: string, x: number, y: number) => targets.set(id, { x, y });

  const padX = 48;
  const left = padX;
  const usableW = Math.max(1, W - padX * 2);
  const cx = W / 2;

  const gateway = devices.find(d => d.type === 'gateway');
  const infra = devices
    .filter(d => d.type !== 'client' && d.type !== 'gateway')
    .sort((a, b) => a.name.localeCompare(b.name));
  const infraIds = new Set(infra.map(d => d.id));

  // Group clients by owning hub (parent if it's infra, else the gateway).
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
    if (c.node) set(c.node.id, bandCx, infraY);

    const n = c.clients.length;
    if (n > 0) {
      const sqn = Math.sqrt(n);
      const cspace = Math.min(28, (bandW * 0.46) / sqn, (clientH * 0.46) / sqn);
      const discR = cspace * sqn;
      const clusterY = clientTop + discR + 14;
      const rot = phaseFor(c.node ? c.node.id : 'gw');
      c.clients.forEach((d, i) => {
        const rr = cspace * Math.sqrt(i + 0.5);
        const ang = i * 2.399963 + rot;
        const ph = phaseFor(d.id);
        set(d.id, bandCx + Math.cos(ang) * rr + Math.cos(ph) * 5, clusterY + Math.sin(ang) * rr + Math.sin(ph * 1.7) * 5);
      });
    }
    curX += bandW;
  }

  if (gateway) set(gateway.id, cx, gatewayY);

  return { targets, layoutCx: cx, layoutCy: (gatewayY + clientBottom) / 2 };
}
