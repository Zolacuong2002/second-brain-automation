---
name: hmh-AIOS-sync-youtube-lark
description: >
  Đồng bộ dữ liệu KÊNH và VIDEO từ YouTube Data API v3 vào Lark Base (2 bảng: kênh & video). Lấy số liệu thật
  (subscriber, view, like, comment, videoCount, tag, thời gian đăng, mô tả), tải thumbnail YouTube rồi upload
  thật lên Lark thành attachment, và UPSERT (kênh theo link; video theo "video id") nên chạy lại không tạo bản trùng.
  Dùng khi người dùng muốn: kéo dữ liệu một kênh YouTube về Lark Base, cập nhật/làm mới thống kê kênh & video trong
  Larkbase, đồng bộ danh sách video của kênh vào bảng, dựng data nghiên cứu kênh trên Lark.
  Kích hoạt khi có từ: lấy dữ liệu kênh, lấy dữ liệu video, đồng bộ youtube lên lark, youtube vào larkbase,
  sync youtube lark, kéo video về lark, cập nhật số liệu kênh, đổ dữ liệu youtube vào bảng.
---

# Skill: Đồng bộ YouTube → Lark Base (kênh & video)

Gọi **YouTube Data API v3 thật** để lấy dữ liệu một kênh + toàn bộ video của kênh, rồi ghi vào **2 bảng Lark Base**
(một bảng kênh, một bảng video) theo cơ chế **upsert** — số liệu là thật, chạy lại không nhân bản record.

## Nguồn / chuẩn kỹ thuật
- **YouTube Data API v3** (Google): `channels.list` (snippet, statistics, contentDetails), `playlistItems.list`
  (duyệt playlist "uploads" của kênh), `videos.list` (snippet + statistics). — https://developers.google.com/youtube/v3/docs
- **Lark Base (Bitable) Open API**: `tenant_access_token`, `bitable/v1/.../records` (create/update/list),
  và `drive/v1/medias/upload_all` (`parent_type=bitable_image`) để đưa thumbnail thành attachment.
  — https://open.larksuite.com/document

## Khi nào dùng / KHÔNG dùng
- **Dùng**: cần đổ/ làm mới dữ liệu 1 kênh YouTube vào Lark Base có sẵn 2 bảng đúng schema (kênh, video).
- **KHÔNG dùng** để nghiên cứu/xếp hạng video theo chủ đề → đó là `hmh-mkt-research-youtube` (không ghi Lark).

## Tiền điều kiện (BẮT BUỘC — hay là điểm chặn)
1. **YouTube API key** còn quota (mỗi lần sync tốn ~50–60 đơn vị cho kênh ~1.3k video).
2. **Lark custom app** (App ID + Secret) đã bật scope: `bitable:app` (đọc+ghi Base) **và** `drive:drive`
   (upload media). Nhớ **Tạo phiên bản & phát hành** app sau khi thêm scope.
3. ⚠️ **App phải là cộng tác viên có quyền SỬA của Base** đó. Nếu chỉ có quyền đọc → ghi sẽ trả
   `91403 Forbidden` (record) và `1061004 forbidden` (upload ảnh) dù đọc vẫn OK.
   Sửa: mở Base → **Chia sẻ / Add collaborators** → thêm app (bot) → chọn **Có thể chỉnh sửa (Editable)**.
4. **2 bảng Lark đúng schema** (tên cột khớp):
   - Bảng kênh: `channel`(URL), `channel description`(text), `thumbnails`(attachment),
     `channel videoCount` / `channel viewCount` / `channel subscriberCount`(number), `country`(single select),
     `channel create time`(datetime).
   - Bảng video: `video`(URL), `video description`(text), `video id`(text), `video tag`(multi-select),
     `publish time`(datetime), `thumbnails`(attachment),
     `viewCount` / `likeCount` / `favoriteCount` / `commentCount`(number), `channel`(URL).

## Quy trình thực thi

### Bước 1 — Cấu hình
Copy `scripts/config.example.json` → `scripts/config.local.json`, điền: `youtubeApiKey`, `larkAppId`,
`larkAppSecret`, `larkDomain`, `appToken` (base_id), `tableChannel`, `tableVideo`, `channel` (`@handle` hoặc `UCxxxx`).
> `config.local.json` chứa secret — không commit công khai.

### Bước 2 — Chạy đồng bộ
```bash
node ".claude/skills/hmh-AIOS-sync-youtube-lark/scripts/sync-youtube-lark.mjs"
```
Cờ tuỳ chọn:
- `--only channel` | `--only video` | `--only all` (mặc định `all`).
- `--limit N` — chỉ xử lý N video mới nhất (test nhanh trước khi kéo full).
- `--refresh-thumbs` — tải & upload lại thumbnail cả với record đã có ảnh (mặc định BỎ QUA record đã có ảnh để chạy lại nhanh & tiết kiệm).
- `--config <path>` — dùng file config khác.

Gợi ý: chạy `--only channel` trước (nhẹ, kiểm tra quyền ghi + upload ảnh), rồi `--limit 20` để thử video,
cuối cùng bỏ cờ để full sync.

### Bước 3 — Kiểm tra
Script in tiến độ (`... i/total tạo X cập nhật Y`) và tổng kết. Mở Lark Base đối chiếu số record & thumbnail.

## Cơ chế & lưu ý (gotcha)
- **Upsert**: kênh khớp theo link chứa `channelId` hoặc trùng tên; video khớp theo cột `video id`. Chạy lại =
  cập nhật số liệu, không tạo trùng.
- **Thumbnail resumable**: mặc định chỉ upload ảnh cho record CHƯA có thumbnail → nếu job đứt giữa chừng, chạy lại
  sẽ bỏ qua ảnh đã có, chỉ làm phần còn thiếu. Muốn làm mới hết ảnh: `--refresh-thumbs`.
- **Chậm do ảnh**: full ~1.3k video = ~1.3k lần tải+upload ảnh → mất nhiều thời gian. Có thể chạy `--limit` nhiều đợt.
- **Quota YouTube**: playlistItems + videos.list phân trang 50/lần; theo dõi để không vượt 10.000 đơn vị/ngày.
- **Domain**: kênh quốc tế dùng `open.larksuite.com`; tenant Trung Quốc dùng `open.feishu.cn`.
- **Lỗi thường gặp**: `91403 Forbidden` = app thiếu quyền sửa Base (xem Tiền điều kiện #3); `1061004 forbidden` =
  thiếu scope `drive:drive` hoặc quyền sửa Base; token hết hạn được tự refresh.

## Tham chiếu
- `scripts/sync-youtube-lark.mjs` — script chính (Node ≥ 18, zero-dependency).
- `scripts/config.example.json` — mẫu cấu hình.
