import { validateAwsConfig } from "../aws.js";
import { getAwsConfig, publicAwsConfig, saveAwsConfig, awsUsage } from "../storage.js";
import { errorResponse, isAdmin, json, requireAdmin } from "../_lib.js";

export async function onRequestGet({ request, env }) {
  const denied = requireAdmin(await isAdmin(request, env));
  if (denied) return denied;
  try {
    const config = await getAwsConfig(env);
    return json({ ...publicAwsConfig(config), usage: await awsUsage(env) });
  } catch (error) {
    return errorResponse(error, "无法读取 AWS 设置");
  }
}

export async function onRequestPost({ request, env }) {
  const denied = requireAdmin(await isAdmin(request, env));
  if (denied) return denied;
  const data = await request.json().catch(() => ({}));
  try {
    const existing = await getAwsConfig(env);
    const config = {
      enabled: Boolean(data.enabled), bucket: String(data.bucket || "").trim(), region: String(data.region || "us-east-1").trim(), prefix: String(data.prefix || "").trim(),
      capacityGb: Math.max(1, Math.min(100000, Number(data.capacityGb || 250))), monthlyTransferGb: Math.max(1, Math.min(100000, Number(data.monthlyTransferGb || 500))),
      accessKey: String(data.accessKey || "").trim() || existing.accessKey, secretKey: String(data.secretKey || "").trim() || existing.secretKey
    };
    if (config.enabled) {
      if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(config.bucket)) return json({ error: "AWS 桶名称格式不正确" }, 400);
      if (!/^[a-z0-9-]{2,63}$/.test(config.region)) return json({ error: "AWS 区域格式不正确" }, 400);
      if (!config.accessKey || !config.secretKey) return json({ error: "首次启用必须填写 Access Key 和 Secret Key" }, 400);
      await validateAwsConfig(config);
    }
    await saveAwsConfig(env, config);
    return json({ ok: true, ...publicAwsConfig(config) });
  } catch (error) {
    console.error(JSON.stringify({ error: String(error?.message || error) }));
    return json({ error: "AWS 连接验证失败，请检查桶名、区域、密钥和权限" }, 400);
  }
}

export async function onRequestDelete({ request, env }) {
  const denied = requireAdmin(await isAdmin(request, env));
  if (denied) return denied;
  try {
    await saveAwsConfig(env, { enabled: false, bucket: "", region: "us-east-1", prefix: "", capacityGb: 250, monthlyTransferGb: 500, accessKey: "", secretKey: "" });
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error, "无法停用 AWS");
  }
}
