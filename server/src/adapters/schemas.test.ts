import { describe, it, expect } from 'vitest';
import {
  RawSiteSchema,
  RawDeviceSchema,
  RawClientSchema,
  parseItems,
} from './schemas.js';

describe('raw payload schemas', () => {
  it('requires a device id and preserves unknown fields (graceful degradation)', () => {
    const ok = RawDeviceSchema.safeParse({ id: 'd1', model: 'USW', futureField: 42 });
    expect(ok.success).toBe(true);
    if (ok.success) expect((ok.data as any).futureField).toBe(42); // unknown kept
    expect(RawDeviceSchema.safeParse({ model: 'USW' }).success).toBe(false); // no id
    expect(RawDeviceSchema.safeParse({ id: '' }).success).toBe(false); // empty id
  });

  it('accepts a client identified by id OR mac, rejects one with neither', () => {
    expect(RawClientSchema.safeParse({ id: 'c1' }).success).toBe(true);
    expect(RawClientSchema.safeParse({ mac: 'aa:bb:cc' }).success).toBe(true);
    expect(RawClientSchema.safeParse({ macAddress: 'aa:bb' }).success).toBe(true);
    expect(RawClientSchema.safeParse({ hostname: 'x' }).success).toBe(false);
  });

  it('requires a site id', () => {
    expect(RawSiteSchema.safeParse({ id: 's1', name: 'Default' }).success).toBe(true);
    expect(RawSiteSchema.safeParse({ name: 'Default' }).success).toBe(false);
  });
});

describe('parseItems', () => {
  it('keeps valid items and drops invalid ones', () => {
    const out = parseItems(
      RawDeviceSchema,
      [{ id: 'a' }, { nope: 1 }, { id: 'b' }, null, 'garbage'],
      'devices'
    );
    expect(out.map(d => d.id)).toEqual(['a', 'b']);
  });

  it('returns everything when all items are valid', () => {
    const out = parseItems(RawSiteSchema, [{ id: 's1' }, { id: 's2' }], 'sites');
    expect(out).toHaveLength(2);
  });
});
