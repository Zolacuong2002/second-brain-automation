---
type: output
title: QUY TRÌNH ĐƠN GIẢN — Tự động đăng YouTube từ Lark Base (ai cũng làm được)
created: 2026-07-06
updated: 2026-07-06
tags: [huong-dan, quy-trinh, lark-base, youtube, github, automation]
sources: [hmh-AIOS-dang-video-youtube]
---

# 🚀 TỰ ĐỘNG ĐĂNG YOUTUBE TỪ LARK BASE — LÀM TỪNG BƯỚC

> Điền video + tiêu đề/mô tả vào Lark → bấm 1 nút → máy tự upload lên kênh YouTube của bạn.
> Chạy trên GitHub (không cần bật máy tính). Làm theo đúng thứ tự dưới đây.

**Code để fork:** `https://github.com/cuong-master/mentor-club`
> Các giá trị `cli_...`, `tbl...`, `AIza...` bên dưới chỉ là **ví dụ** — thay bằng giá trị của bạn.
> Khác với Facebook, YouTube **bắt buộc OAuth**: phải làm 1 lần Bước 3–4 để lấy "refresh token".

---

## 📋 DANH SÁCH BẮT BUỘC ĐIỀN (bảng tự kiểm)

**A. Trên GitHub — tab _Secrets_ (bí mật):**
- [ ] `LARK_APP_SECRET` — **bắt buộc**
- [ ] `YT_OAUTH_CLIENT_SECRET` — **bắt buộc** (Client secret của OAuth)
- [ ] `YT_OAUTH_REFRESH_TOKEN` — **bắt buộc** (lấy ở Bước 4)

**B. Trên GitHub — tab _Variables_ (mã cấu hình):**
- [ ] `LARK_APP_ID` — **bắt buộc**
- [ ] `LARK_BASE_ID` — **bắt buộc**
- [ ] `TABLE_POST` — **bắt buộc** (mã bảng đăng video)
- [ ] `YT_OAUTH_CLIENT_ID` — **bắt buộc**
- [ ] `YT_CATEGORY_ID` — *(tùy chọn, mặc định 22)*
- [ ] `YT_PRIVACY` — *(tùy chọn: private / unlisted / public)*

**C. Trên Lark:**
- [ ] Đã thêm App vào Base với quyền **Can edit**
- [ ] Bảng đăng có cột `Video` (Tệp đính kèm), `Trạng thái` (Chọn 1), `Đăng` (Nút bấm)

---

## 🟩 BƯỚC 1 — Fork code về GitHub của bạn
1. Mở `https://github.com/cuong-master/mentor-club` → **Fork** → **Create fork**.
2. Vào tab **Actions** của repo vừa fork → bấm **“I understand my workflows, go ahead and enable them”**.

## 🟩 BƯỚC 2 — Tạo GitHub Token (chìa khóa điều khiển)
1. `https://github.com/settings/tokens` → **Generate new token (classic)**.
2. Tick **`repo`** và **`workflow`** → Generate → copy chuỗi `ghp_...` (chỉ hiện 1 lần).

## 🟩 BƯỚC 3 — Tạo OAuth trên Google (chỉ làm 1 lần)
> Đây là phần khác Facebook. YouTube không cho dùng API key để đăng — phải uỷ quyền chủ kênh.
1. Mở **Google Cloud Console** → chọn/ tạo project → **APIs & Services → Enable** **YouTube Data API v3**.
2. **Credentials → Create OAuth client ID** → *Application type* = **Desktop app** → copy **Client ID** và **Client secret**.
3. **OAuth consent screen** → mục **Test users** → **Add users** → nhập **email chủ kênh YouTube** (nếu app đang "Testing").

## 🟩 BƯỚC 4 — Lấy Refresh Token (chạy 1 lần trên máy có Node)
1. Mở `.claude/skills/hmh-AIOS-dang-video-youtube/scripts/config.local.json`, điền `oauthClientId`, `oauthClientSecret` (Bước 3).
2. Chạy:
   ```
   node ".claude/skills/hmh-AIOS-dang-video-youtube/scripts/get-oauth-token.mjs"
   ```
3. Mở URL in ra bằng **trình duyệt đang đăng nhập tài khoản chủ kênh** → **Cho phép**
   (nếu hiện "chưa xác minh" → *Nâng cao → Đi tới … không an toàn*).
4. Xong, script tự lưu `oauthRefreshToken` vào config. **Copy chuỗi này** để dán lên GitHub Secret ở Bước 6.
   > Không có máy chạy Node? Nhờ người dựng chạy hộ Bước 4 rồi gửi bạn 3 giá trị: Client ID, Client secret, Refresh token.

## 🟩 BƯỚC 5 — Chuẩn bị App Lark + cho app vào Base
1. **Lark Developer Console** → app → **Credentials**: copy **App ID** (`cli_...`) + **App Secret**.
2. **Permissions & Scopes**: bật **`bitable:app`** + **`drive:drive`** → **Publish**.
3. **Cho app quyền sửa Base:** Base → **`•••`** → **Add document application** → chọn app → **Can edit**.
   > Bỏ bước này = lỗi "Forbidden", không ghi được vào Base.

