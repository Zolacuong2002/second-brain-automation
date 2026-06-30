---
name: seed-bai-viet
description: Cào toàn bộ bài viết trong MỘT category WordPress (qua WP REST API) rồi ghi vào bảng "BÀI VIẾT" trên Lark Base, tự bỏ qua bài đã có. Dùng khi cần seed/đồng bộ danh sách bài của một chuyên mục vào Lark.
---

# Seed bài viết: WordPress category → Lark Base

Cào hết bài trong một category WordPress và ghi vào bảng **BÀI VIẾT** trên Lark Base.

## Cách chạy

```bash
python scripts/seed_category.py \
  --wp-url "https://example.com" \
  --category "ten-category-slug" \
  --app-token "<app_token Lark Base>" \
  --table-id "<table_id bảng BÀI VIẾT>"
```

Cần sẵn 2 biến môi trường (App tùy chỉnh của Lark): `LARK_APP_ID`, `LARK_APP_SECRET`.

## Logic

1. Đổi `category` slug → category id (`/wp-json/wp/v2/categories?slug=`).
2. Lấy **tất cả** bài trong category đó, phân trang 100 bài/lần (`/wp-json/wp/v2/posts?categories=`).
3. Đọc các URL đã có trong bảng BÀI VIẾT để **tránh ghi trùng**.
4. `batch_create` các bài mới vào Lark Base.

Cột ghi vào (đã khớp bảng BÀI VIẾT): **Tên bài viết** (text), **URL** (hyperlink),
**Ngày đăng** (datetime). Các cột lookup/công thức là chỉ đọc, không ghi.
