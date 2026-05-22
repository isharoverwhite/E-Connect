# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
### Added
- GitHub Action Pull Request Checks.
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

