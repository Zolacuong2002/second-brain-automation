#!/usr/bin/env node
/**
 * hmh-AIOS-dang-video-youtube
 * Đọc bảng "Đăng video YouTube" trong Lark Base, lấy các dòng Trạng thái = "Chờ đăng",
 * tải file video (attachment) từ Lark, UPLOAD lên YouTube (resumable, OAuth), rồi ghi kết quả
 * (Video ID, Link, Ngày đăng, Trạng thái=Đã đăng / Lỗi) ngược lại vào bảng.
 *
 * Chạy: node post-video-youtube.mjs [--limit N] [--dry-run]
 * Node >= 18, zero-dependency.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Config: đọc file (nếu có) rồi cho ENV ghi đè (chạy trên GitHub Actions không lộ secret).
let CFG = {};
try { CFG = JSON.parse(fs.readFileSync(path.join(__dirname, "config.local.json"), "utf8")); } catch { /* CI */ }
const E = process.env;
CFG.larkAppId         = E.LARK_APP_ID              || CFG.larkAppId;
CFG.larkAppSecret     = E.LARK_APP_SECRET          || CFG.larkAppSecret;
CFG.larkDomain        = E.LARK_DOMAIN              || CFG.larkDomain || "https://open.larksuite.com";
CFG.appToken          = E.LARK_BASE_ID            || CFG.appToken;
CFG.tablePost         = E.TABLE_POST              || CFG.tablePost;
CFG.oauthClientId     = E.YT_OAUTH_CLIENT_ID      || CFG.oauthClientId;
CFG.oauthClientSecret = E.YT_OAUTH_CLIENT_SECRET  || CFG.oauthClientSecret;
CFG.oauthRefreshToken = E.YT_OAUTH_REFRESH_TOKEN  || CFG.oauthRefreshToken;
CFG.defaultCategoryId = E.YT_CATEGORY_ID          || CFG.defaultCategoryId || "22";
CFG.defaultPrivacy    = E.YT_PRIVACY              || CFG.defaultPrivacy || "private";

