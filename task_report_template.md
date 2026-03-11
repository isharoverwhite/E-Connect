# Task Report Template

Tài liệu này định nghĩa mẫu báo cáo chuẩn mà Agent phải dùng sau khi hoàn thành xử lý **1 task**.

Quy ước bắt buộc:
- **1 prompt của user = 1 task = 1 report**
- File mẫu cố định của repo là `task_report_template.md`
- Mỗi task phải xuất ra **đúng 1 file report riêng** với tên: `[task_name].md`
- Report phải phản ánh **trạng thái thực tế** của task, không được suy đoán
- Report phải ghi rõ **phần đã làm xong** và **phần còn lại / chưa đạt / bị block**
- Nếu không có bằng chứng thì không được kết luận hoàn thành
- Gate cuối cùng chỉ dùng: `PASS` hoặc `FAIL`

Tài liệu này **mở rộng** format trong `AGENTS.md` và `PRD.md`, không thay thế các field bắt buộc ở đó.

## Cách dùng

Sau mỗi prompt không tầm thường, Agent phải xuất báo cáo theo đúng mẫu dưới đây:
- Tạo report thành **1 file Markdown riêng**
- Tên file report bắt buộc theo format: `[task_name].md`
- `task_name` nên ngắn gọn, mô tả đúng task, ưu tiên ASCII `kebab-case`
- Mặc định đặt file report ở repo root, trừ khi user yêu cầu vị trí khác
- Giữ nguyên các đề mục bắt buộc
- Nếu mục nào không áp dụng, ghi `N/A` và nêu lý do ngắn gọn
- Mục `Completed Work` và `Remaining Work` là **bắt buộc cho mọi task**
- Nếu task chỉ hoàn thành một phần, phải ghi rõ phần nào đã xong, phần nào chưa xong, vì sao chưa xong, và cần gì để hoàn tất
- Nếu task đụng UI, phải có phần verify bằng `chrome-devtools`
- Nếu task đụng persistence/data, phải có phần verify bằng `mariadb_nas`
- Nếu task có reference thiết kế, phải ghi rõ phần check với `stitch`

## Quy tắc đặt tên file report

Agent phải tạo file report theo đúng cấu trúc sau:

```text
[task_name].md
```

Trong đó:
- `task_name` là tên rút gọn của task hiện tại
- nên dùng chữ thường, không dấu, ngăn cách bằng `-`
- không dùng tên chung chung như `report.md`, `task.md`, `done.md`

Ví dụ hợp lệ:
- `fix-dashboard-layout-persist.md`
- `add-device-approval-validation.md`
- `review-automation-trigger-flow.md`

Ví dụ không hợp lệ:
- `task_report.md`
- `task_report_template.md`
- `report_final.md`

## Chuẩn điền trạng thái

Trường `Task Status` dùng một trong ba giá trị:
- `Complete`: phần scope của prompt đã hoàn tất và đủ evidence để xin `PASS`
- `Partial`: đã làm xong một phần nhưng chưa đủ điều kiện done
- `Blocked`: chưa thể hoàn tất vì blocker kỹ thuật, môi trường, hoặc scope change chưa được duyệt

Lưu ý:
- `Task Status` mô tả mức hoàn thành thực tế
- `Gate Decision` vẫn chỉ được phép là `PASS` hoặc `FAIL`
- Thông thường:
  - `Complete` -> có thể `PASS`
  - `Partial` -> thường là `FAIL`
  - `Blocked` -> thường là `FAIL`

## Mẫu báo cáo bắt buộc

