# Calendar System

This feature is scaffolded as a static Hugo interface first, with the backend boundary kept in `site/static/js/calendar.js`.

## Pages

- `/calendar/` shows a standard month grid calendar with previous and next controls.
- `/admin/calendar/` shows the same grid calendar and lets a scheduler click a date, choose an item type, and edit the calendar item.
- `/calendar-item/?slot=<slot-id>` lets a member volunteer to bring a talk, add themselves as a backup, or mark attendance for a talk or regular meeting.

Calendar and item detail pages are intentionally not shown in the main site menu during inception. Calendar details are viewable without signing in, but volunteer, backup, and attendance actions require a logged-in member.

The Calendar Admin page renders at `/admin/calendar/` and is linked from the Decap CMS menu. The static preview includes a soft client-side gate so casual direct visits to `/admin/calendar/` are asked to open it through the CMS first. This is not production security; final access control should be enforced with Cloudflare Access or a backend authorization check.

## Current Persistence

The first implementation uses browser `localStorage` under `ecbs-calendar-v1`. This is only for local UI validation and does not share data between users or devices.

Until authentication is wired, the volunteer form uses `ecbs-calendar-current-user-name` from browser local storage as the mock logged-in name. If that value is missing, signup panels show a sign-in-required message instead of volunteer forms.

For preview/testing, adding `?demo=1` to any calendar scheduler page seeds the default weekly Sangha meeting recurrence. The Development reset restores the same seed data.

The local static implementation stores shared calendar settings under `settings`: `defaultLocation`, `signupWindowMonths`, `zoomName`, `zoomEmail`, and `zoomLink`. `signupWindowMonths` defaults to `1`, so members can volunteer, sign up as backup, or mark attendance once an item is within one month of its date.

The local static implementation stores recurring meeting rules under `recurrences`. A recurrence rule has this current shape: `id`, `name`, `itemType`, `frequency`, `monthlyMode`, `interval`, `startDate`, `startTime`, `endTime`, `title`, `description`, `usePhysicalLocation`, `useDefaultLocation`, `location`, `useZoom`, `active`, and `skippedDates`.

The default rule is `Weekly Sangha Meeting`, which generates a talk item every Tuesday:

- start: `19:00`
- end: `20:30`
- title: `Sangha Meeting`
- description: `Each 90 minute gathering is divided into 30 minute segments:` followed immediately by the three default gathering segments.
- physical location: default location checked
- Zoom: off by default

The current seed data includes three Tuesday occurrences attached to that recurring rule:

- May 26, 2026: `Third Hindrance: Sloth & Torpor`, assigned to Chris
- June 2, 2026: `Fourth Hindrance: Restlessness & Worry`, open for volunteer
- June 9, 2026: `Fifth Hindrance: Skeptical Doubt`, assigned to Mary

Calendar items can be physical only, Zoom only, or hybrid physical plus Zoom. Physical items can use the default location or a custom location. The admin page includes an editable `Calendar Settings` block, and new items/recurring rules default to the shared location:

```text
Unity of Eau Claire
1808 Folsom Street
Eau Claire, WI 54703
```

Changing the default location updates future items and recurring rules that are still checked to use the default location. Past items and custom-location items are not changed.

Zoom-enabled items use the Zoom meeting link configured in the admin Zoom settings block. The upcoming email copy block appends a Zoom link after each Zoom-enabled entry. Public calendar item pages show an `Online` block; while the meeting is occurring, the Zoom button says `Join Zoom`.

