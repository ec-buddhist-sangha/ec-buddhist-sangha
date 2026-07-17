# Eau Claire Buddhist Sangha — Website Portal

A calm, "Zen"-inspired community portal for the Eau Claire Buddhist Sangha.

This repo contains a **high-fidelity React prototype** being migrated to a low-maintenance production stack: **Hugo on GitHub Pages** (built by GitHub Actions) with a **Cloudflare Worker + D1** serving auth, calendar, comments, and native content (community updates and forum topics are served by the Worker, not a Git-based CMS).

---

## Project goals

- Simple, welcoming, low-distraction experience
- Nonprofit-friendly operating cost (~$4-6/month)
- Easy content editing for non-technical volunteers
- Minimal operational overhead (static hosting + small self-hosted services)

---

## Design philosophy

- "Paper" background with "Sangha Navy" + "Sangha Gold" accents
- Typography: **Merriweather** (serif) + **Lato** (sans-serif)
- Subtle transitions, no flashy effects
- Tone: gentle, welcoming, wise

---

## Architecture

### Current (Prototype)
- **React + TypeScript + Vite** SPA prototype at root directory
- Will be moved to `/prototype/` during migration

### Target (Production)
- **Hugo** for static site generation (page shells + design system)
- **GitHub Pages** for hosting, built and deployed by a **GitHub Actions** workflow ([.github/workflows/hugo.yaml](.github/workflows/hugo.yaml)) on push to `main`
- **Cloudflare Worker** (via Wrangler) for member auth, shared calendar, comments, and native content
- **Native content** — community updates (announcements + events) and forum topics stored in Cloudflare D1, authored through the site (admins via an inline composer, members start topics), rendered client-side against `/api/posts` and `/api/topics`
- **Native comments** stored in Cloudflare D1 via the Worker, gated by member roles (Topics + Pages only)

---

## Technology stack

| Component | Technology |
|-----------|-----------|
| Static Site Generator | Hugo |
| Content (updates + topics) | Native (Cloudflare D1 via Worker) |
| Hosting | GitHub Pages (free), built via GitHub Actions |
| Member Auth | Google SSO via Cloudflare Worker |
| Comments | Native (Cloudflare D1 via Worker) |
| Calendar | Native Hugo UI + Cloudflare D1 |
| Styling | Tailwind CSS (compiled at build time) |

---

## Repository structure

```
/prototype/        # React/Vite app (UI reference)
/site/             # Hugo site (production)
/workers/          # Cloudflare Workers (auth, calendar, comments)
/docs/             # Architecture documentation
```

---

## Cost estimate

| Service | Tier | Monthly Cost |
|---------|------|--------------|
| GitHub Pages | Free | $0 |
| Cloudflare Worker | Free | $0 |
| Cloudflare D1 (comments + calendar) | Free tier | $0 |
| Domain | (if new) | ~$12/year |

**Total: $0/month** (native D1 comments replaced the self-hosted Isso droplet)

---

## Migration roadmap

### Phase 1: Project structure
- Create `/site/`, `/workers/`, `/docs/` directories
- Move prototype to `/prototype/`

### Phase 2: Hugo scaffold
- Set up Hugo with Tailwind CSS
- Port Sangha design system (colors, typography)
- Create base templates (header, footer, home)

### Phase 3: Native content (supersedes Decap CMS)
- `posts` (announcements + events) and `topics` (forum threads) tables in Cloudflare D1
- Worker CRUD at `/api/posts` and `/api/topics`, role-gated (admins author updates; members start topics; authors/admins edit/delete)
- Rendered client-side by `site/static/js/posts.js` and `topics.js`

### Phase 4: ~~OAuth proxy Worker~~ (removed)
- The Decap GitHub OAuth proxy is no longer needed — content authoring reuses the existing Google SSO + role system

### Phase 5: Native comments
- `comments` table in Cloudflare D1 with CRUD in the Worker
- Role-gated (members post; authors/admins edit/delete)
- Rendered on Topics and Pages only (no self-hosted server)

### Phase 6: Native calendar
- Shared D1 calendar with recurring meetings, volunteering, backups, and attendance
- Role-aware public/member/admin API projections

### Phase 7: GitHub Pages deployment
- GitHub Actions workflow builds Tailwind + Hugo and deploys to GitHub Pages on push to `main`
- Custom domain `eauclairesangha.org` (CNAME), HTTPS via GitHub Pages

### Phase 8: Content migration
- Seed existing Markdown into D1 (`migrations/0006_seed_content.sql`)
- Author new updates/topics through the site UI

### Phase 9: Switchover
- Point DNS / custom domain at GitHub Pages
- Decommission prototype

---

## Local development

### Prototype (current)
```bash
npm install
npm run dev
npm run build
npm run preview
```

### Hugo (after migration)
```bash
cd site
npm install  # if using Tailwind pipeline
hugo server -D  # development with drafts
hugo server -D --renderToMemory --disableFastRender --bind 0.0.0.0 --baseURL "http://192.168.0.101:1313/ec-buddhist-sangha/"  # LAN preview; replace IP if needed
hugo  # production build
```

### Worker (auth, calendar, comments, content)
```bash
cd workers/sangha-worker
npm install
npm test          # vitest suite
npx wrangler dev  # local worker
npx wrangler deploy
npx wrangler d1 migrations apply sangha-calendar --remote
```

---

## Content model

| Store | Purpose | Authoring |
|-------|---------|-----------|
| `posts` (D1) | Community updates: announcements + events | Admins, via the inline composer on `/updates/` |
| `topics` (D1) | Forum discussion threads | Members, via **New Topic** on `/topics/` |
| `pages/` (Hugo Markdown) | Static content (About, Donate, etc.) | Edited in the repo |

Native (Cloudflare D1) comments are enabled on **Topics and Pages only**. Post and topic bodies are stored as text and rendered as escaped plain text (no HTML is trusted).

---

## AI assistant

The prototype includes a Gemini-based AI assistant. **In production:**
- Do not ship API keys to the browser
- If retained, implement via Cloudflare Worker with rate limiting
- This project currently prioritizes static content over AI features

---

## License

This repo is for the Eau Claire Buddhist Sangha.
