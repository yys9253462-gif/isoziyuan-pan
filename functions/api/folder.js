import { errorResponse, isAdmin, json, normalizePath, objectKey, requireAdmin, splitPath } from "../_lib.js";
import { awsKey } from "../aws.js";
import { getAwsConfig } from "../storage.js";

export async function onRequestPost({ request, env }) {
  const denied = requireAdmin(await isAdmin(request, env));
  if (denied) return denied;
  const data = await request.json().catch(() => ({}));
  const path = normalizePath(data.path, true);
  const storage = data.storage === "aws" ? "aws" : "r2";
  const { folder, name } = splitPath(path.slice(0, -1));
  if (!path || !name || name.length > 180) return json({ error: "文件夹名称无效" }, 400);
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  try {
    let key = objectKey(path);
    if (storage === "aws") {
      const awsConfig = await getAwsConfig(env);
      if (!awsConfig.enabled) return json({ error: "AWS 储存桶尚未启用" }, 400);
      key = awsKey(awsConfig, path);
    } else {
      await env.R2.put(key, new Uint8Array(0), { httpMetadata: { contentType: "application/x-directory" } });
    }
    await env.DB.prepare("INSERT INTO files (id, storage, object_key, name, folder, kind, size, content_type, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, 'folder', 0, 'application/x-directory', ?6, ?6)").bind(id, storage, key, name, folder, now).run();
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error, "创建文件夹失败");
  }
}
