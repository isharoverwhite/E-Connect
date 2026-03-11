Report File Name: write-esp32-wifi-flash-pairing-workflow.md
Task ID: DOC-ESP32-WIFI-FLASH-PAIR-001
Prompt: viết file markdown miêu tả về workflow về cấu hình và nạp code, yêu cầu khi cấu hình kết nối mạng đầu tiên, yêu cầu nhập SSID, Pass trên WebUI để add vào ESP32 kết nối từ xa. sau khi flash xong thì ESP32 kết nối với mạng và yêu cầu pair với server.
Objective: Tạo tài liệu markdown mô tả workflow cấu hình Wi-Fi lần đầu, build/flash firmware ESP32, và pair thiết bị với server theo baseline PRD và code path hiện có.
Task Status: Complete
Date: 2026-03-11 20:59:57 +0700
Agent: Codex

FR/NFR Mapping:
- FR-14: No-code firmware generation flow cho DIY qua server-side build pipeline
- FR-16: Block build/flash khi GPIO conflict/invalid
- FR-23: Serial/flash coordination tránh tranh chấp cổng
- FR-27: Device discovery + explicit authorization
- FR-30: Server phải build firmware `.bin` từ config WebUI và cung cấp artifact/log cho WebUI flash
- NFR-07: Có loading/empty/error/success state cho flow chính

PRD / AGENTS References:
- `PRD.md` mục 8.1 Device lifecycle
- `PRD.md` mục 8.4 Build/flash lifecycle
- `PRD.md` mục 12.2 Core Command Paths
- `PRD.md` mục WP-06 Build/Flash + Serial Coordination
- `AGENTS.md` mục 2 Source of Truth and Priority
- `AGENTS.md` mục 10 Required Task Report Format

Scope In/Out:
- Scope In:
  - Viết tài liệu workflow mới cho cấu hình Wi-Fi lần đầu, flash ESP32, handshake, discovery, và approve/pair.
  - Cập nhật `README.md` để liên kết tới tài liệu mới.
  - Nêu rõ gap hiện tại giữa workflow mong muốn và WebUI đang có.
- Scope Out:
  - Không thay đổi logic WebUI, backend, firmware, hay DB schema.
  - Không triển khai field `SSID`/`Password` trên UI trong task này.
  - Không chạy browser validation vì không có thay đổi hành vi UI runtime.

Assumptions:
- User yêu cầu tài liệu hóa workflow, không yêu cầu implement thêm tính năng.
- "Pair với server" được hiểu là ESP32 gửi handshake vào `POST /api/v1/config`, sau đó admin approve tại discovery.
- `SSID` và `Password` là thông tin bắt buộc cho first-time provisioning theo yêu cầu user, dù hiện tại UI chưa expose rõ.

Impacted Files / APIs / Services / DB Tables:
- Files:
  - `/Users/kiendinhtrung/Documents/GitHub/Final-Project/esp32-wifi-flash-pairing-workflow.md`
  - `/Users/kiendinhtrung/Documents/GitHub/Final-Project/README.md`
- APIs referenced:
  - `POST /api/v1/diy/config/generate`
  - `POST /api/v1/diy/build`
  - `POST /api/v1/config`
  - `POST /api/v1/device/{device_id}/approve`
- Services:
  - WebUI DIY Builder
  - Server build/discovery flow
- DB Tables:
  - N/A cho thay đổi thực tế của task này

Sub-agent Outputs:
- Planner:
  - Task Packet Summary:
    - Task tập trung vào tài liệu workflow, không mở rộng sang implement.
    - Tài liệu phải bám PRD lifecycle và code path thật để tránh mô tả suy đoán.
    - Phải có ít nhất một failure path; thực tế tài liệu đã bao gồm bốn failure path.
  - Acceptance Criteria:
    - Có file markdown mới mô tả rõ bước nhập `SSID`/`Password` trên WebUI.
    - Có mô tả rõ sau flash ESP32 tự kết nối Wi-Fi và gửi pair request.
    - Có mô tả bước discovery và approve trên server.
    - Có ghi chú rõ gap hiện trạng nếu WebUI chưa khớp workflow.
  - Failure-path Check Planned:
    - Thiếu `SSID`/`Password` phải bị block.
    - Sai mật khẩu Wi-Fi hoặc server unreachable phải được nêu là failure path.
  - Risks / Constraints:
    - Code path backend và WebUI hiện chưa đồng bộ hoàn toàn ở phần field Wi-Fi trên UI.
    - Task không bao gồm sửa code nên chỉ có thể tài liệu hóa và nêu gap.
  - Gate Expectation:
    - PASS nếu file tài liệu được tạo, README được cập nhật, và nội dung đối chiếu đúng với PRD/code.
