# Architecture

This document is **authoritative for what the system does today**. Where it disagrees with a
spec in [superpowers/specs/](superpowers/specs/) or an archived plan, this document is right
and the other is stale: a spec states what was decided on its date and is not revised to match
later work. Closing such a gap means correcting this document, not consulting the spec.

This document covers what the system does. Two others complete the onboarding path, and nothing
else has to be read: [../README.md](../README.md) for running, configuring and deploying it, and
[../CONTRIBUTING.md](../CONTRIBUTING.md) for the conventions code here is written to.

The specs in [superpowers/specs/](superpowers/specs/) are **decision records**. Read one to
learn _why_ something has the shape it does, never to learn what it does. The executed plans
in [superpowers/plans/archive/](superpowers/plans/archive/) are spent scaffolding, kept for
provenance and outside the reading path.

The booking engine's own documentation is the contract this project consumes, and it is
authoritative on its own terms: [architecture](../../booking-engine/docs/architecture.md) for
its data model and API, [conventions](../../booking-engine/docs/conventions.md) for error
shapes, time rules and the scope table. Its rules are not restated here except where this
project departs from them.

---

## 1. What this is

One owner rents two houses by the night. This is the journal: a live calendar of both houses,
the bookings made through the engine, and the guest, price, add-ons and deposit the engine
deliberately knows nothing about.

House one offers a sauna, house two a hot tub. Both come with the house and cost extra;
neither has a schedule of its own. That is exactly why the engine knows nothing about them —
they are not bookable units, they are a line on a bill, and the bill lives here.

### The split

|                    | This repository                              | `../booking-engine`                  |
| ------------------ | -------------------------------------------- | ------------------------------------ |
| Owns               | guests, money, add-ons, notes                | slots, availability, bookings, holds |
| Stores dates       | **never**                                    | yes, and they are the truth          |
| Knows about houses | names, prices, which add-on each has         | nothing — a resource is opaque       |
| Users              | one owner, from the internet, phone included | any tenant's backend, by API key     |
| Deployed           | its own service and database                 | its own service and database         |

### The four invariants

Everything below is an elaboration of these. A change that breaks one is wrong.

**The engine API key never reaches a browser.** It lives in this server's environment and is
named in exactly one file, `server/src/engine/client.ts`. The SPA talks only to this server and
has no idea the engine exists. A Playwright journey asserts it, reading every document, script
and API response the page receives and failing if `bk_live_` appears in any of them. It matters
because rules enforced on the way through are only real while this server is the sole caller.

**The engine is the single source of truth for occupancy.** No dates and no booking status are
stored here, so these records cannot drift from the engine's. Rendering joins the two by
`engine_booking_id`, and a migration test asserts those columns do not exist.

**Writes go to the engine first, then here.** A failure that way round leaves a booking whose
guest details are missing — annoying, visible and repairable. The reverse order can leave a
record that does not actually hold the night, which is how two guests end up in one house.

**An unreachable engine renders an error, never an empty calendar.** An empty grid reads as
"everything is free", and the owner puts a guest into an occupied night.

### Stack and layout

Server: Node 24, TypeScript strict, Fastify 5, TypeBox, Kysely + `pg`, Postgres 16, Vitest +
Testcontainers. Client: React + Vite, React Router, TanStack Query. npm workspaces, `server/`
and `web/`. In production Fastify serves the built SPA through `@fastify/static`; in
development Vite proxies `/api`. One deployable, one origin, no CORS.

The stack matches the engine's because its conventions are already written down and proven; a
different one would mean re-deciding every settled question for no gain.

---

## 2. The engine client

### The contract is generated

`server/src/engine/schema.d.ts` comes from the engine's OpenAPI document at `/docs/json`, which
the engine generates from the same TypeBox schemas its routes validate against. `npm run
engine:types` regenerates it and it is committed. Never hand-edit it, and never hand-write a
parallel copy — a second copy of a contract drifts silently while TypeScript keeps checking
confidently against a stale truth.

