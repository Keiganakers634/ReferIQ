/* Shared helpers for the ReferIQ Netlify functions: base64url, constant-time
 * comparison, and the HMAC-signed session tokens minted by /api/fub/verify
 * and checked by every authenticated endpoint. */
import crypto from "node:crypto";

export const b64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export const fromB64url = (s) =>
  Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

export const timingSafeEq = (a, b) => {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
};

export const sessionSecret = () =>
  process.env.SESSION_SECRET || process.env.FUB_APP_SECRET || null;

export function mintSession(claims, secret, ttlSec) {
  const body = b64url(JSON.stringify({ ...claims, exp: Math.floor(Date.now() / 1000) + ttlSec }));
  const sig = b64url(crypto.createHmac("sha256", secret).update(body).digest());
  return `${body}.${sig}`;
}

export function readSession(token, secret) {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expected = b64url(crypto.createHmac("sha256", secret).update(body).digest());
  if (!timingSafeEq(sig, expected)) return null;
  try {
    const claims = JSON.parse(fromB64url(body).toString("utf8"));
    return claims.exp && Date.now() / 1000 > claims.exp ? null : claims;
  } catch {
    return null;
  }
}

export const json = (status, data) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
