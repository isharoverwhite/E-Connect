# Product Requirements Document (PRD)

## E-Connect - Waterfall Delivery Baseline

**Version:** 2.0 (Waterfall Baseline)  
**Status:** Active / Execution  
**Owner:** Product + Project Management  
**Last Updated:** 2026-03-31
**Primary Consumers:** Product Owner, Project Manager, Antigravity (Coder + Tester)

---

## 1. Mục tiêu tài liệu

PRD này là bản **thực thi theo mô hình Waterfall** cho E-Connect, nhằm:

- khóa phạm vi (scope baseline) để tránh phát sinh không kiểm soát
- xác định rõ từng phase, gate, deliverable, tiêu chí nghiệm thu
- chuyển requirement thành các work package để Antigravity biết chính xác phải làm gì
- tạo cơ sở trace từ requirement -> code -> test -> evidence

PRD này thay thế cách viết thiên về mô tả sản phẩm chung bằng cách ưu tiên **quản lý thực thi dự án**.

---

## 2. Tóm tắt sản phẩm

E-Connect là nền tảng smart home **self-hosted, local-first** tập trung vào:

- dashboard điều khiển thiết bị trong LAN
- onboarding và quản lý thiết bị DIY ESP32/ESP8266
- no-code SVG pin mapping, server-side firmware build artifact generation, web flash, serial debug
- MQTT-first device transport
- automation local và lưu trữ dữ liệu cục bộ
- bảo mật theo cơ chế approval + role-based access
- một control server duy nhất có thể provision và quản lý thiết bị trên nhiều mạng Wi-Fi đã được admin lưu trước

### 2.1 Product Principles (Không được vi phạm)

1. **Local-first:** mất Internet không làm chết core LAN control.
2. **Secure-by-default:** thiết bị mới luôn ở trạng thái pending, phải approve.
3. **Durable state:** trạng thái quan trọng phải lưu bền vững (DB/file), không chỉ ở UI memory.
4. **No fake interactivity:** UI chỉ hiển thị trạng thái có backend/persistence thật.
5. **Traceable lifecycle:** device/automation/build/flash phải có state transition rõ ràng.

## 2.2 Temporary QA Exception (Hiệu lực từ 2026-03-13)

- Để phục vụ kiểm thử ngắn hạn cho FR-08, hệ thống tạm thời seed một tài khoản admin cố định:
  - `username`: `ryzen30xx`
  - `password`: `[REDACTED_PASSWORD]`
- Tài khoản này phải ở trạng thái `approved`, xuất hiện trong cùng household đang hoạt động, và dùng được để kiểm thử menu quản lý người dùng trong `Settings`.
- `Settings` phải cung cấp menu quản lý user cho admin, bao gồm `create`, `approve`, và `revoke` user với trạng thái bền vững ở backend.
- Đây là ngoại lệ tạm thời so với tinh thần của `NFR-05` về hardcoded production secrets, chỉ chấp nhận cho môi trường local/dev hiện tại và phải được gỡ trước release production.

## 2.3 Deployment Topology Baseline

