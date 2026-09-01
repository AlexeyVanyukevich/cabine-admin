# cabins-admin

The owner's admin tool for a two-house nightly rental. A **consumer** of the booking engine,
never a replacement for it.

## The two projects

|                    | This repository                              | `../booking-engine`                  |
| ------------------ | -------------------------------------------- | ------------------------------------ |
| Owns               | guests, money, add-ons, notes                | slots, availability, bookings, holds |
| Knows about houses | names, prices, which add-on each has         | nothing — a resource is opaque       |
| Users              | one owner, from the internet, phone included | any tenant's backend, by API key     |
| Deployed           | its own service and database                 | its own service and database         |

## The documentation

`docs/architecture.md` is **authoritative for what this project does today** — the engine
client, the data model, the life of a booking, the calendar, login. Read it before changing
behaviour. `README.md` covers running, configuring and deploying.

Where either disagrees with a spec in `docs/superpowers/specs/` or an archived plan in
`docs/superpowers/plans/archive/`, **the living document is right and the older one is stale.**
Fix `docs/architecture.md`; do not send the reader to the spec. Specs are decision records:
consult one for _why_ a shape was chosen, never for what the code does now. Archived plans are
spent scaffolding and sit outside the reading path.

The engine lives at `../booking-engine` on this machine. To read it in a session:
`/add-dir ../booking-engine`. Its own documentation is the contract, and these two are the
ones to read:

- `../booking-engine/docs/architecture.md` — the data model and the API surface
- `../booking-engine/docs/conventions.md` — error shapes, time and date rules, **the scope table**

Consult `../booking-engine/docs/superpowers/specs/` only for _why_ the engine has a given shape.

## Invariants that must not be broken

**The engine API key never reaches a browser.** It lives in this server's environment and
nowhere else. Every client-enforced rule — minimum stay, booking horizon — rests on this
server being the only caller. The day a key ships to the frontend, those rules become
advisory and have to move into the engine.

**The engine is the single source of truth for occupancy.** This project stores no dates and
no booking status, so its records cannot drift from the engine's. Rendering joins the two by
`engine_booking_id`.

**Writes go to the engine first, then here.** A failure then leaves a booking whose guest
details are missing — annoying and repairable. The reverse order can leave a record that does
not actually hold the night, which is how two guests end up in one house.

**An unreachable engine means an error screen, never an empty calendar.** An empty calendar
reads as "everything is free".

**Money is integer minor units.** No float anywhere near a total. Prices are snapshotted onto
a booking at creation, never referenced live, so raising a rate cannot rewrite past totals.

## The engine contract is generated, not written

`server/src/engine/schema.d.ts` comes from the engine's OpenAPI document at `/docs/json`,
which the engine itself generates from the same TypeBox schemas its routes validate against.
Regenerate with `npm run engine:types`. Never hand-edit it, and never hand-write a parallel
copy of the engine's types — a second copy of a contract drifts silently.

## Conventions

Same as the engine, and for the same reasons — they are written down in
`../booking-engine/docs/conventions.md` and proven across its suite. TypeScript strict,
NodeNext modules with `.js` on relative imports, Fastify 5 with TypeBox, Kysely + `pg`,
Postgres 16, Vitest + Testcontainers, Playwright. Errors keep the shape
`{ error, message, details? }`. Unknown fields in a request body are rejected, never ignored.
