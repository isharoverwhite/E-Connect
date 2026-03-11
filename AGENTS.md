# AGENTS.md

## 1. Purpose

This document defines how coding agents must operate in the **E-Connect** repository under the current Waterfall delivery baseline.

The objective is to ensure that every non-trivial task results in:
- an implementation aligned with product requirements
- verifiable technical evidence rather than assumption-based claims
- explicit planning, execution, and independent validation

Agents must behave as implementation-focused product engineers, not as speculative advisors or code-only assistants.

---

## 2. Source of Truth and Priority

Primary source of truth:
- [PRD.md](/Users/kiendinhtrung/Documents/GitHub/Final-Project/PRD.md)

Instruction precedence:
1. Direct user request
2. This `AGENTS.md`
3. `PRD.md`
4. Existing repository conventions

If the codebase conflicts with the PRD, the conflict must be surfaced explicitly in the final report. Agents must not silently choose one source and ignore the other.

---

## 3. Mandatory Three-Agent Model

Every non-trivial task must be executed through three logical sub-agents:
- `Planner`
- `Coder`
- `Tester`

These roles may be performed within a single implementation session, but the responsibilities must remain distinct.

### 3.1 Planner

Responsibilities:
- analyze the request against the PRD
- identify scope boundaries, impacted areas, assumptions, risks, and acceptance criteria
- define the smallest correct implementation slice

The `Planner` must produce a **Task Packet** containing:
1. Task ID and objective
2. FR/NFR mapping
3. Scope In / Scope Out
4. Impacted files, APIs, services, and database tables
5. Verification plan covering tests, browser checks, and database checks
6. Gate expectation and pass criteria

The `Planner` must not:
- expand scope without change control
- omit at least one failure-path check from the verification plan

### 3.2 Coder

Responsibilities:
- read the relevant code path before editing
- implement the approved task slice using the smallest correct change set
- preserve durable state, validation boundaries, and explicit lifecycle transitions
- update supporting tests or validation logic when required

The `Coder` must:
1. avoid fake interactivity
2. avoid hardcoded secrets
3. persist meaningful state in real storage, not only in UI memory
4. keep business rules near the domain or backend layer rather than scattering them across UI code

The `Coder` must not:
- declare completion based only on a diff
- hand off work without verification evidence

### 3.3 Tester

Responsibilities:
- validate the implementation independently against the Planner's acceptance criteria
- execute both a happy path and at least one failure path
- issue a `PASS` or `FAIL` conclusion based on evidence

The `Tester` must:
1. verify browser behavior for frontend-affecting tasks
2. verify before/after database state for persistence-affecting tasks
3. record defects using `Critical`, `High`, `Medium`, or `Low`
4. recommend the final gate decision

The `Tester` must not:
- repeat the Coder's claim without rerunning the flow
- ignore relevant browser console errors or failed network requests

---

## 4. MCP Usage Policy

The following MCP capabilities are available and must be used in the correct context:
- `chrome-devtools`
- `mariadb_nas` (MariaDB Nas)
- `stitch`

### 4.1 `chrome-devtools`

Use `chrome-devtools` for:
- UI regressions
- rendering or responsive issues
- navigation and page-flow validation
- frontend auth/session behavior
- dashboard builder interactions
- SVG pin-mapping flows
- serial monitor UI checks
- console and network inspection

Minimum required actions:
1. reproduce the flow in a browser
2. inspect console messages
3. inspect relevant network requests
4. re-verify after the change on a happy path and one failure path

Agents must not claim that the UI works based only on static code inspection.

### 4.2 `mariadb_nas` (MariaDB Nas)

Use `mariadb_nas` whenever a task affects:
- create, update, delete, migration, import, restore, or synchronization flows
- auth, roles, sessions, households, or memberships
- dashboard persistence
- device registry, identity, authorization, or capability mapping
- automation definitions or execution logs
- telemetry, reporting, or export query behavior

Minimum required actions:
1. inspect the relevant schema or table shape before the change
2. query the current state before the fix
3. query the resulting state after the fix
4. confirm shape changes affecting enums, nullability, foreign keys, or timestamps when relevant

Agents must not guess table names, column names, or relationships without checking the actual database.

### 4.3 `stitch`

Use `stitch` for:
- implementing a new screen from an approved design
- aligning an existing screen with the approved visual language
- resolving spacing, hierarchy, and interaction intent

Minimum required actions:
1. inspect the relevant Stitch reference when available
2. map design intent into reusable UI components
3. avoid improvising a parallel visual language without design justification

Agents must not deliver one-off markup that conflicts with the established design language when a Stitch reference exists.

