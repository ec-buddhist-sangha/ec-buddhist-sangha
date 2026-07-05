# Membership, Roles & Native Comments on Cloudflare — Design Spec

**Date:** 2026-07-05
**Status:** Approved (pending written-spec review) — supersedes parts of `2026-05-28-google-sso-design.md`
**Branch:** `feat/google-sso`

## Overview

Two coupled changes that remove all Google Workspace and self-hosted-server dependencies from the site, consolidating everything onto Cloudflare's free tier:

1. **Membership & roles** — Keep Google OAuth *sign-in* (free, no Workspace), but replace the Google Group / Admin SDK role lookup with a **D1-backed membership store**. Anyone who signs in is auto-granted a read-only **reader** role; they can request **member** (read/write) access, which an admin approves. Admins are established via a config allowlist and can assign roles from an in-site panel.

2. **Native comments** — Replace the self-hosted comment server (originally Isso, then Remark42) with a **D1-backed comments table** gated by the same roles. This eliminates the DigitalOcean droplet entirely.

### Why

- The site's nonprofit status is uncertain and it is primarily a religious-instruction organization, so it likely does **not** qualify for free Google Workspace, and paying (~$84–250/yr) for it is undesirable. Workspace was only needed for the Group-membership role lookup — nothing else.
- The DigitalOcean droplet (for Isso/Remark42) is a card-dependent, always-on paid service. The organization had that account suspended during a routine treasurer/officer transition. Reducing card-dependent recurring services is a real operational goal.
- Cloudflare Pages + Workers + D1 (already in use for the calendar) cover the site, the API, **and** comments on the free tier with no separate server and no separate bill.

### What this supersedes

- **`google-sso` Plan 01** — the Google Workspace / Group / service-account setup. Google OAuth sign-in stays; the Workspace/Group/Admin-SDK role machinery is removed.
- **`google-sso` Plan 04** — the Remark42 comment proxy. Comments become native D1.
- The **Isso deployment** (`infra/isso/`) and the DigitalOcean droplet — dropped.
- Google-SSO spec §"Access Matrix" (role determined by Group role) and §"Remark42 Comments Integration" are replaced by this document.

## Role Model

| Role | How granted | Capabilities |
|------|-------------|--------------|
| **reader** | Automatically, on first Google sign-in | Read all public content; request Member access |
| **member** | Admin approval of a request | Reader + comment, reply in discussions, RSVP/sign up for events |
| **admin** | Config allowlist, or promotion by another admin | Member + approve/deny requests, assign roles, edit calendar, moderate comments |

Reads on the site are already fully public, so `reader` primarily adds a verified identity and the ability to request an upgrade. There is no "browse-only anonymous vs. reader" access difference for reading; the distinction is identity + upgrade path.

## Role Resolution

Resolved **live on the server for every gated request** — the sign-in JWT carries identity only (`sub`, `name`), never the role. This makes an approval or role change take effect on the user's very next action, with no re-login.

```
resolveRole(env, email):
  1. email in BOOTSTRAP_ADMINS (config)  → "admin"    // lockout safety net; no DB row needed
  2. else row in `members` table          → row.role   // reader | member | admin
  3. else (signed in, no row yet)          → "reader"   // row is auto-created at sign-in
```

Cost: one indexed D1 read per gated request. Negligible at this scale; public reads are unaffected.

## Data Model

Both tables live in the existing `sangha-calendar` D1 database (new migration files under `workers/sangha-worker/migrations/`).

### `members`

```sql
CREATE TABLE members (
  email          TEXT PRIMARY KEY,               -- lowercased Google email (identity from OAuth)
  name           TEXT,                            -- display name from Google profile
  role           TEXT NOT NULL DEFAULT 'reader',  -- reader | member | admin
  request_status TEXT NOT NULL DEFAULT 'none',    -- none | pending | denied
  created_at     TEXT,
  updated_at     TEXT
);
```

