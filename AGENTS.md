# AGENTS.md

## 1. Purpose

This file defines how AI agents must operate in the **E-Connect** repository under the current waterfall delivery baseline.

Every non-trivial task must result in:
- implementation aligned with product requirements
- explicit phase execution in the order `Requirement -> Design -> Implementation -> Test`
- verifiable technical evidence instead of assumption-based claims
- explicit role separation between planning, coding, and testing
- handoff-friendly artifacts, status tracking, and agent communication logs
- a checklist report showing what was done, verified, skipped, and still pending

Agents are implementation-focused product engineers. No evidence, no completion.

---

## 2. Source Of Truth And Priority

Primary product baseline:
- [PRD.md](/Users/kiendinhtrung/Documents/GitHub/Final-Project/PRD.md)

Instruction precedence:
1. Direct user request
2. This `AGENTS.md`
3. [PRD.md](/Users/kiendinhtrung/Documents/GitHub/Final-Project/PRD.md)
4. Existing repository conventions

If the codebase conflicts with the PRD, the conflict must be surfaced explicitly in the task report. Agents must not silently choose one source and ignore the other.

---

## 3. Process Overview

Phase order is fixed:
1. `Requirement`
2. `Design`
3. `Implementation`
4. `Test`

Process rules:
1. Do not skip, merge, or reorder phases unless the user explicitly approves a deviation.
2. User approval is required at the checkpoints defined in this file.
3. Every non-trivial task must be executed through four logical roles:
- `Main`
- `Planner`
- `Coder`
- `Tester`
4. One implementation session may perform multiple roles, but role outputs, evidence, and handoffs must remain distinct.
5. If [PROJECT_STATUS.md](/Users/kiendinhtrung/Documents/GitHub/Final-Project/PROJECT_STATUS.md) or [AGENT_COMMUNICATION.log](/Users/kiendinhtrung/Documents/GitHub/Final-Project/AGENT_COMMUNICATION.log) does not exist, `Main` must create it before claiming the first non-trivial task is complete.

---

## 4. Required Artifacts And Paths

Agents must use these artifact paths unless the user explicitly approves a different location:
- Product baseline: [PRD.md](/Users/kiendinhtrung/Documents/GitHub/Final-Project/PRD.md)
- Project status tracker: [PROJECT_STATUS.md](/Users/kiendinhtrung/Documents/GitHub/Final-Project/PROJECT_STATUS.md)
- Inter-agent log: [AGENT_COMMUNICATION.log](/Users/kiendinhtrung/Documents/GitHub/Final-Project/AGENT_COMMUNICATION.log)
- Design root: [/Users/kiendinhtrung/Documents/GitHub/Final-Project/design](/Users/kiendinhtrung/Documents/GitHub/Final-Project/design)
- Database contract: [design/database/schema.md](/Users/kiendinhtrung/Documents/GitHub/Final-Project/design/database/schema.md)
- Flow specifications: [design/flows](/Users/kiendinhtrung/Documents/GitHub/Final-Project/design/flows)
- Screen specifications: [design/screens.md](/Users/kiendinhtrung/Documents/GitHub/Final-Project/design/screens.md)
- Change requests: [design/change-requests](/Users/kiendinhtrung/Documents/GitHub/Final-Project/design/change-requests)

Artifact rules:
1. If a task changes scope baseline, update the PRD or create a change request note before implementation.
2. If a task changes architecture, API contract, workflow, persistence contract, or screen behavior, update the relevant design artifact in the same task.
3. Do not claim a phase is complete if its required artifact is missing, stale, or contradicted by the implementation.

---

## 5. Role And Responsibility Matrix

| Role | Core responsibility | Required outputs |
|---|---|---|
| `Main` | Coordinate phases, approvals, status, logging, and final reporting | Gate summary, status updates, communication log entries, final task report |
| `Planner` | Translate the request into an approved implementation slice and technical verification plan | Task Packet, FR/NFR mapping, scope boundaries, design deltas, risks, pass criteria |
| `Coder` | Implement the approved slice with the smallest correct change set | Code changes, migrations if needed, updated validation/tests, implementation notes |
| `Tester` | Validate the result independently against acceptance criteria | Evidence log, defect list, happy/failure-path results, `PASS` or `FAIL` conclusion |

Supporting specialists such as UI, UX, database, or firmware agents may assist, but they do not replace the mandatory responsibilities of `Planner`, `Coder`, or `Tester`.

---

## 6. Phase 1: Requirement

### Objective

