# Report File Name: diy-config-library-flash-verification.md
Task ID: DIY-CONFIG-FLASH-VERIFY-001
Prompt: Sau bước 1 chọn mạch, thêm bước 2 để chọn config đã lưu của đúng mạch hoặc tạo config mới rồi lưu; sau đó retest lại bằng Chrome non-headless và test cả phần flash.
Objective: Implement bước chọn config theo board profile trong DIY wizard, rồi verify end-to-end flow đến flash step bằng browser non-headless với evidence từ UI, network, và persistence.
Task Status: Partial
Date: 2026-03-15
Agent: Codex

FR/NFR Mapping:
- FR-03
- FR-14
- FR-15
- FR-16
- FR-23
- FR-30
- NFR-03

PRD / AGENTS References:
- `PRD.md` items 66-69
- `AGENTS.md` sections 3, 4, 8, 9, 10

Scope In/Out:
- Scope In:
  - Thêm step `Configs` sau khi chọn board.
  - Lọc config theo `board_profile`.
  - Cho phép tạo config mới, lưu config hiện tại, chọn lại config đã có.
  - Verify flow `/devices/diy` tới bước flash bằng Chrome non-headless.
  - Verify persistence bằng DB thực tế của backend local dùng cho phiên test.
- Scope Out:
  - Không redesign UI theo Stitch.
  - Không đổi schema ngoài phần API/query cần cho filter config.
  - Không thực hiện flash vào thiết bị USB thật.
  - Không fix serial re-lock issue trong task này.

Assumptions:
- Browser verification dùng backend local SQLite riêng để tránh tác động MariaDB runtime thật.
- Không có thiết bị USB ESP32 cắm vào máy trong lúc verify.
- Report này tổng hợp cả implementation đã làm trước đó và verification non-headless chạy ngày 2026-03-14.

Impacted Files / APIs / Services / DB Tables:
- Files:
  - `/Users/kiendinhtrung/Documents/GitHub/Final-Project/webapp/src/app/devices/diy/page.tsx`
  - `/Users/kiendinhtrung/Documents/GitHub/Final-Project/webapp/src/features/diy/components/Step1Board.tsx`
  - `/Users/kiendinhtrung/Documents/GitHub/Final-Project/webapp/src/features/diy/components/Step2Configs.tsx`
  - `/Users/kiendinhtrung/Documents/GitHub/Final-Project/server/app/api.py`
  - `/Users/kiendinhtrung/Documents/GitHub/Final-Project/server/tests/test_diy_api.py`
- APIs:
  - `GET /api/v1/diy/projects?board_profile=...`
  - `POST /api/v1/diy/projects`
  - `PUT /api/v1/diy/projects/{id}`
  - `POST /api/v1/diy/build?project_id=...`
  - `GET /api/v1/diy/build/{job_id}`
  - `GET /api/v1/diy/build/{job_id}/logs`
  - `GET /api/v1/diy/build/{job_id}/artifact`
  - `POST /api/v1/serial/lock`
  - `POST /api/v1/serial/unlock`
  - `GET /api/v1/serial/status`
  - `POST /api/v1/rooms`
- Services:
  - DIY project persistence
  - Builder service / PlatformIO pipeline
  - Serial coordination
- DB Tables:
  - `diy_projects`
  - `build_jobs`
  - `serial_sessions`
  - `rooms`

Sub-agent Outputs:
- Planner:
  - Task Packet Summary:
    - Tách scope thành 2 phần: implementation step config library theo board và verification flash flow.
    - Đặt acceptance criteria gồm: config list phải lọc đúng board, pin mapping bị khóa khi chưa có active config, build phải tạo artifact thật, flasher chỉ mở khi có build artifact + serial lock.
  - Acceptance Criteria:
    - Step 2 hiển thị config theo đúng `board_profile`.
    - `Continue to Pin Mapping` bị disable khi chưa chọn/tạo config.
    - Người dùng tạo config mới xong thì config xuất hiện trong danh sách và active.
    - Flash step phải block ở failure path trước khi đủ điều kiện.
    - Happy path phải tới trạng thái `Ready for web flashing`.
  - Failure-path Check Planned:
    - Chưa có config thì không được sang pin mapping.
    - Chưa reserve serial port thì flasher không mở dù đã có artifact.
  - Risks / Constraints:
    - Không có USB thật nên không thể verify flash completion.
    - `mariadb_nas` trong browser sub-session có thể không có config.
  - Gate Expectation:
    - PASS chỉ khi browser flow và persistence chain nhất quán; nếu serial lifecycle lệch state thì FAIL.
