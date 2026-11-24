import { decryptConfig, encryptConfig, presignedUrl } from "./aws.js";
import { PREFIX, getSessionSecret, normalizePath } from "./_lib.js";

const DEFAULTS = { enabled: false, bucket: "", region: "us-east-1", prefix: "", capacityGb: 250, monthlyTransferGb: 500, accessKey: "", secretKey: "" };

// 储存桶名称与配置文件保持一致
export const R2_BUCKET_NAME = "forum-uploads";
// 免费额度参考：每月十吉字节标准存储（十进制计量）
export const R2_FREE_TIER_BYTES = 10 * 1000 ** 3;
export const USAGE_CACHE_KEY = "usage_cache";
// 缓存有效期（秒）：避免每次打开后台都全量遍历储存桶
export const USAGE_TTL = 600;
const LIST_PAGE_SIZE = 1000;
const LIST_MAX_PAGES = 200;

export async function getAwsConfig(env) {
  const secret = getSessionSecret(env);
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'aws_config'").first();
  const saved = row && secret ? await decryptConfig(row.value, secret) : null;
  return {
    ...DEFAULTS,
    ...(saved || {}),
    prefix: normalizePath(saved?.prefix || "", true),
    enabled: Boolean(saved?.enabled && saved?.bucket && saved?.accessKey && saved?.secretKey),
  };
}

export function publicAwsConfig(config) {
  return {
    enabled: config.enabled,
    bucket: config.bucket,
    region: config.region,
    prefix: config.prefix,
    capacityGb: config.capacityGb,
    monthlyTransferGb: config.monthlyTransferGb,
    hasCredentials: Boolean(config.accessKey && config.secretKey),
  };
}

export async function saveAwsConfig(env, config) {
  const secret = getSessionSecret(env);
  const value = await encryptConfig(config, secret);
  await env.DB
    .prepare("INSERT INTO settings (key, value, updated_at) VALUES ('aws_config', ?1, ?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at")
    .bind(value, Math.floor(Date.now() / 1000))
    .run();
}

// 原子预留月度下载流量，杜绝并发下载绕过流量上限
export async function reserveAwsTransfer(env, config, bytes) {
  const month = new Date().toISOString().slice(0, 7);
  const safeBytes = Number.isFinite(Number(bytes)) && Number(bytes) > 0 ? Math.floor(Number(bytes)) : 0;
  const gbLimit = Number(config.monthlyTransferGb);
  if (!Number.isFinite(gbLimit) || gbLimit <= 0) {
    await env.DB
      .prepare("INSERT INTO storage_usage (month, bytes, downloads) VALUES (?1, ?2, 1) ON CONFLICT(month) DO UPDATE SET bytes=bytes+excluded.bytes, downloads=downloads+1")
      .bind(month, safeBytes)
      .run();
    return true;
  }
  const limit = Math.floor(gbLimit * 1000 ** 3);
  await env.DB.prepare("INSERT INTO storage_usage (month, bytes, downloads) VALUES (?1, 0, 0) ON CONFLICT(month) DO NOTHING").bind(month).run();
  const updated = await env.DB
    .prepare("UPDATE storage_usage SET bytes = bytes + ?2, downloads = downloads + 1 WHERE month = ?1 AND bytes + ?2 <= ?3")
    .bind(month, safeBytes, limit)
    .run();
  return Boolean(updated?.meta?.changes);
}

export async function awsUsage(env) {
  const month = new Date().toISOString().slice(0, 7);
  return (await env.DB.prepare("SELECT bytes, downloads FROM storage_usage WHERE month = ?1").bind(month).first()) || { bytes: 0, downloads: 0 };
}

// 真实遍历默认储存桶，仅累加本网盘专属前缀下的对象
export async function scanR2Usage(env) {
  if (!env.R2 || typeof env.R2.list !== "function") throw new Error("未绑定默认储存桶");
  let cursor;
  let bytes = 0;
  let objects = 0;
  let pages = 0;
  let limited = false;
  for (;;) {
    const page = await env.R2.list({ prefix: PREFIX, cursor, limit: LIST_PAGE_SIZE });
    const list = page?.objects || [];
    for (const object of list) bytes += Number(object.size || 0);
    objects += list.length;
    pages += 1;
    if (!page?.truncated || !page?.cursor) break;
    if (pages >= LIST_MAX_PAGES) {
      limited = true;
      break;
    }
    cursor = page.cursor;
  }
  return { bucket: R2_BUCKET_NAME, prefix: PREFIX, bytes, objects, pages, limited };
}

// 分页遍历外部对象存储桶并累加对象大小
export async function scanAwsUsage(config) {
  const prefix = normalizePath(config.prefix || "");
  let bytes = 0;
  let objects = 0;
  let pages = 0;
  let limited = false;
  let token;
  for (;;) {
    const query = { "list-type": "2", "max-keys": String(LIST_PAGE_SIZE) };
    if (prefix) query.prefix = prefix;
    if (token) query["continuation-token"] = token;
    const signal = typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(15000) : undefined;
    const response = await fetch(await presignedUrl(config, "GET", "", { expires: 300, query }), { signal });
    if (!response.ok) throw new Error(`外部储存桶返回状态码 ${response.status}`);
    const xml = await response.text();
    for (const match of xml.matchAll(/<Size>(\d+)<\/Size>/g)) bytes += Number(match[1]);
    objects += (xml.match(/<Contents>/g) || []).length;
    pages += 1;
    if (!/<IsTruncated>true<\/IsTruncated>/i.test(xml)) break;
    const next = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
    if (!next) break;
    if (pages >= LIST_MAX_PAGES) {
      limited = true;
      break;
    }
    token = next[1]
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }
  return { enabled: true, bucket: config.bucket, prefix: prefix || "(整桶)", bytes, objects, pages, limited };
}

export async function readUsageCache(env) {
  try {
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?1").bind(USAGE_CACHE_KEY).first();
    if (!row?.value) return null;
    return JSON.parse(row.value);
  } catch {
    return null;
  }
}

export async function writeUsageCache(env, payload) {
  await env.DB
    .prepare("INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at")
    .bind(USAGE_CACHE_KEY, JSON.stringify(payload), Math.floor(Date.now() / 1000))
    .run();
}
