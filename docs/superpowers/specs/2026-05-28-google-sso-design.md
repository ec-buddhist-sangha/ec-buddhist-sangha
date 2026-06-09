# Google SSO & Group-Based Access — Design Spec

**Date:** 2026-05-28  
**Status:** Approved — implementation plans written 2026-06-09 (see Planning Addendum)

## Overview

Replace GitHub OAuth with Google SSO for the Eau Claire Buddhist Sangha website. Site access is gated by an existing Google Group: Group admins (OWNER/MANAGER) become site admins with Decap CMS + calendar admin access, Group members become site members with calendar RSVP + comment privileges. Anonymous visitors can browse only.

All secrets remain server-side in a single Cloudflare Worker. No new paid infrastructure.

## Google Infrastructure

- **Google for Nonprofits** — free Google Workspace for `eauclairesangha.org`
- **Google Group:** `sangha@eauclairesangha.org`
- **Service account** with domain-wide delegation, scoped to `admin.directory.group.member.readonly` and `admin.directory.group.readonly`
- **OAuth consent screen:** Internal-only (no Google verification required)

## Auth Flow

Two paths through the Worker:

### 1. Member Login (calendar RSVP, comments)

```
User clicks "Sign in with Google"
  → Redirect to GET /auth/login
    → Worker redirects to Google OAuth consent screen
    → Google returns code to GET /auth/callback
      → Worker exchanges code for Google ID token + access token
      → Worker calls Admin SDK Groups API to verify membership
      → Worker checks role field (OWNER/MANAGER = admin, MEMBER = member)
      → Worker signs JWT: { sub: email, name, role: "admin"|"member", exp }
      → Redirect back to site with JWT as fragment parameter
        → auth.js stores JWT in sessionStorage
        → All subsequent API calls include Authorization: Bearer <jwt>
```

### 2. Admin Login (Decap CMS)

Same as above but:
- Route is `GET /auth/admin` (distinct redirect so Decap gets the postMessage flow)
- On callback, checks admin role before proceeding
- Worker returns the HTML page with `window.opener.postMessage('authorization:google:success:...')` — same pattern as the current GitHub OAuth proxy
- Decap CMS receives the token and uses it for Git operations

## JWT Design

```
{
  "sub": "user@eauclairesangha.org",
  "name": "Chris Cortner",
  "role": "admin" | "member",
  "iat": 1748460000,
  "exp": 1748488800  // 8 hours
}
```

- Signed with HMAC-SHA256 using `JWT_SIGNING_SECRET` (Worker env var)
- Stateless — any Worker endpoint verifies with the same secret
- No session store, no database
- JWT stored in `sessionStorage` (cleared on tab close)
- No refresh tokens — user re-authenticates with Google when JWT expires

## Access Matrix

| Action | Anonymous | Member | Admin |
|--------|-----------|--------|-------|
| Browse site | ✓ | ✓ | ✓ |
| View calendar | ✓ | ✓ | ✓ |
| View forum topics | ✓ | ✓ | ✓ |
| RSVP to events | | ✓ | ✓ |
| Volunteer for talk | | ✓ | ✓ |
| Backup volunteer | | ✓ | ✓ |
| Attend meeting | | ✓ | ✓ |
| Post comments | | ✓ | ✓ |
| Decap CMS (content editing) | | | ✓ |
| Calendar admin (manage slots, assign speakers) | | | ✓ |

Admin role is determined by Google Group role on each login. Role changes take effect at next sign-in. No custom admin management UI needed — add/remove admins via the Google Groups web UI.

## Worker Architecture

New Worker at `workers/sangha-worker/` (replaces `workers/oauth-proxy/`):

