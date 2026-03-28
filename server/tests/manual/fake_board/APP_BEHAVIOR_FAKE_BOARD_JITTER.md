# Fake Board Jitter Behavior Report

## 1. Scope

Tài liệu này ghi lại hành vi hiện tại của ứng dụng E-Connect khi test với `fake board` trong ngữ cảnh:

- kết nối MQTT
- ngắt kết nối rồi kết nối lại để quan sát jitter / offline recovery
- điều khiển `ON`
- điều khiển `OFF`
- điều khiển `dimmer` bằng giá trị `brightness`

Task ID: `TEST-FAKE-BOARD-JITTER-001`
Ngày ghi nhận: `2026-03-28`

## 2. Test Context

Do Docker daemon không chạy trong turn test này, môi trường được dựng tạm như sau:

- backend FastAPI chạy local tại `http://127.0.0.1:8000`
- webapp Next.js chạy local tại `https://127.0.0.1:3000`
- MQTT broker dùng Python `amqtt` local tại `127.0.0.1:1883`
- database dùng SQLite tạm tại `/tmp/econnect-fake-board.db`
- timeout heartbeat được ép xuống `3` giây để tăng tốc vòng test disconnect/reconnect

Fake board được cấu hình với một pin `PWM`:

```json
[
  {
    "gpio_pin": 2,
    "mode": "PWM",
    "function": "dimmer",
    "label": "Browser Dimmer",
    "extra_params": {
      "active_level": 1,
      "min_value": 0,
      "max_value": 255
    }
  }
]
```

## 3. Observed Application Behavior

### 3.1 Pairing + Approval

- Fake board đăng nhập admin thành công bằng tài khoản local test.
- Fake board kết nối MQTT thành công gần như tức thì.
- `register` qua MQTT nhận `ack` với `status=ok` và `auth_status=pending`.
- Sau khi gọi `approve`, thiết bị chuyển sang `approved` và xuất hiện trong dashboard device list.

### 3.2 Connect / Disconnect Jitter

- Nếu fake board ngắt MQTT trong khoảng ngắn hơn heartbeat timeout, dashboard backend vẫn giữ thiết bị là `online`.
- Nếu fake board ngắt MQTT lâu hơn heartbeat timeout, backend sẽ coi thiết bị là `offline`.
- Sau khi fake board kết nối MQTT lại và publish state/heartbeat, backend đưa thiết bị về `online` rất nhanh.

### 3.3 Remote ON

- Dashboard / API gửi lệnh `POST /api/v1/device/{id}/command` thành công.
- Fake board nhận được command `value=1`.
- Fake board publish lại state với:

```json
{
  "value": 1,
  "brightness": 255
}
```

- Transport path cho `ON` hoạt động đúng.

### 3.4 Remote OFF

- Dashboard / API gửi lệnh `POST /api/v1/device/{id}/command` thành công.
- Fake board nhận được command `value=0`.
- Fake board publish lại state với:

```json
{
  "value": 0,
  "brightness": 0
}
```

- Transport path cho `OFF` hoạt động đúng.

### 3.5 Dimmer

- Dashboard / API gửi command `brightness=120` thành công.
- Fake board nhận được command dimmer và publish lại state:

```json
{
  "value": 1,
  "brightness": 120
}
```

- Command dimmer hoạt động đúng ở tầng MQTT transport.

## 4. Browser Behavior

### 4.1 Hành vi đúng

- Có thể login vào dashboard qua `https://127.0.0.1:3000`.
- Card `Browser Fake Dimmer` xuất hiện trên dashboard.
- Khi fake board đang online, card cho phép gửi command.
- Khi kéo dimmer lên `120`, fake board nhận command đúng.
- Khi reload dashboard sau timeout offline, trạng thái card phản ánh đúng dữ liệu backend hiện tại.

### 4.2 Hành vi lệch / stale

- Khi fake board mất kết nối đủ lâu để backend expire sang `offline`, dashboard đang mở không tự chuyển card sang `offline` ngay. Trạng thái chỉ đúng sau khi reload trang và gọi lại `/api/v1/dashboard/devices`.
- Sau khi card dimmer đang ở `120` rồi gửi `OFF`, fake board publish lại `brightness=0`, nhưng card đang mở vẫn giữ `120` cho tới khi reload.

## 5. Practical Interpretation

- Luồng command giữa dashboard -> backend -> MQTT -> fake board đang chạy đúng cho `ON`, `OFF`, và `dimmer`.
- Luồng reconnect sau jitter cũng chạy đúng ở backend.
- Vấn đề còn lại nằm ở realtime UI reconciliation:
  - card không tự hạ `online -> offline` khi backend đã expire do heartbeat timeout
  - card không reconcile lại giá trị dimmer về `0` ngay sau `OFF`

## 6. Current Gate Reading

- Transport behavior: `PASS`
- Browser realtime behavior: `FAIL`
- Kết luận chung cho scenario này: `FAIL` cho tới khi UI realtime đồng bộ lại đúng với state backend/MQTT

## 7. Follow-up Remediation (2026-03-28)

### 7.1 Applied Fixes

- Backend thêm stale-device watchdog để quét thiết bị `online` theo heartbeat timeout và broadcast `device_offline` qua WebSocket ngay cả khi dashboard không gọi lại `/api/v1/dashboard/devices`.
- Frontend dashboard reset PWM optimistic state khi bắt đầu toggle command mới, nên command `OFF` không còn giữ brightness cũ từ lần dimmer trước.

### 7.2 Re-Verification Result

- Re-run lại fake-board scenario trên môi trường tạm `SQLite + amqtt + Next dev server`.
- Browser path xác nhận card `Browser Fake Dimmer` đổi `Online -> Offline` live sau khi ngắt MQTT đủ lâu, không cần reload trang.
- Browser path xác nhận chuỗi `ON -> brightness 120 -> OFF` giờ kéo label và slider brightness về `0` ngay khi state MQTT `brightness=0` quay về.
- Console browser không có lỗi mới trong lần verify lại.

### 7.3 Updated Gate Reading

- Transport behavior: `PASS`
- Browser realtime behavior: `PASS`
- Kết luận chung sau remediation: `PASS` với residual risk là chưa re-run trên stack Docker Compose + MariaDB chuẩn của repo
