# Agent Guidelines — Eau Claire Buddhist Sangha Portal

This file is the authoritative instructions for agentic coding in this repo.

The repo has two "modes":
1) **Prototype** (React/Vite) — current UI reference, located in `/prototype/`
2) **Production** (Hugo/Decap/Pages) — migration target, located in `/site/`

Agents should keep both working during transition, but prioritize decisions that reduce future migration effort.

---

## High-level rule: secrets never ship to the browser

- Do not embed API keys in client bundles.
- Any feature needing secrets must run server-side (Cloudflare Worker) or be replaced with embeds/static generation.

This affects:
- Google APIs requiring secrets
- Decap GitHub OAuth exchange (must be server-side)

---

## Repository structure

```
/prototype/        # React/Vite app (current UI reference)
/site/             # Hugo site (production)
/workers/          # Cloudflare Workers (OAuth proxy)
/infra/            # docker-compose, deployment notes (Isso)
/docs/             # architecture notes, content model docs
```

---

## Migration plan (in priority order)

1. **Phase 1:** Create project structure, move prototype to `/prototype/`
2. **Phase 2:** Hugo scaffold with Tailwind CSS compiled at build time, port Sangha design system
3. **Phase 3:** Decap CMS configuration with GitHub backend and collections (events, announcements, pages, topics)
4. **Phase 4:** OAuth proxy Worker with Wrangler CLI for Decap auth
5. **Phase 5:** Isso comments deployment, embed on Topics and Pages only
6. **Phase 6:** ~~Google Calendar embed on homepage~~ Replaced with Community Updates feed (events + announcements)
7. **Phase 7:** Cloudflare Pages deployment with Hugo build
8. **Phase 8:** Content migration from prototype to Markdown
9. **Phase 9:** DNS switchover and prototype decommission

---

## Technology decisions (finalized)

| Component | Technology | Notes |
|-----------|-----------|-------|
| Static Site Generator | Hugo | Build via Cloudflare Pages |
| CMS | Decap CMS | GitHub backend, admin at /admin |
| Auth | GitHub OAuth | Via Cloudflare Worker proxy (Wrangler) |
| Comments | Isso | Self-hosted on DigitalOcean, Topics + Pages only |
| Community Updates | Hugo-generated feed | Events + announcements on homepage, no external embeds |
| Hosting | Cloudflare Pages | Free tier, Hugo builds |
| Styling | Tailwind CSS | Compiled at build time |
| Comment moderation | Auto-publish | Can be changed later |

---

## Content model (Decap collections)

### Required collections

**events/** - Weekly sits, retreats, special events
```
title, date, end_date, location, body, tags
```

**announcements/** - News, updates, library changes
```
title, date, body, tags
```

**pages/** - Static content (singleton)
```
title, body (singleton: true, create: false)
```

**topics/** - Forum discussion starters
```
title, author, body, tags, reply_count, last_active
```

### Frontmatter conventions

All content uses minimal frontmatter:
- `title`, `date`, `summary`, `tags`, `draft`
- Events additionally: `start`, `end`, `location`, `signup_url`

---

## Environment variables

### Prototype (React + Vite)
Vite exposes only `VITE_*` prefixed vars. No secrets needed for prototype.

### Cloudflare Workers (production)
Store in Worker environment:
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `GITHUB_OAUTH_REDIRECT_URL`

### Isso
- No secrets for basic operation
- Admin/moderation config stays local

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

### OAuth proxy Worker
```bash
cd workers/oauth-proxy
npm install
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
1. All navigation links work (Home, About, Calendar, Forum, CMS)
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
- User-generated content (comments) handled by Isso - no direct HTML injection
- OAuth secrets stored in Cloudflare Worker environment only

---

## Cost summary

| Service | Tier | Monthly Cost |
|---------|------|--------------|
| Cloudflare Pages | Free | $0 |
| Cloudflare Worker | Free | $0 |
| Isso hosting | Basic Droplet | ~$4-6 |
| Domain | (if new) | ~$12/year |

**Total: ~$4-6/month** (or $0 if reusing existing server for Isso)

---

## Deliverables format

When making changes:
- Update implementation and docs when behavior changes
- Prefer small, reviewable commits aligned to the roadmap
- If new operational dependency, document under `/docs/` and link from README
