# cabins-admin

The owner's journal for a two-house nightly rental: a live calendar of both houses, bookings
made through the booking engine, and the guest, price, add-ons and deposit the engine
deliberately knows nothing about.

It is a **consumer** of [`../booking-engine`](../booking-engine), never a replacement for it.
The engine owns availability and bookings; this project owns people and money.

## Quick start

The engine must be running first — the calendar cannot say which nights are free without it.

```bash
(cd ../booking-engine && ./run dev --bg)

cp .env.example .env       # ./run does this for you on the first run
# paste an engine key into ENGINE_API_KEY — see below
./run migrate
./run owner:password       # sets the password you will sign in with
./run dev
```

The app is then on <http://localhost:5173>. `./run` with no arguments lists every scenario.

## Issuing the engine key

The key is issued once, in the engine's own console, and pasted into `.env`:

1. Start the engine's console (`./run dev` in the engine repository publishes it on `:3001`).
2. Create a tenant, then issue a key for it with the **Site backend** preset — that grants
   `availability.read`, `resources.read`, `bookings.read`, `bookings.write` and
   `bookings.list`, which is everything this project needs and nothing more.
3. Copy the secret it reveals once and set `ENGINE_API_KEY` in `.env`.

## The engine key never reaches a browser

This is the invariant the whole architecture is arranged around, so it is worth stating
plainly.

The key lives in this server's environment and is named in exactly one file,
`server/src/engine/client.ts`. The SPA talks only to this server; it has no idea the engine
exists. A browser journey asserts it, reading every document, script and API response the page
receives and failing if `bk_live_` appears in any of them.

It matters because rules this project enforces on the way through — minimum stay, how far
ahead a booking may be made — are only real while this server is the sole caller. The day a
key ships to the frontend, those rules become advisory and have to move into the engine.

## How the two halves fit

|              | This repository               | `../booking-engine`                  |
| ------------ | ----------------------------- | ------------------------------------ |
| Owns         | guests, money, add-ons, notes | slots, availability, bookings, holds |
| Stores dates | **never**                     | yes, and they are the truth          |
| Users        | one owner, from the internet  | any tenant's backend, by API key     |

Three consequences worth knowing before changing anything:

- **No dates and no booking status are stored here.** They come from the engine on every read
  and are joined by `engine_booking_id`. A whole class of drift is removed by construction
  rather than by discipline, and a test asserts those columns do not exist.
- **Writes go to the engine first, then here.** A failure that way round leaves a booking whose
  guest details are missing — annoying and repairable, and the calendar flags it. The reverse
  can leave a record that does not actually hold the night, which is how two guests end up in
  one house.
- **Money is integer minor units.** Roubles are converted once, at the edge of an input. Prices
  are snapshotted onto a booking when it is made, so raising a rate cannot rewrite past totals.

## Configuration

| Variable                    | Meaning                                                |
| --------------------------- | ------------------------------------------------------ |
| `DATABASE_URL`              | This project's own database, not the engine's          |
| `ENGINE_URL`                | Where the engine answers                               |
| `ENGINE_API_KEY`            | A **Site backend** key, issued in the engine's console |
| `ENGINE_TIMEOUT_MS`         | How long a call to the engine may hang. Default 5000   |
| `PORT`                      | The server. Default 4000                               |
| `SESSION_TTL_DAYS`          | Default 30, slid on use                                |
| `LOGIN_ATTEMPTS_PER_MINUTE` | Per IP, on the login route. Default 10                 |
| `LOG_LEVEL`                 | Default `info`                                         |

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
