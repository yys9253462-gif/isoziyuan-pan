export function onRequestGet({ params }) {
  return Response.redirect(`/pickup.html?code=${encodeURIComponent(params.code)}`, 302);
}
