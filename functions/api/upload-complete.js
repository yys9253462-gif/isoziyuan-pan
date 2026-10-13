import { awsKey, presignedUrl } from "../aws.js";
import { getAwsConfig } from "../storage.js";
import { parseStorage, getAccount, databaseKey } from '../r2-accounts.js';
import { errorResponse, isAdmin, json, normalizePath, objectKey, requireAdmin, splitPath } from "../_lib.js";

export async function onRequestPost({ request, env }) {
  const denied = requireAdmin(await isAdmin(request, env));
  if (denied) return denied;
  const data = await request.json().catch(() => ({}));
  const path = normalizePath(data.path);
  let space;
  try { space=parseStorage(data.storage||'r2'); } catch { return json({error:'存储空间无效'},400); }
  const {storage,storageId}=space;
  const { folder, name } = splitPath(path);
  if (!path || !name) return json({ error: "文件路径无效" }, 400);
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  let size = Math.max(0, Number(data.size || 0));
  let contentType = String(data.contentType || "application/octet-stream").slice(0, 200);
  try {
    const config = storageId?await getAccount(env,storageId):(storage === "aws" ? await getAwsConfig(env) : null);
    if (storage === "aws" && !config.enabled) return json({ error: "AWS 储存桶尚未启用" }, 400);
    const key = storageId?databaseKey(config,path):(storage === "aws" ? awsKey(config, path) : objectKey(path));
    if (storage === "aws"||storageId) {
      const response = await fetch(await presignedUrl(config, "HEAD", awsKey(config,path), { expires: 60 }), { method: 'HEAD' });
      if (!response.ok) return json({ error: "AWS 上传未完成" }, 400);
      size=Number(response.headers.get('content-length'));
      if(!Number.isSafeInteger(size)||size<0)return json({error:'无法确认上传文件大小'},400);
      contentType=response.headers.get('content-type')||contentType;
    } else {
      const head=await env.R2.head(key);
      if(!head)return json({error:'R2 上传未完成'},400);
      size=head.size;contentType=head.httpMetadata?.contentType||contentType;
    }
    const existing = await env.DB.prepare("SELECT id, kind FROM files WHERE object_key = ?1").bind(key).first();
    if (existing && existing.kind === "folder") {
      return json({ error: "已存在同名文件夹，无法覆盖" }, 400);
    }
    if (existing) {
      // 覆盖更新旧文件：保留原 ID，使已有取件码、分享链接及后台下载直链完全不变
      await env.DB.prepare("UPDATE files SET size = ?1, content_type = ?2, updated_at = ?3 WHERE id = ?4").bind(size, contentType, now, existing.id).run();
      return json({ ok: true, id: existing.id, name, overwritten: true });
    } else {
      await env.DB.prepare("INSERT INTO files (id, storage, object_key, name, folder, kind, size, content_type, created_at, updated_at,storage_id) VALUES (?1, ?2, ?3, ?4, ?5, 'file', ?6, ?7, ?8, ?8,?9)").bind(id, storage, key, name, folder, size, contentType, now,storageId).run();
      return json({ ok: true, id, name, overwritten: false });
    }
  } catch (error) {
    return errorResponse(error, "保存上传记录失败");
  }
}
