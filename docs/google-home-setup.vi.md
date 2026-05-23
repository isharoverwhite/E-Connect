# Tích hợp Google Home — Hướng dẫn cài đặt

> **Thời gian:** ~15 phút  
> **Đối tượng:** Quản trị viên máy chủ  
> **Điều kiện:** Máy chủ E-Connect đang chạy và có thể truy cập từ internet (qua port forwarding, Cloudflare Tunnel, ngrok, v.v.)

---

## Tổng quan

E-Connect tích hợp với Google Home theo dạng **Smart Home Action**. Sau khi cấu hình, tất cả người dùng trên máy chủ có thể liên kết tài khoản E-Connect với Google Home và điều khiển thiết bị bằng giọng nói:

```
"OK Google, bật đèn phòng khách"
"OK Google, đặt quạt phòng ngủ 50%"
"OK Google, tắt tất cả thiết bị"
```

Tích hợp hoạt động theo nguyên tắc:
1. **Máy chủ của bạn** đóng vai trò OAuth 2.0 authorization server — người dùng đăng nhập vào E-Connect để liên kết tài khoản Google.
2. **Máy chủ Google** gọi webhook fulfillment của bạn để gửi lệnh SYNC / QUERY / EXECUTE.
3. **Report State** đẩy trạng thái thiết bị theo thời gian thực về Google qua Home Graph API.

Bạn cần thu thập **4 thông tin** từ Google để điền vào E-Connect:

| Trường trong E-Connect | Lấy từ đâu |
|---|---|
| **OAuth2 Client ID** | Tự đặt khi cấu hình Account Linking trong Google Home Developer Console |
| **OAuth2 Client Secret** | Tự đặt khi cấu hình Account Linking trong Google Home Developer Console |
| **Google Cloud Project ID** | Trang Settings của project trong Google Home Developer Console |
| **Service Account JSON Key** | Google Cloud Console — tải xuống từ Service Account |

---

## Bước 1 — Mở E-Connect Settings → Google Home

Đăng nhập vào E-Connect bằng tài khoản **admin**, vào **Settings** và cuộn xuống mục **Google Home**.

Bạn sẽ thấy phần **Google Cloud Credentials** với 4 trường cần điền (hiện đang trống). Đây là đích đến cuối cùng — các bước tiếp theo hướng dẫn bạn thu thập đủ 4 giá trị đó.

> Phần cài đặt Google Cloud Credentials chỉ hiển thị với tài khoản admin.

---

## Bước 2 — Tạo project trong Google Home Developer Console

Truy cập: **https://console.home.google.com/projects**

1. Nhấn **Create a project**.
2. Nhập tên project (ví dụ: `E-Connect`) và nhấn **Create project**.
3. Sau khi tạo xong, **ghi lại Project ID** — đây là giá trị **Google Cloud Project ID** sẽ điền ở Bước 5.
   > Project ID thường có dạng `my-project-abc123`, hiển thị trong URL hoặc phần Settings của project.

---

## Bước 3 — Cấu hình Smart Home Fulfillment

Trong project vừa tạo, vào **Develop → Actions** ở menu bên trái.

Tại mục **Fulfillment URL**, điền:

```
https://<domain-công-khai-của-bạn>/api/v1/google/fulfillment
```

> Thay `<domain-công-khai-của-bạn>` bằng hostname hoặc IP công khai của máy chủ E-Connect.  
> Ví dụ: `https://myhome.duckdns.org/api/v1/google/fulfillment`

Nhấn **Save**.

---

## Bước 4 — Cấu hình Account Linking (OAuth 2.0)

Trong cùng project, vào **Develop → Account linking**.

Điền các trường sau:

| Trường | Giá trị |
|---|---|
| **Linking type** | OAuth |
| **Grant type** | Authorization code |
| **Client ID** | Chuỗi bí mật bạn tự đặt — lưu lại, đây là **OAuth2 Client ID** |
| **Client secret** | Chuỗi bí mật khác bạn tự đặt — lưu lại, đây là **OAuth2 Client Secret** |
| **Authorization URL** | `https://<domain-công-khai-của-bạn>/api/v1/google/auth` |
| **Token URL** | `https://<domain-công-khai-của-bạn>/api/v1/google/token` |

> **Tạo Client ID / Secret ngẫu nhiên:**
> ```bash
> python3 -c "import uuid; print(uuid.uuid4())"
> ```
> Chạy lệnh này hai lần — một lần cho Client ID, một lần cho Client Secret.

Nhấn **Save**.

---

## Bước 5 — Bật Home Graph API

Home Graph API cho phép E-Connect đẩy trạng thái thiết bị về Google theo thời gian thực.

Truy cập Google Cloud Console — đảm bảo đang ở đúng project vừa tạo ở Bước 2:

**https://console.cloud.google.com/apis/library/homegraph.googleapis.com**

Nhấn **Enable**.

> Nếu bạn chưa chọn đúng project, nhấn vào tên project ở góc trên bên trái và chọn project Google Home.

---

## Bước 6 — Tạo Service Account và tải JSON Key

Service Account cho phép máy chủ E-Connect xác thực với Home Graph API để gửi Report State.

### 6a — Tạo Service Account

Truy cập: **https://console.cloud.google.com/iam-admin/serviceaccounts**

1. Nhấn **+ Create service account**.
2. Đặt tên (ví dụ: `econnect-homegraph`) và nhấn **Create and continue**.
3. Bỏ qua phần Permissions và Grant access — nhấn **Done**.

### 6b — Tải JSON Key

