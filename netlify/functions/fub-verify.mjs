/* POST /api/fub/verify
 *
 * The FUB embedded app posts the raw signed context it was framed with:
 *   { context: "<raw token>" }            — JWT form (header.payload.signature)
 *   { context: "<base64 json>", signature: "<hmac hex>" }  — context+signature form
 *
 * Both shapes are HMAC-SHA256 under the app's FUB secret; which one you
 * receive depends on how the embedded app is registered with FUB. This
 * function verifies either, then returns the trusted context plus a
 * short-lived session token the client sends back on later API calls.
 *
 * Environment (Netlify UI → Site settings → Environment variables):
 *   FUB_APP_SECRET   — the embedded-app secret from Follow Up Boss (required)
 *   SESSION_SECRET   — key for minting session tokens (falls back to FUB_APP_SECRET)
 *   SESSION_TTL_SEC  — session lifetime in seconds (default 3600)
 */
import crypto from "node:crypto";
import { b64url, fromB64url, timingSafeEq, mintSession, sessionSecret, json } from "../lib/session.mjs";

function verifyJwtHS256(token, secret) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [head, body, sig] = parts;
  const expected = b64url(crypto.createHmac("sha256", secret).update(`${head}.${body}`).digest());
  if (!timingSafeEq(sig, expected)) return null;
  try {
    const payload = JSON.parse(fromB64url(body).toString("utf8"));
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function verifyContextSignature(context, signature, secret) {
  const expected = crypto.createHmac("sha256", secret).update(context).digest("hex");
  if (!timingSafeEq(String(signature).toLowerCase(), expected)) return null;
  try {
    return JSON.parse(fromB64url(context).toString("utf8"));
  } catch {
    return null;
  }
}

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });

  const secret = process.env.FUB_APP_SECRET;
  if (!secret) return json(503, { error: "FUB_APP_SECRET is not configured" });

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }
  const { context, signature } = body || {};
  if (!context) return json(400, { error: "Missing context" });

  const payload = signature
    ? verifyContextSignature(context, signature, secret)
    : verifyJwtHS256(context, secret);
  if (!payload) return json(401, { error: "Context signature did not verify" });

  const ttl = Number(process.env.SESSION_TTL_SEC) || 3600;
  const session = mintSession(
    {
      accountId: payload.account?.id ?? payload.accountId ?? null,
      userId: payload.user?.id ?? payload.userId ?? null,
      personId: payload.person?.id ?? payload.personId ?? null,
    },
    sessionSecret(),
    ttl
  );

  // Shape matches what the client merges into its FUB state.
  return json(200, {
    account: payload.account ?? null,
    user: payload.user ?? null,
    person: payload.person ?? null,
    session,
  });
};

export const config = { path: "/api/fub/verify" };
