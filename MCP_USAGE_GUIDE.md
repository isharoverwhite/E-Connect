# MCP_USAGE_GUIDE.md

## Purpose

This document tells agents when and how to use the available MCP capabilities in this project context.

Available MCP categories in this environment:
- database inspection
- website debugging
- Stitch design retrieval

## General Rule

Use MCP to reduce ambiguity. Do not guess when the tool can answer the question directly.

## Database MCP

Use for:
- schema inspection
- record verification
- onboarding state checks
- dashboard persistence checks
- automation and reporting validation

Expected behavior:
- inspect current state before persistence changes when relevant
- verify result after change
- include a brief evidence summary in the final response

## Website Debug MCP

Use for:
- reproducing UI bugs
- validating implemented flows
- checking console and network
- verifying drag-and-drop, SVG, auth, or dashboard behavior

Expected behavior:
- reproduce first when possible
- verify after fix
- check one success path and one failure path when practical

## Stitch MCP

Use for:
- implementing new screens
- aligning existing screens to design intent
- resolving spacing, hierarchy, or interaction ambiguity

Expected behavior:
- treat Stitch as design input, not merely inspiration
- preserve design consistency across related flows

## Final Evidence Rule

If MCP was relevant to the task, the final response should say which MCP-assisted checks were performed.