- Coder:
  - Relevant Code Path Reviewed:
    - `/Users/kiendinhtrung/Documents/GitHub/Final-Project/webapp/src/app/devices/diy/page.tsx`
    - `/Users/kiendinhtrung/Documents/GitHub/Final-Project/webapp/src/features/diy/components/Step1Board.tsx`
    - `/Users/kiendinhtrung/Documents/GitHub/Final-Project/webapp/src/features/diy/components/Step2Configs.tsx`
    - `/Users/kiendinhtrung/Documents/GitHub/Final-Project/server/app/api.py`
    - `/Users/kiendinhtrung/Documents/GitHub/Final-Project/server/tests/test_diy_api.py`
  - What Was Implemented:
    - DIY wizard đổi thành 5 bước: Boards, Configs, Pins, Review, Flash.
    - Thêm `Step2Configs` để load/select/save configs theo board.
    - `GET /api/v1/diy/projects` hỗ trợ filter `board_profile`.
    - Chặn pin editing cho tới khi có active config được chọn hoặc tạo.
    - Thêm backend test cho filter theo board profile.
  - What Was Not Implemented:
    - Không fix serial re-lock issue phát hiện trong lần verify non-headless.
    - Không thêm automation/browser test cố định trong repo.
  - Why the Change Set Is the Smallest Correct Slice:
    - Tái sử dụng `diy_projects` làm storage cho config library thay vì mở thêm schema mới.
    - Chỉ thêm query filter, UI step mới, và giữ nguyên build/flash/domain rules đang có.
- Tester:
  - Happy Path Result:
    - Chrome non-headless attach thành công vào browser thật.
    - Tạo room `NH Flash Room`, tạo config `NH Flash Config`, map `GPIO2 -> OUTPUT -> relay`, review pass, build server thành `artifact_ready`, reserve `/dev/ttyUSB-NH`, và UI chuyển sang `Ready for web flashing`.
  - Failure Path Result:
    - Khi chưa có config, `Continue to Pin Mapping` bị disable.
    - Ở flash step trước khi reserve port, flasher chưa render và UI block bằng thông báo serial coordination.
  - Defects Found During Validation:
    - Sau khi UI đã hiển thị `Released /dev/ttyUSB-NH`, backend log vẫn ghi thêm một `POST /api/v1/serial/lock` mới cho cùng port, làm port bị lock lại cho tới khi cleanup thủ công.
  - PASS / FAIL Reasoning:
    - Flow chính đến trạng thái ready-to-flash pass.
    - Tuy nhiên serial lifecycle không nhất quán giữa UI, API log, và DB trong nhánh release/cleanup, nên gate tổng thể là `FAIL`.

Completed Work:
- Item 1: Đã thêm step `Configs` vào wizard DIY và nối flow từ board -> config -> pin mapping -> review -> flash.
- Item 2: Đã thêm API filter `board_profile` cho danh sách DIY projects và test backend tương ứng.
- Item 3: Đã verify non-headless Chrome bằng `chrome-devtools` với login thật, room thật, config thật, pin mapping thật, và flash UI thật.
- Item 4: Đã chạy server build thật qua PlatformIO và nhận artifact thật (`.bin`, `bootloader.bin`, `partitions.bin`).
- Item 5: Đã kiểm tra persistence local backend trước/sau bằng SQLite của chính phiên test.
- Item 6: Đã cleanup serial port bằng API để đưa `/dev/ttyUSB-NH` về trạng thái `locked:false`.

