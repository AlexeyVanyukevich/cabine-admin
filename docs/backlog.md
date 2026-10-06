# Backlog

What is known to be wrong and not yet fixed, newest first. The rule for this file is the shared
`backlog.md`, imported by [CLAUDE.md](../CLAUDE.md): one entry per finding, deleted by the
commit that fixes it.

## "Отправляем…" stays up while nothing is being sent

- Where: `web/src/offline/ConnectionBanner.tsx`, the `waiting > 0` branch; `useSync` in
  `web/src/offline/useOffline.ts`
- Found: 2026-10-01, while moving the cold-reload journeys onto a server cut
- Problem: with the server out of reach but the browser reporting online, a booking captured
  after a cold reload is queued, and the banner reads "Отправляем…" from then on. No send is in
  flight: sync runs only on the `online` event, on focus and from the button, and the outcome
  stays `idle`, so the banner falls through to its "sending" line. Seen 1.5 s after capture in
  both engines in `tests/ui/offline-booking.spec.ts`, cold-reload journey.
- Impact: the owner is told a booking is on its way when it is waiting, and nothing on screen
  says it is stuck until the tray is opened.

## Browser journeys run only in Chromium, though the owner's phone may run Safari

- Where: `playwright.config.ts`, `projects` (one, `Desktop Chrome` at phone width)
- Found: 2026-10-01, while reviewing the offline and dropdown fixes
- Problem: every journey, and every check made while fixing the backlog, ran in Chromium alone,
  with only Chromium installed for Playwright. Every browser on iOS uses WebKit, so an iPhone
  never runs what the suite checks. Behaviour that differs between engines is unverified: the
  service worker and offline reload, `document.fonts`, `appearance: none` on the currency
  `select`, touch selection on the calendar.
- Impact: a defect only in Safari reaches the owner with a green suite behind it. Nothing has
  been seen to fail there; nothing has been checked there.
- Blocked: a WebKit project on an iPhone profile is written and passes, but fails intermittently
  while the booking engine answers a used-up rate limit with `500` instead of `429`. That defect,
  and the engine's missing support for consumers' integration tests, are in the engine's own
  `docs/backlog.md`. The commit adding the project waits on branch `test/webkit-journeys`.

## Browser journeys pick their month in UTC while the calendar opens on the local one

- Where: `tests/ui/helpers.ts`, `monthStart()`; used by `houses-guests.spec.ts`,
  `calendar.spec.ts` and `offline-booking.spec.ts`
- Found: 2026-10-01, while running the journeys for the dropdown fix
- Problem: `monthStart` counts months from the UTC date, but the calendar opens on the local
  month (`web/src/calendar/nights.ts`, `today()`), and a journey reaches its month by pressing
  "Следующий месяц" from there. When the two dates fall in different months, the journey lands
  one month past the night it looks for. Seen at 00:18 on 1 October in UTC+3, still 30 September
  in UTC: `Дома › adds an extra, and it becomes bookable on the calendar` waits for a night cell
  dated 2026-12-04 while January 2027 is on screen, and times out. The same failure on `main`.
- Impact: in UTC+3 the journeys fail for the first three hours of every month, and pass again
  without any change. Whoever runs them then takes the change under test for the cause.

## A booking waiting to be sent looks the same as a confirmed one

- Where: `web/src/calendar/timeline.css`, `.timeline__cell--queued`
- Found: 2026-09-30, reported by the owner
- Problem: a booking saved offline keeps the same amber fill as a confirmed one. All that tells
  it apart is a 2px dashed `--water` outline and a 7px dot. In the dark theme the outline is
  `#7fb3b8` on `#d99b45`, a contrast of 1.04:1, so it differs from the fill in hue alone; in
  the light theme it is 3.4:1. The dot sits on the block's right edge and is partly cut off.
  The outline is drawn per night, so a stay of several nights also shows dashed lines across
  the block between nights. Go offline in the built app, create a booking, and compare it with
  a confirmed one.
- Impact: the owner cannot tell at a glance which bookings the engine has not yet accepted,
  which is the one thing the treatment exists to show.

## Most tests keep their cases in the test body, not in a dataset

- Where: `server/tests/integration/`, `web/tests/`, and some of `server/tests/unit/`
- Found: 2026-09-30, while adopting the shared testing rule
- Problem: the rule wants cases in typed tables consumed by a parameterised runner. Here most
  files write one `it` per case with the values inline. `web/tests/useSelection.test.ts` has 18
  such tests and no table; `auth.test.ts` and `amend-booking.test.ts` are the same shape. The
  unit suites for money, nights and phone numbers already use tables.
- Impact: extending coverage means copying a test rather than adding a row. The integration
  suites are scenario-shaped, and some may be clearer left as they are; which ones is a
  decision for whoever takes this up, recorded in `CONTRIBUTING.md` if any are kept.
