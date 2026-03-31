# Screens and UI Flow Details

## Global Error States
- **Server Offline**:
  - If the Webapp cannot connect to the backend server (e.g. `ERR_CONNECTION_REFUSED`), the main application wrapper (`AuthProvider`) must immediately interrupt rendering completely.
  - The UI must display a standalone, prominent "Cannot connect to server" error page instead of falling back to a broken login form or blank screen.
  - This state must provide a "Retry" or "Refresh" action that re-evaluates the server status without requiring a manual page reload.

## Application Shell
- Desktop admin surfaces such as `/settings`, `/automation`, and `/extensions` must use the shared application sidebar instead of page-local navigation variants.
- The shared desktop sidebar must support both expanded and collapsed states while keeping route icons, the settings link, account badge, and logout action accessible.

## Login Page
- The login form must submit a real session request to `/api/v1/auth/token` and store the returned access/refresh session contract instead of a single long-lived bearer token.
- The form must expose a `Keep login` checkbox.
  - When unchecked, the UI uses a sliding session backed by refresh tokens and auto-logs the user out after 4 hours without interaction.
  - When checked, the UI keeps the login session persistent and must not force an inactivity logout.
- Failed login or refresh responses must surface a user-facing error and return the UI to `/login` when the session can no longer be renewed.

## Settings Page
- Entering `/settings` must land on the **`general`** tab first, including for `admin` users.
- **`general`**: Overview of instance and user baseline.
  - The general panel must show the active runtime `server host/IP` and `MQTT broker host/IP` that the backend is currently advertising for provisioning.
  - Only `admin` users may view those provisioning targets in Settings; non-admin users must not see the card and must not be allowed to query the backing endpoint.
  - The admin-visible panel must also surface the current `MQTT port` and `API base URL`, plus a clear loading or error state if the runtime network target cannot be resolved.
  - If backend startup audit finds DIY projects or linked boards stamped with older server/MQTT targets, the same panel must show a warning that manual reflash is required before those boards can pair against the current runtime target.
- **`users`**: Admin user management panel to provision and approve/revoke accounts.
  - The create-user form must show inline client-side validation before submit for missing `username`, `full name`, and `password`.
  - The create-user form must require a minimum username length of `3` characters and a minimum password length of `8` characters before it sends the request.
- **`rooms`**: Admin panel for managing room access control.
  - The create-room form must show an inline required-name validation message before it attempts the create request.
- **`wifi` (New)**: Admin panel for managing saved Wi-Fi credentials.
  - Only `admin` users may see the Wi-Fi credentials tab or call its backing endpoints.
  - The panel must show credentials as a list with visible `SSID` and masked password only.
  - The panel must support create, edit, and delete for saved credentials.
  - Viewing the real password for one credential must open a confirmation flow that requires the password of the signed-in account before the backend returns the secret.
  - A wrong or missing account password must keep the secret hidden and show an inline error in the reveal flow.
  - If no Wi-Fi credentials exist yet, the panel must show an explicit empty state that tells the admin to add the first network before using the DIY provisioning flow.
- **`configs` (New)**: Admin panel for managing DIY Config projects.
  - Lists all project records.
  - Usage state badges: **`unused`** and **`in_use`**.
  - Deleting an `in_use` config is blocked and shows an informative tooltip/error indicating which devices use it.
  - Deleting an `unused` config must open a destructive confirmation modal that requires the signed-in account password before the backend accepts the delete request.
  - A wrong or missing password must keep the config intact and surface an inline error inside that confirmation modal.
  - Clicking a config triggers a detailed dialog showing JSON mapping and device usage lists.
  - Deleting a config successfully cleans up backend records and is updated responsively on the UI.

## Automation Page
- **Stitch Reference:** Project `13695840913426182114`, Screen `c22331a5ca494ab3839da9da688a1f6e` (Automation Rule Builder).
- The automation page must keep the shared application shell and visual language already used by `/settings`, `/devices`, and other admin surfaces.
- Creating or editing an automation must happen in a visual graph builder with draggable blocks and typed input/output ports, similar to a Blender-style node editor.
- The automation canvas must support pan/zoom so larger flows remain readable.
- The main node families for R1 are:
  - `Trigger`: device input/state update, sensor telemetry update, or manual test event
  - `Condition`: boolean state match, numeric threshold/range check, and logical combination when multiple conditions are needed
  - `Action`: turn a target output on/off or set a numeric output value on another circuit/device
