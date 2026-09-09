export function onRequestGet({ request, params }) {
  const url = new URL("/pickup.html", request.url);
  url.searchParams.set("code", params.code);
  return Response.redirect(url.toString(), 302);
}
