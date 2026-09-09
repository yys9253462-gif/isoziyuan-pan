import { errorResponse, json } from "../_lib.js";

export async function onRequestGet({ request, env }) {
  const code = new URL(request.url).searchParams.get("code")?.trim() || "";
  if (!/^\d{5}$/.test(code)) return json({ error: "取件码无效" }, 400);
  try {
    const row = await env.DB.prepare("SELECT shares.*, files.name, files.size, files.storage, files.content_type FROM shares JOIN files ON files.id = shares.file_id WHERE shares.code = ?1").bind(code).first();
    if (!row || (row.expires_at && Number(row.expires_at) < Math.floor(Date.now() / 1000)) || (row.remaining !== null && Number(row.remaining) <= 0)) return json({ error: "取件码无效、已过期或次数已用完" }, 404);
    return json({ ok: true, code, name: row.name, size: Number(row.size), contentType: row.content_type, remaining: row.remaining === null ? null : Number(row.remaining), expiresAt: Number(row.expires_at), downloadUrl: `/api/pickup-download?code=${code}` });
  } catch (error) {
    return errorResponse(error, "取件失败");
  }
}
