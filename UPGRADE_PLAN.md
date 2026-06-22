# E-Connect Upgrade Plan

Thứ tự ưu tiên: **Technical Debt → Webapp Features → Polishing UX**

---

## Phase 1 — Technical Debt

### TASK-T1: Tách `api.py` thành các router module riêng biệt

**Mô tả:**  
`server/app/api.py` hiện tại có ~6600 dòng chứa 99 endpoints. Tách thành các module theo domain để dễ maintain, test, và onboard. Mỗi router được mount lại vào `api.py` như một aggregator mỏng — URL không thay đổi.

**Các bước thực hiện:**
1. Tạo thư mục `server/app/routers/`
2. Tạo từng file router, di chuyển endpoint + helper functions liên quan
3. Trong `api.py` import và `include_router()` từng module
4. Chạy `pytest tests/` sau mỗi bước để đảm bảo không vỡ

**Cấu trúc router đề xuất:**

| File | Nội dung | Ước tính |
|------|----------|----------|
| `routers/auth.py` | login, logout, refresh, users, API keys | ~400 dòng |
| `routers/devices.py` | device CRUD, commands, history, config | ~1200 dòng |
| `routers/diy.py` | DIY projects, builds, pin config, serial monitor | ~1400 dòng |
| `routers/automation.py` | automations, triggers, conditions, actions | ~900 dòng |
| `routers/extensions.py` | extension upload, install, runtime hooks | ~600 dòng |
| `routers/settings.py` | rooms, Wi-Fi creds, household, system configs | ~500 dòng |
| `routers/system.py` | logs, metrics, WebSocket, health/livez | ~600 dòng |

**Files cần thay đổi:**
- `server/app/api.py` — giữ lại làm aggregator, xoá endpoint đã di chuyển
- `server/app/routers/auth.py` — tạo mới
- `server/app/routers/devices.py` — tạo mới
- `server/app/routers/diy.py` — tạo mới
- `server/app/routers/automation.py` — tạo mới
- `server/app/routers/extensions.py` — tạo mới
- `server/app/routers/settings.py` — tạo mới
- `server/app/routers/system.py` — tạo mới
- `server/app/routers/__init__.py` — tạo mới (empty)

**Commit order:** 1 commit `[Update]` per router.

---

### TASK-T2: Unit tests cho `automation_runtime.py`

**Mô tả:**  
`server/app/services/automation_runtime.py` chứa logic graph evaluation (trigger → condition → action) nhưng không có unit test. Cần test các case: trigger match/no-match, condition chaining (AND/OR), action dispatch, edge case khi device offline.

**Files cần thay đổi:**
- `server/tests/test_automation_runtime.py` — tạo mới
- `server/app/services/automation_runtime.py` — có thể cần refactor nhỏ để inject-able (tách side-effect ra khỏi pure logic)

---

### TASK-T3: Unit tests cho `extension_runtime_loader.py`

**Mô tả:**  
Sandbox load/execute Python extension hooks chưa có test. Cần test: load valid extension, load invalid manifest, execute `validate_command`/`execute_command`/`probe_state`, isolation (exception trong extension không crash server).

**Files cần thay đổi:**
- `server/tests/test_extension_runtime.py` — tạo mới
- `server/app/services/extension_runtime_loader.py` — có thể cần thêm seam để test

---

### TASK-T4: Kiểm tra CHANGELOG được cập nhật trước mỗi push

**Mô tả:**  
Hiện tại `CHANGELOG.md` thường xuyên bị bỏ quên. Thêm check vào pre-commit hook: nếu có file trong `server/` hoặc `webapp/src/` được staged mà `CHANGELOG.md` không có trong staged files thì cảnh báo (không block, chỉ warn).

**Files cần thay đổi:**
- `.git/hooks/pre-commit` (hoặc script được gọi từ đó) — sửa
- `scripts/pre-commit-checks.sh` — nếu hook gọi script riêng

---

## Phase 2 — Webapp Features

### TASK-W1: Wi-Fi credential reveal + reconfigure

