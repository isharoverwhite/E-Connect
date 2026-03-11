# Antigravity Prompt: Audit and Complete MVP Server-Side Scope from the PRD

Copy everything inside the code block below into Antigravity:

```text
You are working in the E-Connect repository at:
/Users/kiendinhtrung/Documents/GitHub/Final-Project

Your mission:
Audit and complete the full MVP/R1 server-side scope defined in the PRD, with priority on all Must requirements targeted for P3/P4. This is not a documentation-only audit. You must identify implementation gaps, implement the missing server-side behavior required by the PRD, verify the result with evidence, and build the server into a deployable Docker image.

Primary source of truth:
1. /Users/kiendinhtrung/Documents/GitHub/Final-Project/PRD.md
2. /Users/kiendinhtrung/Documents/GitHub/Final-Project/AGENTS.md
3. The current codebase in this repository

Execution rules:
1. Follow the mandatory Planner -> Coder -> Tester model from AGENTS.md.
2. Read the relevant code paths before changing any file.
3. Do not declare completion without concrete evidence.
4. If the codebase conflicts with the PRD, explicitly surface the conflict in the final report.
5. Do not reduce the request to a "review only" task. Implement the missing server-side behavior required to satisfy the MVP PRD scope.
6. Prefer the smallest correct change set, but do not leave placeholder logic in any flow you claim is complete.

Required server-side scope to audit and complete:
1. Bootstrap, setup, authentication, and household foundation.
2. Device handshake, pending authorization, approve/reject, and durable UUID identity.
3. MQTT command publish, state ingest, history, last_seen, online/offline handling, and failure behavior.
4. Dashboard layout persistence endpoints and any required backend validation.
5. DIY draft/project persistence on the server side.
6. DIY server-side firmware build pipeline:
   - The WebUI sends board profile and pin configuration to the server.
   - The server validates the configuration.
   - The server creates a build job with observable lifecycle state.
   - The server builds firmware into a real .bin artifact.
   - The server stores the artifact and build logs durably.
   - The server exposes artifact and build status/log information back to the WebUI.
   - The WebUI must only be able to flash when the artifact is ready.
   - The server must block build or flash when the config is invalid, the build fails, the artifact is not ready, or the serial port is currently occupied.
7. Serial/flash coordination and conflict prevention.
8. Automation CRUD plus minimum execution logging.

Critical clarification from the PRD:
The PRD has been updated to explicitly require a real server-side build flow for DIY firmware:
WebUI sends config -> server validates -> server builds a .bin -> server stores artifact/logs -> server returns artifact/log references/status to WebUI -> WebUI performs flash handoff.

You must not reinterpret this as any of the following:
- config generation only
- a fake success state without a real build artifact
- a WebUI-only build simulation
- a flash handoff without a server-produced .bin artifact

Important product principles you must preserve:
- Local-first
- Secure-by-default
- Durable state
- No fake interactivity
- Traceable lifecycle

Minimum API/data contract that must exist or be updated to match the PRD:
- POST /api/v1/diy/config/generate
- POST /api/v1/diy/build
- GET /api/v1/diy/build/{job_id}
- GET /api/v1/diy/build/{job_id}/artifact
- Server-side DIY project persistence
- Build job persistence
- Durable artifact storage
- Build log traceability

Expected lifecycle contract:
- Build/flash lifecycle: draft_config -> validated -> queued -> building -> artifact_ready -> flashing -> flashed / build_failed / flash_failed / cancelled
- Flash is not allowed before artifact_ready
- Failure states must be observable through API responses and persisted records/logs

Implementation guidance:
1. Create a short Task Packet aligned to AGENTS.md, including FR/NFR mapping, scope in/out, impacted code paths, and acceptance criteria.
2. Perform a gap analysis between the PRD and the current server-side implementation.
3. Implement the smallest correct set of backend changes needed to close MVP gaps.
4. Add or update tests where appropriate.
5. Verify independently using evidence, not assumptions.
6. Build the server into a deployable Docker image from the actual repository structure.

Repository-specific Docker note:
Check the real repository layout before building. The active server code currently lives under:
/Users/kiendinhtrung/Documents/GitHub/Final-Project/server
There is already a Dockerfile at:
/Users/kiendinhtrung/Documents/GitHub/Final-Project/server/Dockerfile
If any existing Docker or compose configuration points to the wrong backend path, fix it and report the reason clearly.

Mandatory verification requirements:
1. Code-level validation
   - Run relevant lint, typecheck, unit, and integration checks where applicable.
2. Browser verification
   - If the work affects WebUI/API behavior, verify the flow with chrome-devtools.
   - Cover one happy path and at least one failure path.
   - Inspect console messages.
   - Inspect relevant network requests.
3. Database verification
   - If persistence is affected, inspect before/after state with the database tool required by AGENTS.md.
   - Confirm row-level impact and any relevant shape changes.
4. Build/flash verification
   - Prove that a real build job is created.
   - Prove that a real .bin artifact is produced for a valid config.
   - Prove that logs/status are retrievable.
   - Prove that invalid config or build failure does not expose a flashable artifact.
   - Prove that serial-port conflict blocks flashing correctly.
5. Docker verification
   - Build the final server image successfully.
   - Report the exact build command used.
   - Report the result of the build.

Definition of done for this task:
1. All MVP/R1 Must server-side features covered by the PRD have been audited.
2. Any server-side gap within scope has been implemented or explicitly blocked with evidence.
3. The DIY build flow is real end to end:
   WebUI config -> server validation -> server build -> .bin artifact -> artifact/log/status exposure -> WebUI flash handoff
4. No claimed-complete flow relies on placeholder logic.
5. The server Docker image builds successfully.
6. The final report follows the AGENTS.md reporting format exactly.

Final report format:
Task ID:
Objective:
FR/NFR Mapping:
Scope In/Out:

Sub-agent Outputs:
- Planner:
- Coder:
- Tester:

Changed Files:

Verification:
- Lint/Typecheck:
- Backend tests:
- Browser flow (chrome-devtools):
- DB before/after (mariadb_nas):
- Design reference (Stitch):
- Docker build:

Defects Found:
Residual Risk:
Gate Decision: PASS / FAIL
```
