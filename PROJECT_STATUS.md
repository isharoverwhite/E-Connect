# Project Status

## Current Phase: Complete

## Active Task
- Task ID: FW-HOST-INFER-001
- Objective: Make server-side firmware builds derive one reachable host from the incoming request and reuse it for firmware MQTT/API targets without changing Docker MQTT service topology
- Owner: Codex
- Started At: 2026-03-25 00:20:00

## Gate Status
- [x] G0 Task intake
- [x] G1 Requirement approved
- [x] G2 Design approved
- [x] G3 Implementation complete
- [x] G4 Test complete

## Deliverables
- PRD: No scope-baseline change; implementation stays inside the current DIY firmware build baseline (`FR-14` / `FR-30`).
- Design docs: `design/screens.md` now records that the builder exposes Wi-Fi fields only and the server derives one advertised host for firmware MQTT/API targets.
- Code: Backend build-trigger endpoints now stamp a validated advertised host from request headers into project config; firmware generation derives `MQTT_BROKER` and `API_BASE_URL` from that validated host instead of relying on `FIRMWARE_MQTT_BROKER`.
- Verification: Python compile checks passed locally. Targeted backend tests passed in Docker for build host stamping, invalid-host rejection, and generated firmware header output.

## Risks / Blockers
- Repo has unrelated uncommitted changes in firmware/server/webapp; this patch was kept scoped to backend build flow, tests, and docs.
- MariaDB MCP is not configured in this environment, so DB verification used backend tests instead of live before/after SQL queries.

## Next Action
- If you deploy behind a reverse proxy, preserve `X-Forwarded-Host` and `X-Forwarded-Proto` so firmware builds keep receiving the externally reachable host.

## Last Updated
2026-03-25 00:58:26
