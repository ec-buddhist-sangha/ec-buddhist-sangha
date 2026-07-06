# Eau Claire Buddhist Sangha — Website Portal

A calm, "Zen"-inspired community portal for the Eau Claire Buddhist Sangha.

This repo contains a **high-fidelity React prototype** being migrated to a low-maintenance production stack: **Hugo + Decap CMS + Cloudflare Pages** with **native comments stored in Cloudflare D1**.

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
- **Hugo** for static site generation
- **Decap CMS** for Git-based editing of Markdown content at `/admin`
- **Cloudflare Pages** for build + deploy + CDN
- **GitHub** as the content/source of truth
- **Cloudflare Worker** (via Wrangler) for Decap↔GitHub OAuth proxy
- **Native comments** stored in Cloudflare D1 via the Worker, gated by member roles (Topics + Pages only)

---

## Technology stack

| Component | Technology |
|-----------|-----------|
| Static Site Generator | Hugo |
| CMS | Decap CMS (GitHub backend) |
| Hosting | Cloudflare Pages (free) |
| Auth | GitHub OAuth via Cloudflare Worker |
| Comments | Native (Cloudflare D1 via Worker) |
| Calendar | Google Calendar embed |
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
| Cloudflare Pages | Free | $0 |
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

### Phase 3: Decap CMS
- Configure `/static/admin/config.yml`
- Set up collections: events, announcements, pages, topics
- Configure GitHub backend with OAuth proxy URL

### Phase 4: OAuth proxy Worker
- Create `/workers/oauth-proxy/` with Wrangler
- Deploy to Cloudflare for Decap auth

### Phase 5: Native comments
- `comments` table in Cloudflare D1 with CRUD in the Worker
- Role-gated (members post; authors/admins edit/delete)
- Rendered on Topics and Pages only (no self-hosted server)

### Phase 6: Google Calendar
- Create calendar partial
- Embed on homepage and dedicated calendar page

### Phase 7: Cloudflare Pages deployment
- Connect GitHub repo
- Configure build: `hugo`, output: `public/`
- Set custom domain

### Phase 8: Content migration
- Convert prototype constants to Markdown
- Test Decap CMS workflow

### Phase 9: Switchover
- Update DNS to Cloudflare Pages
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

### OAuth proxy Worker
```bash
cd workers/oauth-proxy
npm install
npx wrangler deploy
```

### Worker (auth, calendar, comments)
```bash
cd workers/sangha-worker
npm install
npm test          # vitest suite
npx wrangler dev  # local worker
```

---

## Content collections

| Collection | Purpose |
|------------|---------|
| `events/` | Weekly sits, retreats, special events |
| `announcements/` | News, updates, library changes |
| `pages/` | Static content (About, Contact, etc.) |
| `topics/` | Forum discussion starters |

Native (Cloudflare D1) comments are enabled on **Topics and Pages only**.

---

## AI assistant

The prototype includes a Gemini-based AI assistant. **In production:**
- Do not ship API keys to the browser
- If retained, implement via Cloudflare Worker with rate limiting
- This project currently prioritizes static content over AI features

---

## License

This repo is for the Eau Claire Buddhist Sangha.
