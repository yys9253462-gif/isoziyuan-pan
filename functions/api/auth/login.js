import { constantTimeEqual, isAdmin, json, sessionCookie } from "../../_lib.js";

export async function onRequestPost({ request, env }) {
  const data = await request.json().catch(() => ({}));
  const password = String(data.password || "");
  if (!env.ADMIN_PASSWORD || !(await constantTimeEqual(password, env.ADMIN_PASSWORD))) return json({ error: "密码不正确" }, 401);
  return json({ ok: true }, 200, { "Set-Cookie": await sessionCookie(env) });
}

export async function onRequestGet({ request, env }) {
  return json({ admin: await isAdmin(request, env) });
}
