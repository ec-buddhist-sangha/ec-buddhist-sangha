# Calendar System

The production calendar is a Hugo/JavaScript interface backed by the shared Cloudflare Worker and D1. D1 is authoritative in production. Browser storage is used only for local Hugo development and for identity-scoped, read-only copies of successfully fetched server data.

## Pages and access

- `/calendar/` shows a month grid on desktop. On mobile it shows today first, followed by up to five upcoming items per page.
- `/calendar-item/?slot=<slot-id>` shows one calendar item. Public details are visible without signing in; volunteering requires a Google-authenticated member.
- `/admin/calendar/` is linked from Decap for convenience, but Decap is not its security boundary. The direct URL requires the Google-authenticated `admin` role.
- Calendar links remain absent from the main site navigation for now.

Signed-out, pending-access, member, and administrator states are handled independently. Production ignores the local `?as=` mock identity and any obsolete Decap handoff marker.

## Production data model

D1 table `calendar_state` stores one versioned JSON document:

```text
id = 1
store_json = { slots, recurrences, settings, history, revision }
revision = optimistic-lock revision
updated_at = last successful write
```

The API is implemented in `workers/sangha-worker/src/calendar.js`:

- `GET /api/calendar` is public and returns a role-appropriate projection.
- `PUT /api/calendar` requires `admin` and replaces the document using optimistic locking.
- `POST /api/signups` requires `member` or `admin` and creates or updates the caller's signup.
- `DELETE /api/signups` requires `member` or `admin` and removes the caller's signup.
- `GET /api/signups?itemId=...` returns the caller's signup.

The authoritative D1 revision is also written into the JSON document. A stale write receives `409 revision_conflict` and the caller-appropriate current store.

## Privacy projections

The public projection contains first full name and last initial, public talk links and notes, backup order through `fairnessRank`, and the internal attendance total through `attendanceCount`. The current interface does not display attendance or backup totals. The projection does not contain attendee identities, email addresses, reminder records, notification queues, or administrator history.

A member receives the public projection plus that member's complete signup details. An administrator receives the complete unredacted store. Offline caches are scoped to the current identity so an administrator cache cannot become the signed-out fallback.

## Recurring meetings

Recurring rules may be weekly or monthly and may create either talk or regular-meeting items. Monthly rules repeat by the start date's nth weekday or day of month. Past occurrences are historical records and are not changed by recurrence edits.

Derived occurrences use the deterministic ID:

```text
occ-<recurrence-id>-<YYYY-MM-DD>
```

Rendering derives occurrences in memory only. Opening a page never writes to D1. The Worker materializes a derived occurrence when its first member signup is saved; an administrator edit saves the occurrence in the full store.

Individual occurrences can override title, description, time, and location while remaining attached to their recurring group. Cancel-and-push-forward affects only the selected recurrence group.

## Signup behavior

The Worker enforces valid talk/meeting types and roles, active future items, the configured signup window, one open speaker position, approved reminder identifiers, HTTP(S)-only optional links, and bounded link/notes lengths.

Talk speakers and backups continue to count as attending in the stored data. The `Hide attending block` calendar setting is enabled by default, so public attendance controls and totals are currently hidden. This preserves the feature for a later return without treating attendance as an RSVP.

Backup volunteers are never promoted automatically. Fairness ordering prefers the person who brought a talk less recently, then preserves signup time as the tie-breaker.

## Calendar settings

The default signup window is one month, and `Hide attending block` is enabled. Calendar items can be physical, Zoom, or hybrid. The default physical location is:

```text
Unity of Eau Claire
1808 Folsom Street
Eau Claire, WI 54703
```

Changing the default location updates future items and recurrence rules still marked to use it. Manual Zoom links are supported. Automatic Zoom meeting creation is deferred.

The admin page retains email templates and reminder fields for a later implementation, but production does not display send-email controls or promise reminder delivery. Calendar email delivery is deferred.

## Initialization

Migration `workers/sangha-worker/migrations/0004_initialize_calendar.sql` inserts state only when `calendar_state` has no row with `id = 1`. It seeds revision `1` with:

- weekly Tuesday talk recurrence starting July 21, 2026;
- 7:00 PM to 8:30 PM;
- title `Sangha Meeting` and the standard gathering description;
- the default physical location;
- one-month signup window;
- no Zoom, historical items, volunteers, signups, notices, or history.

Never reset or delete production D1 during initialization. Deployment order:

1. Push tested Worker and site changes.
2. Run `npx wrangler login` interactively.
3. Deploy the Worker while `calendar_state` is still empty.
4. Wait for the matching GitHub Pages deployment.
5. Query remote D1 and stop if a calendar row unexpectedly exists.
6. Apply pending migrations remotely without resetting D1.
7. Verify revision `1`, the July 21 derived occurrence, administrator editing, member signup, and cross-browser shared state.

## Local development

Hugo server builds intentionally omit the production calendar API URL. On localhost and private LAN hosts, the calendar uses `ecbs-calendar-v1` in browser storage and displays the mock-user helper. The `?as=` and `?demo=1` helpers are local-only. `/admin/calendar/` opens directly only when both Hugo's server marker and a local/private host are present.

For reliable LAN preview from `site/`:

```powershell
hugo server -D --renderToMemory --disableFastRender --bind 0.0.0.0 --baseURL "http://192.168.0.101:1313/ec-buddhist-sangha/"
```

Replace the IP if it changes. If routes or CSS stop loading while Hugo still appears active, restart with this command; `--renderToMemory --disableFastRender` avoids the stale-output behavior previously seen during local calendar work.

## Verification

```powershell
cd site
npm test
npm run css:prod
hugo --gc --minify

cd ..\workers\sangha-worker
npm test
```

Before deployment, test desktop and mobile rendering plus two independent browsers or devices. Both should resolve the same deterministic item ID and shared signup state.
