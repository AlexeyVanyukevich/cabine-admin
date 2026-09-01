# Slice 1 — The owner's journal

Status: **shipped**, 2026-09-01.

> **This is a decision record, not a description of the system.**
>
> It states what was decided on 2026-08-19, before any of it was built, and it is not revised
> as the code moves on. Several things shipped differently — a house's check-out time, the
> `house:add` and `house:checkin` commands, a resource cache in the engine client, the Дома
> screen — and this document does not know about them.
>
> Read it to learn **why** something has the shape it does. For **what** the system does today,
> read [docs/architecture.md](../../architecture.md), which is authoritative. Where the two
> disagree, the architecture document is right and this one is stale; the fix is to correct
> that document, not to consult this one.

A consumer of the booking engine at `../booking-engine`, whose
[architecture](../../../../booking-engine/docs/architecture.md) and
[conventions](../../../../booking-engine/docs/conventions.md) are the contract this project
builds on. Formats, error shapes and testing rules are not restated here except where this
project departs from them.

---

## 1. Purpose

One owner rents two houses by the night. Today the bookings live in a notebook and a chat
history. This replaces that: a calendar of both houses, who is coming, what they owe, and
which extra they took.

### The driving case

House one offers a sauna, house two a hot tub. Both are always available with the house and
cost extra; neither has a schedule of its own. That is exactly why the engine knows nothing
about them — they are not bookable units, they are a line on a bill, and the bill lives here.

### In scope

- One owner, password login, reachable from the internet including a phone
- A month-long timeline of both houses, occupancy read live from the engine
- Create, reschedule and cancel a booking, through the engine
- Guest: name, phone, note; past stays looked up by phone
- Money: nightly price, add-ons, total, deposit taken, balance outstanding
- Add-ons per house, with a price

### Out of scope

| Left out                              | Why                                                                                 |
| ------------------------------------- | ----------------------------------------------------------------------------------- |
| Guest self-service and online payment | The owner enters bookings; money moves outside the system and is only recorded      |
| Telegram reminders and Telegram login | Slice 2. See section 10                                                             |
| Seasonal rates                        | One price per house until the owner asks for more                                   |
| More than one owner                   | There is one. A second changes login, not the model                                 |
| Channel sync (Avito, Booking)         | Nothing to sync with yet                                                            |
| Minimum stay, booking horizon         | The engine deliberately left these to its caller, and no rule exists yet to enforce |

---

## 2. Boundaries and stack

### What each side owns

The engine owns everything about **whether a night is free**: slots, availability, overlap
prevention, holds, the booking's existence and its times. This project owns everything about
**who and how much**: the guest, the price, the add-ons, the deposit.

Two houses are two rows here, each carrying an `engine_resource_id`. Nothing about occupancy
is copied — section 4 explains why that is the load-bearing decision of the whole design.

### Stack

Server: Node 24, TypeScript strict, Fastify 5, TypeBox, Kysely + `pg`, Postgres 16, Vitest +
Testcontainers, Playwright. The same as the engine, because its conventions are already
written down and proven; a different stack would mean re-deciding every settled question for
no gain.

Client: React + Vite + TypeScript, React Router, TanStack Query for server state. The last is
not decoration: every booking change must invalidate the calendar, and hand-rolled `useState`
around that is a reliable source of stale-view bugs.

Layout: npm workspaces, `server/` and `web/`. In production Fastify serves the built SPA
through `@fastify/static`; in development Vite proxies `/api`. One deployable, no CORS.

### The calendar is hand-rolled, deliberately

Calendar libraries model **days**. The unit here is a **night**: a stay from the 20th to the
22nd occupies two nights, and the 22nd is free from the morning for the next arrival. A
library renders the departure day as occupied, so two bookings meeting on one date look like
a conflict and the owner cannot see that the house is available.

A month grid over nights is less code than arguing with that, and it matches the engine's own
half-open semantics exactly.

---

## 3. The engine client

### Types are generated

The engine serves OpenAPI 3.1 at `/docs/json`, generated from the same TypeBox schemas its
routes validate against, with a test that fails when a route is missing from the document.
That is a machine-readable contract another repository's CI already guards.

`openapi-typescript` turns it into `server/src/engine/schema.d.ts`, which is **committed**.
`npm run engine:types` regenerates it; CI runs the same command and fails on a diff, so "the
engine changed its contract" is a red build rather than a surprise in production.

