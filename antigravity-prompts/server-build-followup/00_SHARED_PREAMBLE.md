# Shared Preamble For Antigravity

Use this preamble before every mini-task in this folder.

```text
You are working in the E-Connect repository at:
/Users/kiendinhtrung/Documents/GitHub/Final-Project

Primary source of truth:
1. /Users/kiendinhtrung/Documents/GitHub/Final-Project/AGENTS.md
2. /Users/kiendinhtrung/Documents/GitHub/Final-Project/PRD.md
3. The current codebase

Mandatory rules:
1. Follow the mandatory Planner -> Coder -> Tester model from AGENTS.md.
2. Read the relevant code path before editing any file.
3. Do not expand scope beyond the current mini-task.
4. Prefer the smallest correct change set. Do not leave placeholder logic in flows you claim are complete.
5. No evidence, no completion.
6. If the codebase conflicts with the PRD, surface the conflict explicitly in the final report.
7. If a required MCP step is unavailable or contradictory, say so explicitly and do not claim PASS.

Required verification behavior:
1. For UI-affecting work, use chrome-devtools to verify:
   - happy path
   - at least one failure or counter-check path
   - console messages
   - relevant network requests
2. For persistence-affecting work, use mariadb_nas for before/after checks.
3. If mariadb_nas disagrees with the live runtime state, report the mismatch with concrete evidence and use substitute evidence only if you clearly state the residual risk.
4. Return the final report in the exact AGENTS.md format.

Current execution context from the previous task report:
- Task ID: BE-WP07-WIFI-001
- Objective: Implement Wi-Fi SSID and Password fields in the DIY Builder WebUI and use them in backend C++ generation.
- Reported changed files:
  - webapp/src/app/devices/diy/page.tsx
  - webapp/src/features/diy/components/Step1Board.tsx
  - server/app/services/builder.py
- Reported result:
  - Browser flow passed
  - Wi-Fi credentials were entered and a successful build was reported
  - MariaDB verification disagreed with the runtime build job evidence
  - Gate Decision was FAIL because the mariadb_nas evidence did not match the live runtime behavior

What this means for the next prompts:
1. The first follow-up task must close the exact FAIL condition from BE-WP07-WIFI-001 before broader server-build work is claimed complete.
2. Later tasks must preserve the Wi-Fi fields and backend Wi-Fi code generation behavior.
3. Do not remove, bypass, or silently regress the Wi-Fi provisioning implementation while fixing DB, retry-safety, auth handling, or build metadata.

Treat that previous report as context, not proof. Re-verify any claim you rely on.
```
