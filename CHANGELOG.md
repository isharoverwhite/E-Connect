# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
### Added
- Google Home integration: E-Connect now acts as a Google Smart Home provider. New `server/app/routers/google_home.py` implements an OAuth2 authorization server (auth code + token exchange) and a Smart Home fulfillment webhook handling `SYNC`, `QUERY`, `EXECUTE`, and `DISCONNECT` intents. Device type mapping auto-detects `light`, `fan`, `switch`, `sensor`, and `lock` from pin function names (physical devices) or schema `card_type` (external/extension devices). Report State and Request Sync push changes to Google's Home Graph API using a service account JWT. Two new DB tables (`google_home_linked_users`, `google_home_auth_codes`) store the link. A `GoogleHomePanel` component in Settings lets users check link status, trigger a manual device sync, and unlink their account. Configured via `GOOGLE_HOME_CLIENT_ID`, `GOOGLE_HOME_CLIENT_SECRET`, `GOOGLE_HOME_PROJECT_ID`, and `GOOGLE_HOME_SERVICE_ACCOUNT_JSON` env vars.
- GitHub Action Pull Request Checks.
- Device state change history: each device card on the dashboard now shows a small history icon; clicking it opens a modal with a paginated timeline of state changes (power, brightness, sensor values, etc.), online/offline transitions shown as dividers, and the triggering actor (user, automation, or device). Backend `GET /api/v1/device/{id}/history` now supports `event_type` filter and `limit`/`offset` pagination and returns `changed_by_username`. `POST /device/{id}/history` rejects `state_change` events when the device is offline (HTTP 409). External/extension devices now also record `state_change`, `online`, and `offline` history events — both from user-issued commands and from the background probe loop.
- Dashboard card drag-and-drop reordering and per-card hide/show toggle persisted per user via new `dashboard_layouts` table and `GET`/`PUT /api/v1/dashboard/layout` endpoints.
- PWA Web App Manifest (`/manifest.json`) and service worker (`/sw.js`) for offline shell caching and "Add to home screen" support on mobile/desktop.
- WebSocket event notifications in frontend: `automation_fired` and `device_offline` events now show toast notifications via new `AppEventListener` component. Backend broadcasts enriched payloads including `device_name` and automation name.
- Setup wizard now shows a "next steps" success screen after initialization completes, with guided cards for adding a device, configuring Wi-Fi, and creating automations.
- Fleet OTA: `POST /api/v1/devices/ota/batch` endpoint triggers firmware rebuild for multiple devices in one request. New `FleetOtaPanel` component in the devices page provides multi-select UI with per-device progress results.
- Automation execution history: `GET /api/v1/automation/{id}/logs` endpoint and Execution History table in automation detail page showing time, trigger source, result, and error details.
- Error recovery UX: device command failures show inline error indicator on `DeviceCard`; DIY build failures show a "Retry Build" button in the flash step.
- Home location setup: setup wizard now includes a location picker step with a "Skip for now" option that warns users weather features require a location.
- `server/app/deps.py`: shared auth dependencies (`get_current_user`, `get_admin_user`, `oauth2_scheme`, cross-cutting helpers) extracted from `api.py` as foundation for domain router split.
- 164 new unit tests: `test_automation_runtime.py` (109 tests covering trigger matching, condition evaluation, graph execution, time triggers) and `test_extension_runtime.py` (55 tests covering extension load, hook execution, caching, sandbox isolation).
- Pre-commit hook now warns when source files are staged without a `CHANGELOG.md` update.

### Changed
- `POST /automation/{id}/trigger` now broadcasts `automation_fired` WebSocket event to connected admin clients.
- Device heartbeat timeout and external device offline detection now include `device_name` in the `device_offline` WebSocket payload.
- `ws_manager.py`: added `broadcast_system_event_sync` thread-safe wrapper for use from synchronous code paths.