Remaining Work:
- Item 1: Điều tra nguyên nhân request `serial/lock` xuất hiện lại sau khi UI đã release port.
- Item 2: Verify lại cùng flow trên environment có `mariadb_nas` được cấu hình đầy đủ trong browser sub-session.
- Item 3: Verify actual hardware flash với thiết bị USB thật.

Blocked / Deferred:
- Item: Real hardware flashing
- Impact: Không thể kết luận thiết bị flash xong thành công trên USB thật.
- Needed to Unblock: Có ESP32 cắm USB và cho phép mở hardware picker thực tế.
- Item: MariaDB MCP trong browser sub-session chưa được cấu hình
- Impact: Không có DB evidence trực tiếp từ `mariadb_nas` trong lần verify non-headless.
- Needed to Unblock: Cấu hình `mariadb_nas` runtime trong sub-session hoặc verify trên thread có MCP config đầy đủ.

Change Request Note:
- Required: No
- If Yes, affected FR/NFR: N/A
- Approval Status: N/A

Changed Files:
- `/Users/kiendinhtrung/Documents/GitHub/Final-Project/webapp/src/app/devices/diy/page.tsx`
- `/Users/kiendinhtrung/Documents/GitHub/Final-Project/webapp/src/features/diy/components/Step1Board.tsx`
- `/Users/kiendinhtrung/Documents/GitHub/Final-Project/webapp/src/features/diy/components/Step2Configs.tsx`
- `/Users/kiendinhtrung/Documents/GitHub/Final-Project/server/app/api.py`
- `/Users/kiendinhtrung/Documents/GitHub/Final-Project/server/tests/test_diy_api.py`
- `/Users/kiendinhtrung/Documents/GitHub/Final-Project/diy-config-library-flash-verification.md`

Verification:
- Lint/Typecheck:
  - Command:
    - `cd /Users/kiendinhtrung/Documents/GitHub/Final-Project/webapp && npm run lint`
    - `cd /Users/kiendinhtrung/Documents/GitHub/Final-Project/webapp && npm run build`
  - Result:
    - `npm run lint`: pass, còn warning UI/accessibility cũ.
    - `npm run build`: pass.
  - Evidence:
    - Previous implementation verification pass trước browser retest.
- Backend tests:
  - Command:
    - `cd /Users/kiendinhtrung/Documents/GitHub/Final-Project/server && ../.venv/bin/python -m pytest tests/test_diy_api.py`
  - Result:
    - Pass `17 passed`.
  - Evidence:
    - Bao gồm test filter `board_profile` mới cho DIY project library.
- Browser flow (chrome-devtools):
  - Flow checked:
    - `/login` -> `/devices/diy` -> create room -> create config -> pin mapping -> validation -> flash.
  - Happy path evidence:
    - Non-headless confirmed bằng attach vào tab Chrome desktop có sẵn, `navigator.webdriver=false`.
    - `POST /api/v1/rooms` -> `200`, tạo `NH Flash Room`.
    - `POST /api/v1/diy/projects` -> `200`, tạo config `NH Flash Config`.
    - `POST /api/v1/diy/build?project_id=742628af-e6d9-454e-802a-b9158429341f` -> `200`.
    - `GET /api/v1/diy/build/13238189-7184-4316-be34-81920aa86846` -> `status=artifact_ready`.
    - UI hiển thị `Build succeeded — .bin artifact is ready for download.` và `Ready for web flashing`.
    - `POST /api/v1/serial/lock?...port=/dev/ttyUSB-NH...` -> `200`.
    - UI render `esp-web-install-button` + manifest link.
  - Failure path evidence:
    - Ở step 2, `Continue to Pin Mapping` disabled trước khi create/select config.
    - Ở flash step trước serial lock, flasher chưa render, `.bin` disabled trước build, và UI block bằng thông báo serial coordination.
  - Console check:
    - Không có runtime error mới liên quan flow DIY/flash.
    - Có warning/issue cũ: password field không nằm trong form; thiếu label/name/id ở một số field.
  - Network check:
    - `GET /api/v1/diy/projects?board_profile=dfrobot-beetle-esp32-c3` -> `200`.
    - `PUT /api/v1/diy/projects/{id}` persist pin map + `latest_build_job_id` + `serial_port`.
    - `GET /api/v1/diy/build/{job_id}/artifact`, `/artifact/bootloader`, `/artifact/partitions` -> `200`.
    - `GET /api/v1/serial/status?port=%2Fdev%2FttyUSB-NH` -> `200`.
