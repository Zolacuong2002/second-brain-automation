#!/usr/bin/env node
/**
 * hmh-AIOS-sync-youtube-lark
 * Lấy dữ liệu KÊNH + VIDEO từ YouTube Data API v3 rồi đồng bộ vào Lark Base.
 *
 * - Kênh  -> bảng channel  (upsert theo link kênh)
 * - Video -> bảng video    (upsert theo "video id")
 * - Thumbnail: tải ảnh YouTube -> upload lên Lark drive -> gắn attachment.
 *
 * Chạy: node sync-youtube-lark.mjs [--only channel|video|all] [--limit N] [--refresh-thumbs] [--config path]
 *
 * Node >= 18 (dùng fetch/FormData/Blob sẵn có). Không cần cài package.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const YT = "https://www.googleapis.com/youtube/v3";

// ---------- args ----------
function parseArgs(argv) {
  const a = { only: "all", limit: 0, refreshThumbs: false, config: path.join(__dirname, "config.local.json") };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--only") a.only = argv[++i];
    else if (k === "--limit") a.limit = parseInt(argv[++i], 10) || 0;
    else if (k === "--refresh-thumbs") a.refreshThumbs = true;
    else if (k === "--config") a.config = argv[++i];
    else if (k === "--help") { console.log("Xem đầu file để biết cờ."); process.exit(0); }
  }
  return a;
}

const args = parseArgs(process.argv);
// Config: đọc file (nếu có) rồi cho ENV ghi đè (để chạy trên GitHub Actions không lộ secret).
let CFG = {};
try { CFG = JSON.parse(fs.readFileSync(args.config, "utf8")); } catch { /* CI: không có file, dùng env */ }
const E = process.env;
CFG.youtubeApiKey = E.YOUTUBE_API_KEY || CFG.youtubeApiKey;
CFG.larkAppId     = E.LARK_APP_ID     || CFG.larkAppId;
CFG.larkAppSecret = E.LARK_APP_SECRET || CFG.larkAppSecret;
CFG.larkDomain    = E.LARK_DOMAIN     || CFG.larkDomain || "https://open.larksuite.com";
CFG.appToken      = E.LARK_BASE_ID    || CFG.appToken;
CFG.tableChannel  = E.TABLE_CHANNEL   || CFG.tableChannel;
CFG.tableVideo    = E.TABLE_VIDEO     || CFG.tableVideo;
CFG.channel       = E.YT_CHANNEL      || CFG.channel;
for (const k of ["youtubeApiKey", "larkAppId", "larkAppSecret", "appToken", "tableChannel", "tableVideo", "channel"]) {
  if (!CFG[k]) { console.error(`Thiếu cấu hình "${k}" (điền config.local.json hoặc set biến môi trường tương ứng).`); process.exit(1); }
}

// ---------- utils ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (v) => (v == null || v === "" ? undefined : Number(v));
const log = (...m) => console.log(...m);

async function jget(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(url);
    const body = await r.json();
    if (r.status === 200) return body;
    if (r.status === 429 || r.status >= 500) { await sleep(1000 * (attempt + 1)); continue; }
    throw new Error(`YouTube ${r.status}: ${JSON.stringify(body.error || body)}`);
  }
  throw new Error("YouTube: hết lượt thử (rate limit).");
}

// ---------- Lark ----------
let TOKEN = null, TOKEN_EXP = 0;
async function larkToken() {
  if (TOKEN && Date.now() < TOKEN_EXP) return TOKEN;
  const r = await fetch(`${CFG.larkDomain}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: CFG.larkAppId, app_secret: CFG.larkAppSecret }),
  });
  const j = await r.json();
  if (j.code !== 0) throw new Error(`Lark token lỗi: ${j.code} ${j.msg}`);
  TOKEN = j.tenant_access_token;
  TOKEN_EXP = Date.now() + (j.expire - 120) * 1000;
  return TOKEN;
}

async function larkApi(method, apiPath, body) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const token = await larkToken();
    const r = await fetch(`${CFG.larkDomain}${apiPath}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json();
    if (j.code === 0) return j.data;
    if (j.code === 99991663 || j.code === 99991661) { TOKEN = null; continue; } // token hết hạn
    if (r.status === 429 || j.code === 1254607 || j.code === 1254045) { await sleep(1200 * (attempt + 1)); continue; }
    throw new Error(`Lark ${apiPath} lỗi: ${j.code} ${j.msg}`);
  }
  throw new Error(`Lark ${apiPath}: hết lượt thử.`);
}

