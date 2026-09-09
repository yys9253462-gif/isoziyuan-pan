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
  return [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${encode(key)}=${encode(value)}`).join("&");
}

function awsEndpoint(config) {
  return `https://${config.bucket}.s3.${config.region}.amazonaws.com`;
}

export function awsKey(config, path) {
  const prefix = normalizePath(config.prefix || "", true);
  return `${prefix}${normalizePath(path)}`;
}

export async function presignedUrl(config, method, key, options = {}) {
  const { amzDate, date } = timestamp();
  const host = new URL(awsEndpoint(config)).host;
  const encodedKey = normalizePath(key).split("/").map(encode).join("/");
  const canonicalUri = `/${encodedKey}`;
  const params = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${config.accessKey}/${date}/${config.region}/s3/aws4_request`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(options.expires || 900),
    "X-Amz-SignedHeaders": options.contentType ? "content-type;host" : "host"
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
  return `${awsEndpoint(config)}${canonicalUri}?${canonicalQuery(params)}`;
}

export async function awsRequest(config, method, key, options = {}) {
  const url = await presignedUrl(config, method, key, options);
  return fetch(url, { method, headers: options.contentType ? { "Content-Type": options.contentType } : undefined, body: options.body });
}

export async function validateAwsConfig(config) {
  const url = await presignedUrl(config, "GET", "", { expires: 60, query: { "list-type": "2", "max-keys": "1", prefix: normalizePath(config.prefix || "") } });
  const response = await fetch(url);
  if (!response.ok) throw new Error(`AWS returned ${response.status}`);
  return true;
}

export async function encryptConfig(config, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const keyBytes = await sha256(secret);
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(JSON.stringify(config))));
  return `${bytesToBase64Url(iv)}.${bytesToBase64Url(cipher)}`;
}

export async function decryptConfig(value, secret) {
  const [ivText, cipherText] = String(value || "").split(".");
  if (!ivText || !cipherText) return null;
  try {
    const keyBytes = await sha256(secret);
    const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
    const decode = (text) => Uint8Array.from(atob(text.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((text.length + 3) % 4)), (char) => char.charCodeAt(0));
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(ivText) }, key, decode(cipherText));
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    return null;
  }
}
