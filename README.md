# E-Connect

> Self-hosted, local-first smart home control for LAN devices, MQTT workflows, and DIY ESP32/ESP8266 provisioning.

[Tiếng Việt](#tiếng-việt) • [English](#english)

---

## Tour Giao Diện / Visual Tour

### 1. First-Time Setup
![E-Connect Setup](./docs/screenshots/readme/setup.png)

Tiếng Việt: Màn hình khởi tạo lần đầu dùng để tạo `Master Administrator`, khóa instance, và hoàn tất bootstrap an toàn cho hệ thống self-hosted.

English: The first-time setup screen creates the `Master Administrator`, locks the instance bootstrap flow, and secures the self-hosted installation.

### 2. Login
![E-Connect Login](./docs/screenshots/readme/login.png)

Tiếng Việt: Sau khi khởi tạo, người dùng đăng nhập qua form xác thực thật với tùy chọn `Keep me logged in`.

English: After bootstrap, users sign in through the real authentication flow with an optional `Keep me logged in` session mode.

### 3. Dashboard
![E-Connect Dashboard](./docs/screenshots/readme/dashboard.png)

Tiếng Việt: Dashboard là trung tâm quan sát thiết bị, cảnh báo hệ thống, trạng thái online/offline và các thao tác vận hành chính.

English: The dashboard is the command surface for device status, system alerts, online/offline visibility, and day-to-day operations.

### 4. Device Management
![E-Connect Device Management](./docs/screenshots/readme/devices-empty.png)

Tiếng Việt: Khu vực `Devices` quản lý vòng đời thiết bị, duyệt thiết bị mới, và đi vào luồng cấu hình DIY qua SVG builder.

English: The `Devices` area manages the device lifecycle, approves new devices, and launches the DIY SVG-based provisioning flow.

### 5. DIY Builder
![E-Connect DIY Builder](./docs/screenshots/readme/diy-builder.png)

Tiếng Việt: `IoT Configurator` hỗ trợ chọn board ESP32/ESP8266, gắn Wi-Fi đã lưu, chọn profile phần cứng, map GPIO và chuẩn bị build firmware phía server.

English: The `IoT Configurator` lets you choose ESP32/ESP8266 boards, attach saved Wi-Fi credentials, pick hardware profiles, map GPIO, and prepare server-side firmware builds.

### 6. Automation Builder
![E-Connect Automation Builder](./docs/screenshots/readme/automation-builder.png)

Tiếng Việt: Trình tạo automation dùng graph builder trực quan theo mô hình `Trigger -> Condition -> Action`, có workspace riêng để lưu, chạy thử và kiểm tra rule.

English: The automation builder uses a visual `Trigger -> Condition -> Action` graph workspace for saving, testing, and iterating automation rules.

### 7. Settings And Wi-Fi Credentials
![E-Connect Settings Wi-Fi](./docs/screenshots/readme/settings-wifi.png)

Tiếng Việt: `Settings` tập trung phần quản trị instance như timezone, user management, rooms, DIY configs, và danh sách Wi-Fi dùng lại cho provisioning.

English: `Settings` centralizes instance administration, including timezone, user management, rooms, DIY configs, and reusable Wi-Fi credentials for provisioning.

---

## Tiếng Việt

### Giới thiệu

**E-Connect** là nền tảng smart home `self-hosted`, `local-first`, tập trung vào:

- điều khiển thiết bị trong mạng LAN
- quản lý vòng đời thiết bị DIY dùng `ESP32` và `ESP8266`
- giao tiếp ưu tiên `MQTT`
- dashboard điều khiển và giám sát trạng thái
- build firmware phía server, flash qua trình duyệt và mapping GPIO bằng giao diện trực quan
- automation dạng graph builder
- lưu trạng thái bền vững trên hạ tầng của chính người dùng

### Điểm nổi bật

- **Local-first thật sự**: phần điều khiển cốt lõi vẫn hoạt động trong LAN ngay cả khi Internet không ổn định.
- **Self-hosted gọn**: stack người dùng chỉ gồm `db`, `mqtt`, `server`, `webapp`.
- **DIY-friendly**: có board picker, lưu Wi-Fi tập trung, pin mapping, build firmware, và đường dẫn flash.
- **Quản trị tập trung**: dashboard, logs, settings, automation, extensions đều nằm trong cùng giao diện.

### Kiến trúc self-hosted

| Thành phần | Vai trò |
|---|---|
| `server` | FastAPI backend cho auth, API, build firmware, WebSocket, automation, device lifecycle |
| `webapp` | Next.js 16 + React 19 frontend cho setup, dashboard, devices, automation, settings |
| `mqtt` | Mosquitto broker cho command/state loop |
| `db` | MariaDB lưu user, household, device, config, automation, log |

### Chạy Nhanh Theo Kiểu Copy & Run

Không cần tạo `.env`. Bản dành cho người dùng cuối nằm tại `deploy/user/compose.yml`, và các giá trị người dùng thường phải sửa đã được đưa thẳng vào phần `x-user-config` ở đầu file đó.

Tải đúng file đó về với đúng tên `compose.yml`, sửa vài dòng cần thiết, rồi lệnh chạy duy nhất là:

```bash
mkdir econnect && cd econnect
curl -fsSL https://raw.githubusercontent.com/isharoverwhite/Final-Project/main/deploy/user/compose.yml -o compose.yml
docker compose up -d
```

Nếu bạn đang đứng trong repo này và muốn dùng bản tương thích cũ ở root, cú pháp vẫn là:

```bash
docker compose -f docker-compose.user.yml up -d
```

Sau khi stack lên xong:

1. Trên máy đang chạy Docker, mở `https://localhost:3443`
2. Hoàn tất `First Time Setup`
3. Đăng nhập bằng tài khoản admin vừa tạo
4. Vào `Settings -> Wi-Fi` để lưu mạng Wi-Fi dùng cho provisioning
5. Vào `Devices -> Create New Device` để tạo project DIY đầu tiên

### Truy cập từ thiết bị khác trong LAN

Đây là phần quan trọng nhất để mở đúng WebUI qua HTTPS:

1. Nếu bạn chỉ dùng trên chính máy chạy Docker, giữ mặc định và mở `https://localhost:3443`
2. Nếu bạn muốn mở từ điện thoại hoặc máy khác trong LAN, mở `compose.yml` và sửa ngay phần `x-user-config`
3. Cách ổn nhất khi truy cập bằng IP là điền `https_ips: &https_ips "LAN_IP_CUA_SERVER"`
4. Nếu bạn có hostname nội bộ như `econnect.local`, điền vào `https_hosts`

Ví dụ:

```yaml
x-user-config:
  https_hosts: &https_hosts localhost,econnect.local,e-connect.local
  https_ips: &https_ips "192.168.1.25"
```

Sau đó mở WebUI bằng đúng host đã khai báo trong cert:

- `https://192.168.1.25:3443`
- hoặc `https://econnect.local:3443`

Nếu bạn đổi IP hoặc hostname sau lần chạy đầu tiên, hãy dừng stack, xóa volume kết thúc bằng `_webapp_tls`, rồi chạy lại để certificate được tạo mới:

```bash
docker compose down
docker volume ls | grep webapp_tls
docker volume rm <your_project>_webapp_tls
docker compose up -d
```

### Luồng sử dụng đề xuất

1. **Bootstrap hệ thống**
   Mở `https://localhost:3443` hoặc host HTTPS bạn đã cấu hình, hoàn tất `First Time Setup`, rồi đăng nhập bằng tài khoản admin vừa tạo.

2. **Lưu mạng Wi-Fi dùng chung**
   Vào `Settings -> Wi-Fi`, thêm SSID và mật khẩu mà thiết bị DIY sẽ dùng khi khởi động lần đầu.

3. **Tạo cấu hình phần cứng**
   Vào `Devices -> Create New Device`, chọn board, profile phần cứng, room, và network đã lưu.

4. **Map GPIO và build firmware**
   Đi tiếp qua các bước `Configs -> Pins -> Review -> Flash` để tạo build phía server.

5. **Onboard và quản lý thiết bị**
   Dùng các màn hình `Dashboard` hoặc `Devices` để quét, duyệt, và quản lý thiết bị mới trong cùng WebUI.

6. **Tạo automation**
   Vào `Automation`, dựng rule theo sơ đồ `Trigger -> Condition -> Action`.

### Các giá trị nên sửa ngay trong file compose

Mặc định vẫn chạy được ngay, nhưng với môi trường dùng thật bạn nên mở `compose.yml` và sửa ít nhất các giá trị này trong `x-user-config`:

```yaml
x-user-config:
  db_root_password: &db_root_password "your_root_password"
  db_password: &db_password "your_app_password"
  secret_key: &secret_key "your_long_random_secret_key"
  https_hosts: &https_hosts localhost,econnect.local,e-connect.local
  https_ips: &https_ips "192.168.1.25"
  mqtt_image: &mqtt_image docker.io/ryzen30xx/econnect-mqtt:latest
  server_image: &server_image docker.io/ryzen30xx/econnect-server:latest
  webapp_image: &webapp_image docker.io/ryzen30xx/econnect-webapp:latest
```

`server` sẽ tự lấy `db_name`, `db_user`, và `db_password` trong cùng file để dựng kết nối MariaDB, nên người dùng không cần map chuỗi kết nối DB thủ công nữa.

### Build từ source

Nếu bạn muốn chạy trực tiếp từ mã nguồn thay vì image public:

```bash
git clone https://github.com/isharoverwhite/Final-Project.git
cd Final-Project
docker compose up -d --build db mqtt server webapp
```

Sau đó truy cập `https://localhost:3443`.

### Ghi chú triển khai

- `docker-compose.user.yml` đã được cấu hình sẵn image mặc định từ Docker Hub và không yêu cầu khai báo image bằng tay.
- Cổng HTTPS chính cho WebUI là `3443`.
- Lần đầu mở WebUI trên một máy mới, trình duyệt có thể cảnh báo certificate tự ký. Bạn chỉ cần chấp nhận certificate đó cho host nội bộ mà bạn đang dùng.

### License

Mã nguồn và tài sản của repository hiện được phân phối dưới giấy phép proprietary trong [`LICENSE`](./LICENSE). Tham khảo thêm [`REPOSITORY_PROTECTION.md`](./REPOSITORY_PROTECTION.md) cho ghi chú bảo vệ repository và nội dung pháp lý liên quan.

---

## English

### Overview

**E-Connect** is a `self-hosted`, `local-first` smart home platform focused on:

- LAN-native device control
- DIY ESP32 / ESP8266 onboarding
- MQTT-first messaging
- dashboard-driven operations
- server-side firmware builds, browser flashing, and visual GPIO mapping
- visual automations
- durable state stored on user-owned infrastructure

### Highlights

- **Real local-first behavior**: core control stays on the LAN.
- **Compact self-hosted stack**: end users run only `db`, `mqtt`, `server`, and `webapp`.
- **DIY provisioning flow**: board selection, saved Wi-Fi credentials, pin mapping, server builds, and flash-ready workflows.
- **Single admin surface**: dashboard, logs, settings, devices, automation, and extensions live in one product.

### Self-hosted architecture

| Component | Responsibility |
|---|---|
| `server` | FastAPI backend for auth, APIs, firmware builds, WebSockets, automation, and device lifecycle |
| `webapp` | Next.js 16 + React 19 frontend for setup, dashboard, devices, automation, and settings |
| `mqtt` | Mosquitto broker for command/state transport |
| `db` | MariaDB for users, households, devices, configs, automations, and logs |

### Copy And Run Quick Start

No `.env` file is required. The end-user artifact now lives at `deploy/user/compose.yml`, and the values an end user usually needs to edit are embedded in the `x-user-config` block at the top of that file.

Download that file with its final name `compose.yml`, edit the required fields, and the one run command is:

```bash
mkdir econnect && cd econnect
curl -fsSL https://raw.githubusercontent.com/isharoverwhite/Final-Project/main/deploy/user/compose.yml -o compose.yml
docker compose up -d
```

If you are already inside this repository and want the backward-compatible root file, the correct syntax is:

```bash
docker compose -f docker-compose.user.yml up -d
```

When the stack is ready:

1. On the Docker host machine, open `https://localhost:3443`
2. Complete `First Time Setup`
3. Sign in with the new admin account
4. Save at least one Wi-Fi credential in `Settings -> Wi-Fi`
5. Open `Devices -> Create New Device` and start your first DIY project

### Access From Another LAN Device

This is the important part if you want HTTPS to work correctly beyond the Docker host:

1. If you only use the WebUI on the Docker host itself, keep the defaults and open `https://localhost:3443`
2. If you want to open the WebUI from another phone or computer on the LAN, edit `compose.yml` directly in the `x-user-config` block
3. The most reliable IP-based setup is `https_ips: &https_ips "YOUR_SERVER_LAN_IP"`
4. If you use an internal hostname such as `econnect.local`, add it to `https_hosts`

Example:

```yaml
x-user-config:
  https_hosts: &https_hosts localhost,econnect.local,e-connect.local
  https_ips: &https_ips "192.168.1.25"
```

Then open the WebUI with the same host covered by the certificate:

- `https://192.168.1.25:3443`
- or `https://econnect.local:3443`

If you change the IP or hostname after the first run, stop the stack, remove the volume ending in `_webapp_tls`, and start again so the certificate can be regenerated:

```bash
docker compose down
docker volume ls | grep webapp_tls
docker volume rm <your_project>_webapp_tls
docker compose up -d
```

### Recommended Usage Flow

1. **Bootstrap the instance**
   Open `https://localhost:3443` or your configured HTTPS host, complete the first-time setup flow, and sign in with the new admin account.

2. **Store reusable Wi-Fi credentials**
   Go to `Settings -> Wi-Fi` and save the network your DIY nodes should use during initial boot.

3. **Create a hardware project**
   Open `Devices -> Create New Device`, then choose the board family, exact profile, room, and saved network.

4. **Map GPIO and build firmware**
   Continue through `Configs -> Pins -> Review -> Flash` to prepare a server-generated firmware build.

5. **Onboard and manage devices**
   Use the `Dashboard` or `Devices` screens to scan, approve, and manage devices directly in the WebUI.

6. **Build automations**
   Open `Automation` and compose rules through the visual `Trigger -> Condition -> Action` graph builder.

### Values To Edit Directly In The Compose File

The defaults still work out of the box, but for a real deployment you should open `compose.yml` and update at least these values in `x-user-config`:

```yaml
x-user-config:
  db_root_password: &db_root_password "your_root_password"
  db_password: &db_password "your_app_password"
  secret_key: &secret_key "your_long_random_secret_key"
  https_hosts: &https_hosts localhost,econnect.local,e-connect.local
  https_ips: &https_ips "192.168.1.25"
  mqtt_image: &mqtt_image docker.io/ryzen30xx/econnect-mqtt:latest
  server_image: &server_image docker.io/ryzen30xx/econnect-server:latest
  webapp_image: &webapp_image docker.io/ryzen30xx/econnect-webapp:latest
```

The `server` container now derives its MariaDB connection from the same `db_name`, `db_user`, and `db_password` values in the same file, so end users do not need to maintain a separate DB connection string anymore.

### Run From Source

If you want to build directly from the repository instead of the published Docker Hub images:

```bash
git clone https://github.com/isharoverwhite/Final-Project.git
cd Final-Project
docker compose up -d --build db mqtt server webapp
```

Then open `https://localhost:3443`.

### Deployment Notes

- `docker-compose.user.yml` ships with working Docker Hub defaults and does not require manual image configuration.
- The primary HTTPS WebUI entrypoint is `:3443`.
- On first access from a new device, the browser may warn about the self-signed certificate. Accept it for the exact internal host you chose for the WebUI.

### License

This repository is distributed under the proprietary terms in [`LICENSE`](./LICENSE). See [`REPOSITORY_PROTECTION.md`](./REPOSITORY_PROTECTION.md) for repository-protection and legal notes.
