# Phase Report: Phase 2 - Implementation (MQTT Transport)

## 1. Mục tiêu Phase
- Thiết lập nền tảng MQTT transport tối thiểu cho hệ thống Smart Home, đảm bảo đường truyền dữ liệu thực tế không giả lập (no fake interactivity).
- Xây dựng luồng đi rõ ràng từ hành vi người dùng trên Dashboard (tương tác Widget) tới lệnh publish MQTT.
- Xây dựng khung subscriber cơ bản để nhận phản hồi (state) từ thiết bị.
- Giữ vững kiến trúc local-first và thiết kế có khả năng mở rộng (extensible) cho các device integration sau này.

## 2. Công việc đã thực hiện
- Tích hợp thư viện `paho-mqtt` (`CallbackAPIVersion.VERSION2`) vào Backend (FastAPI).
- Xây dựng module MQTT Client (`app/mqtt.py`), quản lý cấu hình tự động nhận diện thiết lập broker thông qua `.env` (fallback sử dụng public broker `broker.emqx.io` cho môi trường Dev hiện tại).
- Móc nối vòng đời của MQTT Client (connect/disconnect) vào Lifespan context manager của FastAPI để đóng mở thread an toàn.
- Cập nhật Database Schema (bảng `device_history`, cột `event_type`), bổ sung các trạng thái truy vết lệnh: `command_requested` và `command_failed`, tách biệt hoàn toàn với `state_change`.
- Sửa đổi Endpoint `POST /api/v1/device/{device_id}/command` để trực tiếp publish lệnh xuống MQTT broker trước khi ghi log.
- Nâng cấp Frontend UI (`webapp/src/app/page.tsx`): Ánh xạ chính xác Output/PWM GPIO pin của thiết bị vào payload lệnh (`{"kind": "action", "pin": <gpio>, "value": <1_or_0>}`); xử lý trạng thái chờ (loading/pending) để tránh lỗi Optimistic UI.
- Xây dựng và thực thi kịch bản kiểm thử tự động (Integration test script `test_mqtt_slice.py`) để giả lập Client & chứng minh luồng bản tin.

## 3. Deliverables / Kết quả đầu ra
- Core module transport: `server/app/mqtt.py`.
- REST API đã cập nhật chức năng Real-time action: `server/app/api.py`.
- Tệp UI Controller & Client API đã hoàn thiện giao tiếp: `webapp/src/app/page.tsx`, `webapp/src/lib/api.ts`.
- Môi trường Database đã được migrate hỗ trợ truy vết các EventType chuẩn.
- Artifacts quản lý dự án: `task.md`, `implementation_plan.md`, `walkthrough.md` thể hiện lịch sử phân tích và ra quyết định.

## 4. Những gì đã hoàn thành
- Luồng End-to-End Vertical Slice đã hoạt động thành công: Tương tác qua Browser UI → API Backend nhận lệnh → Publish bản tin MQTT → Message tới đúng Topic của thiết bị.
- Luồng bắt lỗi (Failure Path) đã được hiện thực: Nếu broker chết hoặc timeout, hệ thống API phản hồi lỗi rõ ràng và UI hiển thị trạng thái Failed, khôi phục lại trạng thái toggle ban đầu.

## 5. Vấn đề phát sinh và cách xử lý
- **Lỗi từ Public Broker (Connection Refused Code 7)**: Broker đá kết nối liên tục do trùng lặp Client ID ngầm định hoặc phiên bản giao thức không khớp.
  → *Cách xử lý*: Cập nhật cứng khai báo dùng `CallbackAPIVersion.VERSION2` chuẩn của paho-mqtt mới nhất, và đính kèm `uuid` ngẫu nhiên cho mỗi phiên Client ID backend khởi tạo.
- **Xung đột Namespace Topic MQTT**: Rủi ro nghe lén hoặc đụng độ message giữa nhiều máy dev trên cùng Public Broker.
  → *Cách xử lý*: Đưa biến `MQTT_NAMESPACE` vào môi trường, thiết lập topic theo cấu trúc cô lập `econnect/{namespace}/device/{device_id}/[command|state]`.
- **Lỗi Database 500 (Data Truncated for Enum)**: SQLAlchemy không tự động migrate kiểu dữ liệu ENUM trên MySQL, khiến lệnh INSERT history bị crash.
  → *Cách xử lý*: Thực thi lệch ALTER TABLE trực tiếp xuống MySQL để bổ sung phân nhánh `command_requested` và `command_failed`.

## 6. Đánh giá mức độ hoàn thành
- **Hoàn thành 100%** so với mục tiêu đặt ra cho Workstream 5 (Bản lề MQTT Transport Minimum Vertical Slice). 
- Các ràng buộc về cấu trúc payload ban đầu, quy hoạch topic, và đảm bảo thông tin transport (flow từ App ra Internet/Broker) đều đã được chứng minh qua Output test thật.

## 7. Điều kiện / mức độ sẵn sàng cho phase tiếp theo
- Dữ liệu transport đã có thể được lắng nghe bởi bất kỳ Firmware ESP/Arduino nào tuân thủ đúng định dạng JSON contract `{"kind": "action", "pin": <gpio>, "value": <0|1>}`.
- Sẵn sàng chuyển sang các hạng mục tiếp theo (Workstream 6: DIY Draft Builder / Auto-Provisioning Firmware Generator), vì nền tảng truyền thông kết nối cốt lõi đã có thể tái sử dụng mà không lo hỏng cấu trúc.

## 8. Kết luận
Phase 2 (Workstream 5 - MQTT Transport) đã khép lại theo đúng phương pháp luận Waterfall (từ Research -> Design -> Implementation -> Verification end-to-end test). Sản phẩm bàn giao ổn định, đáp ứng được hợp đồng giao tiếp cơ sở, sẵn sàng đẩy nhanh giao đoạn R&D cho trình quản lý Device phía dưới.
