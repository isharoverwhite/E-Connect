# Screens and UI Flow Details

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
- **`rooms`**: Admin panel for managing room access control.
- **`configs` (New)**: Admin panel for managing DIY Config projects.
  - Lists all project records.
  - Usage state badges: **`unused`** and **`in_use`**.
  - Deleting an `in_use` config is blocked and shows an informative tooltip/error indicating which devices use it.
  - Deleting an `unused` config must open a destructive confirmation modal that requires the signed-in account password before the backend accepts the delete request.
  - A wrong or missing password must keep the config intact and surface an inline error inside that confirmation modal.
  - Clicking a config triggers a detailed dialog showing JSON mapping and device usage lists.
  - Deleting a config successfully cleans up backend records and is updated responsively on the UI.

## DIY Builder
- **Step 1 / Boards**:
  - The board-family picker must expose `ESP8266` as a first-class family next to the existing ESP32 families.
  - Supported ESP8266 profiles are `NodeMCU (v2/v3)`, `WeMos D1 mini`, `WeMos D1 mini Pro`, `ESP-01 / ESP-01S (1MB)`, and `ESP-12E / ESP-12F Module`.
  - Board summaries must show truthful defaults for CPU MHz, flash size, PSRAM, serial bridge, and warnings.
  - Board cards must not show a `Web flash` badge unless the profile still exposes a maintained demo manifest in the active delivery path.
  - The builder collects Wi-Fi credentials only; it must not expose a separate MQTT broker field.
  - The server-side build flow must prefer the runtime targets detected at backend startup for firmware stamping and only fall back to request-derived headers when startup auto-detect is unavailable.
  - The runtime MQTT broker target may differ from the API host when operators explicitly configure a public firmware-broker override; otherwise firmware may default to the same public host/IP as the API target.
- **Step 2 / Pin Mapping**:
  - PWM pins must accept either ascending or descending `min/max` ranges.
  - A descending range such as `255 -> 0` means the board should treat logical `value=0` as the high-duty endpoint and logical `value=1` as the low-duty endpoint for active-low outputs.
  - Dashboard slider controls must still render with a valid numeric range even when the stored PWM endpoints are descending.
- **Step 4 / Flash**:
  - The flash step must surface the current server/MQTT host that the next server build will embed into firmware.
  - The flash step must only expose website-managed firmware sources. `Upload Custom Build` is not an allowed source in the DIY wizard.
  - When the backend runs inside Docker and startup auto-detect only sees a container-bridge IP, the flow must instruct operators to use `network_mode: host` or an explicit public-base override before trusting automatic firmware IP stamping.
  - If the runtime server target or runtime MQTT broker target differs from the last successful build target, the old artifact is stale and must not be treated as flash-ready for nearby pairing.
  - Boards that reconnect while reporting embedded firmware targets different from the current runtime target must be told that manual reflash is required instead of being treated as healthy pair candidates.
  - ESP32-family application-only server builds remain single-binary manifests at `0x10000`.
  - ESP8266 single-binary server builds and maintained demo manifests must produce a manifest that flashes `firmware.bin` at `0x0`.
  - The DIY builder must no longer treat plain `http://` origins as a supported access path. The frontend runtime must terminate on HTTPS, auto-generate local TLS assets when missing, and preserve secure-origin access for Web Serial / ESP Web Tools on LAN hosts.
  - If a board no longer has a maintained demo manifest, the `Bundled Demo` source must be hidden and `/api/diy/demo-firmware/...` must fail closed with a `404` JSON response instead of reading local filesystem artifacts from the webapp container.
  - When a server build reaches `artifact_ready`, the backend must auto-release the same-user serial reservation stored in `config.serial_port`.
  - When a server build reaches `artifact_ready`, the frontend must also close any stale in-page `esp-web-tools` dialog, remount the install button, and re-check the selected port before the next browser flash launch.
  - The browser flasher becomes available only when the artifact/manifest is ready and the configured serial port is free; if any serial session still holds the port, the screen must show a release-first blocking message.
  - When Web Serial is unavailable because the page is not in a secure context, the lock message must explain that only the HTTPS origin is supported for the frontend and plain HTTP is intentionally blocked.

## Managed Device Reconfiguration
- **`/devices/[id]/config`**:
  - Only `admin` users may open the managed-device reconfiguration screen.
  - The screen must load the linked DIY project board profile and the device's current persisted GPIO mapping, then let the admin edit pins on that same board.
  - The screen must surface inline `validation error`, `warning`, and `success` feedback for pin edits instead of relying on browser alerts alone.
  - Saving a changed pin map is safety-sensitive because an invalid wiring or GPIO role can damage hardware; the save action must open a confirmation modal that requires the password of the signed-in account before the backend accepts the change.
  - A wrong or missing password must keep the device config unchanged and show an inline error inside that confirmation modal.
  - A successful confirmation must persist the updated pin mapping to the managed DIY project and the linked device record, then start a new firmware rebuild for that device.
  - The OTA dialog must stay blocked until the rebuild reaches `artifact_ready`, then allow the admin to send the OTA command for that exact build job.
  - The OTA dialog must show `building`, `artifact_ready`, `flashing`, `flashed`, and `flash_failed` states, plus a clear close path when the build itself fails.
  - After the OTA job reaches `flashed`, the dialog must wait for the board to report `online` again before showing the final success state, then return the admin to the dashboard automatically.

## Dashboard And Discovery
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
  - The discovery list must only show pending devices whose latest state is an active pairing request.
  - A device that already has an active pending pairing request must stay in `awaiting approval`; heartbeat/state traffic must not push it into a fresh `re-pair required` loop.
  - If an admin unpairs a board by mistake, the board remains hidden until it handshakes again, then re-enters discovery as a fresh pairing candidate.
  - The `Ignore` action is a real reject operation, not a local dismiss-only control.
  - After `Ignore`, the backend must notify the board that pairing was rejected.
  - A rejected board must stay out of discovery until it is power-cycled and sends a fresh registration request.
