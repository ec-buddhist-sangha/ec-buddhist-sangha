# Migration Status Report

## Completed Phases

### Phase 1: Project Structure ✅
- Created `/site/` directory with Hugo scaffold
- Created `/workers/` directory for OAuth proxy
- Created `/docs/` directory
- Created `/infra/isso/` directory with Docker config
- Moved React prototype to `/prototype/`

### Phase 2: Hugo Scaffold & Styling ✅
- Initialized Hugo with YAML config
- Set up Tailwind CSS (compiled at build time)
- Created Sangha color palette (navy, gold, light, paper)
- Created base templates:
  - `baseof.html` - Main HTML shell with fonts
  - `header.html` - Responsive navigation
  - `footer.html` - Footer with location/links
  - `hero.html` - Homepage hero section
  - `calendar.html` - Calendar embed
  - `community-feed.html` - Content listing
  - `comments.html` - Isso comments embed

### Phase 3: Decap CMS Configuration ✅
- Created `/static/admin/config.yml` with collections:
  - `events/` - Weekly sits, retreats
  - `announcements/` - News, updates
  - `pages/` - Static content
  - `topics/` - Forum discussion starters
- Created `/static/admin/index.html`

### Phase 4: OAuth Proxy Worker (Ready) ✅
- Created `/workers/oauth-proxy/package.json`
- Created `/workers/oauth-proxy/index.js`
- Created `/workers/oauth-proxy/wrangler.toml`
- Ready for deployment with secrets

### Phase 5: Isso Comments (Ready) ✅
- Created `/infra/isso/docker-compose.yml`
- Created `/infra/isso/isso.conf`
- Created `comments.html` partial
- Comments enabled on Topics and Pages only

### Phase 6: Google Calendar ✅
- Created calendar partial with embed
- Added calendar preview to homepage
- Created dedicated calendar page

### Phase 7: Cloudflare Pages (Ready)
- Requires: Connect repo in Cloudflare dashboard
- Build command: `hugo`
- Output directory: `public`

### Phase 8: Content Migration ✅
- Sample content created:
  - 1 event (Weekly Sit)
  - 1 announcement (Library books)
  - 2 pages (About, Calendar)
  - 1 topic (Daily practice struggles)

### Phase 9: Switchover
- Pending DNS update

---

## File Structure Summary

```
/site/
  ├── content/
  │   ├── events/
  │   ├── announcements/
  │   ├── pages/
  │   └── topics/
  ├── layouts/
  │   ├── _default/
  │   │   ├── baseof.html
  │   │   ├── home.html
  │   │   ├── list.html
  │   │   ├── single.html
  │   │   └── calendar.html
  │   └── partials/
  │       ├── header.html
  │       ├── footer.html
  │       ├── hero.html
  │       ├── calendar.html
  │       ├── community-feed.html
  │       └── comments.html
  ├── static/
  │   ├── admin/
  │   │   ├── config.yml
  │   │   └── index.html
  │   ├── css/
  │   │   ├── main.css
  │   │   └── output.css
  │   └── images/
  │       └── logo.png
  ├── hugo.yaml
  ├── tailwind.config.js
  ├── postcss.config.js
  └── package.json

/workers/oauth-proxy/
  ├── index.js
  ├── package.json
  └── wrangler.toml

/infra/isso/
  ├── docker-compose.yml
  └── isso.conf

/prototype/
  └── [moved from root - React prototype]
```

---

## Next Steps for Deployment

### 1. Cloudflare Pages
1. Go to cloudflare.com/pages
2. Connect GitHub repo
3. Settings:
   - Build command: `hugo`
   - Build output: `public`
   - Root directory: `site`
4. Add custom domain

### 2. Deploy OAuth Proxy
```bash
cd workers/oauth-proxy
npm install
npx wrangler deploy
```
Secrets needed in Cloudflare:
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `DECAP_OAUTH_REDIRECT_URL`

### 3. Deploy Isso
1. Create DigitalOcean droplet ($4-6/mo)
2. Install Docker
3. Clone this repo
4. Run: `docker compose up -d`
5. Configure subdomain (comments.yoursite.com)

### 4. Configure Decap CMS
1. Register OAuth app in GitHub:
   - Homepage: https://yoursite.com
   - Callback: https://yoursite.com/callback
2. Update config.yml with production values

### 5. Test & Switchover
1. Test all pages
2. Test Decap CMS login
3. Test comment submission
4. Update DNS to Cloudflare Pages

---

## Commands Reference

### Hugo Development
```bash
cd site
npm run dev        # Start Hugo server with drafts
hugo               # Production build
npm run css:build  # Build CSS with watch
npm run css:prod   # Build minified CSS
```

### OAuth Proxy
```bash
cd workers/oauth-proxy
npm run dev        # Local dev
npm run deploy     # Deploy to Cloudflare
```

### Isso (local)
```bash
cd infra/isso
docker compose up -d
```

---

## Content Collections

| Collection | Purpose | Comments |
|------------|---------|----------|
| `events/` | Weekly sits, retreats | No comments |
| `announcements/` | News, updates | No comments |
| `pages/` | Static pages | Comments enabled |
| `topics/` | Forum discussions | Comments enabled |

---

## Cost Summary

| Service | Tier | Monthly Cost |
|---------|------|--------------|
| Cloudflare Pages | Free | $0 |
| Cloudflare Worker | Free | $0 |
| Isso hosting | Basic Droplet | ~$4-6 |
| Domain | (if new) | ~$12/year |

**Total: ~$4-6/month**
