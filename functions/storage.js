import { decryptConfig, encryptConfig } from "./aws.js";
import { normalizePath } from "./_lib.js";

const DEFAULTS = { enabled: false, bucket: "", region: "us-east-1", prefix: "", capacityGb: 250, monthlyTransferGb: 500, accessKey: "", secretKey: "" };

export async function getAwsConfig(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'aws_config'").first();
  const saved = row ? await decryptConfig(row.value, env.SESSION_SECRET) : null;
  return { ...DEFAULTS, ...(saved || {}), prefix: normalizePath(saved?.prefix || "", true), enabled: Boolean(saved?.enabled && saved?.bucket && saved?.accessKey && saved?.secretKey) };
}

export function publicAwsConfig(config) {
  return { enabled: config.enabled, bucket: config.bucket, region: config.region, prefix: config.prefix, capacityGb: config.capacityGb, monthlyTransferGb: config.monthlyTransferGb, hasCredentials: Boolean(config.accessKey && config.secretKey) };
}

export async function saveAwsConfig(env, config) {
  const value = await encryptConfig(config, env.SESSION_SECRET);
  await env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('aws_config', ?1, ?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at").bind(value, Math.floor(Date.now() / 1000)).run();
}

export async function reserveAwsTransfer(env, config, bytes) {
  const month = new Date().toISOString().slice(0, 7);
  const gbLimit = Number(config.monthlyTransferGb);
  // 若未设置或为 0 / 负数，表示不限制 AWS 流量
  if (!gbLimit || gbLimit <= 0) {
    await env.DB.prepare("INSERT INTO storage_usage (month, bytes, downloads) VALUES (?1, ?2, 1) ON CONFLICT(month) DO UPDATE SET bytes=bytes+excluded.bytes, downloads=downloads+1").bind(month, Number(bytes || 0)).run();
    return true;
  }
  const limit = gbLimit * 1000 ** 3;
  const current = await env.DB.prepare("SELECT bytes FROM storage_usage WHERE month = ?1").bind(month).first();
  const used = Number(current?.bytes || 0);
  if (used + Number(bytes || 0) > limit) return false;
  await env.DB.prepare("INSERT INTO storage_usage (month, bytes, downloads) VALUES (?1, ?2, 1) ON CONFLICT(month) DO UPDATE SET bytes=bytes+excluded.bytes, downloads=downloads+1").bind(month, Number(bytes || 0)).run();
  return true;
}

export async function awsUsage(env) {
  const month = new Date().toISOString().slice(0, 7);
  return (await env.DB.prepare("SELECT bytes, downloads FROM storage_usage WHERE month = ?1").bind(month).first()) || { bytes: 0, downloads: 0 };
}
