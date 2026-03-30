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
3. The public page starts a LAN scan as soon as it loads.
4. The browser probes preferred aliases first:
   - `econnect.local`
   - `e-connect.local`
   - `econnect-server.local`
5. On deployments that want the alias-first fast path, the operator publishes `econnect.local` to the server LAN IP via Avahi/mDNS, router DNS, the backend's built-in mDNS publisher when the server runtime is configured with `MDNS_HOSTNAME`, or the Jenkins-managed `discovery_mdns` helper when the stack is deployed through the repository pipeline.
6. If none of the preferred aliases responds, the browser falls back to the wider candidate host list:
   - common private subnets such as `192.168.1.x`, `192.168.0.x`, `192.168.2.x`, `10.0.0.x`
7. For each candidate host, the browser uses one of these transport paths:
   - on local HTTP-hosted copies of `find_website`, the scanner may fetch `http://<candidate-host>:8000/health` directly because the backend exposes permissive CORS for that payload
   - on the secure public host, the scanner keeps the Synology-style script probe transport:
     - `http://<candidate-host>:8000/web-assistant.js?callback=<callbackName>`
8. Both discovery paths consume the same runtime health payload, and the script endpoint still invokes the provided callback when the JSONP transport is used.
9. The page trusts `firmware_network` as the source of truth for:
   - the WebUI protocol and port
   - the preferred LAN launch host, by first extracting a private IPv4 from `api_base_url`, then `advertised_host`, then the responding probe host
10. Once a private LAN IP is available, the page probes the WebUI through that IP, launches through that IP, and shows that same LAN IP as the primary host in the result card. A backend-advertised alias such as `econnect.local` may remain secondary context only.
11. The page performs a lightweight website probe for the resolved launch target and labels each hit as `online` or `offline`.
12. For the standard self-hosted Docker Compose topology, the primary WebUI launch target should remain plain `http://<lan-host>:3000` so the public finder does not depend on trusting a self-signed LAN certificate just to open the dashboard.
13. When secure-context browser features such as Web Serial are needed, the self-hosted stack may still expose an HTTPS companion origin separately from the finder launch target.
14. After the scan window closes, the page reveals the final result list, or surfaces an explicit browser-blocked failure when the secure public origin cannot reach local HTTP discovery endpoints.
15. The developer-hosted public page never scans the user's LAN from the developer server; all LAN discovery requests come from the user's own browser session.

## Backend Contract

- `GET /web-assistant.js?callback=<callbackName>`
  - returns JavaScript, not JSON
  - validates the callback name
  - invokes the callback with the backend health payload
  - degraded database state still returns a payload because the browser scanner only sees script success/failure, not HTTP status
- `GET /health`
  - returns the same runtime health payload as JSON
  - may be consumed directly by local HTTP-hosted scanner copies because the backend CORS policy allows browser access on the LAN

## UI States

- `scanning`
- `scan complete`
- `no server found`
- `scan failed`
- `scan failed (secure-origin browser block)`
- no permanent HTTPS warning banner before a secure scan actually ends empty or fails

## Verification Hooks

- Backend:
  - `web-assistant.js` returns JavaScript with a validated callback
- Browser:
  - the browser session running [find.isharoverwhite.com](https://find.isharoverwhite.com) is on the same LAN as the user's self-hosted server
  - the deployment can resolve `econnect.local` to the server LAN IP when the alias fast path is configured
  - a local HTTP-hosted copy of the page can discover a fake backend through `/health`
  - the secure public page either discovers the server through the script probe or surfaces the secure-origin browser-blocked failure explicitly
  - page prefers `econnect.local`-style aliases before subnet sweeping
  - once discovery succeeds, the result card and launch link use the resolved LAN IP instead of the mDNS alias
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