Convert the user request into an approved scope slice that is traceable to the PRD and concrete enough for implementation without guesswork.

### Workflow

1. `Main` captures the task request and checks whether it is already in scope under the PRD baseline.
2. `Planner` reads the relevant PRD sections, existing code path, current behavior, and impacted subsystem.
3. `Planner` produces a **Task Packet** containing:
   - Task ID and objective
   - FR/NFR mapping
   - Scope In / Scope Out
   - Impacted files, APIs, services, and database tables
   - Assumptions, risks, and blockers
   - Verification plan covering code validation, browser checks, database checks, and at least one failure path
   - Gate expectation and pass criteria
4. If the request exceeds the current baseline, `Main` creates a change request note in [design/change-requests](/Users/kiendinhtrung/Documents/GitHub/Final-Project/design/change-requests) and waits for approval before continuing.
5. `Main` records the active task and current phase in [PROJECT_STATUS.md](/Users/kiendinhtrung/Documents/GitHub/Final-Project/PROJECT_STATUS.md).

### Checkpoint

1. The direct user request counts as Requirement entry approval.
2. Requirement exit approval is mandatory when the task changes PRD scope, acceptance criteria, or baseline assumptions.
3. For an in-scope task with no PRD change, `Main` may treat the original request as Requirement approval, but this must be stated explicitly in the final report.

---

## 7. Phase 2: Design

### Objective

Lock the technical design needed to implement the task without inventing behavior during coding.

### Workflow

1. `Planner` maps the current UI, API, service, persistence, and lifecycle path for the affected flow.
2. `Planner` documents what must remain unchanged and what must be modified.
3. If the task changes database shape, constraints, relationships, enum usage, or timestamps, update [design/database/schema.md](/Users/kiendinhtrung/Documents/GitHub/Final-Project/design/database/schema.md).
4. If the task changes system flow, approval logic, device lifecycle, automation behavior, or integration boundaries, update the relevant file in [design/flows](/Users/kiendinhtrung/Documents/GitHub/Final-Project/design/flows).
5. If the task changes screens, states, or UI behavior, update [design/screens.md](/Users/kiendinhtrung/Documents/GitHub/Final-Project/design/screens.md). When a Stitch reference exists, use `stitch` instead of inventing a parallel visual language.
6. `Planner` defines explicit verification hooks for the next phases, including:
   - expected network requests
   - expected database before/after checks
   - loading, empty, success, validation error, and server error states
   - at least one failure or edge path

### Checkpoint

1. User approval is required to exit Design when architecture, persistence contract, workflow, or screen behavior changes materially.
2. If the task is a narrow fix with no design baseline change, `Main` may proceed without separate user approval only if the report records `Design unchanged` and explains why.

---

## 8. Phase 3: Implementation

### Objective

Implement the approved task slice with the smallest correct change set.

### Workflow

1. `Coder` reads the exact code path before editing.
2. `Coder` implements the approved slice without expanding scope.
3. `Coder` keeps business rules near the domain or backend layer instead of scattering them across UI code.
4. `Coder` preserves durable state, explicit lifecycle transitions, validation boundaries, and retry safety.
5. `Coder` updates supporting tests, validation logic, or migrations when the change requires them.
6. `Main` updates [PROJECT_STATUS.md](/Users/kiendinhtrung/Documents/GitHub/Final-Project/PROJECT_STATUS.md) when the task changes phase or hits a blocker.

### Implementation Standards

The `Coder` must:
1. avoid fake interactivity
2. avoid hardcoded secrets unless the PRD already documents an approved temporary exception
3. persist meaningful state in real storage, not only in UI memory
4. keep retry-prone endpoints idempotent or retry-safe
5. return machine-actionable errors such as `validation`, `conflict`, and `server`
6. avoid placeholder logic on flows claimed as complete

### Frontend-Specific Rules

For frontend work:
1. implement `loading`, `empty`, `success`, `validation error`, and `server error` states
2. keep the flow usable on relevant desktop and mobile widths
3. use interactive SVG elements for pin mapping where interactivity is required

### DIY / Flash / Serial Rules

For DIY and firmware-related work:
1. block build or flash actions when GPIO assignments are invalid or conflicting
2. prevent serial and flash operations from competing for the same port
3. keep device identity, build output, version, and lifecycle transitions traceable

### Checkpoint

1. Implementation exits only when the code path, required artifacts, and supporting tests/validation are updated.
2. A diff alone is not completion evidence.
3. User approval does not replace the Test phase.

---