The current static implementation stores a manually supplied Zoom link. The production plan is to use Zoom Server-to-Server OAuth from the Cloudflare Worker so meetings can be created and updated automatically without storing a Zoom username or password in the app. Expected Worker secrets are `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, and `ZOOM_CLIENT_SECRET`; the Worker should request short-lived Zoom access tokens and call Zoom meeting APIs for calendar items marked `useZoom`.

Slots before the current local date are treated as past meetings. They remain linkable and visible for history, but public signup actions are closed.

Future items outside the configured signup window remain visible and linkable. The public calendar hides volunteer, backup, and attendance action buttons for those items, and the calendar item page shows when the item will open for volunteers or attendance signups.

Backup volunteers are never promoted automatically. The interface shows an ordered recommendation list:

1. Prefer the person who last brought a talk longer ago.
2. If tied or neither person has a prior talk, preserve backup signup date/time order.

People may sign up as backup for as many dates as they want.

If the logged-in user is already the person bringing the talk for a future talk, the volunteer panel switches to update and cancel actions and thanks them for letting the sangha know if they need to step back.

Talk links and notes are optional for both the person bringing the talk and backup volunteers. If no link or notes are entered, nothing extra is shown.

Public calendar item pages show attendance as a count only. The person bringing a talk and all backup volunteers automatically count as attending. Logged-in members can also mark themselves as attending without volunteering to bring or back up the talk. On regular meeting calendar cards, the title opens the item detail page while the `Attend` action immediately marks the logged-in member as attending. Attendee names are only shown in the admin interface.

If the person bringing the talk cancels, the local preview queues email notice records for each backup volunteer. Each notice includes the calendar item link so a backup can return to the page. Queued notice previews are shown in a collapsed admin-only section near the bottom of the admin page, directly above `Calendar History (30 Days)`, not on public calendar item pages. When a logged-in backup visits the link and no one is currently bringing the talk, they can click `Volunteer` to move from backup to the person bringing the talk.

The admin modal shows the person bringing the talk, backup volunteers, and direct attendees with cancel controls beside each person. Admin date/time/location changes, person cancellations, and meeting cancellation queue notice records for everyone signed up on that calendar item. Time changes ask for confirmation before saving when signed-up people are present.

Admins can also assign the person bringing a talk, add backup volunteers, and add attendees by entering a name and optional email address. If email is omitted, the calendar keeps that person's email blank and does not queue email notices for that person.

The admin page includes a copyable `Upcoming Calendar Email Block` with one line per upcoming date in this format: `May 26: Third Hindrance: Sloth & Torpor: volunteer to bring talk` or `May 26: Third Hindrance: Sloth & Torpor: Chris`. In rich clipboard copy, the title links to the calendar item while looking like regular text, and `volunteer to bring talk` remains a blue link. Backup signup links are intentionally omitted from this block. If Zoom is enabled, a Zoom link is added after the volunteer/attendance text. Times and backup counts are intentionally omitted.

Admin date clicks first prompt for item type:

- `Talk`: person bringing the talk plus backup volunteers.
- `Regular Meeting`: one attendance/signup flow for people planning to attend.

New calendar items start with a type chooser, then a smaller basics modal, then the full editor. Draft item modals do not show cancellation or push-forward actions, and closing the draft modal discards the unsaved item.

The admin page includes a `Recurring Meetings` block. Admins can create or edit weekly and monthly recurring groups for either `Talk` or `Regular Meeting` items. Each rule uses a start date from a date picker:

- Weekly repeats on the same day of week as the start date.
- Monthly defaults to the same nth weekday as the start date, such as every 3rd Tuesday.
- Monthly can instead repeat on the same day number as the start date, such as every 10th day of the month.

Recurring items carry a `recurrenceId`.

Individual recurring occurrences can still be edited from the normal item editor. When an occurrence's time, title, description, or location differs from its recurring rule, the item stores `occurrenceOverrides` and stays attached to the recurring group. Future recurring-rule edits do not delete those customized occurrences, while push-forward/cancellation still treats them as part of the same series.

Past items generated from a recurrence are historical records. Editing, pausing, or deleting a recurring meeting only cleans up future empty generated items; past generated items remain visible and linkable. If a recurring meeting is deleted, kept items become one-time calendar records.

The admin modal also includes `Cancel And Push Forward One Week`. In the local preview this shifts only items in the selected item's recurring group from the selected date forward by seven days. A one-time Saturday item is not pushed when a Tuesday recurring talk is pushed. The original dates are added to that recurrence rule's skipped dates so they are not regenerated, and the old dates keep a visible `Moved to M/D` marker.

Admin item editors keep location details collapsed by default and use a bottom `Save And Close` action so the main title, description, speaker, backup, and attendance controls stay easier to scan. Admin saves no longer schedule reminders for the whole calendar item. Reminder preferences are shown only after a member signs up to bring a talk, volunteer as backup, or mark themselves as attending, near the top of the calendar item page beside `Add To Calendar`.

Admin cancellation and push-forward actions open a confirmation modal before the local store is changed. When people are signed up, the modal lists email notice recipients and includes a `Send email notice` checkbox. If no one is signed up or attending for a push-forward action, the series moves immediately and the old dates still show `Moved to M/D` markers.

Each calendar item carries a `revision` and `updatedAt` value. Admin writes reload the latest local store and compare the expected revision before saving, which prevents the static implementation from silently overwriting another open browser tab's newer edit. The production backend should preserve this as optimistic locking.

The admin page shows a collapsed `Calendar History (30 Days)` block at the bottom with recent activity in plain language, such as who signed up, who joined as backup, who canceled, and which calendar items were changed. Calendar history is retained for 30 days. The create-recurring-meeting form, Zoom meeting settings, and email template reference block are also collapsed by default to keep the admin page focused on the calendar.

The collapsed `Email Templates` settings block includes draft wording for talk signup confirmations, backup signup confirmations, attendance confirmations, backup-needed notices, cancellation notices, moved-meeting notices, and reminder emails. These are reference templates for the backend email implementation and use tokens such as `{name}`, `{date}`, `{title}`, `{schedule_link}`, and `{zoom_line}`.

Calendar item and admin item views include an `Add To Calendar` link for the selected calendar item. The export includes the physical location when enabled and adds the Zoom link to the event description when Zoom is enabled. After a member signs up to bring a talk, serve as backup, or attend, the calendar item page shows reminder preferences beside `Add To Calendar` in the top item block, and the relevant confirmation panel shows update/cancel controls where appropriate.

## Future Cloudflare Backend

The production version should replace the local store with Worker API calls backed by D1.

Suggested tables:

- `calendar_settings`: `id`, `default_location`, `signup_window_months`, `zoom_name`, `zoom_email`, `zoom_link`, `updated_at`
- `calendar_items`: `id`, `recurrence_id`, `date`, `start_time`, `end_time`, `item_type`, `title`, `description`, `use_physical_location`, `use_default_location`, `location`, `use_zoom`, `occurrence_overrides`, `revision`, `created_at`, `updated_at`
- `calendar_recurrences`: `id`, `name`, `item_type`, `frequency`, `monthly_mode`, `interval`, `start_date`, `start_time`, `end_time`, `title`, `description`, `use_physical_location`, `use_default_location`, `location`, `use_zoom`, `active`, `created_at`, `updated_at`
- `calendar_recurrence_exceptions`: `id`, `recurrence_id`, `date`, `reason`, `created_at`
- `calendar_signups`: `id`, `item_id`, `role`, `name`, `email`, `link`, `notes`, `signed_up_at`, `created_at`, `updated_at`
- `calendar_notifications`: `id`, `item_id`, `type`, `to_name`, `to_email`, `subject`, `body`, `link`, `status`, `queued_at`, `sent_at`
- `calendar_reminders`: `id`, `item_id`, `option_id`, `label`, `scheduled_for`, `status`, `created_at`, `sent_at`
- `calendar_history`: `id`, `item_id`, `actor_id`, `action`, `summary`, `created_at`

Suggested API:

- `GET /api/calendar-items?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `POST /api/calendar-items`
- `PATCH /api/calendar-items/:id`
- `DELETE /api/calendar-items/:id`
- `POST /api/calendar-items/:id/signups`
- `POST /api/calendar-items/:id/cancel-speaker`
- `POST /api/calendar-items/:id/cancel-signup`
- `POST /api/calendar-items/:id/cancel-meeting`
- `POST /api/calendar-items/:id/promote-backup`
- `POST /api/calendar-items/:id/push-forward-one-week`
- `POST /api/calendar-items/:id/reminders`
- `GET /api/calendar-items/:id/ics`
- `GET /api/calendar-settings`
- `PATCH /api/calendar-settings`
- `GET /api/calendar-recurrences`
- `POST /api/calendar-recurrences`
- `PATCH /api/calendar-recurrences/:id`
- `DELETE /api/calendar-recurrences/:id`

Admin writes should require authentication before this goes live.