```md
Report File Name: [task_name].md
Task ID:
Prompt:
Objective:
Task Status: Complete / Partial / Blocked
Date:
Agent:

FR/NFR Mapping:
PRD / AGENTS References:
Scope In/Out:
- Scope In:
- Scope Out:

Assumptions:
Impacted Files / APIs / Services / DB Tables:

Sub-agent Outputs:
- Planner:
  - Task Packet Summary:
  - Acceptance Criteria:
  - Failure-path Check Planned:
  - Risks / Constraints:
  - Gate Expectation:
- Coder:
  - Relevant Code Path Reviewed:
  - What Was Implemented:
  - What Was Not Implemented:
  - Why the Change Set Is the Smallest Correct Slice:
- Tester:
  - Happy Path Result:
  - Failure Path Result:
  - Defects Found During Validation:
  - PASS / FAIL Reasoning:

Completed Work:
- Item 1:
- Item 2:

Remaining Work:
- Item 1:
- Item 2:

Blocked / Deferred:
- Item:
- Impact:
- Needed to Unblock:

Change Request Note:
- Required: Yes / No
- If Yes, affected FR/NFR:
- Approval Status:

Changed Files:
- /absolute/path/to/file

Verification:
- Lint/Typecheck:
  - Command:
  - Result:
  - Evidence:
- Backend tests:
  - Command:
  - Result:
  - Evidence:
- Browser flow (chrome-devtools):
  - Flow checked:
  - Happy path evidence:
  - Failure path evidence:
  - Console check:
  - Network check:
- DB before/after (mariadb_nas):
  - Tables / schema checked:
  - Before state:
  - After state:
  - Shape impact:
- Design reference (Stitch):
  - Reference checked:
  - Reused / aligned components:
- MCP unavailability (if any):
  - MCP unavailable:
  - Verification step missed:
  - Substitute evidence:
  - Residual risk caused by missing MCP:

Defects Found:
- [Severity] Title - reproduction steps - evidence - current status

Residual Risk:
- Risk 1:
- Risk 2:

Next Recommended Action:
- Action 1:
- Action 2:

Gate Decision: PASS / FAIL
```

## Quy tắc điền phần "đã làm" và "còn lại"

### 1. `Completed Work`

Phải mô tả:
- phần nào trong prompt đã thực sự được hoàn tất
- thay đổi nào đã merge vào code/task hiện tại
- verification nào đã chạy xong

Không được ghi chung chung kiểu:
- "đã fix"
- "đã verify"
- "đã hoàn thành cơ bản"

Phải ghi theo dạng có thể kiểm chứng, ví dụ:
- "Đã thêm validation conflict GPIO ở API generate draft"
- "Đã chạy `pnpm lint` cho webapp và pass"
- "Đã verify happy path trên browser: tạo automation thành công, response 200"

### 2. `Remaining Work`

Phải mô tả:
- phần nào của prompt vẫn chưa làm
- phần nào đã làm dở nhưng chưa đủ evidence
- phần nào nằm ngoài scope nhỏ nhất đã chốt
- phần nào cần task tiếp theo

Nếu task thực sự done hoàn toàn, vẫn phải ghi:
- `None`

Ví dụ hợp lệ:
- "Chưa verify mobile width dưới 768px"
- "Chưa có DB after-state vì môi trường MariaDB chưa truy cập được"
- "Chưa xử lý server error state cho flow import"

### 3. `Blocked / Deferred`

Chỉ dùng cho:
- phụ thuộc môi trường
- thiếu quyền / thiếu service
- scope change chưa được phê duyệt
- bug ngoài phạm vi task hiện tại

Nếu không có, ghi:
- `None`

## Quy tắc evidence

Mỗi kết luận quan trọng nên đủ 5 ý:
1. `Claim`: điều gì đúng hoặc chưa đúng
2. `Evidence`: command, diff, browser trace, DB query, console/network log
3. `Reasoning`: vì sao evidence đó đủ mạnh
4. `Counter-check`: failure path hoặc edge case đã test
5. `Residual risk`: phần gì vẫn chưa được chứng minh

## Khi nào được `PASS`

Chỉ được `PASS` khi:
- scope đã chốt của prompt đã hoàn tất
- mọi verify bắt buộc theo loại task đã chạy
- `Completed Work` đủ evidence
- `Remaining Work` chỉ còn các follow-up ngoài scope hoặc là `None`
- không còn defect chặn acceptance của task

## Khi nào phải `FAIL`

Phải `FAIL` nếu có một trong các trường hợp:
- chưa đủ evidence
- thiếu browser verification cho task chạm UI
- thiếu DB verification cho task chạm persistence
- còn blocker làm acceptance chưa đạt
- còn phần trong `Scope In` nhưng chưa hoàn thành

## Mẫu ngắn cho task hoàn tất trọn vẹn

```md
Report File Name: [task_name].md
Task Status: Complete

Completed Work:
- Đã triển khai phần scope trong prompt
- Đã chạy verify bắt buộc và có evidence

Remaining Work:
- None

Blocked / Deferred:
- None

Gate Decision: PASS
```

## Mẫu ngắn cho task mới hoàn thành một phần

```md
Report File Name: [task_name].md
Task Status: Partial

Completed Work:
- Đã sửa backend validation
- Đã thêm test unit

Remaining Work:
- Chưa verify browser failure path
- Chưa check DB after-state

Blocked / Deferred:
- MariaDB môi trường test chưa truy cập được
- Cần bật backend local để hoàn tất flow end-to-end

Gate Decision: FAIL
```
