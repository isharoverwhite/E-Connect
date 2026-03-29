# Find Website

Public-facing E-Connect LAN scanner modeled after Synology Web Assistant. The page probes preferred local aliases such as `econnect.local` before it falls back to common private subnets, prioritizes early passes over the common `192.168.1.x`, `192.168.0.x`, and `192.168.2.x` home LAN ranges, resolves the launch host from `firmware_network.advertised_host` / `firmware_network.api_base_url`, and falls back to the probed LAN IP when the advertised alias is not reachable from that browser client. The secure public host keeps the JSONP-style `http://<candidate-ip>:8000/web-assistant.js?callback=...` transport, while LAN-hosted HTTP copies can probe `/health` directly to avoid browser script-loading deadlocks on the same runtime payload.

## Local development

```bash
npm ci
npm run dev
```

The development server runs on [http://localhost:9123](http://localhost:9123).

## Production Docker image

The project is configured with Next.js standalone output so it can run as a small production container.

Build the image:

```bash
docker build -t econnect-find-website ./find_website
```

Run it directly:

```bash
docker run --rm -p 9123:9123 econnect-find-website
```

Run it behind a reverse proxy on port 80/443:

```bash
docker run -d \
  --name econnect-find-website \
  -p 80:9123 \
  --restart unless-stopped \
  econnect-find-website
```

## Notes

- The container listens on `0.0.0.0:9123`.
- No extra runtime environment variables are required for the current discovery flow.
- The secure public page probes LAN targets directly from the browser via script injection, and LAN-hosted HTTP copies can fall back to `GET /health`.
- The backend must expose both `http://<candidate-ip>:8000/web-assistant.js?callback=...` and `http://<candidate-ip>:8000/health` for the full discovery matrix to work.
- If the server LAN publishes `econnect.local` through mDNS or router DNS, the scanner will try that alias before subnet scanning, and `.local` aliases now get a longer probe budget before the wider sweep begins.
- When the backend advertises `econnect.local` but the browser client cannot resolve that alias, the UI now falls back to the probed LAN IP so the card can still link to the WebUI when the raw IP is reachable.
- When the page itself is opened from a LAN IP or `.local` hostname, that current host is now probed before the wider subnet sweep so colocated deployments resolve faster.
- Browser behavior is transport-dependent; secure public pages can still hit mixed-content or private-network restrictions against local HTTP endpoints, so the UI now surfaces that case explicitly instead of silently returning an empty result.
