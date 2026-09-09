import { errorResponse, json } from "../_lib.js";
import { presignedUrl } from "../aws.js";
import { getAwsConfig, reserveAwsTransfer } from "../storage.js";

export async function onRequestGet({ request, env }) {
  const code = new URL(request.url).searchParams.get("code")?.trim() || "";
  if (!/^\d{5}$/.test(code)) return json({ error: "取件码无效" }, 400);
  try {
    const row = await env.DB.prepare("SELECT shares.*, files.name, files.size, files.storage, files.content_type, files.object_key FROM shares JOIN files ON files.id = shares.file_id WHERE shares.code = ?1").bind(code).first();
    if (!row || (row.expires_at && Number(row.expires_at) < Math.floor(Date.now() / 1000))) return json({ error: "取件码无效或已过期" }, 404);
    if (row.storage === "aws") {
      const config = await getAwsConfig(env);
      if (!config.enabled || !(await reserveAwsTransfer(env, config, row.size))) return json({ error: "AWS 本月下载流量已用完或未启用" }, 429);
    }
    const update = await env.DB.prepare("UPDATE shares SET remaining = CASE WHEN remaining IS NULL THEN NULL ELSE remaining - 1 END, downloads = downloads + 1 WHERE code = ?1 AND (remaining IS NULL OR remaining > 0)").bind(code).run();
    if (!update.meta?.changes) return json({ error: "下载次数已用完" }, 410);
    if (row.storage === "aws") {
      const config = await getAwsConfig(env);
      return Response.redirect(await presignedUrl(config, "GET", row.object_key, { expires: 900, query: { "response-content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.name)}` } }), 302);
    }
    const object = await env.R2.get(row.object_key);
    if (!object) return json({ error: "分享的文件已被删除" }, 404);
    return new Response(object.body, { headers: { "Content-Type": row.content_type, "Content-Length": String(row.size), "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.name)}`, "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error, "下载失败");
  }
}
