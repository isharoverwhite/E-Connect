# Change Request: CR-AUTOMATION-TRIGGER-MODES-001

## Proposed Change
Extend the graph-based automation trigger block so a rule can start from:
- a server-side time trigger
- a device value trigger
- a device on/off event trigger when the selected device pin exposes boolean-like behavior

This keeps the visual rule-graph model but broadens the supported trigger kinds beyond the current `device_state` baseline.

## Affected FR/NFR Items
- Extends `FR-05` by widening the allowed trigger semantics inside the visual graph builder.
- Extends `FR-11` because the runtime must distinguish event-style device triggers from value-threshold triggers and schedule-driven triggers.
- Reinforces `NFR-07` and `NFR-08` by requiring typed trigger configuration, validation, and traceable execution evidence for each trigger source.

## Scope In
- Trigger inspector options for `time`, `device value`, and `device on/off event`.
- Backend graph validation for new trigger kinds and their required config.
- Server-side execution support for the approved trigger kinds, including execution-log source attribution.
- UI summaries and readiness states that reflect the chosen trigger mode.

## Scope Out
- Free-form cron/script authoring outside the visual graph builder.
- Client-only timer execution in the browser.
- Unbounded multi-trigger joins inside a single automation unless separately approved.

## Affected Gates
- G1, G2, G3, G4.

## Approval Needed
Approved explicitly via direct user request on 2026-04-02 to add a server-time trigger that follows the configured server timezone instead of device-local clocks.
