# Offline bookings (create path) — review record and follow-ups

Status: **open follow-ups**, recorded 2026-09-29 when the branch was raised for review.

> **This is the only durable record of what review found.** The plan beside it is spent
> scaffolding; this document is not. Everything below was found by review during execution or by
> the final whole-branch pass, and everything in section 3 is still outstanding.
>
> For what the system does today read [docs/architecture.md](../../../architecture.md). For why
> the offline design has its shape read
> [the spec](../../specs/2026-09-03-offline-bookings-design.md).

---

## 1. Two decisions the branch defers to a human

**Squash before a non-squash merge.** Four commits do not compile standalone: `9e1bc13`,
`ecc6ab0` and `97d2738` are broken until `23c02f9` repairs them. Two separate incidents of the
same shape — a commit landing one file while the files it depends on stayed uncommitted, so the
suites passed against a working tree that the commit did not contain. The final tree is correct;
`git bisect` and per-commit CI are not. A squash-merge makes this moot.

**Sign-out no longer clears the browser cache.** Making the session gate permissive
(`RequireSession` proceeds when the server was never reached) means a device that was signed in,
then signed out, then opened offline now reaches a calendar populated with cached guest names and
phone numbers. Before that change the offline session check blocked it. The app's threat model is
one owner's own device, and the client cannot distinguish "signed in but unreachable" from
"signed out but unreachable" without a round-trip — so this is a real trade-off of offline access
rather than a defect. It deserves a deliberate choice: either accept it, or have sign-out
(`Houses.tsx`) clear the IndexedDB `cache` store alongside the React Query cache.

---

## 2. What review caught that the tests did not

Recorded because each one is a pattern, not a one-off.

**A task can pass every gate while leaving the bug it was written to fix.** The idempotency key
moved to the client so a lost response could be retried safely — but the form minted a new key
inside its submit handler, so a retry after a lost answer held the night twice. Server suite,
web suite and every journey were green. Nothing exercised "submit, lose the answer, click again",
because that is the failure the design was supposed to make impossible.

**A library's behaviour can quietly undo a design.** `useCachedQuery` returned early whenever
`query.data` was defined. TanStack Query's error reducer never clears `data`, so after any
earlier success a failed refetch served the old grid reported as fresh, and the IndexedDB
fallback was unreachable. An unstamped stale availability grid is the "everything is free"
failure the fourth invariant forbids, and the stamp is the whole reason this project has a cache
at all.

**A produced value with no consumer is invisible to per-task review.** `applyIntents` set a
`pending` marker on every queued booking and nothing drew it. After reconnection with a conflict
outstanding the grid is live, so no staleness stamp renders, and a refused booking drew as an
ordinary confirmed bar with the guest's name. One task produced the field correctly, another
consumed it correctly for a different purpose, and no task owned the rendering.

**A green isolated run is not a green suite.** The replay-guest test passed under `-t` and failed
in the full suite. It deleted the `booking_details` row and then asserted the _stored_ guest —
setting up the orphan-healing branch while asserting the replay branch's outcome. Fixed by
removing the delete; the orphan branch has its own test.

**A fix can be undone by a later task innocently following its own brief.** The component-scope
idempotency key would have been discarded by a later helper that minted its own internally. Caught
before dispatch by reading the next brief against the code as it then stood, not as the plan
imagined it.

---

## 3. Deferred minor findings

Triaged by the final review as safe to carry. Each was seen, judged and left deliberately.

### Worth doing when the code is next touched

