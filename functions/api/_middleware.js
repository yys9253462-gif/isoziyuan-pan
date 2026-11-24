import { ALLOWED_HOSTS, checkSameOrigin, json } from "../_lib.js";

// 仅允许通过白名单域名访问接口，同时拦截跨站伪造请求并补齐安全响应头
export async function onRequest({ request, next }) {
  let hostname;
  try {
    hostname = new URL(request.url).hostname;
  } catch {
    return json({ error: "请求地址无效" }, 400);
  }
  if (!ALLOWED_HOSTS.has(hostname)) {
    return new Response("Forbidden", { status: 403, headers: { "X-Content-Type-Options": "nosniff" } });
  }
  if (!checkSameOrigin(request)) {
    return json({ error: "非法跨站请求来源" }, 403);
  }
  const response = await next();
  const headers = new Headers(response.headers);
  if (!headers.has("X-Content-Type-Options")) headers.set("X-Content-Type-Options", "nosniff");
  if (!headers.has("X-Frame-Options")) headers.set("X-Frame-Options", "DENY");
  if (!headers.has("Referrer-Policy")) headers.set("Referrer-Policy", "no-referrer");
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", "no-store");
  if (!headers.has("Content-Security-Policy")) headers.set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