- The UI must let the user bind real source devices/inputs and target devices/outputs directly from the current inventory. It must not expose a free-form script editor or recurring schedule form as the primary authoring model.
- Invalid graphs such as dangling edges, incompatible port connections, missing targets, or cycles must surface inline validation before save/enable.
- Each automation card/detail view must show whether the automation is enabled, a summary of the source trigger path, the target action summary, and the last execution result.
- The page must keep explicit `loading`, `empty`, `success`, `validation error`, and `server error` states.
- If no compatible devices or IO points exist yet, the page must show a blocking empty state that directs the user to onboard devices first.
- Any manual test control must execute against the saved graph model and surface a real execution log rather than a fake preview-only result.

## DIY Builder
- **Step 1 / Boards**:
  - The board-family picker must expose `ESP8266` as a first-class family next to the existing ESP32 families.
  - Supported ESP8266 profiles are `NodeMCU (v2/v3)`, `WeMos D1 mini`, `WeMos D1 mini Pro`, `ESP-01 / ESP-01S (1MB)`, and `ESP-12E / ESP-12F Module`.
  - Board summaries must show truthful defaults for CPU MHz, flash size, PSRAM, serial bridge, and warnings.
  - Board cards must not show a `Web flash` badge unless the profile still exposes a maintained demo manifest in the active delivery path.
  - The builder collects Wi-Fi credentials only; it must not expose a separate MQTT broker field.
  - Instead of free-typing SSID/password on each new project, the admin must pick one saved Wi-Fi credential from Settings.
  - If no saved Wi-Fi credential exists, the builder must show a blocking empty state or inline warning and direct the admin to add one in Settings first.
  - The selected Wi-Fi credential must persist with the DIY project and reload when the project is reopened.
  - The server-side build flow must prefer the runtime targets detected at backend startup for firmware stamping and only fall back to request-derived headers when startup auto-detect is unavailable.
  - The runtime MQTT broker target may differ from the API host when operators explicitly configure a public firmware-broker override; otherwise firmware may default to the same public host/IP as the API target.
- **Step 2 / Pin Mapping**:
  - PWM pins must accept either ascending or descending `min/max` ranges.
  - A descending range such as `255 -> 0` means the board should treat logical `value=0` as the high-duty endpoint and logical `value=1` as the low-duty endpoint for active-low outputs.
  - Dashboard slider controls must still render with a valid numeric range even when the stored PWM endpoints are descending.
  - The SVG board visualizer must support interactive pan and zoom (scroll/pinch) so that dense pin maps are legible.
  - The workspace layout must scale responsively, switching from a top-to-bottom layout on mobile to a side-by-side flex representation on desktop widths.
- **Step 4 / Flash**:
  - The flash step must surface the current server/MQTT host that the next server build will embed into firmware.
  - The flash step must only expose website-managed firmware sources. `Upload Custom Build` is not an allowed source in the DIY wizard.
  - When the backend runs inside Docker and startup auto-detect only sees a container-bridge IP, the flow must instruct operators to use `network_mode: host` or an explicit public-base override before trusting automatic firmware IP stamping.
  - If the runtime server target or runtime MQTT broker target differs from the last successful build target, the old artifact is stale and must not be treated as flash-ready for nearby pairing.
  - Boards that reconnect while reporting embedded firmware targets different from the current runtime target must be told that manual reflash is required instead of being treated as healthy pair candidates.
  - ESP32-family application-only server builds remain single-binary manifests at `0x10000`.
  - ESP8266 single-binary server builds and maintained demo manifests must produce a manifest that flashes `firmware.bin` at `0x0`.
  - The standard self-hosted Docker Compose runtime must expose a plain `http://` dashboard origin on port `3000` so the public finder can launch the LAN UI without depending on browser trust for a self-signed certificate.
  - The webapp runtime must also expose an HTTPS companion origin on port `3443`, auto-generate local TLS assets when missing, and preserve secure-origin access for Web Serial / ESP Web Tools on LAN hosts that explicitly reopen the secure companion URL.
  - If a board no longer has a maintained demo manifest, the `Bundled Demo` source must be hidden and `/api/diy/demo-firmware/...` must fail closed with a `404` JSON response instead of reading local filesystem artifacts from the webapp container.
  - When a server build reaches `artifact_ready`, the backend must auto-release the same-user serial reservation stored in `config.serial_port`.
  - When a server build reaches `artifact_ready`, the frontend must also close any stale in-page `esp-web-tools` dialog, remount the install button, and re-check the selected port before the next browser flash launch.
  - The browser flasher becomes available only when the artifact/manifest is ready and the configured serial port is free; if any serial session still holds the port, the screen must show a release-first blocking message.
  - When Web Serial is unavailable because the page is not in a secure context, the lock message must direct the user to reopen the page on the HTTPS companion origin instead of implying that the plain HTTP dashboard origin is unsupported for all use cases.

