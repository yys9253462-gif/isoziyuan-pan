// 只允许通过 pan.ailxw.com 调用接口：*.pages.dev 默认域名不经过 WAF，直接拒绝
const ALLOWED_HOSTS = new Set(["pan.ailxw.com", "localhost", "127.0.0.1"]);

export async function onRequest({ request, next }) {
  if (!ALLOWED_HOSTS.has(new URL(request.url).hostname)) return new Response("Forbidden", { status: 403 });
  return next();
}
