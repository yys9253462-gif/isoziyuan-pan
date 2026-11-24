import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import {
  isAdmin,
  pickupTicket,
  sessionCookie,
  validateSafePath,
  verifyPickupTicket,
} from "../functions/_lib.js";
import * as middleware from "../functions/api/_middleware.js";
import * as login from "../functions/api/auth/login.js";
import * as logout from "../functions/api/auth/logout.js";
import * as files from "../functions/api/files.js";
import * as folders from "../functions/api/folder.js";
import * as uploadUrl from "../functions/api/upload-url.js";
import * as rawUpload from "../functions/api/upload.js";
import * as uploadComplete from "../functions/api/upload-complete.js";
import * as download from "../functions/api/download.js";
import * as pickupDownload from "../functions/api/pickup-download.js";
import * as share from "../functions/api/share.js";
import * as deletion from "../functions/api/delete.js";
import * as storageConfig from "../functions/api/storage-config.js";
import * as storageUsage from "../functions/api/storage-usage.js";
import * as r2Accounts from "../functions/api/r2-accounts.js";
import * as pickupRedirect from "../functions/pickup/[code].js";
import { reserveAwsTransfer } from "../functions/storage.js";

const db = new DatabaseSync(":memory:");
// 故意保持外键关闭以验证删除逻辑主动清理关联分享记录
db.exec("PRAGMA foreign_keys = OFF");
db.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));

function prepare(sql) {
  let args = [];
  return {
    bind(...a) {
      args = a;
      return this;
    },
    async first() {
      return db.prepare(sql).get(Object.fromEntries(args.map((v, i) => ["?" + (i + 1), v]))) || null;
    },
    async all() {
      return { results: db.prepare(sql).all(Object.fromEntries(args.map((v, i) => ["?" + (i + 1), v]))) };
    },
    async run() {
      const r = db.prepare(sql).run(Object.fromEntries(args.map((v, i) => ["?" + (i + 1), v])));
      return { meta: { changes: Number(r.changes || 0) } };
    },
  };
}

const r2Store = new Map();
let failR2List = false;

const env = {
  ADMIN_PASSWORD: "fixture-admin-password-only",
  SESSION_SECRET: "fixture-session-secret-only-32bytes",
  CF_ACCOUNT_ID: "c21081d20d9d782cf3ce39dddc17645b",
  DB: { prepare },
  R2: {
    async put(key, body, opts) {
      let bytes;
      if (body instanceof Uint8Array) bytes = body;
      else if (typeof body === "string") bytes = new TextEncoder().encode(body);
      else if (body && typeof body.getReader === "function") {
        const chunks = [];
        const reader = body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
        const total = chunks.reduce((n, c) => n + c.byteLength, 0);
        bytes = new Uint8Array(total);
        let offset = 0;
        for (const c of chunks) {
          bytes.set(c, offset);
          offset += c.byteLength;
        }
      } else {
        bytes = new Uint8Array(0);
      }
      r2Store.set(key, { bytes, meta: opts?.httpMetadata || {} });
      return { key, size: bytes.byteLength };
    },
    async head(key) {
      const item = r2Store.get(key);
      return item ? { key, size: item.bytes.byteLength, httpMetadata: item.meta } : null;
    },
    async get(key) {
      const item = r2Store.get(key);
      return item ? { key, size: item.bytes.byteLength, body: item.bytes, httpMetadata: item.meta } : null;
    },
    async delete(key) {
      r2Store.delete(key);
    },
    async list() {
      if (failR2List) throw new Error("secret-internal-host-10.0.0.5");
      return { objects: [...r2Store.entries()].map(([key, v]) => ({ key, size: v.bytes.byteLength })), truncated: false };
    },
  },
};

let checks = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  checks += 1;
}
function eq(a, b, msg) {
  assert.equal(a, b, msg);
  checks += 1;
}

async function runApi(mod, method, urlPath, { body, headers = {}, host = "pan.ailxw.com", customEnv = env } = {}) {
  const url = `https://${host}${urlPath}`;
  const reqHeaders = new Headers(headers);
  let payload;
  if (body !== undefined && typeof body === "object" && !(body instanceof Uint8Array)) {
    if (!reqHeaders.has("Content-Type")) reqHeaders.set("Content-Type", "application/json");
    payload = JSON.stringify(body);
  } else {
    payload = body;
  }
  const request = new Request(url, { method, headers: reqHeaders, body: payload });
  const handler = mod["onRequest" + method[0] + method.slice(1).toLowerCase()];
  return middleware.onRequest({
    request,
    next: () => handler({ request, env: customEnv }),
  });
}

