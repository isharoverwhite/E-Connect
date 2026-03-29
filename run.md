# Hướng dẫn chạy `server`, `webapp`, và `find_website`

Tài liệu này áp dụng cho 3 thư mục runtime đang được dùng trong repo hiện tại:

- `server`: FastAPI backend
- `webapp`: Next.js frontend
- `find_website`: public LAN scanner Next.js app

Stack Docker ở root hiện dùng đúng các service runtime đang active trong repo:

- `server`: FastAPI backend
- `webapp`: Next.js frontend
- `find_website`: LAN scanner cho owner/người vận hành

`webapp` mặc định gọi API qua cùng origin `/api/v1` và được Next.js proxy nội bộ sang container `server`, nên khi deploy lên máy server thật, browser không còn bị hardcode vào `127.0.0.1`.

## 1. Yêu cầu trước khi chạy

- Docker Desktop / Docker Engine để khởi tạo MariaDB và MQTT bằng Docker
- Python 3.11+ hoặc tương đương
- Node.js 20+ và npm

Không cần cài MariaDB trực tiếp trên macOS. Luồng dev local mặc định là:
- `docker compose` khởi tạo `db` từ image `mariadb:10.11`
- backend `server` chạy ở terminal và kết nối tới DB Docker qua `127.0.0.1:3306`
- webapp chạy ở terminal và gọi backend local qua `127.0.0.1:8000`

## 2. Chạy bằng Docker

Từ thư mục root của repo:

```bash
docker compose up --build -d
```

### 2.1 Publish `econnect.local` trên LAN

Nếu bạn muốn `find_website`, WebUI, và metadata firmware cùng dùng `econnect.local` thay vì IP thô, hãy làm đủ cả phần publish hostname và phần runtime config:

1. Cố định server vào một LAN IP ổn định, ví dụ `192.168.8.44`.
2. Chọn một trong hai cách publish alias:

   Khuyến nghị: Avahi/mDNS trên host Linux

   - Cài `avahi-daemon` và `avahi-utils` trên máy Linux chạy Docker.
   - Copy mẫu từ [deploy/avahi/hosts.example](/Users/kiendinhtrung/Documents/GitHub/Final-Project/deploy/avahi/hosts.example), thay IP thật rồi thêm vào `/etc/avahi/hosts`.
   - Restart dịch vụ:

   ```bash
   sudo systemctl restart avahi-daemon
   ```

   Thay thế: DNS nội bộ của router

   - Tạo DHCP reservation hoặc gán IP tĩnh cho máy server.
   - Tạo local DNS record `econnect.local -> <server-lan-ip>` trên router.
   - Nếu client trong LAN không resolve ổn định tên `.local`, quay lại Avahi/mDNS vì nhiều resolver ưu tiên mDNS cho suffix này.

3. Set các biến môi trường trước khi chạy `docker compose`:

```env
FIRMWARE_PUBLIC_BASE_URL=https://econnect.local:3000
FIRMWARE_MQTT_BROKER=econnect.local
FIRMWARE_PUBLIC_SCHEME=https
FIRMWARE_PUBLIC_PORT=3000
HTTPS_HOSTS=econnect.local
```

`HTTPS_IPS` là optional nếu bạn cũng muốn cert frontend chứa IP LAN cụ thể. Khi `HTTPS_HOSTS=econnect.local`, webapp container sẽ sinh cert có SAN cho hostname này thay vì chỉ `localhost` và IP detect được.

4. Build/deploy lại stack:

```bash
docker compose up --build -d
```

5. Verify trên một máy cùng LAN:

```bash
getent hosts econnect.local || avahi-resolve-host-name -4 econnect.local
curl http://econnect.local:8000/health
curl -k https://econnect.local:3000/login
```

Nếu `curl -k https://econnect.local:3000/login` fail nhưng `health` vẫn lên, nguyên nhân thường là cert frontend chưa chứa `econnect.local` hoặc client chưa trust cert self-signed đó.

Nếu bạn muốn backend **tự động** lấy đúng LAN IP ngay khi startup để nhúng vào firmware, không chỉ suy ra lại từ request sau này, hãy chạy các service quảng bá origin bằng `network_mode: host`. Với Docker bridge mặc định, backend thường chỉ thấy IP nội bộ của container nên auto-detect startup không thể đại diện cho host thật.

Kiểm tra nhanh:

```bash
curl http://127.0.0.1:8000/health
curl -k https://127.0.0.1:3000/login
curl http://127.0.0.1:9123/
```

Mặc định:

