import {
  checkLoginRateLimit,
  clearLoginFailures,
  constantTimeEqual,
  getSessionSecret,
  isAdmin,
  json,
  recordLoginFailure,
  sessionCookie,
} from "../../_lib.js";

export async function onRequestPost({ request, env }) {
  if (!env?.ADMIN_PASSWORD || !getSessionSecret(env)) {
    return json({ error: "管理后台安全密钥未配置，请联系站点维护者" }, 503);
  }
  const limit = await checkLoginRateLimit(request, env);
  if (!limit.allowed) {
    const minutes = Math.max(1, Math.ceil(limit.retryAfter / 60));
    return json(
      { error: `密码连续错误次数过多，请约 ${minutes} 分钟后再试`, retryAfter: limit.retryAfter },
      429,
      { "Retry-After": String(limit.retryAfter) }
    );
  }
  const data = await request.json().catch(() => ({}));
  const password = typeof data?.password === "string" ? data.password : "";
  if (!password || password.length > 256) {
    await recordLoginFailure(request, env);
    return json({ error: "密码不正确" }, 401);
  }
  if (!(await constantTimeEqual(password, env.ADMIN_PASSWORD))) {
    await recordLoginFailure(request, env);
    return json({ error: "密码不正确" }, 401);
  }
  await clearLoginFailures(request, env);
  return json({ ok: true }, 200, { "Set-Cookie": await sessionCookie(env, request) });
}

export async function onRequestGet({ request, env }) {
  return json({ admin: await isAdmin(request, env) });
}
