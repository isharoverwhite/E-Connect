# Automation Rule Graph Flow

## Scope

This flow defines the R1 automation authoring and execution model as a visual rule graph.

## Baseline Rules

1. The user builds an automation by placing typed blocks on a canvas and connecting compatible ports.
2. The saved graph is acyclic and executes from `trigger` -> `condition` -> `action`; the backend rejects invalid wiring before save or enable.
3. Trigger blocks are driven by server-observed device state/input/telemetry changes or a manual test event, not by client-side clocks or free-form scripts.
4. Condition blocks evaluate boolean or numeric values against configured expectations.
5. Action blocks target a specific output/circuit on a managed device and apply `on`, `off`, or `set_value` commands through the same backend command path used by runtime controls.
6. Every execution attempt writes a log with trigger source, evaluated conditions, target action, and result.

## Supported Node Shapes

### Trigger

- Device input state change
- Telemetry/state update from a sensor or managed device
- Manual test trigger for one saved automation

### Condition

- Boolean state equals expected `on` / `off`
- Numeric value `>`, `>=`, `<`, `<=`, or within range
- Logical combination of multiple conditions when the graph branches

### Action

- Set target output `on`
- Set target output `off`
- Set target numeric value / PWM

## Verification Hooks

1. Saving a valid graph must return normalized nodes/edges and the enabled state without rewriting the automation into script text.
2. Invalid graphs such as dangling edges, incompatible ports, missing targets, or cycles must return validation errors without mutating the saved automation.
3. A live device event or manual test trigger must create an execution log tied to the saved graph.
4. A successful action path must emit the same backend/device command evidence used by normal runtime controls.
