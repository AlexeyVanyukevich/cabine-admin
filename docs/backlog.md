# Backlog

What is known to be wrong and not yet fixed, newest first. The rule for this file is the shared
`backlog.md`, imported by [CLAUDE.md](../CLAUDE.md): one entry per finding, deleted by the
commit that fixes it.

## A confirmed booking's guest name is low-contrast in the light theme

- Where: `web/src/calendar/timeline.css`, `.timeline__label` over `.timeline__cell--lit`
- Found: 2026-10-06, while redrawing queued bookings
- Problem: the name on a confirmed block is `--lit-deep` (`#8a5410`) on `--lit` (`#e8a33d`), a
  contrast of 2.90:1, under the 4.5:1 that 13px text needs. The dark theme's `#2a1c05` on
  `#d99b45` is 6.89:1. Open the calendar in the light theme on any booked night.
- Impact: the guest's name — the thing the owner reads the block for — is hard to read on a
  phone in daylight.

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
