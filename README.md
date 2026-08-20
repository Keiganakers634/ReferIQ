# ReferIQ

Agent-to-agent referral blasts, embedded inside Follow Up Boss.

## Layout

```
public/                      ← Netlify publish directory (static)
  index.html                 ← marketing / coming-soon page   → /
  fub/index.html             ← FUB embedded app (single file) → /fub/
netlify/
  functions/
    fub-verify.mjs           ← POST /api/fub/verify  — verifies FUB's signed context,
                               returns trusted context + session token
    blasts.mjs               ← POST /api/v1/blasts   — sends the SMS blast via Telnyx
  lib/session.mjs            ← shared HMAC/session helpers
netlify.toml                 ← publish dir + security headers
```

No build step — Netlify serves `public/` as-is and bundles the functions
automatically.

## How the FUB app runs

- **Demo mode** — open `/fub/` directly. No FUB context in the URL means
  everything (agent pool, delivery, replies) is simulated locally. Safe to
  share as a preview.
- **Live mode** — Follow Up Boss frames `/fub/` with
  `?context=<base64 JSON>&signature=<hmac>` and the page loads FUB's
  embedded-app bridge script. The app posts both params to
  `/api/fub/verify`, which recomputes the HMAC-SHA256 with
  `FUB_APP_SECRET`; once it checks out the header flips from
  "Unverified context" to "Connected" and blasts go through
  `/api/v1/blasts`.

The iframe headers in `netlify.toml` allow framing only from
`*.followupboss.com` (and block framing of the marketing page entirely).

## Deploy

1. Connect this repo to a Netlify site (build command: none,
   publish directory: `public` — already set in `netlify.toml`).
2. Set environment variables (Site settings → Environment variables):

   | Variable | Purpose |
   |---|---|
   | `FUB_APP_SECRET` | Embedded-app secret from Follow Up Boss. Required for live mode. |
   | `TELNYX_API_KEY` | Telnyx API key. Required to send real SMS. |
   | `TELNYX_FROM_NUMBER` | ReferIQ's sending number, E.164 (`+1…`). |
   | `TELNYX_MESSAGING_PROFILE_ID` | Optional Telnyx messaging profile. |
   | `SESSION_SECRET` | Optional separate key for session tokens (defaults to `FUB_APP_SECRET`). |
   | `SESSION_TTL_SEC` | Optional session lifetime, default 3600. |

3. Register the embedded app with Follow Up Boss, pointing the iframe URL
   at `https://<your-site>/fub/`.

## Still to build (server side)

- Persistence for blasts (Netlify Blobs or a DB) — the client currently
  holds blast state in memory only.
- A Telnyx webhook function for delivery receipts and inbound "Y" replies,
  which is what flips a blast from *open* to *claimed* in production
  (the demo simulates this).
- Server-side agent-pool resolution: `blasts.mjs` currently texts the
  recipients the client sends; production should resolve the pool from a
  real agent directory instead.
