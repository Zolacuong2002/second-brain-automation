# Second Brain — Automation

Cào bài viết WordPress theo category và ghi vào Lark Base, kích hoạt qua HTTP.

## Skill: `seed-bai-viet`

Cào toàn bộ bài trong **một category WordPress** (WP REST API) → ghi vào bảng
**BÀI VIẾT** trên Lark Base, tự bỏ qua bài đã có (dedup theo URL).

- Skill: [.claude/skills/seed-bai-viet/SKILL.md](.claude/skills/seed-bai-viet/SKILL.md)
- Script: [.claude/skills/seed-bai-viet/scripts/seed_category.py](.claude/skills/seed-bai-viet/scripts/seed_category.py)
- Workflow: [.github/workflows/seed-bai-viet.yml](.github/workflows/seed-bai-viet.yml)

## Cấu hình (GitHub → Settings → Secrets and variables → Actions)

| Loại | Tên | Mô tả |
|---|---|---|
| Secret | `LARK_APP_ID` | App ID của App tùy chỉnh Lark |
| Secret | `LARK_APP_SECRET` | App Secret (App tùy chỉnh Lark) |
| Variable | `LARK_APP_TOKEN` | app_token của Lark Base |
| Variable | `LARK_TABLE_ID` | table_id bảng BÀI VIẾT |
| Variable | `WP_URL` | URL website WordPress |

Cột ghi vào bảng BÀI VIẾT: **Tên bài viết** (text), **URL** (hyperlink), **Ngày đăng** (datetime).

## Kích hoạt

### Bấm tay
GitHub → tab **Actions** → `seed-bai-viet` → **Run workflow** → nhập `category`.

### Qua HTTP (repository_dispatch)
```bash
curl -X POST https://api.github.com/repos/<user>/<repo>/dispatches \
  -H "Authorization: Bearer <PAT có scope repo>" \
  -H "Accept: application/vnd.github+json" \
  -d '{"event_type":"seed-bai-viet","client_payload":{"category":"blog"}}'
```

Đây cũng là request dùng cho action **"Gửi yêu cầu HTTP"** trong Lark Base Automation.

## Chạy lại
Lần đầu ghi toàn bộ bài; các lần sau chỉ ghi bài mới (bỏ qua bài trùng URL).
