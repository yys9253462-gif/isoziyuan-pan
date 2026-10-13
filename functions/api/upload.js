import { errorResponse, isAdmin, json, normalizePath, requireAdmin, splitPath, objectKey } from "../_lib.js";

async function handleUpload({ request, env }) {
  const denied = requireAdmin(await isAdmin(request, env));
  if (denied) return denied;
  const url = new URL(request.url);
  const path = normalizePath(url.searchParams.get("path"));
  const contentType = (request.headers.get("Content-Type") || "application/octet-stream").slice(0, 200);
  const { folder, name } = splitPath(path);
  if (url.searchParams.get("storage") && url.searchParams.get("storage") !== 'r2') return json({ error: "外部存储请使用预签名上传" }, 400);
  if (!path || !name || name.length > 240 || !request.body) return json({ error: "文件或路径无效" }, 400);
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const key = objectKey(path);
  const size = Number(request.headers.get("X-File-Size") || 0);
  let existing = null;
  try {
    existing = await env.DB.prepare("SELECT id, kind FROM files WHERE object_key = ?1").bind(key).first();
    if (existing && existing.kind === "folder") {
      return json({ error: "已存在同名文件夹，无法覆盖" }, 400);
    }

    await env.R2.put(key, request.body, { httpMetadata: { contentType, contentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(name)}` } });

    if (existing) {
      // 覆盖更新旧文件：保留原 ID，使已有取件码、分享链接及后台下载直链完全不变
      await env.DB.prepare("UPDATE files SET size = ?1, content_type = ?2, updated_at = ?3 WHERE id = ?4").bind(size, contentType, now, existing.id).run();
      return json({ ok: true, id: existing.id, name, overwritten: true });
    } else {
      await env.DB.prepare("INSERT INTO files (id, storage, object_key, name, folder, kind, size, content_type, created_at, updated_at) VALUES (?1, 'r2', ?2, ?3, ?4, 'file', ?5, ?6, ?7, ?7)").bind(id, key, name, folder, size, contentType, now).run();
      return json({ ok: true, id, name, overwritten: false });
    }
  } catch (error) {
    if (!existing) {
      await env.R2.delete(key).catch(() => undefined);
    }
    return errorResponse(error, "上传失败");
  }
}

export const onRequestPut = handleUpload;
export const onRequestPost = handleUpload;
