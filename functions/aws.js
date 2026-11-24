import { bytesToBase64Url, normalizePath } from "./_lib.js";

const encoder = new TextEncoder();

function hex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function encode(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

async function sha256(value) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", typeof value === "string" ? encoder.encode(value) : value));
}

async function hmac(key, value) {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(value)));
}

function timestamp() {
  const date = new Date();
  const iso = date.toISOString().replace(/[-:]|\.\d{3}/g, "");
  return { amzDate: iso, date: iso.slice(0, 8) };
}

function canonicalQuery(params) {
  return [...params.entries()]
    .map(([k, v]) => [encode(k), encode(v)])
    .sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

function isValidAwsBucket(bucket) {
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) return false;
  if (bucket.includes("..")) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(bucket)) return false;
  return true;
}

function isValidAwsRegion(region) {
  return /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(region) && !region.includes("--");
}

// 严格校验目标存储地址构成，阻断主机名注入与服务端请求伪造
function awsEndpoint(config) {
  if (config.accountId) {
    const accountId = String(config.accountId);
    const jurisdiction = String(config.jurisdiction || "");
    const bucket = String(config.bucket || "");
    if (!/^[0-9a-f]{32}$/.test(accountId)) throw new Error("账号编号格式无效");
    if (!["", "eu", "fedramp"].includes(jurisdiction)) throw new Error("数据区域格式无效");
    if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error("存储桶名称格式无效");
    return `https://${accountId}${jurisdiction ? "." + jurisdiction : ""}.r2.cloudflarestorage.com/${bucket}`;
  }
  const bucket = String(config.bucket || "");
  const region = String(config.region || "");
  if (!isValidAwsBucket(bucket)) throw new Error("存储桶名称格式无效");
  if (!isValidAwsRegion(region)) throw new Error("存储区域格式无效");
  return `https://${bucket}.s3.${region}.amazonaws.com`;
}

export function awsKey(config, path) {
  const prefix = normalizePath(config.prefix || "", true);
  return `${prefix}${normalizePath(path)}`;
}

export async function presignedUrl(config, method, key, options = {}) {
  const { amzDate, date } = timestamp();
  const endpoint = new URL(awsEndpoint(config));
  const host = endpoint.host;
  const encodedKey = normalizePath(key).split("/").map(encode).join("/");
  const canonicalUri = `${endpoint.pathname.replace(/\/$/, "")}/${encodedKey}`;
  const params = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${config.accessKey}/${date}/${config.region}/s3/aws4_request`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(options.expires || 900),
    "X-Amz-SignedHeaders": options.contentType ? "content-type;host" : "host",
  });
  if (options.query) for (const [name, value] of Object.entries(options.query)) params.set(name, String(value));
  const signedHeaders = options.contentType ? `content-type:${options.contentType}\nhost:${host}\n` : `host:${host}\n`;
  const signedHeaderNames = options.contentType ? "content-type;host" : "host";
  const canonicalRequest = `${method}\n${canonicalUri}\n${canonicalQuery(params)}\n${signedHeaders}\n${signedHeaderNames}\nUNSIGNED-PAYLOAD`;
  const scope = `${date}/${config.region}/s3/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${hex(await sha256(canonicalRequest))}`;
  const kDate = await hmac(encoder.encode(`AWS4${config.secretKey}`), date);
  const kRegion = await hmac(kDate, config.region);
  const kService = await hmac(kRegion, "s3");
  const kSigning = await hmac(kService, "aws4_request");
  params.set("X-Amz-Signature", hex(await hmac(kSigning, stringToSign)));
  return `${endpoint.origin}${canonicalUri}?${canonicalQuery(params)}`;
}

export async function awsRequest(config, method, key, options = {}) {
  const url = await presignedUrl(config, method, key, options);
  const signal = typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(15000) : undefined;
  return fetch(url, {
    method,
    headers: options.contentType ? { "Content-Type": options.contentType } : undefined,
    body: options.body,
    signal,
  });
}

export async function validateAwsConfig(config) {
  const url = await presignedUrl(config, "GET", "", {
    expires: 60,
    query: { "list-type": "2", "max-keys": "1", prefix: normalizePath(config.prefix || "") },
  });
  const signal = typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(15000) : undefined;
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`对象存储接口返回状态码 ${response.status}`);
  return true;
}

export async function encryptConfig(config, secret) {
  if (typeof secret !== "string" || !secret.trim()) throw new Error("缺少加密密钥");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const keyBytes = await sha256(secret);
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(JSON.stringify(config))));
  return `${bytesToBase64Url(iv)}.${bytesToBase64Url(cipher)}`;
}

export async function decryptConfig(value, secret) {
  if (typeof secret !== "string" || !secret.trim()) return null;
  const parts = String(value || "").split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [ivText, cipherText] = parts;
  try {
    const keyBytes = await sha256(secret);
    const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
    const decode = (text) =>
      Uint8Array.from(atob(text.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((text.length + 3) % 4)), (char) => char.charCodeAt(0));
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(ivText) }, key, decode(cipherText));
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    return null;
  }
}