It is listed in `.prettierignore` on purpose: formatting it here would leave the repository
permanently one regeneration away from a diff, which is the signal that means "the engine
changed its contract".

### A facade over the generated types

`server/src/engine/client.ts` exposes `getResource`, `listResources`, `listBookings`,
`getBooking`, `availability`, `createBooking`, `reschedule` and `cancel`. Application code says
`engine.createBooking(...)`, never assembles a path.

`createEngineClient({ engineUrl, engineApiKey, timeoutMs, maxAttempts })` takes everything as
arguments and reads no environment of its own. `server.ts` builds it from the one validated
`Config` and hands it to `buildApp`, which decorates it onto the Fastify instance beside `db`;
routes reach for `app.engine` and never for `process.env`. This is what gives the integration
suite a seam to point a client at a dead port — "the engine is unreachable" is a case that must
be tested, not hoped for.

### Dates become instants, which needs the resource

The engine anchors each day-long slot at a wall-clock time in the resource's own zone — 15:00
for these houses — and rejects any interval that does not land on a boundary. A midnight
timestamp is therefore not a valid check-in.

So before a `YYYY-MM-DD` can be sent, the client reads the resource's `timezone` and
`slot_anchor_time` and places the date at that anchor using `luxon`. Resources are cached in
memory per client; the cache cannot go stale because the engine makes `timezone` immutable.

### Error translation

The engine's `{ error, message, details }` codes mean different things here. Classification
lives in `server/src/engine/errors.ts` and translation in `server/src/shared/errors.ts` — in
one place rather than per route, because a route that forgets reports an outage as a `500`,
which for the calendar is the difference between "we cannot tell you" and "everything is free".

| Engine answer                                                                                                               | What this project does                                            |
| --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `slot_unavailable`, `outside_schedule`, `resource_inactive`, `invalid_state_transition`, `hold_expired`, `invalid_interval` | Owner-facing: the engine's own code and status are passed through |
| `503 concurrent_update`, `429 rate_limited`                                                                                 | Retried in the facade, linear backoff, three attempts             |
| `401 unauthorized`                                                                                                          | `502 engine_rejected_our_key` and an error log. Never retried     |
| Anything else                                                                                                               | `502`, naming the engine, and an error log                        |
| No answer at all — refused, DNS, or our timeout                                                                             | `503 engine_unreachable` and an error log                         |

The owner-facing / not-owner-facing split is the point: it decides whether the interface shows
an explanation or an apology. A defect here is never dressed up as the owner's mistake.

Retries are linear because contention is two of the owner's own tabs, not a herd. The engine
reports contention as `503` and explicitly does not retry, leaving the choice to its caller.

### Timeouts

Every call carries `ENGINE_TIMEOUT_MS`, default 5000. A hung engine would otherwise hang the
request and the owner watches a spinner with no explanation. An expired timeout is the same
error as unreachability.

### Idempotency

`createBooking` takes an idempotency key, minted per attempt by the booking service. The engine
answers a replay with `200` instead of `201`, so a dropped connection cannot produce a second
booking on the same nights.

### What the facade does not do

It does not cache availability — a cache would show the owner a stale picture at the exact
moment they are deciding whether a guest fits. It does not keep a copy of bookings — duplicated
state across two systems is a source of disagreement, not of resilience.

It also does not send `customer_id`, although the engine offers it. The engine has no endpoint
to change it, so a booking reassigned to another guest could never be corrected there; the
guest link belongs where it can be fixed.

---

## 3. Data model

```
houses              id · engine_resource_id · name · price_per_night · checkout_time · created_at
house_addon_prices  id · house_id · code · label · default_price
guests              id · name · phone (unique) · note · created_at
booking_details     id · engine_booking_id (unique) · guest_id · price_per_night ·
                         addons_snapshot · currency · deposit · note · created_at · updated_at
owners              id · label · password_hash · created_at · updated_at
sessions            id · owner_id → owners · token_hash · expires_at · created_at · last_seen_at
settings            id · currency · created_at · updated_at
```

