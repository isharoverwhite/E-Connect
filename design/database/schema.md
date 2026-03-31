# Baseline Data Contract (Schema)

This file documents the baseline schema for E-Connect.

## Core Tables

1. `users`: Stores user accounts and auth status (`approval_status`).
2. `households`: Logical groupings of users and devices.
3. `household_memberships`: Join table linking users to households.
4. `devices`: Managed devices under E-Connect (`provisioning_project_id`, `ip_address`).
5. `pin_configurations`: GPIO mapping for devices.
6. `device_history`: Time-series device state and events.
7. `automations`: Local execution scripts and definition.
8. `diy_projects`: Web builder project state (`room_id`).
9. `wifi_credentials`: Household-scoped SSID/password records selected by DIY projects and managed-device reconfiguration.
10. `rooms`: Physical or logical grouping within a household (`household_id`).
11. `build_jobs`: Server-side firmware compilation tracking (`finished_at`, `error_message`).

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
