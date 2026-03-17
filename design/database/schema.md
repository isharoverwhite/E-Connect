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
9. `rooms`: Physical or logical grouping within a household (`household_id`).
10. `build_jobs`: Server-side firmware compilation tracking (`finished_at`, `error_message`).

**Persistence Rules (from PRD):**
1. Do not assume enum/table/column without inspecting the real DB.
2. Must verify before/after state for any persistence-affecting changes.
3. Artifact `.bin` and build logs must be durable and traceable.