Defined in `server/src/db/schema.ts`, migrated in `server/src/db/migrations/`.

**No dates, no status, stored here.** `booking_details` holds only what the engine does not
know. The house and the dates come from the engine, joined on `engine_booking_id`. A rescheduled
booking cannot disagree with a local copy of its dates because there is no local copy — a whole
class of drift removed by construction rather than by discipline.

The table is not called `bookings`: that name would claim ownership of occupancy, which belongs
to the engine and to nothing here.

**Prices are snapshots.** `price_per_night` and each add-on's price are copied onto the booking
at creation and never read live again. Referencing the house's current price would mean raising
the rate in March rewrites the total of a January booking, and the owner would see a debt that
does not exist.

**All money is integer minor units.** No float anywhere near a total; `server/src/shared/money.ts`
rejects a non-integer. Whole units are converted exactly once, at the edge of an input in
`web/src/money.ts`.

**The currency is a setting, and also a snapshot.** `settings.currency` is what a price entered
now means; `booking_details.currency` is what a booking already made meant, and nothing rewrites
it — the same argument as `price_per_night`, for the same reason. Switching the setting converts
nothing: 65000 stays 65000 and starts rendering with another symbol, so the owner re-prices the
houses afterwards. The alternative, an FX rate applied on read, would make a settled total drift
with the market.

The list of currencies lives in `server/src/shared/currency.ts` and is served to the browser by
`GET /api/settings`; the web workspace keeps no copy, because a second copy of that table drifts
and the first sign of it is a price wearing the wrong symbol. Every entry must divide into 100
minor units — a unit test checks each against `Intl`, so admitting JPY (which has none) fails the
suite rather than silently reinterpreting every integer in the database. The database check
constraint tests only the _shape_ of a code; membership is decided by a TypeBox enum at the
route, so adding a currency is one line and no migration.

Amounts in different currencies are never added. A guest's outstanding balance is rendered one
figure per currency (`owedByCurrency` in `web/src/money.ts`), because a guest who stayed before
a switch and again after owes two sums and no single number is either of them.

**Add-ons exist in two shapes on purpose.** `house_addon_prices` is the current price list;
`booking_details.addons_snapshot` is a copy of it at the moment of sale. The overlap is the
point, not redundancy — the same pattern as `houses.price_per_night` beside
`booking_details.price_per_night`, one current and one frozen. Merging either pair would mean a
March rate change rewrites a January total.

`house_addon_prices` is a table although it holds two rows today. "Each house has its own set of
extras" is its natural shape, so a third house needs no migration. Recorded as a judgement call,
not a certainty.

---

## 4. The life of a booking

### Creation, engine first

`BookingService.create` in `server/src/modules/bookings/booking.service.ts`:

1. Load the house; snapshot the requested add-ons from its current price list. Only the **code**
   is accepted from the caller — the label and the price are copied from the house, so a booking
   cannot be created at a price the owner never set.
2. Validate the nights and the arithmetic before anything is written, so a bad request never
   reaches the engine. The pure helpers throw plain `Error`s, and this is where they become a
   `400` rather than a `500` — an inverted date range is a typo, not a fault of ours.
3. Find or create the guest by normalised phone.
4. **Call the engine.** A fresh idempotency key per attempt.
5. Insert `booking_details`.

If step 5 fails, a booking exists whose guest details are missing: the night is correctly held
and the calendar shows it as an orphan for the owner to repair.

The hold flow — `hold: true`, write locally, then confirm — was rejected. A freed night is the
worse outcome: the owner saw an error, assumed they would redo it, and ten minutes later the
night quietly became available for someone else. An orphan preserves the owner's intent and
asks loudly to be repaired.

### Reschedule, cancel, amend