**Mô tả:**  
Panel cài đặt Wi-Fi hiện chỉ hiển thị SSID, không cho xem/sửa password. Cần:
1. Toggle hiển thị password (eye icon, không gọi API thêm — data đã có trong response nếu backend trả về)
2. Nút "Reconfigure" — gửi MQTT command `reconfigure_wifi` đến tất cả device đang dùng credential đó
3. Backend endpoint `PUT /wifi-credentials/{id}` để cập nhật password

**Files cần thay đổi:**
- `webapp/src/app/settings/WifiCredentialsPanel.tsx` — thêm eye toggle, reconfigure button
- `webapp/src/lib/api.ts` — thêm `updateWifiCredential(id, data)`
- `server/app/api.py` (→ `routers/settings.py` sau T1) — thêm `PUT /wifi-credentials/{id}`
- `server/app/sql_models.py` — kiểm tra WifiCredential model có `password` field không
- `server/app/models.py` — thêm `WifiCredentialUpdate` Pydantic model nếu thiếu

---

### TASK-W2: Automation execution log

**Mô tả:**  
Trang automation hiện không hiển thị lịch sử "lần cuối chạy / kết quả". Cần:
1. Thêm bảng `automation_executions` vào DB: `(id, automation_id, triggered_at, trigger_kind, result, action_output, error_message)`
2. Backend ghi log mỗi khi `automation_runtime.py` fire một automation
3. Endpoint `GET /automations/{id}/executions?limit=50`
4. Tab "Logs" trong trang automation detail

**Files cần thay đổi:**
- `server/app/sql_models.py` — thêm model `AutomationExecution`
- `server/app/models.py` — thêm Pydantic schemas
- `server/app/services/automation_runtime.py` — ghi record sau mỗi execution
- `server/app/api.py` (→ `routers/automation.py`) — thêm endpoint GET executions
- `webapp/src/app/automation/[id]/page.tsx` — thêm tab "Logs"
- `webapp/src/app/automation/[id]/LogsTab.tsx` — tạo mới, hiển thị execution history
- `webapp/src/lib/api.ts` — thêm `getAutomationExecutions(id)`

---

### TASK-W3: Fleet OTA — cập nhật firmware hàng loạt

**Mô tả:**  
Hiện chỉ có OTA per-device. Cần UI để chọn nhiều device theo version firmware rồi push update cùng lúc. Backend cần batch endpoint; frontend hiển thị progress per-device.

**Files cần thay đổi:**
- `webapp/src/app/devices/page.tsx` — thêm "Fleet OTA" button, device multi-select, progress tracking
- `webapp/src/lib/api.ts` — thêm `batchOTA(deviceIds[], firmwareUrl)`
- `server/app/api.py` (→ `routers/devices.py`) — thêm `POST /devices/ota/batch`
- `server/app/services/mqtt.py` — nếu cần batch MQTT dispatch

---

### TASK-W4: Bắt buộc chọn home location trong setup wizard

**Mô tả:**  
Weather widget phụ thuộc vào home location nhưng hiện tại location picker là optional và nằm sâu trong settings. Sửa setup wizard để bước cuối bắt buộc chọn location (có thể skip với confirmation rõ ràng).

**Files cần thay đổi:**
- `webapp/src/app/setup/page.tsx` — thêm Step "Home Location" trước bước hoàn thành
- `webapp/src/components/HomeLocationPicker.tsx` — kiểm tra, có thể cần thêm prop `required`
- `webapp/src/lib/api.ts` — đảm bảo `saveHomeLocation` được gọi trong setup flow

---

### TASK-W5: Error recovery UX — toast + retry cho lỗi command

**Mô tả:**  
Khi device command thất bại (timeout, rate limited, offline), hiện tại không có feedback rõ ràng. Cần:
1. Toast hiển thị lỗi + nút "Retry"
2. Build failure trong DIY page có nút "Retry Build" rõ ràng
3. Device offline badge trên card

**Files cần thay đổi:**
- `webapp/src/components/DeviceCard.tsx` — xử lý error response, hiện offline badge
- `webapp/src/app/devices/diy/page.tsx` — thêm "Retry Build" CTA khi build fail
- `webapp/src/components/ToastProvider.tsx` (hoặc tương đương) — thêm toast variant "error-with-retry"
- `webapp/src/lib/api.ts` — đảm bảo 4xx/5xx throws với message rõ ràng

