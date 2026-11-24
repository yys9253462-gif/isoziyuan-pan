import { errorResponse, filePayload, isAdmin, json, requireAdmin, validateSafePath } from "../_lib.js";
import { parseStorage } from "../r2-accounts.js";

export async function onRequestGet({ request, env }) {
  const denied = requireAdmin(await isAdmin(request, env));
  if (denied) return denied;
  const searchParams = new URL(request.url).searchParams;
  const rawFolder = searchParams.get("folder");
  const folder = validateSafePath(rawFolder, { folder: true, allowEmpty: true });
  if (folder === null) return json({ error: "文件夹路径无效" }, 400);
  let space;
  try {
    space = parseStorage(searchParams.get("storage") || "r2");
  } catch {
    return json({ error: "存储空间无效" }, 400);
  }
  try {
    const { storage, storageId } = space;
    const result = await env.DB
      .prepare(
        "SELECT files.*, (SELECT COUNT(*) FROM shares WHERE file_id=files.id) AS share_count, (SELECT COUNT(*) FROM shares WHERE file_id=files.id AND (expires_at=0 OR expires_at>=?4) AND (remaining IS NULL OR remaining>0)) AS share_active, (SELECT SUM(downloads) FROM shares WHERE file_id=files.id) AS share_downloads FROM files WHERE storage = ?1 AND folder = ?2 AND storage_id = ?3 ORDER BY kind DESC, name COLLATE NOCASE ASC"
      )
      .bind(storage, folder, storageId, Math.floor(Date.now() / 1000))
      .all();
    return json({
      folder,
      storage,
      storageId,
      files: (result.results || []).map((row) => ({
        ...filePayload(row),
        storageId: row.storage_id,
        shareCount: Number(row.share_count || 0),
        shareActive: Number(row.share_active || 0),
        shareDownloads: Number(row.share_downloads || 0),
      })),
    });
  } catch (error) {
    return errorResponse(error, "无法读取文件列表");
  }
}
