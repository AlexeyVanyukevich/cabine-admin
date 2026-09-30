# Backlog

What is known to be wrong and not yet fixed, newest first. The rule for this file is the shared
`backlog.md`, imported by [CLAUDE.md](../CLAUDE.md): one entry per finding, deleted by the
commit that fixes it.

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

## The currency dropdown's arrow sits almost against its right border

- Where: `web/src/ui/sheet.css`, `.field__input`; the only `select` is in
  `web/src/routes/Houses.tsx`
- Found: 2026-09-30, reported by the owner
- Problem: the `select` keeps the browser's own arrow (`appearance: auto`) with `padding: 0 12px`.
  The text starts 12px in from the left border, but Chrome draws the arrow about 5px from the
  right one, so the two sides do not match. Open Дома and look at Валюта. The owner's report
  was in the dark theme on a wide screen, where the field stretches and the small arrow sits
  alone at the far edge. Padding cannot move the browser's arrow: a fix hides it
  (`appearance: none`) and draws one at the text's inset, coloured from the theme's variables.
- Impact: cosmetic, but it is the one dropdown in the app and reads as unfinished.

## Offline mode needs the built app on a secure origin, and the README does not say so

- Where: `README.md`, "Running it"
- Found: 2026-09-30, while testing offline mode locally
- Problem: `vite-plugin-pwa` registers no service worker under `./run dev`, so an offline reload
  on the Vite port fails with `ERR_INTERNET_DISCONNECTED`. Under `./run start` it works on
  `localhost`, but not on the network address `start` prints for a phone: a browser registers
  service workers only on HTTPS or `localhost`.
- Impact: whoever tests offline mode on the dev port, or from a phone on the local network,
  sees it fail and takes it for a bug.

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

## The Docker build copies the host's workspace `node_modules` and build output

- Where: `Dockerfile`, `COPY server ./server` and `COPY web ./web`; there is no `.dockerignore`
- Found: 2026-09-30, while checking that the image still builds with `dev-kit`
- Problem: the whole directory is copied, so `server/node_modules`, `web/node_modules`,
  `server/dist` and `server/public` from the machine running `docker build` land on top of what
  `npm ci` just installed in the build stage.
- Impact: the build stage compiles with whatever the host has in those folders, and the build
  context grows by their size. The runtime stage reinstalls its own dependencies and copies
  only `dist` and `public`, so the shipped image is not affected beyond stale files a deleted
  source may leave in `dist`.
