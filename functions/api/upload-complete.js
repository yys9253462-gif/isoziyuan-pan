import { awsKey, presignedUrl } from "../aws.js";
import { getAwsConfig } from "../storage.js";
import { parseStorage, getAccount, databaseKey } from "../r2-accounts.js";
import {
  ancestorFolders,
  errorResponse,
  isAdmin,
  json,
  objectKey,
  requireAdmin,
  sanitizeContentType,
  splitPath,
  validateSafePath,
} from "../_lib.js";

export async function onRequestPost({ request, env }) {
  const denied = requireAdmin(await isAdmin(request, env));
  if (denied) return denied;
  const data = await request.json().catch(() => ({}));
  const path = validateSafePath(data.path, { maxNameLength: 240 });
  if (!path) return json({ error: "文件路径无效" }, 400);
  let space;
  try {
    space = parseStorage(data.storage || "r2");
  } catch {
    return json({ error: "存储空间无效" }, 400);
  }
  const { storage, storageId } = space;
  const { folder, name } = splitPath(path);
  if (!name || name.length > 240) return json({ error: "文件路径无效" }, 400);
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  let size = 0;
  let contentType = sanitizeContentType(data.contentType);
  try {
    const config = storageId ? await getAccount(env, storageId) : storage === "aws" ? await getAwsConfig(env) : null;
    if (storage === "aws" && !config.enabled) return json({ error: "外部对象储存桶尚未启用" }, 400);
    const key = storageId ? databaseKey(config, path) : storage === "aws" ? awsKey(config, path) : objectKey(path);
    const keyFor = storageId ? (p) => databaseKey(config, p) : storage === "aws" ? (p) => awsKey(config, p) : (p) => objectKey(p);

    for (const anc of ancestorFolders(path)) {
      const ancRow = await env.DB.prepare("SELECT kind FROM files WHERE object_key = ?1").bind(keyFor(anc)).first();
      if (ancRow?.kind === "file") return json({ error: "上级路径为同名文件，无法保存记录" }, 400);
    }

    if (storage === "aws" || storageId) {
      const signal = typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(15000) : undefined;
      const response = await fetch(await presignedUrl(config, "HEAD", awsKey(config, path), { expires: 60 }), { method: "HEAD", signal });
      if (!response.ok) return json({ error: "外部对象上传未完成" }, 400);
      size = Number(response.headers.get("content-length"));
      if (!Number.isSafeInteger(size) || size < 0) return json({ error: "无法确认上传文件大小" }, 400);
      contentType = sanitizeContentType(response.headers.get("content-type") || contentType);
    } else {
      const head = await env.R2.head(key);
      if (!head) return json({ error: "默认储存桶上传未完成" }, 400);
      size = Number(head.size);
      if (!Number.isSafeInteger(size) || size < 0) return json({ error: "无法确认上传文件大小" }, 400);
      contentType = sanitizeContentType(head.httpMetadata?.contentType || contentType);
    }

    const existing = await env.DB.prepare("SELECT id, kind FROM files WHERE object_key = ?1").bind(key).first();
    if (existing && existing.kind === "folder") {
      return json({ error: "已存在同名文件夹，无法覆盖" }, 400);
    }
    if (existing) {
      await env.DB.prepare("UPDATE files SET size = ?1, content_type = ?2, updated_at = ?3 WHERE id = ?4").bind(size, contentType, now, existing.id).run();
      return json({ ok: true, id: existing.id, name, overwritten: true });
    }
    await env.DB
      .prepare(
        "INSERT INTO files (id, storage, object_key, name, folder, kind, size, content_type, created_at, updated_at, storage_id) VALUES (?1, ?2, ?3, ?4, ?5, 'file', ?6, ?7, ?8, ?8, ?9)"
      )
      .bind(id, storage, key, name, folder, size, contentType, now, storageId)
      .run();
    return json({ ok: true, id, name, overwritten: false });
  } catch (error) {
    return errorResponse(error, "保存上传记录失败");
  }
}
