import { presignedUrl, awsKey } from "../aws.js";
import { getAwsConfig } from "../storage.js";
import { isAdmin, json, normalizePath, requireAdmin, splitPath, objectKey } from "../_lib.js";

export async function onRequestPost({ request, env }) {
  const denied = requireAdmin(await isAdmin(request, env));
  if (denied) return denied;
  const data = await request.json().catch(() => ({}));
  const path = normalizePath(data.path);
  const storage = data.storage === "aws" ? "aws" : "r2";
  const contentType = String(data.contentType || "application/octet-stream").slice(0, 200);
  const size = Math.max(0, Number(data.size || 0));
  const { name } = splitPath(path);
  if (!path || !name || name.length > 240) return json({ error: "文件或路径无效" }, 400);
  if (storage === "r2") return json({ ok: true, storage, uploadUrl: `/api/upload?path=${encodeURIComponent(path)}`, size, contentType });
  const config = await getAwsConfig(env);
  if (!config.enabled) return json({ error: "AWS 储存桶尚未启用" }, 400);
  const key = awsKey(config, path);
  return json({ ok: true, storage, uploadUrl: await presignedUrl(config, "PUT", key, { expires: 3600, contentType }), size, contentType });
}
