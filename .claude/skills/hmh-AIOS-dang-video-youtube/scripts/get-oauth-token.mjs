#!/usr/bin/env node
/**
 * Lấy OAuth 2.0 refresh_token cho scope youtube.upload (đăng video lên chính kênh của bạn).
 * Dùng luồng "Desktop app" + loopback localhost — KHÔNG cần deploy gì.
 *
 * TIỀN ĐIỀU KIỆN:
 *  1. Google Cloud Console -> APIs & Services -> Credentials -> Create OAuth client ID
 *     -> Application type = "Desktop app". Lấy client_id + client_secret, điền vào config.local.json
 *     (oauthClientId / oauthClientSecret).
 *  2. Bật "YouTube Data API v3" cho project đó.
 *  3. OAuth consent screen: thêm chính email chủ kênh vào "Test users" (nếu app ở chế độ Testing).
 *
 * Chạy: node get-oauth-token.mjs   (mặc định cổng 53682)
 *  -> mở URL in ra bằng trình duyệt ĐANG đăng nhập tài khoản chủ kênh YouTube -> Cho phép.
 *  -> script tự nhận code, đổi lấy refresh_token và GHI THẲNG vào config.local.json.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CFG_PATH = path.join(__dirname, "config.local.json");
const CFG = JSON.parse(fs.readFileSync(CFG_PATH, "utf8"));

const PORT = parseInt(process.argv[process.argv.indexOf("--port") + 1], 10) || 53682;
const REDIRECT = `http://localhost:${PORT}`;
const SCOPE = "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube";

if (!CFG.oauthClientId || !CFG.oauthClientSecret) {
  console.error("Thiếu oauthClientId / oauthClientSecret trong config.local.json. Đọc phần TIỀN ĐIỀU KIỆN đầu file.");
  process.exit(1);
}

const authUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({
    client_id: CFG.oauthClientId,
    redirect_uri: REDIRECT,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
  });

console.log("\n1) Mở URL sau trong trình duyệt (đang đăng nhập tài khoản CHỦ KÊNH YouTube):\n");
console.log(authUrl);
console.log(`\n2) Sau khi bấm 'Cho phép', trình duyệt sẽ chuyển về ${REDIRECT} — script tự bắt code.\n`);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT);
  const code = url.searchParams.get("code");
  const err = url.searchParams.get("error");
  if (err) { res.end(`Lỗi uỷ quyền: ${err}`); return; }
  if (!code) { res.end("Đang chờ code..."); return; }
  try {
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code, client_id: CFG.oauthClientId, client_secret: CFG.oauthClientSecret,
        redirect_uri: REDIRECT, grant_type: "authorization_code",
      }),
    });
    const j = await r.json();
    if (!j.refresh_token) {
      res.end("Không nhận được refresh_token. Thử lại với prompt=consent / access_type=offline. Xem terminal.");
      console.error("Phản hồi token:", JSON.stringify(j, null, 2));
      server.close(); return;
    }
    CFG.oauthRefreshToken = j.refresh_token;
    fs.writeFileSync(CFG_PATH, JSON.stringify(CFG, null, 2));
    res.end("✔ Xong! Đã lưu refresh_token vào config.local.json. Đóng tab này và quay lại terminal.");
    console.log("✔ Đã lưu oauthRefreshToken vào config.local.json.");
    console.log("   access_token (tạm):", (j.access_token || "").slice(0, 20) + "...");
    server.close();
  } catch (e) {
    res.end("Lỗi đổi token: " + e.message);
    console.error(e); server.close();
  }
});
server.listen(PORT, () => console.log(`(đang lắng nghe ${REDIRECT} ...)`));
