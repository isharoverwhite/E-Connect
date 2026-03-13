# Mini-Task 01 - BE-WP07-WIFI-DB-001

Before running this task:

1. Read `00_SHARED_PREAMBLE.md` and apply it fully.
2. This task exists to close the exact FAIL from `BE-WP07-WIFI-001`.
3. Do not open the next mini-task unless this task ends with `Gate Decision: PASS`.

Pass-to-next rule:

- If this task ends with `Gate Decision: PASS`, immediately read and execute `02_SB_RETRY_001.md`.
- If this task ends with `Gate Decision: FAIL`, stop and report blockers. Do not read the next file.

Prompt:

```text
Task ID: BE-WP07-WIFI-DB-001

Objective:
Close the FAIL condition from BE-WP07-WIFI-001 by resolving the DB verification mismatch while preserving the Wi-Fi provisioning implementation end to end.

Context from the previous task report:
1. Wi-Fi SSID and Password fields were added to the DIY Builder WebUI.
2. The backend builder was updated to inject Wi-Fi logic into generated C++ code.
3. Browser verification passed and a real .bin build was reported.
4. Gate Decision was FAIL only because mariadb_nas could not find the runtime build job UUID that the live UI and filesystem confirmed.

Scope:
- DB verification alignment for the Wi-Fi provisioning task
- runtime persistence proof for the build job used by the Wi-Fi flow
- regression check that Wi-Fi fields and generated WiFi.begin(...) behavior still work
- no unrelated redesign or scope expansion

Requirements:
1. Investigate why the live runtime build job and mariadb_nas disagree.
2. If the repo or runtime configuration is wrong, make the smallest fix so the live app and mariadb_nas point at the same MariaDB database.
3. If the mismatch is external to the repo or tool environment, do not fake a fix. State the exact root cause, substitute evidence, and residual risk.
4. Re-verify the BE-WP07-WIFI-001 behavior after the fix:
   - Wi-Fi SSID and password can still be entered in the UI
   - the build still succeeds for a valid config
   - the generated backend code still includes the expected Wi-Fi connection logic
   - the corresponding build job can be proven in the verified database target
5. Preserve the existing Wi-Fi provisioning implementation unless a verification-backed correction is required.

Verification:
1. Browser happy path with chrome-devtools:
   - enter Wi-Fi credentials
   - trigger a real build
   - confirm the build succeeds
2. Network inspection:
   - inspect the project/build requests and payloads that carry Wi-Fi data
3. DB verification:
   - before/after queries that prove the exact runtime build job exists in the intended MariaDB target
4. Runtime evidence:
   - inspect the generated job/build artifacts or builder output as needed
5. Counter-check:
   - confirm that the Wi-Fi fix did not remove the fields or break the build flow

Pass criteria:
- The BE-WP07-WIFI-001 gate can now pass with concrete DB evidence, or a proven external-tool mismatch is documented so precisely that the residual risk is unambiguous.
- Wi-Fi fields and backend Wi-Fi code generation still work after the fix.
```
