"""Cào toàn bộ bài trong 1 category WordPress và ghi vào bảng BÀI VIẾT trên Lark Base.

Biến môi trường cần có: LARK_APP_ID, LARK_APP_SECRET (App tùy chỉnh của Lark).
"""
import argparse
import os
import time
from datetime import datetime, timezone

import requests

# Lark quốc tế. Nếu dùng Feishu (TQ) đổi thành https://open.feishu.cn/open-apis
LARK = os.environ.get("LARK_DOMAIN", "https://open.larksuite.com").rstrip("/") + "/open-apis"

# Tên cột THẬT trong bảng BÀI VIẾT (đã xác minh qua API).
COL_TITLE = "Tên bài viết"   # type 1  (text)
COL_URL = "URL"              # type 15 (hyperlink) -> {"link","text"}
COL_DATE = "Ngày đăng"       # type 5  (datetime)  -> epoch milliseconds


def lark_token():
    r = requests.post(
        f"{LARK}/auth/v3/tenant_access_token/internal",
        json={
            "app_id": os.environ["LARK_APP_ID"],
            "app_secret": os.environ["LARK_APP_SECRET"],
        },
        timeout=30,
    )
    r.raise_for_status()
    data = r.json()
    if data.get("code") != 0:
        raise SystemExit(f"Lỗi auth Lark: {data.get('msg')}")
    return data["tenant_access_token"]


def category_id(base, slug):
    r = requests.get(f"{base}/wp-json/wp/v2/categories", params={"slug": slug}, timeout=30)
    r.raise_for_status()
    data = r.json()
    if not data:
        raise SystemExit(f"Không tìm thấy category '{slug}'")
    return data[0]["id"]


def to_ms(date_gmt):
    """WP 'date_gmt' (ISO, giờ UTC, không tz) -> epoch milliseconds."""
    if not date_gmt:
        return None
    dt = datetime.fromisoformat(date_gmt).replace(tzinfo=timezone.utc)
    return int(dt.timestamp() * 1000)


def fetch_posts(base, cat_id):
    posts, page = [], 1
    while True:
        r = requests.get(
            f"{base}/wp-json/wp/v2/posts",
            params={
                "categories": cat_id,
                "per_page": 100,
                "page": page,
                "_fields": "title,link,date_gmt",
            },
            timeout=30,
        )
        if r.status_code != 200:
            break
        batch = r.json()
        if not batch:
            break
        for p in batch:
            posts.append(
                {
                    "title": p["title"]["rendered"],
                    "url": p["link"],
                    "date_ms": to_ms(p.get("date_gmt")),
                }
            )
        if len(batch) < 100:
            break
        page += 1
    return posts


def existing_urls(token, app_token, table_id):
    """Đọc URL đã có trong bảng để tránh ghi trùng."""
    urls, page_token = set(), ""
    while True:
        params = {"page_size": 500}
        if page_token:
            params["page_token"] = page_token
        r = requests.get(
            f"{LARK}/bitable/v1/apps/{app_token}/tables/{table_id}/records",
            headers={"Authorization": f"Bearer {token}"},
            params=params,
            timeout=30,
        )
        d = r.json().get("data", {})
        for it in d.get("items", []):
            v = it["fields"].get(COL_URL)
            # Cột hyperlink trả về {"text":..,"link":..}
            if isinstance(v, dict):
                v = v.get("link")
            elif isinstance(v, list) and v:
                v = v[0].get("link") if isinstance(v[0], dict) else v[0]
            if v:
                urls.add(v)
        if not d.get("has_more"):
            break
        page_token = d.get("page_token", "")
    return urls


def build_fields(p):
    fields = {
        COL_TITLE: p["title"],
        COL_URL: {"link": p["url"], "text": p["url"]},
    }
    if p["date_ms"]:
        fields[COL_DATE] = p["date_ms"]
    return fields


def batch_create(token, app_token, table_id, records):
    for i in range(0, len(records), 500):
        chunk = records[i : i + 500]
        r = requests.post(
            f"{LARK}/bitable/v1/apps/{app_token}/tables/{table_id}/records/batch_create",
            headers={"Authorization": f"Bearer {token}"},
            json={"records": [{"fields": f} for f in chunk]},
            timeout=60,
        )
        r.raise_for_status()
        if r.json().get("code") != 0:
            raise SystemExit(f"Lỗi ghi Lark: {r.json().get('msg')}")
        time.sleep(0.3)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--wp-url", required=True, help="https://example.com")
    ap.add_argument("--category", required=True, help="slug của category WordPress")
    ap.add_argument("--app-token", required=True, help="app_token của Lark Base")
    ap.add_argument("--table-id", required=True, help="table_id bảng BÀI VIẾT")
    args = ap.parse_args()

    base = args.wp_url.rstrip("/")
    token = lark_token()

    cat = category_id(base, args.category)
    posts = fetch_posts(base, cat)
    print(f"Cào được {len(posts)} bài trong category '{args.category}'.")

    have = existing_urls(token, args.app_token, args.table_id)
    new_records = [build_fields(p) for p in posts if p["url"] not in have]

    if new_records:
        batch_create(token, args.app_token, args.table_id, new_records)
    print(f"Đã ghi {len(new_records)} bài mới (bỏ qua {len(posts) - len(new_records)} trùng).")


if __name__ == "__main__":
    main()
