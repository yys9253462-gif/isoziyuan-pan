import { presignedUrl, awsKey } from "../aws.js";
import { getAwsConfig } from "../storage.js";
import { parseStorage, getAccount, databaseKey } from '../r2-accounts.js';
import { isAdmin, json, normalizePath, requireAdmin, splitPath, objectKey } from "../_lib.js";

export async function onRequestPost({ request, env }) {
  const denied = requireAdmin(await isAdmin(request, env));
  if (denied) return denied;
  const data = await request.json().catch(() => ({}));
  const path = normalizePath(data.path);
  let space;
  try { space = parseStorage(data.storage || 'r2'); } catch { return json({error:'存储空间无效'},400); }
  const {storage,storageId}=space;
  const contentType = String(data.contentType || "application/octet-stream").slice(0, 200);
  const size = Math.max(0, Number(data.size || 0));
  const { name } = splitPath(path);
  if (!path || !name || name.length > 240) return json({ error: "文件或路径无效" }, 400);
  if (storage === "r2"&&!storageId) return json({ ok: true, storage, uploadUrl: `/api/upload?path=${encodeURIComponent(path)}`, size, contentType });
  const config = storageId ? await getAccount(env,storageId) : await getAwsConfig(env);
  if(storageId){
    const existing=await env.DB.prepare('SELECT kind FROM files WHERE object_key = ?1').bind(databaseKey(config,path)).first();
    if(existing?.kind==='folder')return json({error:'已存在同名文件夹，无法覆盖'},400);
  }
  if (!storageId&&!config.enabled) return json({ error: "AWS 储存桶尚未启用" }, 400);
  const key = awsKey(config, path);
  return json({ ok: true, storage:data.storage, direct:true, uploadUrl: await presignedUrl(config, "PUT", key, { expires: 3600, contentType }), size, contentType });
}
