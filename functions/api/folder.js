import { ancestorFolders, errorResponse, isAdmin, json, objectKey, requireAdmin, splitPath, validateSafePath } from "../_lib.js";
import { awsKey } from "../aws.js";
import { getAwsConfig } from "../storage.js";
import { parseStorage, getAccount, databaseKey } from "../r2-accounts.js";

export async function onRequestPost({ request, env }) {
  const denied = requireAdmin(await isAdmin(request, env));
  if (denied) return denied;
  const data = await request.json().catch(() => ({}));
  const path = validateSafePath(data.path, { folder: true, maxNameLength: 180 });
  if (!path) return json({ error: "文件夹名称或路径无效" }, 400);
  let space;
  try {
    space = parseStorage(data.storage || "r2");
  } catch {
    return json({ error: "存储空间无效" }, 400);
  }
  const { storage, storageId } = space;
  const { folder, name } = splitPath(path.slice(0, -1));
  if (!name || name.length > 180) return json({ error: "文件夹名称无效" }, 400);
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  try {
    let key = objectKey(path);
    let keyFor = (p) => objectKey(p);
    if (storageId) {
      const account = await getAccount(env, storageId);
      key = databaseKey(account, path);
      keyFor = (p) => databaseKey(account, p);
    } else if (storage === "aws") {
      const awsConfig = await getAwsConfig(env);
      if (!awsConfig.enabled) return json({ error: "外部对象储存桶尚未启用" }, 400);
      key = awsKey(awsConfig, path);
      keyFor = (p) => awsKey(awsConfig, p);
    }

    // 写入对象前先查重，避免创建同名目录覆盖已有文件数据
    const existing = await env.DB.prepare("SELECT id, kind FROM files WHERE object_key = ?1").bind(key).first();
    if (existing) {
      return json({ error: existing.kind === "folder" ? "已存在同名文件夹" : "已存在同名文件，无法创建文件夹" }, 409);
    }

    // 检查上级路径是否存在同名文件，阻止在文件路径下继续建目录
    for (const anc of ancestorFolders(path)) {
      const ancRow = await env.DB.prepare("SELECT kind FROM files WHERE object_key = ?1").bind(keyFor(anc)).first();
      if (ancRow?.kind === "file") {
        return json({ error: "上级路径为同名文件，无法创建文件夹" }, 400);
      }
    }

    if (!storageId && storage === "r2") {
      await env.R2.put(key, new Uint8Array(0), { httpMetadata: { contentType: "application/x-directory" } });
    }
    await env.DB
      .prepare(
        "INSERT INTO files (id, storage, object_key, name, folder, kind, size, content_type, created_at, updated_at, storage_id) VALUES (?1, ?2, ?3, ?4, ?5, 'folder', 0, 'application/x-directory', ?6, ?6, ?7)"
      )
      .bind(id, storage, key, name, folder, now, storageId)
      .run();
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error, "创建文件夹失败");
  }
}