- DB before/after (mariadb_nas):
  - Tables / schema checked:
    - Substitute DB: local SQLite file `/tmp/econnect_nonheadless_flash.db` used by backend under test.
    - Tables checked: `diy_projects`, `build_jobs`, `serial_sessions`.
  - Before state:
    - `diy_projects=0`
    - `build_jobs=0`
    - `serial_sessions=0`
  - After state:
    - `diy_projects=1`
    - `build_jobs=1`
    - `serial_sessions=2`
    - Project row `742628af-e6d9-454e-802a-b9158429341f` lưu `serial_port=/dev/ttyUSB-NH`, `latest_build_job_id=13238189-7184-4316-be34-81920aa86846`, `wifi_ssid=QA-WiFi`, `pins[0].gpio_pin=2`, `pins[0].function=relay`.
    - Build row `13238189-7184-4316-be34-81920aa86846` có `status=artifact_ready`.
    - Final cleanup state: `/api/v1/serial/status?port=%2Fdev%2FttyUSB-NH` trả `locked:false`.
  - Shape impact:
    - Không có schema change trong turn verify.
- Design reference (Stitch):
  - Reference checked:
    - N/A
  - Reused / aligned components:
    - N/A
- MCP unavailability (if any):
  - MCP unavailable:
    - `mariadb_nas` trong browser sub-session không có connection config runtime.
  - Verification step missed:
    - Không query trực tiếp MariaDB bằng MCP trong cùng browser session.
  - Substitute evidence:
    - Đọc trực tiếp SQLite backend mà browser test đang dùng.
  - Residual risk caused by missing MCP:
    - Chưa có bằng chứng DB trực tiếp trên MariaDB thật cho lần verify non-headless này.

Defects Found:
- [Medium] Serial lock reappears after UI release - reproduction steps: build artifact_ready, reserve `/dev/ttyUSB-NH`, click `Release` trên flash step, quan sát backend log sau đó xuất hiện thêm `POST /api/v1/serial/lock` cho cùng port - evidence: server log có chuỗi `unlock` rồi `lock` mới, DB từng có row `serial_sessions.id=2` ở trạng thái `locked`, API status cũng từng trả `locked:true` - current status: đã cleanup thủ công về `locked:false`, root cause chưa điều tra.
- [Low] Existing form/a11y warnings remain - reproduction steps: mở `/login` và `/devices/diy`, xem console - evidence: `Password field is not contained in a form`, `No label associated with a form field`, `A form field element should have an id or name attribute` - current status: chưa xử lý trong task này.

Residual Risk:
- Risk 1: Chưa verify actual hardware flash completion trên USB thật.
- Risk 2: Serial lifecycle release/re-lock còn bất nhất, có thể ảnh hưởng FR-23 nếu tái hiện với người dùng thật.
- Risk 3: Lần browser verify này dùng local SQLite backend, chưa có DB proof trực tiếp trên MariaDB bằng MCP.

Next Recommended Action:
- Action 1: Trace nguyên nhân `POST /api/v1/serial/lock` xuất hiện lại sau nhánh release bằng cách instrument [page.tsx](/Users/kiendinhtrung/Documents/GitHub/Final-Project/webapp/src/app/devices/diy/page.tsx#L1490) và [api.py](/Users/kiendinhtrung/Documents/GitHub/Final-Project/server/app/api.py#L1285).
- Action 2: Rerun flash verification với USB device thật sau khi fix serial release lifecycle.
- Action 3: Rerun persistence verification trên session có `mariadb_nas` được cấu hình đầy đủ.

Gate Decision: FAIL
