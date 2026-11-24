import { cleanTitle, errorResponse, isAdmin, json, requireAdmin, TITLE_MAX } from "../_lib.js";

// 拒绝采样生成均匀分布的五位数字取件码，消除取模偏差
function randomCode() {
  const limit = Math.floor(0x100000000 / 100000) * 100000;
  const values = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(values);
    if (values[0] < limit) {
      return String(values[0] % 100000).padStart(5, "0");
    }
  }
}

export async function onRequestGet({ request, env }) {
  const denied = requireAdmin(await isAdmin(request, env));
  if (denied) return denied;
  const fileId = String(new URL(request.url).searchParams.get("fileId") || "").trim();
  if (!fileId || fileId.length > 128) return json({ error: "缺少文件编号" }, 400);
  try {
    const rows = await env.DB.prepare("SELECT * FROM shares WHERE file_id = ?1 ORDER BY created_at DESC").bind(fileId).all();
    const now = Math.floor(Date.now() / 1000);
    return json({
      shares: (rows.results || []).map((s) => ({
        code: s.code,
        title: s.title || "",
        expiresAt: Number(s.expires_at),
        remaining: s.remaining === null ? null : Number(s.remaining),
        downloads: Number(s.downloads || 0),
        expired: Boolean(s.expires_at && Number(s.expires_at) < now),
        exhausted: s.remaining !== null && Number(s.remaining) <= 0,
      })),
    });
  } catch (error) {
    return errorResponse(error, "无法读取分享历史");
  }
}

export async function onRequestPost({ request, env }) {
  const denied = requireAdmin(await isAdmin(request, env));
  if (denied) return denied;
  const data = await request.json().catch(() => ({}));
  const fileId = typeof data?.fileId === "string" ? data.fileId.trim() : "";
  const title = cleanTitle(data.title);
  const style = String(data.style || "day");
  const rawValue = style === "forever" ? 1 : Number(data.value === undefined || data.value === null || data.value === "" ? 7 : data.value);
  if (!fileId || fileId.length > 128 || !["minute", "hour", "day", "count", "forever"].includes(style)) {
    return json({ error: "分享参数无效" }, 400);
  }
  if (!Number.isFinite(rawValue) || rawValue < 1 || rawValue > 9999) {
    return json({ error: "有效期或次数数值无效" }, 400);
  }
  const value = Math.floor(rawValue);
  if (title.length > TITLE_MAX) return json({ error: `标题说明最多 ${TITLE_MAX} 个字符` }, 400);
  try {
    const file = await env.DB.prepare("SELECT * FROM files WHERE id = ?1 AND kind = 'file'").bind(fileId).first();
    if (!file) return json({ error: "文件不存在" }, 404);
    const custom = String(data.code || "").trim();
    if (custom && !/^\d{5}$/.test(custom)) return json({ error: "取件码必须是 5 位数字" }, 400);

    const seconds = { minute: 60, hour: 3600, day: 86400 };
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = seconds[style] ? now + value * seconds[style] : 0;
    const remaining = style === "count" ? value : null;

    // 原子抢占空闲取件码，绝不覆盖其他文件正在使用的取件码
    let code = "";
    const maxAttempts = custom ? 1 : 30;
    for (let i = 0; i < maxAttempts; i += 1) {
      const candidate = custom || randomCode();
      const inserted = await env.DB
        .prepare("INSERT OR IGNORE INTO shares (code, file_id, title, expires_at, remaining, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
        .bind(candidate, fileId, title, expiresAt, remaining, now)
        .run();
      if (inserted?.meta?.changes === 1) {
        code = candidate;
        break;
      }
      if (custom) return json({ error: "该取件码已被使用" }, 409);
    }
    if (!code) {
      return json({ error: "可用取件码暂时紧张，请稍后重试" }, 503);
    }
    const url = `${new URL(request.url).origin}/pickup/${code}`;
    return json({ ok: true, code, url, title });
  } catch (error) {
    return errorResponse(error, "生成取件码失败");
  }
}
