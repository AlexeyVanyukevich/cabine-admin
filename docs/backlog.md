# Backlog

What is known to be wrong and not yet fixed, newest first. The rule for this file is the shared
`backlog.md`, imported by [CLAUDE.md](../CLAUDE.md): one entry per finding, deleted by the
commit that fixes it.

## The booking engine answers a used-up rate limit with `500`, not `429 rate_limited`

- Where: the booking engine, not this repository; seen through `server/src/engine/client.ts`
- Found: 2026-10-01, while running the browser journeys in Chromium and WebKit in one run
- Problem: once the per-key limit for the minute is used up, the engine logs
  `{"error":"rate_limited","message":"Too many requests; slow down and retry"}` as an
  "unhandled error" and answers `500 Internal server error`. Its own conventions table gives
  that case `429 rate_limited`, which this project's engine facade retries with backoff; a
  `500` it passes on as `engine_rejected_our_key`. Run `./run test:ui` with both browser projects:
  2 to 9 such answers per run, on calendar reads, and in 2 runs of 3 the WebKit journey "a cold
  reload with the server out of reach…" fails because the month it needs was never cached.
- Impact: a burst past the limit — two tabs, or a quick run of taps — shows the owner an error
  where a retry would have succeeded, and the browser journeys fail intermittently. The fix
  belongs in the engine; this entry stays until a version that answers `429` is in use here.

## The booking engine offers no supported way to run it in a consumer's integration tests

- Where: `server/tests/integration/engine-harness.ts`; the gap is in the booking engine
- Found: 2026-10-01, when the engine's rate limit started failing the browser journeys
- Problem: to test against the real engine, the harness builds its image from a sibling
  checkout (it publishes none), starts its database and its console as separate containers,
  issues keys by running a script inside the console container, and seeds houses with a wider
  key than the app uses. Test traffic then runs under production's per-key rate limit, with no
  setting to lift it; the app's own login limit, by contrast, is raised for the journeys through
  `LOGIN_ATTEMPTS_PER_MINUTE`. Every consumer has to rebuild all of this, and the tricks break
  when the engine changes shape.
- Impact: a suite that grows, or runs in a second browser, trips the limit and fails for reasons
  that have nothing to do with the code under test. Wanted from the engine: a published image
  and a documented way to bring it up for tests — keys issued without exec, the rate limit
  configurable — so this harness shrinks to starting it.

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

## The harness describes its two houses as both anchored at 15:00

- Where: `server/tests/integration/engine-harness.ts`, the doc comment on
  `EngineHandle.resourceIds`
- Found: 2026-10-01, while giving each browser journey its own house
- Problem: the comment says "Two day-based houses anchored at 15:00"; `seedHouses` in the same
  file creates one at 15:00 and one at 14:00, on purpose, as its own comment explains.
- Impact: a reader who trusts the interface writes a test assuming 15:00 for both, and it fails
  for the second house only.

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
