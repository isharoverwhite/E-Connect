# Find Website

Public-facing E-Connect LAN scanner modeled after Synology Web Assistant. The page probes preferred local aliases such as `econnect.local` before it falls back to common private subnets, loads `http://<candidate-ip>:8000/web-assistant.js?callback=...` from the browser, lets the backend execute a JSONP-style callback with its runtime health payload, resolves the launch host from `firmware_network.advertised_host` / `firmware_network.api_base_url`, falls back to `http://<server-ip>:3000/` only when that metadata is unusable, and keeps backend hits visible even when the WebUI probe is offline.

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
- The page probes LAN targets directly from the browser via script injection instead of `fetch`.
- The backend must expose `http://<candidate-ip>:8000/web-assistant.js?callback=...` for the scan to work.
- If the server LAN publishes `econnect.local` through mDNS or router DNS, the scanner will try that alias before brute-force subnet scanning.
- Browser behavior is transport-dependent; the current implementation is aligned with the Synology-style pattern verified on Chrome on 2026-03-29.
