# WP04 Dashboard Builder Prompt

```text
You are working in the E-Connect repository at:
/Users/kiendinhtrung/Documents/GitHub/Final-Project

Read first:
1. /Users/kiendinhtrung/Documents/GitHub/Final-Project/AGENTS.md
2. /Users/kiendinhtrung/Documents/GitHub/Final-Project/PRD.md
3. /Users/kiendinhtrung/Documents/GitHub/Final-Project/webapp/src/app/page.tsx
4. /Users/kiendinhtrung/Documents/GitHub/Final-Project/webapp/src/lib/api.ts
5. /Users/kiendinhtrung/Documents/GitHub/Final-Project/webapp/src/components/AuthProvider.tsx
6. /Users/kiendinhtrung/Documents/GitHub/Final-Project/server/app/api.py
7. /Users/kiendinhtrung/Documents/GitHub/Final-Project/server/app/services/device_registration.py
8. /Users/kiendinhtrung/Documents/GitHub/Final-Project/server/app/sql_models.py
9. /Users/kiendinhtrung/Documents/GitHub/Final-Project/server/app/database.py
10. /Users/kiendinhtrung/Documents/GitHub/Final-Project/design/change-requests/CR-MIGRATE-01.md

Task ID: WP04-DASHBOARD-BUILDER-001

Objective:
Implement the missing MVP Dashboard Builder slice on `/` with real drag-drop/resizable persisted layout, using the existing `users.ui_layout` contract. This is the next necessary missing feature from PRD WP-04 / FR-01 / FR-02.

Current gap to close:
1. `/webapp/src/app/page.tsx` still renders `approvedDevices.map(...)` directly.
2. The `Customize` button on the dashboard is not wired to a real builder flow.
3. Backend already exposes `PUT /api/v1/users/me/layout`.
4. `users.ui_layout` already exists in the schema.
5. Device approval already auto-generates widget metadata into `ui_layout`, but the dashboard does not actually render from that persisted layout.

Scope In:
1. Dashboard page `/`
2. Persisted user layout JSON
3. Real reorder/resize interaction
4. Rendering widgets from layout with binding to approved devices and pin configs
5. Loading, empty, success, validation error, server error, and degraded states
6. Minimum design artifact updates required by `AGENTS.md`

Scope Out:
1. Full visual redesign of the dashboard
2. New widget families beyond the current switch, dimmer, status, and text behavior already implied by device capabilities
3. New persistence tables unless they are strictly required and justified against the existing `users.ui_layout` baseline
4. Unrelated automation, DIY builder, discovery, or auth refactors

Requirements:
1. Turn the current dashboard into a real builder/view backed by `user.ui_layout`.
2. Support real drag/drop reorder and size adjustment in a grid on desktop, while remaining usable on mobile widths.
3. Persist layout changes through `PUT /api/v1/users/me/layout`; reload must restore the same layout.
4. If `ui_layout` is empty or stale, bootstrap a sensible default from currently approved devices and pin configs using the existing widget metadata pattern. Do not silently discard valid saved widgets.
5. Widgets must remain bound to real device ids and pins. If a widget references a removed or unavailable device/pin, show an explicit degraded or remap-required state instead of pretending the widget is still valid.
6. Preserve the current device control behavior and MQTT command path. Do not regress command execution or online/offline indication.
7. Admin users can customize the dashboard. Non-admin users get a read-only dashboard.
8. Keep the smallest correct change set. Prefer the existing `users.ui_layout` and `PUT /users/me/layout` contract over inventing new backend APIs.
9. If screen behavior changes materially, update `/Users/kiendinhtrung/Documents/GitHub/Final-Project/design/screens.md`. If the file does not exist, create it. Update a relevant flow/task-packet artifact under `/Users/kiendinhtrung/Documents/GitHub/Final-Project/design/flows` if required by the repo workflow.
10. Do not claim completion from static code inspection.

Verification:
1. Browser happy path via `chrome-devtools`:
   - open `/`
   - enter customize mode
   - move and resize at least one widget
   - save
   - reload
   - confirm the layout persists and renders from saved layout data
2. Browser counter-check:
   - induce a failed save or invalid layout payload
   - confirm the UI shows a visible error and does not silently corrupt the last known good layout
3. Network inspection:
   - inspect the profile/layout read path
   - inspect `PUT /api/v1/users/me/layout`
4. Persistence verification:
   - prove before/after change of `users.ui_layout` in the real runtime DB target
   - if runtime still uses SQLite as described in `server/app/database.py`, explicitly state that `mariadb_nas` cannot verify the live target and use direct runtime SQLite inspection as substitute evidence
   - do not fake MariaDB proof if the app is not actually using MariaDB
5. Console inspection:
   - confirm no relevant new console errors
6. Code validation:
   - run the smallest relevant frontend validation commands for changed files

Pass Criteria:
1. Dashboard layout is truly user-configurable and survives reload.
2. The dashboard renders from persisted layout data instead of direct `approvedDevices.map(...)`.
3. Widgets still control real devices after the builder change.
4. A failed save path is handled visibly and safely.
5. Verification evidence matches the actual runtime DB target.

Return the final report in the exact format required by `AGENTS.md`.
```
