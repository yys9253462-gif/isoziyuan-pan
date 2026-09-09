import { clearSessionCookie, json } from "../../_lib.js";

export function onRequestPost() {
  return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie() });
}
