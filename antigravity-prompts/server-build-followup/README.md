# Antigravity Follow-up Prompt Chain

Run these files in order.

1. Read `00_SHARED_PREAMBLE.md`.
2. Execute `01_BE_WP07_WIFI_DB_001.md`.
3. If and only if `01_BE_WP07_WIFI_DB_001.md` ends with `Gate Decision: PASS`, read and execute `02_SB_RETRY_001.md`.
4. If and only if `02_SB_RETRY_001.md` ends with `Gate Decision: PASS`, read and execute `03_SB_AUTH_TS_001.md`.
5. If and only if `03_SB_AUTH_TS_001.md` ends with `Gate Decision: PASS`, read and execute `04_SB_DB_001.md`.
6. If and only if `04_SB_DB_001.md` ends with `Gate Decision: PASS`, read and execute `05_SB_GATE_001.md`.

Stop rule:

- If any mini-task ends with `Gate Decision: FAIL`, do not continue to the next file.
- Report blockers, evidence, and residual risk before stopping.

Working rule:

- Always apply the shared preamble before running a mini-task prompt.
- Treat the previous task report in `00_SHARED_PREAMBLE.md` as context, not as proof.
- Preserve the Wi-Fi provisioning changes from `BE-WP07-WIFI-001` unless a verification-backed fix is required.
