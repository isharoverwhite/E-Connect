<div align="center">
  <h1>E-Connect</h1>
  <p>A self-hosted, local-first smart home platform focusing on LAN control and DIY IoT devices.</p>
</div>

<p align="center">
  <a href="#english">English</a> • <a href="#tiếng-việt">Tiếng Việt</a>
</p>

---

<h2 id="english">🇬🇧 English</h2>

**E-Connect** is a `self-hosted` and `local-first` smart home platform designed to focus on LAN-based device control, DIY onboarding for ESP32/ESP8266 microcontrollers, MQTT-first communication, and durable state storage on the user's infrastructure.

### 🌟 Core Values
- **Local-first**: You retain core LAN control even when internet connectivity drops.
- **Self-hosted**: The main stack runs entirely on your own hardware.
- **MQTT-first**: Device communications are strongly prioritized over MQTT.
- **DIY-friendly**: Streamlined tools for pin mapping, server-side firmware building, and web-serial flashing.
- **Durable State**: Crucial data is reliably persisted in the database rather than just residing in UI memory.

### 🏗 Architecture
E-Connect emphasizes a self-hosted smart home model where the main operational core resides on the user's local network:
- `server`: FastAPI backend managing authentication, device lifecycle, automation, firmware building, WebSockets, and APIs.
- `webapp`: A modern Next.js 16 + React 19 frontend providing the dashboard, setup flow, settings, and DIY builder UI.
- `mqtt`: A Mosquitto broker serving as the transport layer for command and state loops.
- `db`: A MariaDB instance for persisting users, households, devices, dashboards, automations, and operational history.
- `find_website`: A developer-hosted public discovery portal used to locate your local E-Connect instance on the same LAN easily from your browser.

### 📂 Key Repository Structure
- `PRD.md`: Product Requirement Document, defining baselines and execution scope.
- `AGENTS.md`: Workflows, gates, roles, and commit/push policies for AI agents.
- `design/`: Database schemas, user flows, change requests, and UI design references.
- `server/`: FastAPI backend, SQLAlchemy, MQTT handlers, and firmware build pipeline.
- `webapp/`: Next.js frontend application.
- `mqtt/`: Docker integration for Mosquitto broker.
- `find_website/`: Source code for the public discovery portal.

### 🚀 Getting Started (Docker Compose)

#### Prerequisites
- Docker Engine & Docker Compose plugin.
- Available host ports: `80`, `3000`, `3306`, `8000`, `1883`, (and `9123` if you wish to run the discovery website locally).

#### 1. Clone the Repository
```bash
git clone https://github.com/isharoverwhite/Final-Project.git
cd Final-Project
```

#### 2. Configuration (Optional)
Create a `.env` file at the root to override default credentials safely:
```env
DB_ROOT_PASSWORD=secure_root_password
DB_NAME=e_connect_db
DB_USER=econnect
DB_PASSWORD=secure_password
SECRET_KEY=change-me-in-production
NEXT_PUBLIC_API_URL=/api/v1
BACKEND_INTERNAL_URL=http://server:8000
```

#### 3. Run the Self-hosted Stack
This command launches the official approved topology for self-hosted environments:
```bash
docker compose up -d --build db mqtt server webapp
```

Once the stack is up:
- **Bare LAN shortcut**: `http://econnect.local` redirects to the current Web UI port when your LAN resolves that alias to the self-hosted machine and host port `80` is available. In the standard compose runtime this lands on `http://econnect.local:3000`.
- **Web UI & Setup**: `http://localhost:3000`
- **Secure companion origin for Web Serial / browser APIs**: `https://localhost:3443` *(Note: this HTTPS endpoint uses a local self-signed certificate by default, so you may need to accept the warning on first use).*
- **Backend Health**: `http://localhost:8000/health`
- **MQTT Broker**: `localhost:1883`
- **Database**: `localhost:3306`

#### 4. Developer Validation
To run the full repository including the public discovery portal (for local testing/pipelines):
```bash
docker compose up -d --build
```
The `find_website` will then be available at `http://localhost:9123`.

