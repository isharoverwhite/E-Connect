# Change Request: UI-DEVICE-CONFIG-OTA-001

## Proposed Change
Replace the demo-only `/devices/[id]/config` flow with a real admin-only managed-device reconfiguration flow. Allows loading current pin config of a DIY device, editing it, persisting via server, trigger a firmware rebuild, and deploying via OTA.
The save action is safety-sensitive and must require the signed-in admin to re-enter the account password before the backend accepts new GPIO mappings.
This slice also upgrades the saved-config contract so managed-device OTA reconfiguration is tracked in a dedicated `diy_project_configs` history table, bound by `device UUID + board profile`, allows unlimited named configs per board, supports renaming plus edit-in-place or clone-then-edit flows, and keeps `build_jobs` as execution state instead of the history source of truth.

## Affected FR/NFR Items
- Focuses on a single-device admin-triggered OTA reconfiguration slice from `/devices/[id]/config`.
- Avoids full fleet OTA orchestration (which remains Post-MVP).
- Reinforces `NFR-05` secure-by-default behavior on a hardware-risking configuration path.
- Keeps config promotion tied to the exact saved build snapshot and removes runtime URL ambiguity during OTA handoff.
- Preserves rollback/editability by letting admins reopen an old named config or create a new config branch from it without overwriting unrelated history.

## Affected Gates
- G0, G1, G2, G3, G4.

## Approval Needed
Approved implicitly via Task Request (narrow approved change request for a single-device admin-triggered OTA reconfiguration slice).
