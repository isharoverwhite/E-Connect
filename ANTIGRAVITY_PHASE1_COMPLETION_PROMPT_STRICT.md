Use the repository docs below as the mandatory source of truth before making changes:

- `/Users/kiendinhtrung/Documents/Playground/PRD.md`
- `/Users/kiendinhtrung/Documents/Playground/USER_FLOW.md`
- `/Users/kiendinhtrung/Documents/Playground/INITIAL_ARCHITECTURE.md`
- `/Users/kiendinhtrung/Documents/Playground/STACK_DECISIONS.md`
- `/Users/kiendinhtrung/Documents/Playground/DATABASE_CONTRACT.md`
- `/Users/kiendinhtrung/Documents/Playground/UI_IMPLEMENTATION_GUIDE.md`
- `/Users/kiendinhtrung/Documents/Playground/VERIFICATION_CHECKLIST.md`
- `/Users/kiendinhtrung/Documents/Playground/AGENTS.md`

You are not being asked to patch a single flow. You are being asked to close the remaining gaps required to truthfully declare Phase 1 complete.

## Scope Resolution You Must Apply

The docs contain a scope tension that you must handle explicitly instead of silently choosing one interpretation:

- `PRD.md` section `9.1 MVP` includes: core dashboard, basic automation, local storage/offline, basic user management, MQTT connectivity, DIY no-code builder, SVG pin mapping, build/flash, device identity, auto widget provisioning, serial debugging/flash coordination, discovery/authorization, and reconnect handling.
- `PRD.md` section `Phase 1 - MVP Foundation` is narrower and frames Phase 1 as the foundation: core dashboard, MQTT device communication, user management, local storage/offline, and initial DIY no-code builder.

For this task, treat Phase 1 completion as:

- all foundation capabilities that are required for a real end-to-end MVP path to work on a self-hosted local instance
- plus any adjacent MVP slices from section `9.1 MVP` that are mandatory to make that path actually usable rather than demo-only

That means Phase 1 is not complete if the project only has setup screens, partial backend scaffolding, mock data, or isolated UI pages. Phase 1 is complete only if a user can move through the real product path below with durable state and verified behavior:

1. bootstrap the instance and create the first usable household/admin context
2. create or configure a first DIY device definition
3. complete device discovery / authorization / identity assignment
4. see the device represented on a real persisted dashboard
5. control or observe the device through the real MQTT-backed path
6. retain local-first behavior and sane offline behavior for the MVP slice

Basic automation and serial/flash coordination are Phase 1 requirements only if they are already partially implemented or are the remaining blocker for the above path to be considered usable. Do not expand into speculative platform work beyond that.

## Objective

Audit the current repository against the true Phase 1 bar above, identify the exact unfinished slices, then implement and verify the smallest correct change set that closes those slices end to end.

Do not stop after finding likely causes. Do not stop after wiring setup. Do not stop after backend-only or frontend-only completion. Close the loop with code, browser verification, and persistence verification.

## Product Rules You Must Preserve

- The product is local-first and self-hosted. Do not introduce cloud-only assumptions for core operation.
- Household-based user management and role-aware behavior are required.
- Newly discovered devices must require explicit approval before becoming fully managed.
- Device identity must be durable and traceable.
- Dashboard state must be persisted, not held only in transient client state.
- MQTT is a transport boundary, not the domain model itself.
- Offline LAN control must not depend on public Internet.
- Business rules belong in domain/server code, not only in UI components.

## Required Audit Before Any Broad Changes

Read the docs first, then trace the current implementation across these areas:

1. bootstrap / initial setup / first-run initialization
2. auth, household, role, and session flow
3. device registry, discovery, authorization, identity, and capability mapping
4. dashboard layout persistence, widget binding, and real-state rendering
5. MQTT adapter or transport integration path for state/control
6. DIY builder path: board profile, SVG pin mapping, config generation, and any build/flash handoff that already exists
7. automation or serial slices only if they are partially built and are the remaining blocker to a usable MVP path

Before implementing, produce an internal gap map with this structure:

- implemented and verified already
- implemented but broken or not wired end to end
- missing but required for Phase 1
- explicitly out of scope for Phase 1 completion

## Non-Negotiable Completion Standard

You may only claim Phase 1 complete if the repository supports a real vertical slice with all of the following true:

