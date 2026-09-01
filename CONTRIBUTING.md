# Contributing

## Language

Everything in this repository is written in English: code, identifiers, comments,
documentation and commit messages. The interface the owner sees is Russian; nothing else is.

## Code conventions

The same set as `../booking-engine`, and for the same reasons — they are written down in
[`../booking-engine/docs/conventions.md`](../booking-engine/docs/conventions.md) and proven
across its suite. Read that for the shared detail; what follows is the working subset and the
handful of rules local to this repository.

**TypeScript.** `strict: true`, plus `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes` in `tsconfig.base.json`. No `any` in hand-written code — the only
occurrences are the `Kysely<any>` signatures Kysely's migration API requires.

**Modules.** The server is `NodeNext`, so relative imports carry a `.js` extension even in a
`.ts` file: `import { localDate } from '../shared/nights.js'`. The web workspace is bundler
resolution and does not.

**Stack.** Fastify 5 with TypeBox, Kysely + `pg`, Postgres 16, Vitest + Testcontainers,
Playwright. React + Vite, React Router and TanStack Query on the client. The TypeBox package is
`typebox`, not `@sinclair/typebox`, paired with `@fastify/type-provider-typebox`.

**HTTP.** Errors keep the shape `{ error, message, details? }`. Every request body is a TypeBox
schema with `additionalProperties: false` — unknown fields are rejected, never ignored. Bodies
are validated before anything is written, so a bad request never reaches the engine.

**Money is integer minor units.** No float anywhere near a total. Roubles are converted exactly
once, at the edge of an input.

**Dates.** The engine returns timestamps carrying the house's own offset, and the local date is
taken from that offset — never by parsing into a `Date` and asking it, which would answer in the
reader's timezone.

**The engine contract is generated.** `server/src/engine/schema.d.ts` comes from the engine's
OpenAPI document via `npm run engine:types`. Never hand-edit it, and never hand-write a parallel
copy of the engine's types.

**Layout.** Server code is `server/src/modules/<area>/` with `*.repository.ts`, `*.service.ts`,
`*.routes.ts` and `*.schemas.ts`; pure helpers live in `server/src/shared/`. Tests are
`server/tests/{unit,integration}/` and `tests/ui/` for browser journeys.

The behavioural rules these serve — why no dates are stored, why writes reach the engine first,
why an unreachable engine must not render an empty calendar — are in
[docs/architecture.md](docs/architecture.md). Read it before changing behaviour.

## Commit messages

We follow [Conventional Commits](https://www.conventionalcommits.org/), the same as
`../booking-engine`, with one local rule: **a commit message is a single line.**

```
type(scope): subject
```

### Types

| Type       | Use for                                                                  |
| ---------- | ------------------------------------------------------------------------ |
| `feat`     | New functionality the owner can see or an API consumer can call          |
| `fix`      | Bug fix                                                                  |
| `docs`     | Documentation only — README, architecture, specs, plans, this file       |
| `test`     | Adding or reworking tests without touching production code               |
| `refactor` | Code change that neither adds behaviour nor fixes a bug                  |
| `perf`     | Performance improvement                                                  |
| `build`    | Build system and dependencies — `package.json`, `tsconfig`, `Dockerfile` |
| `ci`       | CI/CD configuration                                                      |
| `chore`    | Maintenance that fits nothing else — `.gitignore`, editor config         |
| `revert`   | Reverting a previous commit                                              |

Pick the type by the _intent_ of the change, not by the file extension. A test added as part of
a new endpoint belongs to that endpoint's `feat` commit; `test` is for commits whose whole point
is coverage.

### Scope

Optional, lowercase, names the affected area: `engine`, `bookings`, `houses`, `guests`, `auth`,
`web`, `db`, `deps`. Omit it when the change is repository-wide.

### Subject

- Imperative mood — `add`, not `added` or `adds`
- Lowercase first letter, no trailing period
- 72 characters or fewer
- Describe the change, not the file you edited

```
feat(bookings): snapshot add-on prices onto the booking
fix(engine): place check-in at the resource's slot anchor, not midnight
docs: split the reading path from the reference material
build(deps): upgrade luxon to 3.7
```

Avoid:

```
Added house screen                 # past tense, capitalized, no type
fix: bug                           # says nothing
feat: update booking.service.ts    # names the file, not the change
```

### No body, no footer

The subject line is the whole message. No body, no footers, and no `Co-Authored-By` trailer.

If a change seems to need a paragraph to justify itself, that is a signal to split it into
smaller commits rather than to write a longer message. Reasoning that outlives the commit
belongs in `docs/architecture.md` or in a spec, where someone will actually find it.

## Splitting work into commits

Each commit should leave the repository in a compiling state and tell one story.

- Move bottom-up through the dependency graph — schema, then service, then the HTTP layer — so
  no commit references a module that does not exist yet.
- Keep a module's tests in the same commit as the module they cover.
- Keep unrelated changes apart: a dependency bump and a bug fix are two commits.

## Before committing

From the repository root:

```bash
./run check
```

That type-checks, verifies formatting and runs every suite. It needs Docker running — the
integration tests start their own Postgres and a real booking engine — but no database prepared.
Browser journeys are `./run test:ui`.

Tests are written before the implementation. The interesting defects in this project are at the
seam with the engine, so the suite runs the engine itself rather than a stub.

## Specs, plans, and keeping the documentation true

Every slice gets a design document in [docs/superpowers/specs/](docs/superpowers/specs/) and an
implementation plan in `docs/superpowers/plans/`, named `YYYY-MM-DD-<topic>.md`. Write and
approve the spec before touching code.

Both are dated artifacts, and **neither is revised once the slice ships**:

- A **spec** becomes a decision record — read afterwards for _why_ a decision went the way it
  did, never for what the system does. Give it an accurate status line and a banner saying so.
- A **plan** moves to [docs/superpowers/plans/archive/](docs/superpowers/plans/archive/) once
  executed. It is spent scaffolding, kept for provenance and outside the reading path.

**The last task of every slice updates [docs/architecture.md](docs/architecture.md), and, where
running or deploying changed, [README.md](README.md). Then it archives the plan.** Not a
follow-up, not a later cleanup — a task in the plan, with the same standing as the code.

That document is authoritative for what the project does today, and with the README it is the
whole onboarding path. Keeping it true is the only thing that stops the path from growing by one
document per slice until nobody reads any of it. If a spec disagrees with it, the spec is stale
and the architecture document is what gets corrected — never the other way round, and never by
sending the reader off to the spec.
