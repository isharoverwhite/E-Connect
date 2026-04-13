# AGENTS.md

## 1. Purpose

This file defines how AI agents must operate in the **E-Connect** repository during the current **project review baseline**.

Every non-trivial task must result in:
- evidence-based project analysis aligned with the actual repository state
- explicit phase execution in the order `Repository Intake -> Evidence Collection -> Review Analysis -> Reporting And Handoff`
- review artifacts, findings, Git assessment, and prompt outputs that another agent can reuse immediately
- clear distinction between confirmed facts, inferred conclusions, and unresolved unknowns
- handoff-friendly status tracking and agent communication logs
- an explicit checklist showing what was reviewed, what was skipped, and what still needs follow-up

Agents are review-focused project analysts and prompt engineers. No evidence, no conclusion.

Unless the user explicitly switches the task back to implementation, agents must not treat review findings as authorization to modify product code, deploy runtime changes, or publish Git changes.

---

## 2. Source Of Truth And Priority

Primary review baselines:
- [PRD.md](./PRD.md)
- [README.md](./README.md)
- [design](./design)
- repository manifests and workflow configuration files

Instruction precedence:
1. Direct user request
2. This `AGENTS.md`
3. [PRD.md](./PRD.md)
4. Other repository documentation and conventions

If the codebase conflicts with the PRD, README, or design artifacts, that conflict must be surfaced explicitly in the review output. Agents must not silently normalize one source and ignore the others.

Default execution mapping for this review baseline:
- `Codex` owns `Main`, `Planner`, `Project Analyst`, `Git Analyst`, and `Prompt Engineer`
- `Antigravity` is not assigned by default during review and is only engaged when the user explicitly asks to transition from review into implementation

### Deployment Topology Baseline

