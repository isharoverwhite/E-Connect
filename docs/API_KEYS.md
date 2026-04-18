# E-Connect API Key User Guide

## 1. Mục đích

Tài liệu này hướng dẫn người dùng cuối sử dụng **API key được tạo từ WebUI** để:

- gọi trực tiếp backend REST API của E-Connect
- đọc dữ liệu thiết bị, dashboard, automation và trạng thái hệ thống
- gửi lệnh điều khiển thiết bị trong phạm vi quyền được cấp
- hiểu rõ key này **làm được gì**, **không làm được gì**, và **nên đặt tên như thế nào**

## 2. API Key này thực chất là gì

- API key được tạo trong `WebUI -> Settings -> API Keys`
- API key này là **server-side bearer credential**
- key dùng trực tiếp với backend tại `http://<server>:8000/api/v1`
- key **kế thừa đúng quyền của user tạo key**
- revoke key ở backend hoặc WebUI sẽ làm key đó mất hiệu lực ngay
- plain-text API key chỉ nên coi là **hiện ra một lần**, cần lưu ngay khi tạo

## 3. Lưu ý quan trọng về `description`

Hiện tại E-Connect **chưa có field `description` riêng cho API key**. Backend chỉ nhận:

```json
{
  "label": "Your descriptive key name"
}
```

Vì vậy:

1. hãy dùng `label` như một **mô tả ngắn có cấu trúc**
2. nếu cần mô tả dài hơn, lưu ở password manager, vault, wiki, hoặc bảng quản lý key nội bộ

### Quy ước đặt `label` khuyến nghị

Format đề xuất:

```text
[Role] [Client] [Scope] | [Function]
```

Ví dụ:

- `Admin MacBook Pro | Full backend read + device control`
- `Member iPhone Living Room | Read dashboard + control allowed devices`
- `Admin NAS Monitor | System live-status + logs`
- `Admin Home Assistant Bridge | Device read + selected control`
- `Automation Runner MiniPC | Read automations + trigger rules`

### Mẫu `description` gợi ý để lưu ngoài hệ thống

| Label đề xuất | Description gợi ý |
|---|---|
| `Admin MacBook Pro \| Full backend read + device control` | Dùng cho máy MacBook của quản trị viên để đọc toàn bộ dashboard, lấy chi tiết thiết bị, gửi lệnh relay/dimmer/RGB/color temperature, và truy cập các endpoint giám sát hệ thống yêu cầu quyền admin. |
| `Member iPhone Living Room \| Read dashboard + control allowed devices` | Dùng cho tài khoản member chỉ có quyền ở phòng khách. Key chỉ đọc được danh sách thiết bị trong phạm vi room đã cấp và chỉ điều khiển được các thiết bị room đó. Không có quyền xem system logs hay live-status admin. |
| `Admin NAS Monitor \| System live-status + logs` | Dùng cho dịch vụ monitoring nội bộ để đọc `/system/live-status`, `/system/logs`, và kiểm tra tình trạng DB, MQTT, uptime, CPU, memory, storage, firmware revision mới nhất. |
| `Admin Home Assistant Bridge \| Device read + selected control` | Dùng cho integration bridge trong LAN để sync danh sách thiết bị, đọc trạng thái hiện tại, và gửi lệnh điều khiển tới một tập thiết bị được phép. Không nên dùng key này cho thao tác provisioning hoặc OTA nếu không thật sự cần. |
| `Automation Runner MiniPC \| Read automations + trigger rules` | Dùng cho máy chạy tác vụ nội bộ cần đọc danh sách automation và trigger thủ công các rule đã lưu. Chỉ nên cấp cho tài khoản biết rõ phạm vi automation cần quản lý. |

## 4. Các cổng mạng và entrypoint liên quan

| Cổng / Entry point | Protocol | Mục đích | API key dùng trực tiếp được không | Ghi chú |
|---|---|---|---|---|
| `https://<server>:3443` | HTTPS | WebUI để login, tạo/revoke API key, quản trị người dùng, dashboard | Không phải luồng bearer API key chính | Đây là nơi quản lý key, không phải nơi backend REST bearer hoạt động trực tiếp |
| `http://<server>:8000/api/v1` | HTTP REST | Backend API trực tiếp | Có | Đây là base URL chính cho `Authorization: Bearer <api_key>` |
| `ws://<server>:8000/api/v1/ws?token=...` | WebSocket | push event realtime | Không, route hiện tại kỳ vọng JWT access token | API key hiện không phải luồng chính cho WebSocket |
| MQTT broker `1883` hoặc `8883` nếu có | MQTT | server và device trao đổi command/state | Không | API key không được dùng trực tiếp để authenticate MQTT device traffic |

