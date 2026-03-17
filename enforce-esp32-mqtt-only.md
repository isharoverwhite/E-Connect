# Report File Name: enforce-esp32-mqtt-only.md
Task ID: MQTT-ESP32-ONLY-001
Prompt: hãy đảm bảo toàn bộ mạch ESP32 đều phải chạy qua MQTT protocol
Objective: Ép toàn bộ ESP32 `library` path chạy `pairing`, `command`, và `state` qua MQTT; chặn các HTTP fallback làm lệch contract transport.
Task Status: Complete
Date: 2026-03-15
Agent: Codex (GPT-5)

FR/NFR Mapping:
- FR-11: MQTT-first connectivity
- FR-03: Quản lý thiết bị DIY + extensible device integration model
- Lifecycle traceability cho device command/state trong PRD

PRD / AGENTS References:
- `PRD.md` mục `MQTT-first device transport`
- `PRD.md` WP-03: MQTT Transport Vertical Slice
- `PRD.md` các dòng liên quan `POST /api/v1/device/{device_id}/command`, MQTT consumer, `device_history`
- `AGENTS.md` mục 4.1 `chrome-devtools`
- `AGENTS.md` mục 4.2 `mariadb_nas`
- `AGENTS.md` mục 10 `Required Task Report Format`
- Xung đột cần nêu rõ: PRD hiện vẫn mô tả onboarding handshake qua `POST /api/v1/config`, trong khi prompt này yêu cầu ESP32 phải đi hoàn toàn qua MQTT

Scope In/Out:
- Scope In:
  - MQTT register/ack cho secure pairing của ESP32 `library`
  - Chặn HTTP handshake `/api/v1/config` cho ESP32 `library`
  - Chặn HTTP telemetry `/api/v1/device/{device_id}/history` cho device MQTT-managed
  - Chặn HTTP polling `/api/v1/device/{device_id}/command/latest` cho device MQTT-managed
  - Cập nhật firmware ESP32 để pair qua MQTT thay vì HTTP
  - Cập nhật automated tests cho happy path và failure path
- Scope Out:
  - OTA orchestration
  - MQTT auth/TLS
  - Hardware-assisted flash/run trên board ESP32 thật
  - Sửa lỗi proxy của webapp chính ở cổng `3000`

Assumptions:
- User override hiện tại được xem là phê duyệt thay đổi baseline cho ESP32 `library` transport.
- Legacy discovery không phải ESP32 `library` vẫn có thể dùng HTTP `/config`.
- MQTT broker hiện tại là `broker.emqx.io` với namespace `dev_kiendinhtrung`.

Impacted Files / APIs / Services / DB Tables:
- Files:
  - `/Users/kiendinhtrung/Documents/GitHub/Final-Project/server/app/api.py`
  - `/Users/kiendinhtrung/Documents/GitHub/Final-Project/server/app/mqtt.py`
  - `/Users/kiendinhtrung/Documents/GitHub/Final-Project/server/app/services/device_registration.py`
  - `/Users/kiendinhtrung/Documents/GitHub/Final-Project/firmware/firmware/src/main.cpp`
  - `/Users/kiendinhtrung/Documents/GitHub/Final-Project/server/tests/test_diy_api.py`
  - `/Users/kiendinhtrung/Documents/GitHub/Final-Project/server/static/test_control.html`
- APIs:
  - `POST /api/v1/config`
  - `POST /api/v1/device/{device_id}/command`
  - `GET /api/v1/device/{device_id}/command/latest`
  - `POST /api/v1/device/{device_id}/history`
- Services:
  - MQTT client manager
  - Device registration service
  - ESP32 secure pairing flow
- DB tables:
  - `devices`
  - `device_history`
  - `pin_configurations`
  - `diy_projects`

