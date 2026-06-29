import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AlertManager } from './AlertManager.js';
import { NetworkEvent } from './models/types.js';

const offlineEvent: NetworkEvent = {
  ts: 1000,
  severity: 'warning',
  type: 'offline',
  message: 'device went offline',
  relatedIds: ['dev-1'],
};

function newManager() {
  return new AlertManager({ enabled: true, webhookUrl: 'https://example.test/hook', throttleSeconds: 300 });
}

describe('AlertManager', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('dispatches a qualifying event once and throttles immediate repeats', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const am = newManager();

    await am.process([offlineEvent]);
    await am.process([offlineEvent]); // same dedupe key, within throttle window

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT start the throttle window when delivery fails (so it retries)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal('fetch', fetchMock);
    const am = newManager();

    await am.process([offlineEvent]);
    await am.process([offlineEvent]); // first send failed → not throttled → retried

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('treats a thrown fetch as a failed (retryable) delivery', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);
    const am = newManager();

    await am.process([offlineEvent]);
    await am.process([offlineEvent]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('ignores events below the minimum severity', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const am = newManager(); // default minSeverity = 'warning'

    await am.process([{ ...offlineEvent, severity: 'info' }]);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does nothing when disabled', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const am = new AlertManager({ enabled: false, webhookUrl: 'https://example.test/hook' });

    await am.process([offlineEvent]);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
