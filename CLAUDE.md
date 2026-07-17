# Agent Guidelines — Eau Claire Buddhist Sangha Portal

This file is the authoritative instructions for agentic coding in this repo.

The repo has two "modes":
1) **Prototype** (React/Vite) — current UI reference, located in `/prototype/`
2) **Production** (Hugo + Cloudflare Pages/Worker/D1) — migration target, located in `/site/`

Agents should keep both working during transition, but prioritize decisions that reduce future migration effort.

---

## High-level rule: secrets never ship to the browser

- Do not embed API keys in client bundles.
- Any feature needing secrets must run server-side (Cloudflare Worker) or be replaced with embeds/static generation.

This affects:
- Google APIs requiring secrets
- OAuth token exchange and JWT signing (must be server-side, in the Worker)

---

## Repository structure

```
/prototype/        # React/Vite app (current UI reference)
/site/             # Hugo site (production)
/workers/          # Cloudflare Worker (auth, calendar, comments, content)
/infra/            # docker-compose, deployment notes (Isso)
/docs/             # architecture notes, content model docs
```

---

## Migration plan (in priority order)

1. **Phase 1:** Create project structure, move prototype to `/prototype/`
2. **Phase 2:** Hugo scaffold with Tailwind CSS compiled at build time, port Sangha design system
3. **Phase 3:** ~~Decap CMS configuration~~ Replaced with native D1 content — `posts` (announcements + events) and `topics` (forum threads) via Worker CRUD, role-gated, rendered client-side
4. **Phase 4:** ~~OAuth proxy Worker for Decap auth~~ Removed — content authoring reuses the existing Google SSO + role system
5. **Phase 5:** ~~Isso comments deployment~~ Replaced with native comments in Cloudflare D1 (Worker CRUD, role-gated), rendered on Topics and Pages only
6. **Phase 6:** ~~Google Calendar embed on homepage~~ Replaced with Community Updates feed (events + announcements)
7. **Phase 7:** Cloudflare Pages deployment with Hugo build
8. **Phase 8:** Content migration from prototype to Markdown
9. **Phase 9:** DNS switchover and prototype decommission

---

## Technology decisions (finalized)

| Component | Technology | Notes |
|-----------|-----------|-------|
| Static Site Generator | Hugo | Build via Cloudflare Pages; renders page shells only |
| Content (updates + topics) | Native (Cloudflare D1) | Worker CRUD at `/api/posts` + `/api/topics`; admins author updates, members start topics; authors/admins edit/delete |
| Auth | Google SSO | Via Cloudflare Worker (Wrangler); identity-only JWT, roles from `/api/me` |
| Comments | Native (Cloudflare D1) | Worker CRUD, role-gated (members post; authors/admins edit/delete), Topics + Pages only |
| Community Updates | Client-rendered feed | Events + announcements from `/api/posts`, no external embeds |
| Hosting | Cloudflare Pages | Free tier, Hugo builds |
| Styling | Tailwind CSS | Compiled at build time |
| Comment moderation | Auto-publish | Can be changed later |

---

## Content model (native D1)

Content lives in D1 tables (migration `0005_init_content.sql`), served by the
Worker and rendered client-side. Bodies are stored as text and rendered as
escaped plain text (no HTML is trusted). Static informational pages (About,
Donate, etc.) remain Hugo Markdown in `site/content/`.

**`posts`** — admin-authored community feed (`kind` = `announcement` | `event`)
```
kind, slug, title, summary, body, tags, location, start_at, end_at,
published_at, status, created_at, updated_at
```

**`topics`** — member-authored forum threads
```
slug, title, body, tags, author_email, author_name, status,
created_at, updated_at, last_active_at
```
`reply_count` is computed from the `comments` table (thread = `topic:<slug>`);
`author_email` is never returned by the public API (no PII leak).

### Authoring UI
- Updates: admins use the inline composer on `/updates/` (`site/static/js/posts.js`)
- Topics: members use **New Topic** on `/topics/` (`site/static/js/topics.js`)
- Detail views are client-rendered at `/updates/view/?slug=` and `/topics/view/?slug=`

---

## Environment variables

### Prototype (React + Vite)
Vite exposes only `VITE_*` prefixed vars. No secrets needed for prototype.

### Cloudflare Worker (production)
Secrets (set via `wrangler secret put`, never committed):
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `JWT_SIGNING_SECRET`

### Content + comments (native, Cloudflare D1)
- No separate service or secrets — `posts`, `topics`, and `comments` live in D1 via the Worker
- Moderation (hide/delete) is an admin action through the same role system

---

## Commands

### Prototype
```bash
cd prototype
npm install
npm run dev
npm run build
```

### Hugo site
```bash
cd site
npm install  # if using Tailwind pipeline
hugo server -D  # development with drafts
hugo  # production build
```

### Worker (auth, calendar, comments, content)
```bash
cd workers/sangha-worker
npm install
npm test          # vitest suite
npx wrangler dev  # local worker
npx wrangler deploy
```

### Isso (local dev)
```bash
cd infra/isso
docker compose up -d
```

---

## Testing with Playwright

**Always test navigation and page rendering before pushing changes to Hugo site.**

### Quick test workflow
```bash
# Start Hugo server with correct baseURL for subdirectory
cd site
hugo server -D --baseURL "http://127.0.0.1:1313/ec-buddhist-sangha/"

# In another terminal, use Playwright to test
# Navigate to pages, click through navigation links, check for 404s
```

### What to verify
1. All navigation links work (Home, About, Updates, Forum, Calendar)
2. Page URLs are correct (no path duplication)
3. Assets (CSS, images) load correctly
4. Console has no errors

### Common issues to catch
- Path duplication with subdirectory deployments
- Hardcoded absolute paths instead of using `absURL`
- Menu URLs missing baseURL prefix
- Assets using relative paths instead of `absURL`

---

## Styling guidance

- Maintain "Sangha" palette: sangha-navy (#1B3B5A), sangha-gold (#C59D45), sangha-light (#F5F5F0), sangha-paper (#FAFAF8)
- Typography: Merriweather (serif) for headings, Lato/sans-serif for body
- Tailwind CSS compiled during Cloudflare Pages build
- Quiet UI: subtle transitions, no aggressive animations

---

## TypeScript/React guidelines (prototype only)

- Functional components with strict typing
- No implicit `any` types
- Keep components focused, extract logic to utilities

---

## Security / privacy

- Never commit secrets
- User-generated content (comments) stored in D1 and rendered as escaped plain text - no direct HTML injection
- OAuth secrets stored in Cloudflare Worker environment only

---

## Cost summary

| Service | Tier | Monthly Cost |
|---------|------|--------------|
| Cloudflare Pages | Free | $0 |
| Cloudflare Worker | Free | $0 |
| Cloudflare D1 (comments + calendar) | Free tier | $0 |
| Domain | (if new) | ~$12/year |

**Total: $0/month** (native D1 comments replaced the self-hosted Isso droplet)

---

## Deliverables format

When making changes:
- Update implementation and docs when behavior changes
- Prefer small, reviewable commits aligned to the roadmap
- If new operational dependency, document under `/docs/` and link from README
