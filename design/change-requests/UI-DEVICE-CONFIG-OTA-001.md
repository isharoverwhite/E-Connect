# Change Request: UI-DEVICE-CONFIG-OTA-001

## Proposed Change
Replace the demo-only `/devices/[id]/config` flow with a real admin-only managed-device reconfiguration flow. Allows loading current pin config of a DIY device, editing it, persisting via server, trigger a firmware rebuild, and deploying via OTA.
The save action is safety-sensitive and must require the signed-in admin to re-enter the account password before the backend accepts new GPIO mappings.

## Affected FR/NFR Items
- Focuses on a single-device admin-triggered OTA reconfiguration slice from `/devices/[id]/config`.
- Avoids full fleet OTA orchestration (which remains Post-MVP).
- Reinforces `NFR-05` secure-by-default behavior on a hardware-risking configuration path.

## Affected Gates
- G0, G1, G2, G3, G4.

## Approval Needed
Approved implicitly via Task Request (narrow approved change request for a single-device admin-triggered OTA reconfiguration slice).
