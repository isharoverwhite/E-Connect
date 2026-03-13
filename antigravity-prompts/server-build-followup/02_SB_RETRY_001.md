# Mini-Task 02 - SB-RETRY-001

Before running this task:

1. Read `00_SHARED_PREAMBLE.md` and apply it fully.
2. Read this file only if `01_BE_WP07_WIFI_DB_001.md` ended with `Gate Decision: PASS`.

Pass-to-next rule:

- If this task ends with `Gate Decision: PASS`, immediately read and execute `03_SB_AUTH_TS_001.md`.
- If this task ends with `Gate Decision: FAIL`, stop and report blockers. Do not read the next file.

Prompt:

```text
Task ID: SB-RETRY-001

Objective:
Make the Server Build flow retry-safe and prevent duplicate build jobs.

Context from independent verification:
Repeated clicks during active builds created multiple new jobs for the same project, including:
- 97e984c0-7ab8-404b-bd97-5dde6278a9e8
- e18137a4-6e9c-4805-822a-92e17aaeed3e
- 0209b870-f762-45ab-a994-165b3e06d350

Scope:
- backend build trigger behavior
- frontend Build on Server button state and active-job tracking
- no visual redesign

Requirements:
1. POST /api/v1/diy/build must be retry-safe.
2. If the current project already has an active job in queued, building, or flashing, do not create a new row. Return the existing active job instead.
3. Keep Build on Server disabled in the UI whenever the current project has an active build.
4. Refresh, polling, and log streaming must keep tracking the same active job.
5. Preserve current artifact download and log panel behavior.
6. Do not regress the Wi-Fi provisioning behavior from BE-WP07-WIFI-001.

Verification:
1. Browser happy path: start one real build and confirm it still reaches artifact_ready.
2. Browser counter-check: try repeated clicks during queued and building. Confirm no duplicate build job is created.
3. Network: inspect POST /api/v1/diy/build and returned job ids.
4. DB: before/after query on build_jobs proving repeated trigger attempts do not create a second active row for the same project.
5. Console: confirm no relevant new errors.

Pass criteria:
- Repeated trigger attempts do not create duplicate jobs.
- The build button stays disabled during active build states.
- A normal build still reaches artifact_ready with real logs and a downloadable artifact.
- The Wi-Fi-enabled build flow still works after the retry-safety fix.
```
