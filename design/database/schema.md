# Baseline Data Contract (Schema)

This file documents the baseline schema for E-Connect.

## Core Tables

1. `users`: Stores admin-provisioned user accounts, role metadata, and UI preferences.
2. `households`: Logical groupings of users and devices, including the optional admin-selected server timezone override (`timezone`).
3. `household_memberships`: Join table linking users to households.
4. `devices`: Managed devices under E-Connect (`provisioning_project_id`, `ip_address`).
5. `pin_configurations`: GPIO mapping for devices.
6. `device_history`: Time-series device state and events.
7. `automations`: Visual automation rule graphs, enablement, and execution metadata.
8. `diy_projects`: Web builder project state (`room_id`, `config`, `current_config_id`, `pending_config`, `pending_config_id`, `pending_build_job_id`).
9. `diy_project_configs`: Durable named config-history rows for managed-device/project board configs, bound to one project, one device UUID, and one board profile.
10. `wifi_credentials`: Household-scoped SSID/password records selected by DIY projects and managed-device reconfiguration.
11. `rooms`: Physical or logical grouping within a household (`household_id`).
12. `build_jobs`: Server-side firmware compilation tracking (`finished_at`, `error_message`, `saved_config_id`, `staged_project_config`).
13. `system_logs`: 30-day retained operational events for server lifecycle, connectivity, firmware observations, and alert history.

## Automation Graph Contract

1. `automations` remains the durable source of truth for automation metadata, enablement, graph definition, and last execution summary.
2. The R1 automation model is a typed visual node graph, not a free-form script body and not recurring schedule metadata.
3. The persisted contract must represent at minimum:
   - node identity and type (`trigger`, `condition`, `action`)
   - node configuration such as source device/input, trigger mode (`device_state`, `device_on_off_event`, `device_value`, `time_schedule`), server-time trigger hour/minute plus optional weekdays, comparison thresholds or boolean expectations, target device/output, and target value
   - typed edges between node ports
4. Trigger nodes originate from server-observed device input/state or telemetry updates, a backend-owned server-time schedule, plus an optional manual test source for verification.
5. `device_on_off_event` and `device_value` are device-scoped graph trigger kinds only; they still execute via the existing backend `device_state` event runtime.
6. `time_schedule` executes against the effective server timezone and must not depend on browser time or device clocks.
7. Condition nodes evaluate boolean or numeric state. Action nodes issue output mutations such as `on`, `off`, or `set_value`.
8. Validation must reject dangling edges, incompatible port types, missing target bindings, trigger-mode/pin mismatches, invalid time fields, and feedback loops/cycles that could cause uncontrolled retriggering.
9. Execution logs must store the trigger source, the evaluated path or rule summary, the target action summary, and the success/failure result.

## Automation Runtime Note

1. The backend rule engine must evaluate automation from server-observed device state/event data and the effective server-time scheduler. A browser tab must not be the execution truth source.
2. The physical schema may store the graph as JSON inside `automations` or through dedicated child tables, but the stored shape must preserve nodes, ports, edges, and target bindings losslessly for audit and re-edit.
3. The legacy columns `schedule_type`, `timezone`, `schedule_hour`, `schedule_minute`, `schedule_weekdays`, and `next_run_at` may be reused as a derived runtime projection of a `time_schedule` trigger, but `automations.script_code` remains the durable source of truth for the graph definition.

## Wi-Fi Credential Contract

1. `wifi_credentials` belongs to exactly one `household`.
2. `wifi_credentials.ssid` should be unique within the same household so project selection remains unambiguous.
3. `diy_projects` stores a durable foreign-key reference to the selected `wifi_credentials` row.
4. Normal list/read models must expose masked password metadata only; plaintext password disclosure requires explicit password confirmation of the signed-in account.
5. Firmware build/rebuild paths must resolve the selected Wi-Fi credential from the relational record instead of trusting stale SSID/password fields embedded in arbitrary JSON config payloads.

## Managed Reconfiguration Staging Contract

