import { validateAwsConfig } from "../aws.js";
import { getAwsConfig, publicAwsConfig, saveAwsConfig, awsUsage } from "../storage.js";
import { errorResponse, isAdmin, json, requireAdmin, validateSafePath } from "../_lib.js";

function isValidAwsBucket(bucket) {
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) return false;
  if (bucket.includes("..")) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(bucket)) return false;
  return true;
}

function isValidAwsRegion(region) {
  return /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(region) && !region.includes("--");
}

function parseBoundedNumber(raw, fallback) {
  if (raw === undefined || raw === null || raw === "") return fallback;
  const num = Number(raw);
  if (!Number.isFinite(num) || num < 1 || num > 100000) return null;
  return Math.floor(num);
}

export async function onRequestGet({ request, env }) {
  const denied = requireAdmin(await isAdmin(request, env));
  if (denied) return denied;
  try {
    const config = await getAwsConfig(env);
    return json({ ...publicAwsConfig(config), usage: await awsUsage(env) });
  } catch (error) {
    return errorResponse(error, "无法读取外部存储设置");
  }
}

export async function onRequestPost({ request, env }) {
  const denied = requireAdmin(await isAdmin(request, env));
  if (denied) return denied;
  const data = await request.json().catch(() => ({}));
  try {
    const existing = await getAwsConfig(env);
    const capacityGb = parseBoundedNumber(data.capacityGb, 250);
    const monthlyTransferGb = parseBoundedNumber(data.monthlyTransferGb, 500);
    if (capacityGb === null || monthlyTransferGb === null) {
      return json({ error: "容量上限与月下载流量必须是 1 至 100000 之间的数字" }, 400);
    }
    const rawPrefix = String(data.prefix || "").trim();
    const safePrefix = validateSafePath(rawPrefix, { folder: true, allowEmpty: true });
    if (safePrefix === null) return json({ error: "路径前缀格式无效，不能包含上级目录片段或非法字符" }, 400);

    const config = {
      enabled: Boolean(data.enabled),
      bucket: String(data.bucket || "").trim(),
      region: String(data.region || "us-east-1").trim(),
      prefix: safePrefix,
      capacityGb,
      monthlyTransferGb,
      accessKey: String(data.accessKey || "").trim() || existing.accessKey,
      secretKey: String(data.secretKey || "").trim() || existing.secretKey,
    };

    if (config.bucket && !isValidAwsBucket(config.bucket)) return json({ error: "储存桶名称格式不正确" }, 400);
    if (config.region && !isValidAwsRegion(config.region)) return json({ error: "储存区域格式不正确" }, 400);
    if (config.enabled) {
      if (!config.bucket || !isValidAwsBucket(config.bucket)) return json({ error: "储存桶名称格式不正确" }, 400);
      if (!config.region || !isValidAwsRegion(config.region)) return json({ error: "储存区域格式不正确" }, 400);
      if (!config.accessKey || !config.secretKey) return json({ error: "首次启用必须填写访问密钥与私密密钥" }, 400);
      await validateAwsConfig(config);
    }
    await saveAwsConfig(env, config);
    return json({ ok: true, ...publicAwsConfig(config) });
  } catch (error) {
    console.error(JSON.stringify({ error: String(error?.message || error) }));
    return json({ error: "外部储存桶连接验证失败，请检查桶名、区域、密钥和权限" }, 400);
  }
}

export async function onRequestDelete({ request, env }) {
  const denied = requireAdmin(await isAdmin(request, env));
  if (denied) return denied;
  try {
    await saveAwsConfig(env, { enabled: false, bucket: "", region: "us-east-1", prefix: "", capacityGb: 250, monthlyTransferGb: 500, accessKey: "", secretKey: "" });
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error, "无法停用外部储存桶");
  }
}
