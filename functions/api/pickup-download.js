import { errorResponse, json, safeContentDisposition, safeDownloadHeaders, verifyPickupTicket } from "../_lib.js";
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
  const params = new URL(request.url).searchParams;
  const code = params.get("code")?.trim() || "";
  if (!/^\d{5}$/.test(code)) return json({ error: "取件码无效" }, 400);
  if (!(await verifyPickupTicket(env, code, params.get("t")))) {
    return json({ error: "下载链接已失效，请重新打开取件页" }, 403);
  }
  try {
    const row = await env.DB
      .prepare(
        "SELECT shares.*, files.name, files.size, files.storage, files.storage_id, files.content_type, files.object_key FROM shares JOIN files ON files.id = shares.file_id WHERE shares.code = ?1 AND files.kind = 'file'"
      )
      .bind(code)
      .first();
    const now = Math.floor(Date.now() / 1000);
    if (!row || (row.expires_at && Number(row.expires_at) < now)) return json({ error: "取件码无效或已过期" }, 404);
    if (row.remaining !== null && Number(row.remaining) <= 0) return json({ error: "下载次数已用完" }, 410);

    let remoteUrl = null;
    let awsUrl = null;
    let nativeObject = null;

    if (row.storage_id) {
      remoteUrl = await remoteDownload(env, row);
    } else if (row.storage === "aws") {
      const config = await getAwsConfig(env);
      if (!config.enabled || !(await reserveAwsTransfer(env, config, row.size))) {
        return json({ error: "外部对象储存本月下载流量已用完或未启用" }, 429);
      }
      awsUrl = await presignedUrl(config, "GET", row.object_key, {
        expires: 900,
        query: { "response-content-disposition": safeContentDisposition(row.name) },
      });
    } else {
      nativeObject = await env.R2.get(row.object_key);
      if (!nativeObject) return json({ error: "分享的文件已被删除" }, 404);
    }

    // 原子扣减次数并复核有效期，杜绝过期或超限竞态
    const update = await env.DB
      .prepare(
        "UPDATE shares SET remaining = CASE WHEN remaining IS NULL THEN NULL ELSE remaining - 1 END, downloads = downloads + 1 WHERE code = ?1 AND (remaining IS NULL OR remaining > 0) AND (expires_at = 0 OR expires_at >= ?2)"
      )
      .bind(code, Math.floor(Date.now() / 1000))
      .run();
    if (!update.meta?.changes) {
      await nativeObject?.body?.cancel?.().catch?.(() => undefined);
      return json({ error: "下载次数已用完或链接已过期" }, 410);
    }

    if (remoteUrl) return redirectDownload(remoteUrl);
    if (awsUrl) return redirectDownload(awsUrl);
    const size = Number.isSafeInteger(nativeObject.size) ? nativeObject.size : row.size;
    return new Response(nativeObject.body, { headers: safeDownloadHeaders(row.name, row.content_type, size) });
  } catch (error) {
    return errorResponse(error, "下载失败");
  }
}