*To stop the stack:* `docker compose down` (use `-v` to wipe data volumes).

### 🛠 Development Workflow
This repository follows a strict waterfall baseline with 4 clear phases:
- **Requirement**: Review PRD, lock scope, map requirements, and plan verification.
- **Design**: Update design docs or declare `Design unchanged` for narrow fixes.
- **Implementation**: Make the minimal logical changes preserving topology and domain rules.
- **Test**: Independent verification via lint, build, Pytest, browser tracing, or DB queries.

Standard CI validations:
- `webapp`: `npm run lint && npm run build`
- `server`: `pytest tests/`

### 📄 License
This repository currently does not have a separate `LICENSE` file. All code, documents, and resources within are copyrighted property and may only be used, copied, or distributed with proper authorization until a formal open-source license is provided.

---

<h2 id="tiếng-việt">🇻🇳 Tiếng Việt</h2>

**E-Connect** là nền tảng nhà thông minh `self-hosted` và `local-first`, tập trung vào việc quản lý thiết bị trong mạng LAN, cung cấp quy trình (onboarding) dễ dàng cho các vi điều khiển DIY ESP32/ESP8266, giao tiếp ưu tiên qua MQTT, và lưu trữ trạng thái bền vững trên chính hạ tầng của người dùng.

### 🌟 Giá trị cốt lõi
- **Local-first**: Vẫn điều khiển được thiết bị trong vùng mạng LAN nội bộ ngay cả khi mất kết nối Internet.
- **Self-hosted**: Toàn bộ hệ thống lõi được triển khai trên phần cứng do bạn tự quản lý.
- **MQTT-first**: Việc giao tiếp sự kiện với thiết bị được ưu tiên sử dụng giao thức MQTT.
- **DIY-friendly**: Hỗ trợ toàn diện việc gán chân tín hiệu (pin mapping), build firmware trực tiếp từ server và nạp (flash) firmware qua giao thức Web Serial.
- **Durable State**: Các dữ liệu quan trọng luôn được đảm bảo ghi vào cơ sở dữ liệu thay vì chỉ nằm tạm trên bộ nhớ của giao diện đăng nhập web (UI Memory).

### 🏗 Архіtek & Kiến trúc
E-Connect hướng tới sự tinh gọn theo mô hình tự host, trong đó đa phần nền tảng vận hành nằm trên mạng nội bộ nhà bạn:
- `server`: FastAPI backend quản lý luồng xác thực (auth), vòng đời thiết bị, tự động hóa, quy trình build firmware, WebSocket và REST APIs.
- `webapp`: Ứng dụng Frontend Next.js 16 + React 19 cho bảng điều khiển, thiết lập, cấu hình cài đặt và công cụ thiết kế (DIY builder).
- `mqtt`: Mosquitto Broker đóng vai trò vận chuyển giao thức chính (transport layer).
- `db`: MariaDB làm cơ sở dữ liệu chuyên biệt để lưu thông tin về người dùng, nhà ở (households), thiết bị, lịch sử sự kiện.
- `find_website`: Cổng dò tìm khám phá (public discovery portal) do nhà phát triển vận hành, có nhiệm vụ báo hiệu và tìm vị trí instance E-Connect nội bộ từ xa thông qua trình duyệt của người dùng.

### 📂 Cấu trúc dự án
- `PRD.md`: Tài liệu đặc tả sản phẩm cung cấp ranh giới và giới hạn phát triển.
- `AGENTS.md`: Các quy trình hướng dẫn về cách vận hành kiểm soát phiên bản (commit/push/gate rules) và AI Agents workflow.
- `design/`: Khối tài liệu mô tả biểu đồ logic, yêu cầu flow UI và thay đổi tính năng.
- `server/`: Mã nguồn backend FastAPI và engine biên dịch Firmware tự động.
- `webapp/`: Mã nguồn thiết kế giao diện từ Next.js.
- `mqtt/`: Tập lệnh cấu hình môi trường Mosquitto qua Docker.
- `find_website/`: Tập hợp mã nguồn cho discovery public portal.

