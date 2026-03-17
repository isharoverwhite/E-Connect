# Hướng dẫn chạy `server` và `webapp`

Tài liệu này áp dụng cho 2 thư mục đang được dùng trong repo hiện tại:

- `server`: FastAPI backend
- `webapp`: Next.js frontend

Stack Docker ở root hiện đã dùng đúng 2 service đang active trong repo:

- `server`: FastAPI backend
- `webapp`: Next.js frontend

`webapp` mặc định gọi API qua cùng origin `/api/v1` và được Next.js proxy nội bộ sang container `server`, nên khi deploy lên máy server thật, browser không còn bị hardcode vào `127.0.0.1`.

## 1. Yêu cầu trước khi chạy

- Python 3.11+ hoặc tương đương
- Node.js 20+ và npm
- Một database hợp lệ cho `DATABASE_URL`
- MQTT broker hợp lệ nếu bạn muốn test luồng thiết bị

## 2. Chạy bằng Docker

Từ thư mục root của repo:

```bash
docker compose up --build -d
```

Kiểm tra nhanh:

```bash
curl http://127.0.0.1:8000/health
curl http://127.0.0.1:3000
```

Mặc định:

- API backend: [http://127.0.0.1:8000](http://127.0.0.1:8000/)
- WebUI: [http://127.0.0.1:3000](http://127.0.0.1:3000/)

Nếu cần tắt:

```bash
docker compose down
```

## 3. Chạy server local

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
DATABASE_URL=mysql+pymysql://USER:PASSWORD@HOST:3306/DB_NAME
MQTT_BROKER=localhost
MQTT_PORT=1883
MQTT_NAMESPACE=local
```

### Bước 4: chạy FastAPI

```bash
uvicorn main:app --host 0.0.0.0 --port 8000
```

Sau khi chạy thành công:

- API root: [http://127.0.0.1:8000/](http://127.0.0.1:8000/)
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

### Bước 3: chạy Next.js dev server

```bash
npm run dev
```

Mở trình duyệt tại:

- [http://localhost:3000](http://localhost:3000/)

## 5. Thứ tự chạy khuyến nghị

Chạy theo thứ tự này để webapp gọi API được ngay:

1. Start `server` ở cổng `8000`
2. Start `webapp` ở cổng `3000`

## 6. Lưu ý quan trọng

- `webapp` mặc định gọi API tại `/api/v1`
- Next.js sẽ proxy `/api/v1/*` sang `BACKEND_INTERNAL_URL`, mặc định là `http://server:8000`
- Nếu bạn muốn browser gọi API trực tiếp thay vì qua proxy, có thể override `NEXT_PUBLIC_API_URL`
- Nếu `DATABASE_URL` sai hoặc database không truy cập được, `server` sẽ không lên
- Nếu MQTT broker không sẵn sàng, backend vẫn có thể chạy nhưng log sẽ báo lỗi kết nối MQTT

## 7. Lệnh chạy nhanh

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
