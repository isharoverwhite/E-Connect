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
7. For each candidate host, the browser injects a script tag to:
   - `http://<candidate-host>:8000/web-assistant.js?callback=<callbackName>`
8. The backend script endpoint executes inside the browser and calls the provided callback with the same runtime health payload used by `/health`.
9. The page trusts `firmware_network` as the source of truth for:
   - the preferred launch host, via `advertised_host` or the hostname embedded in `api_base_url`
   - the WebUI protocol and port
10. The page performs a lightweight website probe for the advertised WebUI and labels each hit as `online` or `offline`.
11. After the scan window closes, the page reveals the final result list.
12. The developer-hosted public page never scans the user's LAN from the developer server; all LAN discovery requests come from the user's own browser session.

## Backend Contract

- `GET /web-assistant.js?callback=<callbackName>`
  - returns JavaScript, not JSON
  - validates the callback name
  - invokes the callback with the backend health payload
  - degraded database state still returns a payload because the browser scanner only sees script success/failure, not HTTP status

## UI States

- `scanning`
- `scan complete`
- `no server found`
- `scan failed`

## Verification Hooks

- Backend:
  - `web-assistant.js` returns JavaScript with a validated callback
- Browser:
  - the browser session running [find.isharoverwhite.com](https://find.isharoverwhite.com) is on the same LAN as the user's self-hosted server
  - the deployment can resolve `econnect.local` to the server LAN IP when the alias fast path is configured
  - page can discover a fake backend through the script endpoint
  - page prefers `econnect.local`-style aliases before subnet sweeping
  - page renders scan results and empty state correctly
  - page shows no hydration/runtime errors; failed probe requests may still appear in the browser console as expected network noise

## Known Limitations

- This transport is browser-dependent; it is modeled after the current `find.synology.com` pattern observed on 2026-03-29.
- The developer-hosted public page is only the entrypoint; it cannot see the user's private LAN unless the user's browser is on that LAN and allowed to issue the probe requests.
- Without mDNS or a remote registry, the browser still probes subnets rather than a tiny fixed hostname set.
- The `.local` suffix is most reliable through mDNS/Avahi; a router DNS override for the same suffix may still lose to mDNS on some client resolvers.
- When the backend or Jenkins helper advertises `econnect.local`, Docker deployments still need an explicit or auto-detected LAN IP override because containers cannot always infer the host LAN address correctly.
