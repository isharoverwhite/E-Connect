# Phase Report: Phase 1 (MVP Foundation)

## 1. Mục tiêu Phase
- Thiết lập nền tảng cốt lõi cho hệ sinh thái smarthome E-Connect theo chuẩn Local-first.
- Triển khai các cấu phần nền tảng: Device registry, local storage (Database), và quản lý User/Auth.
- Xây dựng nền tảng giao diện (Dashboard UI) và hệ thống cấp phép/cấu hình phần cứng (DIY Builder).
- Xác minh tính sẵn sàng của hệ thống để chuyển giao sang Phase 2.

## 2. Công việc đã thực hiện
- Khởi tạo kiến trúc dự án với phân vùng Frontend (Next.js), Backend (FastAPI), và Database (MariaDB).
- Audit toàn diện luồng code end-to-end đối chiếu theo tài liệu yêu cầu (PRD).
- Phát triển API đăng ký thiết bị (Registry), sinh UUID, duyệt thiết bị (Approval) và bảo mật JWT.
- Thiết lập cấu trúc cơ sở dữ liệu `e_connect_db` cho người dùng (`users`), thiết bị (`devices`), và script (`automations`).
- Triển khai giao diện Dashboard cơ bản trên trình duyệt.
- Xử lý lỗi logic Online/Offline: Cập nhật cơ chế quét theo timestamp `last_seen` có độ giãn 5 phút thay vì dùng cờ trạng thái duyệt tĩnh.

## 3. Deliverables / Kết quả đầu ra
- Tập hợp mã nguồn ứng dụng (Frontend & Backend artifacts).
- Cấu hình hạ tầng dockerized (MariaDB, Backend host).
- Cơ chế quản lý định danh UUID cho phần cứng IoT.
- Tài liệu kiểm định Phase 1 Closure Report vạch rõ ưu nhược điểm kiến trúc.

## 4. Những gì đã hoàn thành
- Kiến trúc cơ sở dữ liệu (Database persistence).
- Luồng quản lý vai trò và phân quyền quản trị trị viên/user.
- Chấp thuận / Từ chối luồng giao tiếp bắt tay (Handshake) thiết bị mới.
- Khung giao diện Webapp (Navbar, authentication wrapper, layout sidebar).
- Thuật toán tracking trạng thái thiết bị theo thời gian thực (được cấu trúc ở phía Frontend).

## 5. Vấn đề phát sinh và cách xử lý
- **Lỗ hổng Dashboard Builder:** Giao diện hoàn toàn không có tính năng kéo thả hay mapping JSON layout. 
  - *Cách xử lý:* Ghi nhận là Blocker nghiêm trọng. Bắt buộc tích hợp các thư viện kéo/thả (dnd) để render theo JSON layout đã khai báo trong bảng `users`.
- **Thiếu giao thức MQTT:** Các lệnh điều khiển chỉ được in ra log nội bộ với ghi chú placeholder, chưa có kênh transport nội bộ (local broker). 
  - *Cách xử lý:* Ghi nhận là Blocker kiến trúc. Yêu cầu tích hợp ngay một library hoặc broker MQTT vào backend để liên kết local-first.
- **Tính năng DIY Pin Mapping sai kỹ thuật:** Mã nguồn đang dùng các khối `<div>` HTML tĩnh thay vì tệp `<svg>` tương tác để map chân GPIO.
  - *Cách xử lý:* Yêu cầu đập bỏ và render lại chuẩn SVG DOM theo đúng định hướng thiết kế.

## 6. Đánh giá mức độ hoàn thành
- **Trạng thái:** KHÔNG ĐẠT (NOT_READY)
- **Nhận xét:** Mặc dù phần API Registration, Auth, và Schema Database đã sẵn sàng, nhưng hệ thống vẫn còn thiếu 3 trụ cột kỹ thuật then chốt của giai đoạn MVP (Mqtt, Dashboard Builder, Interactive SVG). Do đó, phase 1 bị đánh giá chưa hoàn thành đầy đủ.

## 7. Điều kiện / mức độ sẵn sàng cho phase tiếp theo
- **Mức độ sẵn sàng:** TẠM DỪNG (HOLD)
- **Điều kiện để sang phase tiếp theo (Must Fix):**
  - Hệ thống phải có kênh giao tiếp qua MQTT cho phần cứng.
  - Dashboard phải là UI Builder động (kéo thả và lưu trữ cấu hình dưới dạng JSON Layout).
  - Tái cấu trúc DIY Mapping lên SVG chuẩn.
  - Khắc phục các cảnh báo lint/build trên hệ thống Next.js.
  - Luồng Build/Flash qua Web Serial API nếu tính năng này được định nghĩa thuộc MVP.

## 8. Kết luận
Phase 1 đã đặt được một vài nền móng rất cơ bản về backend REST API và cấu trúc UI, tuy nhiên vẫn thất bại ở việc nghiệm thu các tương tác phức tạp mang tính bản lề của E-Connect. Tiến độ dự án cần được neo lại ở Phase 1 để tiếp tục bổ sung các thành phần thiếu hụt. Tuyệt đối không khởi động Phase 2 khi Local Connectivity và JSON Builder chưa vận hành trơn tru.