## 5. Cách dùng nhanh

### Bước 1: Tạo key trong WebUI

1. Mở `Settings -> API Keys`
2. Nhập `Key label`
3. Bấm tạo key
4. Sao chép `plain-text api_key` và lưu lại ngay

### Bước 2: Chuẩn bị base URL

```bash
BASE='http://192.168.2.230:8000/api/v1'
KEY='YOUR_PLAIN_TEXT_API_KEY'
```

### Bước 3: Kiểm tra identity của key

```bash
curl -s -H "Authorization: Bearer $KEY" "$BASE/users/me"
```

Nếu thành công, response sẽ cho biết key đang chạy dưới user nào.

### Bước 4: Liệt kê thiết bị mà key nhìn thấy được

```bash
curl -s -H "Authorization: Bearer $KEY" "$BASE/dashboard/devices"
```

### Bước 5: Lấy chi tiết một thiết bị trước khi điều khiển

```bash
curl -s -H "Authorization: Bearer $KEY" "$BASE/device/<device_id>"
```

Hãy đọc:

- `device_id`
- `pin_configurations`
- `last_state`
- `conn_status`
- `auth_status`
- với external light: `schema_snapshot`, `capabilities`, `last_state`

### Bước 6: Gửi lệnh điều khiển

Xem các ví dụ ở phần 8.

### Bước 7: Revoke khi không còn dùng

1. xem danh sách key:

```bash
curl -s -H "Authorization: Bearer $KEY" "$BASE/api-keys"
```

2. revoke một key:

```bash
curl -s -X POST -H "Authorization: Bearer $KEY" \
  "$BASE/api-keys/<key_id>/revoke"
```

## 6. Các profile API key khuyến nghị cho người dùng

| Profile | Nên tạo bằng user nào | Dùng cho việc gì | Endpoint chính |
|---|---|---|---|
| `Read-Only Dashboard Key` | member hoặc admin | đọc dashboard và trạng thái thiết bị trong phạm vi được cấp | `/users/me`, `/devices`, `/dashboard/devices`, `/device/{id}`, `/automations` |
| `Room Control Key` | member có room permission hoặc admin | điều khiển relay, dimmer, light trong room được phép | `/dashboard/devices`, `/device/{id}`, `/device/{id}/command` |
| `Admin Monitoring Key` | admin / owner | đọc sức khỏe hệ thống và log | `/system/live-status`, `/system/logs`, `/system/time-context` |
| `Admin Provisioning Key` | admin / owner | provisioning, cấu hình DIY, rebuild, OTA | `/device/{id}/config`, `/device/{id}/action/rebuild`, `/diy/build/*`, `/serial/*` |
| `Automation Operator Key` | user có automation liên quan | đọc/tạo/sửa/trigger automation | `/automations`, `/automation`, `/automation/{id}`, `/automation/{id}/trigger` |

## 7. Bảng endpoint REST nên public trong guide người dùng

### 7.1 Key management và identity

| Method | Endpoint | Quyền tối thiểu | Description |
|---|---|---|---|
| `GET` | `/users/me` | user có key hợp lệ | Kiểm tra key đang đại diện cho user nào và xác minh key còn sống. Đây là endpoint sanity check đầu tiên nên gọi sau khi tạo key. |
| `GET` | `/api-keys` | user có key hợp lệ | Liệt kê các API key thuộc chính user hiện tại, gồm `key_id`, `label`, `token_prefix`, `created_at`, `last_used_at`, `revoked_at`, `is_revoked`. Không trả lại plain-text key. |
| `POST` | `/api-keys` | user đã login bằng session/JWT | Tạo key mới. Hiện request chỉ nhận `label`; không có `description`. |
| `POST` | `/api-keys/{key_id}/revoke` | user sở hữu key đó | Revoke ngay một key cụ thể. Sau revoke, client dùng key đó sẽ nhận `401 Unauthorized`. |

