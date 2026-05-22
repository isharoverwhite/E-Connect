# Tích hợp Google Home — Hướng dẫn cài đặt

> **Thời gian đọc:** ~10 phút  
> **Đối tượng:** Quản trị viên máy chủ  
> **Yêu cầu:** Máy chủ E-Connect đang chạy và có thể truy cập từ internet (qua port forwarding, Cloudflare Tunnel, ngrok, v.v.)

---

## Tổng quan

E-Connect tích hợp với Google Home theo dạng **Smart Home Action**. Sau khi cấu hình xong, tất cả người dùng trên máy chủ của bạn có thể liên kết tài khoản E-Connect với Google Home và điều khiển thiết bị bằng giọng nói:

```
"OK Google, bật đèn phòng khách"
"OK Google, đặt quạt phòng ngủ 50%"
"OK Google, tắt tất cả thiết bị"
```

Tích hợp hoạt động theo nguyên tắc:
1. **Máy chủ của bạn** đóng vai trò OAuth 2.0 authorization server (liên kết tài khoản)
2. **Máy chủ Google** gọi webhook fulfillment của bạn để gửi các lệnh SYNC / QUERY / EXECUTE
3. **Report State** đẩy trạng thái thiết bị thời gian thực về Google qua Home Graph API

---

## Sơ đồ kiến trúc

```
Ứng dụng Google Home
      │
      │  Liên kết tài khoản (OAuth2)
      ▼
Máy chủ E-Connect  ◄─────────────────────────────┐
   /api/v1/google/auth          │               │
   /api/v1/google/token         │               │
      │                         │               │
      │  Smart Home Fulfillment │               │
      ▼                         │               │
Máy chủ E-Connect               │               │
   /api/v1/google/fulfillment   │               │
      │  SYNC / QUERY / EXECUTE │               │
      ▼                         │               │
   MQTT → Thiết bị ESP32        │               │
      │                         │               │
      │  Thay đổi trạng thái    │               │
      └─────► Report State ─────┘               │
              Home Graph API                    │
              (Google Cloud)                    │
                                                │
              Service Account JWT ──────────────┘
```

---

## Bước 1 — Tạo dự án Google Actions

