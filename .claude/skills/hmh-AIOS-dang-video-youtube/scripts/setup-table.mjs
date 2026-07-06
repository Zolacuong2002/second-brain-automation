#!/usr/bin/env node
/**
 * Tạo bảng "Đăng video YouTube" trong Lark Base (đúng schema skill cần).
 * Chạy: node setup-table.mjs [--name "16.3 Đăng video YouTube"]
 * In ra table_id -> dán vào config.local.json ("tablePost").
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CFG = JSON.parse(fs.readFileSync(path.join(__dirname, "config.local.json"), "utf8"));

const nameArgIdx = process.argv.indexOf("--name");
const TABLE_NAME = nameArgIdx > -1 ? process.argv[nameArgIdx + 1] : "16.3 Đăng video YouTube";

async function larkToken() {
  const r = await fetch(`${CFG.larkDomain}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: CFG.larkAppId, app_secret: CFG.larkAppSecret }),
  });
  const j = await r.json();
  if (j.code !== 0) throw new Error(`Lark token lỗi: ${j.code} ${j.msg}`);
  return j.tenant_access_token;
}

const FIELDS = [
  { field_name: "Tiêu đề", type: 1 },                    // primary
  { field_name: "Video", type: 17 },                     // attachment (file mp4)
  { field_name: "Mô tả", type: 1 },
  { field_name: "Tags", type: 1 },                       // phân tách bằng dấu phẩy
  { field_name: "Chế độ", type: 3, property: { options: [{ name: "private" }, { name: "unlisted" }, { name: "public" }] } },
  { field_name: "Trạng thái", type: 3, property: { options: [{ name: "Chờ đăng" }, { name: "Đang đăng" }, { name: "Đã đăng" }, { name: "Lỗi" }] } },
  { field_name: "Lịch đăng", type: 5, property: { date_formatter: "yyyy/MM/dd HH:mm" } },
  { field_name: "Video ID", type: 1 },
  { field_name: "Link video", type: 15 },
  { field_name: "Ngày đăng", type: 5, property: { date_formatter: "yyyy/MM/dd HH:mm" } },
  { field_name: "Ghi chú lỗi", type: 1 },
];

async function main() {
  const token = await larkToken();
  const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const r = await fetch(`${CFG.larkDomain}/open-apis/bitable/v1/apps/${CFG.appToken}/tables`, {
    method: "POST", headers: H,
    body: JSON.stringify({ table: { name: TABLE_NAME, default_view_name: "Chờ đăng", fields: FIELDS } }),
  });
  const j = await r.json();
  if (j.code !== 0) throw new Error(`Tạo bảng lỗi: ${j.code} ${j.msg}`);
  console.log("✔ Đã tạo bảng:", TABLE_NAME);
  console.log("table_id =", j.data.table_id);
  console.log("\n>>> Dán table_id trên vào config.local.json -> \"tablePost\".");
}
main().catch((e) => { console.error("LỖI:", e.message); process.exit(1); });