## Managed Device Reconfiguration
- **`/devices/[id]/config`**:
  - Only `admin` users may open the managed-device reconfiguration screen.
  - The screen must load the linked DIY project board profile and the device's current persisted GPIO mapping, then let the admin edit pins on that same board.
  - The screen must also show which saved Wi-Fi credential is currently attached to that managed device's linked DIY project and allow the admin to switch to another saved credential before rebuild.
  - The screen must surface inline `validation error`, `warning`, and `success` feedback for pin edits instead of relying on browser alerts alone.
  - Saving a changed pin map is safety-sensitive because an invalid wiring or GPIO role can damage hardware; the save action must open a confirmation modal that requires the password of the signed-in account before the backend accepts the change.
  - A wrong or missing password must keep the device config unchanged and show an inline error inside that confirmation modal.
  - A successful confirmation must persist the updated pin mapping and selected Wi-Fi credential to the managed DIY project and the linked device record, then start a new firmware rebuild for that device.
  - The OTA dialog must stay blocked until the rebuild reaches `artifact_ready`, then allow the admin to send the OTA command for that exact build job.
  - The OTA dialog must show `building`, `artifact_ready`, `flashing`, `flashed`, and `flash_failed` states, plus a clear close path when the build itself fails.
  - After the OTA job reaches `flashed`, the dialog must wait for the board to report `online` again on the expected firmware version for that exact build before showing the final success state, then return the admin to the dashboard automatically.

## Dashboard And Discovery
- **Public discovery page (`find_website`)**:
  - The page is scan-only: no helper download, session code, or CLI instructions appear in the UI.
  - The public host uses a white/light surface with blue accents so the discovery page matches the WebUI theme instead of the older dark/green shell.
  - The page keeps the centered radar, sticky header, and stacked result-card layout from the existing scanner rather than switching to a marketing-style landing page.
  - The secure public page must not show a permanent warning banner on initial load just because it is running on HTTPS or through Cloudflare Tunnel; browser-transport guidance belongs in the contextual empty/failure copy after a secure scan ends without a usable result.
  - The secure public page should auto-start scanning shortly after load instead of waiting at a manual `Start LAN Scan` gate; the button remains available as a retry path when the browser blocks the local bridge attempt.
  - If the local bridge popup is blocked or closes before posting a result, the scan must continue with the normal alias-first and subnet JSONP sweep instead of hard-failing immediately.
  - The secure public host probes LAN targets with the Synology-style `http://<candidate-ip>:8000/web-assistant.js?callback=...` transport, while LAN-hosted HTTP copies may fall back to `GET /health` on the same backend when direct JSONP probing proves unreliable.
  - The scanner must try `econnect.local` first, followed by other approved local aliases, before it starts sweeping common private subnets.
  - When the scanner is hosted from a LAN IP or `.local` origin, it must probe that current host before the wider subnet sweep so a colocated `find_website` reaches its paired backend quickly.
  - The page must show explicit `scanning`, `scan complete`, `no servers found`, and `scan failed` states.
  - If the secure public page cannot reach local HTTP discovery endpoints because the browser blocks that transport, the UI must show an explicit failure message instead of silently reporting a normal empty scan.
  - The scanner must keep detected servers hidden while the active scan window is still running, then reveal the full list only after the scan completes.
  - The active scan window is `15s` by default, but once any server is detected the scanner must shorten the run to a total `7s` timeout before revealing results.
