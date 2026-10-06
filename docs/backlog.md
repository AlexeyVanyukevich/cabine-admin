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