---

## Phase 3 — Polishing UX

### TASK-U1: Dashboard card ordering + ẩn/hiện

**Mô tả:**  
Dashboard hiện group by room/area, không cho drag-and-drop hay ẩn card. Cần:
1. Backend: bảng `dashboard_layout` `(user_id, device_id, position, visible)`
2. Frontend: drag-and-drop với `@dnd-kit/core`, save order khi drop
3. Toggle "Hide from dashboard" per card (right-click menu hoặc edit mode)

**Files cần thay đổi:**
- `server/app/sql_models.py` — thêm `DashboardLayout` model
- `server/app/models.py` — thêm schemas
- `server/app/api.py` (→ `routers/settings.py`) — `GET/PUT /dashboard-layout`
- `webapp/src/app/page.tsx` — tích hợp dnd-kit, load/save layout
- `webapp/src/components/DeviceCard.tsx` — thêm drag handle, hide option
- `webapp/package.json` — thêm `@dnd-kit/core`, `@dnd-kit/sortable`

---

### TASK-U2: Onboarding wizard cải thiện

**Mô tả:**  
Wizard hiện dừng sau khi tạo household. Sau setup, user bị bỏ lại màn hình trống không biết làm gì tiếp. Thêm bước hướng dẫn "Add your first device" với QR code / pairing link.

**Files cần thay đổi:**
- `webapp/src/app/setup/page.tsx` — thêm success step với next-steps guide
- `webapp/src/app/devices/discovery/page.tsx` — kiểm tra, có thể deeplink từ setup
- `webapp/src/components/PairingGuide.tsx` — tạo mới (QR + manual pairing steps)

---

### TASK-U3: PWA manifest + offline shell

**Mô tả:**  
Thêm Web App Manifest và service worker cơ bản để app có thể "Add to home screen" trên mobile. Shell (layout, nav) load offline; nội dung dynamic hiển thị "Server not reachable" khi offline thay vì trang trắng.

**Files cần thay đổi:**
- `webapp/public/manifest.json` — tạo mới
- `webapp/public/icons/` — thêm icon 192x192, 512x512
- `webapp/src/app/layout.tsx` — thêm `<link rel="manifest">` meta
- `webapp/public/sw.js` — service worker với cache strategy cho shell
- `webapp/src/app/offline/page.tsx` — tạo mới, fallback page

---

### TASK-U4: Push notification cho automation event + device offline

**Mô tả:**  
Khi automation fire hoặc device đi offline, hiện không có notification nào nếu user đang ở trang khác trong app. Cần:
1. Component subscriber WebSocket event lắng nghe `automation_fired` và `device_offline`
2. Hiển thị toast notification với link đến automation/device liên quan
3. (Optional) Browser Notification API nếu user grant permission

**Files cần thay đổi:**
- `webapp/src/components/AutomationEventListener.tsx` — tạo mới
- `webapp/src/app/layout.tsx` — mount `AutomationEventListener`
- `webapp/src/components/ToastProvider.tsx` — thêm navigation toast (toast có link)
- `server/app/services/ws_manager.py` — kiểm tra đã broadcast `automation_fired` event chưa, thêm nếu thiếu
- `server/app/services/automation_runtime.py` — emit WS event sau execution (liên quan TASK-W2)

---

## Dependency Map

```
T1 (router split) ──► T2, T3 dễ hơn sau khi split
T2 ──────────────────► W2 (cần automation_runtime có seam để test)
W2 ──────────────────► U4 (automation event WS cần W2's execution record)
W4 ──────────────────► (tốt hơn nếu làm trước U3 — PWA cần đúng location)
T1 → W1 → W2 → W3 → W4 → W5 → U1 → U2 → U3 → U4
```

## Summary

| Phase | Tasks | Độ phức tạp |
|-------|-------|-------------|
| Technical Debt | T1, T2, T3, T4 | T1 cao, T2-T4 trung bình |
| Webapp Features | W1, W2, W3, W4, W5 | W2, W3 cao; W1, W4, W5 trung bình |
| Polishing UX | U1, U2, U3, U4 | U1, U4 cao; U2, U3 thấp |
