# Contributing

## The shared rules

The conventions this project shares with its siblings — TypeScript, HTTP errors, code layout,
testing, commits, documentation, writing and review — come from the `dev-kit`
package, and are not restated here. After `npm install`, or the first `./run`, which does it,
they are in `node_modules/dev-kit/rules/`, and `node_modules/dev-kit/README.md` says what each
one covers.

[CLAUDE.md](CLAUDE.md) imports every one of them, so an agent in the repository reads the same
text. A shared rule that is wrong is corrected in the kit and arrives here with the next version
bump. Declining one means deleting its import from `CLAUDE.md` and saying why in this file.

Everything below is this repository's own.

## Language

Everything in this repository is written in English: code, identifiers, comments,
documentation and commit messages. The interface the owner sees is Russian; nothing else is.

## Code conventions

**Stack.** Fastify 5 with TypeBox, Kysely + `pg`, Postgres 16, Vitest + Testcontainers,
Playwright. React + Vite, React Router and TanStack Query on the client.

**Layout.** The shared layout, under `server/`: `server/src/modules/<area>/`, pure helpers in
`server/src/shared/`, tests in `server/tests/{unit,integration}/`. Browser journeys drive the
whole product, so they sit at the root in `tests/ui/`. The web workspace is bundler resolution,
`server/` is `NodeNext`.

**HTTP.** Bodies are validated before anything is written, so a bad request never reaches the
engine. The error vocabulary extends the shared table with `invalid_phone`, the engine's own
owner-facing codes passed through, and the two operational failures `engine_unreachable` and
`engine_rejected_our_key` — [docs/architecture.md](docs/architecture.md#error-translation) has
the whole mapping.

**Money is integer minor units.** No float anywhere near a total. Whole units are converted
exactly once, at the edge of an input, in `web/src/money.ts`. Every currency on offer divides
into 100 minor units, and `server/src/shared/currency.ts` is the only list of them — the web
workspace gets it from `GET /api/settings` rather than keeping a copy.

**Dates.** The engine returns timestamps carrying the house's own offset, and the local date is
taken from that offset — never by parsing into a `Date` and asking it, which would answer in the
reader's timezone.

**The engine contract is generated.** `server/src/engine/schema.d.ts` comes from the engine's
OpenAPI document at `/docs/json`, which the engine itself generates from the same TypeBox
schemas its routes validate against. Regenerate with `npm run engine:types`. Never hand-edit
it, and never hand-write a parallel copy of the engine's types — a second copy of a contract
drifts silently.

**Styles are for a phone first.** Tap targets are at least `var(--tap)` (44px). A `:hover` rule
goes inside `@media (hover: hover)`, because a touch screen keeps `:hover` on whatever was
tapped last. A gesture works with a finger as well as a mouse, and a browser journey that
matters on a phone runs with touch (`hasTouch`) rather than a mouse.

**Sizes are flexible until something requires otherwise.** A box grows with its content: tap
targets are `min-height`/`min-width: var(--tap)`, not `height`, and widths are bounded with
`max-width` or grid fractions rather than set. An offset that depends on another box's height
uses that box's live height, published by `usePublishedHeight` (`web/src/ui/`), never a sum of
numbers copied from its stylesheet. A size that must be fixed says why beside it.

**One thing is pinned to the top: the frame's sticky box** (`.app-chrome`, `web/src/ui/`).
Anything else that must stay at the top goes inside it; anything pinned below it inside a screen
uses `top: var(--chrome-h)`, and anything kept clear of the bottom bar uses `var(--nav-h)`. A
container around a sticky element clips with `overflow: clip`, not `hidden` — `hidden` makes it a
scroll container, and the element then sticks inside it instead of to the screen.

The behavioural rules these serve — why no dates are stored, why writes reach the engine first,
why an unreachable engine must not render an empty calendar — are in
[docs/architecture.md](docs/architecture.md). Read it before changing behaviour.

## Commit scopes

The scope names the affected area: `engine`, `bookings`, `houses`, `guests`, `auth`, `web`,
`db`, `deps`, `ui` for the browser journeys. Omit it when the change is repository-wide.

## Before committing

From the repository root:

```bash
./run check
```

That type-checks, verifies formatting and runs the server and web suites. It needs Docker
running — the integration tests start their own Postgres and a real booking engine — but no
database prepared. Browser journeys are a separate `./run test:ui`, and they are part of the
same bar: run both before opening a pull request.

The interesting defects in this project are at the seam with the engine, so the suite runs the
engine itself rather than a stub.
