# sangha-worker

Single Cloudflare Worker for Eau Claire Buddhist Sangha: Google SSO, site JWT
issuance, Google Group role checks. Decap OAuth (Plan 02), calendar D1 API
(Plan 03), and comment proxy (Plan 04) are added to this same Worker.

## Endpoints (this plan)

| Method + Path        | Auth | Description                          |
|----------------------|------|--------------------------------------|
| `GET /api/health`    | None | Health check                         |
| `GET /auth/login`    | None | Start Google login (`?return_to=`)   |
| `GET /auth/callback` | None | Token exchange + group check + JWT   |

## Environment

Non-secret vars live in `wrangler.toml [vars]`. Secrets are set with:

```bash
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put GOOGLE_SERVICE_ACCOUNT_KEY   # paste the full service-account JSON
wrangler secret put JWT_SIGNING_SECRET           # openssl rand -base64 48
```

## Develop & test

```bash
npm install
npm test                 # vitest (all I/O mocked; no Google account needed)
cp .dev.vars.example .dev.vars   # fill in for live local runs
npm run dev              # wrangler dev
```

## Deploy

```bash
npm run deploy
```

After deploy, set the OAuth client's authorized redirect URI to the deployed
`/auth/callback` URL, and verify:

```bash
curl https://sangha-worker.<subdomain>.workers.dev/api/health   # {"status":"ok"}
```