Hand-writing those types would create a second copy of the contract that drifts silently —
TypeScript would keep checking confidently against a stale truth.

### A thin facade over the generated types

Application code says `engine.book(houseId, nights, guest)`, not assemble paths. The facade is
the only place three things live.

**The key.** Read from the environment, put into `Authorization`. Named nowhere else.

**Error translation.** The engine's `{ error, message, details }` codes mean different things
to us:

| Engine                       | What this project does                                                                       |
| ---------------------------- | -------------------------------------------------------------------------------------------- |
| `409 slot_unavailable`       | The nights were taken between rendering and saving — tell the owner, refetch the calendar    |
| `400 outside_schedule`       | The house is closed then; an input error, not a fault                                        |
| `400 invalid_slot_boundary`  | Our date arithmetic is wrong — log as a defect, not a user error                             |
| `409 idempotency_key_reused` | Same key, different booking: a defect on our side                                            |
| `503 concurrent_update`      | Retry with backoff; the engine refuses to retry on purpose, leaving the choice to its caller |
| `429 rate_limited`           | Back off and retry                                                                           |
| `401 unauthorized`           | The key was revoked or the tenant disabled — an operational alert, not an input error        |

**Idempotency.** The engine accepts an `idempotency_key` and answers a replay with `200`
instead of `201`. The facade mints one per create attempt and reuses it across retries, so a
dropped connection cannot produce a second booking on the same nights.

### Built from configuration, injected like the database

`createEngineClient({ engineUrl, engineApiKey, timeoutMs, maxAttempts })` takes everything it
needs as arguments and reads no environment of its own. `server.ts` builds it from the one
validated `Config` and passes it into `buildApp`, which decorates it onto the Fastify instance
beside `db`; routes reach for `app.engine` and never for `process.env`.

This matters for more than tidiness. A module that reads its own environment can only be
tested against the environment, so the integration suite would have no seam to hand in a
stubbed engine — and "the engine is unreachable" is a case that must be tested, not hoped for.

### What the facade does not do

It does not cache availability. A cache would show the owner a stale picture at the exact
moment they are deciding whether a guest fits.

It does not keep a copy of bookings. Duplicated state across two systems is a source of
disagreement, not of resilience.

---

## 4. Data model and the life of a booking

### No dates, no status, stored here

```
houses              id · engine_resource_id · name · price_per_night
house_addon_prices  id · house_id · code · label · default_price
guests              id · name · phone (unique) · note
booking_details     id · engine_booking_id (unique) · guest_id ·
                         price_per_night · addons_snapshot · deposit · note
```

`booking_details` holds what the engine does not know. The house and the dates come from the
engine, joined on `engine_booking_id`.

This is not brevity. A rescheduled booking cannot disagree with a local copy of its dates
because there is no local copy — a whole class of drift is removed by construction rather
than by discipline.

Two names were considered and rejected. `bookings` would claim ownership of occupancy, which
belongs to the engine and to nothing here. `booking_session` collides with `sessions`, which
already means a login in this database, and it promises a span of time in the one table
defined by holding none.

### Prices are snapshots

`price_per_night` and each add-on's price are copied onto the booking when it is created.
Referencing the house's current price would mean that raising the rate in March rewrites the
total of a January booking, and the owner would see a debt that does not exist.

All money is integer minor units. No float anywhere near a total.

### The engine is written first

There is no distributed transaction, so the order decides which way the system breaks.

**Engine first, then the local row.** If the local write fails, a booking exists with no guest
details: the night is correctly held, the name and the amount are missing. The calendar shows
such a booking explicitly and the owner fills it in.

The reverse order would leave a record for a booking that **does not hold the night** — the
one genuinely expensive failure in this domain.

### Why not the hold flow

The tempting alternative is `hold: true`, write locally, then `confirm`, so a failed local
write lets the hold lapse and frees the night.

Rejected. A freed night is the _worse_ outcome: the owner saw an error, assumed they would
redo it, and ten minutes later the night quietly became available for someone else. An orphan
booking preserves the owner's intent and asks loudly to be repaired.

### Cancel and reschedule

Both are an engine call and nothing else. No status is stored, so there is nothing local to
update; a cancelled booking keeps its `booking_details` as history.

### Orphans in both directions

