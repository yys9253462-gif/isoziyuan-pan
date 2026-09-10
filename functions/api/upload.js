import { errorResponse, isAdmin, json, normalizePath, requireAdmin, splitPath, objectKey } from "../_lib.js";

async function handleUpload({ request, env }) {
  const denied = requireAdmin(await isAdmin(request, env));
  if (denied) return denied;
  const url = new URL(request.url);
  const path = normalizePath(url.searchParams.get("path"));
  const contentType = (request.headers.get("Content-Type") || "application/octet-stream").slice(0, 200);
  const { folder, name } = splitPath(path);
  if (url.searchParams.get("storage") === "aws") return json({ error: "AWS 请使用预签名上传" }, 400);
  if (!path || !name || name.length > 240 || !request.body) return json({ error: "文件或路径无效" }, 400);
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const key = objectKey(path);
  try {
    await env.R2.put(key, request.body, { httpMetadata: { contentType, contentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(name)}` } });
    await env.DB.prepare("INSERT INTO files (id, storage, object_key, name, folder, kind, size, content_type, created_at, updated_at) VALUES (?1, 'r2', ?2, ?3, ?4, 'file', ?5, ?6, ?7, ?7)").bind(id, key, name, folder, Number(request.headers.get("X-File-Size") || 0), contentType, now).run();
    return json({ ok: true, id, name });
  } catch (error) {
    await env.R2.delete(key).catch(() => undefined);
    return errorResponse(error, "上传失败");
  }
}

export const onRequestPut = handleUpload;
export const onRequestPost = handleUpload;