**Reschedule** and **cancel** are an engine call and nothing else. No dates and no status are
stored here, so there is nothing local to update and a move cannot leave the two systems
disagreeing. A cancelled booking keeps its `booking_details` as history.

**Amend** — deposit and note — touches only this database. The engine is not involved and must
not be called.

### Orphans in both directions

Joining on `engine_booking_id` produces two mismatches. Both are shown, never hidden, because a
hidden booking is a night the owner believes is free:

- **A booking in the engine with no details here** — rendered with nulls and `orphan: true`.
  The failure above; repaired by filling it in.
- **A row here with no booking in the engine** — only possible if something called the engine
  around this project. It simply does not appear in a calendar assembled from the engine's
  listing, and `forGuest` drops it rather than inventing dates for it.

### Totals are computed on read

`price per night × nights + add-ons`, where the night count comes from the engine. Balance is
`total − deposit`, and it is **not clamped**: negative means the guest has overpaid, which is a
fact the owner needs to see.

Storing `total` is rejected: rescheduling from two nights to three must change the amount, and a
stored total would have to be recomputed on every path that moves a booking — one of which will
eventually forget. The consequence is accepted: outstanding balances are unavailable while the
engine is.

---

## 5. Houses

A house is two things: a **resource** in the engine, which owns whether its nights are free, and
a **row here**, which owns its name, price, check-out time and extras.

The currency those prices are in is app-wide rather than per house, and the selector sits on the
Дома screen because that is the only place prices are set. Per-house currencies were considered
and rejected: the calendar puts both houses on one timeline, so every total spanning them would
need splitting by currency for a case that does not exist while both houses are in one country.

`./run house:add` creates both in one step, so no resource id is ever handled by hand. The shape
it creates — `slot_duration: P1D`, `capacity: 1`, `concurrency_mode: exclusive`, open every day
— is stated once in `server/src/engine/house-resource.ts`, which the setup command and the test
harness both go through, so the shape the tests prove is the shape production creates.

That command needs `resources.write` and `schedule.write`, which the running service deliberately
does not have. It asks for a wider key, uses it once and forgets it: an internet-facing service
should not be able to delete the tenant's resources for the rest of its life in order to save a
step taken twice.

### Check-in is the engine's, check-out is ours

Check-in **is** the slot boundary — the instant a night begins — so it lives in the engine as
`slot_anchor_time` and is read, never copied. A local copy would be a second answer to a
question the engine owns.

Check-out is information for the guest and nothing more. A guest leaving at 11:00 leaves inside
the slot that ends at check-in, so the gap is turnaround and availability knows nothing about
it. That is why `houses.checkout_time` is an ordinary editable column on the Дома screen and
check-in is not.

Moving check-in re-cuts every boundary, so a booking made under the old one would straddle two
new slots: availability would show two nights taken instead of one. `./run house:checkin` does
it anyway when you must, and `server/src/modules/houses/checkin.ts` refuses while the house has
a booking from today onward that is neither cancelled nor expired. Past stays do not matter —
their nights are behind us and nobody is deciding anything from them.

Listing houses reads check-in from the engine **best-effort**: if the engine cannot be reached
the houses still list, with check-in null. Renaming a house or fixing a price should not require
the engine to be up, and unlike the calendar there is nothing here that a missing value makes
dangerous.

---

## 6. Guests

The phone is normalised and unique; it **is** the guest's identity. `8 912 …` and `+7 912 …`
must reduce to one value, or the same person accumulates two histories and the owner sees
neither in full. Only the Russian leading `8` is rewritten — everything else keeps the country
code it was given.

History is `booking_details` by `guest_id`, joined with dates from the engine one booking at a
time, newest first. A guest has a handful of stays, not a page of them. There is no history
table.

---

## 7. Login and sessions

One user, so there is no registration: the password is set by `./run owner:password`, and a
signup form would be dead code. The hash is argon2id — this is a human password, unlike the
engine's API keys, where SHA-256 is correct precisely because the secret has full entropy.