| Where                                                | What                                                                                                                                                                                                                                              |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/src/modules/bookings/booking.service.ts`     | Concurrent duplicate replays can both insert; the loser takes a unique violation, 500s, and is retried. Converges, but `onConflict().doNothing()` plus a re-read would close it.                                                                  |
| `web/src/offline/useOffline.ts`                      | `reload()` and `syncNow()` have no `.catch`. A failed `allIntents()` leaves `intents` empty, which hides queued bookings on the grid while they are still in the database — the opposite of this branch's conservative direction everywhere else. |
| `web/src/offline/sync.ts`                            | Retryable _server_ errors (`rate_limited`, `concurrent_update`, `internal_error`) return `'offline'`, so the banner says "Нет сети" while the network is fine. A separate `'retrying'` outcome would be honest.                                   |
| `web/src/offline/ConflictScreen.tsx`, `SyncTray.tsx` | Both use `.notice` / `.notice--bad`, defined in `routes/calendar.css` and imported by neither. Works only because one bundle includes `Calendar`; breaks under route-level code splitting.                                                        |
| `server/tests/integration/create-booking.test.ts`    | The replay test's `deleteFrom` line is now inert and its comment describes something it does not do.                                                                                                                                              |

### Cosmetic or contingent

- `intents.ts` — `editIntent` / `isEditable` have no caller yet. Left deliberately: they are the
  sanctioned API for reschedule, cancel and amend.
- `overlay.ts` — `rendered.includes` is O(n) per intent; a `Set` would be idiomatic. Two houses.
- `overlay.ts` — no test for an intent whose nights only partially overlap the rendered window.
- `db.ts` — `readCache` casts `CacheEntry<unknown>` to `CacheEntry<T>` unchecked.
- `vite.config.ts` — the `NetworkOnly` predicate matches on path alone with no same-origin check.
  Over-matching forces more requests to `NetworkOnly`, which is the safe direction.
- `useOffline.ts` — a redundant `setFallback(undefined)` when it is already undefined; and
  `failed` staying true across two consecutive failures for one key means the effect does not
  re-run, so `checkedKey` carries over. Benign: the cache only changes on success.
- `capture.ts` — `newCreateIntent` mints a UUID that the caller's key immediately overwrites.
  Harmless today, and a live trap for the next caller. One mint site would remove it.
- `sync.ts` — the `'idle'` fallback is unreachable when the queue is non-empty.
- `ConnectionBanner.tsx` — "all synced" is represented by rendering nothing, so an owner who
  watched "1 бронь ждёт отправки" gets no positive confirmation; and a conflict while offline
  hides the offline state, since the conflict branch wins. The staleness stamp renders
  independently, so "not live" is never lost.
- `intents.test.ts` — the edit test does not assert that unrelated fields survive an edit.
- `Timeline.tsx` — the `scrollIntoView` on mount, plus a non-empty banner above a
  `min-height: 100vh` child, means a short page scrolls slightly. Dormant while the banner is empty.
- `.timeline__head`'s sticky header has never worked: `.timeline` sets `overflow: hidden`, which
  breaks sticky for its descendants. Pre-existing, unrelated to this branch, and left alone.

### Known gaps in the evidence

- **No test in this repo exercises computed layout.** The sticky banner and the `#root` height
  work rest on manual measurement recorded in the review reports. The reasoning is in the comment
  at the top of `styles.css`, which records three rejected approaches and what each broke.
- **`useSync` has no test file.** It holds three separate fix commits from this branch's own
  review — the in-flight guard, `syncSerial` monotonicity, and the 401-then-login resume — and
  everything else depends on it continuing to behave.
- **Nothing tests that the booking form holds one idempotency key across submits.** Moving
  `crypto.randomUUID()` back inside the submit handler would leave every suite green and restore
  a double-booking bug.
- A page loaded by `reload()` under an already-offline context can read `navigator.onLine === true`,
  so the banner briefly shows the wrong wording. Capture and sync key off actual fetch failure,
  not that signal, so data safety is unaffected.

---

## 4. Forward coupling to watch

Three of this branch's guarantees currently hold by the _absence_ of an edit path rather than by
enforcement, and reschedule, cancel and amend are next:

- **The frozen payload.** The engine refuses a replayed key carrying a changed body. Today no UI
  can edit a queued intent, so this cannot happen. When one exists it must consult `isEditable`.
- **A single mint site for the idempotency key.** Three files touch it; one rule holds it together.
- **The server's replay response.** Now reads the guest from the stored row, so it no longer
  depends on the freeze rule — this coupling was removed deliberately before it could bite.
