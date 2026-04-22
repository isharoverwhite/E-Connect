# Tuya Extensions Research Note

Date: 2026-04-22  
Status: Working baseline for future planning discussion  
Scope: feasibility, recommended approach, device scope, and possible platform expansion driven by Tuya support

## Purpose

This note preserves the current research about building Tuya extensions for E-Connect so we can revisit it later without reconstructing the repository context from scratch.

This is not an implementation commit plan yet. It is a decision-oriented review note based on the current repository baseline.

## Executive Summary

E-Connect can support a Tuya extension today, but only within the boundaries of the current external-device extension slice.

The lowest-risk and most platform-aligned path is:

1. Build a narrow Tuya LAN light extension first.
2. Keep the first version limited to light devices that fit the current `light` card model.
3. Treat broader Tuya support as a platform-expansion decision, not as a simple provider add-on.

The main reason is that the current extension contract already supports uploaded Python ZIP packages with runtime hooks, external-device creation, dashboard rendering, and automation integration for provider-backed light devices. However, the current contract is still narrow:

- current extension UI/runtime is light-focused
- uploaded Python runs in-process
- dependency handling is minimal
- the current config schema is still primitive

If we later decide to expand system scope because of Tuya, that should be framed as a wider external-device platform upgrade.

## Confirmed Repository Facts

### Extension runtime already exists

- E-Connect already supports uploaded Python extension ZIP packages through `manifest.json`, runtime hook validation, extraction, and dynamic import.
- Admins can upload installed extensions, list them, delete them, and create `external_devices` from manifest-declared schemas.
- External devices are merged into the same dashboard and device inventory read models.

Relevant sources:

- `docs/EXTENSIONS.md`
- `design/flows/extensions-external-devices.md`
- `server/app/api.py`
- `server/app/services/extensions.py`
- `server/app/services/extension_runtime_loader.py`
- `server/tests/test_extensions_api.py`

### The current extension contract is light-only

The current repository baseline only supports:

- `display.card_type = light`
- capabilities:
  - `power`
  - `brightness`
  - `rgb`
  - `color_temperature`
- config field types:
  - `string`
  - `number`
  - `boolean`

Relevant sources:

- `server/app/services/extensions.py`
- `server/app/models.py`
- `design/flows/extensions-external-devices.md`

### External devices are intentionally separate from physical DIY/MQTT devices

The platform already distinguishes:

- physical devices in `devices`
- provider-backed devices in `external_devices`

This is a good fit for a Tuya integration because a Tuya device can be represented as an external device without disturbing the DIY/MQTT registry.

Relevant sources:

- `design/database/schema.md`
- `design/flows/extensions-external-devices.md`

### The product baseline is local-first

The repository baseline repeatedly emphasizes:

- self-hosted
- local-first
- LAN control
- offline core behavior when Internet access is unavailable

Relevant sources:

- `README.md`
- `PRD.md`

### Runtime safety is still incomplete

The current repository already accepts uploaded Python code and executes it in-process, but the PRD still treats a fuller extension sandbox as future scope.

Relevant sources:

- `design/change-requests/CR-EXTENSION-DYNAMIC-RUNTIME-002.md`
- `PRD.md`

## Evidence-Based Inferences

These points are not stated as a single explicit sentence in the repository, but they are strongly supported by the inspected code and documents.

### Dependency management for uploaded extensions is currently limited

The repository documentation mentions `requirements.txt` as optional extension content, but the inspected runtime loader only extracts the package and imports Python modules from disk. I did not find a repository mechanism that installs extension-specific dependencies automatically during upload.

That means a Tuya extension has two realistic dependency strategies:

1. Vendor the required pure-Python code inside the uploaded ZIP package.
2. Extend the server runtime or image so the needed Tuya library is already installed.

This matters because a Tuya extension will probably need either:

- a LAN/local-key client library
- a cloud API client library
- or custom protocol code

### Tuya is a good functional fit, but not yet a clean universal fit

A Tuya light extension fits the current contract well.

A broad "all Tuya devices" extension does not fit the current contract cleanly because the platform is still shaped around light-card rendering and light-style automation bindings.

## Feasible Implementation Paths

## Option A: Tuya LAN Light Extension

Status: feasible now  
Recommendation: yes, this should be the first implementation path

Why this fits:

- aligns with the local-first product baseline
- fits the current light card contract
- fits the current external-device model
- fits the current automation model better than sensors, covers, cameras, or climate devices

Recommended first device families:

- on/off white light
- dimmable white light
- tunable white light
- RGB or RGB+CCT light

Candidate v1 schema scope:

| Schema ID | Device type | Current platform fit |
|---|---|---|
| `tuya_white_light` | on/off or dimmable white light | strong |
| `tuya_tunable_white_light` | brightness + color temperature | strong |
| `tuya_color_light` | brightness + RGB | strong |
| `tuya_full_spectrum_light` | brightness + RGB + color temperature | strong |

