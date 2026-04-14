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

- Điều khiển thiết bị trong mạng LAN nhanh chóng và bảo mật.
- Quản lý vòng đời thiết bị DIY dùng `ESP32` và `ESP8266`.
- Giao tiếp ưu tiên `MQTT` cho tốc độ phản hồi tức thì.
- Dashboard điều khiển và giám sát trạng thái trực quan, thân thiện.
- Build firmware phía server, flash qua trình duyệt và mapping GPIO dễ dàng.
- Automation dạng graph builder cho phép thiết lập tự động hóa kéo thả.
- Lưu trữ dữ liệu an toàn trên hạ tầng của chính người dùng.

### Ứng dụng thực tế

E-Connect giúp biến các linh kiện DIY thành giải pháp nhà thông minh hoàn chỉnh thông qua Automation Builder trực quan. Một số ứng dụng phổ biến:

- **Tự động hóa ánh sáng**: Kết hợp cảm biến ánh sáng và relay điều khiển đèn. Nếu hệ thống nhận diện môi trường quá tối, đèn sẽ tự động bật sáng.
- **Điều khiển nhiệt độ, thông gió**: Dùng cảm biến nhiệt độ/độ ẩm (DHT11/DHT22) để kích hoạt quạt tự động khi phòng nóng vượt mức thiết lập (ví dụ: > 28°C).
- **Hệ thống tưới tiêu thông minh**: Theo dõi độ ẩm đất và tự động kích hoạt máy bơm nước khi phát hiện đất khô.
- **Cảnh báo an ninh**: Kết hợp cảm biến chuyển động hoặc cảm biến cửa để gửi thông báo tự động hoặc hú còi khi có xâm nhập lạ ban đêm.

### Điểm nổi bật

