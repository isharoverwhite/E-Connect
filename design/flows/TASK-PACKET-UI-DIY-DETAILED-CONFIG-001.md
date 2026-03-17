# Task Packet: UI-DIY-DETAILED-CONFIG-001

## 1. Objective
Expand the DIY device onboarding flow to allow detailed board technical configuration (CPU MHz, Flash size, PSRAM) in Step 1, and ensure these settings are persisted and used in the server build process.

Critical behavior constraint:
- If the user does not explicitly change any flash-related setting, the build must keep the board's default PlatformIO behavior. Flash settings must be treated as optional overrides, not mandatory replacements of the existing PlatformIO defaults.

## 2. FR/NFR Mapping
- **FR-14:** DIY Board Selection
- **FR-15:** DIY Pin Configuration
- **FR-16:** DIY Server-side Build
- **NFR-01:** High Performance (Optimized build flags)
- **NFR-08:** Maintainability (Traceable technical configs)

## 3. Scope In / Scope Out
### Scope In:
- Adding technical metadata to board profiles (chip label, serial bridge, layout label, GPIO count).
- Adding 'Detailed Board Config' section to DIY Step 1 UI (Step 1).
- Persistence of `cpu_mhz`, `flash_size`, `psram_size` in project JSON config.
- Updating PlatformIO build logic to use these technical parameters.
- Preserving default PlatformIO flash behavior when flash-related settings are untouched.
- Ensuring backward compatibility for existing projects (fallback to defaults).
- Technical board summary display in Step 1.

### Scope Out:
- Redesigning the entire DIY wizard.
- Adding complex partition table selection (using standard based on flash size).
- Hardware verification of all 200+ MHz combinations.

## 4. Impacted Files
- `webapp/src/features/diy/board-profiles.ts`: Interface and profile data update.
- `webapp/src/app/devices/diy/page.tsx`: State management and persistence logic.
- `webapp/src/features/diy/components/Step1Board.tsx`: UI implementation for detailed config.
- `server/app/api.py`: API payload handling.
- `server/app/services/builder.py`: PlatformIO ini generation update.
- `server/tests/test_diy_api.py`: Test cases for new fields.

## 5. Assumptions, Risks, and Blockers
- **Assumption:** JSON configuration column in the database is flexible enough for new fields.
- **Assumption:** The current generated `platformio.ini` is the source of truth for default board flash behavior unless the user explicitly overrides it.
- **Risk:** Invalid frequency settings might fail the build; UI must use safe select options.
- **Risk:** If UI always writes flash values as hard overrides, unchanged configs may accidentally diverge from PlatformIO defaults.
- **Blocker:** None.

## 6. Verification Plan
### Code Validation:
- Unit test update in `test_diy_api.py` to verify persistence of new fields.
### Browser Checks (chrome-devtools):
- Select board -> technical info appears.
- Change MHz/Flash -> values update in state.
- Save Draft -> verify payload in Network tab contains new fields.
- Load existing project -> verify fields are restored correctly.
- Leave flash settings untouched -> verify resulting build path still follows default PlatformIO behavior rather than a forced flash override path.
### Database Checks (mariadb_nas):
- Verify `diy_projects.config` contains `cpu_mhz`, `flash_size`, etc., after save.
### Failure Path:
- Manually inject invalid `cpu_mhz` in payload via devtools -> verify backend/builder handles it gracefully or defaults it.

## 7. Gate Expectation & Pass Criteria
- **G1 (Requirement):** Approved by intake.
- **G2 (Design):** Approval sought via this Task Packet.
- **Pass Criteria:** All 'Scope In' items implemented and verified via browser and DB evidence, including proof that untouched flash settings preserve default PlatformIO behavior.
