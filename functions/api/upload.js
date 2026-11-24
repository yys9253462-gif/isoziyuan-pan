import {
  ancestorFolders,
  errorResponse,
  isAdmin,
  json,
  objectKey,
  requireAdmin,
  safeContentDisposition,
  sanitizeContentType,
  splitPath,
  validateSafePath,
} from "../_lib.js";

async function handleUpload({ request, env }) {
  const denied = requireAdmin(await isAdmin(request, env));
  if (denied) return denied;
  const url = new URL(request.url);
  if (url.searchParams.get("storage") && url.searchParams.get("storage") !== "r2") {
    return json({ error: "外部存储请使用预签名上传" }, 400);
  }
  const path = validateSafePath(url.searchParams.get("path"), { maxNameLength: 240 });
  if (!path || !request.body) return json({ error: "文件或路径无效" }, 400);
  const contentType = sanitizeContentType(request.headers.get("Content-Type"));
  const { folder, name } = splitPath(path);
  if (!name || name.length > 240) return json({ error: "文件或路径无效" }, 400);
  const headerSize = Number(request.headers.get("X-File-Size") || 0);
  const fallbackSize = Number.isSafeInteger(headerSize) && headerSize >= 0 ? headerSize : 0;

  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const key = objectKey(path);
  let existing = null;
  try {
    existing = await env.DB.prepare("SELECT id, kind FROM files WHERE object_key = ?1").bind(key).first();
    if (existing && existing.kind === "folder") {
      return json({ error: "已存在同名文件夹，无法覆盖" }, 400);
    }
    for (const anc of ancestorFolders(path)) {
      const ancRow = await env.DB.prepare("SELECT kind FROM files WHERE object_key = ?1").bind(objectKey(anc)).first();
      if (ancRow?.kind === "file") {
        return json({ error: "上级路径为同名文件，无法上传" }, 400);
      }
    }

    const putResult = await env.R2.put(key, request.body, {
      httpMetadata: { contentType, contentDisposition: safeContentDisposition(name) },
    });

    // 以对象存储实际落盘字节数为准，防止请求头伪造文件体积
    let realSize = fallbackSize;
    if (Number.isSafeInteger(putResult?.size) && putResult.size >= 0) {
      realSize = putResult.size;
    } else if (typeof env.R2.head === "function") {
      const head = await env.R2.head(key).catch(() => null);
      if (Number.isSafeInteger(head?.size) && head.size >= 0) {
        realSize = head.size;
      }
    }

    if (existing) {
      // 覆盖更新旧文件：保留原编号，使已有取件码、分享链接及后台下载直链完全不变
      await env.DB.prepare("UPDATE files SET size = ?1, content_type = ?2, updated_at = ?3 WHERE id = ?4").bind(realSize, contentType, now, existing.id).run();
      return json({ ok: true, id: existing.id, name, size: realSize, overwritten: true });
    }
    await env.DB
      .prepare(
        "INSERT INTO files (id, storage, object_key, name, folder, kind, size, content_type, created_at, updated_at) VALUES (?1, 'r2', ?2, ?3, ?4, 'file', ?5, ?6, ?7, ?7)"
      )
      .bind(id, key, name, folder, realSize, contentType, now)
      .run();
    return json({ ok: true, id, name, size: realSize, overwritten: false });
  } catch (error) {
    if (!existing) {
      await env.R2.delete(key).catch(() => undefined);
    }
    return errorResponse(error, "上传失败");
  }
}

export const onRequestPut = handleUpload;
export const onRequestPost = handleUpload;
