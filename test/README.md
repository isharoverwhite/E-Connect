# Fake Board Test Guide

Guide này mô tả cách dùng [fake_board_test.py](/Users/kiendinhtrung/Documents/GitHub/Final-Project/test/fake_board_test.py) để giả lập một board kết nối với server E-Connect, test pairing, discovery, remote command, heartbeat, và các failure path cơ bản.

## 1. Mục đích

Fake board dashboard hữu ích khi bạn cần:

- test flow pairing mà không cần board ESP thật
- ép một thiết bị vào discovery để kiểm tra trang `/devices/discovery`
- test remote command từ server xuống board
- test lại các case `pending`, `approved`, `re-pair`, `invalid secret`, `malformed payload`
- xem payload MQTT/HTTP cuối cùng và log hoạt động ngay trên dashboard local

## 2. Yêu cầu trước khi chạy

Tối thiểu cần:

- backend `server` đang chạy
- MQTT broker mà backend đang dùng phải chạy được nếu bạn muốn test path MQTT
- Python 3
- package `paho-mqtt` đã được cài

Kiểm tra backend nhanh:

```bash
curl http://127.0.0.1:8000/health
```

Nếu bạn muốn test MQTT path thật, namespace/broker của fake board phải khớp với backend hiện tại.

## 3. Chạy nhanh

Từ root repo:

```bash
python3 test/fake_board_test.py
```

Mặc định dashboard local sẽ mở tại:

```text
http://127.0.0.1:8765
```

Bạn cũng có thể override bằng CLI:

```bash
python3 test/fake_board_test.py \
  --server-base-url http://127.0.0.1:8000 \
  --mqtt-broker 127.0.0.1 \
  --mqtt-port 1883 \
  --mqtt-namespace local \
  --dashboard-host 127.0.0.1 \
  --dashboard-port 8765
```

Các CLI option hiện có:

- `--server-base-url`
- `--mqtt-broker`
- `--mqtt-port`
- `--mqtt-namespace`
- `--dashboard-host`
- `--dashboard-port`
- `--device-id`
- `--device-name`
- `--mac-address`

Các giá trị này cũng có thể lấy từ env:

- `FAKE_BOARD_SERVER_URL`
- `MQTT_BROKER`
- `MQTT_PORT`
- `MQTT_NAMESPACE`
- `FAKE_BOARD_DASHBOARD_HOST`
- `FAKE_BOARD_DASHBOARD_PORT`

## 4. Các khu vực chính trên dashboard

### Connection Settings

Cho phép:

- nhập `server_base_url`
- nhập MQTT broker/port/namespace
- nhập account để login server
- chọn hoặc điền `room_id` / `room_name`
- bấm `Generate Fresh Identity` để sinh `device_id` và MAC mới

### Board Identity

Cho phép chỉnh:

- `device_id`
- `mac_address`
- `device_name`
- `mode`
- `firmware_version`
- `ip_address`
- `project_id`
- `secret_key`

### Pairing Scenarios

Các nút chính:

- `Register Normal`: publish register payload qua MQTT
- `Force Re-pair`: publish MQTT register với `force_pairing_request=true`
- `Invalid Secret`: test secret sai qua MQTT
- `Malformed Register`: test payload hỏng qua MQTT
- `Register via HTTP`: ghi thiết bị vào server qua `/api/v1/config`
- `HTTP Force Re-pair`: ép device quay lại `pending` qua HTTP
- `HTTP Invalid Secret`: test secret sai qua HTTP
- `Approve Device`: gọi approve API
- `Reject Device`: gọi reject API
- `Unpair Device`: gọi delete/unpair API
- `List Pending`: lấy danh sách `pending`
- `List Dashboard`: lấy danh sách device dashboard

### Remote + State Tests

- `Publish Heartbeat`: publish state/heartbeat
- `Publish Failure State`: publish state với `applied=false`
- `Remote ON`: gửi command bật qua server
- `Remote OFF`: gửi command tắt qua server
- `Send Custom Command`: gửi JSON tự nhập ở ô `Custom Command JSON`
- `Check Command Policy`: kiểm tra `/device/{id}/command/latest`

### Snapshot + Log

Các panel cuối dashboard cho bạn xem:

- `Last Pairing Ack`
- `Last State Ack`
- `Last State Payload`
- `Last Command Payload`
- `Last Device Snapshot`
- `Last HTTP Result`
- `Collection view`
- `Activity Log`

Đây là nơi đầu tiên nên xem nếu flow không chạy như kỳ vọng.

## 5. Flow khuyến nghị

### A. Test discovery nhanh khi không cần MQTT

Đây là cách đơn giản nhất nếu mục tiêu là làm cho trang `/devices/discovery` scan ra thiết bị.

1. Chạy:

```bash
python3 test/fake_board_test.py
```