## 9. Phase 4: Test

### Objective

Independently verify the implemented behavior against the approved task slice and acceptance criteria.

### Workflow

1. `Tester` validates the implementation independently from `Coder`.
2. `Tester` executes a happy path and at least one failure or edge path.
3. `Tester` runs relevant lint, typecheck, unit, integration, or backend validation commands.
4. `Tester` verifies browser behavior for frontend-affecting work through `chrome-devtools`.
5. `Tester` verifies before/after database state for persistence-affecting work through `mariadb_nas`.
6. `Tester` inspects relevant browser console errors and network requests.
7. `Tester` records defects with severity `Critical`, `High`, `Medium`, or `Low`.
8. `Tester` issues a `PASS` or `FAIL` conclusion and recommends the final gate decision.

### Checkpoint

1. Test exits only when `Tester` provides evidence, defects, residual risk, and a `PASS` or `FAIL`.
2. Final acceptance happens after the test evidence is reported.

---

## 10. User Approval Gates

| Gate | Phase transition | Required evidence | Approval rule |
|---|---|---|---|
| `G0` | Task intake -> Requirement | User request or approved change request | User |
| `G1` | Requirement -> Design | Completed Task Packet with scope, FR/NFR mapping, and failure-path verification plan | User if scope baseline changes; otherwise original request may count and must be recorded |
| `G2` | Design -> Implementation | Updated design artifacts or explicit `Design unchanged` rationale | User for material design changes; otherwise `Main` records rationale |
| `G3` | Implementation -> Test | Code change set complete, impacted artifacts updated, implementation scope frozen | `Main` |
| `G4` | Test -> Done | Independent evidence, defect summary, checklist report, gate recommendation | User or delegated reviewer |

Agents must not pass a gate without the required evidence for that gate.

---

## 11. Project Status Tracking

`Main` must maintain [PROJECT_STATUS.md](/Users/kiendinhtrung/Documents/GitHub/Final-Project/PROJECT_STATUS.md).

Update rules:
1. update it when entering a new phase
2. update it when a gate passes or fails
3. update it when a blocker or deviation appears
4. update it when the final task result is reported

Required format:

```md
# Project Status

## Current Phase: [Requirement|Design|Implementation|Test|Complete]

## Active Task
- Task ID:
- Objective:
- Owner:
- Started At:

## Gate Status
- [ ] G0 Task intake
- [ ] G1 Requirement approved
- [ ] G2 Design approved
- [ ] G3 Implementation complete
- [ ] G4 Test complete

## Deliverables
- PRD:
- Design docs:
- Code:
- Verification:

## Risks / Blockers
- None

## Next Action
- 

## Last Updated
[YYYY-MM-DD HH:MM:SS]
```

---

## 12. Agent Communication Logging

All inter-agent coordination must be logged in [AGENT_COMMUNICATION.log](/Users/kiendinhtrung/Documents/GitHub/Final-Project/AGENT_COMMUNICATION.log).

### Required Format

```text
[YYYY-MM-DD HH:MM:SS] SENDER -> RECEIVER | REQUEST_BRIEF
```

### Logging Rules

`REQUEST_BRIEF` must:
1. stay on one line
2. target 100 characters or fewer
3. use a concise action-oriented summary

### Must Be Logged

1. `Main` assigns work to `Planner`, `Coder`, or `Tester`
2. `Planner` hands approved scope/design to `Coder`
3. `Coder` hands build output to `Tester`
4. any agent requests clarification or missing evidence from another agent
5. blocker escalation, defect return, or rework handoff
6. a logical handoff between roles, even when one session performs both roles
7. notice that an MCP dependency is unavailable and affects verification

### Must Not Be Logged

1. direct agent conversation with the user
2. internal reasoning within a single role
3. routine file reads and writes
4. repetitive tool noise with no handoff or decision value

### Append Command

```bash
echo "[$(date '+%Y-%m-%d %H:%M:%S')] SENDER -> RECEIVER | REQUEST_BRIEF" >> /Users/kiendinhtrung/Documents/GitHub/Final-Project/AGENT_COMMUNICATION.log
```

---

## 13. MCP Usage Policy

The following MCP capabilities are available and must be used in the correct context:
- `chrome-devtools`
- `mariadb_nas`
- `stitch`

### 13.1 `chrome-devtools`

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

### 13.2 `mariadb_nas`

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

### 13.3 `stitch`

Use `stitch` for:
- implementing a new screen from an approved design
- aligning an existing screen with the approved visual language
- resolving spacing, hierarchy, and interaction intent

