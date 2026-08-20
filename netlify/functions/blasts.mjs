/* POST /api/v1/blasts
 *
 * Receives a blast from the FUB embedded app (see syncGo() in
 * public/fub/index.html for the exact payload) and sends one SMS per
 * recipient through Telnyx. Requires the Bearer session token minted by
 * /api/fub/verify.
 *
 * Environment:
 *   TELNYX_API_KEY              — required to actually send
 *   TELNYX_MESSAGING_PROFILE_ID — optional, else Telnyx uses the number's profile
 *   TELNYX_FROM_NUMBER          — the ReferIQ sending number, E.164
 *
 * What is deliberately NOT here yet:
 *   - Persistence. The client keeps blast state in memory; delivery
 *     receipts and inbound "Y" replies need a store (Netlify Blobs, or a
 *     DB) plus a Telnyx webhook function to update blast status.
 *   - Server-side agent pool resolution. The prototype builds the
 *     recipient pool client-side from demo data; production should
 *     resolve the pool here from a real agent directory and ignore
 *     client-supplied phone numbers.
 */
import { readSession, sessionSecret, json } from "../lib/session.mjs";

const TELNYX_API = "https://api.telnyx.com/v2/messages";

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });

  const secret = sessionSecret();
  if (!secret) return json(503, { error: "FUB_APP_SECRET is not configured" });

  const auth = req.headers.get("authorization") || "";
  const claims = readSession(auth.replace(/^Bearer\s+/i, ""), secret);
  if (!claims) return json(401, { error: "Missing or expired session" });

  let blast;
  try {
    blast = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const recipients = Array.isArray(blast?.recipients) ? blast.recipients : [];
  const text = String(blast?.text || "").trim();
  if (!text) return json(400, { error: "Missing message text" });
  if (!recipients.length) return json(400, { error: "No recipients" });
  if (!recipients.every((r) => /^\+1\d{10}$/.test(r.to || "")))
    return json(400, { error: "Recipients must be E.164 US numbers" });

  const apiKey = process.env.TELNYX_API_KEY;
  const from = process.env.TELNYX_FROM_NUMBER;
  if (!apiKey || !from)
    return json(501, {
      error: "Telnyx is not configured",
      hint: "Set TELNYX_API_KEY and TELNYX_FROM_NUMBER in the Netlify environment",
    });

  const results = await Promise.all(
    recipients.map(async (r) => {
      try {
        const res = await fetch(TELNYX_API, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            from,
            to: r.to,
            text,
            ...(process.env.TELNYX_MESSAGING_PROFILE_ID
              ? { messaging_profile_id: process.env.TELNYX_MESSAGING_PROFILE_ID }
              : {}),
          }),
        });
        const data = await res.json().catch(() => ({}));
        return res.ok
          ? { id: r.id, to: r.to, status: "sent", telnyxId: data?.data?.id ?? null }
          : { id: r.id, to: r.to, status: "failed", error: data?.errors?.[0]?.detail ?? `HTTP ${res.status}` };
      } catch (e) {
        return { id: r.id, to: r.to, status: "failed", error: String(e.message || e) };
      }
    })
  );

  return json(200, {
    id: blast.id,
    accountId: claims.accountId,
    sent: results.filter((r) => r.status === "sent").length,
    failed: results.filter((r) => r.status === "failed").length,
    recipients: results,
  });
};

export const config = { path: "/api/v1/blasts" };
