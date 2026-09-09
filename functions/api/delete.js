import { errorResponse, isAdmin, json, requireAdmin } from "../_lib.js";
import { awsRequest } from "../aws.js";
import { getAwsConfig } from "../storage.js";

export async function onRequestPost({ request, env }) {
  const denied = requireAdmin(await isAdmin(request, env));
  if (denied) return denied;
  const data = await request.json().catch(() => ({}));
  const id = String(data.id || "");
  if (!id) return json({ error: "文件不存在" }, 400);
  try {
    const row = await env.DB.prepare("SELECT * FROM files WHERE id = ?1").bind(id).first();
    if (!row) return json({ error: "文件不存在" }, 404);
    const rows = row.kind === "folder"
      ? await env.DB.prepare("SELECT * FROM files WHERE storage = ?1 AND (id = ?2 OR folder LIKE ?3)").bind(row.storage || "r2", id, `${row.folder}${row.name}/%`).all()
      : { results: [row] };
    const all = rows.results || [];
    const awsConfig = row.storage === "aws" ? await getAwsConfig(env) : null;
    for (const item of all) {
      if (row.storage === "aws") await awsRequest(awsConfig, "DELETE", item.object_key);
      else await env.R2.delete(item.object_key);
    }
    await env.DB.prepare(row.kind === "folder" ? "DELETE FROM files WHERE storage = ?1 AND (id = ?2 OR folder LIKE ?3)" : "DELETE FROM files WHERE id = ?1").bind(...(row.kind === "folder" ? [row.storage || "r2", id, `${row.folder}${row.name}/%`] : [id])).run();
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error, "删除失败");
  }
}
