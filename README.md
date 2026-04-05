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
- Available host ports: `80`, `3000`, `3443`, `3306`, `8000`, `1883`, (and `9123` if you wish to run the discovery website locally).
- Keep these host ports free before running the default Compose stack:
  `80` -> bare `econnect.local` redirect entrypoint
  `3000` -> HTTP Web UI
  `3443` -> HTTPS companion origin for secure browser APIs
  `8000` -> backend API/health endpoint
  `1883` -> MQTT broker
  `3306` -> MariaDB
  `9123` -> optional local `find_website`
  If any of these ports is already occupied, `docker compose up` and the Jenkins CD deploy stage can fail immediately when Docker tries to bind the host port.

#### 1. Clone the Repository
```bash
git clone <your-repository-url>
cd Final-Project
```

#### 2. Host Storage Monitoring (Optional)
To display the correct system storage limit used by the host hardware instead of the Docker virtual disk, uncomment the line `#- /:/hostfs:ro` inside your `docker-compose.yml` under `server:` -> `volumes:` before starting the stack.

#### 3. Configuration (Optional)
Create a `.env` file at the root to override default credentials safely:
```env
DB_ROOT_PASSWORD=secure_root_password
DB_NAME=e_connect_db
DB_USER=econnect
DB_PASSWORD=secure_password
SECRET_KEY=change-me-in-production
TZ=Asia/Ho_Chi_Minh
NEXT_PUBLIC_API_URL=/api/v1
BACKEND_INTERNAL_URL=http://server:8000
```

Use a valid IANA timezone for `TZ`, for example `Asia/Ho_Chi_Minh`.

`TZ` still defines the deployment runtime timezone when no admin override is saved in `Settings -> General`. The Settings UI only shows the currently active timezone and current server time; it does not expose `TZ` as a separate field.

DIY firmware builds should keep Wi-Fi, MQTT, project IDs, and device secrets in private runtime config only. Do not commit local overrides into `server/firmware_template/platformio.ini`; the server-side builder stamps those values into generated artifacts when you launch a real build job.

If you want the public `find_website` to resolve a stable LAN alias such as `econnect.local`, add these optional values to `.env` and start the stack with the `discovery-mdns` profile shown below:
```env
DISCOVERY_MDNS_HOSTNAME=econnect.local
DISCOVERY_MDNS_ADVERTISED_IPS=192.168.1.25
```
Replace `192.168.1.25` with the real LAN IP of the machine running the self-hosted stack.

#### 4. End-user Prebuilt Stack (Docker Hub Images)
Use `docker-compose.user.yml` when the project owner has already published the self-hosted runtime images to Docker Hub. This file intentionally excludes `find_website`; end users must not deploy that public discovery portal on their home server.

Add the Docker Hub image references to `.env`:
```env
ECONNECT_SERVER_IMAGE=docker.io/<project-owner>/econnect-server:latest
ECONNECT_WEBAPP_IMAGE=docker.io/<project-owner>/econnect-webapp:latest
ECONNECT_MQTT_IMAGE=docker.io/<project-owner>/econnect-mqtt:latest
```

Pull and start the end-user stack:
```bash
docker compose -f docker-compose.user.yml pull
docker compose -f docker-compose.user.yml up -d
```

Optional extras for that image-based stack:
- MQTT host networking: `docker compose -f docker-compose.user.yml -f docker-compose.mqtt-host.yml up -d`
- mDNS alias publisher: `docker compose --profile discovery-mdns -f docker-compose.user.yml up -d discovery_mdns`

