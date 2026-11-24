import { errorResponse, isAdmin, json, requireAdmin, safeContentDisposition, safeDownloadHeaders } from "../_lib.js";
import { presignedUrl } from "../aws.js";
import { getAwsConfig, reserveAwsTransfer } from "../storage.js";
import { remoteDownload } from "../r2-accounts.js";

function redirectDownload(location) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function onRequestGet({ request, env }) {
  const denied = requireAdmin(await isAdmin(request, env));
  if (denied) return denied;
  const id = String(new URL(request.url).searchParams.get("id") || "").trim();
  if (!id || id.length > 128) return json({ error: "文件不存在" }, 400);
  try {
    const row = await env.DB.prepare("SELECT * FROM files WHERE id = ?1 AND kind = 'file'").bind(id).first();
    if (!row) return json({ error: "文件不存在" }, 404);
    if (row.storage_id) return redirectDownload(await remoteDownload(env, row));
    if (row.storage === "aws") {
      const config = await getAwsConfig(env);
      if (!config.enabled || !(await reserveAwsTransfer(env, config, row.size))) {
        return json({ error: "外部对象储存本月下载流量已用完或未启用" }, 429);
      }
      const target = await presignedUrl(config, "GET", row.object_key, {
        expires: 900,
        query: { "response-content-disposition": safeContentDisposition(row.name) },
      });
      return redirectDownload(target);
    }
    const object = await env.R2.get(row.object_key);
    if (!object) return json({ error: "文件已被删除" }, 404);
    const size = Number.isSafeInteger(object.size) ? object.size : row.size;
    return new Response(object.body, { headers: safeDownloadHeaders(row.name, row.content_type, size) });
  } catch (error) {
    return errorResponse(error, "下载失败");
  }
}