```
workers/sangha-worker/
├── index.js          # Router entry point (itty-router)
├── auth.js           # OAuth handlers + JWT sign/verify
├── groups.js         # Admin SDK Groups API client
├── calendar.js       # Calendar API handlers
├── comments.js       # Comment posting proxy (Remark42)
├── decap.js          # Decap CMS OAuth (ported from current proxy)
├── middleware.js      # requireAuth, requireRole, errorHandler
└── wrangler.toml
```

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `GOOGLE_CLIENT_ID` | OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret |
| `GOOGLE_REDIRECT_URI` | OAuth callback URL |
| `GOOGLE_GROUP_EMAIL` | `sangha@eauclairesangha.org` |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | JSON key for service account |
| `GOOGLE_ADMIN_EMAIL` | Admin user for domain-wide delegation |
| `JWT_SIGNING_SECRET` | HMAC secret for JWT |
| `GITHUB_CLIENT_ID` | GitHub OAuth app (Decap CMS Git backend) |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth app secret |
| `REMARK42_API_SECRET` | Remark42 server API secret (for comment posting) |
| `REMARK42_JWT_SECRET` | Signing key for Remark42 JWT tokens |
| `REMARK42_URL` | `https://comments.eauclairesangha.org` |
| `CORS_ORIGIN` | `https://eauclairesangha.org` |

### Route Table

| Method + Path | Auth Required | Description |
|---------------|--------------|-------------|
| `GET /auth/login` | None | Start member login (Google OAuth redirect) |
| `GET /auth/admin` | None | Start admin login (Google OAuth for Decap) |
| `GET /auth/callback` | None | Token exchange + Group check + credential issue |
| `GET /api/health` | None | Health check |
| `GET /api/calendar` | None | Public calendar data |
| `POST /api/signups` | JWT (member+) | RSVP/volunteer/backup for a calendar item |
| `DELETE /api/signups` | JWT (member+) | Cancel own signup |
| `GET /api/signups/:id` | JWT (member+) | Get own signup for an item |
| `POST /api/comments` | JWT (member+) | Proxy comment to Remark42 with JWT auth |
| `POST /api/calendar/items` | JWT (admin) | Create calendar item |
| `PATCH /api/calendar/items/:id` | JWT (admin) | Update calendar item |
| `DELETE /api/calendar/items/:id` | JWT (admin) | Delete calendar item |
| `GET /api/calendar/settings` | JWT (admin) | Get calendar settings |
| `PATCH /api/calendar/settings` | JWT (admin) | Update calendar settings |
| `GET /api/calendar/recurrences` | JWT (admin) | List recurring meeting rules |
| `POST /api/calendar/recurrences` | JWT (admin) | Create recurring rule |
| `PATCH /api/calendar/recurrences/:id` | JWT (admin) | Update recurring rule |
| `DELETE /api/calendar/recurrences/:id` | JWT (admin) | Remove recurring rule |

### Admin SDK Credentials

Uses a Google service account with domain-wide delegation for Admin SDK access. The service account key is stored in `GOOGLE_SERVICE_ACCOUNT_KEY` (JSON). No user impersonation — the service account reads group membership directly using the delegated admin user.

## Calendar Backend

The current `calendar.js` stores everything in `localStorage` under `ecbs-calendar-v1`. The Worker replaces this with D1-backed API calls.

### D1 Tables (from existing CALENDAR_SYSTEM.md spec)

- `calendar_settings`
- `calendar_items` (includes `revision` for optimistic locking)
- `calendar_recurrences`
- `calendar_recurrence_exceptions`
- `calendar_signups`
- `calendar_notifications`
- `calendar_reminders`
- `calendar_history`

### Hybrid Client/Server

During migration, `calendar.js` continues to work with localStorage and adds API calls alongside. The client:

1. Reads from both localStorage (fast, for rendering) and API (source of truth)
2. Writes go to API first → on success, updates localStorage cache
3. If API is unreachable, falls back to localStorage writes (existing behavior)

After Worker is deployed and stable, localStorage becomes a cache-only layer.

## Remark42 Comments Integration

The Worker proxies comment actions so users only sign in once (not separately for Remark42).

**Flow:**
1. User signs in via Google (gets site JWT)
2. Comment form sends `POST /api/comments` to the Worker with `Authorization: Bearer <jwt>`
3. Worker validates the site JWT, extracts user info, and generates a Remark42-compatible JWT (signed with `REMARK42_JWT_SECRET`)
4. Worker forwards the comment to Remark42's API with the Remark42 JWT
5. Remark42 creates the comment attributed to the Google user