- Coder:
  - Relevant Code Path Reviewed:
    - `PRD.md`
    - `server/app/models.py`
    - `server/app/api.py`
    - `webapp/src/app/devices/diy/page.tsx`
    - `webapp/src/app/devices/discovery/page.tsx`
    - `README.md`
  - What Was Implemented:
    - Thêm file tài liệu workflow mới tại repo root.
    - Thêm liên kết tài liệu mới vào `README.md`.
    - Tài liệu mô tả đầy đủ luồng config Wi-Fi lần đầu, build/flash, handshake, discovery, approve.
    - Tài liệu có sơ đồ sequence và các failure path chính.
  - What Was Not Implemented:
    - Không thêm field `Wi-Fi SSID` và `Wi-Fi Password` vào DIY Builder.
    - Không thay API, firmware, hay discovery flow.
  - Why the Change Set Is the Smallest Correct Slice:
    - Prompt yêu cầu viết file markdown, nên thay đổi nhỏ nhất đúng scope là thêm tài liệu và liên kết truy cập.
- Tester:
  - Happy Path Result:
    - Tài liệu bao quát đúng luồng từ WebUI config -> build/flash -> ESP32 join Wi-Fi -> `POST /api/v1/config` -> discovery -> approve.
  - Failure Path Result:
    - Tài liệu có nêu rõ các failure path: thiếu `SSID/Password`, sai mật khẩu Wi-Fi, server không reachable, pending authorization chưa approve.
  - Defects Found During Validation:
    - [Medium] WebUI DIY builder hiện chưa thể hiện rõ field nhập `Wi-Fi SSID` và `Wi-Fi Password` dù backend đã có model hỗ trợ.
  - PASS / FAIL Reasoning:
    - PASS cho scope tài liệu vì file yêu cầu đã được tạo, có evidence đối chiếu PRD/code, và có nêu rõ gap hiện trạng thay vì che giấu.

Completed Work:
- Đã tạo file `/Users/kiendinhtrung/Documents/GitHub/Final-Project/esp32-wifi-flash-pairing-workflow.md`.
- Đã mô tả yêu cầu bắt buộc nhập `Wi-Fi SSID` và `Wi-Fi Password` trên WebUI cho lần cấu hình đầu tiên.
- Đã mô tả rõ bước flash, boot lại, kết nối Wi-Fi, handshake với server, discovery, và approve.
- Đã thêm failure paths và acceptance criteria trong tài liệu.
- Đã cập nhật `/Users/kiendinhtrung/Documents/GitHub/Final-Project/README.md` để dẫn tới tài liệu mới.

Remaining Work:
- None

Blocked / Deferred:
- Item: Thêm field `SSID`/`Password` thật vào WebUI DIY builder
- Impact: Workflow tài liệu hóa chưa khớp hoàn toàn với UI hiện tại
- Needed to Unblock: Một task implementation riêng cho WebUI + verification browser

Change Request Note:
- Required: No
- If Yes, affected FR/NFR:
- Approval Status:

Changed Files:
- /Users/kiendinhtrung/Documents/GitHub/Final-Project/esp32-wifi-flash-pairing-workflow.md
- /Users/kiendinhtrung/Documents/GitHub/Final-Project/README.md

Verification:
- Lint/Typecheck:
  - Command:
    - N/A
  - Result:
    - N/A
  - Evidence:
    - Task chỉ thay đổi markdown documentation, không thay source code cần lint/typecheck.
- Backend tests:
  - Command:
    - N/A
  - Result:
    - N/A
  - Evidence:
    - Không có thay đổi backend runtime.
- Browser flow (chrome-devtools):
  - Flow checked:
    - N/A
  - Happy path evidence:
    - N/A
  - Failure path evidence:
    - N/A
  - Console check:
    - N/A
  - Network check:
    - N/A
- DB before/after (mariadb_nas):
  - Tables / schema checked:
    - N/A
  - Before state:
    - N/A
  - After state:
    - N/A
  - Shape impact:
    - N/A
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
    - Nội dung được verify bằng cách đọc PRD, model/backend API, và code path discovery/DIY builder hiện có.
  - Residual risk caused by missing MCP:
    - Không có rủi ro MCP cho task documentation-only; rủi ro còn lại nằm ở việc UI runtime chưa triển khai đủ field theo workflow.

Defects Found:
- [Medium] WebUI thiếu field Wi-Fi provisioning rõ ràng - mở `webapp/src/app/devices/diy/page.tsx`, không thấy code path hiển thị `wifi_ssid`/`wifi_password` dù backend `GenerateConfigRequest` đã hỗ trợ - current status: open

Residual Risk:
- Workflow trong tài liệu là workflow yêu cầu; UI hiện tại chưa triển khai đầy đủ phần nhập `SSID/Password`.
- Chưa có verification runtime chứng minh ESP32 thực sự join Wi-Fi và handshake sau flash trong task này vì không thay code và không có phần cứng trong scope.

Next Recommended Action:
- Tạo task tiếp theo để thêm field `Wi-Fi SSID` và `Wi-Fi Password` vào WebUI DIY builder.
- Sau khi implement, verify lại bằng browser flow và nếu có phần cứng thì chạy end-to-end flash + handshake thực tế.

Gate Decision: PASS