/** Tải ảnh từ URL rồi upload lên Lark drive (bitable_image) -> file_token */
async function uploadThumb(imgUrl, fileName) {
  const ir = await fetch(imgUrl);
  if (!ir.ok) throw new Error(`Tải thumbnail lỗi ${ir.status}`);
  const buf = Buffer.from(await ir.arrayBuffer());
  const token = await larkToken();
  const form = new FormData();
  form.append("file_name", fileName);
  form.append("parent_type", "bitable_image");
  form.append("parent_node", CFG.appToken);
  form.append("size", String(buf.length));
  form.append("file", new Blob([buf]), fileName);
  const r = await fetch(`${CFG.larkDomain}/open-apis/drive/v1/medias/upload_all`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const j = await r.json();
  if (j.code !== 0) throw new Error(`Upload media lỗi: ${j.code} ${j.msg}`);
  return j.data.file_token;
}

async function listAllRecords(tableId) {
  const out = [];
  let pageToken = null;
  do {
    const qs = new URLSearchParams({ page_size: "500" });
    if (pageToken) qs.set("page_token", pageToken);
    const data = await larkApi("GET", `/open-apis/bitable/v1/apps/${CFG.appToken}/tables/${tableId}/records?${qs}`);
    out.push(...(data.items || []));
    pageToken = data.has_more ? data.page_token : null;
  } while (pageToken);
  return out;
}

const createRecord = (tableId, fields) =>
  larkApi("POST", `/open-apis/bitable/v1/apps/${CFG.appToken}/tables/${tableId}/records`, { fields });
const updateRecord = (tableId, recordId, fields) =>
  larkApi("PUT", `/open-apis/bitable/v1/apps/${CFG.appToken}/tables/${tableId}/records/${recordId}`, { fields });

// ---------- YouTube ----------
async function getChannel(handleOrId) {
  const h = handleOrId.replace(/^@/, "");
  let url;
  if (/^UC[\w-]{22}$/.test(handleOrId)) url = `${YT}/channels?part=snippet,statistics,contentDetails&id=${handleOrId}&key=${CFG.youtubeApiKey}`;
  else url = `${YT}/channels?part=snippet,statistics,contentDetails&forHandle=${h}&key=${CFG.youtubeApiKey}`;
  const j = await jget(url);
  const ch = j.items?.[0];
  if (!ch) throw new Error(`Không tìm thấy kênh: ${handleOrId}`);
  return ch;
}

async function getAllUploadIds(uploadsPlaylist, limit) {
  const ids = [];
  let pageToken = null;
  do {
    const qs = new URLSearchParams({ part: "contentDetails", playlistId: uploadsPlaylist, maxResults: "50", key: CFG.youtubeApiKey });
    if (pageToken) qs.set("pageToken", pageToken);
    const j = await jget(`${YT}/playlistItems?${qs}`);
    for (const it of j.items || []) ids.push(it.contentDetails.videoId);
    pageToken = j.nextPageToken || null;
    if (limit && ids.length >= limit) break;
  } while (pageToken);
  return limit ? ids.slice(0, limit) : ids;
}

async function getVideoDetails(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const j = await jget(`${YT}/videos?part=snippet,statistics&id=${batch.join(",")}&key=${CFG.youtubeApiKey}`);
    out.push(...(j.items || []));
  }
  return out;
}

function bestThumb(thumbs) {
  return (thumbs?.high || thumbs?.medium || thumbs?.default || {}).url;
}

