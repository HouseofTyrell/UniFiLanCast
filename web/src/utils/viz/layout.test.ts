import { describe, it, expect } from 'vitest';
import { computeRadialLayout } from './layout';
import { Device } from '../../types';

const dev = (id: string, type: Device['type'], over: Partial<Device> = {}): Device =>
  ({ id, name: id, type, wiredOrWifi: 'wifi', siteId: 's', txBps: 0, rxBps: 0, lastSeen: 0, online: true, ...over }) as Device;

const W = 800;
const H = 600;
const noPhase = () => 0;

describe('computeRadialLayout', () => {
  it('places the gateway top-center, infra on the row below, clients lower', () => {
    const devices = [
      dev('gw', 'gateway'),
      dev('sw1', 'switch'),
      dev('ap1', 'ap'),
      dev('c1', 'client', { parentDeviceId: 'sw1' }),
      dev('c2', 'client', { parentDeviceId: 'ap1' }),
    ];
    const { targets, layoutCx } = computeRadialLayout(devices, W, H, noPhase);

    const gw = targets.get('gw')!;
    expect(gw.x).toBe(W / 2); // centered
    expect(gw.y).toBe(58); // top

    expect(targets.get('sw1')!.y).toBe(162); // infra row
    expect(targets.get('ap1')!.y).toBe(162);
    // clients hang below the infra row
    expect(targets.get('c1')!.y).toBeGreaterThan(162);
    expect(targets.get('c2')!.y).toBeGreaterThan(162);
    expect(layoutCx).toBe(W / 2);
  });

  it('is deterministic (stable seats) for the same input', () => {
    const devices = [dev('gw', 'gateway'), dev('sw1', 'switch'), dev('c1', 'client', { parentDeviceId: 'sw1' })];
    const a = computeRadialLayout(devices, W, H, noPhase);
    const b = computeRadialLayout(devices, W, H, noPhase);
    expect([...a.targets.entries()]).toEqual([...b.targets.entries()]);
  });

  it('only emits targets for the given devices', () => {
    const devices = [dev('gw', 'gateway'), dev('sw1', 'switch')];
    const { targets } = computeRadialLayout(devices, W, H, noPhase);
    expect(new Set(targets.keys())).toEqual(new Set(['gw', 'sw1']));
  });

  it('clients with an unknown parent hang off the gateway column', () => {
    const devices = [
      dev('gw', 'gateway'),
      dev('c1', 'client', { parentDeviceId: 'nonexistent' }),
    ];
    const { targets } = computeRadialLayout(devices, W, H, noPhase);
    expect(targets.has('c1')).toBe(true);
    expect(targets.get('c1')!.y).toBeGreaterThan(162);
  });
});