Recommended config fields for v1:

| Field | Type | Why it matters |
|---|---|---|
| `ip_address` | `string` | direct LAN target |
| `device_id` | `string` | Tuya identity |
| `local_key` | `string` | LAN control credential |
| `protocol_version` | `string` | device compatibility |
| `dps_profile` | `string` | mapping profile for state/action translation |

Implementation model:

1. Package the extension as a Python ZIP.
2. Define light schemas in `manifest.json`.
3. Use `validate_command` to reject unsupported commands or incomplete config.
4. Use `execute_command` to translate E-Connect actions into Tuya DPS writes.
5. Use `probe_state` to normalize Tuya DPS state into the E-Connect light-state shape.
6. Fail closed when a device's DPS map is unknown or unsupported.

Why this is the right first slice:

- It reuses the path the repository already validated for Yeelight.
- It limits scope to one card family the UI already knows how to render.
- It creates a real proof point before we widen the platform.

## Option B: Tuya Cloud Light Extension

Status: technically possible, but not the recommended default path

Why it is possible:

- the extension runtime can call arbitrary Python logic
- external devices can store provider config
- the platform can surface provider-backed device cards

Why it is not the recommended first path:

- it conflicts with the repository's local-first direction
- offline LAN control becomes weaker or impossible
- cloud credentials and token handling increase security scope
- cloud latency and rate limits complicate the UX
- cloud failures are harder to explain in a self-hosted product story

When it could still be considered:

- if the target Tuya devices do not expose reliable LAN control
- if the product direction explicitly changes to allow cloud-backed provider integrations
- if cloud mode is framed as optional fallback, not the default control path

## Option C: Broad Multi-Category Tuya Extension

Status: possible only with broader platform work  
Recommendation: do not start here

This would mean one Tuya package trying to cover:

- lights
- plugs
- wall switches
- sensors
- covers or curtains
- thermostats
- IR bridges
- cameras
- locks

This is not a clean v1 because the current extension contract does not yet provide a first-class model for those categories.

## Recommended Way To Do It

## Recommended Direction

Build a narrow Tuya LAN light extension first.

This is the most feasible path and the path that best matches the current repository architecture.

## Recommended Design Principles

### 1. Treat DPS mapping as a first-class design problem

Tuya compatibility is not just about talking to the device. It is about translating provider-specific DPS shapes into stable product-level capabilities.

That means the extension should not rely on ad hoc assumptions for every device. It should use one of these approaches:

- schema-specific DPS profiles
- product-family profiles
- explicit device configuration that selects a known mapping profile

This is especially important for:

- power state
- brightness ranges
- RGB encoding
- color temperature ranges

### 2. Keep the first scope intentionally narrow

Do not start with "all Tuya devices."

Start with one product slice:

- Tuya LAN lights only

Then decide whether the extension should expand after we learn from real devices.

### 3. Keep the extension self-contained when possible

Because uploaded extension dependency installation is not clearly implemented today, the cleanest first approach is:

- vendor the required Tuya client code into the extension package
- or add a clearly approved Tuya dependency to the server runtime if we decide this integration is now core platform surface

For an early spike, avoiding core runtime changes is safer.

### 4. Normalize state aggressively

The extension should return a stable state shape for the dashboard and automation system:

- `power`
- `brightness`
- `rgb`
- `color_temperature`
- optional capability hints if needed

The E-Connect platform should not need to understand Tuya DPS details directly.

### 5. Fail closed on unsupported devices

A good Tuya extension should refuse to pretend a device is supported if:

- local control is unavailable
- a DPS map is unknown
- the protocol version is incompatible
- the state cannot be normalized safely

This is better than shipping a partially working integration that appears online but behaves inconsistently.

## Device Scope Recommendation

## Recommended Initial Device Scope

Start with this scope only:

- smart bulbs and light strips
- white or dimmable lights
- tunable white lights
- RGB or RGB+CCT lights

Why this should be the initial scope:

- strongest fit with current `light` card support
- strongest fit with current automation bindings
- easiest place to prove the runtime contract works well for Tuya

## Reasonable Next Scope

If the light slice succeeds, the next reasonable expansion is:

- smart plugs
- smart wall switches
- optional power or energy telemetry

This would likely require at least a generic switch card and a clearer non-light capability model.

## Expansion Scope That Likely Requires Platform Changes

These categories should be treated as platform-expansion work:

- sensors
- covers or curtains
- thermostats and climate devices
- IR remotes or hubs
- vacuums
- cameras
- door locks

Why:

- current card types are light-only
- current automation mapping is still light/switch/value oriented
- several of these devices need richer status, events, or command grammars