- **Current access** = `role`. **Upgrade request** = `request_status`, kept separate so a reader can have a pending ask without changing their access.
- Pending queue = `SELECT ... WHERE request_status = 'pending'`.
- Approve → `role='member', request_status='none'`. Deny → `request_status='denied'` (role stays `reader`; re-request allowed). Promote/demote → set `role`.
- A `BOOTSTRAP_ADMINS` admin needs no row and, if a row exists, it is ignored for the admin decision — so the config list always wins and prevents lockout.

### `comments`

```sql
CREATE TABLE comments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  thread       TEXT NOT NULL,                     -- page path the comment belongs to, e.g. '/topics/mindfulness/'
  parent_id    INTEGER REFERENCES comments(id),   -- NULL = top-level; set = a reply (single-level threading)
  author_email TEXT NOT NULL,                     -- from the verified JWT
  author_name  TEXT NOT NULL,                     -- display name (denormalized for rendering)
  body         TEXT NOT NULL,                     -- plain text; see Sanitization
  status       TEXT NOT NULL DEFAULT 'published', -- published | hidden | deleted
  created_at   TEXT NOT NULL,
  updated_at   TEXT
);
CREATE INDEX idx_comments_thread ON comments(thread, created_at);
CREATE INDEX idx_comments_parent ON comments(parent_id);
```

One table serves both page comments and forum replies: forum "topics" remain Decap markdown; their replies are comments whose `thread` is the topic's URL (same "locator" concept Isso/Remark42 used).

## Auth Flow Changes

Modify `src/auth.js` `handleCallback`:

- After verifying the Google identity, **upsert a reader row** (`INSERT ... ON CONFLICT(email) DO UPDATE SET name=…, updated_at=…`).
- **Remove the `not_a_member` dead-end.** Everyone who signs in with Google is at least a reader.
- Issue an **identity-only JWT** `{ sub: email, name }` (drop the `role` claim). 8-hour TTL and `sessionStorage` storage unchanged.

`src/middleware.js` `requireRole`:

- Still verifies the JWT for identity.
- Replaces the trusted `user.role` claim with a live `resolveRole(env, email)` call (config → D1 → reader), attaching the resolved role to `request.user.role`.

## API Surface

Roles/access:

| Method + Path | Gate | Description |
|---------------|------|-------------|
| `GET /auth/login`, `GET /auth/callback` | none | Google sign-in (callback modified: upsert reader, identity-only JWT) |
| `GET /api/me` | authenticated | Caller's identity + **live** role + request_status (client renders UI from this) |
| `POST /api/access-request` | authenticated | Reader requests Member; sets `pending`, emails admins. Idempotent |
| `GET /api/members` | admin | List members + pending queue |
| `POST /api/members/approve` | admin | `{email}` → member, request cleared |
| `POST /api/members/deny` | admin | `{email}` → denied (stays reader) |
| `POST /api/members/role` | admin | `{email, role}` → set reader/member/admin |

Comments:

| Method + Path | Gate | Description |
|---------------|------|-------------|
| `GET /api/comments?thread=<path>` | public | Published comments for a thread, nested by `parent_id` |
| `POST /api/comments` | member / admin | `{thread, parent_id?, body}`; author from JWT |
| `PATCH /api/comments/:id` | author or admin | Edit `body` |
| `DELETE /api/comments/:id` | author (soft) or admin | Author soft-deletes own; admin moderates any (`hidden`/`deleted`) |

Existing gated routes are unchanged except that enforcement now uses the live role check:

| Method + Path | Gate |
|---------------|------|
| `PUT /api/calendar` | admin |
| `POST/GET/DELETE /api/signups` | member / admin |

`GET /api/calendar` stays public.

## Access Matrix

| Action | Anonymous | Reader | Member | Admin |
|--------|-----------|--------|--------|-------|
| Browse site, view calendar, read comments | ✓ | ✓ | ✓ | ✓ |
| Request Member access | | ✓ | | |
| Post/reply comments | | | ✓ | ✓ |
| RSVP / sign up for events | | | ✓ | ✓ |
| Edit/delete own comment | | | ✓ | ✓ |
| Approve/deny requests, assign roles | | | | ✓ |
| Moderate any comment | | | | ✓ |
| Edit calendar | | | | ✓ |
| Decap CMS (content editing) | | | | ✓ (GitHub OAuth, unchanged) |