Joining on `engine_booking_id` produces two mismatches, and both are shown rather than hidden:

- **A booking in the engine with no details here** — the failure above; repaired by filling
  it in.
- **A row here with no booking in the engine** — only possible if someone called the engine
  around this project; flagged so it does not look like lost money.

### The guest

The phone is normalised and unique; it _is_ the guest's identity. History is
`booking_details` by `guest_id`, joined with dates from the engine. There is no history table.

### Add-ons exist twice, on purpose

An add-on appears in two shapes, and they overlap almost entirely:

|                | Where                             | Fields                                         |
| -------------- | --------------------------------- | ---------------------------------------------- |
| The price list | `house_addon_prices`              | `id · house_id · code · label · default_price` |
| The snapshot   | `booking_details.addons_snapshot` | `code · label · price`                         |

The overlap is the point, not redundancy: a snapshot _is_ a copy of the price list at the
moment of sale. It is the same pattern as `houses.price_per_night` beside
`booking_details.price_per_night` — one is current, one is frozen — and merging either pair
would mean that raising a rate in March rewrites a January total.

The price list is named for what it is. `house_addons` invited the reading that the two shapes
were one thing stored twice; `metadata` would have been worse still, because these rows carry
money, and `metadata` is the word for data that does not.

### One judgement call

`house_addon_prices` is a table although it currently holds two rows. It could be a pair of
columns on `houses`. The table is chosen because "each house has its own set of extras" is its
natural shape, so a third house with two extras needs no migration. This is recorded as a
judgement call, not a certainty.

---

## 5. Login

One user, so there is no registration: the password is set by `npm run owner:password`, and a
signup form would be dead code. The hash is argon2id — this is a human password, unlike the
engine's API keys, where SHA-256 is correct precisely because the secret has full entropy.

The session is a row in Postgres, not a JWT, for one reason: **revocation**. A lost phone means
"sign out everywhere", which with a JWT would need a blocklist — the same table, arrived at
the hard way.

### One owner today, more later

```
owners    id · label · password_hash
sessions  id · owner_id → owners · token_hash · expires_at · last_seen_at
```

There is one owner now and there will probably be more. The table is therefore `owners` with
an ordinary primary key rather than a single hashed secret pinned to `id = 1`: a row that
cannot be joined to is a row that has to be rewritten the day a second person appears.

The part worth paying for now is `sessions.owner_id`. A table is cheap to reshape; adding a
`not null` foreign key to a live sessions table is not — it means a backfill, or signing
everybody out to get one.

Login does not change. There is no username field, and the route reads the single `owners`
row; finding two is an error, loudly, and that error is exactly the signal that it is time to
add an identifier. Which identifier is deliberately left open: slice 2 replaces this password
with Telegram, so the second owner's identity is more likely a `telegram_user_id` than a
username, and building the username flow today would probably be building the wrong one.

Cookie `httpOnly`, `Secure`, `SameSite=Lax`, 30 days with sliding renewal. The tool is opened
from a phone every few days; a weekly password prompt protects nothing and annoys reliably.

Because it faces the internet: a rate limit on the login route by IP, and an `Origin` check on
every state-changing request — the same ten lines as the engine's console. `SameSite=Lax`
covers most of it; the `Origin` check covers the rest.

HTTPS is not optional — a `Secure` cookie does not work without it, and the failure is silent:
the owner signs in successfully and is signed out on the next request, which reads as a broken
login rather than a missing certificate.

Which terminator provides it is left open on purpose. Naming one in the repository ships a
configuration file for a tool the owner may never have run, and an unexplained config file is
a liability at exactly the moment something breaks. The requirement belongs in the README; the
choice belongs to whoever deploys.

There is no password reset. The owner is one person and the recovery channel is that CLI
command on the server. Slice 2 moves login to Telegram and this disappears.

---

## 6. The calendar

### One timeline over both houses

Rows are houses, columns are the nights of the month. The owner sees both at a glance and
notices that only the second house is free on Saturday. Two separate month calendars force
that comparison to happen in the reader's head.

### Nights, and it shows in the rendering

A booking is drawn as a bar over the half-open interval `[check-in, check-out)`: the bar stops
at the left edge of the departure day. So the 22nd, when the guest leaves in the morning, is
visibly free and the next arrival can be placed on it — bars meet, they do not overlap.

