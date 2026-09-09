const PREFIX = "pan-cloudflare/";
const SESSION_COOKIE = "pan_session";
const SESSION_TTL = 60 * 60 * 24 * 7;
const encoder = new TextEncoder();

export function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlToBytes(value) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(normalized);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function digest(value) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

export async function constantTimeEqual(left, right) {
  const a = await digest(left);
  const b = await digest(right);
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a[i] ^ b[i];
  return difference === 0;
}

async function sign(value, secret) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))));
}

export async function isAdmin(request, env) {
  const cookie = request.headers.get("Cookie") || "";
  const raw = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  if (!raw) return false;
  const [expires, signature] = raw.split(".");
  if (!expires || !signature || Number(expires) < Math.floor(Date.now() / 1000)) return false;
  return constantTimeEqual(signature, await sign(expires, env.SESSION_SECRET));
}

export async function sessionCookie(env) {
  const expires = Math.floor(Date.now() / 1000) + SESSION_TTL;
  const signature = await sign(String(expires), env.SESSION_SECRET);
  return `${SESSION_COOKIE}=${expires}.${signature}; Path=/; Max-Age=${SESSION_TTL}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers } });
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

export function objectKey(path) {
  return PREFIX + normalizePath(path);
}

export function splitPath(path) {
  const clean = normalizePath(path);
  const index = clean.lastIndexOf("/");
  return index < 0 ? { folder: "", name: clean } : { folder: clean.slice(0, index + 1), name: clean.slice(index + 1) };
}

export function filePayload(row) {
  return { id: row.id, name: row.name, folder: row.folder, kind: row.kind, storage: row.storage || "r2", size: Number(row.size || 0), contentType: row.content_type, updatedAt: Number(row.updated_at) };
}

export function errorResponse(error, fallback = "操作失败") {
  console.error(JSON.stringify({ error: String(error?.message || error || fallback) }));
  return json({ error: fallback }, 500);
}
