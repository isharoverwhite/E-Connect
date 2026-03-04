# UI_IMPLEMENTATION_GUIDE.md

## Purpose

This document tells agents how to implement and verify frontend work for E-Connect.

The objective is not just to produce attractive screens. The UI must reflect real product behavior, real persisted state, and real device capability boundaries.

## Core Principles

| Principle | Meaning |
|---|---|
| Product-first | UI decisions must support the PRD, not generic templates |
| Real state | Avoid fake controls disconnected from actual persistence or transport |
| Clear feedback | Loading, success, and failure states must be explicit |
| Testable interactions | Important flows must be reproducible in browser debugging |
| Consistent language | Stitch designs and established repo patterns should guide implementation |

## When To Use Stitch

Use Stitch when:
- a screen or component has a design reference
- spacing, hierarchy, or interaction details are unclear
- a new major flow is being introduced

Do not improvise a parallel visual language when Stitch already defines the direction.

## Required Browser Verification

For any UI-affecting task, verify:
- page renders without console errors
- intended interaction works
- one obvious failure state behaves correctly
- the network request path matches expectation if applicable
- persisted state survives a refresh when persistence is relevant

## Required States

Agents must implement these states when relevant:
- loading
- empty
- success
- validation error
- server error
- disabled or unavailable state

## Flow-Specific Guidance

### Dashboard Builder

Must support:
- visible drag/drop or placement logic
- persisted layout changes
- clear widget selection and configuration state
- binding widgets to real data or device capabilities

Must avoid:
- fake widgets that do not map to real bindings
- silent failure on save

### Device Onboarding

Must support:
- clear discovery state
- clear authorization action
- online/offline visibility
- capability visibility after approval

Must avoid:
- implicit trust of newly discovered devices
- hidden provisioning states

### DIY SVG Pin Mapping

Must support:
- real interactive SVG nodes
- selected, disabled, conflict, and hover states
- capability warnings before build
- persisted reload of selected pins

Must avoid:
- static `<img>` usage for interactive boards
- allowing invalid pin assignments through to flash

### Serial Terminal

Must support:
- connection state
- scrollable logs
- clear terminal action
- filter or search if present
- baud rate selection if the feature exists

Must avoid:
- ambiguous terminal disconnection state
- silently dropping errors

## UI Debug Discipline

When debugging UI:
- reproduce in browser first
- inspect console
- inspect network
- trace the state boundary
- confirm whether the issue is rendering, data loading, validation, persistence, or transport

## Accessibility Baseline

Agents should preserve a practical baseline:
- buttons and inputs have visible labels or accessible names
- status and errors are readable
- critical actions are not color-only
- keyboard interaction should work for ordinary form flows

## Responsive Baseline

Agents must keep these views usable:
- desktop dashboard usage
- tablet-width management flows where reasonable
- mobile-width read and simple control flows

## Evidence Standard

A UI task is not done until the agent can describe:
- what page or flow was tested
- what interaction was performed
- what visible outcome occurred
- whether console and network looked healthy