Sub-agent Outputs:
- Planner:
  - Task Packet Summary:
    - Xác định 3 đường phá `MQTT-first` cho ESP32: HTTP handshake `/config`, HTTP telemetry `/history`, HTTP polling `/command/latest`.
    - Chốt lát cắt nhỏ nhất đúng: chuyển secure pairing sang MQTT register/ack và chặn các HTTP fallback còn lại cho MQTT-managed ESP32.
  - Acceptance Criteria:
    - ESP32 firmware không còn dùng HTTP handshake.
    - Backend nhận registration qua MQTT và trả ack qua MQTT.
    - HTTP `/config`, `/history`, `/command/latest` bị chặn cho MQTT-managed ESP32 với lỗi machine-actionable.
    - `POST /device/{id}/command` vẫn publish MQTT và ghi history.
  - Failure-path Check Planned:
    - Secret pairing sai phải bị từ chối.
    - HTTP polling/history cho device MQTT-managed phải trả `mqtt_only`.
  - Risks / Constraints:
    - Xung đột với baseline PRD về HTTP onboarding.
    - Không có phần cứng thật trong scope verify.
  - Gate Expectation:
    - PASS nếu có test + browser/network + DB evidence.
- Coder:
  - Relevant Code Path Reviewed:
    - Backend API command/history/config path
    - MQTT manager
    - ESP32 firmware pairing/runtime path
    - Existing tests cho DIY/device access
  - What Was Implemented:
    - Tách reusable registration logic sang service riêng.
    - Thêm MQTT register subscriber và MQTT ack publisher.
    - Chặn HTTP `/config` cho `DeviceMode.library` hoặc payload có `project_id`/`secret_key`.
    - Chặn HTTP `/device/{id}/history` và `/device/{id}/command/latest` khi device có `topic_pub` và `topic_sub`.
    - Chuyển firmware ESP32 từ HTTP secure handshake sang publish register topic và đợi ack topic.
    - Thêm tests cho MQTT registration happy path, secret mismatch, HTTP fallback block.
  - What Was Not Implemented:
    - OTA flow
    - Broker auth/TLS
    - Hardware-assisted validation
  - Why the Change Set Is the Smallest Correct Slice:
    - Chỉ đụng đúng các path runtime làm ESP32 đi ngoài MQTT; không thay schema, không mở rộng sang OTA hay auth broker.
- Tester:
  - Happy Path Result:
    - `POST /api/v1/device/codex-mqtt-ui-0001/command` trả `200` với `status=sent`.
    - MariaDB ghi đúng `device_history.command_requested`.
  - Failure Path Result:
    - `GET /api/v1/device/codex-mqtt-ui-0001/command/latest` trả `409` với `error=mqtt_only`.
    - Test secret mismatch trả ack lỗi `unauthorized_device`.
  - Defects Found During Validation:
    - Webapp chính ở `127.0.0.1:3000` đang lỗi proxy `/api/v1/system/status` và `/api/v1/users/me` trả `500`.
  - PASS / FAIL Reasoning:
    - PASS vì có evidence đồng thời ở code-level test, browser/network trace, và MariaDB before/after cho path command.

Completed Work:
- Đã thêm MQTT register/ack path cho secure pairing của ESP32 trong backend.
- Đã chuyển firmware ESP32 sang MQTT pairing thay cho HTTP handshake.
- Đã chặn HTTP fallback `/config`, `/history`, `/command/latest` cho device MQTT-managed.
- Đã chạy `compileall` cho backend code path đã sửa và pass.
- Đã chạy `pytest` cho `tests/test_diy_api.py` và `tests/test_room_access.py`, kết quả `21 passed`.
- Đã verify bằng browser trên `http://127.0.0.1:8010/static/test_control.html` với 1 happy path và 1 failure path.
- Đã verify MariaDB thật trước/sau cho `device_history` của device kiểm thử `codex-mqtt-ui-0001`.

Remaining Work:
- None

Blocked / Deferred:
- Item: Hardware-assisted verification với ESP32 thật
- Impact: Chưa có evidence flash/run trên board thật cho firmware mới
- Needed to Unblock: Board ESP32 thật, serial/flash environment, broker và Wi-Fi lab ổn định

Change Request Note:
- Required: Yes
- If Yes, affected FR/NFR:
  - FR-11
  - Onboarding behavior trong PRD đang mô tả HTTP `/config`
- Approval Status:
  - Approved by direct user prompt; implemented as explicit override and conflict surfaced in report

