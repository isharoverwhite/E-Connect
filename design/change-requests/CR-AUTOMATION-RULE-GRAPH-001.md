# Change Request: CR-AUTOMATION-RULE-GRAPH-001

## Proposed Change
Replace the current automation baseline from `script editor + recurring schedule` to a no-code visual rule graph.
Users author automation by connecting typed blocks similar to a Blender-style node editor: `trigger -> condition -> action`.
Example flows include `temperature reaches threshold -> set another output value` and `switch turns on -> turn another circuit on/off`.

## Affected FR/NFR Items
- Redefines `FR-05` from script authoring to a visual rule-graph builder.
- Extends `FR-11` and `FR-18` because automation now consumes real device state/telemetry and applies output actions through the actual control path.
- Reinforces `NFR-07` and `NFR-08` by requiring typed graph validation, explicit UI states, and traceable execution logs.

## Scope In
- Graph-based authoring with `trigger`, `condition`, and `action` blocks.
- Device input/sensor state as trigger or condition inputs.
- Boolean and numeric output actions against real managed devices/circuits.
- Execution logs tied to the saved graph and action path.

## Scope Out
- Free-form script authoring for automation behavior.
- Cron/daily/weekly schedule builder as the primary automation model.
- Browser-tab-local execution that depends on the automation page staying open.

## Affected Gates
- G0, G1, G2, G3, G4.

## Approval Needed
Approved implicitly via direct user request on 2026-03-31 to replace schedule/script-based automation with a Blender-style condition/action graph.