// ---------- SYNC KÊNH ----------
async function syncChannel(ch) {
  log("\n== ĐỒNG BỘ KÊNH ==");
  const existing = await listAllRecords(CFG.tableChannel);
  const found = existing.find((r) => (r.fields["channel"]?.link || "").includes(ch.id) || r.fields["channel"]?.text === ch.snippet.title);

  const fields = {
    "channel": { link: `https://www.youtube.com/${ch.snippet.customUrl || "channel/" + ch.id}`, text: ch.snippet.title },
    "channel description": ch.snippet.description || "",
    "channel videoCount": num(ch.statistics.videoCount),
    "channel viewCount": num(ch.statistics.viewCount),
    "channel subscriberCount": num(ch.statistics.subscriberCount),
    "country": ch.snippet.country || undefined,
    "channel create time": Date.parse(ch.snippet.publishedAt),
  };

  const needThumb = args.refreshThumbs || !found || !(found.fields["thumbnails"]?.length);
  if (needThumb) {
    try {
      const ft = await uploadThumb(bestThumb(ch.snippet.thumbnails), `${ch.id}.jpg`);
      fields["thumbnails"] = [{ file_token: ft }];
    } catch (e) { log("  ! thumbnail kênh lỗi:", e.message); }
  }

  if (found) { await updateRecord(CFG.tableChannel, found.record_id, fields); log(`  cập nhật kênh: ${ch.snippet.title}`); }
  else { await createRecord(CFG.tableChannel, fields); log(`  tạo mới kênh: ${ch.snippet.title}`); }
}

// ---------- SYNC VIDEO ----------
async function syncVideos(ch) {
  log("\n== ĐỒNG BỘ VIDEO ==");
  const uploads = ch.contentDetails.relatedPlaylists.uploads;
  const ids = await getAllUploadIds(uploads, args.limit);
  log(`  YouTube: ${ids.length} video sẽ xử lý`);
  const details = await getVideoDetails(ids);
  log(`  Lấy chi tiết: ${details.length} video`);

  const existing = await listAllRecords(CFG.tableVideo);
  const byVid = new Map();
  for (const r of existing) {
    const vid = r.fields["video id"];
    if (vid) byVid.set(String(vid), r);
  }
  log(`  Lark hiện có: ${existing.length} record`);

  const channelLink = { link: `https://www.youtube.com/${ch.snippet.customUrl || "channel/" + ch.id}`, text: ch.snippet.title };
  let created = 0, updated = 0, i = 0;
  for (const v of details) {
    i++;
    const cur = byVid.get(v.id);
    const st = v.statistics || {};
    const fields = {
      "video": { link: `https://www.youtube.com/watch?v=${v.id}`, text: v.snippet.title },
      "video description": v.snippet.description || "",
      "video id": v.id,
      "video tag": Array.isArray(v.snippet.tags) ? v.snippet.tags.slice(0, 100) : undefined,
      "publish time": Date.parse(v.snippet.publishedAt),
      "viewCount": num(st.viewCount),
      "likeCount": num(st.likeCount),
      "favoriteCount": num(st.favoriteCount),
      "commentCount": num(st.commentCount),
      "channel": channelLink,
    };

    const hasThumb = cur?.fields["thumbnails"]?.length;
    if (args.refreshThumbs || !hasThumb) {
      try {
        const ft = await uploadThumb(bestThumb(v.snippet.thumbnails), `${v.id}.jpg`);
        fields["thumbnails"] = [{ file_token: ft }];
      } catch (e) { log(`  ! thumb ${v.id} lỗi: ${e.message}`); }
    }

    try {
      if (cur) { await updateRecord(CFG.tableVideo, cur.record_id, fields); updated++; }
      else { await createRecord(CFG.tableVideo, fields); created++; }
    } catch (e) { log(`  ! ghi ${v.id} lỗi: ${e.message}`); }

    if (i % 25 === 0) log(`  ... ${i}/${details.length} (tạo ${created}, cập nhật ${updated})`);
  }
  log(`  XONG video: tạo ${created}, cập nhật ${updated}`);
}

// ---------- MAIN ----------
async function main() {
  log(`Kênh nguồn: ${CFG.channel} | only=${args.only}${args.limit ? " limit=" + args.limit : ""}${args.refreshThumbs ? " refresh-thumbs" : ""}`);
  const ch = await getChannel(CFG.channel);
  log(`Đã lấy kênh: ${ch.snippet.title} (${ch.id}) — subs ${ch.statistics.subscriberCount}, videos ${ch.statistics.videoCount}`);
  if (args.only === "all" || args.only === "channel") await syncChannel(ch);
  if (args.only === "all" || args.only === "video") await syncVideos(ch);
  log("\n✔ Hoàn tất.");
}
main().catch((e) => { console.error("LỖI:", e.message); process.exit(1); });