// 1. 密钥缺失防护与会话饼干严格校验
eq(await isAdmin(new Request("https://pan.ailxw.com/api/files", { headers: { Cookie: "pan_session=9999999999.abc" } }), { ...env, SESSION_SECRET: "" }), false, "空密钥必须拒绝鉴权");
const unconfiguredLogin = await runApi(login, "POST", "/api/auth/login", { body: { password: "x" }, customEnv: { ...env, SESSION_SECRET: "" } });
eq(unconfiguredLogin.status, 503, "缺少签名密钥时登录应返回 503");

const validCookieFull = await sessionCookie(env, new Request("https://pan.ailxw.com/api/auth/login"));
ok(validCookieFull.includes("HttpOnly"), "会话必须包含 HttpOnly");
ok(validCookieFull.includes("Secure"), "加密站点会话必须包含 Secure");
ok(validCookieFull.includes("SameSite=Strict"), "会话必须启用 SameSite=Strict");
const adminCookie = validCookieFull.split(";")[0];

eq(await isAdmin(new Request("https://pan.ailxw.com/", { headers: { Cookie: adminCookie } }), env), true, "合法会话应通过校验");
eq(await isAdmin(new Request("https://pan.ailxw.com/", { headers: { Cookie: "pan_session=NaN.aaaaaaaaaaaaaaaaaaaa" } }), env), false, "非数字时间戳必须拒绝");
eq(await isAdmin(new Request("https://pan.ailxw.com/", { headers: { Cookie: `${adminCookie}.extra` } }), env), false, "多余分段必须拒绝");
eq(await isAdmin(new Request("https://pan.ailxw.com/", { headers: { Cookie: "pan_session=1.aaaaaaaaaaaaaaaaaaaa" } }), env), false, "过期时间戳必须拒绝");

// 2. 登录防爆破限流与清除计数
for (let i = 0; i < 5; i += 1) {
  const r = await runApi(login, "POST", "/api/auth/login", {
    body: { password: "wrong-password" },
    headers: { "CF-Connecting-IP": "198.51.100.10" },
  });
  eq(r.status, 401, `第 ${i + 1} 次错密应返回 401`);
}
const locked = await runApi(login, "POST", "/api/auth/login", {
  body: { password: env.ADMIN_PASSWORD },
  headers: { "CF-Connecting-IP": "198.51.100.10" },
});
eq(locked.status, 429, "连续五次失败后应触发 429 限流");
ok(Number(locked.headers.get("Retry-After")) > 0, "限流响应需包含 Retry-After");

const otherIpOk = await runApi(login, "POST", "/api/auth/login", {
  body: { password: env.ADMIN_PASSWORD },
  headers: { "CF-Connecting-IP": "198.51.100.11" },
});
eq(otherIpOk.status, 200, "其他来源地址正常密码登录应成功");
eq(otherIpOk.headers.get("Cache-Control"), "no-store", "登录接口必须禁止缓存");

const logoutRes = await runApi(logout, "POST", "/api/auth/logout", { headers: { Cookie: adminCookie } });
eq(logoutRes.status, 200, "退出登录应成功");
ok((logoutRes.headers.get("Set-Cookie") || "").includes("Max-Age=0"), "退出应清空会话");

// 3. 域名白名单与跨站伪造防护 + 安全响应头
const pagesDevBlocked = await runApi(files, "GET", "/api/files", { host: "isoziyuan-pan.pages.dev", headers: { Cookie: adminCookie } });
eq(pagesDevBlocked.status, 403, "默认 pages.dev 域名必须拦截");

