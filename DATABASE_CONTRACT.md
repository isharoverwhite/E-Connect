# DATABASE_CONTRACT.md

## Purpose

This document defines how agents must think about persistence in the E-Connect project.

It is not a literal schema. It is a contract for safe implementation and verification. Agents must inspect the real database through MCP before coding against assumptions.

## Core Rule

If a task touches persisted data, the agent must inspect the database before and after the change.

This includes:
- create
- update
- delete
- import
- restore
- migration
- onboarding
- authorization
- dashboard persistence
- automation execution records
- reporting queries

## Persistence Areas

| Area | Typical Records | Why It Exists |
|---|---|---|
| Auth | users, households, memberships, roles, sessions | access control and identity |
| Devices | devices, capabilities, status, authorization | registry of manageable devices |
| DIY | projects, board profiles, pin assignments, build jobs, flash jobs | no-code device lifecycle |
| Dashboard | dashboards, layouts, widgets, bindings | control and monitoring UI |
| Automation | automations, runs, logs, triggers | rule execution and auditability |
| Reporting | telemetry, aggregates, exports | charts, history, and downloadable data |
| System | files, audit logs, extension configs, protocol connections | operational support data |

## Required Verification By Task Type

### Auth or Role Changes

Must verify:
- user record shape
- role or membership state
- session impact if applicable
- authorization edge case for a lower-privilege user

### Dashboard Changes

Must verify:
- dashboard existence
- layout persistence
- widget records
- widget binding correctness
- no orphaned widget bindings after change

### Device Changes

Must verify:
- device identity and UUID state
- authorization status
- capability records
- online/offline or heartbeat state if involved

### DIY Builder Changes

Must verify:
- project or draft config
- pin assignment persistence
- build or flash job records
- artifact metadata if generated

### Automation Changes

Must verify:
- automation definition shape
- enabled or disabled state
- execution log or run status
- side-effect traceability where applicable

### Reporting Changes

Must verify:
- telemetry source rows exist
- aggregation scope matches expected time range
- export query result shape is correct

## Database Safety Rules

- Never assume table or collection names without checking.
- Never assume foreign key behavior without checking.
- Never assume timestamp semantics without checking.
- Never assume enum values without checking.
- Never delete or overwrite records casually in debugging.
- Prefer additive investigation first: inspect, compare, then patch.

## Query Discipline

When investigating a bug or implementing a feature, agents should answer:

1. What record is the UI expecting?
2. Which persistence path creates or mutates that record?
3. Does existing data violate the new assumption?
4. What record shape proves the feature now works?

## Evidence Standard

A persistence-related task is not complete until the agent can state:
- which records were inspected
- what changed
- what the final stored state shows

## Common Failure Modes

- widget exists but is not bound to a capability
- authorized device exists but capability sync never ran
- automation marked enabled but has no runnable trigger config
- DIY project saved but board pin assignments are incomplete
- export endpoint returns headers but source telemetry query is empty
- UI shows stale state because reads hit a different record shape than writes