- API base URL: [http://127.0.0.1:8000/api/v1](http://127.0.0.1:8000/api/v1)
- WebUI: [https://127.0.0.1:3000](https://127.0.0.1:3000/)
- Find Website: [http://127.0.0.1:9123](http://127.0.0.1:9123/)

Nếu cần tắt:

```bash
docker compose down
```

## 3. Chạy server local

### Bước 0: khởi động database và MQTT bằng Docker

Từ thư mục root của repo:

```bash
docker compose -f docker-compose.yml up -d db mqtt
```

Lệnh này sẽ pull image MariaDB nếu máy chưa có, khởi tạo database `e_connect_db`, và publish cổng để backend local kết nối được.
Việc dùng `-f docker-compose.yml` giúp luồng dev local không bị ảnh hưởng bởi các file override cục bộ có thể tắt cổng DB.

### Bước 1: vào thư mục server

```bash
cd server
```

### Bước 2: chuẩn bị môi trường Python

Nếu repo đã có sẵn `venv` thì dùng luôn:

```bash
source venv/bin/activate
```

Nếu chưa có `venv`:

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Nếu đã có `venv` nhưng thiếu package:

```bash
pip install -r requirements.txt
```

### Bước 3: kiểm tra file môi trường

`server/app/database.py` bắt buộc cần `DATABASE_URL`. Repo hiện đang đọc biến môi trường từ:

```bash
server/.env
```

Tối thiểu nên có:

```env
DATABASE_URL=mysql+pymysql://econnect:root_password@127.0.0.1:3306/e_connect_db
MQTT_BROKER=127.0.0.1
MQTT_PORT=1883
MQTT_NAMESPACE=local
# Optional override nếu bạn không muốn backend tự detect host lúc startup:
FIRMWARE_PUBLIC_BASE_URL=https://econnect.local:3000
# Optional nếu broker public cho firmware khác host với API/public origin:
FIRMWARE_MQTT_BROKER=econnect.local
# Optional khi backend tự detect startup host:
FIRMWARE_PUBLIC_SCHEME=https
FIRMWARE_PUBLIC_PORT=3000
```

Repo hiện đã mặc định theo đúng giá trị trên để backend local dùng MariaDB chạy bằng Docker.
Khi deploy Docker lên server thật, bạn cũng nên đặt `FIRMWARE_PUBLIC_BASE_URL` thành origin HTTPS/public thật của WebUI, ví dụ `https://econnect.local:3000` hoặc `https://192.168.2.55:3000`, để `find_website` và metadata firmware cùng trỏ về đúng giao diện web đang publish.

*Lưu ý: Khi build firmware từ WebUI, backend giờ sẽ ưu tiên runtime target đã resolve ở lúc startup. Nếu `FIRMWARE_MQTT_BROKER` không được đặt hoặc không phải host public hợp lệ, firmware sẽ dùng cùng public host/IP với API cho MQTT.*
*Nếu startup auto-detect không usable hoặc người vận hành đôi lúc vẫn mở WebUI bằng `localhost` hoặc `127.0.0.1`, hãy đặt `FIRMWARE_PUBLIC_BASE_URL` thành origin LAN/public thật của server để firmware build luôn giữ địa chỉ mà board reach được.*
*Nếu bạn chuyển máy cài đặt từ IP cũ sang IP mới, ví dụ `192.168.2.16 -> 192.168.8.4`, hoặc đổi MQTT broker public của firmware, hãy build lại và flash lại board. Firmware cũ giữ target cũ và backend sẽ cảnh báo manual reflash là bắt buộc trước khi pair lại ổn định.*

### Bước 4: chạy FastAPI

```bash
uvicorn main:app --host 0.0.0.0 --port 8000
```

Sau khi chạy thành công:

- API base URL: [http://127.0.0.1:8000/api/v1](http://127.0.0.1:8000/api/v1)
- Health check: [http://127.0.0.1:8000/health](http://127.0.0.1:8000/health)

Kiểm tra nhanh:

```bash
curl http://127.0.0.1:8000/health
```

Kết quả mong đợi:

```json
{"status":"ok"}
```

## 4. Chạy webapp local

### Bước 1: mở terminal mới và vào thư mục webapp

```bash
cd webapp
```

### Bước 2: cài dependencies

```bash
npm install
```

### Bước 3: chạy Next.js dev server HTTPS-only

```bash
npm run dev
```

Lần chạy đầu tiên, script sẽ tự sinh TLS key/cert cục bộ trong `webapp/.local-https/`.
Nếu máy có `mkcert`, script sẽ ưu tiên dùng cert local-trusted của `mkcert`; nếu không, nó fallback sang `openssl`.
Bạn có thể thêm hostname/IP của server vào SAN và dev-origin allowlist bằng biến môi trường:

```bash
HTTPS_HOSTS=econnect.local,my-lab.local HTTPS_IPS=192.168.1.10 npm run dev
```

Alias cũ `LOCAL_HTTPS_HOSTS` và `LOCAL_HTTPS_IPS` vẫn được hỗ trợ, nhưng `HTTPS_HOSTS` / `HTTPS_IPS` là tên nên dùng khi WebUI chạy trên server và được truy cập từ máy người dùng khác.

Mở trình duyệt tại origin HTTPS:

- [https://localhost:3000](https://localhost:3000/)

`http://localhost:3000` không còn là đường truy cập được hỗ trợ. Frontend sẽ redirect hoặc fail closed sang HTTPS để giữ Web Serial / WebFlasher trong secure origin.

### Bước 4: chạy Playwright E2E trên HTTPS dev origin

Từ thư mục `webapp`:

```bash
PLAYWRIGHT_BASE_URL=https://127.0.0.1:3000 npx playwright test
```

Playwright config hiện đã bật `ignoreHTTPSErrors: true`, nên self-signed local cert không còn là blocker cho E2E.
Nếu bạn mở webapp bằng hostname/IP LAN khác, chỉ cần override `PLAYWRIGHT_BASE_URL` cho đúng origin HTTPS đó.

## 5. Thứ tự chạy khuyến nghị

Chạy theo thứ tự này để webapp gọi API được ngay:

1. Start `db` và `mqtt` bằng Docker
2. Start `server` ở cổng `8000`
3. Start `webapp` ở cổng `3000`

## 6. Lưu ý quan trọng

- `webapp` mặc định gọi API tại `/api/v1`
- Next.js sẽ proxy `/api/v1/*` sang `BACKEND_INTERNAL_URL`, mặc định là `http://server:8000`
- Nếu bạn muốn browser gọi API trực tiếp thay vì qua proxy, chỉ dùng `NEXT_PUBLIC_API_URL` dạng relative path hoặc absolute `https://...`; frontend sẽ bỏ qua cấu hình `http://...`
- Nếu bạn override `NEXT_PUBLIC_WS_URL`, chỉ dùng relative path hoặc absolute `wss://...`; frontend sẽ từ chối `ws://...`
- Nếu backend auto-detect đúng LAN IP lúc startup, firmware build sẽ dùng luôn IP đó thay vì phụ thuộc hoàn toàn vào request hiện tại.
- Nếu bạn chạy Docker và muốn auto-detect startup dùng đúng host LAN IP, hãy cấu hình `network_mode: host` cho các service quảng bá origin; Docker bridge mặc định chỉ cho backend thấy IP nội bộ của container.
- Nếu firmware build vẫn báo không suy ra được reachable host hoặc bạn không thể dùng host networking, đặt `FIRMWARE_PUBLIC_BASE_URL` trên backend thành origin thật của server, ví dụ `https://econnect.local:3000`, `https://192.168.8.4:3000`, hoặc hostname reverse proxy.
- Nếu bạn chạy `npm run dev` trên server để các máy khác cùng truy cập, hãy set `HTTPS_HOSTS` / `HTTPS_IPS` theo hostname hoặc IP mà người dùng sẽ mở trong browser. Next.js 16 sẽ dùng danh sách này cho `allowedDevOrigins` nên dev assets không bị chặn trên origin ngoài `localhost`.
- `webapp` chỉ còn phục vụ HTTPS. Với Docker local, healthcheck nội bộ dùng `https://127.0.0.1:3000` và bỏ qua self-signed verification.
- Nếu browser vẫn đánh dấu origin LAN là không tin cậy, hãy trust cert vừa sinh hoặc cài `mkcert` để Web Serial trên origin LAN được coi là secure.
- Để firmware nhận đúng host của server khi build qua Docker, hãy ưu tiên host networking cho auto-detect hoặc truy cập WebUI bằng địa chỉ mà board thật có thể reach được
- Nếu chưa chạy `docker compose -f docker-compose.yml up -d db mqtt`, `server` local sẽ báo lỗi kết nối DB/MQTT
- Nếu MQTT broker không sẵn sàng, backend vẫn có thể chạy nhưng log sẽ báo lỗi kết nối MQTT

## 7. Lệnh chạy nhanh

### Terminal 0

```bash
cd /Users/kiendinhtrung/Documents/GitHub/Final-Project
docker compose -f docker-compose.yml up -d db mqtt
```

### Terminal 1

```bash
cd /Users/kiendinhtrung/Documents/GitHub/Final-Project/server
source venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port 8000
```

### Terminal 2

```bash
cd /Users/kiendinhtrung/Documents/GitHub/Final-Project/webapp
npm install
npm run dev
```
