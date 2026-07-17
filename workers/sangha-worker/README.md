# sangha-worker

Single Cloudflare Worker for Eau Claire Buddhist Sangha: Google SSO, live roles,
the shared D1 calendar, native comments, and native content (community updates
and forum topics).

## Calendar endpoints

| Method + Path | Auth | Description |
|---|---|---|
| `GET /api/calendar` | Public | Role-aware calendar projection |
| `PUT /api/calendar` | Admin | Optimistically locked full-store write |
| `POST /api/signups` | Member | Add or update the caller's signup |
| `DELETE /api/signups` | Member | Remove the caller's signup |
| `GET /api/signups` | Member | Read the caller's signup |

Calendar state is a versioned JSON document in D1. See
`../../docs/CALENDAR_SYSTEM.md` for its privacy, recurrence, and initialization
contract.

## Content endpoints

Replaces the former Decap CMS Markdown collections. Bodies are stored as text
and rendered as escaped plain text client-side (no HTML is trusted).

| Method + Path | Auth | Description |
|---|---|---|
| `GET /api/posts` | Public | Community feed (announcements + events); `?kind=` filters |
| `GET /api/posts/:slug` | Public | A single published post |
| `POST/PATCH/DELETE /api/posts` | Admin | Author/update/soft-delete updates |
| `GET /api/topics` | Public | Forum threads, newest activity first, with `reply_count` |
| `GET /api/topics/:slug` | Public | A single topic (omits `author_email`) |
| `POST /api/topics` | Member | Start a thread |
| `PATCH/DELETE /api/topics` | Member | Author or admin only |

A topic's discussion lives in the `comments` table under
`thread = 'topic:' || slug`; posting a comment there bumps the topic's
`last_active_at`.

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
npx wrangler login
npm run deploy
```

For first calendar initialization, deploy the Worker and matching site before
applying migration `0004_initialize_calendar.sql`. Confirm `calendar_state` is
empty, then run:

```bash
npx wrangler d1 execute sangha-db --remote --command "SELECT id, revision, updated_at FROM calendar_state"
npx wrangler d1 migrations apply sangha-db --remote
```

Stop without applying migrations if the query unexpectedly returns a calendar
row. Do not reset or delete the production database. Migration `0004` is
idempotent and seeds revision 1 only when the row is absent.

After deploy, set the OAuth client's authorized redirect URI to the deployed
`/auth/callback` URL, and verify:

```bash
curl https://sangha-worker.<subdomain>.workers.dev/api/health   # {"status":"ok"}
```