1. Truy cập [Google Actions Console](https://console.actions.google.com/) và đăng nhập bằng tài khoản Google.
2. Nhấn **New project**, đặt tên (ví dụ: `E-Connect`), rồi nhấn **Create project**.
3. Ở màn hình "What kind of Action do you want to build?", chọn **Smart Home** và nhấn **Start Building**.
4. Trong thanh sidebar bên trái, chọn **Develop → Actions**.
5. Tại mục **Fulfillment**, dán URL fulfillment của máy chủ bạn:
   ```
   https://<domain-công-khai-của-bạn>/api/v1/google/fulfillment
   ```
   > Thay `<domain-công-khai-của-bạn>` bằng hostname hoặc IP công khai của máy chủ.

---

## Bước 2 — Cấu hình liên kết tài khoản (OAuth 2.0)

Vẫn trong Actions Console, vào **Develop → Account linking**.

Điền thông tin như sau:

| Trường | Giá trị |
|---|---|
| **Linking type** | OAuth |
| **Grant type** | Authorization code |
| **Client ID** | Chuỗi bí mật do bạn tự tạo (ví dụ: `econnect-ghome-client`) |
| **Client secret** | Chuỗi bí mật khác (ví dụ: một mật khẩu ngẫu nhiên dài) |
| **Authorization URL** | `https://<domain-công-khai-của-bạn>/api/v1/google/auth` |
| **Token URL** | `https://<domain-công-khai-của-bạn>/api/v1/google/token` |

> **Quan trọng:** Lưu lại Client ID và Client Secret — bạn sẽ nhập chúng vào phần Cài đặt E-Connect ở Bước 4.

Nhấn **Save**.

---

## Bước 3 — Bật Home Graph API & Tạo Service Account

Home Graph API cho phép E-Connect chủ động đẩy trạng thái thiết bị về Google (Report State) để Google luôn có trạng thái mới nhất.

### 3a — Bật API

1. Truy cập [Google Cloud Console](https://console.cloud.google.com/) và chọn cùng project với Bước 1.
2. Vào **APIs & Services → Library**.
3. Tìm kiếm **HomeGraph API** và nhấn **Enable**.

### 3b — Tạo Service Account

1. Vào **IAM & Admin → Service Accounts**.
2. Nhấn **Create Service Account**.
3. Đặt tên (ví dụ: `econnect-homegraph`), nhấn **Create and continue**.
4. Bỏ qua các bước tùy chọn về role và user — nhấn **Done**.

### 3c — Tải JSON Key

1. Nhấn vào service account vừa tạo.
2. Chuyển sang tab **Keys**.
3. Nhấn **Add Key → Create new key → JSON** rồi nhấn **Create**.
4. Một file `.json` sẽ được tải về — giữ an toàn, bạn sẽ dán nội dung file này vào Cài đặt E-Connect.

---

## Bước 4 — Cấu hình E-Connect

1. Mở E-Connect trên trình duyệt, vào **Cài đặt → Google Home**.
2. Cuộn xuống phần **Thông tin Google Cloud** (chỉ hiển thị với admin).
3. Điền các trường:

| Trường | Giá trị |
|---|---|
| **OAuth2 Client ID** | Client ID bạn đã chọn ở Bước 2 |
| **OAuth2 Client Secret** | Client Secret bạn đã chọn ở Bước 2 |
| **Google Cloud Project ID** | ID project Google Cloud (hiển thị ở header Cloud Console) |
| **Service Account JSON Key** | Dán toàn bộ nội dung file `.json` đã tải ở Bước 3c |

4. Nhấn **Lưu thông tin**.

Các badge trạng thái ở đầu phần cài đặt sẽ chuyển sang màu xanh khi tất cả trường đã được điền.

---

## Bước 5 — Kiểm tra liên kết tài khoản

1. Mở ứng dụng **Google Home** trên điện thoại.
2. Nhấn **+** → **Thiết lập thiết bị** → **Hoạt động với Google**.
3. Tìm kiếm tên action của bạn (tên đã đặt ở Bước 1).
4. Nhấn vào, rồi đăng nhập bằng tên đăng nhập và mật khẩu E-Connect.
5. Sau khi đăng nhập, Google sẽ chuyển hướng về và đồng bộ thiết bị tự động.

Tất cả thiết bị E-Connect sẽ xuất hiện trong ứng dụng Google Home sau vài giây.

---

## Bước 6 — Lệnh giọng nói

Sau khi liên kết, bạn có thể nói:

| Lệnh | Hành động |
|---|---|
| `"OK Google, bật [tên thiết bị]"` | Bật thiết bị |
| `"OK Google, tắt [tên thiết bị]"` | Tắt thiết bị |
| `"OK Google, đặt [tên thiết bị] 50%"` | Đặt độ sáng/tốc độ quạt về 50% |
| `"OK Google, giảm độ sáng [tên thiết bị]"` | Giảm độ sáng |
| `"OK Google, đồng bộ thiết bị của tôi"` | Đồng bộ lại danh sách thiết bị |

> **Mẹo:** Tên thiết bị trong Google Home khớp với tên bạn đặt trong E-Connect. Đổi tên thiết bị trong **E-Connect → Thiết bị** để Google nhận dạng giọng nói tốt hơn.

---

## Đồng bộ & Liên kết lại

- **Thêm thiết bị mới** — Vào **Cài đặt → Google Home** và nhấn **Đồng bộ thiết bị**, hoặc nói *"OK Google, đồng bộ thiết bị của tôi"*.
- **Hủy liên kết** — Vào **Cài đặt → Google Home** và nhấn **Hủy liên kết**. Bạn có thể liên kết lại bất cứ lúc nào.
- **Thay đổi thông tin đăng nhập** — Nếu bạn thay đổi Client Secret, tất cả người dùng đã liên kết cần phải liên kết lại tài khoản.

---

## Xử lý sự cố

### Google không thể kết nối tới máy chủ

Đảm bảo máy chủ có thể truy cập từ internet. Kiểm tra bằng cách mở URL sau trên trình duyệt:

```
https://<domain-công-khai-của-bạn>/api/v1/google/fulfillment
```

Bạn sẽ nhận được phản hồi `401 Missing authorization` (không phải lỗi kết nối) — điều này xác nhận endpoint có thể truy cập được.

### "Service unavailable" khi liên kết tài khoản

Điều này có nghĩa là `GOOGLE_HOME_CLIENT_ID` và `GOOGLE_HOME_CLIENT_SECRET` chưa được thiết lập. Kiểm tra phần **Thông tin Google Cloud** trong Cài đặt.

### Thiết bị không xuất hiện trong Google Home

Sau khi liên kết, nhấn **Đồng bộ thiết bị** trong Cài đặt hoặc nói *"OK Google, đồng bộ thiết bị của tôi"*. Nếu thiết bị vẫn không xuất hiện, kiểm tra xem thiết bị đã được **phê duyệt** (không ở trạng thái pending) trong E-Connect chưa.

### Trạng thái cũ trong Google Home

Trạng thái cũ có nghĩa là Report State không hoạt động. Kiểm tra:
- **Google Cloud Project ID** đã được điền đúng trong Cài đặt.
- **Service Account JSON Key** thuộc đúng project.
- **HomeGraph API** đã được bật trong Google Cloud project.

---

## Biến môi trường (thay thế cho giao diện)

Thay vì dùng giao diện Cài đặt, bạn cũng có thể cấu hình thông qua biến môi trường trong `docker-compose.yml` hoặc file `.env`:

```env
GOOGLE_HOME_CLIENT_ID=your-client-id
GOOGLE_HOME_CLIENT_SECRET=your-client-secret
GOOGLE_HOME_PROJECT_ID=your-gcloud-project-id
GOOGLE_HOME_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
```

> **Lưu ý:** Cài đặt được lưu qua giao diện có độ ưu tiên cao hơn biến môi trường.

---

## Lưu ý bảo mật

- Client Secret OAuth 2.0 và JSON key Service Account được lưu trong cơ sở dữ liệu E-Connect. Không bao giờ chia sẻ chúng công khai.
- Endpoint fulfillment chỉ chấp nhận các yêu cầu mang access token E-Connect hợp lệ được cấp trong quá trình OAuth account-linking.
- JSON key service account chỉ được dùng phía máy chủ — không bao giờ hiển thị cho người dùng.

---

*Phiên bản hướng dẫn: 1.0 — E-Connect 2026*
