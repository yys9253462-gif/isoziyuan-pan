export const PREFIX = "pan-cloudflare/";
export const ALLOWED_HOSTS = new Set(["pan.ailxw.com", "localhost", "127.0.0.1"]);

const SESSION_COOKIE = "pan_session";
const SESSION_TTL = 60 * 60 * 24 * 7;
const SESSION_SCOPE = "session:admin";
const PICKUP_TICKET_TTL = 60 * 10;
const LOGIN_WINDOW_SECONDS = 15 * 60;
const LOGIN_MAX_FAILURES = 5;
const LOGIN_RL_PREFIX = "login_rl:";
const encoder = new TextEncoder();

export function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function digest(value) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(String(value))));
}

function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function getSessionSecret(env) {
  if (typeof env?.SESSION_SECRET !== "string") return "";
  return env.SESSION_SECRET.trim();
}

export async function constantTimeEqual(left, right) {
  const a = await digest(left);
  const b = await digest(right);
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a[i] ^ b[i];
  return difference === 0;
}

async function sign(value, secret) {
  if (typeof secret !== "string" || !secret.trim()) {
    throw new Error("缺少有效的会话签名密钥");
  }
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))));
}

function isLocalHttp(request) {
  if (!request?.url) return false;
  try {
    const url = new URL(request.url);
    return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

export async function isAdmin(request, env) {
  const secret = getSessionSecret(env);
  if (!secret) return false;
  const cookie = request.headers.get("Cookie") || "";
  const raw = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  if (!raw || raw.length > 256) return false;
  const parts = raw.split(".");
  if (parts.length !== 2) return false;
  const [expires, signature] = parts;
  if (!/^\d{1,15}$/.test(expires) || !/^[A-Za-z0-9_-]{20,128}$/.test(signature)) return false;
  const now = Math.floor(Date.now() / 1000);
  const exp = Number(expires);
  if (!Number.isSafeInteger(exp) || exp < now || exp > now + SESSION_TTL + 60) return false;
  return constantTimeEqual(signature, await sign(`${SESSION_SCOPE}:${expires}`, secret));
}

export async function sessionCookie(env, request = null) {
  const secret = getSessionSecret(env);
  if (!secret) throw new Error("会话密钥未配置");
  const expires = Math.floor(Date.now() / 1000) + SESSION_TTL;
  const signature = await sign(`${SESSION_SCOPE}:${expires}`, secret);
  const secureFlag = isLocalHttp(request) ? "" : "; Secure";
  return `${SESSION_COOKIE}=${expires}.${signature}; Path=/; Max-Age=${SESSION_TTL}; HttpOnly${secureFlag}; SameSite=Strict`;
}

export function clearSessionCookie(request = null) {
  const secureFlag = isLocalHttp(request) ? "" : "; Secure";
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly${secureFlag}; SameSite=Strict`;
}

// 校验状态变更请求的来源，拦截跨站与跨子域伪造请求
export function checkSameOrigin(request) {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;
  let reqOrigin;
  try {
    reqOrigin = new URL(request.url).origin;
  } catch {
    return false;
  }
  const fetchSite = (request.headers.get("Sec-Fetch-Site") || "").trim().toLowerCase();
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return false;
  }
  const origin = (request.headers.get("Origin") || "").trim();
  if (origin) {
    try {
      if (new URL(origin).origin !== reqOrigin) return false;
    } catch {
      return false;
    }
    return true;
  }
  const referer = (request.headers.get("Referer") || "").trim();
  if (referer) {
    try {
      if (new URL(referer).origin !== reqOrigin) return false;
    } catch {
      return false;
    }
  }
  return true;
}

// 提取客户端地址并做单向摘要，避免在数据库中明文存留访问地址
async function loginLimitKey(request) {
  const cfIp = (request.headers.get("CF-Connecting-IP") || "").trim();
  const xff = (request.headers.get("X-Forwarded-For") || "").split(",")[0].trim();
  const rawIp = cfIp || xff || "unknown";
  const hash = bytesToHex(await digest(`login-rate:${rawIp}`)).slice(0, 24);
  return `${LOGIN_RL_PREFIX}${hash}`;
}

export async function checkLoginRateLimit(request, env) {
  if (!env?.DB) return { allowed: true, retryAfter: 0 };
  try {
    const key = await loginLimitKey(request);
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?1").bind(key).first();
    if (!row?.value) return { allowed: true, retryAfter: 0 };
    const record = JSON.parse(row.value);
    const now = Math.floor(Date.now() / 1000);
    const resetAt = Number(record?.resetAt || 0);
    const count = Number(record?.count || 0);
    if (resetAt <= now) return { allowed: true, retryAfter: 0 };
    if (count >= LOGIN_MAX_FAILURES) {
      return { allowed: false, retryAfter: Math.max(1, resetAt - now) };
    }
    return { allowed: true, retryAfter: 0 };
  } catch {
    return { allowed: true, retryAfter: 0 };
  }
}

export async function recordLoginFailure(request, env) {
  if (!env?.DB) return;
  try {
    const key = await loginLimitKey(request);
    const now = Math.floor(Date.now() / 1000);
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?1").bind(key).first();
    let count = 1;
    let resetAt = now + LOGIN_WINDOW_SECONDS;
    if (row?.value) {
      try {
        const prev = JSON.parse(row.value);
        if (Number(prev?.resetAt || 0) > now) {
          count = Number(prev?.count || 0) + 1;
          resetAt = Number(prev.resetAt);
        }
      } catch {
        // 忽略损坏记录并重新计数
      }
    }
    await env.DB
      .prepare("INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at")
      .bind(key, JSON.stringify({ count, resetAt }), now)
      .run();
    // 顺带清理过期的频控记录，防止配置表堆积
    await env.DB
      .prepare("DELETE FROM settings WHERE key LIKE 'login_rl:%' AND updated_at < ?1")
      .bind(now - LOGIN_WINDOW_SECONDS * 2)
      .run()
      .catch(() => undefined);
  } catch {
    // 频控落库异常不阻塞主流程
  }
}

export async function clearLoginFailures(request, env) {
  if (!env?.DB) return;
  try {
    const key = await loginLimitKey(request);
    await env.DB.prepare("DELETE FROM settings WHERE key = ?1").bind(key).run();
  } catch {
    // 忽略清理异常
  }
}

// 取件人机验证：验证通过后签发十分钟有效、绑定取件码的下载票据
export async function verifyTurnstile(request, env, token) {
  if (typeof token !== "string" || token.length === 0 || token.length > 2048 || !env?.TURNSTILE_SECRET) return false;
  const body = new FormData();
  body.append("secret", env.TURNSTILE_SECRET);
  body.append("response", token);
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) body.append("remoteip", ip);
  const signal = typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(10000) : undefined;
  const result = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body, signal })
    .then((r) => r.json())
    .catch(() => null);
  if (!result?.success) return false;
  try {
    const reqHost = new URL(request.url).hostname;
    if (reqHost === "pan.ailxw.com" && result.hostname && result.hostname !== reqHost) {
      return false;
    }
  } catch {
    return false;
  }
  return true;
}

export async function pickupTicket(env, code) {
  const secret = getSessionSecret(env);
  if (!secret || !/^\d{5}$/.test(String(code || ""))) {
    throw new Error("无法签发下载票据");
  }
  const expires = Math.floor(Date.now() / 1000) + PICKUP_TICKET_TTL;
  return `${expires}.${await sign(`pickup:${code}:${expires}`, secret)}`;
}

export async function verifyPickupTicket(env, code, ticket) {
  const secret = getSessionSecret(env);
  if (!secret || !/^\d{5}$/.test(String(code || ""))) return false;
  const raw = String(ticket || "");
  if (!raw || raw.length > 256) return false;
  const parts = raw.split(".");
  if (parts.length !== 2) return false;
  const [expires, signature] = parts;
  if (!/^\d{1,15}$/.test(expires) || !/^[A-Za-z0-9_-]{20,128}$/.test(signature)) return false;
  const now = Math.floor(Date.now() / 1000);
  const exp = Number(expires);
  if (!Number.isSafeInteger(exp) || exp < now || exp > now + PICKUP_TICKET_TTL + 60) return false;
  return constantTimeEqual(signature, await sign(`pickup:${code}:${expires}`, secret));
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

export function requireAdmin(admin) {
  return admin ? null : json({ error: "登录已过期，请重新登录" }, 401);
}

export function normalizePath(value, folder = false) {
  const raw = String(value || "").replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  const parts = raw.split("/").filter((part) => part && part !== "." && part !== "..");
  const clean = parts.join("/");
  return folder && clean ? `${clean}/` : clean;
}

// 严格路径校验：显式拒绝穿越片段、空字节、控制字符、超长路径及保留探测前缀
export function validateSafePath(value, { folder = false, allowEmpty = false, maxLength = 1024, maxDepth = 32, maxNameLength = 240 } = {}) {
  const rawStr = String(value ?? "");
  if (!rawStr.trim()) return allowEmpty ? "" : null;
  if (/[\u0000-\u001f\u007f]/.test(rawStr)) return null;
  const unified = rawStr.replaceAll("\\", "/");
  const trimmed = unified.replace(/^\/+|\/+$/g, "");
  if (!trimmed) return allowEmpty ? "" : null;
  if (trimmed.length > maxLength) return null;
  const parts = trimmed.split("/");
  if (parts.length > maxDepth) return null;
  for (const part of parts) {
    if (!part || part === "." || part === "..") return null;
    if (part.length > maxNameLength) return null;
    if (part === ".connection-check") return null;
  }
  const clean = parts.join("/");
  return folder ? `${clean}/` : clean;
}

export function objectKey(path) {
  return PREFIX + normalizePath(path);
}

export function splitPath(path) {
  const clean = normalizePath(path);
  const index = clean.lastIndexOf("/");
  return index < 0 ? { folder: "", name: clean } : { folder: clean.slice(0, index + 1), name: clean.slice(index + 1) };
}

// 列举某路径的全部上级目录路径，用于阻止把文件当作目录继续写入
export function ancestorFolders(cleanPath) {
  const parts = normalizePath(cleanPath).split("/").filter(Boolean);
  const ancestors = [];
  for (let i = 1; i < parts.length; i += 1) {
    ancestors.push(parts.slice(0, i).join("/"));
  }
  return ancestors;
}

// 规范化媒体类型，剔除控制字符并限制合法格式
export function sanitizeContentType(value) {
  const raw = String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  const base = raw.split(";")[0].trim().toLowerCase();
  if (/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(base) && base.length <= 128) {
    return base;
  }
  return "application/octet-stream";
}

// 构造安全的附件下载头，防止文件名注入及跨站脚本执行
export function safeContentDisposition(name) {
  const cleaned = String(name || "download")
    .replace(/[\u0000-\u001f\u007f/\\]/g, "_")
    .trim() || "download";
  const asciiFallback = cleaned
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\;]/g, "_")
    .slice(0, 120) || "download";
  const encoded = encodeURIComponent(cleaned).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

export function safeDownloadHeaders(name, contentType, size) {
  const normalizedType = sanitizeContentType(contentType);
  // 含网页或脚本执行能力的类型一律强制转为二进制下载，杜绝浏览器直接解析
  const activeWebPattern = /(?:html|svg|xml|javascript|ecmascript|x-mixed-replace)/i;
  const safeType = activeWebPattern.test(normalizedType) ? "application/octet-stream" : normalizedType;
  const headers = {
    "Content-Type": safeType,
    "Content-Disposition": safeContentDisposition(name),
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
  };
  if (Number.isSafeInteger(Number(size)) && Number(size) >= 0) {
    headers["Content-Length"] = String(Number(size));
  }
  return headers;
}

export function filePayload(row) {
  return {
    id: row.id,
    name: row.name,
    folder: row.folder,
    kind: row.kind,
    storage: row.storage || "r2",
    size: Number(row.size || 0),
    contentType: row.content_type,
    updatedAt: Number(row.updated_at),
  };
}

export function errorResponse(error, fallback = "操作失败") {
  console.error(JSON.stringify({ error: String(error?.message || error || fallback) }));
  return json({ error: fallback }, 500);
}

export const TITLE_MAX = 60;

// 分享标题说明：剔除控制字符与零宽字符、压缩空白、限制长度
export function cleanTitle(value) {
  const text = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[\u200b-\u200f\u2028\u2029\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, TITLE_MAX);
}
