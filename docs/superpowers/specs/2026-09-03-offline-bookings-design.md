# Offline bookings

Status: **designed**, 2026-09-03. Not built.

Deliberately not numbered as a slice: the Telegram work recorded as Slice 2 in
[the Slice 1 spec](2026-08-19-owner-admin-design.md) has not been built, and numbering this one
would assert an order that was never decided.

> **This is a decision record, not a description of the system.**
>
> It states what was decided on 2026-09-03, before any of it was built. It is not revised as
> the code moves on.
>
> Read it to learn **why** something has the shape it does. For **what** the system does today,
> read [docs/architecture.md](../../architecture.md), which is authoritative. Where the two
> disagree, the architecture document is right and this one is stale; the fix is to correct
> that document, not to consult this one.

The engine at `../booking-engine` remains the contract this project consumes. Its
[architecture](../../../../booking-engine/docs/architecture.md) and
[conventions](../../../../booking-engine/docs/conventions.md) are not restated here except
where this project depends on a specific guarantee.

---

## 1. Purpose

The owner takes bookings by phone, and the phone rings in places with no signal. Today a
booking can only be recorded where there is connectivity: offline, the calendar shows an error
and there is no way in. The booking goes onto paper, or into memory, and is entered later — or
not.

This slice lets the owner record and change bookings with no network at all, and reconciles
what they recorded with the engine when the connection returns.

### The driving case

The owner is at the houses, out of signal, and a guest calls to book. They need to write it
down _in the app_, with the guest, the price and the add-on, and have it become a real booking
without retyping once they are back in coverage.

### In scope

- Create, reschedule, cancel and amend a booking with no network
- A cached calendar to capture against, always rendered as explicitly stale
- Sync on reconnect, with the engine as the arbiter of what actually happened
- A resolution screen for the bookings the engine refuses

### Out of scope

| Left out                              | Why                                                                                    |
| ------------------------------------- | -------------------------------------------------------------------------------------- |
| Background sync while the app is shut | The Background Sync API is Chromium-only; iOS Safari has never shipped it. Section 5   |
| Offline changes to houses or settings | Rare, deliberate, and safely done from a desk. Only bookings are urgent in a dead zone |
| A mutation log with an audit trail    | One owner, no auditor. Section 3 takes the desired-state model instead                 |
| Conflict-free replicated types        | Two devices and one writer do not need CRDTs to converge                               |
| Automatic conflict resolution         | Occupancy is money. A refused booking is escalated to the owner, never guessed at      |

---

## 2. The reversal this slice makes

[Slice 1, section 7](2026-08-19-owner-admin-design.md) decided there would be **no availability
cache**, in these terms:

> There is no availability cache, so a failed engine cannot be ridden out even for reads.
> Accepted deliberately: a stale cache would tell the same lie more convincingly.

That reasoning was correct for the system it described, and this slice does not claim it was
wrong. It changes one of its premises.

The lie in question is an availability grid that **claims to be current**. In Slice 1 the
owner could do nothing useful offline anyway, so a cache bought no capability and carried the
full risk: it could only ever mislead. The trade was one-sided, and rejecting it was right.

Here the cache is the input to a capture flow whose output is **explicitly provisional**. It is
rendered under a persistent banner with the time it was fetched, and everything captured
against it is marked as unconfirmed until the engine says otherwise. The grid no longer claims
to be current, so it no longer tells the lie. What replaces the old guarantee is not a better
cache but an honest label plus a reconciliation step that treats the engine's refusal as a
normal outcome.

**The fourth invariant is unchanged in substance.** "An unreachable engine renders an error,
never an empty calendar" exists so that an empty grid is never read as "everything is free".
An empty grid is still never rendered. A _stamped, stale_ grid is, and it says so.

---

## 3. Desired state, not a mutation log

The queue stores, per booking, **the state the owner wants it to be in** — not the sequence of
actions that got there.

The alternative, a log of every offline action replayed in order, was rejected. A booking
created offline has no `engine_booking_id`, so a later amend or cancel against it must
reference a temporary client id which has to be reconciled mid-sync. That produces dependency
chains, ordering rules, and cascading failure: when the create conflicts, every action behind
it must be parked rather than applied to nothing. All of that complexity exists to preserve an
intermediate history that, with one owner and no auditor, nobody will ever read.

Desired state collapses the same scenarios into one operation per booking:

| Offline sequence               | What is sent                        |
| ------------------------------ | ----------------------------------- |
| create, then amend, then amend | one `create` with final values      |
| create, then cancel            | **nothing** — the intent is deleted |
| reschedule, then amend         | one `update` carrying both          |
| amend, then cancel             | one `cancel`                        |

The create-then-cancel row is the clearest argument for the model: a booking that was taken and
dropped before it ever reached the engine should leave no trace, and here that falls out of the
design rather than needing a rule.

What is given up: the intermediate steps are unrecoverable. Accepted.

---

## 4. Storage

Two IndexedDB stores. `localStorage` is unsuitable — synchronous, string-only, and evicted
under pressure without warning.

