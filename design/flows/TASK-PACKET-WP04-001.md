# Task Packet: WP04-PIN-CONFIG-PWM-I2C-001

## 1. Objective
Refine DIY pin configuration to support Output subtypes (On/Off vs PWM with 0-255 range) and hardware-correct I2C modeling (Bus-level SDA/SCL auto-pairing, hex addresses, server-driven Adafruit library catalog). Ensure the dashboard reflects these technical configurations with hardware-aware controls.

## 2. FR/NFR Mapping
- **FR-14:** No-code firmware generation flow for DIY
- **FR-15:** SVG interactive pin mapping
- **FR-18:** Auto widget provisioning from capability
- **FR-30:** Server builds firmware from WebUI config
- **NFR-07:** Usability (Hardware-aware controls)
- **NFR-08:** Maintainability (Server-driven library catalog)

## 3. Scope In / Scope Out
### Scope In:
- DIY Step 2 UI: Subtype selection for Output (On/Off, PWM).
- DIY Step 2 UI: I2C bus configuration (Auto-pairing SDA/SCL, explicit roles).
- Backend: Update models/validation for PWM range (0-255) and I2C hex address.
- Backend: Server-side Adafruit I2C library registry and API.
- Dashboard: PWM slider with raw range display; I2C hardware-aware widgets.
- Build: Update PlatformIO and header generation to include new parameters.

### Scope Out:
- Dashboard builder redesign.
- Support for non-I2C third-party libraries.
- Physical hardware verification of all libraries.

## 4. Impacted Files
- `webapp/src/features/diy/types.ts`: `PinMapping` and `sanitizePins`.
- `webapp/src/features/diy/components/Step2Pins.tsx`: UI for subtype and I2C params.
- `webapp/src/app/page.tsx`: Hardware-aware `DynamicDeviceCard`.
- `server/app/models.py`: Pydantic models for new pin params.
- `server/app/api.py`: I2C library catalog endpoint and save/load logic.
- `server/app/services/builder.py`: Firmware config header generation.
- `server/app/services/diy_validation.py`: PWM and I2C validation rules.
- `server/tests/test_diy_api.py`: Test cases for new features.

## 5. Assumptions, Risks, and Blockers
- **Assumption:** Using `extra_params` JSON in DB is sufficient for persistence.
- **Risk:** Large number of I2C libraries might bloat the build; registry must be selective.
- **Blocker:** `mariadb_nas` policy vs SQLite runtime. Action: Use `sqlite3` tools for verification.

## 6. Verification Plan
### Code Validation:
- `pytest server/tests/test_diy_api.py` (updated with PWM/I2C cases).
### Browser Checks (chrome-devtools):
- Configure PWM (20-200) -> Save -> Verify payload.
- Dashboard -> Verify slider min=20, max=200.
- Configure I2C -> Auto-pairing of SDA/SCL -> Fetch library list -> Select "BME280" -> Verify metadata.
- Failure path: Set PWM max < min -> Verify validation error.
- Failure path: Invalid I2C address (e.g. 0xG1) -> Verify block.
### Database Checks (SQLite):
- Query `pin_configurations` or `diy_projects.config` to verify `extra_params` storage.

## 7. Gate Expectation & Pass Criteria
- **G1 (Requirement):** Approved by intake.
- **G2 (Design):** Approval sought via this Task Packet.
- **Pass Criteria:** UI reflects hardware-correct model; Dashboard renders range-aware controls; Server build consumes new params.
