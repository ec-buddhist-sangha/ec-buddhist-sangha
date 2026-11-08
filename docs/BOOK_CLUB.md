# Mission Majjhima book club

Public page: `/book-club/`. The homepage card appears directly below Next Gathering.
The page and homepage card advertise **Book club: Mission Majjhima**, Thursdays
19:00–19:30 America/Chicago beginning November 5, 2026. People may come just
to chat or stay afterward; there is no separately scheduled social on the page.
The book club uses the sangha's Zoom personal room:
`https://us02web.zoom.us/j/9333279943`. No meeting registration is required;
participants must sign in to Zoom. The room allows participants to join anytime.
These settings and the invite link were verified in Zoom on November 8, 2026.
The calendar description links to `https://eauclairesangha.org/book-club/`
for joining details and the current topic.

## Updating the page

- Introductory copy: `site/content/book-club.md`.
- Layout and homepage card: `site/layouts/_default/book-club.html` and
  `site/layouts/partials/book-club-promo.html`.
- Personal-room URL (`zoom_url`), dates, topics, reading links, and videos:
  `site/data/mission_majjhima.json`.
- The browser selects the earliest meeting whose UTC `end` is in the future,
  using `site/static/js/book-club.js`; dates display in America/Chicago.
  The current reading remains visible until the book club ends at 19:30.
  It refreshes every minute and when a background tab becomes visible.
- The reading schedule is collapsed at the bottom of the next-reading card and
  also works without JavaScript. The header shows the permanent Zoom URL as a plain link.
- Completed readings are omitted at build time and hidden by the browser once
  their meeting ends at 19:30 Central, including when the page stays open.
  The source data retains past readings.

The data records the reading schedule for MN 1–110 through December 7,
2028, independently of Zoom's scheduled occurrences. Extend the data when
readings for the remaining 42 suttas are planned. The calendar recurrence has no end-date field;
pause it at the end of the scheduled run unless more dates have been added.
If a session is canceled, moved, or assigned a different reading, update
the calendar and this data together. The personal-room link stays the same.
This is a published schedule, not a live
Zoom API integration. It requires no credentials or additional service.

Dates were copied from the Zoom occurrence schedule. Titles/readings follow
[Clear Mountain's schedule](https://docs.google.com/spreadsheets/d/1fVLmb0mch8JPsx8TSC3ji_k_0WPlbLd_dCyUVh_iwjI/edit?gid=1953073236),
with videos verified against the
[10-Minute Majjhima playlist](https://www.youtube.com/playlist?list=PLomY-Sp4p5YsIVG0DmvJhUcR6YaXR_3wf).
MN 10 uses the requested title “The Foundations of Mindfulness.”

## Cover image

`site/static/images/middle-length-discourses.jpg` is the existing Wisdom
Publications cover for ISBN 9780861710720, downloaded October 19, 2026 from the
official distributor's public cover-image resource:

- [Simon & Schuster product page](https://www.simonandschuster.com/books/The-Middle-Length-Discourses-of-the-Buddha/Nanamoli/The-Teachings-of-the-Buddha/9780861710720)
- [Cover image](https://d28hgpri8am2if.cloudfront.net/book_images/onix/cvr9780861710720/the-middle-length-discourses-of-the-buddha-9780861710720_hr.jpg)

The cover remains the publisher's artwork. The page identifies the edition and
links to the publisher; buying a copy is optional.

## Validation and release

Run `npm test`, `npm run css:prod`, and `hugo` inside `site/`, then check the
homepage, book-club page, and calendar detail in a browser at desktop/mobile
sizes. Site changes publish through the repository's GitHub Pages workflow on
`main`. Calendar content is saved separately through the signed-in calendar admin.