After the stack is ready:
- Open `https://localhost:3443` for the self-hosted Web UI.
- From another device on the same LAN, open [find.isharoverwhite.com](https://find.isharoverwhite.com) to discover the local instance.

If the project owner has not published those three runtime images yet, use the source-build workflow below instead.

#### 5. Source-build Self-hosted Stack (Developer / local source checkout)
This command launches the official approved topology for self-hosted environments:
```bash
docker compose up -d --build db mqtt server webapp
```

Once the stack is up:
- **Bare LAN shortcut**: `http://econnect.local` redirects to the current Web UI port when your LAN resolves that alias to the self-hosted machine and host port `80` is available. In the standard compose runtime this lands on `http://econnect.local:3000`.
- **Web UI & Setup**: `https://localhost:3443`
- **Fallback local HTTP dashboard**: `http://localhost:3000`
- **Secure companion origin for Web Serial / browser APIs**: `https://localhost:3443` *(Note: this HTTPS endpoint uses a local self-signed certificate by default, so you may need to accept the warning on first use).*
- **Backend Health**: `http://localhost:8000/health`
- **MQTT Broker**: `localhost:1883`
- **Database**: `localhost:3306`

Optional MQTT host networking:
- The default Compose stack publishes `1883:1883`, which is the safest cross-platform choice and keeps local development working on Docker Desktop.
- If you need Mosquitto to bind with `network_mode: host`, start the stack with the override file: `docker compose -f docker-compose.yml -f docker-compose.mqtt-host.yml up -d --build db mqtt server webapp`
- Use that override on Linux hosts, or on Docker Desktop only after enabling `Settings -> Resources -> Network -> Enable host networking`.
- The override keeps the `server` container pointed at the host-bound broker through a `host-gateway` mapping for the `mqtt` hostname.
- On Docker Desktop with the default published-port path, Mosquitto connection logs may show the Docker forwarding proxy address instead of the real LAN client IP. Treat the device's provisioned broker target and server-side `last_seen` updates as the authoritative LAN-path signals.

Optional discovery mDNS alias:
- To let the public `find_website` try `econnect.local` before wider subnet scans, start the stack with: `docker compose --profile discovery-mdns up -d --build db mqtt server webapp discovery_mdns`
- This helper is defined in the main `docker-compose.yml`, reuses the backend runtime, and publishes the alias from host networking so the LAN can resolve `econnect.local` consistently.
- Set `DISCOVERY_MDNS_HOSTNAME` and `DISCOVERY_MDNS_ADVERTISED_IPS` in `.env` before using the profile.
- Prefer this on Linux hosts. On Docker Desktop, host networking and LAN multicast behavior depend on your Docker/Desktop network setup.

#### 6. Developer Validation
To run the full repository including the public discovery portal (for local testing/pipelines):
```bash
docker compose up -d --build
```
The `find_website` will then be available at `http://localhost:9123`.

If your Jenkins pipeline should also probe a deployed public discovery origin, set the `PUBLIC_DISCOVERY_URL` job parameter to that deployment URL. Leaving it empty skips the public-origin smoke without affecting the LAN-hosted discovery check.

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
- Port còn khả dụng: `80`, `3000`, `3443`, `3306`, `8000`, `1883`, (và tùy chọn `9123` nếu muốn dựng portal khám phá cục bộ).
- Cần để trống các cổng host này trước khi chạy Compose mặc định:
  `80` -> entrypoint redirect cho bare `econnect.local`
  `3000` -> Web UI HTTP
  `3443` -> origin HTTPS đi kèm cho các browser API cần secure context
  `8000` -> backend API/health endpoint
  `1883` -> MQTT broker
  `3306` -> MariaDB
  `9123` -> `find_website` cục bộ (tùy chọn)
  Nếu một trong các cổng trên đã bị dịch vụ khác chiếm, `docker compose up` và stage deploy của Jenkins CD có thể fail ngay khi Docker bind cổng host.

#### 1. Clone dự án
```bash
git clone <your-repository-url>
cd Final-Project
```

#### 2. Giám sát Bộ nhớ Host (Tùy chọn)
Để bảng thông số "System Health" hiển thị chính xác dung lượng ổ cứng rỗng mặt vật lý của thiết bị Server thay vì bộ nhớ ảo của Docker sinh ra, bạn hãy mở tệp `docker-compose.yml`, tìm cài đặt volume của phần service `server` và bỏ dấu `#` trước dòng `#- /:/hostfs:ro` trước khi khởi chạy hệ thống.

#### 3. Cấu hình biến môi trường
Nếu muốn điều chỉnh/nâng cao mức độ bảo mật mặc định, sử dụng cấu hình tập tin `.env` riêng biệt đặt ở mục ngoài cùng thư mục dự án:
```env
DB_ROOT_PASSWORD=mat_khau_root
DB_NAME=e_connect_db
DB_USER=econnect
DB_PASSWORD=mat_khau_db
SECRET_KEY=khoa-bi-mat-cua-ban
TZ=Asia/Ho_Chi_Minh
NEXT_PUBLIC_API_URL=/api/v1
BACKEND_INTERNAL_URL=http://server:8000
```

Hãy dùng timezone IANA hợp lệ cho `TZ`, ví dụ `Asia/Ho_Chi_Minh`.

`TZ` vẫn là timezone runtime của môi trường triển khai khi chưa có override do admin lưu trong `Settings -> General`. Giao diện Settings chỉ hiển thị timezone đang hoạt động thực tế và giờ server hiện tại, không tách riêng `TZ` thành một trường riêng.

Các bản build DIY chỉ nên nhận Wi-Fi, MQTT, project ID và device secret từ cấu hình runtime riêng tư. Không commit local override vào `server/firmware_template/platformio.ini`; luồng build server-side sẽ tự đóng dấu các giá trị thật vào artifact khi bạn chạy build job.

Nếu muốn public `find_website` resolve một alias LAN ổn định như `econnect.local`, hãy thêm các giá trị tùy chọn này vào `.env` rồi khởi chạy bằng profile `discovery-mdns` ở bên dưới:
```env
DISCOVERY_MDNS_HOSTNAME=econnect.local
DISCOVERY_MDNS_ADVERTISED_IPS=192.168.1.25
```
Hãy thay `192.168.1.25` bằng IP LAN thật của máy đang chạy stack self-hosted.

#### 4. Stack dựng sẵn cho end user (Docker Hub Images)
Dùng `docker-compose.user.yml` khi chủ dự án đã publish sẵn các image runtime self-hosted lên Docker Hub. File này cố ý không chứa `find_website`; người dùng cuối không được triển khai portal discovery public đó trên home server của mình.

Hãy thêm các image Docker Hub vào `.env`:
```env
ECONNECT_SERVER_IMAGE=docker.io/<chu-du-an>/econnect-server:latest
ECONNECT_WEBAPP_IMAGE=docker.io/<chu-du-an>/econnect-webapp:latest
ECONNECT_MQTT_IMAGE=docker.io/<chu-du-an>/econnect-mqtt:latest
```

Pull image rồi khởi chạy stack cho end user:
```bash
docker compose -f docker-compose.user.yml pull
docker compose -f docker-compose.user.yml up -d
```

Tùy chọn thêm cho stack image-based này:
- MQTT host networking: `docker compose -f docker-compose.user.yml -f docker-compose.mqtt-host.yml up -d`
- Publisher alias mDNS: `docker compose --profile discovery-mdns -f docker-compose.user.yml up -d discovery_mdns`

Sau khi stack sẵn sàng:
- Mở `https://localhost:3443` để vào Web UI self-hosted.
- Trên một thiết bị khác cùng LAN, mở [find.isharoverwhite.com](https://find.isharoverwhite.com) để dò instance cục bộ.

Nếu chủ dự án chưa publish đủ ba image runtime này, hãy dùng luồng build từ source ở phần bên dưới.

#### 5. Khởi chạy hệ thống Self-Hosted từ source (developer / local source checkout)
Câu lệnh được dùng để chuẩn bị cấu hình kiến trúc self-hosted nguyên bản:
```bash
docker compose up -d --build db mqtt server webapp
```

Khi chạy xong:
- **Lối tắt LAN**: `http://econnect.local` sẽ tự redirect sang cổng Web UI hiện tại nếu alias đó trỏ đúng về máy self-host và host port `80` còn trống. Với runtime compose tiêu chuẩn, đích sẽ là `http://econnect.local:3000`.
- **Giao diện Web & Setup**: Vào trang `https://localhost:3443`
- **Dashboard HTTP cục bộ dự phòng**: `http://localhost:3000`
- **Origin HTTPS cho Web Serial / browser APIs**: `https://localhost:3443` *(Lưu ý: endpoint HTTPS này dùng chứng chỉ tự ký cục bộ theo mặc định nên trình duyệt có thể hiện cảnh báo ở lần mở đầu tiên).*
- **Kiểm tra Backend**: `http://localhost:8000/health`
- **MQTT Broker Address**: Cùng trên IP cổng `1883`
- **Database MariaDB**: Truy cập ở `localhost:3306`

Tùy chọn MQTT host networking:
- Stack Compose mặc định publish `1883:1883`, đây là lựa chọn an toàn hơn cho môi trường đa nền tảng và không làm hỏng local development trên Docker Desktop.
- Nếu cần để Mosquitto bind bằng `network_mode: host`, hãy chạy thêm file override: `docker compose -f docker-compose.yml -f docker-compose.mqtt-host.yml up -d --build db mqtt server webapp`
- Chỉ nên dùng override này trên Linux, hoặc trên Docker Desktop khi đã bật `Settings -> Resources -> Network -> Enable host networking`.
- Override vẫn giữ cho container `server` kết nối tới broker host-bound thông qua mapping `host-gateway` cho hostname `mqtt`.
- Trên Docker Desktop với đường publish port mặc định, log kết nối của Mosquitto có thể hiện địa chỉ proxy/forwarder của Docker thay vì IP LAN thật của client. Khi cần xác nhận đường LAN, hãy ưu tiên target broker đã provision cho thiết bị và các lần cập nhật `last_seen` phía server.

Tùy chọn alias mDNS cho discovery:
- Để public `find_website` thử `econnect.local` trước khi quét các subnet rộng hơn, hãy khởi chạy stack bằng lệnh: `docker compose --profile discovery-mdns up -d --build db mqtt server webapp discovery_mdns`
- Helper này đã được khai báo ngay trong `docker-compose.yml`, dùng lại runtime của backend và publish alias từ host networking để các máy trong LAN resolve `econnect.local` ổn định hơn.
- Hãy đặt `DISCOVERY_MDNS_HOSTNAME` và `DISCOVERY_MDNS_ADVERTISED_IPS` trong `.env` trước khi dùng profile này.
- Nên ưu tiên trên máy Linux. Với Docker Desktop, host networking và multicast LAN còn phụ thuộc cấu hình network của Docker/Desktop.

#### 6. Khởi chạy toàn bộ hệ thống (Cho Developer Testing)
Với nhóm lập trình kiểm tra toàn bộ pipeline, câu chạy có thể bao quát luôn công đoạn build discovery:
```bash
docker compose up -d --build
```
Dịch vụ khám phá `find_website` sẽ được kết xuất tại địa chỉ: `http://localhost:9123`.

Nếu Jenkins cần probe thêm public discovery origin đã deploy, hãy cấu hình job parameter `PUBLIC_DISCOVERY_URL` bằng URL đó. Để trống thì pipeline chỉ skip bước smoke của public origin, còn kiểm tra discovery chạy trên LAN-hosted service vẫn giữ nguyên.

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
