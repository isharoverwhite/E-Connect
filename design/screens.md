# Screens and UI Flow Details

## Settings Page
- **`general`**: Overview of instance and user baseline.
- **`users`**: Admin user management panel to provision and approve/revoke accounts.
- **`rooms`**: Admin panel for managing room access control.
- **`configs` (New)**: Admin panel for managing DIY Config projects.
  - Lists all project records.
  - Usage state badges: **`unused`** and **`in_use`**.
  - Deleting an `in_use` config is blocked and shows an informative tooltip/error indicating which devices use it.
  - Clicking a config triggers a detailed dialog showing JSON mapping and device usage lists.
  - Deleting a config successfully cleans up backend records and is updated responsively on the UI.

## DIY Builder
- **Step 1 / Boards**:
  - The board-family picker must expose `ESP8266` as a first-class family next to the existing ESP32 families.
  - Supported ESP8266 profiles are `NodeMCU (v2/v3)`, `WeMos D1 mini`, `WeMos D1 mini Pro`, `ESP-01 / ESP-01S (1MB)`, and `ESP-12E / ESP-12F Module`.
  - Board summaries must show truthful defaults for CPU MHz, flash size, PSRAM, serial bridge, and warnings.
- **Step 4 / Flash**:
  - ESP32-family application-only server builds remain single-binary manifests at `0x10000`.
  - ESP8266 single-binary server builds and custom uploads must produce a manifest that flashes `firmware.bin` at `0x0`.
  - Upload-mode copy must not require `bootloader.bin` or `partitions.bin` for ESP8266 profiles.
  - When a server build reaches `artifact_ready`, the backend must auto-release the same-user serial reservation stored in `config.serial_port`.
  - The browser flasher becomes available only when the artifact/manifest is ready and the configured serial port is free; if any serial session still holds the port, the screen must show a release-first blocking message.

## Dashboard And Discovery
- **Dashboard notifications**:
  - The pairing notification card only appears when the server has at least one active board-initiated pairing request.
  - A device that was merely unpaired from the dashboard must not create a pairing notification by itself.
  - Notification badge counts must include both offline alerts and active pairing requests.
- **Discovery screen**:
  - The discovery list must only show pending devices whose latest state is an active pairing request.
  - If an admin unpairs a board by mistake, the board remains hidden until it handshakes again, then re-enters discovery as a fresh pairing candidate.
  - The `Ignore` action is a real reject operation, not a local dismiss-only control.
  - After `Ignore`, the backend must notify the board that pairing was rejected.
  - A rejected board must stay out of discovery until it is power-cycled and sends a fresh registration request.
