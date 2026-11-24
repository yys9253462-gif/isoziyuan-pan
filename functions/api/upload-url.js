import { presignedUrl, awsKey } from "../aws.js";
import { getAwsConfig } from "../storage.js";
import { parseStorage, getAccount, databaseKey } from "../r2-accounts.js";
import { ancestorFolders, errorResponse, isAdmin, json, objectKey, requireAdmin, sanitizeContentType, splitPath, validateSafePath } from "../_lib.js";

export async function onRequestPost({ request, env }) {
  const denied = requireAdmin(await isAdmin(request, env));
  if (denied) return denied;
  const data = await request.json().catch(() => ({}));
  const path = validateSafePath(data.path, { maxNameLength: 240 });
  if (!path) return json({ error: "文件或路径无效" }, 400);
  let space;
  try {
    space = parseStorage(data.storage || "r2");
  } catch {
    return json({ error: "存储空间无效" }, 400);
  }
  const { storage, storageId } = space;
  const contentType = sanitizeContentType(data.contentType);
  const rawSize = data.size === undefined || data.size === null || data.size === "" ? 0 : Number(data.size);
  if (!Number.isFinite(rawSize) || rawSize < 0) return json({ error: "文件大小参数无效" }, 400);
  const size = Math.floor(rawSize);
  const { name } = splitPath(path);
  if (!name || name.length > 240) return json({ error: "文件或路径无效" }, 400);

  try {
    if (storage === "r2" && !storageId) {
      const existing = await env.DB.prepare("SELECT kind FROM files WHERE object_key = ?1").bind(objectKey(path)).first();
      if (existing?.kind === "folder") return json({ error: "已存在同名文件夹，无法覆盖" }, 400);
      for (const anc of ancestorFolders(path)) {
        const ancRow = await env.DB.prepare("SELECT kind FROM files WHERE object_key = ?1").bind(objectKey(anc)).first();
        if (ancRow?.kind === "file") return json({ error: "上级路径为同名文件，无法上传" }, 400);
      }
      return json({ ok: true, storage, uploadUrl: `/api/upload?path=${encodeURIComponent(path)}`, size, contentType });
    }

    let config;
    if (storageId) {
      try {
        config = await getAccount(env, storageId);
      } catch {
        return json({ error: "指定的外部存储空间不存在" }, 404);
      }
      const existing = await env.DB.prepare("SELECT kind FROM files WHERE object_key = ?1").bind(databaseKey(config, path)).first();
      if (existing?.kind === "folder") return json({ error: "已存在同名文件夹，无法覆盖" }, 400);
      for (const anc of ancestorFolders(path)) {
        const ancRow = await env.DB.prepare("SELECT kind FROM files WHERE object_key = ?1").bind(databaseKey(config, anc)).first();
        if (ancRow?.kind === "file") return json({ error: "上级路径为同名文件，无法上传" }, 400);
      }
    } else {
      config = await getAwsConfig(env);
      if (!config.enabled) return json({ error: "外部对象储存桶尚未启用" }, 400);
      const existing = await env.DB.prepare("SELECT kind FROM files WHERE object_key = ?1").bind(awsKey(config, path)).first();
      if (existing?.kind === "folder") return json({ error: "已存在同名文件夹，无法覆盖" }, 400);
      for (const anc of ancestorFolders(path)) {
        const ancRow = await env.DB.prepare("SELECT kind FROM files WHERE object_key = ?1").bind(awsKey(config, anc)).first();
        if (ancRow?.kind === "file") return json({ error: "上级路径为同名文件，无法上传" }, 400);
      }
    }

    const key = awsKey(config, path);
    const canonicalSpace = storageId ? `r2:${storageId}` : storage;
    return json({
      ok: true,
      storage: canonicalSpace,
      direct: true,
      uploadUrl: await presignedUrl(config, "PUT", key, { expires: 3600, contentType }),
      size,
      contentType,
    });
  } catch (error) {
    return errorResponse(error, "生成上传地址失败");
  }
}