- **Local-first thật sự**: phần điều khiển cốt lõi vẫn hoạt động trong LAN ngay cả khi Internet không ổn định.
- **Self-hosted gọn**: stack người dùng chỉ gồm `db`, `mqtt`, `server`, `webapp`.
- **DIY-friendly**: có board picker, lưu Wi-Fi tập trung, pin mapping, build firmware, và đường dẫn flash.
- **Firmware dễ cập nhật hơn**: backend theo dõi GitHub release từ repo trusted cố định [econnectrelease/firmware](https://github.com/econnectrelease/firmware), mặc định kiểm tra mỗi 60 giây và tự kéo firmware-template mới về server khi có release mới.
- **Quản trị tập trung**: dashboard, logs, settings, automation, extensions đều nằm trong cùng giao diện.

### Kiến trúc self-hosted

| Thành phần | Vai trò |
|---|---|
| `server` | FastAPI backend cho auth, API, build firmware, WebSocket, automation, device lifecycle |
| `webapp` | Next.js 16 + React 19 frontend cho setup, dashboard, devices, automation, settings |
| `mqtt` | Mosquitto broker cho command/state loop |
| `db` | MariaDB lưu user, household, device, config, automation, log |

`find_website` không nằm trong stack self-hosted. Luồng chuẩn là người dùng chạy `db`, `mqtt`, `server`, `webapp` trong LAN của họ, rồi mở [find.isharoverwhite.com](https://find.isharoverwhite.com) từ một thiết bị cùng LAN để browser của chính họ scan ra server vừa cài. Mã nguồn của public finder hiện được tách riêng tại [econnectrelease/findwebsite](https://github.com/econnectrelease/findwebsite).

### Chạy Nhanh Theo Kiểu Copy & Run

Không cần tạo `.env`. Bản dành cho người dùng cuối nằm tại `deploy/user/compose.yml`.

Cách dễ nhất cho người dùng thường là:

1. Tải file về với đúng tên `compose.yml`
2. Mở file đó và sửa vài dòng trong phần `x-user-config`
3. Chạy đúng một lệnh: `docker compose up -d`

Lệnh tải file:

```bash
mkdir econnect && cd econnect
curl -fsSL https://raw.githubusercontent.com/isharoverwhite/Final-Project/main/deploy/user/compose.yml -o compose.yml
```

Lệnh chạy:

```bash
docker compose up -d
```

Nếu bạn đang đứng trong repo này và muốn dùng bản tương thích cũ ở root, cú pháp vẫn là:

```bash
docker compose -f docker-compose.user.yml up -d
```

Nếu bạn muốn `find.isharoverwhite.com` ưu tiên alias `econnect.local` trước khi quét subnet, hãy điền `https_ips` bằng LAN IP thật của server rồi bật profile mDNS tùy chọn:

```bash
docker compose --profile discovery-mdns up -d
```

Trong repo này, lệnh tương đương là:

```bash
docker compose -f docker-compose.user.yml --profile discovery-mdns up -d
```

Sau khi stack lên xong:

1. Trên máy đang chạy Docker, mở `https://localhost:3443`
2. Hoàn tất `First Time Setup`
3. Đăng nhập bằng tài khoản admin vừa tạo
4. Vào `Settings -> Wi-Fi` để lưu mạng Wi-Fi dùng cho provisioning
5. Vào `Devices -> Create New Device` để tạo project DIY đầu tiên
6. Trên laptop hoặc điện thoại nằm cùng LAN, mở [find.isharoverwhite.com](https://find.isharoverwhite.com) để kiểm tra browser scan có tìm thấy server self-hosted của bạn hay không

### User cần sửa những dòng nào

Trong hầu hết trường hợp, chỉ cần sửa 4 hoặc 5 dòng này:

```yaml
x-user-config:
  db_root_password: &db_root_password "HomeRoot!2026"
  db_password: &db_password "HomeApp!2026"
  secret_key: &secret_key "mot-chuoi-rat-dai-va-kho-doan-de-bao-mat"
  https_hosts: &https_hosts localhost,econnect.local
  https_ips: &https_ips "192.168.1.25"
```

Ý nghĩa từng dòng:

- `db_root_password`: mật khẩu root của MariaDB
- `db_password`: mật khẩu ứng dụng E-Connect dùng để vào MariaDB
- `secret_key`: khóa bí mật của backend, nên dùng chuỗi dài và khó đoán
- `https_ips`: IP LAN của máy chạy Docker, dùng khi muốn mở từ điện thoại hoặc máy khác trong mạng nội bộ, đồng thời là IP được profile `discovery-mdns` dùng để publish `econnect.local`
- `https_hosts`: hostname nội bộ nếu bạn có dùng tên như `econnect.local`

`server` sẽ tự lấy `db_name`, `db_user`, và `db_password` trong cùng file để dựng kết nối MariaDB, nên người dùng không cần map chuỗi kết nối DB thủ công nữa.

### Ví dụ thực tế

Ví dụ bạn có một mini PC chạy Docker trong nhà:

- IP LAN của máy đó là `192.168.1.25`
- Bạn muốn mở từ laptop và điện thoại trong cùng Wi-Fi
- Bạn chưa dùng domain public, chỉ dùng LAN

Khi đó bạn có thể sửa `compose.yml` thành:

```yaml
x-user-config:
  db_root_password: &db_root_password "HomeRoot!2026"
  db_password: &db_password "HomeApp!2026"
  secret_key: &secret_key "econnect-home-2026-change-this-to-a-long-random-secret"
  https_hosts: &https_hosts localhost,econnect.local
  https_ips: &https_ips "192.168.1.25"
```

Sau đó chạy:

```bash
docker compose up -d
```

Rồi mở WebUI bằng đúng host đã khai báo trong certificate:

- Trên chính máy chạy Docker: `https://localhost:3443`
- `https://192.168.1.25:3443`
- hoặc `https://econnect.local:3443`

Nếu bạn chỉ dùng trên chính máy chạy Docker và không mở từ thiết bị khác, có thể để:

```yaml
https_hosts: &https_hosts localhost
https_ips: &https_ips ""
```

và chỉ mở:

```text
https://localhost:3443
```

Nếu bạn đổi IP hoặc hostname sau lần chạy đầu tiên, hãy dừng stack, xóa volume kết thúc bằng `_webapp_tls`, rồi chạy lại để certificate được tạo mới:

```bash
docker compose down
docker volume ls | grep webapp_tls
docker volume rm <your_project>_webapp_tls
docker compose up -d
```

### Dùng find website để tìm server trong LAN

`find_website` là entrypoint public do nhà phát triển host, không phải container người dùng cần tự chạy ở nhà. Sau khi stack self-hosted đã hoạt động:

1. Mở [find.isharoverwhite.com](https://find.isharoverwhite.com) từ thiết bị nằm cùng LAN với server E-Connect.
2. Giữ tab mở để browser của chính thiết bị đó scan tới các endpoint discovery của `server`, chủ yếu là `http://<lan-host>:8000/web-assistant.js` và `http://<lan-host>:8000/discovery-bridge`.
3. Khi scan thành công, bấm vào result card để mở WebUI cục bộ tại `https://<lan-host>:3443`.
4. Nếu muốn alias-first fast path bằng `econnect.local`, hãy điền `https_ips` bằng LAN IP thật của server rồi chạy lại với profile `discovery-mdns`.

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

Mặc định vẫn chạy được ngay, nhưng với môi trường dùng thật bạn nên sửa ít nhất:

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

Phần `mqtt_image`, `server_image`, `webapp_image` thường không cần đổi, trừ khi bạn muốn pin sang tag image khác.

### Hướng dẫn phát triển Extension (Developer Docs)

E-Connect hỗ trợ mở rộng nền tảng thông qua hệ thống **Extensions** linh hoạt. Các nhà phát triển có thể tìm hiểu thêm về kiến trúc và cách xây dựng extension tại tài liệu sau:

👉 **[Xem Hướng dẫn phát triển Extension](./docs/EXTENSIONS.md)**

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
- GitHub Actions `.github/workflows/end-user-images.yml` sẽ build ba image self-hosted (`server`, `webapp`, `mqtt`) và publish lên Docker Hub khi `main` thay đổi ở các thư mục tương ứng.
- Workflow publish end-user image cần hai GitHub repository secrets: `DOCKERHUB_USERNAME` và `DOCKERHUB_TOKEN`.
- `server` mặc định theo dõi release mới nhất từ repo trusted cố định `econnectrelease/firmware` mỗi 60 giây qua `FIRMWARE_TEMPLATE_UPDATE_CHECK_SECONDS`; khi có bản mới, firmware-template sẽ tự được tải về `/data/firmware-template/current`.
- Các image Docker Hub được phát hành với cả tag `latest` và tag bất biến dạng `sha-<commit>`. Người dùng cuối có thể pin `mqtt_image`, `server_image`, hoặc `webapp_image` sang tag `sha-...` nếu muốn rollback hoặc khóa phiên bản cụ thể.
- Cổng HTTPS chính cho WebUI là `3443`.
- Lần đầu mở WebUI trên một máy mới, trình duyệt có thể cảnh báo certificate tự ký. Bạn chỉ cần chấp nhận certificate đó cho host nội bộ mà bạn đang dùng.

### License

Mã nguồn và tài sản của repository hiện được phân phối dưới giấy phép proprietary trong [`LICENSE`](./LICENSE). Tham khảo thêm [`REPOSITORY_PROTECTION.md`](./REPOSITORY_PROTECTION.md) cho ghi chú bảo vệ repository và nội dung pháp lý liên quan.

---

## English

### Overview

**E-Connect** is a `self-hosted`, `local-first` smart home platform prioritizing speed, privacy, and DIY experiences. Core capabilities include:

- Fast and secure LAN-native device control.
- Seamless DIY ESP32 / ESP8266 lifecycle onboarding.
- MQTT-first messaging for instant responsivity.
- Clean, dashboard-driven operations for device monitoring.
- Server-side firmware builds, browser flashing, and visual GPIO mapping.
- Visual, drag-and-drop graph builders for complex automations.
- Durable state storage strictly isolated on user-owned infrastructure.

### Real-life Applications

The core objective of E-Connect is turning DIY modules into functional, autonomous home solutions via the intuitive Automation Builder. Common use cases:

- **Smart Lighting**: Combine a light sensor with a relay. The system can evaluate ambient light and automatically turn on room lights when it gets too dark.
- **Automated Climate/Fan Control**: Utilize DHT11/DHT22 temperature & humidity sensors. Trigger a fan or AC switch immediately if the room temperature surpasses a certain point (e.g., > 28°C).
- **Smart Irrigation**: Track soil moisture levels and trigger water pumps automatically when your plants need hydration.
- **Security Alerts**: Connect motion or door sensors to push notifications or sirens, establishing a capable night-time security perimeter.

### Highlights

- **Real local-first behavior**: core control stays on the LAN.
- **Compact self-hosted stack**: end users run only `db`, `mqtt`, `server`, and `webapp`.
- **DIY provisioning flow**: board selection, saved Wi-Fi credentials, pin mapping, server builds, and flash-ready workflows.
- **Faster firmware iteration**: the backend tracks GitHub releases from the fixed trusted repository [econnectrelease/firmware](https://github.com/econnectrelease/firmware), checks every 60 seconds by default, and auto-installs the latest firmware template onto the server.
- **Single admin surface**: dashboard, logs, settings, devices, automation, and extensions live in one product.

### Self-hosted architecture

| Component | Responsibility |
|---|---|
| `server` | FastAPI backend for auth, APIs, firmware builds, WebSockets, automation, and device lifecycle |
| `webapp` | Next.js 16 + React 19 frontend for setup, dashboard, devices, automation, and settings |
| `mqtt` | Mosquitto broker for command/state transport |
| `db` | MariaDB for users, households, devices, configs, automations, and logs |

`find_website` is not part of the self-hosted stack. The normal topology is that users run only `db`, `mqtt`, `server`, and `webapp` on their own LAN, then open [find.isharoverwhite.com](https://find.isharoverwhite.com) from a device on that same LAN so their own browser can discover the server they just installed. The public finder source now lives in its own repository at [econnectrelease/findwebsite](https://github.com/econnectrelease/findwebsite).

### Copy And Run Quick Start

No `.env` file is required. The end-user artifact lives at `deploy/user/compose.yml`.

The easiest flow for most users is:

1. Download the file as `compose.yml`
2. Edit a few lines in `x-user-config`
3. Run exactly one command: `docker compose up -d`

Download command:

```bash
mkdir econnect && cd econnect
curl -fsSL https://raw.githubusercontent.com/isharoverwhite/Final-Project/main/deploy/user/compose.yml -o compose.yml
```

Run command:

```bash
docker compose up -d
```

If you are already inside this repository and want the backward-compatible root file, the correct syntax is:

```bash
docker compose -f docker-compose.user.yml up -d
```

If you want [find.isharoverwhite.com](https://find.isharoverwhite.com) to prefer the `econnect.local` alias before subnet sweeping, fill `https_ips` with the real server LAN IP and enable the optional mDNS profile:

```bash
docker compose --profile discovery-mdns up -d
```

Inside this repository, the equivalent command is:

```bash
docker compose -f docker-compose.user.yml --profile discovery-mdns up -d
```

When the stack is ready:

1. On the Docker host machine, open `https://localhost:3443`
2. Complete `First Time Setup`
3. Sign in with the new admin account
4. Save at least one Wi-Fi credential in `Settings -> Wi-Fi`
5. Open `Devices -> Create New Device` and start your first DIY project
6. From a laptop or phone on the same LAN, open [find.isharoverwhite.com](https://find.isharoverwhite.com) and confirm that the browser scanner can discover your self-hosted server

### Which Lines Should A User Edit?

In most cases, a user only needs to edit these 4 or 5 lines:

```yaml
x-user-config:
  db_root_password: &db_root_password "HomeRoot!2026"
  db_password: &db_password "HomeApp!2026"
  secret_key: &secret_key "a-very-long-random-secret-string"
  https_hosts: &https_hosts localhost,econnect.local
  https_ips: &https_ips "192.168.1.25"
```

What each line means:

- `db_root_password`: MariaDB root password
- `db_password`: MariaDB application password used by E-Connect
- `secret_key`: backend secret; use a long unpredictable string
- `https_ips`: LAN IP of the Docker host when you want to open the UI from another device on the same network, and the address reused by the `discovery-mdns` profile to publish `econnect.local`
- `https_hosts`: internal hostname if you use one, such as `econnect.local`

The `server` container now derives its MariaDB connection from the same `db_name`, `db_user`, and `db_password` values in the same file, so end users do not need to maintain a separate DB connection string anymore.

### Real Example

Example setup:

- Your home mini PC runs Docker
- Its LAN IP is `192.168.1.25`
- You want to open E-Connect from both a laptop and a phone on the same Wi-Fi
- You are not using a public domain

In that case, update `compose.yml` like this:

```yaml
x-user-config:
  db_root_password: &db_root_password "HomeRoot!2026"
  db_password: &db_password "HomeApp!2026"
  secret_key: &secret_key "econnect-home-2026-change-this-to-a-long-random-secret"
  https_hosts: &https_hosts localhost,econnect.local
  https_ips: &https_ips "192.168.1.25"
```

Then run:

```bash
docker compose up -d
```

Then open the WebUI with the same host covered by the certificate:

- On the Docker host itself: `https://localhost:3443`
- `https://192.168.1.25:3443`
- or `https://econnect.local:3443`

If you only use the WebUI on the Docker host itself, you can keep it even simpler:

```yaml
https_hosts: &https_hosts localhost
https_ips: &https_ips ""
```

Then open:

```text
https://localhost:3443
```

If you change the IP or hostname after the first run, stop the stack, remove the volume ending in `_webapp_tls`, and start again so the certificate can be regenerated:

```bash
docker compose down
docker volume ls | grep webapp_tls
docker volume rm <your_project>_webapp_tls
docker compose up -d
```

### Use The Find Website To Discover The LAN Server

`find_website` stays developer-hosted. End users should not run it as part of their home stack. After the self-hosted runtime is healthy:

1. Open [find.isharoverwhite.com](https://find.isharoverwhite.com) from a device on the same LAN as the E-Connect server.
2. Keep the tab open so that browser session can probe the server discovery endpoints, primarily `http://<lan-host>:8000/web-assistant.js` and `http://<lan-host>:8000/discovery-bridge`.
3. Click the result card to launch the local WebUI at `https://<lan-host>:3443`.
4. If you want the alias-first fast path through `econnect.local`, set `https_ips` to the real LAN IP and rerun Compose with the `discovery-mdns` profile enabled.

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

The defaults still work out of the box, but for a real deployment you should update at least:

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

The `mqtt_image`, `server_image`, and `webapp_image` fields usually do not need to be changed unless you want to pin a different image tag.

### Extension Development Guide (Developer Docs)

E-Connect is highly extensible via its **Extensions** system. Developers can learn more about building custom logic, widgets, and API integrations in our dedicated documentation:

👉 **[Read the Extension Development Guide](./docs/EXTENSIONS.md)**

### Run From Source

If you want to build directly from the repository instead of the published Docker Hub images:

```bash
git clone https://github.com/isharoverwhite/Final-Project.git
cd Final-Project
docker compose up -d --build db mqtt server webapp
```

Then open `https://localhost:3443`.

### Deployment Notes

- `deploy/user/compose.yml` is the primary end-user artifact; `docker-compose.user.yml` remains the in-repo compatibility variant.
- GitHub Actions `.github/workflows/end-user-images.yml` builds the three self-hosted images (`server`, `webapp`, and `mqtt`) and publishes them to Docker Hub when `main` changes in those delivery paths.
- The publish workflow requires two repository secrets: `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN`.
- `server` watches the latest release from the fixed trusted repo `econnectrelease/firmware` every 60 seconds by default through `FIRMWARE_TEMPLATE_UPDATE_CHECK_SECONDS` and auto-downloads fresh templates into `/data/firmware-template/current`.
- Docker Hub releases include both `latest` and immutable `sha-<commit>` tags. End users can pin `mqtt_image`, `server_image`, or `webapp_image` to a `sha-...` tag when they need rollback-friendly or fixed-version installs.
- The primary HTTPS WebUI entrypoint is `:3443`.
- Host `:8000` remains part of the self-hosted runtime because the public find website needs `/health`, `/web-assistant.js`, and `/discovery-bridge` on the user's LAN server.
- The optional `discovery-mdns` profile publishes `econnect.local` from the same backend runtime image and expects `https_ips` to contain the real LAN IP.
- On first access from a new device, the browser may warn about the self-signed certificate. Accept it for the exact internal host you chose for the WebUI.

### License

This repository is distributed under the proprietary terms in [`LICENSE`](./LICENSE). See [`REPOSITORY_PROTECTION.md`](./REPOSITORY_PROTECTION.md) for repository-protection and legal notes.