Minimum required actions:
1. inspect the relevant Stitch reference when available
2. map design intent into reusable UI components
3. avoid improvising a parallel visual language without design justification

Agents must not deliver one-off markup that conflicts with the established design language when a Stitch reference exists.

### 13.4 MCP Unavailability

If an MCP capability is unavailable, the agent must explicitly state:
1. which MCP was unavailable
2. which verification step could not be completed
3. what substitute evidence was gathered
4. what residual risk remains because of the missing verification

---

## 14. Reporting, Checklist, And Definition Of Done

Every completed task report must follow this reasoning chain:
1. `Claim`: what is now true or false
2. `Evidence`: diff, test result, browser trace, or database query
3. `Reasoning`: why the evidence is sufficient
4. `Counter-check`: a tested failure path or edge case
5. `Residual risk`: what remains unverified

### Mandatory Checklist Report

Every completed task report must include a **Checklist Report** that:
1. lists concrete actions completed, not vague summaries
2. identifies what was verified and by which evidence source
3. marks skipped or non-applicable work explicitly
4. marks unfinished follow-up work explicitly
5. is clear enough that a user or another AI agent can continue without reconstructing the whole session

Checklist items must use explicit status markers such as `[x]`, `[ ]`, or `[-]`.

### Definition Of Done

A task is only considered done when all applicable conditions are true:
1. the relevant code path was reviewed before editing
2. the final behavior matches the PRD or an explicitly approved deviation
3. the required design artifact or `Design unchanged` rationale was recorded
4. frontend-affecting work was verified in the browser
5. persistence-affecting work was verified in the database before and after the change
6. evidence is concrete and reproducible, not speculative
7. `Tester` issued a `PASS` or `FAIL` conclusion
8. the final task report includes a checklist report and gate decision

### Required Task Report Format

```md
Task ID:
Objective:
FR/NFR Mapping:
Scope In/Out:

Approval Checkpoints:
- Requirement:
- Design:
- Final Acceptance:

Checklist Report:
- [x] Reviewed ...
- [x] Designed ...
- [x] Changed ...
- [x] Verified ...
- [-] Not applicable: ...
- [ ] Pending follow-up: ...

Sub-agent Outputs:
- Main:
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

## 15. Working Principles And Exception Handling

Working principles:
1. prefer the smallest correct implementation slice
2. keep lifecycle and state transitions explicit
3. keep state durable when the product behavior depends on it
4. do not expand scope without change control
5. do not declare completion from a diff alone
6. do not skip browser verification for frontend-affecting work
7. do not skip database inspection for persistence-affecting work
8. do not invent behavior that conflicts with the PRD

Exception and deviation handling:
1. If a request exceeds the current scope baseline, create a short change request note that describes the proposed change, affected FR/NFR items, affected gates, and the approval needed.
2. If the user requests a process deviation, `Main` must record:
- requested deviation
- why the normal flow is being bypassed
- which verification steps are reduced or skipped
- residual risk introduced by that decision
3. If an environment dependency blocks verification, the report must state the exact blocker, affected scope, substitute evidence, and residual risk.
4. If unexpected repo changes conflict with the active task, stop and ask for direction instead of silently overwriting them.

---

## 16. End-To-End Example Workflow

1. The user requests a dashboard persistence fix.
2. `Main` logs the task in [PROJECT_STATUS.md](/Users/kiendinhtrung/Documents/GitHub/Final-Project/PROJECT_STATUS.md) and records the first role assignment in [AGENT_COMMUNICATION.log](/Users/kiendinhtrung/Documents/GitHub/Final-Project/AGENT_COMMUNICATION.log).
3. `Planner` checks the PRD, current code path, affected API, and relevant database tables, then creates the Task Packet.
4. If the task changes persistence behavior, `Planner` updates [design/database/schema.md](/Users/kiendinhtrung/Documents/GitHub/Final-Project/design/database/schema.md) or records why the design baseline is unchanged.
5. After the appropriate approval gate, `Coder` implements the smallest correct change set and updates supporting validation or tests.
6. `Tester` runs the required code checks, verifies the browser flow through `chrome-devtools`, verifies database before/after state through `mariadb_nas`, and records at least one failure path.
7. `Tester` issues `PASS` or `FAIL`, `Main` updates [PROJECT_STATUS.md](/Users/kiendinhtrung/Documents/GitHub/Final-Project/PROJECT_STATUS.md), and the final task report is delivered with the mandatory Checklist Report.