1. `diy_projects.config` remains the committed config currently expected to match the board after the last verified OTA or flash.
2. `diy_projects.current_config_id` points to the committed `diy_project_configs` row that currently represents the board's approved config.
3. `diy_projects.pending_config` stores only the newest staged managed-device reconfiguration still awaiting verification on hardware; it is a convenience pointer, not the full history source of truth.
4. `diy_projects.pending_config_id` points to the newest staged `diy_project_configs` row still awaiting verification on hardware.
5. `diy_projects.pending_build_job_id` points to the newest staged build job still awaiting verification.
6. `diy_project_configs` is the durable config-history source of truth for managed-device reconfiguration.
7. Each `diy_project_configs` row must preserve:
   - a stable `id` used as the saved-config id
   - `project_id`
   - `device_id`
   - `board_profile`
   - a user-editable `name`
   - the persisted config payload, including stamped `config_id`, `config_name`, `assigned_device_id`, `assigned_device_name`, `board_profile`, `saved_at`, plus the Wi-Fi and firmware network target fields needed for that exact config
   - `last_applied_at` when that saved config is the one the board most recently reported as active
8. Managed-device config history is scoped by `device_id` plus `board_profile`. A single board/device pair may retain unlimited saved configs.
9. The backend must support both:
   - updating an existing saved config in place by id
   - cloning an existing saved config into a new saved config row before rebuild
10. `build_jobs` is build/flash execution state, not the config-history source of truth. Each job must point back to the saved config snapshot through `build_jobs.saved_config_id`, and `build_jobs.staged_project_config` remains the exact compiled snapshot for that artifact or OTA retry.
11. Multiple build jobs may reference the same saved config when the same named config is rebuilt or retried without creating a new config row.
12. OTA promotion must always promote from the exact saved config and exact compiled build snapshot that the board reports back on. The frontend must not recompute the artifact URL from a different runtime target than the one embedded into that exact staged snapshot.
13. Legacy `diy_projects.config`, `pending_config`, or `build_jobs` payloads may still contain builder-era `latest_build_job_id` / `latest_build_config_key` fields, but those keys are compatibility metadata only and must be scrubbed whenever those payloads are materialized into the saved-config model. Startup cleanup must also backfill missing saved-config labels, ids, and board assignment metadata so legacy projects upgrade without losing history continuity.

## Server Timezone Contract

1. `households.timezone` stores an optional IANA timezone override selected from the bundled Wikipedia tz database canonical list.
2. When `households.timezone` is set, that value becomes the effective server timezone for runtime display/scheduling behavior and must take precedence over the container `TZ` environment variable.
3. When `households.timezone` is empty, the backend falls back to the deployment `TZ` environment variable if it is a supported timezone; otherwise it falls back to the app default `Asia/Ho_Chi_Minh`.
4. The backend may apply the effective timezone to the running process, but operational timestamps remain stored in the existing database shape unless a separate persistence change is approved.

## Auth Session Note

- The refresh-token session flow remains stateless in the current baseline: no new auth-session table is introduced for this slice.
- Household user accounts are provisioned only by an admin; once persisted they are immediately active, and account removal is represented by deleting the user record instead of maintaining a separate approval state column.

## System Log Contract

1. `system_logs` is the durable audit stream for instance-level operational events shown on `/logs`.
2. Each row must preserve:
   - `event_code` for stable machine filtering
   - `severity` for alerting (`info`, `warning`, `error`, `critical`)
   - `category` for grouping (`lifecycle`, `connectivity`, `firmware`, `health`)
   - human-readable `message`
   - timestamp of occurrence
   - read-state fields so admins can acknowledge an alert without deleting the audit row: `is_read`, `read_at`, and optional `read_by_user_id`
   - optional `device_id`, `firmware_version`, and `firmware_revision` when the event is tied to a board
   - optional structured `details` JSON for inspectable context without relying on free-form strings
3. The backend must log state transitions, not every heartbeat. Examples include:
   - server startup and graceful shutdown
   - suspected unclean shutdown / power loss detected on next boot
   - MQTT disconnect / reconnect
   - firmware version or firmware revision changes observed from a device
   - runtime health warnings that materially affect the instance
4. Records older than 30 days must be deleted automatically by backend retention cleanup; the active page must not depend on manual pruning.
5. `/logs` filters operate on timestamp range, severity, category, and free-text search over event code, message, device id, and firmware fields.
6. The `/logs` API and UI must expose enough timezone context for clients to interpret day buckets and date-filter boundaries in the effective server timezone instead of the viewer's browser timezone.
7. The `/logs` summary status is driven by unread alert rows only. Marking all current alerts as read must clear the reminder state back to `healthy` without falsifying the live dependency cards for database and MQTT.

**Persistence Rules (from PRD):**
1. Do not assume enum/table/column without inspecting the real DB.
2. Must verify before/after state for any persistence-affecting changes.
3. Artifact `.bin` and build logs must be durable and traceable.
4. Wi-Fi credential CRUD and project-to-credential links must be verified before/after whenever provisioning behavior changes.