2. Mở dashboard local.
3. Điền `server_base_url` nếu khác mặc định.
4. Login bằng một tài khoản admin hợp lệ.
5. Nếu `device_id` cũ có thể đã từng approve rồi, bấm `Generate Fresh Identity`.
6. Bấm `Register via HTTP`.
7. Mở webapp thật tại `/devices/discovery`.
8. Bấm `Rescan Network`.

Kỳ vọng:

- thiết bị xuất hiện trong discovery dưới trạng thái `pending`
- `List Pending` trên fake board dashboard trả về device vừa tạo

### B. Test case board cũ đã từng approve nhưng cần hiện lại ở discovery

Nếu cùng `device_id` đã từng được approve trước đó thì discovery page sẽ không hiện, vì server coi nó là `approved`, không còn là `pending`.

Để ép hiện lại:

1. Login admin trên fake board dashboard.
2. Dùng lại đúng `device_id` cũ hoặc board hiện tại.
3. Bấm `HTTP Force Re-pair`.
4. Vào `/devices/discovery` của webapp thật.
5. Bấm `Rescan Network`.

Kỳ vọng:

- server chuyển device về `pending`
- discovery page scan ra lại device đó

### C. Test path MQTT pairing thật

Chỉ dùng flow này khi MQTT broker, `MQTT_NAMESPACE`, và backend MQTT path đã khớp.

1. Điền đúng:
   - `mqtt_broker`
   - `mqtt_port`
   - `mqtt_namespace`
2. Bấm `Connect MQTT`
3. Bấm `Register Normal` hoặc `Force Re-pair`
4. Quan sát `Last Pairing Ack`

Kỳ vọng:

- `Last Pairing Ack` có payload từ server
- nếu pairing thành công, `status=ok`
- nếu cần admin approve thì `auth_status=pending`

### D. Test remote command

1. Đảm bảo board đã được approve hoặc command path đã sẵn sàng.
2. Login admin.
3. Bấm `Remote ON` hoặc `Remote OFF`.
4. Quan sát:
   - `Last Command Payload`
   - `Last State Payload`
   - `Last Device Snapshot`

Nếu cần test payload riêng:

1. Sửa `Custom Command JSON`
2. Bấm `Send Custom Command`

## 6. JSON mặc định

### Pins JSON mặc định

```json
[
  {
    "gpio_pin": 2,
    "mode": "OUTPUT",
    "function": "relay",
    "label": "Test Relay",
    "extra_params": {
      "active_level": 1
    }
  }
]
```

### Custom Command JSON mặc định

```json
{
  "kind": "action",
  "pin": 2,
  "value": 1
}
```

## 7. Các lỗi thường gặp

### Discovery page không scan ra device

Nguyên nhân thường gặp:

- bạn chưa login admin
- thiết bị chưa được tạo vào server
- `device_id` đó đã từng ở trạng thái `approved`
- bạn đang test MQTT path nhưng broker/namespace không khớp

Cách xử lý nhanh:

1. Bấm `Generate Fresh Identity`
2. Bấm `Register via HTTP`
3. Vào webapp thật và `Rescan Network`

Hoặc nếu cần dùng lại device cũ:

1. Bấm `HTTP Force Re-pair`
2. `Rescan Network`

### Register qua MQTT không có phản hồi

Kiểm tra:

- đã bấm `Connect MQTT` chưa
- broker có chạy không
- namespace có khớp backend không
- backend `/health` có báo `mqtt: connected` không

### Remote command không có tác dụng

Kiểm tra:

- device đã ở `approved` chưa
- board đã pairing xong chưa
- command JSON có đúng dạng không
- `Last HTTP Result` có trả lỗi từ server không

### HTTP register thành công nhưng không hiện ở discovery

Khả năng cao:

- server trả `auth_status=approved` vì `device_id` đó đã từng pair và được duyệt rồi

Cách xử lý:

- dùng `HTTP Force Re-pair`
- hoặc `Generate Fresh Identity` rồi `Register via HTTP`

## 8. Gợi ý test nhanh theo mục tiêu

### Muốn chỉ test discovery UI

- Login
- Generate Fresh Identity
- Register via HTTP
- sang webapp thật và Rescan

### Muốn test approve flow

- Login
- Register via HTTP
- List Pending
- Approve Device
- List Dashboard

### Muốn test unpair rồi pair lại

- Login
- Register via HTTP
- Approve Device
- Unpair Device
- HTTP Force Re-pair

### Muốn test MQTT transport

- Connect MQTT
- Register Normal
- Publish Heartbeat
- Remote ON / OFF

## 9. File liên quan

- Harness chính: [test/fake_board_test.py](/Users/kiendinhtrung/Documents/GitHub/Final-Project/test/fake_board_test.py)
- Hướng dẫn run stack: [run.md](/Users/kiendinhtrung/Documents/GitHub/Final-Project/run.md)
- Quy tắc agent: [AGENTS.md](/Users/kiendinhtrung/Documents/GitHub/Final-Project/AGENTS.md)
- Product baseline: [PRD.md](/Users/kiendinhtrung/Documents/GitHub/Final-Project/PRD.md)
