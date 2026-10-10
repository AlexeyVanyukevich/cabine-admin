# Backlog

What is known to be wrong and not yet fixed, newest first. The rule for this file is the shared
`backlog.md`, imported by [CLAUDE.md](../CLAUDE.md): one entry per finding, deleted by the
commit that fixes it.

## Three test files write the cases of one behaviour as separate tests

- Where: `web/tests/useSelection.test.ts`; `web/tests/money.test.ts`, the `money`, `toMinor`
  (accepted input), `toMajor` and `currencyOf` groups; `server/tests/integration/auth.test.ts`,
  the `the guard` group
- Found: 2026-09-30, while adopting the shared testing rule; narrowed 2026-10-10, when the rule
  said a table holds the cases of one behaviour
- Problem: each of these is one call checked one way — actions in and a selection out, an
  amount in and text out, a session state in and a status out — written as one `it` per case
  with the values inline. `useSelection` alone has 18. The other suites check a different
  behaviour per test or walk a scenario, which the rule leaves as they are.
- Impact: covering one more gesture, amount or session state means copying a test rather than
  adding a row.