const LIMIT = (() => { const i = process.argv.indexOf("--limit"); return i > -1 ? parseInt(process.argv[i + 1], 10) : 0; })();
const DRY = process.argv.includes("--dry-run");
// record_id cụ thể (nút bấm Lark gửi qua client_payload) — CLI --record-id hoặc env RECORD_ID
const RECORD_ID = (() => { const i = process.argv.indexOf("--record-id"); return i > -1 ? process.argv[i + 1] : (E.RECORD_ID || ""); })();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Lark ----------
let LK = null, LK_EXP = 0;
async function larkToken() {
  if (LK && Date.now() < LK_EXP) return LK;
  const r = await fetch(`${CFG.larkDomain}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: CFG.larkAppId, app_secret: CFG.larkAppSecret }),
  });
  const j = await r.json();
  if (j.code !== 0) throw new Error(`Lark token lỗi: ${j.code} ${j.msg}`);
  LK = j.tenant_access_token; LK_EXP = Date.now() + (j.expire - 120) * 1000;
  return LK;
}
async function larkApi(method, apiPath, body) {
  const token = await larkToken();
  const r = await fetch(`${CFG.larkDomain}${apiPath}`, {
    method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  if (j.code !== 0) throw new Error(`Lark ${apiPath}: ${j.code} ${j.msg}`);
  return j.data;
}
const T = () => `/open-apis/bitable/v1/apps/${CFG.appToken}/tables/${CFG.tablePost}`;
async function listPending() {
  const out = []; let pt = null;
  do {
    const qs = new URLSearchParams({ page_size: "200" }); if (pt) qs.set("page_token", pt);
    const d = await larkApi("GET", `${T()}/records?${qs}`);
    out.push(...(d.items || [])); pt = d.has_more ? d.page_token : null;
  } while (pt);
  return out;
}
const updateRow = (rid, fields) => larkApi("PUT", `${T()}/records/${rid}`, { fields });

async function downloadAttachment(fileToken, destPath) {
  const token = await larkToken();
  const r = await fetch(`${CFG.larkDomain}/open-apis/drive/v1/medias/${fileToken}/download`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`Tải video từ Lark lỗi ${r.status}`);
  await new Promise((res, rej) => {
    const ws = fs.createWriteStream(destPath);
    Readable.fromWeb(r.body).pipe(ws); ws.on("finish", res); ws.on("error", rej);
  });
  return fs.statSync(destPath).size;
}

// ---------- YouTube OAuth + upload ----------
async function ytAccessToken() {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CFG.oauthClientId, client_secret: CFG.oauthClientSecret,
      refresh_token: CFG.oauthRefreshToken, grant_type: "refresh_token",
    }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`Lấy access_token lỗi: ${JSON.stringify(j)}`);
  return j.access_token;
}

async function uploadToYouTube(accessToken, filePath, fileSize, snippet, status) {
  // 1) init resumable
  const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Length": String(fileSize),
      "X-Upload-Content-Type": "video/*",
    },
    body: JSON.stringify({ snippet, status }),
  });
  if (init.status !== 200) throw new Error(`Init upload lỗi ${init.status}: ${await init.text()}`);
  const uploadUrl = init.headers.get("location");
  if (!uploadUrl) throw new Error("Không nhận được upload URL (Location).");
  // 2) PUT toàn bộ bytes (1 lần)
  const buf = fs.readFileSync(filePath);
  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "video/*", "Content-Length": String(fileSize) },
    body: buf,
  });
  const j = await put.json();
  if (!j.id) throw new Error(`Upload lỗi: ${JSON.stringify(j.error || j)}`);
  return j.id;
}

// ---------- MAIN ----------
async function main() {
  const need = DRY ? ["tablePost"] : ["tablePost", "oauthClientId", "oauthClientSecret", "oauthRefreshToken"];
  for (const k of need) {
    if (!CFG[k]) throw new Error(`Thiếu "${k}" trong config.local.json. (Chạy setup-table.mjs / get-oauth-token.mjs trước.)`);
  }
  const rows = await listPending();
  let pending;
  if (RECORD_ID) {
    // Nút bấm Lark: chỉ đăng đúng 1 dòng (bỏ qua điều kiện Trạng thái, chỉ cần có Video).
    pending = rows.filter((r) => r.record_id === RECORD_ID && Array.isArray(r.fields["Video"]) && r.fields["Video"].length > 0);
    console.log(`record_id=${RECORD_ID}: ${pending.length ? "sẽ đăng" : "không thấy dòng hợp lệ (thiếu Video?)"}.`);
  } else {
    pending = rows.filter((r) => {
      const st = r.fields["Trạng thái"];
      const stName = typeof st === "object" ? st?.text : st;
      const vid = r.fields["Video"];
      return (stName === "Chờ đăng") && Array.isArray(vid) && vid.length > 0;
    });
    if (LIMIT) pending = pending.slice(0, LIMIT);
    console.log(`Có ${pending.length} video "Chờ đăng"${LIMIT ? ` (giới hạn ${LIMIT})` : ""}.`);
  }
  if (!pending.length) return;

  const accessToken = DRY ? null : await ytAccessToken();

  for (const row of pending) {
    const f = row.fields;
    const title = (f["Tiêu đề"]?.text ?? f["Tiêu đề"] ?? "").toString().trim() || "Untitled";
    const att = f["Video"][0];
    console.log(`\n▶ "${title}" — file ${att.name} (${(att.size / 1e6).toFixed(1)}MB)`);
    if (DRY) { console.log("  [dry-run] bỏ qua upload."); continue; }

    const tmp = path.join(os.tmpdir(), `yt-${row.record_id}-${att.name}`.replace(/[^\w.\-]/g, "_"));
    try {
      await updateRow(row.record_id, { "Trạng thái": "Đang đăng" });
      const size = await downloadAttachment(att.file_token, tmp);

      const desc = (f["Mô tả"]?.text ?? f["Mô tả"] ?? "").toString();
      const tagsRaw = (f["Tags"]?.text ?? f["Tags"] ?? "").toString();
      const tags = tagsRaw.split(",").map((s) => s.trim()).filter(Boolean);
      const privacy = (f["Chế độ"]?.text ?? f["Chế độ"] ?? (CFG.defaultPrivacy || "private")).toString();
      const snippet = { title, description: desc, tags, categoryId: CFG.defaultCategoryId || "22" };
      const status = { privacyStatus: privacy, selfDeclaredMadeForKids: false };
      const schedMs = f["Lịch đăng"];
      if (schedMs) { status.privacyStatus = "private"; status.publishAt = new Date(schedMs).toISOString(); }

      console.log("  ↑ đang upload lên YouTube...");
      const videoId = await uploadToYouTube(accessToken, tmp, size, snippet, status);
      const link = `https://youtu.be/${videoId}`;
      await updateRow(row.record_id, {
        "Trạng thái": "Đã đăng", "Video ID": videoId,
        "Link video": { link, text: title }, "Ngày đăng": Date.now(), "Ghi chú lỗi": "",
      });
      console.log(`  ✔ Đã đăng: ${link}`);
    } catch (e) {
      console.log(`  ✗ Lỗi: ${e.message}`);
      try { await updateRow(row.record_id, { "Trạng thái": "Lỗi", "Ghi chú lỗi": e.message.slice(0, 900) }); } catch {}
    } finally {
      try { fs.existsSync(tmp) && fs.unlinkSync(tmp); } catch {}
    }
    await sleep(500);
  }
  console.log("\n✔ Hoàn tất.");
}
main().catch((e) => { console.error("LỖI:", e.message); process.exit(1); });