Changed Files:
- /Users/kiendinhtrung/Documents/GitHub/Final-Project/server/app/api.py
- /Users/kiendinhtrung/Documents/GitHub/Final-Project/server/app/mqtt.py
- /Users/kiendinhtrung/Documents/GitHub/Final-Project/server/app/services/device_registration.py
- /Users/kiendinhtrung/Documents/GitHub/Final-Project/firmware/firmware/src/main.cpp
- /Users/kiendinhtrung/Documents/GitHub/Final-Project/server/tests/test_diy_api.py
- /Users/kiendinhtrung/Documents/GitHub/Final-Project/server/static/test_control.html

Verification:
- Lint/Typecheck:
  - Command:
    - `python -m compileall server/app`
  - Result:
    - PASS
  - Evidence:
    - Toàn bộ `server/app` compile thành công, bao gồm `api.py`, `mqtt.py`, `device_registration.py`
- Backend tests:
  - Command:
    - `./venv/bin/python -m pytest tests/test_diy_api.py tests/test_room_access.py`
  - Result:
    - PASS
  - Evidence:
    - `21 passed`
    - Bao gồm các test mới cho MQTT registration happy path, secret mismatch, HTTP fallback block
- Browser flow (chrome-devtools):
  - Flow checked:
    - Mở `http://127.0.0.1:8010/static/test_control.html`
    - Failure path: `GET /api/v1/device/codex-mqtt-ui-0001/command/latest`
    - Happy path: `POST /api/v1/device/codex-mqtt-ui-0001/command`
  - Happy path evidence:
    - Browser fetch trả `200`
    - Body: `{"status":"sent","command":{"kind":"action","pin":2,"value":1}}`
  - Failure path evidence:
    - Browser fetch trả `409`
    - Body: `{"detail":{"error":"mqtt_only","message":"MQTT-managed ESP32 devices do not support HTTP command polling."}}`
  - Console check:
    - Có `409` expected cho failure path
    - Có `401` từ thao tác login cũ của helper page, không thuộc verification path chính
    - Có `404 favicon`, không liên quan MQTT patch
  - Network check:
    - `GET /api/v1/device/codex-mqtt-ui-0001/command/latest` -> `409`
    - `POST /api/v1/device/codex-mqtt-ui-0001/command` -> `200`
- DB before/after (mariadb_nas):
  - Tables / schema checked:
    - `devices`
    - `device_history`
    - `pin_configurations`
  - Before state:
    - `DELETE FROM device_history WHERE device_id = 'codex-mqtt-ui-0001'`
    - `SELECT COUNT(*) AS history_count FROM device_history WHERE device_id = 'codex-mqtt-ui-0001'`
    - Kết quả: `0`
  - After state:
    - Cùng query sau browser happy path
    - Kết quả: `1`
    - Row mới: `event_type='command_requested'`, `payload="{'kind': 'action', 'pin': 2, 'value': 1}"`, `changed_by=1`
  - Shape impact:
    - Không đổi schema; xác nhận dùng đúng shape hiện có của `devices` và `device_history`
- Design reference (Stitch):
  - Reference checked:
    - N/A
  - Reused / aligned components:
    - N/A
- MCP unavailability (if any):
  - MCP unavailable:
    - N/A
  - Verification step missed:
    - N/A
  - Substitute evidence:
    - N/A
  - Residual risk caused by missing MCP:
    - N/A

Defects Found:
- [Medium] Webapp proxy local đang lỗi `500` cho `/api/v1/system/status` và `/api/v1/users/me` - mở `http://127.0.0.1:3000` bằng `chrome-devtools` thấy network trả `500` - current status: open
- [Low] Helper page `server/static/test_control.html` còn warning form/accessibility và `404 favicon` - thấy trong console khi verify browser - current status: open

Residual Risk:
- Prompt hiện tại xung đột với PRD baseline vì PRD vẫn mô tả onboarding qua HTTP `/config`; cần cập nhật PRD hoặc tài liệu flow để tránh drift.
- Chưa có hardware-assisted verification với ESP32 thật.
- Một số script/tool cũ ngoài scope vẫn còn giả định HTTP history/handshake, sẽ cần cập nhật nếu tiếp tục dùng.

Next Recommended Action:
- Cập nhật tài liệu PRD/workflow/Postman/script simulator để đồng bộ với contract MQTT-only cho ESP32 `library`.
- Chạy hardware-assisted verification: build firmware mới, flash lên ESP32, pair qua MQTT register topic, và xác nhận state ingest thật.

Gate Decision: PASS
