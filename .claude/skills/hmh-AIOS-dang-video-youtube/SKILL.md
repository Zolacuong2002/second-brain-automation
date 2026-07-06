---
name: hmh-AIOS-dang-video-youtube
description: >
  Đăng/upload video lên kênh YouTube TỪ một bảng Lark Base — mỗi dòng là 1 video (file đính kèm attachment) với
  tiêu đề, mô tả, tag, chế độ riêng tư, lịch đăng. Skill đọc các dòng "Chờ đăng", tải file từ Lark, upload lên
  YouTube qua Data API v3 (resumable, OAuth 2.0), rồi ghi Video ID + link + trạng thái ngược lại bảng. Chạy THEO
  YÊU CẦU (không quét nền). Kèm script tạo sẵn bảng đúng schema và script lấy OAuth refresh token.
  Dùng khi người dùng muốn: đăng video YouTube từ Lark Base, upload hàng loạt video lên YouTube, lên lịch đăng
  YouTube từ bảng, dựng bộ đăng YouTube cho học viên/khách.
  Kích hoạt khi có từ: đăng video youtube, upload youtube từ lark, đăng youtube từ larkbase, bảng đăng video youtube,
  lên lịch đăng youtube, post video youtube, tự động đăng youtube.
---

# Skill: Đăng video YouTube từ Lark Base

Từ một bảng Lark Base chứa video (attachment) → **upload lên kênh YouTube của bạn** rồi ghi kết quả về bảng.
Chạy **theo yêu cầu** (chỉ khi được gọi). Song hành với `dang-reel-facebook` (đăng Reel FB) — đây là bản cho YouTube.

## Nguồn / chuẩn kỹ thuật
- **YouTube Data API v3 – `videos.insert`** (resumable upload). Upload BẮT BUỘC **OAuth 2.0** của chủ kênh
  (scope `youtube.upload`) — **API key KHÔNG upload được**. https://developers.google.com/youtube/v3/docs/videos/insert
- **Lark Base Open API**: đọc record, tải attachment (`drive/v1/medias/{token}/download`), cập nhật record.

## Khi nào dùng / KHÔNG dùng
- **Dùng**: có sẵn file video trong Lark, muốn đẩy lên YouTube (public/unlisted/private hoặc hẹn giờ) và theo dõi trạng thái.
- **KHÔNG dùng** để LẤY dữ liệu kênh/video về Lark → đó là `hmh-AIOS-sync-youtube-lark`.

## Tiền điều kiện (BẮT BUỘC)
1. **Lark app** có quyền SỬA Base (scope `bitable:app` + `drive:drive`, đã phát hành, là cộng tác viên **Editable**).
2. **Google Cloud project**: bật *YouTube Data API v3*; tạo **OAuth client ID = Desktop app** (lấy client_id + secret);
   OAuth consent screen thêm email chủ kênh vào **Test users** (nếu app đang Testing).
3. **Refresh token**: chạy `get-oauth-token.mjs` một lần để uỷ quyền và lưu token.
4. ⚠️ **Quota & xác minh**: mỗi lần upload tốn **~1.600 đơn vị** quota (mặc định 10.000/ngày ≈ 6 video/ngày — xin tăng quota nếu cần). Project OAuth **chưa được Google xác minh** thì video upload có thể bị khoá ở chế độ *private* cho tới khi xác minh.

## Quy trình thực thi

### Bước 1 — Tạo bảng đăng (một lần)
```bash
node ".claude/skills/hmh-AIOS-dang-video-youtube/scripts/setup-table.mjs"
```
Copy `table_id` in ra → dán vào `config.local.json` → `tablePost`. Bảng gồm cột:
`Tiêu đề` · `Video`(attachment) · `Mô tả` · `Tags`(phân tách bằng dấu phẩy) · `Chế độ`(private/unlisted/public) ·
`Trạng thái`(Chờ đăng/Đang đăng/Đã đăng/Lỗi) · `Lịch đăng`(datetime, để trống = đăng ngay) ·
`Video ID` · `Link video` · `Ngày đăng` · `Ghi chú lỗi`.

### Bước 2 — Cấu hình + lấy OAuth token (một lần)
Điền `config.local.json` (xem `config.example.json`): Lark creds, `appToken`, `tablePost`, `oauthClientId`,
`oauthClientSecret`. Rồi:
```bash
node ".claude/skills/hmh-AIOS-dang-video-youtube/scripts/get-oauth-token.mjs"
```
Mở URL in ra bằng trình duyệt đang đăng nhập **tài khoản chủ kênh** → *Cho phép*. Script tự bắt code và lưu
`oauthRefreshToken` vào config.

### Bước 3 — Nhập liệu vào bảng
Mỗi video = 1 dòng: đặt `Tiêu đề`, kéo file mp4 vào cột `Video`, điền `Mô tả`/`Tags`/`Chế độ`, đặt
`Trạng thái` = **Chờ đăng**. Muốn hẹn giờ: điền `Lịch đăng` (khi đó video được đặt *private* + `publishAt`).

### Bước 4 — Đăng
```bash
node ".claude/skills/hmh-AIOS-dang-video-youtube/scripts/post-video-youtube.mjs --dry-run   # xem danh sách sẽ đăng
node ".claude/skills/hmh-AIOS-dang-video-youtube/scripts/post-video-youtube.mjs --limit 1   # đăng thử 1 video
node ".claude/skills/hmh-AIOS-dang-video-youtube/scripts/post-video-youtube.mjs             # đăng hết "Chờ đăng"
```
Sau mỗi video: bảng cập nhật `Trạng thái`, `Video ID`, `Link video`, `Ngày đăng` (lỗi → `Trạng thái`=Lỗi + `Ghi chú lỗi`).

## Lưu ý (gotcha)
- **Chống trùng**: chỉ đăng dòng `Trạng thái = Chờ đăng` có file. Đăng xong tự chuyển `Đã đăng` → chạy lại không đăng lại.
- **File lớn**: script tải cả file về `%TEMP%` rồi PUT một lần → cần đủ RAM/đĩa cho video lớn. Video rất lớn nên tách nhỏ số lượng.
- **Hẹn giờ** chỉ hiệu lực khi `publishAt` ở tương lai; YouTube giữ video *private* tới giờ đó rồi tự công khai.
- **Category**: mặc định `defaultCategoryId=22`. `Chế độ` để trống → dùng `defaultPrivacy`.
- **Lỗi hay gặp**: `403 quotaExceeded` (hết quota ngày) · `401`/`invalid_grant` (refresh token sai/thu hồi → chạy lại Bước 2) · `forbidden` (kênh chưa bật upload / project chưa xác minh).

## Tham chiếu
- `scripts/setup-table.mjs` — tạo bảng đăng đúng schema.
- `scripts/get-oauth-token.mjs` — lấy refresh token (loopback localhost).
- `scripts/post-video-youtube.mjs` — script đăng chính.
- `scripts/config.example.json` — mẫu cấu hình.
