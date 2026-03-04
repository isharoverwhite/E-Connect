# TASK_TEMPLATE.md

## Purpose

Use this template whenever defining a new implementation task for the E-Connect project.

The goal is to give the agent enough context to:
- implement instead of guessing
- verify the result in the browser when needed
- inspect the database when persistence is involved
- stay aligned with the PRD and AGENTS instructions

## Task Template

```md
# Task

## Title
[Short implementation title]

## Objective
[Describe the exact user-facing or system-facing outcome.]

## Product Context
- PRD area: [dashboard / devices / automation / DIY / reporting / auth / connectivity]
- Why this matters: [business or user reason]

## Scope
- In scope:
  - [specific change 1]
  - [specific change 2]
- Out of scope:
  - [explicit non-goal 1]
  - [explicit non-goal 2]

## Relevant Files or Areas
- [path or feature area]
- [path or feature area]

## Data Impact
- Persistence touched: [yes/no]
- Expected tables/entities:
  - [entity 1]
  - [entity 2]
- Required database verification:
  - [what must be checked before]
  - [what must be checked after]

## UI Impact
- Browser verification required: [yes/no]
- Pages or flows:
  - [page/flow 1]
  - [page/flow 2]
- Required checks:
  - [interaction]
  - [error state]
  - [console/network check]

## Design Input
- Stitch reference: [link, screen name, or none]
- Visual constraints:
  - [constraint 1]
  - [constraint 2]

## Acceptance Criteria
- [clear measurable result 1]
- [clear measurable result 2]
- [clear measurable result 3]

## Technical Notes
- [existing architecture note]
- [protocol or library constraint]
- [migration or compatibility note]

## Deliverables
- [code change]
- [test or validation]
- [documentation update if needed]
```

## Example Task

```md
# Task

## Title
Fix dashboard widget binding after DIY device authorization

## Objective
Ensure widgets are auto-created and correctly bound once a newly flashed DIY device is approved by the user.

## Product Context
- PRD area: devices / dashboard / DIY
- Why this matters: users should not have to manually reconfigure widgets after onboarding a new DIY device

## Scope
- In scope:
  - create missing widget bindings after authorization
  - ensure capability metadata maps to widget types
  - verify the dashboard reflects the authorized device immediately
- Out of scope:
  - redesigning the dashboard builder
  - changing MQTT transport architecture

## Relevant Files or Areas
- features/devices
- features/dashboard
- app/api/devices

## Data Impact
- Persistence touched: yes
- Expected tables/entities:
  - devices
  - device_capabilities
  - widgets
  - widget_bindings
- Required database verification:
  - inspect device authorization status before fix
  - confirm widget and binding records after authorization

## UI Impact
- Browser verification required: yes
- Pages or flows:
  - device approval flow
  - dashboard screen
- Required checks:
  - approving a device creates visible controls
  - empty/error state remains valid
  - no console or failed network regressions in tested path

## Design Input
- Stitch reference: dashboard control screen
- Visual constraints:
  - preserve existing widget styles
  - no placeholder controls without real bindings

## Acceptance Criteria
- authorized DIY devices appear on the dashboard with matching controls
- widget bindings persist in storage
- page refresh retains correct controls

## Technical Notes
- authorization and widget creation should be idempotent
- device capability mapping must stay transport-agnostic

## Deliverables
- code change for authorization-to-widget provisioning
- targeted validation of browser flow and database records
```

## Usage Rules

When filling this template:
- keep acceptance criteria measurable
- separate in-scope and out-of-scope items
- state database verification explicitly if any persistence is touched
- state browser verification explicitly if any UI is touched
- mention Stitch only if design is relevant

