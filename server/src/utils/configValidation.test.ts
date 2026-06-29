import { describe, it, expect } from 'vitest';
import { redactConfig, validateConfig, preserveMaskedSecrets } from './configValidation.js';

describe('redactConfig', () => {
  it('masks every secret-bearing field', () => {
    const out = redactConfig({
      adapters: {
        integrationApi: { apiKey: 'real-key' },
        siteManager: { apiKey: 'sm-key' },
        localNetwork: { username: 'admin', password: 'pw' },
      },
      auth: { password: 'hunter2' },
      alerts: { webhookUrl: 'https://hooks.example/abc' },
      server: { port: 3001 },
    });
    expect(out.adapters.integrationApi.apiKey).toBe('********');
    expect(out.adapters.siteManager.apiKey).toBe('********');
    expect(out.adapters.localNetwork.username).toBe('********');
    expect(out.adapters.localNetwork.password).toBe('********');
    expect(out.auth.password).toBe('********');
    expect(out.alerts.webhookUrl).toBe('********');
    expect(out.server.port).toBe(3001); // non-secret preserved
  });

  it('leaves empty strings untouched and does not mutate the input', () => {
    const input = { adapters: { integrationApi: { apiKey: '' } }, server: {} };
    const out = redactConfig(input);
    expect(out.adapters.integrationApi.apiKey).toBe('');
    expect(input.adapters.integrationApi.apiKey).toBe(''); // original unchanged
  });
});

describe('validateConfig', () => {
  it('accepts a minimal valid config', () => {
    expect(validateConfig({ adapters: {}, server: { port: 3001 } })).toBeNull();
  });

  it('rejects non-objects', () => {
    expect(validateConfig(null)).toMatch(/JSON object/);
    expect(validateConfig('x')).toMatch(/JSON object/);
    expect(validateConfig([])).toMatch(/adapters/); // arrays are objects but lack adapters
  });

  it('rejects unknown top-level keys', () => {
    const err = validateConfig({ adapters: {}, server: {}, evil: 1 });
    expect(err).toMatch(/Unknown configuration key/);
    expect(err).toMatch(/evil/);
  });

  it('requires adapters and server', () => {
    expect(validateConfig({ server: {} })).toMatch(/adapters/);
    expect(validateConfig({ adapters: {} })).toMatch(/server/);
  });

  it('type-checks server.port and auth/alerts shapes', () => {
    expect(validateConfig({ adapters: {}, server: { port: 'nope' } })).toMatch(/port/);
    expect(validateConfig({ adapters: {}, server: {}, auth: 'x' })).toMatch(/auth/);
    expect(validateConfig({ adapters: {}, server: {}, alerts: 'x' })).toMatch(/alerts/);
  });
});

describe('preserveMaskedSecrets', () => {
  it('restores masked secrets from the existing config and keeps real edits', () => {
    const incoming = {
      adapters: { integrationApi: { apiKey: '********' }, localNetwork: { password: 'new-pw' } },
      auth: { password: '********' },
    };
    const existing = {
      adapters: { integrationApi: { apiKey: 'real-key' }, localNetwork: { password: 'old-pw' } },
      auth: { password: 'real-auth' },
    };
    preserveMaskedSecrets(incoming, existing);
    expect(incoming.adapters.integrationApi.apiKey).toBe('real-key'); // restored
    expect(incoming.adapters.localNetwork.password).toBe('new-pw'); // genuine edit kept
    expect(incoming.auth.password).toBe('real-auth'); // restored
  });
});