- the instance can determine whether bootstrap/setup is required
- first-run setup creates durable bootstrap/auth state safely
- re-initialization is blocked safely after setup
- a DIY device can reach a persisted draft/config state from the web flow
- invalid GPIO assignments are blocked before destructive steps
- a discovered device enters an explicit pending-authorization state
- approving a device results in durable identity, authorization, and capability records
- the approved device appears in device management and in a real dashboard-bound form
- dashboard controls reflect real capability bindings, not placeholder widgets
- device state/control flows through the actual transport/domain path expected for MQTT-first architecture
- online/offline or reconnect state is explicit where that slice exists
- refresh or restart does not erase the completed state

If one of those items is missing, Phase 1 is not complete.

## Implementation Rules

- Prefer the smallest vertical-slice change set that closes real gaps over broad refactors.
- Preserve existing architecture and naming conventions when they are coherent.
- Add runtime input validation at all external boundaries.
- Keep state transitions explicit, especially for bootstrap, device authorization, build/flash jobs, and reconnect state.
- Avoid fake UI interactivity that has no durable backend state.
- Do not mark a feature done because a page renders; it must read/write the expected persisted state.
- Do not introduce new dependencies unless the repository clearly needs them.
- If the repository is early-stage, establish the minimal structure required for the missing Phase 1 slices rather than inventing a large framework.

## Data and Protocol Verification Rules

If you touch persisted data, you must inspect the real database before and after changes. Do not assume table names, enums, or foreign keys.

At minimum verify the actual stored state for the relevant entities:

- bootstrap/system settings
- users
- households
- memberships
- roles
- sessions
- devices
- device authorization records
- device capability records
- dashboards/layouts/widgets/bindings
- DIY project or board/pin assignment records
- build/flash job records if that slice is touched
- automation records only if automation is in scope for the final blocker

If you touch MQTT/device lifecycle behavior, verify the path that proves the state transition or command route is real. Do not accept a UI-only simulation unless the product slice is explicitly a simulator.

## Browser Verification Rules

Because this task affects user-facing flows, you must use browser verification and inspect:

- console errors
- failed network requests
- loading states
- validation states
- success path
- one obvious failure path
- refresh behavior after success
- mobile-width sanity for the touched flows

Do not claim the UI works from static code reading alone.

## Phase 1 Priority Order

Implement in this order unless the repository makes a different order obviously safer:

1. bootstrap, auth, household, and role foundation
2. device registry, pending authorization, approval flow, and durable identity
3. dashboard persisted read model with real widget binding for approved device capabilities
4. MQTT-backed state/control path and reconnect/offline behavior required for the MVP slice
5. DIY builder minimum usable flow: board selection, SVG pin mapping, validation, durable config, and handoff to existing build/flash path
6. only then address basic automation or serial/flash coordination if they remain the specific blocker preventing honest Phase 1 completion

## Explicit Out Of Scope Unless Directly Required To Unblock The Vertical Slice

- reporting and exports
- Zigbee expansion
- OTA manager
- extension marketplace or broad Python extension system
- migration/restore
- voice integrations
- large visual redesign unrelated to the missing Phase 1 path
- speculative abstractions for future phases

## Acceptance Gates

You are done only when you can prove all applicable statements below with concrete evidence:

- the code path for setup/bootstrap was read before changes
- the code path for auth/household/session was read before changes
- the code path for device onboarding/authorization was read before changes
- the code path for dashboard persistence and rendering was read before changes
- the code path for MQTT transport or adapter usage was read before changes if touched
- product behavior stays aligned with the PRD and USER_FLOW docs
- required persisted records were inspected before and after changes
- the browser flow was exercised end to end for the touched paths
- the console was clean for the exercised path, or remaining noise was explicitly explained
- repeated submission or retry does not obviously create duplicate/bootstrap corruption
- refresh after success reflects persisted state
- the resulting system is closer to a real self-hosted MVP and not just a stitched-together demo

## Final Deliverable Format

When finished, report:

1. the gap list you found for unfinished Phase 1 work
2. the concrete files and code paths changed
3. what browser flows were verified
4. what database records were inspected before and after
5. what MQTT/device-path behavior was verified if touched
6. whether basic automation or serial/flash was required for honest Phase 1 completion, and why
7. any residual risk or unverified edge that still prevents a strict “Phase 1 complete” declaration

## Hard Stop Rules

Do not declare Phase 1 complete if any of the following remain true:

- setup works but auth/household state is not durable
- devices can be discovered but not explicitly approved
- devices can be approved but identity/capability/dashboard state is not persisted coherently
- dashboard shows placeholder or mocked state instead of real bound device state
- MQTT is nominally present but the actual control/state loop is not wired
- DIY builder exists visually but pin assignments/config are not durably stored or validated
- the happy path works only until refresh
- browser or database verification was skipped for a touched area

Implement the missing work, verify it, and only then decide whether Phase 1 can honestly be called complete.
