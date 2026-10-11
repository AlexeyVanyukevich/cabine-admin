# Backlog

What is known to be wrong and not yet fixed, newest first. The rule for this file is the shared
`backlog.md`, imported by [CLAUDE.md](../CLAUDE.md): one entry per finding, deleted by the
commit that fixes it.

## The session guard decides on the raw URL, so an encoded path may skip it

- Where: `server/src/modules/auth/guard.ts`, the second `onRequest` hook (`request.url.startsWith('/api/')`)
- Found: 2026-10-11, while fixing the same defect in a sibling project built on the same pattern
- Problem: the guard tests the raw request URL, but the router (find-my-way 9.8.0, under Fastify
  5.12.1) matches routes after percent-decoding the path. A request whose path spells the `/api/`
  prefix with an escape can match a protected route while failing the `startsWith` test, so the
  hook returns before checking the session. The sibling project reproduced this against an
  equivalent guard; here it is inferred from the code and the router version, not yet run.
- Impact: unauthenticated access to every non-`public` API route, reads and writes alike, on a
  console reachable from the internet. Fix: decide on the matched route pattern
  (`request.routeOptions.url`, which is undefined for an unmatched path) instead of `request.url`,
  and add a guard-table row for an encoded path to prove it.
