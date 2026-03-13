# Mini-Task 05 - SB-GATE-001

Before running this task:

1. Read `00_SHARED_PREAMBLE.md` and apply it fully.
2. Read this file only if `04_SB_DB_001.md` ended with `Gate Decision: PASS`.

Final gate rule:

- This is the final regression task.
- Return `PASS` only if every required check is backed by concrete evidence.
- If any one check fails or remains contradictory, return `FAIL`.

Prompt:

```text
Task ID: SB-GATE-001

Objective:
Run final end-to-end verification for the Server Build follow-up tasks after SB-RETRY-001, SB-AUTH-TS-001, and SB-DB-001 are complete.

Required checks:
1. Happy path in browser:
   - Build on Server starts a real build
   - /logs/stream returns 200
   - real PlatformIO logs appear in the panel
   - build reaches artifact_ready
   - Download .bin is enabled and artifact endpoint returns 200
   - a Wi-Fi-enabled build still works and does not regress the BE-WP07-WIFI-001 behavior
2. Counter-check:
   - repeated clicks during queued or building do not create duplicate jobs
3. Failure path:
   - expired or invalid auth does not show fake build_failed
   - no new build job is created for the auth failure case
4. Code-level validation:
   - `cd webapp && npx tsc --noEmit` passes
5. Data validation:
   - DB before/after evidence for the happy path
   - DB evidence for the duplicate-click counter-check
   - explicit statement on whether mariadb_nas matches runtime DB state
   - explicit statement on whether the Wi-Fi provisioning build job is visible in the verified DB target

Gate rule:
Only return PASS if all checks above are satisfied with concrete evidence.
If any required check is incomplete or contradictory, return FAIL.
```
