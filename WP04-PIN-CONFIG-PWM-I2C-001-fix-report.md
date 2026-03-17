Task ID: WP04-PIN-CONFIG-PWM-I2C-001-fix
Objective: Fix PWM off logic and tests
FR/NFR Mapping: FR-14, FR-15
Scope In/Out: In: Fixing main.cpp PWM logic for `value=0` and tests/fixtures for 0..255 limits. Out: Feature expansion, UI redesign.

Approval Checkpoints:
- Requirement: User Request (Implicit)
- Design: Design unchanged constraints met
- Final Acceptance: Pending

Checklist Report:
- [x] Reviewed current bug logic in `main.cpp`
- [x] Designed `value=0` -> 0 and `brightness` limit clamping fix
- [x] Changed `firmware/firmware/src/main.cpp` logic and `tests/test_diy_api.py` fixture limits
- [x] Verified python tests using `PYTHONPATH=server ./.venv/bin/pytest server/tests/test_diy_api.py -q`
- [x] Verified C++ compilation using `debug_build.py` script and `pio run` inside the generated directory
- [-] Not applicable: DB migration, React UI edits
- [-] Pending follow-up: None

Sub-agent Outputs:
- Main: Updated project status and logged handoffs.
- Planner: Confirmed no PRD/Design changes were needed and validated scope boundaries.
- Coder: Fixed PWM off condition to short circuit brightness constraint checking in C++ `main.cpp` (when value=0).
- Tester: Verified backend generator config outputs with tests and ran a native ESP32 PlatformIO cross-compile.

Changed Files:
- `firmware/firmware/src/main.cpp`
- `server/tests/test_diy_api.py`
- `PROJECT_STATUS.md`
- `AGENT_COMMUNICATION.log`

Verification:
- Lint/Typecheck: Skipped (Not run in this task)
- Backend tests: Passed (`PYTHONPATH=server ./.venv/bin/pytest server/tests/test_diy_api.py -q`)
- Browser flow (chrome-devtools): Skipped (Backend/firmware only fix)
- DB before/after (mariadb_nas): Skipped (No database modification)
- Design reference (Stitch): Skipped (No UI changes)
- Firmware Native Compile: Passed (`PYTHONPATH=server ./.venv/bin/python server/debug_build.py` then `BUILD_DIR=$(cat latest_build_dir.txt) && ./.venv/bin/pio run -d "$BUILD_DIR"`)

Defects Found: None
Residual Risk: Hardware E2E verification is pending. The logic fix compiles and passes unit tests, but physical hardware PWM output dimming at 0% was not observed natively.
Gate Decision: PASS
