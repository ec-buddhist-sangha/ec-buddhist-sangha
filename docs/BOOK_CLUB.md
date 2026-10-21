# Mission Majjhima book club

Public page: `/book-club/`. The homepage card appears directly below Next Gathering.
The calendar recurrence combines **Book club: Mission Majjhima & sangha meet-and-greet**, Thursdays
19:00–20:00 America/Chicago beginning November 5, 2026. Book club runs until
19:30, followed by a casual meet-and-greet open to everyone, including people
who do not attend the book club. Both parts use the same Zoom registration and
joining link. Its description links
to `https://eauclairesangha.org/book-club/` for registration and the current topic.

## Updating the page

- Introductory copy: `site/content/book-club.md`.
- Layout and homepage card: `site/layouts/_default/book-club.html` and
  `site/layouts/partials/book-club-promo.html`.
- Registration URL, dates, topics, reading links, and videos:
  `site/data/mission_majjhima.json`.
- The browser selects the earliest meeting whose UTC `end` is in the future,
  using `site/static/js/book-club.js`; dates display in America/Chicago.
  The end includes the meet-and-greet, so the current reading remains visible
  until 20:00. It refreshes every minute and when a background tab becomes visible.
- The expanded reading schedule also works without JavaScript.

The data records the 110 existing Zoom occurrences, MN 1–110, through December 7,
2028. It does not invent dates for the remaining 42 suttas. Extend the data when
those Zoom meetings are scheduled. The calendar recurrence has no end-date field;
pause it at the end of the scheduled run unless more dates have been added.
If a session is canceled, moved, or assigned a different reading, update Zoom,
the calendar, and this data together. This is a published schedule, not a live
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
