import { ALLOWED_HOSTS } from "../_lib.js";

export function onRequestGet({ request, params }) {
  const reqUrl = new URL(request.url);
  if (!ALLOWED_HOSTS.has(reqUrl.hostname)) {
    return new Response("Forbidden", { status: 403, headers: { "X-Content-Type-Options": "nosniff" } });
  }
  const code = String(params.code || "").trim();
  const target = new URL("/pickup.html", request.url);
  if (/^\d{5}$/.test(code)) {
    target.searchParams.set("code", code);
  } else {
    target.searchParams.set("invalid", "1");
  }
  return new Response(null, {
    status: 302,
    headers: {
      Location: target.toString(),
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