**Remark42 config changes:**
- Enable `AUTH_JWT=true` in Remark42 config
- Set `JWT_SECRET` to a value matching the Worker's `REMARK42_JWT_SECRET` env var
- This key is separate from `JWT_SIGNING_SECRET` — the site JWT and Remark42 JWT use different signing keys for isolation

## Hugo Site Changes

### New Files

- `site/static/js/auth.js` — `ECBS.Auth` module
  - `init()` — parses JWT from URL hash fragment (after OAuth redirect), clears it from address bar, stores in sessionStorage. Then renders sign-in button state.
  - `login()` / `logout()` — redirects to Worker or clears JWT
  - `getUser()` — parses stored JWT, returns `{ name, email, role }` or `null`. Returns `null` if JWT expired, clearing it automatically.
  - `isAdmin()` — shortcut for `getUser()?.role === 'admin'`
  - `isSignedIn()` — shortcut for `getUser() !== null`
  - `fetch(url, options)` — wraps native fetch, attaches Bearer token automatically. On 401 response, clears JWT.

- `site/layouts/partials/auth-button.html` — Sign-in button partial
  - Renders "Sign in with Google" button when anonymous
  - Renders user name with dropdown (My RSVPs, Sign Out) when signed in
  - Renders "Admin" link to `/admin/` for admin users

### Modified Files

- `site/layouts/partials/header.html` — Include `{{ partial "auth-button.html" . }}` in nav
- `site/static/js/calendar.js` — Replace `localStorage.getItem("ecbs-calendar-current-user-name")` checks with `ECBS.Auth.getUser()`. Add parallel API calls to Worker alongside localStorage writes.
- `site/layouts/partials/comments.html` — Pass authenticated user info from `auth.js` to Remark42 embed config
- `site/static/admin/config.yml` — Update `base_url` to new Worker URL
- `site/static/admin/index.html` — Remove Calendar Admin link injection (auth.js handles routing natively)
- `site/layouts/_default/calendar.html` — Remove `data-calendar-local-dev` attribute in production (local dev flag stays)
- `site/layouts/_default/calendar-admin.html` — Gate admin access with Worker JWT, remove localStorage-based admin access key

## Error Handling

| Scenario | User Sees |
|----------|-----------|
| Google API rate limited | "Please try again in a moment" — Worker retries once |
| Group check fails (network error) | "Unable to verify membership, please try again" |
| User not in Group | "Your account is not a member of the Sangha group" |
| JWT expired | Site clears JWT, shows sign-in button — transparent to user |
| JWT tampered | HTTP 401 — site clears JWT |
| User removed from Group | JWT expires naturally (8h max). Next login fails membership check |
| User role changed in Group | Takes effect at next sign-in |
| Worker cold start | ~500ms first request, negligible after |
| Admin API call without admin JWT | HTTP 403 — "Admin access required" |
| Calendar API conflict (revision mismatch) | HTTP 409 — "This item was updated by someone else. Refreshed." |
| Worker unreachable | Calendar falls back to localStorage (existing behavior) |

## Security

- No secrets in client code
- JWT signing secret never leaves the Worker
- Google service account key stored as Worker env var only
- JWT stored in `sessionStorage` (cleared on tab close, no cross-tab persistence)
- Admin JWT and member JWT use same format — only the `role` claim differs
- No refresh tokens — inherently short-lived tokens via Google re-auth
- All Worker API calls over HTTPS
- CORS restricted to `eauclairesangha.org`

## Migration Path

### Phase 1 (Manual): Google Setup
1. Enroll `eauclairesangha.org` in Google for Nonprofits
2. Create Google Workspace and the `sangha@eauclairesangha.org` Group
3. Add all members and assign admin roles
4. Create service account, enable Admin SDK API
5. Configure OAuth consent screen (internal-only)
6. Create OAuth client ID