- **Backend discovery script (`server`)**:
  - The browser-facing script endpoint returns JavaScript that invokes a validated callback with the same runtime health payload used by `/health`.
  - The discovery payload exposed by `/health`, `/web-assistant.js`, and `/discovery-bridge` must stay sanitized: it may expose only high-level server status (`status`, `database`, `mqtt`, `initialized`), the explicit LAN `server_ip` when available, plus minimal WebApp transport hints needed for launch (`webapp.protocol`, `webapp.port`).
  - The discovery payload must not expose backend-internal hostnames, raw API base URLs, MQTT broker hostnames, target keys, stale project counts, stale device counts, or raw backend error strings.
  - When the operator publishes an alias such as `econnect.local` and the self-hosted machine exposes host port `80`, opening `http://econnect.local` must redirect to the current WebUI transport on that same host. For the standard Docker Compose runtime, the default redirect target is `http://econnect.local:3000/`.
  - The scanner derives the WebUI protocol and port from the sanitized `webapp` transport hints and uses the responding probe host as the primary launch identity. Legacy `firmware_network` fields may be read only as a backward-compatible fallback during rollout.
  - The result card must show truthful server status for `Database`, `Initialized`, `MQTT Broker`, and `Web App`. When the backend provides `server_ip`, the card must show that LAN IP as the visible identity and may show an alias such as `econnect.local` only as secondary advertised metadata.
  - For the standard Docker Compose runtime, the finder should prefer a plain `http://<lan-host>:3000` launch target so LAN discovery does not fail on a self-signed HTTPS certificate before the dashboard even opens.
  - If the secure public page receives a private/LAN transport of `https://<host>:3000` and that probe fails, the scanner must retry `http://<host>:3000` before marking the WebUI offline.
  - If the backend still does not expose a usable WebApp transport after that retry, the scanner must keep the server card visible and report the website as offline instead of guessing alternate ports.
  - A backend-responsive server must remain visible in scan results even when the website probe fails, and the result card must show whether the website is currently `online` or `offline`.
- **Device Management screen**:
  - The page header must keep the title block readable while preserving the admin action set `SVG Builder`, `Discover New`, and `Refresh`.
  - Action labels must stay on a single line inside each button; when horizontal space becomes tight, the action group wraps beneath the title or onto a new row as whole buttons instead of compressing text inside the buttons.
  - On narrow widths, button tap targets, icon alignment, and vertical rhythm must remain consistent even when the action group spans multiple rows.
  - Each admin device card must show both the developer-managed `firmware revision` and the runtime `firmware version` built from the current user configuration.
  - If a board has not reported either firmware field yet, the card must show a clear fallback such as `Unknown` instead of leaving the value blank.
- **Dashboard notifications**:
  - The pairing notification card only appears when the server has at least one active board-initiated pairing request.
  - A device that was merely unpaired from the dashboard must not create a pairing notification by itself.
  - Notification badge counts must include both offline alerts and active pairing requests.
- **Dashboard runtime controls**:
  - When a user toggles an on/off control, the switch must stay in an inline loading state until the backend/device reports the requested target state.
  - The switch must not visually flip to the requested state before the confirmed `device_state` / command result arrives.
  - If the command fails or times out, the loading state clears and the switch remains at the last confirmed state.
- **Discovery screen**:
  - Discovery reflects only pairing requests that successfully reached the current server; it is not proof of generic LAN or mDNS visibility.
  - If the server moves to a new IP/hostname, boards flashed with older artifacts remain invisible here until rebuilt and reflashed against the new server/MQTT host.
  - A board flashed from a website-managed server build may skip manual approval only when its secure onboarding identity still matches the system-issued firmware metadata: the `UUID` must match the project-derived device id and the reported `name` must match the firmware-stamped device name.
  - On the first successful secure onboarding handshake, the backend must bind the reported `MAC address` to that trusted device record. Later secure handshakes must keep `UUID`, stored `name`, and stored `MAC address` aligned; otherwise the request must fail closed instead of silently overwriting the trusted record or auto-provisioning dashboard widgets.
  - The discovery list must only show pending devices whose latest state is an active pairing request.
  - A device that already has an active pending pairing request must stay in `awaiting approval`; heartbeat/state traffic must not push it into a fresh `re-pair required` loop.
  - If an admin unpairs a board by mistake, the board remains hidden until it handshakes again, then re-enters discovery as a fresh pairing candidate.
  - The `Ignore` action is a real reject operation, not a local dismiss-only control.
  - After `Ignore`, the backend must notify the board that pairing was rejected.
  - A rejected board must stay out of discovery until it is power-cycled and sends a fresh registration request.
