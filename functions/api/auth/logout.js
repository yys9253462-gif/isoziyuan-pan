import { clearSessionCookie, json } from "../../_lib.js";

export function onRequestPost({ request }) {
  return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie(request) });
}