The session is a row in Postgres, not a JWT, for one reason: **revocation**. A lost phone means
"sign out everywhere", which with a JWT would need a blocklist — the same table, arrived at the
hard way.

`owners` has an ordinary primary key rather than a secret pinned to `id = 1`, and
`sessions.owner_id` exists from the first migration. A table is cheap to reshape; adding a
`not null` foreign key to a live sessions table is not. Login asks for the password alone and
reads the single row; finding two is a loud error, and that error is exactly the signal that it
is time to add an identifier — deliberately left open, because slice 2 replaces this password
with Telegram and a `telegram_user_id` is likelier than a username.

The cookie is `httpOnly`, `SameSite=Lax`, `Secure` in production, 30 days by default with
sliding renewal. Renewal writes at most once an hour rather than on every request: a write on
every read turns a read-only page into write traffic. The tool is opened from a phone every few
days, so a weekly password prompt would protect nothing and annoy reliably.

The SPA never reads the cookie to decide whether it is signed in — it asks `GET /api/me`. The
cookie is `httpOnly`, and a client-side guess would eventually disagree with the server that
decides.

Because this faces the internet: a rate limit on the login route by IP
(`LOGIN_ATTEMPTS_PER_MINUTE`, default 10), and an `Origin` check on every state-changing
request, compared against the host the request was addressed to so it keeps working behind a
proxy and on an ephemeral test port. A wrong password and an unconfigured server produce the
same answer **and** the same timing — a dummy hash is verified when no owner exists, so the
absence of a password is not readable from the clock.

Only `/api/` is guarded. The SPA's HTML, bundle and assets load without a session: the page is
what shows the login form, so protecting it would mean the owner is answered `401` by the very
screen that exists to fix that. `/api/health` and `/api/login` are explicitly public.

There is no password reset. The owner is one person and the recovery channel is that CLI command
on the server.

---

## 8. The calendar

### One timeline over both houses

Rows are houses, columns are the nights of the month. The owner sees both at a glance and
notices that only the second house is free on Saturday. Two separate month calendars would force
that comparison to happen in the reader's head.

### Nights, not days — and it is hand-rolled for that reason

Calendar libraries model **days**. The unit here is a **night**: a stay from the 20th to the 22nd
occupies two nights, and the 22nd is free from the morning for the next arrival. A library
renders the departure day as occupied, so two bookings meeting on one date look like a conflict
and the owner cannot see that the house is available.

A booking is drawn as a bar over the half-open interval `[check-in, check-out)` — the bar stops
at the left edge of the departure day, so bars meet and never overlap. A month grid over nights
is less code than arguing with a library, and it matches the engine's own half-open semantics
exactly.

### The timezone rule

The engine returns timestamps carrying the house's offset: `2026-09-01T15:00:00+02:00`. The
first ten characters already **are** the local date, and `localDate` in
`server/src/shared/nights.ts` takes them by regex. Parsing into a `Date` and asking it for a
date would answer in the reader's zone instead, and an owner travelling one zone west would see
every booking move by a day — a bug noticed a month later, through a guest's complaint.

The same rule holds in the browser: `web/src/calendar/nights.ts` treats dates as plain strings
and never constructs a `Date` for arithmetic on a stay.

### Requests and freshness

A month costs one `GET /api/calendar?from&to`, which the server assembles from the engine's
booking listing plus availability per house, and this project's rows. The window is capped at
366 nights, matching the bound the engine puts on its own listings — refusing here with a clear
message beats forwarding a request the engine will reject anyway.

Dragging across free nights opens the booking form with the range filled in; occupied nights
cannot be included in a selection.

There are no optimistic updates. Every change invalidates and refetches. Showing the owner a
stale calendar at the moment they decide whether a guest fits is the one case where an instant
response is worse than the truth.

### Screens

`/` calendar · `/guests` · `/houses` (Дома — prices, add-ons, check-out time) · `/login`.
Anything else redirects to `/`. Unknown server paths fall through to `index.html`, so a
client-side route survives a reload.

