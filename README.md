# cabins-admin

The owner's journal for a two-house nightly rental: a live calendar of both houses, bookings
made through the booking engine, and the guest, price, add-ons and deposit the engine
deliberately knows nothing about.

It is a **consumer** of [`../booking-engine`](../booking-engine), never a replacement for it.
The engine owns availability and bookings; this project owns people and money.

## Documentation

**Start here.** These three are authoritative, and together they are the whole onboarding path:

| Document                                     | What it holds                                                            |
| -------------------------------------------- | ------------------------------------------------------------------------ |
| [docs/architecture.md](docs/architecture.md) | The system: the engine client, the data model, bookings, calendar, login |
| [CONTRIBUTING.md](CONTRIBUTING.md)           | How we write code here: conventions, commits, and what a slice must do   |
| This file                                    | Running it, configuring it, deploying it                                 |

Read the third only if you are running it, and the second only if you are changing it.

Reference, consulted rather than read through:

| Document                                                           | What it holds                                                                        |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| [CLAUDE.md](CLAUDE.md)                                             | The invariants and a pointer to the above, addressed to an agent in the repository   |
| [server/src/engine/schema.d.ts](server/src/engine/schema.d.ts)     | The engine's contract, generated from its OpenAPI. Never hand-edited                 |
| [docs/superpowers/specs/](docs/superpowers/specs/)                 | Decision records, one per slice — read for _why_, never for what                     |
| [docs/superpowers/plans/archive/](docs/superpowers/plans/archive/) | The task-by-task plans that built each slice. Spent scaffolding, kept for provenance |

Where a spec or an archived plan disagrees with `docs/architecture.md`, the architecture
document is right and the older one is stale: correct the architecture document, do not go and
consult the spec.

## Before the first run

The engine must be running before any of this. The calendar cannot say which nights are free
without it, and `./run` refuses to start rather than open an empty one.

```bash
(cd ../booking-engine && ./run dev --bg)
```

Then, once, in this order:

| Step                   | What it does                                                              |
| ---------------------- | ------------------------------------------------------------------------- |
| `cp .env.example .env` | `./run` does this for you on the first run                                |
| paste `ENGINE_API_KEY` | A **Site backend** key, issued in the engine's console — see below        |
| `./run migrate`        | Creates the tables, and nothing else                                      |
| `./run owner:password` | The password you sign in with. Until it is set, every password is refused |
| `./run house:add`      | Once per house. Asks for a wider engine key                               |

Only the first two are genuinely manual. `migrate` runs again on every `./run dev` and
`./run start`, and `start` checks the last two before serving anything: a missing password
stops it with the command that fixes it, and no houses yet is a note rather than a refusal,
because the **Дома** screen says how to add the first one.

`house:add` creates the house's resource in the engine and records it here in one step, so
you never handle a resource id by hand. Its extras — sauna, hot tub — are added afterwards on
the **Дома** screen, where their prices can also be changed later.

## Running it

Two ways, and the difference matters. `./run` with no arguments lists every scenario.

| Command       | What runs                                          | Reachable from               |
| ------------- | -------------------------------------------------- | ---------------------------- |
| `./run start` | The built SPA served by the built server, one port | This machine and the network |
| `./run dev`   | `tsx watch` and Vite with hot reload, two ports    | This machine only            |

**`./run start` is the one for using the tool.** It builds both workspaces, checks the setup
above, and serves the API and the app from a single port — the shape the product actually has.
It prints the address to open, including the one a phone on the same network should use, since
the server binds `0.0.0.0`.

**`./run dev` is the one for changing the code.** Vite's dev server binds to localhost, so a
phone on the same network cannot open it however the address is written.

Both take `--bg`, and `./run stop` ends whichever was started that way. Neither survives a
reboot, and neither starts the engine: that stays a separate `./run dev --bg` in
`../booking-engine`, every time.

### Do not set `NODE_ENV=production` locally

It makes the session cookie `Secure`, and a browser will not store a `Secure` cookie that
arrived over plain http. You would sign in, appear to succeed, and be signed out on the very
next tap — which reads as a broken login rather than as a wrong environment variable.
`./run start` refuses to run rather than let that happen. The same rule seen from the other
side is why a real deployment must be reached over HTTPS.

## Issuing the engine key

