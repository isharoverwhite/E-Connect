# Find Website

Public-facing E-Connect LAN scanner modeled after Synology Web Assistant. The page probes preferred local aliases such as `econnect.local` first, then tries the browser client's current private subnet when available, and only then falls back to broader common private subnets. It launches the WebUI from the responding probe host plus the sanitized transport hints returned by the backend. The secure public host keeps the JSONP-style `http://<candidate-ip>:8000/web-assistant.js?callback=...` transport, while LAN-hosted HTTP copies can probe `/health` directly to avoid browser script-loading deadlocks on the same runtime payload.

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
- The discovery payload stays sanitized for public exposure: it includes only `status`, `database`, `mqtt`, `initialized`, the explicit LAN `server_ip` when available, and minimal `webapp` transport hints (`protocol`, `port`).
- If the server LAN publishes `econnect.local` through mDNS or router DNS, the scanner will try that alias before subnet scanning, and `.local` aliases now get a longer probe budget before the wider sweep begins.
- For self-hosted Docker Compose deployments, the recommended way to publish `econnect.local` is the built-in `discovery-mdns` profile in `docker-compose.yml`, which runs `discovery_mdns` from the backend runtime on host networking.
- When the backend provides `server_ip`, the result card should show that LAN IP as the main identity and keep aliases such as `econnect.local` only as secondary advertised metadata. During rollout, legacy backends may still let the card show an advertised alias until they expose `server_ip`.
- When the page itself is opened from a LAN IP or `.local` hostname, that current host is now probed before the wider subnet sweep so colocated deployments resolve faster.
- Browser behavior is transport-dependent; secure public pages can still hit mixed-content or private-network restrictions against local HTTP endpoints, so the UI only surfaces that guidance after a secure-origin scan ends empty or fails instead of showing a permanent warning banner on load.