## Admin Members Panel

A new admin-only page at **`/account/members`** (deliberately not `/admin`, which is Decap CMS).

- Static HTML/JS served by Hugo; calls the admin APIs with the caller's JWT.
- Shows the **pending queue** (Approve / Deny) and the **full member list** (promote/demote via `POST /api/members/role`).
- Gated client-side for UX (via `GET /api/me` role) and enforced server-side by `requireRole(['admin'])`. Client gating is convenience only; the server is authoritative.

## Admin Notification Email

When `POST /api/access-request` creates a **new** pending request, the worker emails the admins via the **Cloudflare Email Routing `send_email` binding** (free; no third-party account or API-key secret).

- Recipients: the `BOOTSTRAP_ADMINS` addresses (a small, fixed set). Each must be verified once as a Cloudflare Email Routing destination address.
- Built with `mimetext` + the `cloudflare:email` module; one `EmailMessage` per recipient.
- Body: who requested (name/email) + a link to `/account/members`.
- **Notification failure never blocks the request** — it is caught and logged; the pending row still lands.

## Comments Feature Detail

- **Threading:** single level (top-level comments + direct replies via `parent_id`). Deeper nesting is out of scope for v1.
- **Rendering & sanitization (XSS):** comment `body` is stored raw and treated as **plain text** on render — injected via `textContent`, never `innerHTML` (newlines preserved via CSS `white-space: pre-wrap`). This eliminates stored-XSS risk. Limited markdown with a sanitizer (e.g. DOMPurify) is a possible later enhancement, explicitly deferred.
- **Length cap:** reject bodies over a fixed limit (carry over the existing 10,000-char cap from the Remark42 proxy).
- **Moderation:** admin sets `status` to `hidden` or `deleted`; only `published` rows are returned by `GET /api/comments`. Author self-delete is a soft delete (`status='deleted'`).
- **Spam:** posting requires an approved member (no anonymous posting), so spam risk is minimal. Per-user rate limiting is out of scope for v1.

## Site Changes (Hugo)

Modified:

- `site/static/js/auth.js` (`ECBS.Auth`) — after sign-in, call `GET /api/me`; expose live role + request_status. Drop reliance on a `role` claim in the JWT.
- Nav / auth button — render one of: comment/participate UI (member/admin), a "Request access to participate" button (reader), or "Request pending". Add an "Admin" link to `/account/members` for admins.
- `site/layouts/partials/comments.html` — replace the Remark42 embed with a small comments component that calls `GET/POST /api/comments` using `ECBS.Auth.fetch`.

New:

- `site/layouts/.../members.html` (or equivalent) backing the `/account/members` admin panel.
- A comments web component / partial (list + reply form) used on Topics and Pages.

## What Gets Removed

- `workers/sangha-worker/src/groups.js` and `src/service-account.js` (+ their tests).
- `workers/sangha-worker/src/comments.js` Remark42 proxy logic (file is **rewritten** as D1 CRUD, not deleted).
- `infra/isso/` stack (and with it, the committed-secrets exposure — see Security).
- Secrets: `GOOGLE_SERVICE_ACCOUNT_KEY`, `REMARK42_JWT_SECRET`.
- Vars: `GOOGLE_GROUP_EMAIL`, `GOOGLE_ADMIN_EMAIL`, `REMARK42_URL`, `REMARK42_SITE_ID`.
- Domain-wide delegation (a significant security-surface reduction).

## Configuration / Env Changes (`wrangler.toml`)

Add:

- `[vars] BOOTSTRAP_ADMINS` — comma-separated lowercased admin emails (non-secret; these are the always-admin, lockout-recovery accounts and the email-notification recipients).
- `send_email` binding:

```toml
[[send_email]]
name = "SEND_EMAIL"
allowed_destination_addresses = ["<admin1>", "<admin2>"]
```

