// Distinct, stable colors for VLANs (hex so canvas color helpers can parse).
const VLAN_PALETTE = [
  '#5dd2f0', // ice
  '#3fd9a6', // teal
  '#f5a623', // gold
  '#8b92f2', // periwinkle
  '#f2615c', // coral
  '#e87ba4', // pink
  '#4da8e8', // blue
  '#b5d44a', // lime
  '#f2b441', // amber
  '#9b8cff', // violet
];

// Assign a distinct color to each VLAN the first time we see it, so segments
// like 10/20/30 don't collide (a plain modulo would map them all to index 0).
const assigned = new Map<number, string>();

export function vlanColor(vlanId: number): string {
  let color = assigned.get(vlanId);
  if (!color) {
    color = VLAN_PALETTE[assigned.size % VLAN_PALETTE.length];
    assigned.set(vlanId, color);
  }
  return color;
}

export type ColorMode = 'type' | 'vlan';
