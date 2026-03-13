# Mini-Task 03 - SB-AUTH-TS-001

Before running this task:

1. Read `00_SHARED_PREAMBLE.md` and apply it fully.
2. Read this file only if `02_SB_RETRY_001.md` ended with `Gate Decision: PASS`.

Pass-to-next rule:

- If this task ends with `Gate Decision: PASS`, immediately read and execute `04_SB_DB_001.md`.
- If this task ends with `Gate Decision: FAIL`, stop and report blockers. Do not read the next file.

Prompt:

```text
Task ID: SB-AUTH-TS-001

Objective:
Stop treating auth or session failures as build failures, and restore clean TypeScript compilation.

Context from independent verification:
1. With an expired JWT in the browser, clicking Build on Server showed BUILD FAILED and the message "Could not validate credentials", even though no real build had started.
2. `cd webapp && npx tsc --noEmit` failed in webapp/src/features/diy/types.ts around sanitizePins.

Scope:
- frontend build-flow error handling
- frontend TypeScript correctness
- no redesign

Requirements:
1. Distinguish 401 and 403 auth or session failures from real build lifecycle failures.
2. Do not set serverBuild.status to build_failed when the real problem is auth or session expiry.
3. Show a clear session or auth message and follow the existing app auth pattern.
4. Preserve the last known good build state, logs, and artifact unless a real new build starts.
5. Fix the current TypeScript errors cleanly. Do not use ts-ignore and do not weaken types globally.
6. Do not regress the Wi-Fi provisioning fields or Wi-Fi-enabled build behavior.

Verification:
1. Browser failure path: simulate expired or invalid auth and test Build on Server. Confirm no fake BUILD FAILED banner and no new build job row.
2. Browser happy path: valid auth still allows a normal build.
3. Run `cd webapp && npx tsc --noEmit` and require exit code 0.
4. Inspect console and network for the auth failure case and the normal build case.
5. Confirm the Wi-Fi input path still works after the auth and TypeScript fixes.
```
