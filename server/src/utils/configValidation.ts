/** Mask a secret-bearing string so the value never leaves the server. */
export function maskSecret(v: unknown): unknown {
  return typeof v === 'string' && v.length > 0 ? '********' : v;
}

/** Deep-clone config and redact every secret field before returning it. */
export function redactConfig(config: any): any {
  const c = JSON.parse(JSON.stringify(config ?? {}));
  const a = c.adapters || {};
  if (a.siteManager) a.siteManager.apiKey = maskSecret(a.siteManager.apiKey);
  if (a.integrationApi) a.integrationApi.apiKey = maskSecret(a.integrationApi.apiKey);
  if (a.localNetwork) {
    a.localNetwork.password = maskSecret(a.localNetwork.password);
    a.localNetwork.username = maskSecret(a.localNetwork.username);
  }
  if (c.auth) c.auth.password = maskSecret(c.auth.password);
  if (c.alerts) c.alerts.webhookUrl = maskSecret(c.alerts.webhookUrl);
  return c;
}

export const ALLOWED_CONFIG_KEYS = new Set(['adapters', 'server', 'auth', 'alerts']);

/** Minimal runtime validation for a posted config (types are compile-time only). */
export function validateConfig(body: unknown): string | null {
  if (!body || typeof body !== 'object') return 'Body must be a JSON object';
  const c = body as any;
  const unknown = Object.keys(c).filter(k => !ALLOWED_CONFIG_KEYS.has(k));
  if (unknown.length) return `Unknown configuration key(s): ${unknown.join(', ')}`;
  if (!c.adapters || typeof c.adapters !== 'object') return 'Missing or invalid "adapters"';
  if (!c.server || typeof c.server !== 'object') return 'Missing or invalid "server"';
  if (c.server.port !== undefined && typeof c.server.port !== 'number') return '"server.port" must be a number';
  if (c.auth !== undefined && typeof c.auth !== 'object') return '"auth" must be an object';
  if (c.alerts !== undefined && typeof c.alerts !== 'object') return '"alerts" must be an object';
  return null;
}

/**
 * When the UI posts a config back, any secret left as the redaction mask should
 * keep the real on-disk value rather than overwriting it with '********'.
 */
export function preserveMaskedSecrets(incoming: any, existing: any): void {
  const restore = (objNew: any, objOld: any, key: string) => {
    if (objNew && objOld && objNew[key] === '********') objNew[key] = objOld[key];
  };
  const an = incoming.adapters || {};
  const ao = existing.adapters || {};
  restore(an.siteManager, ao.siteManager, 'apiKey');
  restore(an.integrationApi, ao.integrationApi, 'apiKey');
  restore(an.localNetwork, ao.localNetwork, 'password');
  restore(an.localNetwork, ao.localNetwork, 'username');
  restore(incoming.auth, existing.auth, 'password');
  restore(incoming.alerts, existing.alerts, 'webhookUrl');
}