The key is issued once, in the engine's own console, and pasted into `.env`:

1. Start the engine's console (`./run dev` in the engine repository publishes it on `:3001`).
2. Create a tenant, then issue a key for it with the **Site backend** preset — that grants
   `availability.read`, `resources.read`, `bookings.read`, `bookings.write` and
   `bookings.list`, which is everything this project needs and nothing more.
3. Copy the secret it reveals once and set `ENGINE_API_KEY` in `.env`.

## The engine key never reaches a browser

The key lives in this server's environment and is named in exactly one file,
`server/src/engine/client.ts`. The SPA talks only to this server; it has no idea the engine
exists. A browser journey asserts it, failing if `bk_live_` appears in any document, script or
API response the page receives.

Keep it that way. Rules this project enforces on the way through are only real while this
server is the engine's sole caller — the day a key ships to the frontend they become advisory
and have to move into the engine.

## Setting up a house

A house is two things: a **resource** in the engine, which owns whether its nights are free,
and a **row here**, which owns its name, price, check-out time and extras. `./run house:add`
creates both.

It asks for a wider engine key than the running service holds, and forgets it. The service's
key is a Site backend preset with no `resources.write`, deliberately: an internet-facing
service should not be able to delete the tenant's resources for the rest of its life in order
to save a step taken twice.

Check-out is editable on the **Дома** screen; check-in is not, because it is the engine's slot
boundary and moving it re-cuts every night. `./run house:checkin` does it anyway when you must,
and refuses while the house has a booking from today onward.
[docs/architecture.md](docs/architecture.md#5-houses) explains why.

## How the two halves fit

The engine owns whether a night is free: slots, availability, the booking's existence and its
times. This project owns who and how much: the guest, the price, the add-ons, the deposit. No
dates and no booking status are stored here, so the two cannot drift; rendering joins them by
`engine_booking_id`.

[docs/architecture.md](docs/architecture.md) has the whole of it — the four invariants, the data
model, and what happens when the engine is down. Read it before changing anything.

## Configuration

| Variable                    | Meaning                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`              | This project's own database, not the engine's                                                          |
| `ENGINE_URL`                | Where the engine answers                                                                               |
| `ENGINE_API_KEY`            | A **Site backend** key, issued in the engine's console                                                 |
| `ENGINE_TIMEOUT_MS`         | How long a call to the engine may hang. Default 5000                                                   |
| `PORT`                      | The server. Default 4000                                                                               |
| `SESSION_TTL_DAYS`          | Default 30, slid on use                                                                                |
| `ENGINE_ADMIN_KEY`          | Only for `house:add` and `house:checkin`. A wider key, used once and never held by the running service |
| `LOGIN_ATTEMPTS_PER_MINUTE` | Per IP, on the login route. Default 10                                                                 |
| `LOG_LEVEL`                 | Default `info`                                                                                         |

## Tests

```bash
./run test      # server suite and web unit tests
./run test:ui   # browser journeys against the whole product
./run check     # types, formatting and every suite
```

The server suite runs a **real booking engine** in Docker, built from the sibling checkout,
rather than a stub. The defects worth catching here live in the half-open night interval, the
departure-date meeting point, the house's timezone and a genuine `409` under a race — and a
stub reproduces none of them. The first run builds that image and is slow; later runs reuse
the layer cache.

Note that `./run test` truncates only this project's tables between cases. The engine keeps
its bookings for the whole run, so a test that needs free nights books its own window.

## Deployment

`Dockerfile` builds both workspaces and ships `server/dist` beside the built SPA, so a single
container serves the API and the app from one origin. It needs `DATABASE_URL`, `ENGINE_URL`
and `ENGINE_API_KEY` in its environment, and a Postgres to talk to.

**It must be reached over HTTPS.** This is not a preference. The session cookie is set
`Secure`, and browsers refuse to store a `Secure` cookie that arrives over plain HTTP — the
owner would sign in, appear to succeed, and be signed out again on the very next tap, with
nothing on screen to explain it. The symptom looks like a broken login, not like a missing
certificate, which is why it is written down here.

Anything that terminates TLS and forwards to the container will do, and hosts that provide
HTTPS themselves need no extra piece at all. Whatever you use, forward to the container's
port and let it serve both `/api` and the app; splitting them across origins would break the
cookie for a second reason.