const crossSitePost = await runApi(folders, "POST", "/api/folder", {
  body: { path: "csrf-dir" },
  headers: { Cookie: adminCookie, Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" },
});
eq(crossSitePost.status, 403, "跨站来源写入必须拦截");

const crossSubdomainPost = await runApi(folders, "POST", "/api/folder", {
  body: { path: "csrf-sub" },
  headers: { Cookie: adminCookie, Origin: "https://shop.ailxw.com", "Sec-Fetch-Site": "same-site" },
});
eq(crossSubdomainPost.status, 403, "同根域不同子域的跨源写入必须拦截");

const sameOriginFiles = await runApi(files, "GET", "/api/files", { headers: { Cookie: adminCookie } });
eq(sameOriginFiles.status, 200, "同源合法列表请求应成功");
eq(sameOriginFiles.headers.get("X-Frame-Options"), "DENY", "接口应附带防点击劫持头");
eq(sameOriginFiles.headers.get("X-Content-Type-Options"), "nosniff", "接口应附带防嗅探头");
eq(sameOriginFiles.headers.get("Referrer-Policy"), "no-referrer", "接口应附带来源隐藏头");

// 4. 取件短链重定向校验
const badPickupHost = pickupRedirect.onRequestGet({ request: new Request("https://isoziyuan-pan.pages.dev/pickup/12345"), params: { code: "12345" } });
eq(badPickupHost.status, 403, "取件短链必须拦截非法域名");
const badPickupCode = pickupRedirect.onRequestGet({ request: new Request("https://pan.ailxw.com/pickup/bad<script>"), params: { code: "bad<script>" } });
eq(badPickupCode.status, 302, "非法取件码应重定向到错误页");
ok((badPickupCode.headers.get("Location") || "").endsWith("/pickup.html?invalid=1"), "非法取件码不得原样反射进网址");

// 5. 严格路径穿越、控制字符与同名覆盖防护
for (const badPath of ["../etc/passwd", "a/../../b", "./hidden", "foo\u0000bar", "foo\nbar", ".connection-check/probe"]) {
  eq(validateSafePath(badPath), null, `危险路径应被拦截: ${JSON.stringify(badPath)}`);
  const rFolder = await runApi(folders, "POST", "/api/folder", { body: { path: badPath }, headers: { Cookie: adminCookie } });
  eq(rFolder.status, 400, "建目录应拒绝危险路径");
  const rUpUrl = await runApi(uploadUrl, "POST", "/api/upload-url", { body: { path: badPath }, headers: { Cookie: adminCookie } });
  eq(rUpUrl.status, 400, "获取上传地址应拒绝危险路径");
  const rRaw = await runApi(rawUpload, "PUT", "/api/upload?path=" + encodeURIComponent(badPath), {
    body: new TextEncoder().encode("hello"),
    headers: { Cookie: adminCookie, "Content-Type": "text/plain" },
  });
  eq(rRaw.status, 400, "直传接口应拒绝危险路径");
}
const badListFolder = await runApi(files, "GET", "/api/files?folder=" + encodeURIComponent("../secret"), { headers: { Cookie: adminCookie } });
eq(badListFolder.status, 400, "文件列表接口应拒绝穿越目录");
const badStorageList = await runApi(files, "GET", "/api/files?storage=invalid-space", { headers: { Cookie: adminCookie } });
eq(badStorageList.status, 400, "非法存储空间应返回 400 而非 500");

// 6. 上传真实体积核验 + 建同名目录不得覆盖已有文件 + 禁止在文件路径下建子目录
const upHtml = await runApi(rawUpload, "PUT", "/api/upload?path=" + encodeURIComponent("poc.html"), {
  body: new TextEncoder().encode("<svg onload=alert(1)>"),
  headers: { Cookie: adminCookie, "Content-Type": "text/html; charset=utf-8", "X-File-Size": "999999999" },
});
eq(upHtml.status, 200, "上传测试文件应成功");
const upHtmlJson = await upHtml.json();
eq(upHtmlJson.size, 21, "数据库应以真实落盘字节数为准，忽略伪造请求头");

const collideFolder = await runApi(folders, "POST", "/api/folder", { body: { path: "poc.html" }, headers: { Cookie: adminCookie } });
eq(collideFolder.status, 409, "创建与已有文件同名的目录必须返回 409");
eq(r2Store.get("pan-cloudflare/poc.html").bytes.byteLength, 21, "同名建目录冲突不得破坏原对象内容");

const childUnderFile = await runApi(folders, "POST", "/api/folder", { body: { path: "poc.html/sub" }, headers: { Cookie: adminCookie } });
eq(childUnderFile.status, 400, "不得在已有文件路径下继续创建目录");

// 7. 下载防脚本执行与安全响应头
const dlAdmin = await runApi(download, "GET", "/api/download?id=" + encodeURIComponent(upHtmlJson.id), { headers: { Cookie: adminCookie } });
eq(dlAdmin.status, 200, "后台下载文件应成功");
eq(dlAdmin.headers.get("Content-Type"), "application/octet-stream", "网页类附件必须强制转二进制类型");
ok((dlAdmin.headers.get("Content-Disposition") || "").startsWith("attachment;"), "下载响应必须为附件模式");
eq(dlAdmin.headers.get("Content-Security-Policy"), "default-src 'none'; sandbox", "下载响应必须开启沙盒策略");

// 8. 分享码防冲突覆盖 + 非法数值拦截 + 取件票据与缺文件不扣次数
const badShareVal = await runApi(share, "POST", "/api/share", { body: { fileId: upHtmlJson.id, style: "day", value: "abc" }, headers: { Cookie: adminCookie } });
eq(badShareVal.status, 400, "非数字有效期必须返回 400");

const share1 = await runApi(share, "POST", "/api/share", { body: { fileId: upHtmlJson.id, style: "count", value: 1, code: "54321", title: "测试标题\n防注入" }, headers: { Cookie: adminCookie } });
eq(share1.status, 200, "生成自定义取件码应成功");
const share1Data = await share1.json();
eq(share1Data.title, "测试标题 防注入", "分享标题应剥离换行控制字符");

const shareConflict = await runApi(share, "POST", "/api/share", { body: { fileId: upHtmlJson.id, style: "day", value: 7, code: "54321" }, headers: { Cookie: adminCookie } });
eq(shareConflict.status, 409, "已占用取件码必须返回 409 且绝不覆盖");

eq(await verifyPickupTicket(env, "54321", "NaN.aaaaaaaaaaaaaaaaaaaa"), false, "非数字票据时间戳必须拒绝");
const validTicket = await pickupTicket(env, "54321");
eq(await verifyPickupTicket(env, "99999", validTicket), false, "跨取件码复用票据必须拒绝");

// 模拟底层对象丢失：取件下载应报 404 且不扣除剩余次数
const savedBytes = r2Store.get("pan-cloudflare/poc.html");
r2Store.delete("pan-cloudflare/poc.html");
const missingDl = await runApi(pickupDownload, "GET", `/api/pickup-download?code=54321&t=${encodeURIComponent(validTicket)}`);
eq(missingDl.status, 404, "底层文件缺失应返回 404");
eq(db.prepare("SELECT remaining FROM shares WHERE code='54321'").get().remaining, 1, "文件缺失时不得误扣下载次数");

// 恢复对象后正常下载一次，再下一次耗尽
r2Store.set("pan-cloudflare/poc.html", savedBytes);
const okPickupDl = await runApi(pickupDownload, "GET", `/api/pickup-download?code=54321&t=${encodeURIComponent(validTicket)}`);
eq(okPickupDl.status, 200, "合法票据取件下载应成功");
eq(okPickupDl.headers.get("Content-Type"), "application/octet-stream", "取件下载同样必须中和网页脚本类型");
const exhaustedDl = await runApi(pickupDownload, "GET", `/api/pickup-download?code=54321&t=${encodeURIComponent(validTicket)}`);
eq(exhaustedDl.status, 410, "次数耗尽应返回 410");

// 9. 删除文件时即使外键关闭也必须主动清理分享记录
const delRes = await runApi(deletion, "POST", "/api/delete", { body: { id: upHtmlJson.id }, headers: { Cookie: adminCookie } });
eq(delRes.status, 200, "删除文件应成功");
eq(db.prepare("SELECT COUNT(*) AS n FROM shares WHERE code='54321'").get().n, 0, "删除文件后不得遗留孤儿取件码");

// 10. 外部存储防服务端请求伪造、防非数字参数与防内部报错泄露
for (const badCfg of [
  { enabled: true, bucket: "169.254.169.254", region: "us-east-1", accessKey: "a", secretKey: "b" },
  { enabled: true, bucket: "bad..bucket", region: "us-east-1", accessKey: "a", secretKey: "b" },
  { enabled: true, bucket: "ok-bucket", region: "us--east-1", accessKey: "a", secretKey: "b" },
  { enabled: false, bucket: "ok-bucket", region: "us-east-1", prefix: "../escape" },
  { enabled: false, bucket: "ok-bucket", region: "us-east-1", capacityGb: "abc" },
]) {
  const r = await runApi(storageConfig, "POST", "/api/storage-config", { body: badCfg, headers: { Cookie: adminCookie } });
  eq(r.status, 400, "非法外部存储配置必须返回 400");
}

const badR2Prefix = await runApi(r2Accounts, "POST", "/api/r2-accounts", {
  body: { name: "坏前缀", accountId: "a".repeat(32), bucket: "bucket-a", prefix: "../escape", accessKey: "k", secretKey: "s" },
  headers: { Cookie: adminCookie },
});
eq(badR2Prefix.status, 400, "外部对象存储前缀穿越必须返回 400");

failR2List = true;
const usageErrRes = await runApi(storageUsage, "GET", "/api/storage-usage?refresh=1", { headers: { Cookie: adminCookie } });
eq(usageErrRes.status, 200, "用量统计降级返回 200");
const usageErrText = await usageErrRes.text();
ok(!usageErrText.includes("secret-internal-host-10.0.0.5"), "用量统计失败不得向前端泄露内部原始报错");
failR2List = false;

// 11. 外部存储月度下载流量原子限额校验
const awsLimitCfg = { monthlyTransferGb: 1 };
eq(await reserveAwsTransfer(env, awsLimitCfg, 600_000_000), true, "额度内第一次预留应成功");
eq(await reserveAwsTransfer(env, awsLimitCfg, 500_000_000), false, "超出月度限额的预留必须拒绝");
eq(await reserveAwsTransfer(env, awsLimitCfg, 400_000_000), true, "恰达上限的预留应成功");

// 12. upload-complete 严格路径校验
const badComplete = await runApi(uploadComplete, "POST", "/api/upload-complete", { body: { path: "../evil.txt" }, headers: { Cookie: adminCookie } });
eq(badComplete.status, 400, "上传完成回调必须拒绝危险路径");

console.log(`PASS ${checks} security assertions`);
