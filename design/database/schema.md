# Baseline Data Contract (Schema)

This file documents the baseline schema for E-Connect.

## Core Tables

1. `users`: Stores user accounts and auth status (`approval_status`).
2. `households`: Logical groupings of users and devices.
3. `household_memberships`: Join table linking users to households.
4. `devices`: Managed devices under E-Connect (`provisioning_project_id`, `ip_address`).
5. `pin_configurations`: GPIO mapping for devices.
6. `device_history`: Time-series device state and events.
7. `automations`: Visual automation rule graphs, enablement, and execution metadata.
8. `diy_projects`: Web builder project state (`room_id`).
9. `wifi_credentials`: Household-scoped SSID/password records selected by DIY projects and managed-device reconfiguration.
10. `rooms`: Physical or logical grouping within a household (`household_id`).
11. `build_jobs`: Server-side firmware compilation tracking (`finished_at`, `error_message`).

## Automation Graph Contract

1. `automations` remains the durable source of truth for automation metadata, enablement, graph definition, and last execution summary.
2. The R1 automation model is a typed visual node graph, not a free-form script body and not recurring schedule metadata.
3. The persisted contract must represent at minimum:
   - node identity and type (`trigger`, `condition`, `action`)
   - node configuration such as source device/input, comparison thresholds or boolean expectations, target device/output, and target value
   - typed edges between node ports
4. Trigger nodes originate from server-observed device input/state or telemetry updates, plus an optional manual test source for verification.
5. Condition nodes evaluate boolean or numeric state. Action nodes issue output mutations such as `on`, `off`, or `set_value`.
6. Validation must reject dangling edges, incompatible port types, missing target bindings, and feedback loops/cycles that could cause uncontrolled retriggering.
7. Execution logs must store the trigger source, the evaluated path or rule summary, the target action summary, and the success/failure result.

## Automation Runtime Note

1. The backend rule engine must evaluate automation from server-observed device state/event data. A browser tab must not be the execution truth source.
2. The physical schema may store the graph as JSON inside `automations` or through dedicated child tables, but the stored shape must preserve nodes, ports, edges, and target bindings losslessly for audit and re-edit.

## Wi-Fi Credential Contract

1. `wifi_credentials` belongs to exactly one `household`.
2. `wifi_credentials.ssid` should be unique within the same household so project selection remains unambiguous.
3. `diy_projects` stores a durable foreign-key reference to the selected `wifi_credentials` row.
4. Normal list/read models must expose masked password metadata only; plaintext password disclosure requires explicit password confirmation of the signed-in account.
5. Firmware build/rebuild paths must resolve the selected Wi-Fi credential from the relational record instead of trusting stale SSID/password fields embedded in arbitrary JSON config payloads.

## Auth Session Note

- The refresh-token session flow remains stateless in the current baseline: no new auth-session table is introduced for this slice.
- User approval and revocation checks remain anchored to the existing `users.approval_status` contract during login, refresh, and authenticated access.

**Persistence Rules (from PRD):**
1. Do not assume enum/table/column without inspecting the real DB.
2. Must verify before/after state for any persistence-affecting changes.
3. Artifact `.bin` and build logs must be durable and traceable.
4. Wi-Fi credential CRUD and project-to-credential links must be verified before/after whenever provisioning behavior changes.
