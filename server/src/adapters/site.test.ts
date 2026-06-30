import { describe, it, expect } from 'vitest';
import { resolveSingleSite } from './site.js';

const A = { id: 'aaa', name: 'Site A' };
const B = { id: 'bbb', name: 'Site B', internalReference: 'default' };

describe('resolveSingleSite', () => {
  it('errors when there are no sites', () => {
    expect(resolveSingleSite([]).error).toMatch(/No sites/);
  });

  it('uses the only site', () => {
    const r = resolveSingleSite([A]);
    expect(r.site).toBe(A);
    expect(r.warning).toBeUndefined();
  });

  it('matches a configured siteId by id or internalReference', () => {
    expect(resolveSingleSite([A, B], 'bbb').site).toBe(B);
    expect(resolveSingleSite([A, B], 'default').site).toBe(B);
  });

  it('errors when the configured siteId is not found', () => {
    const r = resolveSingleSite([A, B], 'nope');
    expect(r.site).toBeUndefined();
    expect(r.error).toMatch(/not found/);
  });

  it('deterministically auto-resolves the lowest id and warns when multiple + no siteId', () => {
    const r1 = resolveSingleSite([B, A]); // input order B,A
    const r2 = resolveSingleSite([A, B]); // input order A,B
    expect(r1.site).toBe(A); // 'aaa' < 'bbb' regardless of order
    expect(r2.site).toBe(A);
    expect(r1.warning).toMatch(/Multiple sites/);
  });
});