### 🚀 Hướng dẫn cài đặt (Docker Compose)

#### Yêu cầu môi trường
- Máy tính đã trỏ sẵn Docker Engine và Docker Compose plugin.
- Port còn khả dụng: `80`, `3000`, `3306`, `8000`, `1883`, (và tùy chọn `9123` nếu muốn dựng portal khám phá cục bộ).

#### 1. Clone dự án
```bash
git clone https://github.com/isharoverwhite/Final-Project.git
cd Final-Project
```

#### 2. Cấu hình biến môi trường
Nếu muốn điều chỉnh/nâng cao mức độ bảo mật mặc định, sử dụng cấu hình tập tin `.env` riêng biệt đặt ở mục ngoài cùng thư mục dự án:
```env
DB_ROOT_PASSWORD=mat_khau_root
DB_NAME=e_connect_db
DB_USER=econnect
DB_PASSWORD=mat_khau_db
SECRET_KEY=khoa-bi-mat-cua-ban
NEXT_PUBLIC_API_URL=/api/v1
BACKEND_INTERNAL_URL=http://server:8000
```

#### 3. Khởi chạy hệ thống Self-Hosted tiêu chuẩn
Câu lệnh được dùng để chuẩn bị cấu hình kiến trúc self-hosted nguyên bản:
```bash
docker compose up -d --build db mqtt server webapp
```

Khi chạy xong:
- **Lối tắt LAN**: `http://econnect.local` sẽ tự redirect sang cổng Web UI hiện tại nếu alias đó trỏ đúng về máy self-host và host port `80` còn trống. Với runtime compose tiêu chuẩn, đích sẽ là `http://econnect.local:3000`.
- **Giao diện Web & Setup**: Vào trang `http://localhost:3000`
- **Origin HTTPS cho Web Serial / browser APIs**: `https://localhost:3443` *(Lưu ý: endpoint HTTPS này dùng chứng chỉ tự ký cục bộ theo mặc định nên trình duyệt có thể hiện cảnh báo ở lần mở đầu tiên).*
- **Kiểm tra Backend**: `http://localhost:8000/health`
- **MQTT Broker Address**: Cùng trên IP cổng `1883`
- **Database MariaDB**: Truy cập ở `localhost:3306`

#### 4. Khởi chạy toàn bộ hệ thống (Cho Developer Testing)
Với nhóm lập trình kiểm tra toàn bộ pipeline, câu chạy có thể bao quát luôn công đoạn build discovery:
```bash
docker compose up -d --build
```
Dịch vụ khám phá `find_website` sẽ được kết xuất tại địa chỉ: `http://localhost:9123`.

*Cách ngắt các hệ thống:* Chạy `docker compose down` (và bổ sung `-v` để hủy và làm mới lại các cơ sở dữ liệu từ container đã tải).

### 🛠 Quy trình phát triển
Dự án được bảo trì theo quy trình chuỗi thác nước (waterfall baseline) nghiêm ngặt với 4 giai đoạn minh bạch:
- **Requirement**: Đọc lại quy trình, xem file PRD và hiểu rõ Verification Plan.
- **Design**: Trình bày tài liệu đặc tả/sửa đổi hoặc tự bảo lưu hệ thống (không design).
- **Implementation**: Bám sát sơ đồ, giảm thao tác vi phạm domain limits.
- **Test**: Hoàn toàn chịu test độc lập bằng API requests, Web/db Querying.

Kiểm duyệt tự động:
- `webapp`: Lệnh thông dụng `npm run lint && npm run build`
- `server`: Cú pháp kiểm tra dữ liệu `pytest tests/`

### 📄 Bản quyền dự án
Kho lưu trữ này không có định dạng `LICENSE` chia sẻ nội dung công cộng cụ thể. Tất cả những tài nguyên, thiết kế từ repository này đều thuộc chủ quyền riêng biệt về tài sản. Hãy gửi yêu cầu chia sẻ cụ thể trước khi có sự đồng ý sao chép.
