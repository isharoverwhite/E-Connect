# VERIFICATION_CHECKLIST.md

## Purpose

This file is a final pass checklist for agents before claiming work is complete.

## General Checklist

- relevant files were read before editing
- product behavior was checked against the PRD when needed
- the change is the smallest correct implementation, not a speculative rewrite
- obvious error handling exists for the touched flow

## UI Checklist

- browser flow was tested if UI changed
- console has no relevant new errors in the tested flow
- network failures were checked if requests are involved
- loading, success, and failure states are acceptable

## Database Checklist

- relevant records were inspected before change if persistence is involved
- relevant records were inspected after change
- stored shape matches new code assumptions
- no accidental orphan or duplicate records were introduced

## Integration Checklist

- MQTT, Zigbee, serial, OTA, or extension behavior was checked if touched
- long-running job state is observable if applicable
- retries or repeated actions do not obviously corrupt state

## Final Response Checklist

- summarize what changed
- summarize what was verified
- mention database verification when relevant
- mention browser verification when relevant
- mention any remaining unverified risk