Keep: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `JWT_SIGNING_SECRET`, `CORS_ORIGIN`, the `[[d1_databases]]` binding, and the Decap GitHub OAuth vars/secrets (Decap is unchanged).

Remove: the Google service-account / group / admin vars and all `REMARK42_*` entries listed above.

## Error Handling

| Scenario | Result |
|----------|--------|
| Sign-in by a brand-new Google user | Reader row created; signed in as reader (no rejection) |
| `access-request` when already member/admin | No-op `200` |
| `access-request` when already pending | Idempotent `200` (no duplicate email) |
| Admin action on unknown email | `404` |
| Invalid role value in `members/role` | `400` |
| Admin email notification fails | Caught + logged; request still recorded |
| D1 unavailable on a gated write | Fail closed → `503`; public reads unaffected |
| JWT expired/tampered | `401`; client clears token and shows sign-in |
| Comment body over length cap | `400` |
| Post/edit/delete without sufficient role | `401`/`403` |

## Security

- No secrets in client code; `JWT_SIGNING_SECRET` never leaves the worker.
- Removing the service account eliminates domain-wide delegation.
- Comments are plain-text rendered (no stored XSS); server enforces role on every write.
- CORS restricted to `CORS_ORIGIN`; comment `thread`/locator origin-pinning behavior from the current proxy is preserved.
- **Cleanup (pre-existing debt):** real secrets were committed under `infra/isso/`. Even though Isso is being dropped, rotate those secrets and add `infra/isso/` secrets to `.gitignore` (history scrub optional).

## Testing (vitest, existing harness)

- `resolveRole` precedence: config admin / D1 role / default reader.
- `access-request` transitions: none→pending, denied→pending, member/admin no-op; email-notify invoked (mocked binding) exactly once for a new request.
- Admin `approve` / `deny` / `role`; `requireRole` honors live D1 changes without a new token.
- Callback: upserts reader row + issues identity-only JWT; no `not_a_member` rejection.
- Comments: post requires member; public read returns only `published`; author edit/delete own; admin moderate any; length cap; plain-text rendering contract.
- Remove `groups`/`service-account` tests; keep the suite green.

## Phasing (for the implementation plan)

- **Phase 1 — Roles & access:** `members` migration; `resolveRole`; auth callback + middleware changes; `GET /api/me`, `POST /api/access-request`, admin `members` APIs; email notification; `/account/members` panel; nav updates. Delete `groups.js`/`service-account.js` and their config.
- **Phase 2 — Native comments:** `comments` migration; rewrite `comments.js` as D1 CRUD; comments component on Topics/Pages; remove Remark42/Isso config and `infra/isso/`.

Phase 1 is a prerequisite for Phase 2 (comments are gated by the roles).

## Deferred to User (deploy-time)

- Set `BOOTSTRAP_ADMINS` and verify each admin address as a Cloudflare Email Routing destination; enable Email Routing on the domain; set a valid sender address.
- Apply the new D1 migrations `--remote`.
- Deploy the worker; remove the now-unused Google service-account and Remark42 secrets from the Worker environment.
- Decommission the DigitalOcean droplet / Isso; rotate the `infra/isso/` secrets.

## Cost

| Component | Monthly Cost |
|-----------|--------------|
| Cloudflare Pages | $0 |
| Cloudflare Worker | $0 (free tier: 100k req/day) |
| Cloudflare D1 | $0 (free tier: 5 GB, 5M reads/day, 100k writes/day) |
| Cloudflare Email Routing | $0 |
| Google Workspace | **$0 (not used)** |
| DigitalOcean / Isso | **$0 (dropped)** |

**Total: $0/month.**

## Out of Scope

- Multi-level (deeper than one reply) comment threading.
- Markdown/rich text in comments (plain text only for v1).
- Per-user comment rate limiting.
- Email notifications to the *requester* (only admins are emailed).
- Changes to Decap CMS auth (stays on GitHub OAuth, re-homed under `/decap/*` as already implemented).
- History scrub of previously committed `infra/isso/` secrets (rotate + gitignore is in scope; rewriting git history is not).