### `cache`

The last successful read of everything an offline form needs: the calendar window, houses with
their prices and add-ons, settings, and guests for autocomplete. Each entry carries
`fetched_at`, which is what the staleness stamp renders.

**This is a rendering cache and never a source of truth.** It is replaced wholesale by the next
successful read and is never merged with one. It holds dates and booking statuses, which the
_server_ still does not — see section 9.

### `intents`

One record per booking, keyed by `engine_booking_id`, or by a client-generated UUID for a
booking that does not yet exist.

```ts
interface Intent {
  id: string // client UUID; also the engine idempotency key
  bookingId: string | null // null until the booking exists server-side
  op: 'create' | 'update' | 'cancel'
  capturedAt: string // when the owner hit save
  currency: string // captured here, never resolved at sync time
  payload: {/* desired end state, not a delta */}
  state: 'pending' | 'syncing' | 'conflict'
  lastError?: { code: string; message: string }
}
```

There are three operations, not four: `update` carries the booking's whole desired state — its
nights _and_ its money — because the collapse rules make a reschedule and an amend
indistinguishable once both are pending on one booking. Sync decides what to call: the engine is
asked to reschedule only when the nights differ from the cached booking, and `amend` runs for
the money either way. Section 6 lists the two halves separately because they fail differently,
not because they are separate operations.

`currency` sits on the intent rather than being read at sync time because a booking is
denominated in what was **agreed**, and the agreement happened offline. Resolving it later
would let a settings change between capture and sync reinterpret a price already given to a
guest, which the currency invariant forbids.

### Rendering

```
applyIntents(cache, intents) → CalendarView
```

Pure, synchronous, no React and no I/O. It is the single place that decides how a pending
create, cancel, reschedule and money-edit each appear, and it carries the bulk of the test
suite. Every offline-aware screen reads through it, so there is one answer to "what does the
owner believe is true" rather than one per component.

---

## 5. Sync

### When it runs

On the `online` event, on app focus, after a successful login, and from a manual control in the
tray. `online` alone is not enough: a browser reports online on a captive portal with no route
to anywhere.

**Not** via the Background Sync API, which is Chromium-only. The consequence must be documented
and surfaced, not glossed: **if the owner closes the app while offline, nothing is sent until
they open it again.** Sync-on-open is the honest baseline. Android could be improved later, but
the feature is never described as syncing in the background.

### One at a time

Intents are processed serially in capture order. Two queued creates can overlap each other's
nights, and only a serial queue can let the second see the first's outcome. It also keeps the
"remaining" count honest and avoids a burst against the engine's per-key rate limit.

### Transitions

```
pending ──sent──> syncing ──2xx──────────────> done (intent dropped, caches invalidated)
                          ──409 / 4xx────────> conflict (needs the owner)
                          ──5xx / 429 / net──> pending (backoff, retried next trigger)
                          ──401──────────────> pending, queue pauses, login shown
```

`concurrent_update` (503) and `rate_limited` (429) are documented by the engine as retryable
and take the backoff branch, never the conflict branch.

The `401` branch is not hypothetical. The session cookie is a fixed 30-day TTL that does not
slide, so a long enough offline stretch expires it. **The queue must survive the login screen
and resume after re-authentication** — never be cleared by it. A queue discarded at logout
loses bookings that exist nowhere else.

### The freeze rule

The engine answers `409 idempotency_key_reused` to the same key carrying a different body. That
collides with section 3's collapse rule: if a create was attempted and only its _response_ was
lost, a later offline edit would replay the same key with a changed payload and be refused for
a reason that has nothing to do with availability.

**Once an intent has been attempted, its payload freezes until the outcome is known.** The UI
shows it as sending and blocks editing. The window opens only when connectivity dies in flight
and closes on the next sync, where replaying the key is definitive: `200` if the booking
landed, `201` if it did not. After that the booking is real and further edits are ordinary
`update`s.

This is also what makes retries safe at all. Today the idempotency key is generated fresh
inside `create()` on every call, so a retry after a lost response would mint a new key and book
the night twice. Section 7 moves it to the client.

---

## 6. Conflicts

A conflict is a normal outcome, not an error state. The engine is the arbiter, and its refusal
is escalated to the owner rather than resolved by guesswork — occupancy is money.

| Operation      | Engine answer                  | What it means                                   | Resolution offered                                     |
| -------------- | ------------------------------ | ----------------------------------------------- | ------------------------------------------------------ |
| create         | `409 slot_unavailable`         | Night taken while offline. Nothing created      | New dates, other house, or discard — details preserved |
| create         | replay of a landed key         | Already created; this is the same booking       | Silent success. No duplicate                           |
| update (dates) | `409 slot_unavailable`         | Target taken. **Booking still exists, unmoved** | Retry elsewhere or abandon the move                    |
| update (money) | —                              | Cannot conflict; `amend` never calls the engine | Last-write-wins against the other device               |
| update         | `404 not_found`                | Booking removed or cancelled elsewhere          | Told plainly; the intent is dropped                    |
| cancel         | `409 invalid_state_transition` | Already cancelled — the desired state holds     | **Treated as success**, not a conflict                 |
| cancel         | `404 not_found`                | Already gone — the desired state holds          | **Treated as success**                                 |