### 7.2 Đọc dữ liệu thiết bị và dashboard

| Method | Endpoint | Quyền tối thiểu | Description |
|---|---|---|---|
| `GET` | `/devices` | user có key hợp lệ | Lấy danh sách thiết bị đã `approved` trong phạm vi nhìn thấy của key. Với member thường, dữ liệu có thể bị rút gọn để không lộ full detail ngoài room được cấp. |
| `GET` | `/devices?auth_status=pending` | admin / owner | Đọc hàng chờ pairing pending. Member thường không được xem trạng thái này. |
| `GET` | `/dashboard/devices` | user có key hợp lệ | Lấy read model đầy đủ hơn cho dashboard card, bao gồm `last_state`, `pin_configurations` và metadata cần cho điều khiển UI. Đây là endpoint phù hợp nhất để integration render bảng trạng thái thiết bị. |
| `GET` | `/device/{device_id}` | có quyền với device đó | Đọc chi tiết một thiết bị cụ thể trước khi gửi command. Nên dùng endpoint này để xác định đúng `pin`, `mode`, `function`, capability và trạng thái hiện tại. |
| `GET` | `/device/{device_id}/history` | admin / owner | Đọc 50 bản ghi history gần nhất của thiết bị. Hữu ích cho audit và export, nhưng không phải mọi key đều có quyền. |
| `GET` | `/device/{device_id}/export` | admin / owner | Xuất history CSV của thiết bị. Phù hợp cho dashboard ngoài hệ thống hoặc backup thủ công. |

### 7.3 Điều khiển thiết bị

| Method | Endpoint | Quyền tối thiểu | Description |
|---|---|---|---|
| `POST` | `/device/{device_id}/command` | có quyền control với device đó | Endpoint điều khiển chính. Với device vật lý, backend publish qua MQTT; với external device, backend gọi runtime executor. Response thường trả `status`, `command_id`, `message`, và có thể kèm `last_state` dự đoán. |
| `GET` | `/device/{device_id}/command/latest` | tùy loại device | Lấy command gần nhất trong một số flow HTTP-polled. Không phải luồng chính cho MQTT-managed DIY devices. |

### 7.4 Automation

| Method | Endpoint | Quyền tối thiểu | Description |
|---|---|---|---|
| `GET` | `/automations` | user có key hợp lệ | Liệt kê automation do user sở hữu. |
| `POST` | `/automation` | user có key hợp lệ | Tạo automation mới bằng graph payload. |
| `PUT` | `/automation/{automation_id}` | chủ sở hữu automation | Cập nhật graph, tên, trạng thái enable/disable. |
| `DELETE` | `/automation/{automation_id}` | chủ sở hữu automation | Xóa automation đã lưu. |
| `POST` | `/automation/{automation_id}/trigger` | chủ sở hữu automation | Trigger thủ công một automation dựa trên state hiện có của device. |
| `GET` | `/automation/schedule-context` | user có key hợp lệ | Lấy timezone/time-context để build schedule đúng. |

### 7.5 System monitoring

| Method | Endpoint | Quyền tối thiểu | Description |
|---|---|---|---|
| `GET` | `/system/live-status` | admin / owner | Trả trạng thái tổng thể của hệ thống: `overall_status`, DB, MQTT, uptime, CPU, RAM, storage, alert count, advertised host, firmware revision mới nhất. Đây là endpoint monitoring tốt nhất cho health dashboard trong LAN. |
| `GET` | `/system/logs` | admin / owner | Trả danh sách system logs có retention window, severity, category, event_code, message, details. Hữu ích cho NOC/admin panel hoặc audit feed. |
| `POST` | `/system/logs/{log_id}/read` | admin / owner | Đánh dấu một alert/log đã đọc. |
| `POST` | `/system/logs/mark-all-read` | admin / owner | Đánh dấu toàn bộ alert chưa đọc là đã đọc. |
| `GET` | `/system/time-context` | user có key hợp lệ | Lấy effective timezone và current server time để đồng bộ dashboard hoặc schedule UI. |

### 7.6 Provisioning, config, build, OTA