## If We Expand System Scope Because Of Tuya

If Tuya becomes the reason to widen the system, the right question is not "Can we squeeze more Tuya devices into the current contract?"

The right question becomes:

"How should the external-device platform evolve so provider-backed devices become a first-class multi-category system?"

That would likely require changes in these areas.

## 1. Extension Schema Model

The platform would likely need new card types beyond `light`, for example:

- `switch`
- `sensor`
- `cover`
- `climate`
- possibly `media` or `camera`

It would also need richer capability contracts.

## 2. Webapp Rendering Model

The webapp would need more generic provider-backed card rendering instead of assuming that the primary external-device experience is a light card.

## 3. Automation Model

The automation system would need broader binding support, such as:

- binary switch outputs
- numeric telemetry inputs
- enum states
- cover position
- temperature setpoints
- event-style triggers

## 4. Config Schema Model

Current config fields are limited to `string`, `number`, and `boolean`.

If Tuya scope expands, the platform may need:

- masked secret fields
- enums
- validation patterns
- richer structured config
- provider-guided setup flows

This matters even for a light slice because `local_key` is effectively a secret.

## 5. Runtime Packaging Strategy

If uploaded extensions become a bigger product surface, the platform should probably make a more explicit decision about:

- whether extensions may bring vendored code
- whether approved dependencies are installed into the server image
- whether package size limits should change
- whether uploaded code should remain in-process

## 6. Security And Sandbox

If the platform expands around provider-backed code, a stronger sandbox story becomes more important.

This is already visible in the current PRD, which treats fuller extension sandboxing as future scope.

## 7. Provider Diagnostics And Supportability

Tuya support will likely benefit from better diagnostics such as:

- protocol version mismatch
- DPS map mismatch
- unreachable LAN device
- bad local key
- partial state read

That may justify stronger provider diagnostics in both UI and persistence.

## Proposed Roadmap

## Phase 0: Decision And Target Selection

Decide the intended Tuya mode:

- LAN only
- cloud fallback allowed
- cloud only

Recommended answer for the current product baseline:

- LAN first

Also decide the first real target devices:

- exact bulb or strip models
- exact protocol assumptions
- whether local keys are already available in the expected user journey

## Phase 1: Technical Spike

Goals:

- verify one or two real Tuya LAN lights
- verify protocol version expectations
- prove command translation and state probing
- decide dependency strategy

Deliverables:

- working proof-of-concept package
- confirmed config fields
- confirmed state normalization shape
- list of blockers

## Phase 2: V1 Extension

Build:

- uploadable Python ZIP package
- light-only schemas
- command validation
- state probe
- dashboard compatibility
- automation compatibility for supported capabilities

Tests should mirror the current extension test style:

- upload validation
- create external device
- command execution
- state probing
- unsupported device behavior
- delete-package conflict behavior

## Phase 3: Product Review

After the first working slice, decide whether to:

1. keep Tuya as a narrow light integration
2. add switches and plugs
3. generalize the platform for multi-category provider devices

This should be a deliberate product and platform decision, not an accidental expansion.

## What We Should Do

- Build a Tuya LAN light extension first.
- Use real target devices to validate the DPS mapping strategy.
- Keep the first version limited to schemas the current UI can already render well.
- Preserve a clean boundary between provider logic and core platform logic.
- Use Tuya as a pressure test for the extension system before changing the whole platform.

## What We Should Avoid

- Starting with a huge "support all Tuya devices" scope.
- Making Tuya cloud dependency the default path without an explicit baseline decision.
- Hardcoding unstable Tuya device assumptions directly into the core server.
- Pretending the current extension contract is already generic enough for every provider category.
- Expanding the platform before we know which Tuya categories actually matter to the product.

## Discussion Questions For Later

These are the questions worth revisiting when we continue this topic:

1. Do we want Tuya LAN only, or do we want cloud fallback?
2. Which exact Tuya device families matter first?
3. Do we want one Tuya package or several domain-specific Tuya packages?
4. Are we comfortable storing `local_key` under the current config model, or do we want secret-field support first?
5. Do we want Tuya to remain a provider integration, or do we want it to drive a broader external-device platform upgrade?
6. Should switches and plugs be the next scope after lights, or should the system stay light-only for provider-backed devices for now?

## Evidence Index

- `README.md`
- `PRD.md`
- `docs/EXTENSIONS.md`
- `design/database/schema.md`
- `design/screens.md`
- `design/flows/extensions-external-devices.md`
- `design/change-requests/CR-EXTENSION-DYNAMIC-RUNTIME-002.md`
- `server/app/api.py`
- `server/app/models.py`
- `server/app/services/extensions.py`
- `server/app/services/extension_runtime_loader.py`
- `server/requirements.txt`
- `server/tests/test_extensions_api.py`
