# E-Connect 🏠
**E-Connect** is a self-hosted, local-first smart home platform designed for LAN-native control. It allows you to seamlessly build, provision, and manage DIY ESP32/ESP8266 devices, create visual automations, and organize your smart home without relying on the cloud! 🔌✨

[English](#english) • [Tiếng Việt](#tiếng-việt)

![E-Connect Dashboard](./docs/screenshots/readme/dashboard.png)

<h2 id="english">✨ Features</h2>

- **Local-First & Self-Hosted:** Complete privacy and control over your smart home data within your LAN.
- **DIY Device Provisioning:** Easily build, configure, and flash ESP32/ESP8266 firmware directly from your browser.
- **Visual Automations:** Create complex rules using an intuitive Trigger -> Condition -> Action graph builder.
- **Centralized Management:** Area-based device dashboards, centralized Wi-Fi credential storage, and real-time logs.
- **MQTT-First Messaging:** Fast, stable, and local message broker integration for all your devices.

## 🚀 Getting Started

**Option 1: Using Docker Compose (Recommended)**
1. Create a folder and download the compose file:
   ```bash
   mkdir econnect && cd econnect
   curl -fsSL https://raw.githubusercontent.com/isharoverwhite/Final-Project/main/deploy/user/compose.yml -o compose.yml
   ```
2. (Optional) Open `compose.yml` and edit the `x-user-config` section to set your own passwords and IP addresses.
3. Start the system:
   ```bash
   docker compose up -d
   ```
4. Access the WebUI at `https://localhost:3443` or your configured server IP, and use [find.isharoverwhite.com](https://find.isharoverwhite.com) to discover your local server from other devices.

**Option 2: Running from Source**
If you prefer running the source code directly:
1. Clone this repository: `git clone https://github.com/isharoverwhite/Final-Project.git`
2. Navigate to the project directory: `cd Final-Project`
3. Start all services: `docker compose up -d --build db mqtt server webapp`
4. Access the WebUI at `https://localhost:3443`.

## 🛠️ Contribution
Contributions are welcome! Please feel free to submit a Pull Request or check out the [Extension Development Guide](./docs/EXTENSIONS.md).

<div align="center">Made with ❤️ for a private smart home experience</div>

---

<h2 id="tiếng-việt">🇻🇳 Tiếng Việt</h2>

# E-Connect 🏠
**E-Connect** là nền tảng smart home self-hosted, local-first giúp bạn dựng và vận hành hệ thống IoT trong mạng LAN mà không phụ thuộc vào cloud. Dự án cung cấp công cụ trực quan để quản lý thiết bị, cấu hình ESP32/ESP8266, và tạo automation dễ dàng! 🔌✨

![E-Connect Dashboard](./docs/screenshots/readme/dashboard.png)

## ✨ Tính Năng
- **Local-First & Self-Hosted:** Đảm bảo quyền riêng tư và quyền kiểm soát hoàn toàn dữ liệu trong mạng nội bộ của bạn.
- **DIY Provisioning:** Hỗ trợ cấu hình, map GPIO và flash firmware cho ESP32/ESP8266 trực tiếp trên trình duyệt.
- **Visual Automations:** Trình tạo tự động hóa trực quan theo mô hình Trigger -> Condition -> Action.
- **Quản Lý Tập Trung:** Dashboard quản lý theo khu vực (area), lưu trữ Wi-Fi dùng chung và theo dõi log hệ thống theo thời gian thực.
- **MQTT-First:** Điều khiển nhanh, ổn định và bảo mật với MQTT broker được tích hợp sẵn.

## 🚀 Bắt Đầu Nhanh

**Cách 1: Dành cho người dùng (Khuyên dùng)**
1. Tạo thư mục và tải file cấu hình:
   ```bash
   mkdir econnect && cd econnect
   curl -fsSL https://raw.githubusercontent.com/isharoverwhite/Final-Project/main/deploy/user/compose.yml -o compose.yml
   ```
2. (Tùy chọn) Mở file `compose.yml` và chỉnh sửa các thông số mật khẩu, IP tại mục `x-user-config`.
3. Khởi chạy hệ thống:
   ```bash
   docker compose up -d
   ```
4. Truy cập giao diện tại `https://localhost:3443` hoặc IP máy chủ của bạn. Có thể dùng [find.isharoverwhite.com](https://find.isharoverwhite.com) để tự động tìm server trong mạng LAN.

**Cách 2: Chạy từ Source Code**
Nếu bạn muốn build trực tiếp từ mã nguồn:
1. Clone repository: `git clone https://github.com/isharoverwhite/Final-Project.git`
2. Mở thư mục dự án: `cd Final-Project`
3. Build và khởi chạy: `docker compose up -d --build db mqtt server webapp`
4. Truy cập WebUI tại `https://localhost:3443`.

## 🛠️ Đóng Góp
Mọi đóng góp cho dự án đều được chào đón! Bạn có thể tạo Pull Request hoặc tham khảo [Hướng dẫn phát triển Extension](./docs/EXTENSIONS.md).

<div align="center">Made with ❤️ for a private smart home experience</div>