| Method | Endpoint | Quyền tối thiểu | Description |
|---|---|---|---|
| `PUT` | `/device/{device_id}/config` | admin / owner | Cập nhật config DIY device, pin mapping, Wi-Fi credential, lưu config history, và có thể queue build firmware mới. |
| `POST` | `/device/{device_id}/action/rebuild` | admin / owner | Trigger rebuild firmware từ config đã commit. |
| `GET` | `/diy/projects` | admin / owner | Liệt kê project DIY hiện có. |
| `POST` | `/diy/build` | admin / owner | Tạo build job firmware mới. |
| `GET` | `/diy/build/{job_id}` | admin / owner | Xem trạng thái build job. |
| `GET` | `/diy/build/{job_id}/artifact` | admin / owner | Tải artifact build đã sẵn sàng. |
| `GET` | `/diy/build/{job_id}/logs` | admin / owner | Lấy log build để debug. |
| `POST` | `/device/{device_id}/command` với payload OTA | admin / owner | Gửi OTA command tới thiết bị DIY đã có artifact hợp lệ. Đây là thao tác nhạy cảm, không nên cấp cho key tích hợp thông thường. |

## 8. Mẫu request thực tế

### 8.1 Kiểm tra key

```bash
curl -s -H "Authorization: Bearer $KEY" "$BASE/users/me"
```

### 8.2 Lấy danh sách device cho bảng dashboard

```bash
curl -s -H "Authorization: Bearer $KEY" "$BASE/dashboard/devices"
```

### 8.3 Relay hoặc switch device

```bash
curl -s -X POST "$BASE/device/<device_id>/command" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"kind":"action","pin":5,"value":1}'
```

### 8.4 Dimmer hoặc PWM device

```bash
curl -s -X POST "$BASE/device/<device_id>/command" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"kind":"action","pin":5,"brightness":120}'
```

### 8.5 External light on/off

```bash
curl -s -X POST "$BASE/device/<device_id>/command" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"kind":"action","pin":0,"value":1}'
```

### 8.6 External light brightness

```bash
curl -s -X POST "$BASE/device/<device_id>/command" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"kind":"action","pin":0,"brightness":191}'
```

### 8.7 External light RGB

```bash
curl -s -X POST "$BASE/device/<device_id>/command" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"kind":"action","pin":0,"rgb":{"r":255,"g":120,"b":0}}'
```

### 8.8 External light color temperature

```bash
curl -s -X POST "$BASE/device/<device_id>/command" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"kind":"action","pin":0,"color_temperature":4300}'
```

### 8.9 Monitoring dashboard

```bash
curl -s -H "Authorization: Bearer $KEY" "$BASE/system/live-status"
curl -s -H "Authorization: Bearer $KEY" "$BASE/system/logs?limit=100"
```

## 9. Điều key này không làm trực tiếp

- không phải là MQTT credential cho device
- không phải là WebSocket credential chuẩn ở route `/ws`
- không tự nâng quyền lên admin
- không nhìn thấy device ngoài room được cấp nếu key được tạo bởi member không có quyền
- không có `description` field riêng khi tạo key

## 10. Best practices cho người dùng

1. Chỉ tạo key trong LAN tin cậy.
2. Không expose backend `:8000` ra Internet nếu không có reverse proxy, TLS, auth layering và network policy rõ ràng.
3. Tạo **mỗi integration một key riêng**.
4. Đặt `label` đủ rõ để revoke đúng key khi có sự cố.
5. Với monitoring, dùng key chỉ đọc thay vì key provisioning.
6. Với OTA/config/build, chỉ dùng admin key riêng, không reuse key dashboard.
7. Luôn test bằng `/users/me` và `/dashboard/devices` trước khi gửi command.
8. Revoke ngay key khi máy trạm, điện thoại, NAS, hoặc integration không còn dùng.

## 11. Checklist publish guide cho người dùng cuối

- [x] Giải thích API key là bearer backend trực tiếp
- [x] Có bảng cổng mạng / entrypoint
- [x] Có bảng endpoint REST chính
- [x] Có mô tả rõ quyền và hạn chế
- [x] Có thay thế thực tế cho `description` bằng quy ước `label`
- [x] Có ví dụ request để đọc data và điều khiển thiết bị
