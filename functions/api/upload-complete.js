import { awsKey, presignedUrl } from "../aws.js";
import { getAwsConfig } from "../storage.js";
import { errorResponse, isAdmin, json, normalizePath, objectKey, requireAdmin, splitPath } from "../_lib.js";

export async function onRequestPost({ request, env }) {
  const denied = requireAdmin(await isAdmin(request, env));
  if (denied) return denied;
  const data = await request.json().catch(() => ({}));
  const path = normalizePath(data.path);
  const storage = data.storage === "aws" ? "aws" : "r2";
  const { folder, name } = splitPath(path);
  if (!path || !name) return json({ error: "文件路径无效" }, 400);
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const size = Math.max(0, Number(data.size || 0));
  const contentType = String(data.contentType || "application/octet-stream").slice(0, 200);
  try {
    const config = storage === "aws" ? await getAwsConfig(env) : null;
    if (storage === "aws" && !config.enabled) return json({ error: "AWS 储存桶尚未启用" }, 400);
    const key = storage === "aws" ? awsKey(config, path) : objectKey(path);
    if (storage === "aws") {
      const response = await fetch(await presignedUrl(config, "HEAD", key, { expires: 60 }));
      if (!response.ok) return json({ error: "AWS 上传未完成" }, 400);
    }
    await env.DB.prepare("INSERT INTO files (id, storage, object_key, name, folder, kind, size, content_type, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, 'file', ?6, ?7, ?8, ?8)").bind(id, storage, key, name, folder, size, contentType, now).run();
    return json({ ok: true, id, name });
  } catch (error) {
    return errorResponse(error, "保存上传记录失败");
  }
}