Two rows carry most of the design's weight.

**A failed reschedule leaves the booking where it was.** The engine's `reschedule` updates a row
in place and leaves it unchanged when the new slots are unavailable. The resolution screen must
say the booking still holds its original nights, because "the move failed" reads to a tired
owner as "the booking is gone", and that misreading sells an occupied night.

**Cancel is convergent.** Its desired end state can already be true, and a system that reports
an error for getting what it asked for trains the owner to ignore errors.

The only lossy case is a money or note edit racing the other device. With one owner this is
accepted; an `updated_at` precondition on `amend` would make it detectable and is recorded here
as the known fix if it ever bites.

---

## 7. Server changes

Small, and all on the create path.

**`idempotency_key`, required, UUID.** Supplied by the client and forwarded to the engine in
place of the `randomUUID()` generated inside `create()`. It must be added to the TypeBox schema
explicitly: request bodies are `additionalProperties: false`, so an unknown field is rejected
rather than ignored. Required rather than optional because there is exactly one client, and an
optional key degrades silently into the unsafe retry behaviour it exists to prevent.

**`currency`, captured.** Sent with the booking and used instead of the live settings read. It
validates against the supported-currency table, **not** against the current setting: a currency
agreed offline stays valid even after the setting moves, which is the whole point.

**Nothing for cancel.** `invalid_state_transition` is mapped to success on the client, where the
knowledge that the cancel was a replay lives.

The engine needs no changes. Its per-`(resource_id, idempotency_key)` uniqueness, its
`200`-on-replay contract and its retryable error codes are all already specified.

---

## 8. Interface

Five surfaces. The first four are chrome; the fifth is the only genuinely new screen.

1. **A connection banner**, app-wide and not dismissible while offline, carrying four states:
   offline, syncing, all synced, and _N_ needing attention. It is what stops the owner ever
   being unsure whether what they see is real.
2. **A staleness stamp** on the calendar, showing when the cache was fetched.
3. **A pending treatment on every affected booking.** A queued create renders provisionally; a
   queued cancel renders the booking struck through but still present; a queued reschedule
   renders it at its new dates with the old nights marked as releasing. Each must read as
   intended-not-confirmed, and none may be mistaken for engine truth.
4. **A sync tray** listing everything unsent, so the set is visible in one place rather than
   hunted for across the calendar.
5. **A conflict screen** showing what was wanted beside what the engine now says, with the
   actions from section 6. It never discards the guest, price or add-on details: the owner
   re-decides the nights, not the booking.

---

## 9. What this does not change

**The engine API key still never reaches a browser.** Nothing here moves an engine call to the
client. The queue replays requests to _this_ server, which remains the only caller, so every
rule enforced on the way through stays real.

**Writes still go to the engine first.** Sync calls this server, which calls the engine before
its own database, exactly as it does online. Offline capture does not reorder the write — it
defers the whole thing.

**The server still stores no dates and no booking status.** The IndexedDB cache holds both, on
the client, as a rendering cache that the next successful read replaces. The invariant is about
this project's records drifting from the engine's, and a cache that is never written back
cannot drift into anything. `docs/architecture.md` must state this explicitly, or the next
reader will reasonably conclude the invariant was broken.

---

## 10. Testing

Heaviest first, and deliberately weighted toward the pure functions.

- **`applyIntents`.** No I/O, no React, and the most cases: every pending operation's
  appearance, and the interaction between a cached booking and an intent that modifies it.
- **Collapse rules.** Create-then-cancel sends nothing; reschedule-then-amend is one `update`;
  cancel supersedes a pending update; an attempted intent refuses further edits.
- **The state machine**, against a faked API: each engine error code lands in the branch
  section 5 assigns it, and `401` pauses the queue without draining it.
- **Server integration.** The two body fields, and that a replayed key returns the same booking
  rather than a second one.
- **Playwright, end to end.** `context.setOffline(true)`, capture a booking, reconnect, assert
  it synced. Then the conflict journey: capture offline, take the night in the engine behind the
  app's back, reconnect, and assert both the conflict screen and the absence of a duplicate.

The existing journey asserting `bk_live_` never appears in any document, script or API response
keeps running unchanged, and now also covers the sync requests.

---

## 11. Build order

Create first, on the full machinery. The queue, the banner, the cache, the tray and the
conflict screen are all built for `create` alone and proven end to end, including the conflict
path. Reschedule, cancel and amend then follow on rails that already work, each adding a row to
section 6's table and nothing structural.

The alternative — designing all four operations at once against an unproven sync loop — spends
the hardest thinking on the operations with the least risk. Cancel is convergent and amend
cannot conflict; neither would have taught us anything about the machinery that create does not
teach first.
