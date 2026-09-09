import { errorResponse, isAdmin, json, requireAdmin } from "../_lib.js";

function randomCode() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return String(values[0] % 100000).padStart(5, "0");
}

export async function onRequestPost({ request, env }) {
  const denied = requireAdmin(await isAdmin(request, env));
  if (denied) return denied;
  const data = await request.json().catch(() => ({}));
  const fileId = String(data.fileId || "");
  const style = String(data.style || "day");
  const value = Math.max(1, Math.min(9999, Number(data.value || 7)));
  if (!fileId || !["minute", "hour", "day", "count", "forever"].includes(style)) return json({ error: "分享参数无效" }, 400);
  try {
    const file = await env.DB.prepare("SELECT * FROM files WHERE id = ?1 AND kind = 'file'").bind(fileId).first();
    if (!file) return json({ error: "文件不存在" }, 404);
    const custom = String(data.code || "").trim();
    if (custom && !/^\d{5}$/.test(custom)) return json({ error: "取件码必须是 5 位数字" }, 400);
    let code = custom || randomCode();
    for (let i = 0; i < 20; i += 1) {
      const exists = await env.DB.prepare("SELECT code FROM shares WHERE code = ?1").bind(code).first();
      if (!exists) break;
      if (custom) return json({ error: "该取件码已被使用" }, 409);
      code = randomCode();
    }
    const seconds = { minute: 60, hour: 3600, day: 86400 };
    const expiresAt = seconds[style] ? Math.floor(Date.now() / 1000) + value * seconds[style] : 0;
    const remaining = style === "count" ? value : null;
    await env.DB.prepare("INSERT INTO shares (code, file_id, expires_at, remaining, created_at) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(code) DO UPDATE SET file_id=excluded.file_id, expires_at=excluded.expires_at, remaining=excluded.remaining, downloads=0, created_at=excluded.created_at").bind(code, fileId, expiresAt, remaining, Math.floor(Date.now() / 1000)).run();
    const url = `${new URL(request.url).origin}/pickup/${code}`;
    return json({ ok: true, code, url });
  } catch (error) {
    return errorResponse(error, "生成取件码失败");
  }
}
