#!/usr/bin/env node
// Probe the UniFi Network Integration API and dump raw JSON shapes so we can
// confirm the field mapping in IntegrationApiAdapter against the live controller.
//
// Usage:
//   UNIFI_API_KEY=xxxx node server/scripts/probe-integration.mjs [baseUrl]
//
// baseUrl defaults to https://10.0.0.1

import https from 'node:https';

const baseUrl = (process.argv[2] || 'https://10.0.0.1').replace(/\/+$/, '');
const apiKey = process.env.UNIFI_API_KEY;
const PREFIX = '/proxy/network/integration/v1';

if (!apiKey) {
  console.error('Missing UNIFI_API_KEY env var.');
  process.exit(1);
}

const agent = new https.Agent({ rejectUnauthorized: false });

function get(path) {
  return new Promise((resolve, reject) => {
    const url = `${baseUrl}${path}`;
    const req = https.request(
      url,
      { method: 'GET', agent, headers: { 'X-API-KEY': apiKey, Accept: 'application/json' } },
      res => {
        let body = '';
        res.on('data', c => (body += c));
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(body);
          } catch {
            parsed = body;
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function show(label, res) {
  console.log(`\n=== ${label} (HTTP ${res.status}) ===`);
  const b = res.body;
  const sample = b?.data ? { ...b, data: (b.data || []).slice(0, 2) } : b;
  console.log(JSON.stringify(sample, null, 2));
}

const main = async () => {
  const sites = await get(`${PREFIX}/sites`);
  show('GET /sites', sites);

  const siteId = sites.body?.data?.[0]?.id;
  if (!siteId) {
    console.error('\nNo site id returned; cannot probe further.');
    return;
  }

  const devices = await get(`${PREFIX}/sites/${siteId}/devices?limit=200`);
  show('GET /sites/{siteId}/devices', devices);

  const deviceId = devices.body?.data?.[0]?.id;
  if (deviceId) {
    show(
      'GET /sites/{siteId}/devices/{id} (detail)',
      await get(`${PREFIX}/sites/${siteId}/devices/${deviceId}`)
    );
    show(
      'GET /sites/{siteId}/devices/{id}/statistics/latest',
      await get(`${PREFIX}/sites/${siteId}/devices/${deviceId}/statistics/latest`)
    );
  }

  show(
    'GET /sites/{siteId}/clients',
    await get(`${PREFIX}/sites/${siteId}/clients?limit=200`)
  );
};

main().catch(err => {
  console.error('Probe failed:', err.message);
  process.exit(1);
});
