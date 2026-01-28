# Eau Claire Buddhist Sangha — Website Portal

A calm, "Zen"-inspired community portal for the Eau Claire Buddhist Sangha.

This repo contains a **high-fidelity React prototype** being migrated to a low-maintenance production stack: **Hugo + Decap CMS + Cloudflare Pages** with **self-hosted Isso comments**.

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
- **Isso** self-hosted comments on DigitalOcean droplet (Topics + Pages only)

---

## Technology stack

| Component | Technology |
|-----------|-----------|
| Static Site Generator | Hugo |
| CMS | Decap CMS (GitHub backend) |
| Hosting | Cloudflare Pages (free) |
| Auth | GitHub OAuth via Cloudflare Worker |
| Comments | Isso (self-hosted on DigitalOcean) |
| Calendar | Google Calendar embed |
| Styling | Tailwind CSS (compiled at build time) |

---

## Repository structure

```
/prototype/        # React/Vite app (UI reference)
/site/             # Hugo site (production)
/workers/          # Cloudflare Workers (OAuth proxy)
/infra/            # docker-compose for Isso
/docs/             # Architecture documentation
```

---

## Cost estimate

| Service | Tier | Monthly Cost |
|---------|------|--------------|
| Cloudflare Pages | Free | $0 |
| Cloudflare Worker | Free | $0 |
| Isso hosting | Basic Droplet | ~$4-6 |
| Domain | (if new) | ~$12/year |

**Total: ~$4-6/month**

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

### Phase 5: Isso comments
- Set up `/infra/isso/` with Docker config
- Deploy to DigitalOcean droplet
- Embed on Topics and Pages only

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

## Content collections

| Collection | Purpose |
|------------|---------|
| `events/` | Weekly sits, retreats, special events |
| `announcements/` | News, updates, library changes |
| `pages/` | Static content (About, Contact, etc.) |
| `topics/` | Forum discussion starters |

Comments via Isso are enabled on **Topics and Pages only**.

---

## AI assistant

The prototype includes a Gemini-based AI assistant. **In production:**
- Do not ship API keys to the browser
- If retained, implement via Cloudflare Worker with rate limiting
- This project currently prioritizes static content over AI features

---

## License

This repo is for the Eau Claire Buddhist Sangha.