## 🟩 BƯỚC 6 — Khai báo cấu hình TRÊN GITHUB
Repo fork → **Settings → Secrets and variables → Actions**.

**6A. Tab _Secrets_:**
| Tên | Giá trị |
|---|---|
| `LARK_APP_SECRET` | App Secret (Bước 5) |
| `YT_OAUTH_CLIENT_SECRET` | Client secret (Bước 3) |
| `YT_OAUTH_REFRESH_TOKEN` | Refresh token (Bước 4) |

**6B. Tab _Variables_:**
| Tên | Giá trị (ví dụ) |
|---|---|
| `LARK_APP_ID` | `cli_aa8cccd0b262deed` |
| `LARK_BASE_ID` | `ZM8qbz78JaR16Es560sly6Bkgvg` |
| `TABLE_POST` | `tbloXF3Xyz7NJek9` |
| `YT_OAUTH_CLIENT_ID` | `7597...apps.googleusercontent.com` |
| `YT_CATEGORY_ID` | `22` |
| `YT_PRIVACY` | `private` |

## 🟩 BƯỚC 7 — Chuẩn bị bảng đăng trong Lark
Bảng **"Đăng video YouTube"** cần các cột (đã có sẵn nếu chạy `setup-table.mjs`):
| Cột | Kiểu |
|---|---|
| `Tiêu đề` | Văn bản |
| `Video` | **Tệp đính kèm** (file mp4) |
| `Mô tả` | Văn bản |
| `Tags` | Văn bản (cách nhau dấu phẩy) |
| `Chế độ` | Chọn 1: `private`, `unlisted`, `public` |
| `Trạng thái` | Chọn 1: `Chờ đăng`, `Đang đăng`, `Đã đăng`, `Lỗi` |
| `Lịch đăng` | Ngày giờ (để trống = đăng ngay) |
| `Đăng` | **Nút bấm (Button)** ← tạo tay |
| `Video ID`, `Link video`, `Ngày đăng`, `Ghi chú lỗi` | máy tự điền |

## 🟩 BƯỚC 8 — Tạo nút bấm tự đăng (Automation)
1. Trong bảng, tạo cột **`Đăng`** kiểu **Nút bấm** (nếu chưa có).
2. Base → **Tự động hóa** → **Tạo mới**:
   - **Khi:** "Một nút được nhấp" → cột **Đăng**.
   - **Thì:** "Gửi yêu cầu HTTP":
     - **Method:** `POST`
     - **URL:** `https://api.github.com/repos/<tên-bạn>/mentor-club/dispatches`
     - **Headers:**
       - `Authorization: Bearer <TOKEN GITHUB>`
       - `Accept: application/vnd.github+json`
       - `Content-Type: application/json`
     - **Body:**
       ```json
       {"event_type":"dang-video-youtube","client_payload":{"record_id":"{{Record ID}}"}}
       ```
       (`{{Record ID}}` = chèn biến động "Record ID", đừng gõ tay)
3. **Bật** automation.

## ✅ BƯỚC 9 — Dùng hằng ngày
Trong bảng, 1 dòng:
1. Viết **Tiêu đề** + **Mô tả** + **Tags**
2. Kéo **file video** vào cột **Video**
3. Chọn **Chế độ** (private/unlisted/public); muốn hẹn giờ thì điền **Lịch đăng**
4. Bấm nút **Đăng**

→ Sau ~1–3 phút (tuỳ dung lượng): dòng chuyển **Trạng thái = Đã đăng** + hiện **Link video** + **Video ID**.
Lỗi → **Lỗi** + lý do ở cột **Ghi chú lỗi**.

---

## 🆘 Gặp lỗi — tra nhanh
| Log/hiện tượng | Cách xử lý |
|---|---|
| `Forbidden` (Lark) | Chưa cho app vào Base với quyền **Can edit** (Bước 5.3) |
| `TableIdNotFound` | Sai `LARK_BASE_ID` / `TABLE_POST` trong Variables |
| `invalid_grant` | Refresh token sai/bị thu hồi → làm lại Bước 4, cập nhật Secret |
| `quotaExceeded` | Hết quota ngày (~1.600 đơn vị/video, mặc định 10.000/ngày ≈ 6 video). Xin tăng quota. |
| `forbidden` / video khoá private | Project OAuth chưa được Google xác minh → chỉ đăng private được cho tới khi xác minh |
| Bấm Đăng không lên | Chưa bật Actions (Bước 1); dòng thiếu **Video**; sai URL/token trong Automation |
| Muốn đăng lại 1 dòng | Xoá chữ "Đã đăng" ở cột Trạng thái → bấm Đăng lại |

## 🔒 Lưu ý an toàn & bàn giao
- GitHub token, App Secret, Client secret, Refresh token là chìa khóa — **không đăng công khai**; nên rotate định kỳ.
- **Khi bàn giao:** chỉ đưa **link code để fork** + hướng dẫn này. Mỗi người **tự tạo OAuth của mình** (Bước 3–4) và tự điền Secrets/Variables. **KHÔNG** gửi file `config.local.json` đã điền.
- Quota upload thấp (~6 video/ngày mặc định) → đăng nhiều thì xin tăng quota trong Google Cloud.
