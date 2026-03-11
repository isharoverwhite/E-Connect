Task ID: BE-WP07-EXEC-LOG-001
Objective: Implement WP-07 (Automation Minimum Executable Slice) để loại bỏ placeholder trigger và có execution log thật theo PRD.
FR/NFR Mapping: FR-05, WP-07, NFR-06
Scope In/Out:
- Scope In: Thêm persistence cho execution log automation (table mới). Sửa `POST /automation/{automation_id}/trigger` để tạo execution record thật. Return errors machine-actionable.
- Scope Out: Sandbox runtime production-grade, container isolation, distributed worker.

Sub-agent Outputs:
- Planner: Xác định đúng phạm vi thay đổi tại `sql_models.py`, `models.py`, `api.py` cho execution log + trigger runtime.
- Coder: Đã thêm model/table `automation_execution_logs`, response model trigger mới, và logic `exec()` có capture `print`/exception rồi lưu log DB.
- Tester: Re-verify độc lập trên runtime thật (API + MariaDB) với happy path và failure path; bổ sung kiểm tra stability khi script chạy dài.

Changed Files:
- `server/app/sql_models.py`
- `server/app/models.py`
- `server/app/api.py`
- `server/tests/test_automation.py`
- `server/test_auto_trigger.py`

Verification:
- Lint/Typecheck: Không có cấu hình lint/typecheck chính thức cho task này; chỉ xác nhận import/runtime bằng test command.
- Backend tests:
  - `PYTHONPATH=. ./venv/bin/pytest -q tests/test_auth.py` => PASS (7 passed).
  - `PYTHONPATH=. ./venv/bin/pytest -q tests/test_automation.py` => FAIL trong test collection (`ModuleNotFoundError: No module named 'app.main'`).
  - Runtime API check qua localhost:
    - Happy path trigger => trả `status=success`, có log object.
    - Failure script (`1/0`) => trả `status=failed`, có `error_message`.
    - Not found path => `404` với detail string.
    - Disabled automation (`is_enabled=false`) vẫn trigger thành công.
  - Stability check:
    - Trigger script dài ~3.11s.
    - Request `/system/status` gửi đồng thời bị chờ ~2.92s (cho thấy blocking request loop).
- Browser flow (chrome-devtools): N/A (Backend-only task).
- DB before/after (mariadb_nas):
  - Verified schema tồn tại:
    - `automations` có `last_triggered`.
    - `automation_execution_logs` có `automation_id`, `status`, `log_output`, `error_message`, `triggered_at`.
  - Verified row impact:
    - Log count tăng khi trigger (`10 -> 11`) và có bản ghi mới `status=success/failed` đúng theo script outcome.
  - Lưu ý: verify bằng `sqlite3 db.sqlite3` không phản ánh DB runtime trong môi trường này (server đang dùng MariaDB).
- Design reference (Stitch): N/A

Defects Found:
- High: Trigger dùng `exec()` đồng bộ trong `async` route làm block request khác khi script nặng.
- High: `is_enabled=false` chưa được enforce; automation disabled vẫn chạy.
- Medium: Chưa trả lỗi machine-actionable đúng scope (`404` hiện trả detail string đơn).
- Medium: Test `tests/test_automation.py` chưa chạy được do import path sai, nên chưa đạt mức evidence test ổn định.

Residual Risk:
- Chưa có timeout/cancellation cho script execution, nguy cơ nghẽn server nếu script dài hoặc loop lỗi.
- Chưa có isolation runtime; rủi ro bảo mật/ổn định vẫn tồn tại nếu script độc hại hoặc tiêu tốn tài nguyên.
- Thiếu endpoint/query chuẩn để truy xuất execution logs theo luồng audit UI (hiện chỉ kiểm qua DB trực tiếp).

Gate Decision: FAIL
