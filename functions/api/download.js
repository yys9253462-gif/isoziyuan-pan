import { isAdmin, json, requireAdmin, errorResponse } from "../_lib.js";
import { presignedUrl } from "../aws.js";
import { getAwsConfig, reserveAwsTransfer } from "../storage.js";

export async function onRequestGet({ request, env }) {
  const denied = requireAdmin(await isAdmin(request, env));
  if (denied) return denied;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return json({ error: "文件不存在" }, 400);
  try {
    const row = await env.DB.prepare("SELECT * FROM files WHERE id = ?1 AND kind = 'file'").bind(id).first();
    if (!row) return json({ error: "文件不存在" }, 404);
    if (row.storage === "aws") {
      const config = await getAwsConfig(env);
      if (!config.enabled || !(await reserveAwsTransfer(env, config, row.size))) return json({ error: "AWS 本月下载流量已用完或未启用" }, 429);
      return Response.redirect(await presignedUrl(config, "GET", row.object_key, { expires: 900, query: { "response-content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.name)}` } }), 302);
    }
    const object = await env.R2.get(row.object_key);
    if (!object) return json({ error: "文件已被删除" }, 404);
    return new Response(object.body, { headers: { "Content-Type": row.content_type, "Content-Length": String(row.size), "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.name)}` } });
  } catch (error) {
    return errorResponse(error, "下载失败");
  }
}