1. Nhấn vào **email** của service account vừa tạo để mở trang chi tiết.
2. Chuyển sang tab **Keys**.
3. Nhấn **Add Key → Create new key → JSON → Create**.
4. File `.json` sẽ được tải xuống tự động — đây là **Service Account JSON Key**.

File JSON có cấu trúc như sau:

```json
{
  "type": "service_account",
  "project_id": "your-project-id",
  "private_key_id": "...",
  "private_key": "-----BEGIN RSA PRIVATE KEY-----\n...",
  "client_email": "econnect-homegraph@your-project.iam.gserviceaccount.com",
  ...
}
```

> Giữ file này an toàn — đây là thông tin xác thực có quyền truy cập Home Graph API của bạn.

---

## Bước 7 — Điền thông tin vào E-Connect

Quay lại E-Connect → **Settings → Google Home**, điền 4 trường trong phần **Google Cloud Credentials**:

| Trường | Giá trị |
|---|---|
| **OAuth2 Client ID** | Client ID bạn tự đặt ở Bước 4 |
| **OAuth2 Client Secret** | Client Secret bạn tự đặt ở Bước 4 |
| **Google Cloud Project ID** | Project ID ghi lại từ Bước 2 |
| **Service Account JSON Key** | Dán toàn bộ nội dung file `.json` tải ở Bước 6b |

Nhấn **Save Credentials**.

Các badge trạng thái ở đầu phần cài đặt sẽ chuyển sang màu xanh khi tất cả trường đã được điền đúng.

---

## Bước 8 — Liên kết Google Home App

Mỗi người dùng trên máy chủ thực hiện bước này trên điện thoại của họ:

1. Mở app **Google Home**.
2. Nhấn **+** → **Set up device** → **Works with Google**.
3. Tìm kiếm tên action của bạn (tên đặt ở Bước 2).
4. Nhấn vào, đăng nhập bằng tên đăng nhập và mật khẩu E-Connect.
5. Sau khi đăng nhập, Google tự động đồng bộ thiết bị.

Tất cả thiết bị E-Connect sẽ xuất hiện trong Google Home sau vài giây.

---

## Lệnh giọng nói

Sau khi liên kết, bạn có thể nói:

| Lệnh | Hành động |
|---|---|
| `"OK Google, bật [tên thiết bị]"` | Bật thiết bị |
| `"OK Google, tắt [tên thiết bị]"` | Tắt thiết bị |
| `"OK Google, đặt [tên thiết bị] 50%"` | Đặt độ sáng / tốc độ quạt 50% |
| `"OK Google, giảm độ sáng [tên thiết bị]"` | Giảm độ sáng |
| `"OK Google, đồng bộ thiết bị của tôi"` | Đồng bộ lại danh sách thiết bị |

> Tên thiết bị trong Google Home khớp với tên đặt trong E-Connect. Đổi tên thiết bị trong **E-Connect → Devices** để cải thiện nhận diện giọng nói.

---

## Đồng bộ & Hủy liên kết

- **Thêm thiết bị mới** — Vào **Settings → Google Home** và nhấn **Sync Devices**, hoặc nói _"OK Google, đồng bộ thiết bị của tôi"_.
- **Hủy liên kết** — Vào **Settings → Google Home** và nhấn **Unlink Account**. Có thể liên kết lại bất cứ lúc nào.
- **Đổi Client Secret** — Nếu bạn thay đổi Client Secret, tất cả người dùng đã liên kết cần phải liên kết lại tài khoản.

---

## Xử lý sự cố

### Google không thể kết nối tới máy chủ

Xác nhận máy chủ có thể truy cập từ internet bằng cách mở URL sau trong trình duyệt:

```
https://<domain-công-khai-của-bạn>/api/v1/google/fulfillment
```

Bạn sẽ nhận phản hồi `401 Missing authorization` — không phải lỗi kết nối. Đây là dấu hiệu endpoint đang hoạt động bình thường.

### "Service unavailable" khi liên kết tài khoản

OAuth Client ID hoặc Client Secret chưa được lưu. Kiểm tra lại phần **Google Cloud Credentials** trong Settings và nhấn **Save Credentials**.

### Thiết bị không xuất hiện sau khi liên kết

Nhấn **Sync Devices** trong Settings hoặc nói _"OK Google, đồng bộ thiết bị của tôi"_. Nếu vẫn không xuất hiện, kiểm tra xem thiết bị đã được **phê duyệt** (không ở trạng thái pending) trong E-Connect chưa.

### Trạng thái cũ / không đồng bộ trong Google Home

Report State không hoạt động. Kiểm tra:
- **Google Cloud Project ID** đã điền đúng trong Settings.
- **Service Account JSON Key** thuộc đúng project Google Cloud.
- **Home Graph API** đã được bật trong Google Cloud project (Bước 5).

### Không tìm thấy E-Connect trong "Works with Google"

Action cần được **Test** trước khi xuất hiện trong danh sách. Trong Google Home Developer Console, vào **Test** và bật chế độ thử nghiệm.

---

## Checklist

- [ ] Tạo project trong Google Home Developer Console → ghi lại **Project ID**
- [ ] Cấu hình **Fulfillment URL** trong Developer Console
- [ ] Cấu hình **Account Linking** — đặt Client ID & Client Secret → ghi lại cả hai
- [ ] Bật **Home Graph API** trong Google Cloud Console
- [ ] Tạo **Service Account** → tải xuống **JSON Key**
- [ ] Điền 4 trường trong **E-Connect → Settings → Google Home** → nhấn **Save Credentials**
- [ ] Liên kết qua Google Home App → kiểm tra thiết bị xuất hiện

---

*Phiên bản hướng dẫn: 2.0 — E-Connect 2026*
