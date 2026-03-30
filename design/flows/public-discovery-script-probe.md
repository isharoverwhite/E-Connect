# Public Discovery With Browser Script Probes

## Goal

Let end users finish setting up their self-hosted E-Connect stack at home, then open the public discovery page and scan their local LAN without installing or running a visible helper tool.

## Actors

- `Public Page`: the developer-hosted `find_website` at [find.isharoverwhite.com](https://find.isharoverwhite.com)
- `Browser Scanner`: JavaScript running inside the user's browser tab
- `E-Connect Server`: the self-hosted `server` inside the user's LAN, paired with the user's own `webapp`, `mqtt`, and `db`

## Flow

1. The user completes setup of the self-hosted E-Connect stack on their own server or mini-PC at home.
2. From a device on the same LAN, the user opens [find.isharoverwhite.com](https://find.isharoverwhite.com).
3. On local HTTP-hosted copies of the page, the browser may still start scanning immediately on load.
4. On the secure public host, the page auto-starts LAN discovery shortly after load and immediately attempts the local bridge fast path from the user's browser session.
5. The browser probes preferred aliases first:
   - `econnect.local`
   - `e-connect.local`
   - `econnect-server.local`
6. On deployments that want the alias-first fast path, the operator publishes `econnect.local` to the server LAN IP via Avahi/mDNS, router DNS, the backend's built-in mDNS publisher when the server runtime is configured with `MDNS_HOSTNAME`, or the Jenkins-managed `discovery_mdns` helper when the stack is deployed through the repository pipeline.
7. For the standard self-hosted Docker Compose topology, the server also exposes a bare HTTP landing port on host `80`; opening `http://econnect.local` on the LAN must redirect to the current WebUI transport on the same hostname, which defaults to `http://econnect.local:3000/`.
8. On the secure public host, the first interactive scan attempt opens a temporary popup or tab to the preferred alias on the user's LAN:
   - `http://<preferred-alias>:8000/discovery-bridge?...`
   - the bridge page runs on the local HTTP origin, reads the same health payload as `/health`, then posts that payload back to the public page with `window.opener.postMessage(...)`
9. If none of the preferred aliases responds, the browser falls back to the wider candidate host list:
   - common private subnets such as `192.168.1.x`, `192.168.0.x`, `192.168.2.x`, `10.0.0.x`
10. For each candidate host, the browser uses one of these transport paths:
   - on local HTTP-hosted copies of `find_website`, the scanner may fetch `http://<candidate-host>:8000/health` directly because the backend exposes permissive CORS for that payload
   - on the secure public host, the interactive fast path prefers the local bridge popup for `.local` aliases
   - on the secure public host, the non-interactive fallback still keeps the Synology-style script probe transport:
     - `http://<candidate-host>:8000/web-assistant.js?callback=<callbackName>`
11. Both discovery paths consume the same runtime health payload, and the script endpoint still invokes the provided callback when the JSONP transport is used.
12. The health payload exposed to the public scanner must stay discovery-safe:
   - include only `status`, `database`, `mqtt`, `initialized`, and minimal `webapp` transport hints such as `protocol` and `port`
   - do not expose `advertised_host`, raw `api_base_url`, MQTT broker hostnames, target keys, stale-count audit values, or raw backend errors
13. The page derives the launch target from the responding probe host plus the sanitized `webapp` transport hints. When a legacy backend still returns the older `firmware_network` fields, the page may use them as a backward-compatible fallback during rollout.
14. The page performs a lightweight website probe for the resolved launch target and labels each hit as `online` or `offline`.
15. On the secure public host, if a private/LAN target still advertises the legacy transport `https://<host>:3000` and that probe fails, the scanner retries `http://<host>:3000` before declaring the WebUI offline.
16. For the standard self-hosted Docker Compose topology, the primary WebUI launch target should remain plain `http://<lan-host>:3000` so the public finder does not depend on trusting a self-signed LAN certificate just to open the dashboard.
17. When secure-context browser features such as Web Serial are needed, the self-hosted stack may still expose an HTTPS companion origin separately from the finder launch target.
18. After the scan window closes, the page reveals the final result list, or surfaces an explicit browser-blocked failure plus a retry action when the secure public origin cannot reach local HTTP discovery endpoints.
19. The developer-hosted public page never scans the user's LAN from the developer server; all LAN discovery requests come from the user's own browser session.

## Backend Contract

- `GET /web-assistant.js?callback=<callbackName>`
  - returns JavaScript, not JSON
  - validates the callback name
  - invokes the callback with the backend health payload
  - degraded database state still returns a payload because the browser scanner only sees script success/failure, not HTTP status
- `GET /discovery-bridge?target_origin=<origin>&request_id=<id>`
  - returns a tiny HTML page served from the user's local E-Connect server over HTTP
  - validates the public-page target origin and request id
  - posts the backend health payload back to the public page with `window.opener.postMessage(...)`
  - exists specifically so the secure public page can receive local-LAN discovery data without executing mixed-content JavaScript inside the HTTPS tab
- `GET /`
  - on the host-mapped HTTP landing port, returns a redirect to the current WebUI transport on the same host
  - for the standard compose runtime, the expected redirect target is `http://<alias-or-lan-host>:3000/`
- `GET /health`
  - returns the same runtime health payload as JSON
  - keeps the payload limited to server-safe discovery status plus minimal WebUI transport hints
  - may be consumed directly by local HTTP-hosted scanner copies because the backend CORS policy allows browser access on the LAN

## UI States

- `scanning`
- `scan complete`
- `no server found`
- `scan failed`
- `scan failed (secure-origin browser block)`
- `ready to scan` may appear briefly before the automatic secure-page scan starts, and remains the fallback idle state before a manual retry
- no permanent HTTPS warning banner before a secure scan actually ends empty or fails

## Verification Hooks

- Backend:
  - `web-assistant.js` returns JavaScript with a validated callback
- Browser:
  - the browser session running [find.isharoverwhite.com](https://find.isharoverwhite.com) is on the same LAN as the user's self-hosted server
  - the deployment can resolve `econnect.local` to the server LAN IP when the alias fast path is configured
  - on the secure public host, opening the page auto-starts the local bridge window flow and receives a `postMessage` payload from the LAN server
  - when host port `80` is available, opening `http://econnect.local` returns a redirect to the advertised WebUI host and port
  - a local HTTP-hosted copy of the page can discover a fake backend through `/health`
  - the secure public page either discovers the server through the bridge fast path or continues with alias/subnet JSONP probing before surfacing a secure-origin browser-blocked failure
  - page prefers `econnect.local`-style aliases before subnet sweeping
  - once discovery succeeds, the result card and launch link use the responding probe host plus the sanitized WebUI transport hints, while legacy payloads may still expose the older LAN-IP preference during rollout
  - page renders scan results and empty state correctly
  - page shows no hydration/runtime errors; failed probe requests may still appear in the browser console as expected network noise
  - Jenkins CD runs a post-deploy Playwright smoke against both the LAN-hosted `find_website` and the public page
  - the LAN-hosted smoke must finish with `Scan Results`
  - the secure public-page smoke may finish with either `Scan Results` or the explicit browser-blocked `Scan Failed` state, and the build log must still print browser console/request failures for auditability

## Known Limitations

- This transport is browser-dependent; it is modeled after the current `find.synology.com` pattern observed on 2026-03-29.
- The developer-hosted public page is only the entrypoint; it cannot see the user's private LAN unless the user's browser is on that LAN and allowed to issue the probe requests.
- Without mDNS or a remote registry, the browser still probes subnets rather than a tiny fixed hostname set.
- The `.local` suffix is most reliable through mDNS/Avahi; a router DNS override for the same suffix may still lose to mDNS on some client resolvers.
- When the backend or Jenkins helper advertises `econnect.local`, Docker deployments still need an explicit or auto-detected LAN IP override because containers cannot always infer the host LAN address correctly.
- Browsers can still block `http://<candidate-host>:8000/...` from the secure public origin because of mixed-content or private-network restrictions, even when the backend is healthy on the LAN.
- The interactive bridge flow depends on one user gesture and a browser window or popup that can open a local HTTP page on the LAN alias, but popup failure alone must not abort the later JSONP alias/subnet scan path.