1. E-Connect vẫn là sản phẩm `self-hosted, local-first` cho phần vận hành tại nhà người dùng, với stack self-hosted gồm `server`, `webapp`, `mqtt`, và `db`.
2. `E-Connect Web Assistant`, còn gọi là `find_website`, là cổng discovery public do nhà phát triển vận hành và không thuộc stack self-hosted thông thường của người dùng.
3. Sau khi người dùng setup xong server tại nhà, họ mở [find.isharoverwhite.com](https://find.isharoverwhite.com) từ một thiết bị nằm cùng LAN để tìm instance E-Connect mà họ vừa self-host.
4. Discovery trong flow này được thực hiện bởi browser của người dùng trên LAN của họ; hạ tầng public của nhà phát triển chỉ host UI/entrypoint discovery và không trực tiếp scan mạng nội bộ của người dùng.

---

## 3. Scope Baseline

## 3.1 In-Scope cho MVP (Release R1)

1. Bootstrap instance + tạo admin đầu tiên + household ownership.
2. Auth/login JWT + endpoint role-aware cơ bản.
3. Device handshake, pending authorization, approve/reject.
4. MQTT command publish và state ingest (history + last_seen/online status).
5. Dashboard runtime hiển thị/điều khiển thiết bị approved.
6. Dashboard Builder có khả năng chỉnh layout và persist JSON (bắt buộc cho MVP).
7. DIY builder: chọn board, map GPIO bằng SVG, validate conflict/capability.
8. DIY config phải có persistence server-side (không chỉ localStorage).
9. Server nhận config từ WebUI, build firmware `.bin` server-side, trả artifact/log về WebUI để flash (web flasher path) + block build/flash khi config invalid.
10. Automation CRUD local + execution log tối thiểu (không placeholder-only).
11. Admin quản lý danh sách Wi-Fi credentials dùng chung cho thiết bị; DIY builder và managed-device reconfiguration chọn mạng từ danh sách đó thay vì nhập tay mỗi lần.

## 3.2 Post-MVP (R2+)

1. OTA orchestration đầy đủ theo device fleet.
2. Reporting/export nâng cao.
3. Python extension runtime sandbox đầy đủ.
4. Zigbee production integration.
5. Device migration nâng cao.

## 3.3 Out of Scope cho R1

1. Public cloud multi-tenant SaaS.
2. Plugin marketplace công khai hoàn chỉnh.
3. Voice assistant production integration.
4. Native mobile production parity.
5. Deploy `find_website` như một thành phần bắt buộc trên home server của người dùng thay vì giữ nó ở hạ tầng do nhà phát triển kiểm soát.

---

## 4. Stakeholders và trách nhiệm

| Role | Trách nhiệm chính |
|---|---|
| Product Owner | Phê duyệt scope, acceptance, change request |
| PM/Planner | Lập kế hoạch Waterfall, phase gate, phân rã task, theo dõi tiến độ |
| Antigravity - Coder | Đọc bối cảnh, implement theo work package, cung cấp bằng chứng kỹ thuật |
| Antigravity - Tester | Kiểm thử độc lập theo test plan, xác nhận pass/fail + defect evidence |
| Reviewer (Tech Lead/PM) | Quyết định gate pass/fail theo exit criteria |

---

## 5. Mô hình Waterfall áp dụng cho E-Connect

## 5.1 Phase Model

| Phase | Tên | Mục tiêu | Output bắt buộc |
|---|---|---|---|
| P1 | Requirements Baseline | Khóa requirement, scope, RTM | PRD v2.0, scope baseline, risk log |
| P2 | Architecture & Design Baseline | Khóa API/data/state model | Design spec, DB contract, state transitions |
| P3 | Implementation | Build theo work package | Code + migration + tests + docs |
| P4 | Integration & System Verification | Test end-to-end theo flow | Test report, defect log, retest evidence |
| P5 | Release Readiness | UAT + go/no-go | Release checklist, known issues, sign-off |

## 5.2 Gate Criteria (Không đạt thì không qua phase)

| Gate | Entry | Exit bắt buộc |
|---|---|---|
| G1 (sau P1) | Draft requirements | FR/NFR freeze, MVP in/out rõ ràng, RTM baseline |
| G2 (sau P2) | Approved requirements | API contract + DB contract + lifecycle diagram approved |
| G3 (sau P3) | Design approved | Tất cả work package P3 có code + unit/integration test pass |
| G4 (sau P4) | Build deployable | E2E pass theo acceptance; defect critical = 0 |
| G5 (sau P5) | UAT completed | Go-live sign-off + rollback plan + known risk list |

---

## 6. Functional Requirements (FR)

> Giữ ID FR để trace xuyên suốt toàn dự án.

| ID | Requirement | Priority | Target Phase |
|---|---|---|---|
| FR-01 | Dashboard builder hỗ trợ bố cục kéo-thả dạng grid | Must | P3/P4 |
| FR-02 | Layout dashboard persist bằng JSON và render lại nhất quán | Must | P3/P4 |
| FR-03 | Quản lý thiết bị DIY + extensible device integration model | Must | P3/P4 |
| FR-04 | Python extension framework theo metadata JSON | Should | Post-MVP |
| FR-05 | Automation local có script editor + lưu bền vững | Must | P3/P4 |
| FR-06 | Lưu trữ dữ liệu vận hành cục bộ | Must | P3 |
| FR-07 | Offline LAN control vẫn hoạt động khi mất Internet | Must | P4 |
| FR-08 | User/household management có role-based access | Must | P3/P4 |
| FR-09 | OTA firmware management theo identity/version | Should | Post-MVP |
| FR-10 | Chart + export CSV/Excel từ UI | Should | Post-MVP |
| FR-11 | MQTT-first connectivity | Must | P3/P4 |
| FR-12 | Master-slave HA topology | Could | Long-term |
| FR-13 | TLS/SSL cho inter-server sync | Could | Long-term |
| FR-14 | No-code firmware generation flow cho DIY qua server-side build pipeline | Must | P3/P4 |
| FR-15 | SVG interactive pin mapping (không dùng static img) | Must | P3/P4 |
| FR-16 | Block build/flash khi GPIO conflict/invalid | Must | P3/P4 |
| FR-17 | Device identity UUID bền vững | Must | P3/P4 |
| FR-18 | Auto widget provisioning từ capability sau approval | Must | P3/P4 |
| FR-19 | DIY backup/restore definition | Should | Post-MVP |
| FR-20 | Simulator mode cho dashboard/device logic | Could | Post-MVP |
| FR-21 | Voice integration | Could | Long-term |
| FR-22 | Browser serial terminal | Must (MVP+) | P3/P4 |
| FR-23 | Serial/flash coordination tránh tranh chấp cổng | Must (MVP+) | P3/P4 |
| FR-24 | Arduino/C++ library integration | Should | Post-MVP |
| FR-25 | Captive portal provisioning | Should | Post-MVP |
| FR-26 | Dynamic pin mapping runtime từ server | Should | Post-MVP |
| FR-27 | Device discovery + explicit authorization | Must | P3/P4 |
| FR-28 | Heartbeat, offline detection, reconnect | Must | P3/P4 |
| FR-29 | Device migration khi thay board | Could | Long-term |
| FR-30 | Server phải build firmware `.bin` từ config WebUI và cung cấp artifact/log để WebUI flash | Must | P3/P4 |
| FR-31 | Một control server có thể lưu nhiều Wi-Fi credential và cho admin chọn mạng cho từng DIY config / managed device | Must | P3/P4 |

---

## 7. Non-Functional Requirements (NFR)

| ID | Requirement | Target |
|---|---|---|
| NFR-01 | Device registration success rate | > 99% |
| NFR-02 | Device control success rate | > 95% |
| NFR-03 | Time-to-first-working-DIY-device | < 15 phút |
| NFR-04 | Dashboard save/load consistency | 100% schema-compatible |
| NFR-05 | Security | No hardcoded production secrets, approval-based onboarding bắt buộc, Wi-Fi credential reveal phải có password confirmation của tài khoản đang đăng nhập |
| NFR-06 | Reliability | Retry-safe, idempotent cho endpoint dễ bị retry |
| NFR-07 | Usability | Có loading/empty/error/success state cho flow chính |
| NFR-08 | Maintainability | Module hóa theo domain, traceable logs |

---

## 8. System Lifecycle bắt buộc

### 8.1 Device lifecycle

`draft -> flashed -> discovered -> pending authorization -> approved -> online/offline -> recovered/migrated`

### 8.2 Automation lifecycle

`draft -> validated -> enabled -> triggered -> running -> succeeded/failed -> disabled`

### 8.3 Dashboard widget lifecycle

`unbound -> bound -> active -> degraded (device offline) -> remap required`

### 8.4 Build/flash lifecycle

`draft_config -> validated -> queued -> building -> artifact_ready -> flashing -> flashed/build_failed/flash_failed/cancelled`

---

## 9. Waterfall Work Breakdown Structure (WBS)

## 9.1 Work Packages cho Antigravity

### WP-01: Bootstrap + Auth + Household Foundation

**Mục tiêu:** hệ thống khởi tạo an toàn, chặn re-initialize, login usable.

**Coder phải làm:**
1. Chuẩn hóa setup status/read path và setup command idempotent.
2. Đảm bảo first admin + household + owner membership tạo atomically.
3. Trả lỗi machine-actionable cho validation/conflict/unexpected.
4. Bỏ hardcoded secret trong auth path.

**Tester phải verify:**
1. Uninitialized -> `/setup`, initialized -> `/login`/dashboard.
2. Submit setup hợp lệ thành công, submit lần 2 bị block.
3. DB có đúng `users`, `households`, `household_memberships` shape.
4. Console/network không lỗi nghiêm trọng.

**Deliverables:** code + API contract + DB evidence + browser report.

---

### WP-02: Device Discovery, Approval, Identity

**Mục tiêu:** device mới luôn pending và chỉ managed sau approve.

**Coder phải làm:**
1. Hoàn thiện handshake path (`/config`) với UUID durability.
2. Approval/reject idempotent, role-guard đúng.
3. Capability/pin mapping persist chuẩn.
4. Device list/read model phản ánh auth + online status đúng.

**Tester phải verify:**
1. Device mới vào pending.
2. Approve -> managed; reject -> không được control.
3. DB check: `devices`, `pin_configurations`, `device_history`.
4. Failure path: approve device không tồn tại, unauthorized access.

---

### WP-03: MQTT Transport Vertical Slice

**Mục tiêu:** control/state loop chạy qua MQTT path thật.

**Coder phải làm:**
1. Publish command theo topic namespace chuẩn.
2. Ingest state từ MQTT subscriber và cập nhật history/last_seen.
3. Tách event_type `command_requested`/`command_failed` rõ ràng.
4. Không để UI optimistic giả khi publish fail.

**Tester phải verify:**
1. Dashboard action -> API -> MQTT publish -> device/state record.
2. Broker failure path trả lỗi rõ + UI phản ánh fail.
3. DB check `device_history` event_type và payload.

---

### WP-04: Dashboard Builder + Persisted Layout

**Mục tiêu:** FR-01/FR-02 hoàn chỉnh, không còn dashboard-only runtime.

**Coder phải làm:**
1. Thêm/bổ sung grid builder tương tác thật.
2. Persist layout JSON versioned.
3. Bind widget với capability thật từ approved devices.
4. Reload vẫn giữ layout/binding.

**Tester phải verify:**
1. Drag/drop/save/reload pass.
2. Widget không bind nguồn hợp lệ phải báo lỗi.
3. DB check layout record trước/sau chỉnh sửa.

---

### WP-05: DIY SVG Builder + Server-side Draft Persistence

**Mục tiêu:** DIY flow không phụ thuộc localStorage-only.

**Coder phải làm:**
1. Persist draft/project config vào DB (`diy_projects` hoặc equivalent).
2. Liên kết mỗi DIY project với đúng một Wi-Fi credential đã được admin quản lý thay vì chỉ giữ SSID/password ad hoc trong local draft.
3. Đồng bộ trạng thái pin mapping + selected Wi-Fi credential với server read/write.
4. Validation conflict/capability/reserved pin ở cả UI + backend boundary.
5. Block flash/build command nếu config invalid hoặc chưa chọn Wi-Fi credential hợp lệ.

**Tester phải verify:**
1. Map pin hợp lệ/lỗi I2C/lỗi boot-sensitive warning.
2. Refresh/browser restart vẫn giữ project state từ DB.
3. Chỉ admin mới CRUD Wi-Fi credentials; danh sách credential hiển thị dạng masked list trong Settings.
4. Reveal password yêu cầu đúng mật khẩu của tài khoản đang đăng nhập.
5. DB check project/config JSON shape + `wifi_credential_id` link đúng.

---

### WP-06: Build/Flash + Serial Coordination

**Mục tiêu:** flash path usable và không tranh chấp serial.

**Coder phải làm:**
1. Nhận config DIY từ WebUI và tạo build job server-side có state observable.
2. Build firmware `.bin` từ config hợp lệ, lưu artifact/log bền vững, và cung cấp endpoint/URL để WebUI lấy artifact phục vụ flash.
3. Chặn build khi config invalid và chặn flash khi serial session đang chiếm port hoặc artifact chưa sẵn sàng.
4. Ghi lại status/log tối thiểu cho retry và điều tra lỗi.

**Tester phải verify:**
1. Happy path: WebUI gửi config -> server build `.bin` -> artifact/log trả về cho WebUI -> flash handoff thành công.
2. Failure path: config invalid hoặc build fail -> trả lỗi machine-actionable và không có artifact để flash.
3. Failure path: serial đang mở -> flash bị block có thông báo rõ.
4. Job state + artifact metadata được lưu và đọc lại được.

---

### WP-07: Automation Minimum Executable Slice

**Mục tiêu:** automation không còn chỉ placeholder update timestamp.

**Coder phải làm:**
1. Lưu definition + enabled/disabled state rõ ràng.
2. Có execution log/status (succeeded/failed).
3. Cho phép trigger test path tạo log thật.

**Tester phải verify:**
1. Create/enable/trigger automation có execution record.
2. Failure script/action có log lỗi quan sát được.
3. DB check `automations` + execution log table/shape.

---

### WP-08: Wi-Fi Credential Vault + Network Selection

**Mục tiêu:** một server duy nhất có thể quản lý nhiều mạng Wi-Fi cho device provisioning và reconfiguration mà vẫn giữ role guard + password confirmation.

**Coder phải làm:**
1. Thêm bảng lưu `SSID`/`password` theo household và chỉ cho admin CRUD.
2. Thêm menu trong `Settings` để list/create/update/delete credential; password luôn masked ở danh sách.
3. Thêm flow reveal password yêu cầu nhập lại password của tài khoản đang đăng nhập trước khi backend trả secret.
4. Cho DIY builder và managed-device reconfiguration chọn Wi-Fi credential đã lưu trước khi build/rebuild firmware.

**Tester phải verify:**
1. Admin CRUD credential thành công; non-admin không thấy menu và bị chặn ở API.
2. Reveal password sai hoặc thiếu account password bị reject và không lộ secret.
3. DIY builder chọn credential rồi build firmware thành công với credential đã chọn.
4. Managed-device reconfiguration đổi Wi-Fi credential rồi rebuild/OTA flow vẫn giữ behavior đúng.

---

## 10. Requirement Traceability Matrix (RTM)

| FR | UI Surface | API Surface | Persistence | Test Evidence |
|---|---|---|---|---|
| FR-01/02 | `/` + dashboard builder screen | `PUT /users/me/layout` (hoặc new endpoint) | `users.ui_layout` (hoặc dedicated table) | drag/drop + reload + DB query |
| FR-14/15/16/30 | `/devices/diy` | `POST /diy/config/generate`, `POST /diy/build`, `GET /diy/build/{job_id}`, `GET /diy/build/{job_id}/artifact` + draft endpoints | `diy_projects`, `build_jobs` + pin config + artifact storage | validation pass/fail + build artifact/log evidence + DB query |
| FR-17/27 | `/devices/discovery` | `POST /config`, `POST /device/{id}/approve` | `devices`, `household_memberships` | pending->approved flow |
| FR-11/28 | dashboard runtime controls | `POST /device/{id}/command` + MQTT consumer | `device_history`, `devices.last_seen` | command/state E2E |
| FR-05 | `/automation` | `/automation`, `/automations`, `/automation/{id}/trigger` | `automations` + execution logs | create/trigger/failure test |
| FR-22/23 | serial/flash screens | serial & flash session endpoints | flash/serial session records | conflict block test |
| FR-31 | `/settings`, `/devices/diy`, `/devices/[id]/config` | `/wifi-credentials`, `/wifi-credentials/{id}/reveal`, project/device config update endpoints | `wifi_credentials`, `diy_projects.wifi_credential_id` | admin CRUD + reveal auth + build/rebuild evidence |

---

## 11. Baseline Data Contract

### 11.1 Bảng dữ liệu lõi (MVP)

1. `users`
2. `households`
3. `household_memberships`
4. `devices`
5. `pin_configurations`
6. `device_history`
7. `automations`
8. `diy_projects` (bắt buộc dùng nếu DIY persistence đã có)
9. `wifi_credentials` (bắt buộc nếu một server phải quản lý nhiều mạng Wi-Fi cho device provisioning)
10. `rooms` (nếu dùng)
11. `build_jobs` (bắt buộc nếu server-side build được claim complete)

### 11.2 Quy tắc dữ liệu bắt buộc

1. Không assume enum/table/column khi chưa inspect DB thật.
2. Task chạm persistence phải có DB verification **before + after**.
3. Mọi state transition quan trọng phải observable qua record/log.
4. Artifact `.bin` và build log phải traceable qua DB record và durable file storage/volume.
5. Plaintext Wi-Fi password không được xuất hiện trong list/read model thông thường; chỉ flow reveal đã xác thực lại password mới được trả secret ra ngoài.

---

## 12. API Contract Baseline (MVP)

### 12.1 Core Read Paths

1. `GET /api/v1/system/status`
2. `GET /api/v1/users/me`
3. `GET /api/v1/devices`
4. `GET /api/v1/automations`
5. `GET /api/v1/device/{device_id}/history`
6. `GET /api/v1/diy/build/{job_id}`
7. `GET /api/v1/diy/build/{job_id}/artifact`

### 12.2 Core Command Paths

1. `POST /api/v1/auth/initialserver`
2. `POST /api/v1/auth/token`
3. `POST /api/v1/config` (device handshake)
4. `POST /api/v1/device/{device_id}/approve|reject`
5. `POST /api/v1/device/{device_id}/command`
6. `POST /api/v1/diy/config/generate`
7. `POST /api/v1/diy/build`
8. `POST /api/v1/automation` + `POST /api/v1/automation/{id}/trigger`

### 12.3 API Rules

1. Validation ở boundary bắt buộc.
2. Lỗi trả về phải phân biệt rõ `validation` vs `conflict` vs `server`.
3. Endpoint dễ retry phải idempotent hoặc retry-safe.
4. Build endpoint phải trả về job status, artifact reference, build log reference rõ ràng; không được cho flash khi artifact chưa ở trạng thái `artifact_ready`.

---

## 13. Verification Strategy (Waterfall)

## 13.1 Test levels

1. **Unit test:** logic/service nhỏ.
2. **Integration test:** API + DB + MQTT adapter.
3. **UI/browser test:** flow thực tế, console/network checks.
4. **System test:** vertical slice end-to-end.
5. **Hardware-assisted test (nếu có):** ESP32 handshake/command/state.

## 13.2 Minimum evidence để close 1 work package

1. Danh sách file đã đổi.
2. Kết quả lint/typecheck/test commands.
3. DB query before/after.
4. Browser flow happy + 1 failure path.
5. Residual risk còn lại.
6. Với flow build/flash: phải có evidence của build job, artifact `.bin`, build log, và flash handoff/block behavior.

---

## 14. Definition of Done (DoD)

Một task chỉ được coi là done khi tất cả điều kiện đúng:

1. Đã đọc code path liên quan trước khi sửa.
2. Hành vi sau sửa khớp FR trong PRD.
3. Nếu chạm UI: đã verify browser + console + network.
4. Nếu chạm data: đã verify DB before/after.
5. Có xử lý trạng thái loading/empty/error/success phù hợp scope.
6. Có evidence rõ ràng (không dùng kết luận "should work").
7. Nếu claim build/flash hoàn chỉnh: phải verify được server-side build artifact + job/log state + WebUI handoff/block path.

---

## 15. Antigravity Execution Rules (Bắt buộc)

## 15.1 Coder Checklist

1. Restate objective + phạm vi trước khi code.
2. Chọn **smallest correct change set**.
3. Không để placeholder/fake interactivity trên flow được claim hoàn thành.
4. Không hardcode secrets.
5. Gắn test/evidence ngay trong cùng turn triển khai.

## 15.2 Tester Checklist

1. Test độc lập theo acceptance, không copy nhận định của Coder.
2. Bắt buộc có 1 failure path ngoài happy path.
3. Verify DB shape và row impact với task chạm persistence.
4. Báo cáo defect theo mức độ: Critical/High/Medium/Low.

## 15.3 Format báo cáo bắt buộc cho mỗi task

```md
Task ID:
Objective:
Scope In/Out:
Changed Files:
Verification:
- Lint/Typecheck:
- Backend tests:
- Browser flow:
- DB before/after:
Defects Found:
Residual Risk:
Gate Decision: PASS / FAIL
```

---

## 16. Phase Planning & Milestones

## 16.1 Milestone đề xuất cho MVP R1

1. **M1 - Foundation Stable:** WP-01 + WP-02 pass G3.
2. **M2 - Transport Stable:** WP-03 pass integration + failure path.
3. **M3 - Builder Usable:** WP-04 + WP-05 pass end-to-end persistence checks.
4. **M4 - Operational MVP:** WP-06 + WP-07 pass with evidence.
5. **M5 - Release Readiness:** full regression + risk sign-off.

## 16.2 Không được tuyên bố "MVP complete" nếu còn bất kỳ điều nào

1. Dashboard Builder chưa có persist JSON thật.
2. DIY config chỉ lưu localStorage, không có server-side durability.
3. Device approve xong nhưng không traceable capability/binding.
4. MQTT path chưa có failure handling rõ.
5. Automation trigger vẫn chỉ placeholder không có execution log.
6. Server chưa build được firmware `.bin` từ config WebUI hoặc chưa trả artifact/log cho WebUI flash.

---

## 17. Risks & Mitigation

| Risk | Impact | Mitigation |
|---|---|---|
| Scope creep trong P3 | Trễ milestone | Freeze scope theo FR + CR process |
| Lệch env (SQLite vs MariaDB) | Sai behavior production | Chuẩn hóa env matrix + mandatory DB verification |
| UI đẹp nhưng không có state thật | Demo-only, không release được | No fake interactivity rule + RTM checks |
| MQTT broker phụ thuộc public | Không ổn định test | Local broker profile + namespace isolation |
| Hardcoded secrets | Bảo mật | Secret policy + pre-release audit |

---

## 18. Change Control (CR)

Mọi thay đổi ngoài scope baseline phải đi qua CR:

1. CR ID + mô tả thay đổi
2. ảnh hưởng FR/NFR nào
3. ảnh hưởng timeline/gate nào
4. quyết định Approve/Reject bởi Product + PM

Không được tự ý mở rộng scope trong phase Implementation khi chưa approved.

---

## 19. Open Questions (để chốt trước G2/G3)

1. Dashboard layout sẽ tiếp tục lưu ở `users.ui_layout` hay tách bảng dedicated?
2. `diy_projects` có trở thành source-of-truth chính cho builder không?
3. Automation execution runtime tối thiểu dùng worker nào trong R1?
4. Serial/flash coordination API contract chuẩn hóa ra sao?
5. Mức độ hỗ trợ board chính thức cho R1 là danh sách nào?

---

## 20. Kết luận điều hành

PRD v2.0 này là baseline để điều phối Antigravity theo Waterfall:

- requirement rõ -> work package rõ -> gate rõ -> evidence rõ
- không cho phép trạng thái "gần xong" hoặc "UI đã có nhưng backend chưa"
- mọi tuyên bố hoàn thành phải đi kèm bằng chứng kỹ thuật và kiểm thử độc lập

**Nguyên tắc vận hành:** *Không evidence, không complete.*