This is the reason section 2 refuses a calendar library.

### Selection and data

Dragging across free nights opens the booking form with the range filled in. Occupied nights
cannot be included in a selection.

A month costs three requests: `GET /bookings?from&to` returns both houses' bookings at once,
plus `GET /availability` per house for which nights are offered at all, honouring closed dates.

There are no optimistic updates. Every change invalidates and refetches. Showing the owner a
stale calendar at the moment they decide whether a guest fits is the one case where an instant
response is worse than the truth.

### The timezone trap

The engine returns timestamps carrying the house's offset: `2026-09-01T15:00:00+02:00`. Grid
dates are derived **from that offset**, never through `new Date()` in the browser. Otherwise an
owner opening the calendar from another timezone sees every booking shifted by a day — a bug
noticed a month later, through a guest's complaint.

---

## 7. When the engine is unreachable

**The calendar does not render; an explicit error does.** Never an empty grid: an empty
calendar reads as "everything is free", and the owner puts a guest into an occupied night. Of
every state this interface can be in, that is the only one that costs money.

There is no availability cache (section 3), so a failed engine cannot be ridden out even for
reads. Accepted deliberately: a stale cache would tell the same lie more convincingly.

Every engine call carries a five-second timeout. A hung engine otherwise hangs this request and
the owner watches a spinner with no explanation; an expired timeout is the same error as
unreachability.

`503` and `429` are retried with backoff inside the facade. `401` is not retried — the key was
revoked or the tenant disabled, and the message must say so, or the owner will spend half an
hour reloading the page.

### Totals depend on the engine, and should

The total is computed on read: `price per night × nights + add-ons`, where the night count
comes from the engine. So outstanding balances are unavailable while the engine is.

Storing `total` on the booking is rejected: rescheduling from two nights to three must change
the amount, and a stored total would have to be recomputed on every path that moves a booking
— one of which will eventually forget.

---

## 8. Testing

The interesting defects are not in this project's arithmetic; they are at the seam — the
half-open night interval, two bookings meeting on a departure date, the timezone, a real `409`
under a race. A stub reproduces the shape of the engine's answers and none of those behaviours.

So the test environment brings up the engine itself: its image at a pinned tag, its Postgres
and its console, with the API key issued through the console exactly the way the engine's own
`./run smoke` does.

**Unit** — money in minor units and the outstanding balance, phone normalisation, night
arithmetic over the half-open interval, extracting a grid date from an offset-carrying
timestamp.

**Integration** — this project's Postgres plus a live engine: creating a booking, the orphan
left by a failed local write, cancel, reschedule changing the total, the join on
`engine_booking_id`, and every row of the error table in section 3.

**UI (Playwright)** — dragging across free nights, two bookings meeting on a departure date,
login and session expiry, and one scenario that **stops the engine container and asserts the
calendar shows an error rather than an empty grid**. The harness owns that container, which
makes the case cheap here — in the engine the equivalent was deliberately moved out of the
browser because stopping the shared database would have broken every following case.

---

## 9. Configuration

| Variable            | Meaning                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`      | This project's own database, not the engine's                                                                            |
| `ENGINE_URL`        | Where the engine answers                                                                                                 |
| `ENGINE_API_KEY`    | A **Site backend** preset key: `availability.read`, `resources.read`, `bookings.read`, `bookings.write`, `bookings.list` |
| `ENGINE_TIMEOUT_MS` | How long a call to the engine may hang. Default 5000                                                                     |
| `PORT`              |                                                                                                                          |
| `SESSION_TTL_DAYS`  | Default 30                                                                                                               |

The key is issued in the engine's console and pasted here once. It never reaches the browser.

---

## 10. Recorded for later

- **Slice 2 — Telegram.** A bot for check-in and check-out reminders, unpaid balances, and
  login in place of the password. Chosen as one integration covering both; kept out of slice 1
  so that the most basic action — opening the calendar — does not depend on an external
  service.
- **The key must never reach a browser.** Section 2 of the engine's spec 4 explains what breaks
  otherwise: minimum stay and booking horizon are enforced here, and that is sound only while
  this server is the engine's only caller.
- **A second owner** changes login and adds an ownership column; it does not change the model.
- **Seasonal rates** would turn `houses.price_per_night` into a table of dated rates. The
  snapshot on the booking already makes that change safe for existing bookings.
