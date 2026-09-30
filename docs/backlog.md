# Backlog

What is known to be wrong and not yet fixed, newest first. The rule for this file is the shared
`backlog.md`, imported by [CLAUDE.md](../CLAUDE.md): one entry per finding, deleted by the
commit that fixes it.

## An oversized body is answered `bad_request`, not `payload_too_large`

- Where: `server/src/shared/errors.ts`, `registerErrorHandler()`
- Found: 2026-09-30, while adopting the shared HTTP rule
- Problem: Fastify raises `FST_ERR_CTP_BODY_TOO_LARGE` with status 413 and no `validation`, so
  it falls into the generic 4xx branch and is sent as `{ "error": "bad_request" }` with a 413.
  The shared table gives 413 its own code. Send any `/api` route a body over Fastify's default
  1 MiB limit to see it.
- Impact: a client cannot tell "too big" from any other framework refusal by code alone. No
  screen reads it today, so nothing the owner sees is wrong yet.

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