1. `E-Connect Web Assistant`, also referred to as `find_website` or the public find website, is a developer-hosted service and must run only on infrastructure owned or operated by the project owner.
2. The approved public entrypoint for that discovery experience is [find.isharoverwhite.com](https://find.isharoverwhite.com), unless the user explicitly approves a different developer-hosted origin.
3. Agents must not deploy, bundle, or recommend `find_website` on an end user's home server as part of the normal self-hosted stack unless the product baseline is explicitly changed through approval.
4. The end user's self-hosted topology is limited to `server`, `webapp`, `mqtt`, and `db`, running on hardware the user controls in their own environment.
5. The self-hosted `webapp` must be opened on an HTTPS origin in user-facing flows. All user-facing WebUI instructions, example URLs, deployment notes, and browser verification targets for `webapp` must use an explicit `https://` URL, and agents must not silently downgrade those targets to plain HTTP unless the user explicitly asks for a local diagnostic exception.
6. After finishing local setup, the end user is expected to open [find.isharoverwhite.com](https://find.isharoverwhite.com) from a device on the same LAN to discover the self-hosted `server` they just installed.
7. Discovery requests are initiated by the end user's browser toward devices on the end user's LAN; the developer-hosted find website is the public entrypoint and UI, not the LAN scanner running on the developer server.
8. Any proposal to move the find website onto the user's hardware or to make discovery run server-side from the developer infrastructure is a material baseline change and requires explicit approval plus matching documentation updates.

### Review Artifact Root

All generated review artifacts must default to:
- `/Users/kiendinhtrung/Desktop/econnect doc`

Default subfolders under that root:
- Analysis notes: `/Users/kiendinhtrung/Desktop/econnect doc/analysis`
- Diagrams: `/Users/kiendinhtrung/Desktop/econnect doc/diagrams`
- Git assessments: `/Users/kiendinhtrung/Desktop/econnect doc/git`
- Prompt packs: `/Users/kiendinhtrung/Desktop/econnect doc/prompts`

Artifact location rules:
1. Generated analysis files, review notes, summaries, prompt packs, and checklists belong under the review artifact root, not inside the repository, unless the user explicitly asks for repo-local documentation.
2. Generated diagrams must be stored under the `diagrams` folder. Use Mermaid in `.md` or `.mmd` by default unless the user asks for another format.
3. Repository coordination files such as [PROJECT_STATUS.md](./PROJECT_STATUS.md) and [AGENT_COMMUNICATION.log](./AGENT_COMMUNICATION.log) remain in the repository root.
4. When creating external review files, prefer timestamped names such as `20260410-architecture-review.md` or `20260410-device-flow.mmd`.
5. If the task only needs a direct chat response, file creation is optional, but any file that is created must be reported with its exact absolute path.

---

## 3. Process Overview

Phase order is fixed for the current baseline:
1. `Repository Intake`
2. `Evidence Collection`
3. `Review Analysis`
4. `Reporting And Handoff`

Process rules:
1. Do not skip, merge, or reorder phases unless the user explicitly approves a deviation.
2. User approval is required at the checkpoints defined in this file.
3. Every non-trivial review task must be executed through five logical roles:
- `Main`
- `Planner`
- `Project Analyst`
- `Git Analyst`
- `Prompt Engineer`
4. One review session may perform multiple roles, but role outputs, evidence, and handoffs must remain distinct.
5. If [PROJECT_STATUS.md](./PROJECT_STATUS.md) or [AGENT_COMMUNICATION.log](./AGENT_COMMUNICATION.log) does not exist, `Main` must create it before claiming the first non-trivial review task is complete.
6. Review is the default operating mode. Agents must not start implementation, migration, deployment, or cleanup work unless the user explicitly requests that next step.
7. When review identifies a likely fix, agents should package it as a finding, plan, checklist, or prompt instead of editing product code by default.
8. `git commit` and `git push` remain opt-in and must not happen unless the user explicitly requests them after a real Git assessment.
9. Review conclusions must be based on inspected repository evidence, not assumptions carried over from earlier sessions.

### Delegation Language For Antigravity During Review

1. If the user says `yêu cầu Antigravity review`, `nhờ Antigravity review`, or equivalent, `Codex` must prepare a review handoff prompt for `Antigravity`.
2. If the user says `yêu cầu Antigravity sửa`, `nhờ Antigravity sửa`, or equivalent, `Codex` must treat that as a request to transition from review into an implementation handoff prompt.
3. That phrasing does not authorize `Codex` to perform implementation directly unless the user explicitly asks `Codex` to code.
4. Any Antigravity handoff prompt produced from the review must include the objective, confirmed findings, scope in/out, impacted files or modules, constraints, validation requirements, and expected evidence.

### Runtime Guardrails During Review

1. Prefer repository docs, code, manifests, Git history, and local configuration as the first-line evidence source.
2. Use runtime, browser, or database verification only when the review question actually requires operational evidence.
3. Agents must not shut down the active Docker runtime as part of normal review work. Commands equivalent to `docker compose down`, `docker stop`, or stack shutdown actions require explicit user approval.
4. If a required internal review path is unavailable, the agent must report that blocker and its residual risk instead of silently substituting a weaker evidence source.

---

## 4. Required Artifacts And Paths

Agents must use these artifact paths unless the user explicitly approves a different location:
- Product baseline: [PRD.md](./PRD.md)
- Repository overview: [README.md](./README.md)
- Project status tracker: [PROJECT_STATUS.md](./PROJECT_STATUS.md)
- Inter-agent log: [AGENT_COMMUNICATION.log](./AGENT_COMMUNICATION.log)
- Design root: [design](./design)
- Database contract: [design/database/schema.md](./design/database/schema.md)
- Flow specifications: [design/flows](./design/flows)
- Screen specifications: [design/screens.md](./design/screens.md)
- Change requests: [design/change-requests](./design/change-requests)
- Review artifact root: `/Users/kiendinhtrung/Desktop/econnect doc`
- Review analysis notes: `/Users/kiendinhtrung/Desktop/econnect doc/analysis`
- Review diagrams: `/Users/kiendinhtrung/Desktop/econnect doc/diagrams`
- Review Git reports: `/Users/kiendinhtrung/Desktop/econnect doc/git`
- Review prompt packs: `/Users/kiendinhtrung/Desktop/econnect doc/prompts`

Artifact rules:
1. If a task produces review documents, store them under the review artifact root and report the saved path.
2. If a task changes the understanding of architecture, flow, or release risk, record that delta in the review output even if no repository file is modified.
3. Do not rewrite the PRD or design baseline during review unless the user explicitly asks for that change.
4. Do not create parallel undocumented artifact locations when the review root above is available.
5. Do not claim a phase is complete if the requested review outputs are missing, stale, or saved in the wrong place.

---

## 5. Role And Responsibility Matrix

| Role | Core responsibility | Required outputs |
|---|---|---|
| `Main` | Coordinate phases, approvals, status, logging, and final reporting | Gate summary, status updates, communication log entries, final review report |
| `Planner` | Translate the user request into a bounded review slice and evidence plan | Review Task Packet, scope boundaries, source map, risks, pass criteria |
| `Project Analyst` | Inspect repository structure, architecture, docs, and flow boundaries | Repo summary, module map, findings, diagrams when needed |
| `Git Analyst` | Inspect branch state, working tree, history, diff, remote, and publish readiness | Git assessment, commit quality review, push readiness report |
| `Prompt Engineer` | Convert confirmed findings into reusable prompts, checklists, and handoff briefs | Prompt packs, review checklists, Antigravity handoff prompts when requested |

Supporting specialists such as UI, UX, database, security, or release agents may assist, but they do not replace the mandatory responsibilities of `Planner`, `Project Analyst`, `Git Analyst`, or `Prompt Engineer`.

---

## 6. Phase 1: Repository Intake

### Objective

Convert the user request into a concrete review slice that is traceable to real repository sources and clear enough to analyze without guesswork.

### Workflow

1. `Main` captures the task request and identifies whether the user needs project review, architecture review, Git review, release readiness review, prompt generation, or a combined deliverable.
2. `Planner` reads the relevant [AGENTS.md](./AGENTS.md), [PRD.md](./PRD.md), [README.md](./README.md), manifests, workflow configs, and design artifacts tied to the request.
3. `Planner` produces a **Review Task Packet** containing:
   - Task ID and objective
   - Review scope in / out
   - Required source files and directories
   - Expected artifact outputs and their save location
   - Assumptions, risks, and blockers
   - Verification plan for Git, docs, runtime, browser, or database evidence when needed
   - Gate expectation and pass criteria
4. `Main` records the active task and current phase in [PROJECT_STATUS.md](./PROJECT_STATUS.md).
5. If the task requires saved analysis or diagram files, `Main` ensures the appropriate subfolder exists under `/Users/kiendinhtrung/Desktop/econnect doc` before claiming completion.

### Checkpoint

1. The direct user request counts as Repository Intake entry approval.
2. Repository Intake exit approval is mandatory when the review expands into implementation, a baseline rewrite of PRD/design docs, or a workflow change that affects the repository process itself.
3. For an in-scope review task with no baseline rewrite, `Main` may treat the original request as Intake approval, but this must be stated explicitly in the final report.

---

## 7. Phase 2: Evidence Collection

### Objective

Gather verifiable evidence from the repository, Git state, and runtime dependencies required to support the review conclusions.

### Workflow

1. `Project Analyst` maps the relevant modules, entry points, dependencies, and documentation coverage for the requested review scope.
2. `Git Analyst` checks `git status`, active branch, recent commits, diff state, remotes, upstream status, and any scope-relevant untracked or generated files.
3. `Project Analyst` inspects technology manifests, deployment files, and CI/CD configuration relevant to the task.
4. Use `chrome-devtools`, `mariadb_nas`, or `stitch` only when the review question requires browser, database, or visual evidence. Do not guess behavior that can be inspected directly.
5. Record contradictions between code, PRD, README, design docs, and Git history.
6. Save analysis notes, comparison tables, or diagrams under `/Users/kiendinhtrung/Desktop/econnect doc` when the task calls for persistent artifacts or when those artifacts materially improve the handoff.

### Checkpoint

1. Evidence Collection exits only when the sources needed for conclusions have been inspected or the missing evidence has been reported as a blocker.
2. If required evidence cannot be collected, the report must state the blocker, substitute evidence if any, and the residual risk before moving to the next phase.

---

## 8. Phase 3: Review Analysis

### Objective

Turn raw evidence into prioritized findings, Git conclusions, and next-step options that the user or another agent can act on immediately.

### Workflow

1. `Planner` and `Project Analyst` classify findings into strengths, weaknesses, documentation gaps, technical blockers, and low-risk next actions.
2. `Git Analyst` evaluates commit clarity, atomicity, reviewability, regression risk, and push readiness when the task touches Git workflow.
3. `Prompt Engineer` drafts task-specific prompts for implementation, refactor, debug, testing, documentation, or release review using only confirmed repository context.
4. For complex flows, service boundaries, or lifecycle paths, create diagrams and save them under `/Users/kiendinhtrung/Desktop/econnect doc/diagrams`.
5. Distinguish explicitly between:
   - confirmed fact
   - evidence-based inference
   - unknown requiring follow-up

### Checkpoint

1. User approval is required before converting review findings into code changes, baseline rewrites, or implementation handoffs.
2. If the review finds a material conflict between product baseline and repository behavior, surface that conflict explicitly and stop for direction before normalizing it.

---

## 9. Phase 4: Reporting And Handoff

### Objective

Deliver a reusable review package with conclusions, evidence, risks, and prompts without inventing implementation details.

### Workflow

1. `Main` assembles the final task report with project summary, findings, Git assessment, prompt output, checklist report, and residual risk.
2. `Prompt Engineer` packages reusable prompts, checklists, or Antigravity handoff prompts when requested.
3. If files were generated, `Main` reports their exact absolute paths under `/Users/kiendinhtrung/Desktop/econnect doc`.
4. `Main` updates [PROJECT_STATUS.md](./PROJECT_STATUS.md) when the task changes phase or reaches completion.
5. All inter-role handoffs required by this file must be logged in [AGENT_COMMUNICATION.log](./AGENT_COMMUNICATION.log).

### Checkpoint

1. Reporting exits only when evidence, findings, residual risk, and next-step guidance are recorded.
2. The user or delegated reviewer decides whether the next action stays in review mode, opens an implementation slice, or requests Git operations.

---

## 10. User Approval Gates

| Gate | Phase transition | Required evidence | Approval rule |
|---|---|---|---|
| `G0` | Task intake -> Repository Intake | User request or approved deviation | User |
| `G1` | Repository Intake -> Evidence Collection | Review Task Packet with scope, source list, and output path plan | User if scope expands or baseline docs/workflow will be rewritten; otherwise original request may count |
| `G2` | Evidence Collection -> Review Analysis | Evidence inventory complete or blocker documented | `Main` |
| `G3` | Review Analysis -> Reporting And Handoff | Findings ranked, Git assessment drafted when applicable, prompt outputs prepared | `Main` |
| `G4` | Reporting And Handoff -> Done | Final review report, checklist report, and saved artifact paths when applicable | User or delegated reviewer |

Agents must not pass a gate without the required evidence for that gate.

---

## 11. Project Status Tracking

`Main` must maintain [PROJECT_STATUS.md](./PROJECT_STATUS.md).

Update rules:
1. update it when entering a new phase
2. update it when a gate passes or fails
3. update it when a blocker or deviation appears
4. update it when the final task result is reported

Required format:

```md
# Project Status

## Current Phase: [Repository Intake|Evidence Collection|Review Analysis|Reporting And Handoff|Complete]

## Active Task
- Task ID:
- Objective:
- Owner:
- Started At:

## Review Scope
- In:
- Out:

## Gate Status
- [ ] G0 Task intake
- [ ] G1 Intake approved
- [ ] G2 Evidence collected
- [ ] G3 Analysis complete
- [ ] G4 Review reported

## Deliverables
- Sources reviewed:
- Analysis notes:
- Diagrams:
- Git assessment:
- Prompt output:

## Risks / Blockers
- None

## Next Action
- 

## Last Updated
[YYYY-MM-DD HH:MM:SS]
```

---

## 12. Agent Communication Logging

All inter-agent coordination must be logged in [AGENT_COMMUNICATION.log](./AGENT_COMMUNICATION.log).

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

1. `Main` assigns work to `Planner`, `Project Analyst`, `Git Analyst`, or `Prompt Engineer`
2. `Planner` hands the approved review scope or evidence plan to another role
3. `Project Analyst` or `Git Analyst` returns a blocker, finding set, or assessment to `Main`
4. `Prompt Engineer` hands a prompt pack or Antigravity brief to `Main` or `Antigravity`
5. any role requests clarification or missing evidence from another role
6. blocker escalation or phase-change handoff
7. a logical handoff between roles, even when one session performs both roles
8. notice that an MCP dependency is unavailable and affects review verification

### Must Not Be Logged

1. direct agent conversation with the user
2. internal reasoning within a single role
3. routine file reads and writes
4. repetitive tool noise with no handoff or decision value

### Append Command

```bash
echo "[$(date '+%Y-%m-%d %H:%M:%S')] SENDER -> RECEIVER | REQUEST_BRIEF" >> ./AGENT_COMMUNICATION.log
```

---

## 13. Git Review And GitHub Publish Policy

### 13.1 Review-First Rule

1. During the project review baseline, the default output is assessment, not mutation.
2. Do not stage, commit, or push unless the user explicitly asks after a live Git assessment.
3. When asked to analyze commit quality, inspect the branch, working tree, recent commits, file scope, and validation evidence.
4. When asked to analyze push readiness, inspect remote configuration, upstream status, ahead/behind state, dirty files, and unwanted artifacts or secrets.
5. If the repository is not a Git repository, state that clearly and switch to static review mode.

### 13.2 Commit Assessment Questions

When reviewing a commit, answer these questions explicitly:
1. Does the commit solve exactly one objective or mix multiple objectives?
2. Does the commit message describe the actual diff?
3. Does the diff include files outside the stated scope?
4. Are tests, docs, or migrations missing for the changed behavior?
5. Would the commit be easy to review, revert, or cherry-pick?
6. What regression risk remains?

### 13.3 Push Readiness Rules

1. Do not recommend immediate push if the working tree is dirty outside the approved scope.
2. Do not recommend immediate push if minimal validation has not run for the reviewed change.
3. Do not recommend immediate push if the commit message misstates the actual change.
4. Do not recommend immediate push if the target branch, remote, or upstream state is unclear.
5. Do not recommend immediate push if secrets, generated artifacts, or large unintended files may be included.
6. Before any user-authorized push, report:
   - branch to be pushed
   - remote to receive the push
   - upstream or ahead/behind state
   - commit(s) expected to move
   - remaining residual risk

### 13.4 Commit Message Format

If the user later requests commit preparation or execution, agents must prefer the `github-commit-workflow` skill when it is available.
1. The default commit message format is Conventional Commits:
   - `<type>(<scope optional>): <short summary>`
2. Use one objective per commit and make the summary match the diff exactly.
3. Preferred default types are:
   - `feat`
   - `fix`
   - `docs`
   - `chore`
   - `ci`
   - `refactor`
   - `test`
   - `build`
   - `perf`
4. A scope is optional, but when present it should name the main area changed, such as `server`, `webapp`, `mqtt`, `docs`, or `release`.
5. The legacy bracketed form such as `[update] ...` is historical only and must not be required when the user explicitly asks for Conventional Commits or the GitHub commit workflow.

---

## 14. MCP Usage Policy

The following MCP capabilities are available and must be used in the correct context:
- `chrome-devtools`
- `mariadb_nas`
- `stitch`

### 14.1 `chrome-devtools`

Use `chrome-devtools` for:
- UI review
- rendering or responsive issues
- navigation and page-flow validation
- frontend auth/session behavior
- dashboard builder interactions
- SVG pin-mapping flows
- serial monitor UI checks
- console and network inspection

Minimum required actions when browser evidence is needed:
1. reproduce the flow in a browser
2. inspect console messages
3. inspect relevant network requests
4. record at least one happy path and one failure or edge path when the review scope depends on runtime behavior

Agents must not claim that the UI works based only on static code inspection when browser evidence is required.

### 14.2 `mariadb_nas`

Use `mariadb_nas` whenever the review affects:
- create, update, delete, migration, import, restore, or synchronization flows
- auth, roles, sessions, households, or memberships
- dashboard persistence
- device registry, identity, authorization, or capability mapping
- automation definitions or execution logs
- telemetry, reporting, or export query behavior

Minimum required actions when database evidence is needed:
1. inspect the relevant schema or table shape
2. query the current state tied to the review question
3. confirm before/after expectations if a change is being evaluated
4. verify enums, nullability, foreign keys, or timestamps when they matter to the finding

Agents must not guess table names, column names, or relationships without checking the actual database.

### 14.3 `stitch`

Use `stitch` for:
- reviewing a screen against an approved design reference
- aligning UI analysis with the established visual language
- checking spacing, hierarchy, or interaction intent when a Stitch reference exists

Minimum required actions:
1. inspect the relevant Stitch reference when available
2. map design intent to the current UI before concluding a mismatch
3. avoid inventing a parallel visual language when the review should compare against an approved one

### 14.4 MCP Unavailability

If an MCP capability is unavailable, the agent must explicitly state:
1. which MCP was unavailable
2. which review step could not be completed
3. what substitute evidence was gathered
4. what residual risk remains because of the missing verification

---

## 15. Reporting, Checklist, And Definition Of Done

Every completed review task report must follow this reasoning chain:
1. `Claim`: what is now believed to be true or false
2. `Evidence`: repo file, Git output, browser trace, database query, or diagram
3. `Reasoning`: why the evidence supports the conclusion
4. `Counter-check`: a contradictory path, exception, or unverified edge case
5. `Residual risk`: what remains unknown or unverified

### Mandatory Checklist Report

Every completed review task report must include a **Checklist Report** that:
1. lists concrete review actions completed, not vague summaries
2. identifies what was verified and by which evidence source
3. marks skipped or non-applicable work explicitly
4. marks unfinished follow-up work explicitly
5. is clear enough that a user or another AI agent can continue without reconstructing the whole session

Checklist items must use explicit status markers such as `[x]`, `[ ]`, or `[-]`.

### Definition Of Done

A review task is only considered done when all applicable conditions are true:
1. the relevant repository sources were reviewed before conclusions were stated
2. the affected modules, flows, or Git surfaces were identified clearly
3. major findings and risks were prioritized
4. Git state was assessed when the task touched commits, branches, or push readiness
5. the output distinguishes confirmed facts from assumptions or unknowns
6. generated analysis files and diagrams were saved under `/Users/kiendinhtrung/Desktop/econnect doc` when the task required persistent artifacts
7. the final task report includes a checklist report and gate decision
8. if the user requested prompts, those prompts include `Role`, `Objective`, `Project Context`, `Constraints`, `Steps`, and `Expected Output`

### Required Task Report Format

```md
Task ID:
Objective:
Review Scope:
Sources Reviewed:

Project Summary:

Findings:

Git Assessment:

Prompt Output:

Artifacts Saved:

Checklist Report:
- [x] Reviewed ...
- [x] Analyzed ...
- [x] Assessed ...
- [x] Reported ...
- [-] Not applicable: ...
- [ ] Pending follow-up: ...

Sub-agent Outputs:
- Main:
- Planner:
- Project Analyst:
- Git Analyst:
- Prompt Engineer:

Residual Risk:
Gate Decision: PASS / FAIL
```

---

## 16. Working Principles And Exception Handling

Working principles:
1. read first, conclude second
2. use evidence over assumption
3. do not implement product code during review unless the user explicitly requests implementation
4. do not skip `AGENTS.md`, `README`, `PRD`, manifests, or CI/CD config when they exist and are relevant
5. prefer the smallest review slice that can still support a confident conclusion
6. keep generated analysis and diagrams outside the repository under `/Users/kiendinhtrung/Desktop/econnect doc`
7. do not rewrite baseline docs without explicit user approval
8. do not infer Git state without live inspection
9. keep unrelated dirty files untouched
10. when evidence is missing, state the assumption and confidence level clearly

Exception and deviation handling:
1. If a request exceeds review scope and becomes implementation work, `Main` must record that transition before proceeding.
2. If the user requests a process deviation, `Main` must record:
   - requested deviation
   - why the normal flow is being bypassed
   - which verification steps are reduced or skipped
   - residual risk introduced by that decision
3. If an environment dependency blocks review verification, the report must state the exact blocker, affected scope, substitute evidence, and residual risk.
4. If unexpected repository changes conflict with the active task, stop and ask for direction instead of silently overwriting them.
5. If the user explicitly asks for multiple commits, history rewriting, or destructive Git actions, `Main` must treat that as a workflow deviation and record it before proceeding.

---

## 17. End-To-End Example Workflow

1. The user requests: "review repo này và viết prompt để chuẩn bị release".
2. `Main` logs the task in [PROJECT_STATUS.md](./PROJECT_STATUS.md) and records the first role assignment in [AGENT_COMMUNICATION.log](./AGENT_COMMUNICATION.log).
3. `Planner` checks [AGENTS.md](./AGENTS.md), [PRD.md](./PRD.md), [README.md](./README.md), manifests, workflows, and design docs, then creates the Review Task Packet.
4. `Project Analyst` inspects repo structure, identifies key modules such as `server`, `webapp`, and any relevant linked service repositories such as `find_website`, then saves an architecture diagram under `/Users/kiendinhtrung/Desktop/econnect doc/diagrams` if it materially helps the handoff.
5. `Git Analyst` checks branch state, `git status`, recent commits, diff state, remotes, and upstream readiness, then records commit or push risks with evidence.
6. `Prompt Engineer` writes prompt packs for release review, changelog drafting, regression checks, or Antigravity implementation handoff based on confirmed findings.
7. `Main` delivers the final review package with project summary, findings, Git assessment, prompt output, checklist report, residual risk, and the saved artifact paths.
8. If the user later says `yêu cầu Antigravity sửa`, `Prompt Engineer` converts the confirmed review findings into a coder handoff prompt and the review slice ends there unless the user opens a new implementation task.
