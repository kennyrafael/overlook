# overlook-feedback

Cloudflare Worker behind the two feedback forms ("Would you pay?" and feature ideas) on
[overlook.agenthub.pt](https://overlook.agenthub.pt/#feedback) and in the app (Feedback dialog).

- `POST /feedback` with a JSON body; rules in [`packages/shared/src/feedback.ts`](../../packages/shared/src/feedback.ts).
- Rows go to the D1 database `overlook-feedback` (table `feedback`, created on first use).
- Stored: the answers, the source (`site` / `app`), the app version, the time, and the email only when
  the consent box was ticked. **Not stored:** IP address, user agent, cookies, anything about projects.
- Browsers may call it only from `https://overlook.agenthub.pt` (CORS, and other `Origin`s get 403). The
  app's local API server calls it without an `Origin`; the app's window never talks to it directly.
- Limits: 8 KB per request, 5 requests a minute per IP (Rate Limiting binding; the key is a hash of the
  IP and is not stored), 2,000 stored responses a day, a honeypot field for bots.

## One-time setup (Cloudflare dashboard)

1. **D1 → Create database** named `overlook-feedback` (or `npx wrangler d1 create overlook-feedback`).
   Put its id in `wrangler.jsonc` (`database_id`) and push.
2. **Workers & Pages → Create → Import a repository** → `kennyrafael/overlook`, project name
   `overlook-feedback`, root directory `workers/feedback`, deploy command `npx wrangler deploy`.
   Every push to `main` then redeploys it, like `overlook-downloads`.
3. Check: `curl -X POST https://overlook-feedback.kennyrafael-cg.workers.dev/feedback -H "Content-Type: application/json" -d "{\"kind\":\"idea\",\"text\":\"test\"}"`
   answers `{"ok":true}` (delete the test row afterwards, or leave it).

## Reading the responses

```bash
node workers/feedback/scripts/responses.mjs                  # summary + latest 20
node workers/feedback/scripts/responses.mjs --csv responses.csv
node workers/feedback/scripts/responses.mjs --pro-emails     # people to tell when Pro exists
node workers/feedback/scripts/responses.mjs --delete-email someone@example.com   # erasure request
```

Uses your own Wrangler login (`npx wrangler login`). Deletion requests arrive at contacto@agenthub.pt
(see [/privacy](https://overlook.agenthub.pt/privacy)).