### Phase 2: Deploy Worker
1. Create D1 database in Cloudflare dashboard
2. Deploy `sangha-worker` with all env vars
3. Keep old `oauth-proxy` Worker running
4. Test auth flow end-to-end

### Phase 3: Switch Decap CMS
1. Update `config.yml` to point at new Worker
2. Verify Decap CMS login works with Google
3. Archive old `workers/oauth-proxy/`

### Phase 4: Wire Calendar & Comments
1. Add `auth.js` to Hugo site
2. Update `calendar.js` for API calls
3. Configure Remark42 for JWT auth
4. Test member + admin flows

### Rollback
- Switch Decap `config.yml` back to GitHub Worker if needed
- Calendar stays functional with localStorage fallback
- Comments fall back to Remark42's native auth if Worker proxy fails

## Cost

| Component | Monthly Cost |
|-----------|-------------|
| Google Workspace for Nonprofits | $0 |
| Cloudflare Worker | $0 (free tier: 100k req/day) |
| Cloudflare D1 | $0 (free tier: 5GB storage, 5M reads/day) |
| Cloudflare Pages | $0 |
| Remark42 hosting (existing) | ~$4-6 |

**Total: $4-6/month** (unchanged from current cost)

## Out of Scope

- Google Calendar embed (replaced by Hugo Community Updates feed per migration plan)
- Custom admin role management UI (handled via Google Groups web UI)
- Email notifications for calendar (future D1 + Worker enhancement, reference templates already in CALENDAR_SYSTEM.md)
- Zoom Server-to-Server OAuth (future Worker enhancement, secrets already listed in CALENDAR_SYSTEM.md)
- Gemini AI assistant for production (needs separate Worker proxy per AGENTS.md security rules)

## Planning Addendum (2026-06-09)

This spec was decomposed into four dependency-ordered implementation plans under `docs/superpowers/plans/`:

1. `2026-06-09-google-sso-01-worker-auth-foundation.md` — `sangha-worker` scaffold, Google OAuth, JWT, group-role check, middleware. **Everything depends on this.**
2. `2026-06-09-google-sso-02-decap-cms-migration.md` — re-home Decap OAuth into the worker, repoint `config.yml`, archive old proxy.
3. `2026-06-09-google-sso-03-calendar-d1-backend.md` — D1-backed calendar store, signup API, client hydration + write-through.
4. `2026-06-09-google-sso-04-site-auth-and-comments.md` — `ECBS.Auth` frontend, sign-in UI, calendar identity wiring, Remark42 comment proxy.

Two reconciliations were made during planning where the spec was internally inconsistent or not implementable as written:

- **Decap stays on GitHub OAuth, not Google.** The spec's §"Admin Login (Decap CMS)" routes Decap auth through Google (`/auth/admin`). That cannot work: Decap's `backend: github` requires a *GitHub* token to commit; a Google token can't authorize git operations. (The spec's own env-var table keeps `GITHUB_CLIENT_ID`/`SECRET` "for the Decap CMS Git backend," which only makes sense with GitHub auth.) Plan 02 keeps GitHub OAuth, re-homed into `sangha-worker` under `/decap/*`. Google SSO gates the *site* and the visibility of the Admin affordance. True Google-gated CMS auth would require a Git Gateway-style proxy — out of scope.
- **Calendar D1 = one JSON-document table + signup API, not eight normalized tables.** The existing 4150-line client engine round-trips a single normalized store object. Plan 03 persists that document in `calendar_state` with optimistic locking and adds server-authoritative `/api/signups` endpoints, instead of the eight-table normalization in §"D1 Tables." The document still contains all the spec's data (slots, recurrences, settings, history, notifications, reminders); full normalization remains a future option. Granular admin item/settings/recurrence routes collapse into one optimistic `PUT /api/calendar`.

One item needs verification before it can ship: the **Remark42 comment proxy** (Plan 04 Tasks 6–7) assumes Remark42 accepts a Worker-minted `X-JWT`. Plan 04 Task 5 is a spike to confirm this against the live server; if it fails, Remark42's existing GitHub OAuth login remains the working fallback.
