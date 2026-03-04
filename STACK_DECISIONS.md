# STACK_DECISIONS.md

## Purpose

This document records the preferred technical direction for the E-Connect project so agents can implement features with consistent decisions.

If the repository later adopts concrete libraries that differ from this file, the codebase wins over this draft. Until then, this document is the implementation default.

## Decision Summary

| Area | Preferred Choice | Why |
|---|---|---|
| Web framework | Next.js App Router | Strong fit for full-stack web product with server and client boundaries |
| Language | TypeScript | Shared types across UI, server, and domain logic |
| Styling | Tailwind CSS | Fast iteration and consistent component styling |
| Animation | Framer Motion | Useful for dashboard and builder interactions when applied carefully |
| Database access | Repo-native ORM/query layer | Keep one persistence path and inspect via MCP before assumptions |
| Validation | Schema-first validation | Prevent invalid device configs, forms, and API payloads |
| Charts | Reuse one charting solution only | Avoid fragmented chart UI and inconsistent telemetry views |
| Realtime transport | MQTT-first abstraction | Best fit for local-first smart home messaging |
| Device config format | JSON | Portable for board config, widget config, backup, and provisioning |
| Local artifacts | Filesystem-backed storage | Good fit for exports, logs, generated firmware metadata, and backups |

## Rules

- Do not introduce a second UI framework without a strong reason.
- Do not introduce multiple state libraries for similar use cases.
- Prefer server-centric data loading for initial features unless interactivity requires client state.
- Use TypeScript types at boundaries, but validate untrusted input with runtime schemas.
- Prefer one source of truth per domain object:
  - dashboard config in persisted layout records
  - device identity in the device registry
  - pin assignments in persisted DIY project config
  - automation definition in durable storage

## Frontend Defaults

Use these defaults unless the codebase already defines another pattern:

| Concern | Default |
|---|---|
| Routing | Next.js App Router |
| Data loading | Server components first, client components only when needed |
| Forms | Controlled by existing repo pattern; validate at boundary |
| Async UX | Explicit loading, success, and error states |
| Component structure | Feature-oriented with shared primitives |
| Responsive behavior | Desktop first, but mobile web must remain usable |

## Backend Defaults

| Concern | Default |
|---|---|
| API style | Feature-oriented route handlers or server actions |
| Validation | Runtime validation at all external input boundaries |
| Errors | Structured errors that UI can render |
| Long-running jobs | Persist status for build, flash, OTA, export, and automation runs |
| Logging | Log lifecycle transitions and failure points |

## Data and Storage Defaults

| Concern | Default |
|---|---|
| Device identity | UUID-backed persisted record |
| Dashboard layout | JSON-backed persisted layout |
| Build artifacts | Filesystem-backed metadata plus durable job records |
| Automation logs | Durable execution records |
| Exports | Generated on demand with traceable metadata |

## MQTT and Device Defaults

- MQTT should be treated as a transport, not the domain model.
- Device capability mapping must remain transport-agnostic.
- Device discovery, authorization, and online state must be explicit persisted concepts.
- Flash, OTA, and serial flows must coordinate to avoid port conflicts.

## Design Defaults

- Use Stitch when design references exist.
- Preserve the same visual language across dashboard, builder, device onboarding, and reporting.
- Do not add decorative motion that obscures state transitions.
- SVG board interaction must use real SVG elements, not static images.

## When To Revisit These Decisions

Revisit this document if:
- the repository adopts a concrete ORM, charting library, or component system
- the product requires native mobile parity sooner than expected
- Zigbee or other protocol support demands a different runtime boundary
- firmware build complexity justifies a dedicated worker process