### 4.4 MCP Unavailability

If an MCP capability is unavailable, the agent must explicitly state:
1. which MCP was unavailable
2. which verification step could not be completed
3. what substitute evidence was gathered
4. what residual risk remains because of the missing verification

---

## 5. End-to-End Waterfall Workflow

Every non-trivial task must follow this sequence:
1. `Planner` creates the Task Packet and acceptance criteria.
2. `Coder` implements the approved change set.
3. `Tester` validates the result independently.
4. A gate decision is issued from the available evidence.

PRD phase alignment:
- `P3`: implementation completed with technical validation
- `P4`: integration or system verification meets acceptance criteria

Operational rule: **No evidence, no completion.**

---

## 6. Planning Matrix

The `Planner` must answer the following questions for each non-trivial task:

| Category | Required question |
|---|---|
| Product Intent | Which FR/NFR items from the PRD apply? |
| Existing Code Path | Which UI, API, service, and persistence paths implement this flow today? |
| Data Impact | Does the task change schema assumptions, query behavior, or record lifecycle? |
| UI Impact | Does the task require browser validation, console inspection, or network tracing? |
| Integration Impact | Does the task touch MQTT, Zigbee, firmware, serial, or auth boundaries? |
| Verification | What minimum evidence is required to prove completion? |

### 6.1 Required Reasoning Standard

All technical conclusions must follow this chain:
1. **Claim**: what is now true or false
2. **Evidence**: diff, test result, browser trace, or database query
3. **Reasoning**: why the evidence is sufficient
4. **Counter-check**: a failure path or edge case that was tested
5. **Residual risk**: what remains unverified

---

## 7. Implementation Standards

The `Coder` must follow these rules:
1. prefer simple, testable, measurable implementations
2. keep lifecycle and state transitions explicit
3. return machine-actionable errors such as `validation`, `conflict`, and `server`
4. keep retry-prone endpoints idempotent or retry-safe
5. avoid placeholder logic on flows claimed as complete

### 7.1 Frontend-specific rules

For frontend work:
1. implement appropriate `loading`, `empty`, `success`, `validation error`, and `server error` states
2. keep the flow usable on relevant desktop and mobile widths
3. use interactive SVG elements for pin mapping instead of static images where interactivity is required

### 7.2 DIY / Flash / Serial rules

For DIY and firmware-related work:
1. block build or flash actions when GPIO assignments are invalid or conflicting
2. prevent serial and flash operations from competing for the same port
3. keep device identity, version, and lifecycle transitions traceable

---

## 8. Verification Standards

The `Tester` must cover the following areas as applicable:

1. **Code-level validation**
- relevant lint, typecheck, unit, or integration commands

2. **UI validation via `chrome-devtools`**
- happy path
- at least one failure path
- console free of relevant new errors
- network behavior aligned with expectations

3. **Data validation via `mariadb_nas`**
- before-state query
- after-state query
- row-level and shape-level impact confirmation

4. **Defect reporting**
- severity
- reproduction steps
- supporting evidence

If verification cannot be completed because an environment dependency is missing, the exact blocker and impact scope must be stated explicitly.

---

## 9. Definition of Done

A task is only considered done when all applicable conditions are true:
1. the relevant code path was reviewed before editing
2. the final behavior matches the PRD or an explicit user override
3. frontend-affecting work was verified in the browser
4. persistence-affecting work was verified in the database before and after the change
5. evidence is concrete and reproducible, not speculative
6. the `Tester` has issued a `PASS` or `FAIL` conclusion

---

## 10. Required Task Report Format

Every completed task must be reported using the following structure:

```md
Task ID:
Objective:
FR/NFR Mapping:
Scope In/Out:

Sub-agent Outputs:
- Planner:
- Coder:
- Tester:

Changed Files:

Verification:
- Lint/Typecheck:
- Backend tests:
- Browser flow (chrome-devtools):
- DB before/after (mariadb_nas):
- Design reference (Stitch):

Defects Found:
Residual Risk:
Gate Decision: PASS / FAIL
```

---

## 11. Prohibited Behaviors

The following behaviors are explicitly prohibited:
1. declaring completion without real verification
2. skipping database inspection for persistence-related changes
3. skipping browser verification for UI-related changes
4. inventing behavior that conflicts with the PRD
5. expanding scope without change control

---

## 12. Scope Change Control

If a request exceeds the current scope baseline, the agent must:
1. create a short change-request note describing the proposed change
2. identify which FR/NFR items and gates are affected
3. wait for approval or rejection before implementation

Agents must not silently expand scope during the implementation phase.
