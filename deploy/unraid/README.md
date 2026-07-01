# Deploying UniFiLanCast on Unraid

Single container: the Node server serves the REST/SSE API **and** the web UI, so
there's nothing else to run. This guide binds it to the LAN with the app's
built-in HTTP Basic auth. (Prefer HTTPS + a hostname? Put it behind Nginx Proxy
Manager instead — bind loopback and proxy `:3001`.)

Everything runs on the Unraid box (SSH/terminal or the **Docker Compose Manager**
plugin). The steps below assume the terminal.

## 1. Get the code + a data dir

```bash
mkdir -p /mnt/user/appdata/unifilancast/data
git clone https://github.com/HouseofTyrell/UniFiLanCast /mnt/user/appdata/unifilancast/src
cd /mnt/user/appdata/unifilancast/src
```

## 2. Confirm the host port is free (8080 was taken; using 61288)

```bash
ss -tlnp | grep ':61288 ' && echo 'IN USE — pick another' || echo '61288 is free'
```

If `61288` is taken, choose another and change the **left** side of
`"61288:3001"` in `deploy/unraid/docker-compose.yml`. You'll reach the app at
`http://10.0.0.22:<that-port>`.

## 3. Configure

Copy the example and edit it:

```bash
cp config.example.json /mnt/user/appdata/unifilancast/config.json
nano /mnt/user/appdata/unifilancast/config.json
```

Make sure it enables the real adapter and auth, and that mock is off:

```jsonc
{
  "adapters": {
    "mock": { "enabled": false },
    "integrationApi": {
      "enabled": true,
      "baseUrl": "https://10.0.0.1",     // your UniFi controller
      "apiKeyEnv": "UNIFI_API_KEY",
      "verifySsl": false                 // self-signed controller cert
    }
  },
  "auth": {
    "enabled": true,                     // REQUIRED for a LAN bind (fail-closed)
    "username": "admin",
    "passwordEnv": "UNIFI_AUTH_PASSWORD"
  },
  "server": { "port": 3001 }             // container-internal; leave as-is
}
```

## 4. Secrets (never committed)

```bash
printf 'UNIFI_API_KEY=your-local-integration-key\nUNIFI_AUTH_PASSWORD=choose-a-strong-one\n' \
  > /mnt/user/appdata/unifilancast/.env
```

The API key is a **local UniFi Network Integration** key (Network app → Settings →
Control Plane → Integrations → Create API Key) — not a `unifi.ui.com` cloud key.

## 5. Build + run

```bash
docker compose -f deploy/unraid/docker-compose.yml up -d --build
```

First build takes a couple minutes (it compiles `better-sqlite3` for musl). Then:

- **App:** `http://10.0.0.22:61288` (prompts for the Basic-auth login)
- **Logs:** `docker logs -f unifilancast`
- **Health:** `curl -u admin:PASS http://10.0.0.22:61288/api/status`

## 6. Updating

```bash
cd /mnt/user/appdata/unifilancast/src && git pull
docker compose -f deploy/unraid/docker-compose.yml up -d --build
```

SQLite history + the device inventory survive rebuilds (they live in the
`data/` bind mount, not the image).

## Notes

- The container reads the network it runs on, **including this Unraid box** — it
  shows up as a client like anything else.
- The LAN/inter-VLAN accounting gap (a host's upload to another VLAN may not be
  attributed to it) is a UniFi-side limitation and is unchanged by where this runs.
- To move behind Nginx Proxy Manager later: set the port mapping to
  `127.0.0.1:3001:3001`, keep `auth.enabled` (or turn it off and let NPM handle
  auth + HTTPS), and add a proxy host pointing at the Unraid IP on that port.