---

## 9. When the engine is unreachable

The calendar does not render; an explicit error does, with a retry. Of every state this
interface can be in, an empty grid is the only one that costs money.

There is no availability cache (§2), so a failed engine cannot be ridden out even for reads.
Accepted deliberately: a stale cache would tell the same lie more convincingly.

The two operational failures — `503 engine_unreachable` and `502 engine_rejected_our_key` — are
logged at error level even though the answer to the owner is a clean one. `401` is never
retried: the key was revoked or the tenant disabled, and the message must say so, or the owner
will spend half an hour reloading the page.

The engine key is redacted from logs, along with the session cookie: it travels in
`authorization` on every outbound call, and a logged request from a debugging session would
outlive the key it belongs to.

---

## 10. HTTP surface

Every route is under `/api`. Bodies are TypeBox with `additionalProperties: false` — unknown
fields are rejected, never ignored. Errors keep the shape `{ error, message, details? }`.

| Route                               | Notes                                                         |
| ----------------------------------- | ------------------------------------------------------------- |
| `GET /api/health`                   | Public                                                        |
| `POST /api/login`                   | Public, rate-limited per IP. Sets the session cookie, `204`   |
| `POST /api/logout`                  | Clears it, `204`                                              |
| `GET /api/me`                       | The session check the SPA uses                                |
| `GET /api/calendar?from&to`         | Both houses' nights and bookings, assembled from both systems |
| `POST /api/bookings`                | Engine first. `201`                                           |
| `GET /api/bookings/:id`             | By `engine_booking_id`                                        |
| `POST /api/bookings/:id/reschedule` | Engine only                                                   |
| `POST /api/bookings/:id/cancel`     | Engine only                                                   |
| `PATCH /api/bookings/:id`           | Deposit and note. This database only                          |
| `GET /api/houses`                   | Check-in read from the engine, best-effort                    |
| `POST /api/houses`                  | Verifies the resource exists and is not already claimed       |
| `PATCH /api/houses/:id`             | Name, price, check-out time, add-on price list                |
| `GET /api/settings`                 | The currency in force, and the list on offer                  |
| `PATCH /api/settings`               | Changes the currency. Converts nothing                        |
| `GET /api/guests?phone`             | Lookup by normalised phone                                    |
| `GET /api/guests/:id`               |                                                               |
| `GET /api/guests/:id/bookings`      | History, newest first                                         |
| `POST /api/guests`                  |                                                               |
| `PATCH /api/guests/:id`             |                                                               |

---

## 11. Testing

The interesting defects are not in this project's arithmetic; they are at the seam — the
half-open night interval, two bookings meeting on a departure date, the timezone, a real `409`
under a race. A stub reproduces the shape of the engine's answers and none of those behaviours.

So the suite brings up **the engine itself**: its image, its Postgres and its console, with the
API key issued through the console the way the engine's own smoke test does. `./run test`
truncates only this project's tables between cases — the engine keeps its bookings for the whole
run, so a test that needs free nights books its own window.

**Unit** (`server/tests/unit/`) — money and balance, phone normalisation, night arithmetic over
the half-open interval, extracting a grid date from an offset-carrying timestamp, config
validation, engine error classification, password hashing.

**Integration** (`server/tests/integration/`) — this project's Postgres plus a live engine:
creating a booking, the calendar join, amend, guests, houses, the check-in guard, the engine
client itself, migrations, and an app pointed at a dead port asserting the shape of the failure.

**UI** (`tests/ui/`, Playwright, whole product) — the calendar, login and session expiry, houses
and guests, and the journey that asserts `bk_live_` never appears in anything the browser
receives.

---

## 12. Configuration and deployment

Both live in [../README.md](../README.md): the variable table, how the engine key is issued, and
why the deployment must be reached over HTTPS. They are operator concerns, and repeating them
here would create a second copy to keep in step.
