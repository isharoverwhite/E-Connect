Use the repository docs below as the product and implementation source of truth before making changes:

- `/Users/kiendinhtrung/Documents/Playground/PRD.md`
- `/Users/kiendinhtrung/Documents/Playground/INITIAL_ARCHITECTURE.md`
- `/Users/kiendinhtrung/Documents/Playground/STACK_DECISIONS.md`
- `/Users/kiendinhtrung/Documents/Playground/DATABASE_CONTRACT.md`
- `/Users/kiendinhtrung/Documents/Playground/UI_IMPLEMENTATION_GUIDE.md`
- `/Users/kiendinhtrung/Documents/Playground/VERIFICATION_CHECKLIST.md`

Implement the remaining Phase 1 / MVP backend work and finish the webapp initial setup flow so the frontend and backend are fully wired together.

Important context:
- Phase 1 / MVP in this project covers the foundation: basic auth and household management, local-first storage/offline behavior, MQTT-first device foundation, device identity and authorization, and the minimum platform bootstrap needed to make the system usable.
- The initial setup UI has already been designed in Stitch for the webapp. Treat Stitch as the visual source of truth.
- There is MCP available in your environment. Use it aggressively where relevant instead of guessing.

Your task has 2 linked goals:

1. Backend Phase 1 completion
- Trace the current backend path end to end.
- Identify the missing Phase 1 backend pieces required to support a real first-run setup flow.
- Implement the smallest correct backend slice needed to make initial setup durable, safe, and production-shaped for MVP.
- Preserve local-first behavior and do not add cloud-only assumptions.

2. Webapp initial setup completion
- Retrieve the existing Stitch design for the initial setup flow and implement or finish the actual webapp screens to match it.
- Wire the UI to the real backend instead of mock or placeholder behavior.
- Make the webapp payloads, validation, loading states, errors, and success path fit the backend contract exactly.

Execution requirements:

- Read the product docs first.
- Read the relevant application code before editing.
- Use Stitch MCP to inspect the initial setup design.
- Use website debug MCP for browser validation because this task affects UI, form flow, network requests, and setup state transitions.
- Use database MCP if setup creates or updates persisted records such as users, households, memberships, roles, sessions, bootstrap state, or system settings.
- If the schema or existing route conventions are unclear, inspect them first. Do not invent table names or API contracts blindly.

Product intent to preserve:

- User management is household-based and role-aware.
- Local storage and offline mode are MVP features.
- Newly discovered devices require approval before becoming fully managed.
- Device identity and authorization must be durable.
- UI should reflect real persisted state, not fake client-only progress.
- Business rules should live in domain/backend code, not only in UI components.

Initial setup flow expectations:

- Detect whether the system is already initialized.
- If not initialized, show the initial setup flow from Stitch.
- Allow the first valid setup submission to create the required durable bootstrap state for MVP.
- Prevent unsafe re-initialization once setup is complete.
- Return machine-actionable error responses the UI can render clearly.
- Make the setup command idempotent enough to avoid duplicate bootstrap records on retries.
- Ensure refresh after success reflects persisted initialized state.

If the repository does not already have a strong contract, establish a minimal vertical-slice setup contract with repo-native naming conventions:

- a read path that tells the webapp whether initial setup is required
- a command path that submits the initial setup form and creates the durable bootstrap state
- optional validation or status endpoints only if the UI genuinely needs them

Backend expectations:

- Validate external input at the boundary with runtime validation.
- Keep setup state transitions explicit.
- Persist enough state for recovery and retry safety.
- Return structured errors that distinguish validation problems, conflict/already-initialized problems, and unexpected server failures.
- Follow existing repo architecture and naming if present instead of forcing a new pattern.

Frontend expectations:

- Match Stitch hierarchy and interaction intent.
- Implement loading, empty, validation error, server error, disabled, and success states where relevant.
- Do not leave fake buttons or fake progress indicators.
- Keep the flow usable on desktop and mobile widths.
- Keep console clean in the exercised path.
- Keep network requests aligned with the real backend contract.

Likely persistence areas to inspect and verify if they exist:

- users
- households
- memberships
- roles
- sessions
- system settings or bootstrap state
- protocol or local instance configuration records

Suggested implementation sequence:

1. Inspect the current code path for setup, auth, and bootstrap behavior.
2. Inspect the real database schema and current records for the setup-related entities.
3. Inspect the Stitch design for the initial setup flow.
4. Decide the smallest correct backend contract and state model.
5. Implement backend changes.
6. Implement or finish the webapp screens and form wiring.
7. Validate in browser using MCP:
   - happy path
   - one obvious failure path
   - network requests
   - console errors
8. Verify persisted records in the database after setup if persistence is touched.
9. Summarize the evidence clearly.

Acceptance criteria:

- An uninitialized instance shows the initial setup flow instead of a broken or placeholder state.
- A valid initial setup submission succeeds end to end.
- The backend persists the required Phase 1 bootstrap state.
- The UI reflects backend validation and server errors clearly.
- Reload after successful setup shows the correct initialized state.
- Re-running setup after initialization is blocked safely.
- API contract and webapp form integration are aligned and verified.
- Browser flow is checked with clean console and expected network behavior.
- Database state is inspected before and after when persistence is involved.

Out of scope unless already partially implemented and directly needed for this flow:

- Reporting and exports
- OTA
- Python extension system
- Zigbee expansion
- Advanced migration and restore
- Broad dashboard redesign unrelated to setup

Definition of done:

- Relevant code paths were read before edits.
- Product behavior stays aligned with the docs above.
- Initial setup UI is implemented against the real backend.
- Backend persistence and API behavior are verified, not assumed.
- Browser flow is verified with MCP.
- Database results are verified with MCP when data changes.
- Final handoff includes changed files, what was verified, whether browser behavior was checked, whether database state was checked, and any remaining risk.

Do not stop at identifying the likely fix. Implement it, verify it, and close the loop with concrete evidence.
