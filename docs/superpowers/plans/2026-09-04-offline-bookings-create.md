# Offline Bookings — Create Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner record a _new_ booking with no network at all, and have it become a real engine booking when connectivity returns — including when the engine refuses the night.

**Architecture:** Two IndexedDB stores hold a rendering cache and one desired-state intent per booking. A pure `applyIntents(cache, intents)` function is the single place that decides what the owner sees. A serial sync loop replays intents through this project's own server — never the engine directly — using a client-generated idempotency key so a lost response cannot double-book.

**Tech Stack:** React 19, TanStack Query 5, Vite 8, `idb`, `vite-plugin-pwa` (Workbox), Vitest 4, `fake-indexeddb`, Playwright, Fastify 5, TypeBox.

**Spec:** [docs/superpowers/specs/2026-09-03-offline-bookings-design.md](../specs/2026-09-03-offline-bookings-design.md)

## Global Constraints

- **The engine API key never reaches a browser.** Nothing in this plan adds an engine call from the client. Sync posts to this project's server, which stays the only engine caller.
- **Writes go to the engine first, then here.** Unchanged: sync calls `POST /api/bookings`, which calls the engine before its own database.
- **An unreachable engine renders an error, never an empty calendar.** A stale grid may render _only_ under a staleness stamp; an empty grid never renders.
- **Money is integer minor units.** No float anywhere near a total.
- **Server modules are `NodeNext`:** relative imports carry `.js` even in a `.ts` file. The web workspace does not.
- **`tsconfig.base.json` sets `exactOptionalPropertyTypes: true`.** An optional property is omitted, never assigned `undefined` — `{ ...intent, lastError: undefined }` does not compile. Build the object without the key instead.
- **The TypeBox package is `typebox`,** not `@sinclair/typebox`.
- **Every request body is TypeBox with `additionalProperties: false`.** A new field must be added to the schema explicitly or it is rejected.
- **Errors keep the shape `{ error, message, details? }`.**
- **The owner is never shown a server message.** All copy is Russian, looked up by error code in `web/src/errors.ts`.
- **Dates are plain `YYYY-MM-DD` strings** and are never turned into a `Date` for arithmetic. Use the helpers in `web/src/calendar/nights.ts`.
- **Scope of this plan is `create` only.** Reschedule, cancel and amend are Plan 2, per spec §11.
- **The gate is `./run check`** — types, formatting and both suites. Running the tests and the typecheck alone is not the gate: `npx prettier --check .` is part of it, and `.prettierrc` sets `printWidth: 100`, `singleQuote: true`, `semi: false`. Verify formatting before every commit.

## File Structure

**New — `web/src/offline/`, the whole subsystem:**

| File                   | Responsibility                                                                          |
| ---------------------- | --------------------------------------------------------------------------------------- |
| `db.ts`                | IndexedDB open/read/write for the two stores. The only file that knows IndexedDB exists |
| `intents.ts`           | The `Intent` type, construction, and the edit/freeze rules. Pure                        |
| `overlay.ts`           | `applyIntents(cache, intents)`. Pure, no I/O, no React                                  |
| `sync.ts`              | The serial replay loop and its state machine. Takes its I/O as injected dependencies    |
| `useOffline.ts`        | React glue: online state, sync triggers, and the cached-read hook                       |
| `ConnectionBanner.tsx` | App-wide status: offline / syncing / synced / needs attention                           |
| `SyncTray.tsx`         | The list of everything unsent                                                           |
| `ConflictScreen.tsx`   | Wanted-versus-actual, with the resolution actions                                       |
| `offline.css`          | Styles for the three components above                                                   |

**Modified:**

| File                                              | Change                                                          |
| ------------------------------------------------- | --------------------------------------------------------------- |
| `web/vite.config.ts`                              | Add `vite-plugin-pwa`                                           |
| `web/src/main.tsx`                                | Relax `staleTime`, and correct the comment that forbids caching |
| `web/src/api.ts`                                  | Export `isOffline(cause)`                                       |
| `web/src/errors.ts`                               | Copy for the new codes                                          |
| `web/src/booking/NewBooking.tsx`                  | Capture to an intent when offline                               |
| `web/src/routes/Calendar.tsx`                     | Read through the overlay; render the stamp and banner           |
| `server/src/modules/bookings/booking.schemas.ts`  | `idempotency_key`, `currency`                                   |
| `server/src/modules/bookings/booking.service.ts`  | Use both instead of generating/reading them                     |
| `tests/ui/helpers.ts`                             | `bookViaPage` must send the two new fields                      |
| `server/tests/integration/create-booking.test.ts` | Cover the two new fields                                        |
| `docs/architecture.md`                            | The §9 documentation obligation                                 |

---

## Task 1: Service worker, so the app opens offline at all

**Spec gap, deliberately filled here.** The spec assumes the app can be opened with no network but never says how. Without a service worker the browser shows its own offline page and nothing else in this plan is reachable. The manifest, icons and standalone meta tags already shipped in `8926497`; only the service worker is missing.

**Files:**

- Modify: `web/vite.config.ts`
- Modify: `web/package.json`
- Test: `tests/ui/offline-shell.spec.ts`

**Interfaces:**

- Consumes: nothing
- Produces: a registered service worker that precaches the built shell and never caches `/api`

- [ ] **Step 1: Install the plugin**

```bash
npm install --workspace web --save-dev vite-plugin-pwa
```

- [ ] **Step 2: Write the failing test**

Create `tests/ui/offline-shell.spec.ts`:

```ts
import { expect, test } from '@playwright/test'
import { appUrl, resetAppDb, seedHouse, setOwnerPassword } from './helpers.js'

test.beforeEach(async () => {
  await resetAppDb()
  await setOwnerPassword('correct horse battery staple')
})

test('the app shell still renders with the network cut', async ({ page, context }) => {
  await page.goto(appUrl('/'))

  // The shell is only precached once the worker has activated; without this the reload below
  // races registration and fails intermittently rather than meaningfully.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)

  await context.setOffline(true)
  await page.reload()

  // The login screen is part of the shell, so it renders from the cache with no server.
  await expect(page.getByLabel('Пароль')).toBeVisible()
})

test('an API call is never served from the cache', async ({ page, context }) => {
  await seedHouse()
  await page.goto(appUrl('/'))

  // Signing in must happen only once the worker controls this page: a request made before
  // that point never reaches the worker's fetch handler at all, and the assertion below would
  // pass for the wrong reason.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)

  await page.getByLabel('Пароль').fill(PASSWORD)
  const calendarLoaded = page.waitForResponse(
    (response) => response.url().includes('/api/calendar') && response.status() === 200,
  )
  await page.getByRole('button', { name: 'Войти' }).click()
  await calendarLoaded

  // A *successful* request has to happen first, or there was never anything to cache and the
  // assertion passes under any handler at all. `caches.match` searches every Cache Storage
  // entry the origin owns; `ignoreSearch` makes the query string irrelevant. Under CacheFirst
  // this finds the response and fails, which is the discriminating power the test exists for.
  const cached = await page.evaluate(async () => {
    const hit = await caches.match('/api/calendar', { ignoreSearch: true })
    return hit !== undefined
  })
  expect(cached).toBe(false)

  // Secondary: offline, the same endpoint throws rather than answering from a cache.
  await context.setOffline(true)
  const status = await page.evaluate(async () => {
    try {
      const response = await fetch('/api/calendar?from=2026-09-01&to=2026-10-01')
      return response.status
    } catch {
      return 'threw'
    }
  })
  expect(status).toBe('threw')
})
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `npx playwright test tests/ui/offline-shell.spec.ts`
Expected: FAIL — `navigator.serviceWorker.controller` stays `null`, so `waitForFunction` times out.

- [ ] **Step 4: Add the plugin to the Vite config**

In `web/vite.config.ts`, add the import and the plugin. Keep the existing proxy comment untouched.

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // `public/manifest.json` is hand-written and already linked from index.html. Letting the
      // plugin generate a second one would put two manifests on the page.
      manifest: false,
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,woff2}'],
        // A client-side route must survive a reload with no network, exactly as it survives one
        // with a network via the server's SPA fallback.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // Never cached, at any age. A stale availability grid answered as if fresh is the
            // "everything is free" mistake the fourth invariant exists to prevent; the offline
            // cache is written deliberately by the app, under a staleness stamp, not by Workbox.
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
          },
          {
            // The interface's typeface, so the offline shell is not a system-font fallback.
            urlPattern: ({ url }) =>
              url.origin.endsWith('googleapis.com') || url.origin.endsWith('gstatic.com'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'fonts',
              expiration: { maxEntries: 32, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  // One origin in development too, so the session cookie needs no cross-site relaxation and
  // there is no CORS to configure differently from production.
  //
  // `changeOrigin: false` is load-bearing, not tidiness. The server refuses any write whose
  // `Origin` disagrees with the `Host` it was addressed to — a CSRF check that needs no
  // configured origin. Left to its default the proxy rewrites `Host` to the target while the
  // browser's `Origin` stays the dev server's, and every write in development is refused. The
  // shorthand string form of a proxy entry takes that default silently.
  server: { proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: false } } },
  build: { outDir: '../server/public', emptyOutDir: true },
})
```

- [ ] **Step 5: Rebuild and re-run the test**

Run: `npm run --workspace web build && npx playwright test tests/ui/offline-shell.spec.ts`
Expected: PASS, both tests.

- [ ] **Step 6: Commit**

```bash
git add web/vite.config.ts web/package.json package-lock.json tests/ui/offline-shell.spec.ts
git commit -m "feat(web): precache the app shell so the journal opens with no network"
```

---

## Task 2: The IndexedDB stores

**Files:**

- Create: `web/src/offline/db.ts`
- Test: `web/tests/offline-db.test.ts`
- Modify: `web/package.json`

**Interfaces:**

- Consumes: `Intent` from Task 3 — but Task 3 is pure types, so write Task 3's `intents.ts` first if executing strictly in order. This task only needs the type to exist.
- Produces:
  - `putCache<T>(key: string, value: T): Promise<void>`
  - `readCache<T>(key: string): Promise<CacheEntry<T> | undefined>`
  - `putIntent(intent: Intent): Promise<void>`
  - `allIntents(): Promise<Intent[]>`
  - `dropIntent(id: string): Promise<void>`
  - `interface CacheEntry<T> { value: T; fetchedAt: string }`

- [ ] **Step 1: Install the dependencies**

```bash
npm install --workspace web idb
npm install --workspace web --save-dev fake-indexeddb
```

- [ ] **Step 2: Write the failing test**

Create `web/tests/offline-db.test.ts`:

```ts
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  allIntents,
  dropIntent,
  putCache,
  putIntent,
  readCache,
  resetForTests,
} from '../src/offline/db'
import type { Intent } from '../src/offline/intents'

const INTENT: Intent = {
  id: '11111111-1111-4111-8111-111111111111',
  bookingId: null,
  op: 'create',
  capturedAt: '2026-09-04T10:00:00.000Z',
  currency: 'RUB',
  attempted: false,
  state: 'pending',
  payload: {
    house_id: '22222222-2222-4222-8222-222222222222',
    check_in: '2026-10-01',
    check_out: '2026-10-03',
    guest: { name: 'Аня', phone: '+375291234567' },
    price_per_night: 30000,
    addons: [],
    deposit: 0,
  },
}

beforeEach(async () => {
  await resetForTests()
})

describe('the cache store', () => {
  it('stamps what it stores with the time it was fetched', async () => {
    await putCache('calendar:2026-10-01:2026-11-01', { houses: [], bookings: [] })
    const entry = await readCache<{ houses: unknown[] }>('calendar:2026-10-01:2026-11-01')

    expect(entry?.value).toEqual({ houses: [], bookings: [] })
    // The stamp is what the staleness notice renders; without it the grid would have no way
    // to say how old it is, which is the whole basis for showing it at all.
    expect(entry?.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('replaces an entry wholesale rather than merging into it', async () => {
    await putCache('houses', [{ id: 'a' }, { id: 'b' }])
    await putCache('houses', [{ id: 'c' }])

    // A merge would resurrect a house the server has since deleted.
    expect((await readCache<unknown[]>('houses'))?.value).toEqual([{ id: 'c' }])
  })

  it('answers undefined for a key never written', async () => {
    expect(await readCache('nothing')).toBeUndefined()
  })
})

describe('the intent store', () => {
  it('round-trips an intent', async () => {
    await putIntent(INTENT)
    expect(await allIntents()).toEqual([INTENT])
  })

  it('keys by id, so saving twice updates rather than duplicates', async () => {
    await putIntent(INTENT)
    await putIntent({ ...INTENT, state: 'conflict' })

    const stored = await allIntents()
    expect(stored).toHaveLength(1)
    expect(stored[0]?.state).toBe('conflict')
  })

  it('drops one by id', async () => {
    await putIntent(INTENT)
    await dropIntent(INTENT.id)
    expect(await allIntents()).toEqual([])
  })
})
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `npm run --workspace web test -- offline-db`
Expected: FAIL — cannot resolve `../src/offline/db`.

- [ ] **Step 4: Write the implementation**

Create `web/src/offline/db.ts`:

```ts
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Intent } from './intents'

/**
 * Everything the owner captured but has not yet sent, plus the last good read of what they
 * captured it against.
 *
 * IndexedDB rather than `localStorage`: the intents are structured, the cache can hold a whole
 * month of two houses, and `localStorage` is synchronous, string-only, and dropped under
 * storage pressure without telling anyone. Losing a queued booking loses a booking that exists
 * nowhere else.
 */
export interface CacheEntry<T> {
  value: T
  /** ISO 8601. What the staleness notice renders. */
  fetchedAt: string
}

interface Stores extends DBSchema {
  cache: { key: string; value: CacheEntry<unknown> }
  intents: { key: string; value: Intent }
}

const NAME = 'cabins-offline'
const VERSION = 1

let open: Promise<IDBPDatabase<Stores>> | undefined

function db(): Promise<IDBPDatabase<Stores>> {
  open ??= openDB<Stores>(NAME, VERSION, {
    upgrade(database) {
      database.createObjectStore('cache')
      database.createObjectStore('intents', { keyPath: 'id' })
    },
  }).catch((cause: unknown) => {
    // A rejected promise left in `open` would answer every later read and write with the same
    // stale failure for the life of the page — disabling the queue outright, and the queue
    // holds bookings that exist nowhere else. Dropped so the next call opens again.
    open = undefined
    throw cause
  })
  return open
}

export async function putCache<T>(key: string, value: T): Promise<void> {
  await (await db()).put('cache', { value, fetchedAt: new Date().toISOString() }, key)
}

export async function readCache<T>(key: string): Promise<CacheEntry<T> | undefined> {
  return (await (await db()).get('cache', key)) as CacheEntry<T> | undefined
}

export async function putIntent(intent: Intent): Promise<void> {
  await (await db()).put('intents', intent)
}

/** Capture order, which is the order sync replays them in. */
export async function allIntents(): Promise<Intent[]> {
  const stored = await (await db()).getAll('intents')
  return stored.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
}

export async function dropIntent(id: string): Promise<void> {
  await (await db()).delete('intents', id)
}

/** Test seam only. Production never deletes the database. */
export async function resetForTests(): Promise<void> {
  const database = await db()
  await database.clear('cache')
  await database.clear('intents')
}
```

- [ ] **Step 5: Run the test again**

Run: `npm run --workspace web test -- offline-db`
Expected: PASS, all six tests.

- [ ] **Step 6: Commit**

```bash
git add web/src/offline/db.ts web/tests/offline-db.test.ts web/package.json package-lock.json
git commit -m "feat(web): store the offline cache and the intent queue in IndexedDB"
```

---

## Task 3: The intent type and its edit rules

**Files:**

- Create: `web/src/offline/intents.ts`
- Test: `web/tests/intents.test.ts`

**Interfaces:**

- Consumes: nothing
- Produces:
  - `interface CreatePayload`, `interface Intent`, `type IntentState = 'pending' | 'syncing' | 'conflict'`
  - `newCreateIntent(payload: CreatePayload, currency: string): Intent`
  - `editIntent(intent: Intent, payload: CreatePayload): Intent`
  - `isEditable(intent: Intent): boolean`

- [ ] **Step 1: Write the failing test**

Create `web/tests/intents.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { editIntent, isEditable, newCreateIntent, type CreatePayload } from '../src/offline/intents'

const PAYLOAD: CreatePayload = {
  house_id: '22222222-2222-4222-8222-222222222222',
  check_in: '2026-10-01',
  check_out: '2026-10-03',
  guest: { name: 'Аня', phone: '+375291234567' },
  price_per_night: 30000,
  addons: [],
  deposit: 0,
}

describe('newCreateIntent', () => {
  it('mints a UUID that will serve as the engine idempotency key', () => {
    const intent = newCreateIntent(PAYLOAD, 'RUB')
    expect(intent.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(newCreateIntent(PAYLOAD, 'RUB').id).not.toBe(intent.id)
  })

  it('captures the currency rather than leaving it to be resolved at sync time', () => {
    // A settings change between capture and sync must not reinterpret a price already quoted
    // to a guest.
    expect(newCreateIntent(PAYLOAD, 'BYN').currency).toBe('BYN')
  })

  it('starts pending, unattempted, and with no booking of its own yet', () => {
    const intent = newCreateIntent(PAYLOAD, 'RUB')
    expect(intent.state).toBe('pending')
    expect(intent.attempted).toBe(false)
    expect(intent.bookingId).toBeNull()
  })
})

describe('editIntent', () => {
  it('keeps the same id, so an edit collapses into one create rather than queueing a second', () => {
    const first = newCreateIntent(PAYLOAD, 'RUB')
    const edited = editIntent(first, { ...PAYLOAD, price_per_night: 45000 })

    expect(edited.id).toBe(first.id)
    expect(edited.payload.price_per_night).toBe(45000)
  })

  it('clears a previous error, because the owner has just changed what is being asked', () => {
    const conflicted = {
      ...newCreateIntent(PAYLOAD, 'RUB'),
      state: 'conflict' as const,
      lastError: { code: 'slot_unavailable', message: 'taken' },
    }
    const edited = editIntent(conflicted, {
      ...PAYLOAD,
      check_in: '2026-10-05',
      check_out: '2026-10-07',
    })

    expect(edited.state).toBe('pending')
    expect(edited.lastError).toBeUndefined()
  })

  it('refuses to edit an intent that has already been attempted', () => {
    // The engine answers 409 idempotency_key_reused to the same key carrying a different body.
    // Until a replay tells us whether the original landed, the payload has to hold still.
    const attempted = { ...newCreateIntent(PAYLOAD, 'RUB'), attempted: true }
    expect(() => editIntent(attempted, { ...PAYLOAD, deposit: 10000 })).toThrow(/attempted/i)
  })
})

describe('isEditable', () => {
  it('is false exactly when the payload is frozen', () => {
    expect(isEditable(newCreateIntent(PAYLOAD, 'RUB'))).toBe(true)
    expect(isEditable({ ...newCreateIntent(PAYLOAD, 'RUB'), attempted: true })).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run --workspace web test -- intents`
Expected: FAIL — cannot resolve `../src/offline/intents`.

- [ ] **Step 3: Write the implementation**

Create `web/src/offline/intents.ts`:

```ts
/**
 * What the owner wants a booking to be — not the sequence of actions that got there.
 *
 * A log of offline actions replayed in order would need a temporary client id for a booking
 * that does not exist yet, reconciled mid-sync, with every later action parked when an earlier
 * one conflicts. Desired state collapses all of that: one record per booking, edited in place.
 */

/** Exactly the body `POST /api/bookings` accepts, so sync sends it unchanged. */
export interface CreatePayload {
  house_id: string
  check_in: string
  check_out: string
  guest: { name: string; phone: string; note?: string }
  price_per_night: number
  addons: Array<{ code: string }>
  deposit: number
  note?: string
}

export type IntentState = 'pending' | 'syncing' | 'conflict'

export interface Intent {
  /** Also the engine idempotency key, which is why it must not change once sent. */
  id: string
  bookingId: string | null
  op: 'create'
  capturedAt: string
  /** As agreed, offline. Never re-read from settings at sync time. */
  currency: string
  payload: CreatePayload
  state: IntentState
  /**
   * True once a request carrying this id has left the browser. The engine refuses the same key
   * with a different body, so an attempted payload is frozen until a replay tells us whether
   * the original landed.
   */
  attempted: boolean
  lastError?: { code: string; message: string }
}

export function newCreateIntent(payload: CreatePayload, currency: string): Intent {
  return {
    id: crypto.randomUUID(),
    bookingId: null,
    op: 'create',
    capturedAt: new Date().toISOString(),
    currency,
    payload,
    state: 'pending',
    attempted: false,
  }
}

export function isEditable(intent: Intent): boolean {
  return !intent.attempted
}

export function editIntent(intent: Intent, payload: CreatePayload): Intent {
  if (!isEditable(intent)) {
    throw new Error('This booking has been attempted; its payload is frozen until sync resolves it')
  }
  // Back to pending with the error cleared: the owner has changed what is being asked, so the
  // previous refusal no longer describes it.
  return { ...intent, payload, state: 'pending', lastError: undefined }
}
```

- [ ] **Step 4: Run the test again**

Run: `npm run --workspace web test -- intents`
Expected: PASS, all seven tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/offline/intents.ts web/tests/intents.test.ts
git commit -m "feat(web): model an offline booking as desired state rather than a mutation log"
```

---

## Task 4: `applyIntents`, the single answer to "what does the owner see"

This is the largest test surface in the plan. Everything the owner looks at while offline reads through this function, so a mistake here is a mistake in every screen at once.

**Files:**

- Create: `web/src/offline/overlay.ts`
- Test: `web/tests/overlay.test.ts`

**Interfaces:**

- Consumes: `Intent`, `CreatePayload` (Task 3); `CalendarView`, `Booking`, `House` from `web/src/api.ts`; `eachNight` from `web/src/calendar/nights.ts`
- Produces:
  - `interface OverlayBooking extends Booking { pending?: { intentId: string; state: IntentState } }`
  - `interface OverlayView { houses: CalendarHouse[]; bookings: OverlayBooking[] }`
  - `applyIntents(view: CalendarView, intents: Intent[], houses: House[]): OverlayView`

- [ ] **Step 1: Write the failing test**

Create `web/tests/overlay.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { CalendarView, House } from '../src/api'
import { applyIntents } from '../src/offline/overlay'
import { newCreateIntent, type CreatePayload, type Intent } from '../src/offline/intents'

const HOUSE_ID = '22222222-2222-4222-8222-222222222222'

const HOUSES: House[] = [
  {
    id: HOUSE_ID,
    engine_resource_id: 'res-a',
    name: 'Дом у озера',
    price_per_night: 30000,
    checkout_time: '11:00',
    checkin_time: '14:00',
    addons: [{ id: 'a1', code: 'sauna', label: 'Баня', default_price: 5000 }],
  },
]

const VIEW: CalendarView = {
  houses: [
    {
      id: HOUSE_ID,
      name: 'Дом у озера',
      nights: [
        { date: '2026-10-01', available: true },
        { date: '2026-10-02', available: true },
        { date: '2026-10-03', available: true },
      ],
    },
  ],
  bookings: [],
}

const PAYLOAD: CreatePayload = {
  house_id: HOUSE_ID,
  check_in: '2026-10-01',
  check_out: '2026-10-03',
  guest: { name: 'Аня', phone: '+375291234567' },
  price_per_night: 30000,
  addons: [{ code: 'sauna' }],
  deposit: 10000,
}

function pending(payload: CreatePayload = PAYLOAD): Intent {
  return newCreateIntent(payload, 'RUB')
}

describe('applyIntents', () => {
  it('returns the view untouched when nothing is queued', () => {
    // Compared against an independent clone, not against VIEW itself: the function used to
    // hand back the very object it was given, so `toEqual(VIEW)` compared it to itself and
    // would have passed even if the body had mutated it in place.
    const before = structuredClone(VIEW)
    const result = applyIntents(VIEW, [], HOUSES)

    expect(result).toEqual(before)
    expect(VIEW).toEqual(before)
    expect(result.bookings).not.toBe(VIEW.bookings)
  })

  it('shows a queued booking on the calendar', () => {
    const intent = pending()
    const { bookings } = applyIntents(VIEW, [intent], HOUSES)

    expect(bookings).toHaveLength(1)
    expect(bookings[0]?.guest?.name).toBe('Аня')
    expect(bookings[0]?.check_in).toBe('2026-10-01')
    expect(bookings[0]?.check_out).toBe('2026-10-03')
  })

  it('marks it as pending, so no screen can mistake it for engine truth', () => {
    const intent = pending()
    const { bookings } = applyIntents(VIEW, [intent], HOUSES)

    expect(bookings[0]?.pending).toEqual({ intentId: intent.id, state: 'pending' })
  })

  it('takes the nights it covers, and only those', () => {
    // Two nights: the 1st and the 2nd. The 3rd is the checkout day and stays free.
    const { houses } = applyIntents(VIEW, [pending()], HOUSES)

    expect(houses[0]?.nights).toEqual([
      { date: '2026-10-01', available: false },
      { date: '2026-10-02', available: false },
      { date: '2026-10-03', available: true },
    ])
  })

  it('totals the stay from the captured price and add-ons', () => {
    // Two nights at 300.00 plus a 50.00 sauna, less a 100.00 deposit.
    const { bookings } = applyIntents(VIEW, [pending()], HOUSES)

    expect(bookings[0]?.total).toBe(65000)
    expect(bookings[0]?.deposit).toBe(10000)
    expect(bookings[0]?.balance).toBe(55000)
  })

  it('labels add-ons from the house, so the sheet reads the same as it would online', () => {
    const { bookings } = applyIntents(VIEW, [pending()], HOUSES)
    expect(bookings[0]?.addons).toEqual([{ code: 'sauna', label: 'Баня', price: 5000 }])
  })

  it('renders in the currency captured, not the one in force now', () => {
    const intent = { ...pending(), currency: 'BYN' }
    expect(applyIntents(VIEW, [intent], HOUSES).bookings[0]?.currency).toBe('BYN')
  })

  it('leaves a conflicted intent on the calendar rather than hiding it', () => {
    // A hidden booking is a night the owner believes is free.
    const intent: Intent = { ...pending(), state: 'conflict', attempted: true }
    const { bookings, houses } = applyIntents(VIEW, [intent], HOUSES)

    expect(bookings[0]?.pending?.state).toBe('conflict')
    expect(houses[0]?.nights[0]?.available).toBe(false)
  })

  it('keeps engine bookings alongside queued ones', () => {
    const withBooking: CalendarView = {
      ...VIEW,
      bookings: [
        {
          id: 'engine-1',
          house_id: HOUSE_ID,
          house_name: 'Дом у озера',
          check_in: '2026-10-05',
          check_out: '2026-10-06',
          nights: 1,
          status: 'confirmed',
          price_per_night: 30000,
          addons: [],
          currency: 'RUB',
          total: 30000,
          deposit: 0,
          balance: 30000,
          note: null,
          guest: { id: 'g1', name: 'Пётр', phone: '+375291112233', note: null },
          orphan: false,
        },
      ],
    }

    const { bookings } = applyIntents(withBooking, [pending()], HOUSES)
    expect(bookings).toHaveLength(2)
    expect(bookings.filter((booking) => booking.pending === undefined)).toHaveLength(1)
  })

  it('ignores an intent for a house not in this view', () => {
    // A month the owner has paged away from, or a house since deleted.
    const elsewhere = pending({ ...PAYLOAD, house_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' })
    const before = structuredClone(VIEW)
    const result = applyIntents(VIEW, [elsewhere], HOUSES)

    expect(result).toEqual(before)
    expect(VIEW).toEqual(before)
  })

  it('ignores nights that fall outside the rendered window', () => {
    const later = pending({ ...PAYLOAD, check_in: '2026-11-01', check_out: '2026-11-03' })
    const { houses } = applyIntents(VIEW, [later], HOUSES)

    // The booking is still listed, but no night in this month changes.
    expect(houses[0]?.nights.every((night) => night.available)).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run --workspace web test -- overlay`
Expected: FAIL — cannot resolve `../src/offline/overlay`.

- [ ] **Step 3: Write the implementation**

Create `web/src/offline/overlay.ts`:

```ts
import type { Booking, CalendarHouse, CalendarView, House } from '../api'
import { eachNight, nightsBetween } from '../calendar/nights'
import type { Intent, IntentState } from './intents'

/**
 * The one place that decides what the owner believes is true: the last good read from the
 * server, with everything captured since laid over it.
 *
 * Pure and synchronous on purpose. Every offline-aware screen reads through this, so there is
 * one answer to that question rather than one per component — and it can be tested without a
 * browser, a database or a network.
 */
export interface OverlayBooking extends Booking {
  /** Absent for a booking the engine has confirmed. Present means: wanted, not yet agreed. */
  pending?: { intentId: string; state: IntentState }
}

export interface OverlayView {
  houses: CalendarHouse[]
  bookings: OverlayBooking[]
}

function bookingFor(intent: Intent, house: House | undefined): OverlayBooking {
  const nights = nightsBetween(intent.payload.check_in, intent.payload.check_out)

  // Labelled and priced from the house as it stands, matching what the server would have
  // snapshotted had the request gone through at capture time.
  const addons = intent.payload.addons.flatMap((chosen) => {
    const offered = house?.addons.find((addon) => addon.code === chosen.code)
    return offered === undefined
      ? []
      : [{ code: offered.code, label: offered.label, price: offered.default_price }]
  })

  const total =
    intent.payload.price_per_night * nights + addons.reduce((sum, addon) => sum + addon.price, 0)

  return {
    id: `intent:${intent.id}`,
    house_id: intent.payload.house_id,
    house_name: house?.name ?? null,
    check_in: intent.payload.check_in,
    check_out: intent.payload.check_out,
    nights,
    status: 'confirmed',
    price_per_night: intent.payload.price_per_night,
    addons,
    currency: intent.currency,
    total,
    deposit: intent.payload.deposit,
    balance: total - intent.payload.deposit,
    note: intent.payload.note ?? null,
    guest: {
      id: `intent:${intent.id}`,
      name: intent.payload.guest.name,
      phone: intent.payload.guest.phone,
      note: intent.payload.guest.note ?? null,
    },
    orphan: false,
    pending: { intentId: intent.id, state: intent.state },
  }
}

export function applyIntents(view: CalendarView, intents: Intent[], houses: House[]): OverlayView {
  // Fresh array containers even when nothing applies, so both paths behave the same way. A
  // caller that sometimes gets the cache's own arrays and sometimes a new pair cannot know
  // whether sorting the result in place will corrupt the calendar it reads engine truth from.
  // The leaf objects stay shared; nothing here mutates them.
  const unchanged = (): OverlayView => ({
    ...view,
    houses: [...view.houses],
    bookings: [...view.bookings],
  })

  if (intents.length === 0) return unchanged()

  const rendered = view.houses.map((house) => house.id)
  const relevant = intents.filter((intent) => rendered.includes(intent.payload.house_id))
  if (relevant.length === 0) return unchanged()

  // Every night any queued booking covers, per house. A conflicted intent counts too: until
  // the owner resolves it they still intend to hold those nights, and a night shown free that
  // someone believes is taken is the mistake that costs money.
  const taken = new Map<string, Set<string>>()
  for (const intent of relevant) {
    const nights = taken.get(intent.payload.house_id) ?? new Set<string>()
    for (const night of eachNight(intent.payload.check_in, intent.payload.check_out)) {
      nights.add(night)
    }
    taken.set(intent.payload.house_id, nights)
  }

  return {
    houses: view.houses.map((house) => {
      const nights = taken.get(house.id)
      if (nights === undefined) return house
      return {
        ...house,
        nights: house.nights.map((night) =>
          nights.has(night.date) ? { ...night, available: false } : night,
        ),
      }
    }),
    bookings: [
      ...view.bookings,
      ...relevant.map((intent) =>
        bookingFor(
          intent,
          houses.find((house) => house.id === intent.payload.house_id),
        ),
      ),
    ],
  }
}
```

- [ ] **Step 4: Run the test again**

Run: `npm run --workspace web test -- overlay`
Expected: PASS, all eleven tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/offline/overlay.ts web/tests/overlay.test.ts
git commit -m "feat(web): lay queued bookings over the cached calendar in one pure function"
```

---

## Task 5: The server takes the idempotency key and the captured currency

**Files:**

- Modify: `server/src/modules/bookings/booking.schemas.ts`
- Modify: `server/src/modules/bookings/booking.service.ts:94-136`
- Modify: `tests/ui/helpers.ts` (`bookViaPage` must send the new fields)
- Test: `server/tests/integration/create-booking.test.ts`

**Interfaces:**

- Consumes: `CurrencyCode` from `server/src/modules/settings/settings.schemas.js`
- Produces: `POST /api/bookings` requires `idempotency_key` (uuid) and `currency` (one of the offered codes); `CreateBookingInput` gains both fields

- [ ] **Step 1: Write the failing test**

Append to `server/tests/integration/create-booking.test.ts`. Match the file's existing setup helpers — read the top of the file and reuse whatever it already uses to build an app and seed a house; do not invent a second harness.

```ts
it('books the engine under the key the client chose, so a replay cannot double-book', async () => {
  const key = randomUUID()
  const body = { ...validBody(), idempotency_key: key }

  const first = await app.inject({ method: 'POST', url: '/api/bookings', payload: body })
  const second = await app.inject({ method: 'POST', url: '/api/bookings', payload: body })

  expect(first.statusCode).toBe(201)
  // The engine answers a replayed key with the booking it already made. A server-generated
  // key would have minted a new one here and held the night twice.
  expect(second.statusCode).toBe(201)
  expect(second.json().id).toBe(first.json().id)
})

it('snapshots the currency the client captured, not the one set now', async () => {
  // The owner agreed a price offline in euros; the setting has since moved to roubles.
  await setCurrency('RUB')

  const response = await app.inject({
    method: 'POST',
    url: '/api/bookings',
    payload: { ...validBody(), idempotency_key: randomUUID(), currency: 'EUR' },
  })

  expect(response.statusCode).toBe(201)
  expect(response.json().currency).toBe('EUR')
})

it('refuses a currency that is not on offer', async () => {
  const response = await app.inject({
    method: 'POST',
    url: '/api/bookings',
    payload: { ...validBody(), idempotency_key: randomUUID(), currency: 'XYZ' },
  })
  expect(response.statusCode).toBe(400)
})

it('refuses a request with no idempotency key', async () => {
  const { idempotency_key: _omitted, ...withoutKey } = {
    ...validBody(),
    idempotency_key: randomUUID(),
  }
  const response = await app.inject({ method: 'POST', url: '/api/bookings', payload: withoutKey })

  // Required rather than optional: there is one client, and an optional key degrades
  // silently into exactly the unsafe retry it exists to prevent.
  expect(response.statusCode).toBe(400)
})
```

Add `import { randomUUID } from 'node:crypto'` at the top if it is not already there. `validBody()` and `setCurrency()` are local helpers — if the file has no equivalents, add them next to its existing ones:

```ts
function validBody() {
  return {
    house_id: houseId,
    check_in: monthStart(1),
    check_out: addDays(monthStart(1), 2),
    guest: { name: 'Аня', phone: '+375291234567' },
    price_per_night: 30000,
    addons: [],
    deposit: 0,
    currency: 'RUB',
  }
}

async function setCurrency(code: string): Promise<void> {
  await db.updateTable('settings').set({ currency: code }).execute()
}
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run --workspace server test -- create-booking`
Expected: FAIL — `additionalProperties: false` rejects `idempotency_key` and `currency` with a 400, so the first three tests fail on status.

- [ ] **Step 3: Add the fields to the schema**

In `server/src/modules/bookings/booking.schemas.ts`, add the import and the two fields:

```ts
import { Type } from 'typebox'
import { NonBlankString } from '../../shared/schemas.js'
import { CurrencyCode } from '../settings/settings.schemas.js'
```

Inside `CreateBookingBody`, after `note`:

```ts
    deposit: Type.Optional(Money),
    note: Type.Optional(Type.String({ maxLength: 2000 })),
    /**
     * Chosen by the client and forwarded to the engine, so replaying a request whose answer
     * was lost returns the booking already made rather than holding the night twice. Required:
     * there is one client, and an optional key degrades quietly into an unsafe retry.
     */
    idempotency_key: Type.String({ format: 'uuid' }),
    /**
     * What this booking was agreed in. Sent rather than read from settings because a booking
     * captured offline was priced when it was captured, and a setting changed in between must
     * not reinterpret a number already given to a guest.
     */
    currency: CurrencyCode,
```

- [ ] **Step 4: Use them in the service**

In `server/src/modules/bookings/booking.service.ts`, extend the input type:

```ts
export interface CreateBookingInput {
  house_id: string
  check_in: string
  check_out: string
  guest: { name: string; phone: string; note?: string }
  price_per_night: number
  addons?: Array<{ code: string }>
  deposit?: number
  note?: string
  idempotency_key: string
  currency: string
}
```

Then in `create()`, replace the currency read and the generated key:

```ts
const { guest } = await this.guests.findOrCreate(body.guest)

// Taken from the request, not from settings. The booking records what it was agreed in,
// and for one captured offline that agreement happened before this request was sent.
const currency = body.currency

// The engine first, always. If the write below fails, a booking exists whose guest details
// are missing: the night is correctly held and the calendar shows it as an orphan for the
// owner to repair. The reverse order can leave a row for a booking that does not hold the
// night, which is how two guests end up in one house.
//
// The key is the client's. A retry after a lost answer replays the same one and gets the
// same booking back; a key minted here would have made a second.
const engineBooking = await this.engine.createBooking(
  house.engine_resource_id,
  body.check_in,
  body.check_out,
  body.idempotency_key,
)

// A replayed key comes back from the engine as the booking already made, not a new one.
// Details for it may already sit on this row from the attempt whose answer was lost, so
// inserting unconditionally would collide on `engine_booking_id` — the row is the answer,
// not a duplicate to make. When no row is found the insert below runs and heals an orphan:
// an attempt whose engine call landed and whose local write did not.
const existing = await this.repository.byEngineId(engineBooking.id)
if (existing !== undefined) {
  return this.viewFromRow(engineBooking, house, guest, existing)
}
```

**Without that guard the whole task is defeated.** The engine answers a replay with the booking it
already made, so an unconditional insert violates the `engine_booking_id` unique constraint and the
client receives a 500 — from a request that did hold the night. The retry safety the client key
exists to provide only works if the replay path returns the stored row.

**And the key must be minted where it survives a retry.** In the form it belongs at component
scope, not inside the submit handler: `const [idempotencyKey] = useState(() => crypto.randomUUID())`.
A key minted inside `submit()` is re-minted on every click, so a failed attempt whose request
actually reached the engine is retried under a new key and the night is held twice — the precise
failure this task exists to prevent.

Remove the now-unused `randomUUID` import if nothing else in the file uses it, and drop the `settings.currentCurrency()` call from `create()`. Leave `SettingsService` injected — other methods and the constructor signature stay as they are.

- [ ] **Step 5: Update the Playwright helper, which posts this body directly**

In `tests/ui/helpers.ts`, `bookViaPage` builds its own payload and will now be rejected. Change its signature so callers cannot forget:

```ts
export async function bookViaPage(
  page: { evaluate: <A, R>(fn: (arg: A) => R, arg: A) => Promise<R> },
  payload: Record<string, unknown>,
): Promise<string> {
  return page.evaluate(async (body: Record<string, unknown>) => {
    const response = await fetch('/api/bookings', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      // Filled in here rather than at every call site: the fields are required by the schema
      // and carry no meaning for a test that only wants a booking to exist.
      body: JSON.stringify({ idempotency_key: crypto.randomUUID(), currency: 'RUB', ...body }),
    })
    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`)
    return ((await response.json()) as { id: string }).id
  }, payload)
}
```

- [ ] **Step 6: Run the whole server suite and the UI suite**

Run: `npm run --workspace server test`
Expected: PASS, including the four new tests.

Run: `npx playwright test`
Expected: PASS — the helper change keeps the existing journeys green.

- [ ] **Step 7: Commit**

```bash
git add server/src/modules/bookings/booking.schemas.ts server/src/modules/bookings/booking.service.ts server/tests/integration/create-booking.test.ts tests/ui/helpers.ts
git commit -m "feat(server): take the idempotency key and the agreed currency from the client"
```

---

## Task 6: Cache every good read, and say how old it is

**Files:**

- Create: `web/src/offline/useOffline.ts`
- Modify: `web/src/main.tsx`
- Modify: `web/src/api.ts`
- Test: `web/tests/offline-hooks.test.ts`

**Interfaces:**

- Consumes: `putCache`, `readCache` (Task 2)
- Produces:
  - `isOffline(cause: unknown): boolean` from `web/src/api.ts`
  - `useOnline(): boolean`
  - `useCachedQuery<T>(key: string, queryKey: unknown[], fetcher: () => Promise<T>): { data?: T; fetchedAt?: string; stale: boolean; error: unknown; isPending: boolean; refetch: () => void }`

- [ ] **Step 1: Write the failing test**

Create `web/tests/offline-hooks.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ApiError, isOffline, NotSignedIn } from '../src/api'

describe('isOffline', () => {
  it('recognises the failure api.ts raises when fetch itself throws', () => {
    expect(isOffline(new ApiError('offline', 0, 'Нет связи'))).toBe(true)
  })

  it('does not mistake an answer from the server for being offline', () => {
    // A 500 means the server was reached and failed. Queueing that would hide a real fault.
    expect(isOffline(new ApiError('internal_error', 500, 'Boom'))).toBe(false)
    expect(isOffline(new NotSignedIn('unauthorized', 401, 'Сессия истекла'))).toBe(false)
    expect(isOffline(new TypeError('boom'))).toBe(false)
    expect(isOffline(undefined)).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run --workspace web test -- offline-hooks`
Expected: FAIL — `isOffline` is not exported from `../src/api`.

- [ ] **Step 3: Export `isOffline` from the API module**

Append to `web/src/api.ts`, just after the `NotSignedIn` class:

```ts
/**
 * True only when the request never reached the server. A 500 was answered by a server that is
 * up, and queueing it would hide a real fault behind a "saved offline" notice.
 */
export function isOffline(cause: unknown): boolean {
  return cause instanceof ApiError && cause.code === 'offline'
}
```

- [ ] **Step 4: Run the test again**

Run: `npm run --workspace web test -- offline-hooks`
Expected: PASS.

- [ ] **Step 5: Write the hooks**

Create `web/src/offline/useOffline.ts`:

```ts
import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { putCache, readCache } from './db'

/** Whether the browser believes it has a network. It can be wrong; sync treats it as a hint. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine)

  useEffect(() => {
    function up() {
      setOnline(true)
    }
    function down() {
      setOnline(false)
    }
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])

  return online
}

export interface CachedQuery<T> {
  data: T | undefined
  /** ISO 8601, present only when `data` came from the cache. */
  fetchedAt: string | undefined
  stale: boolean
  error: unknown
  isPending: boolean
  refetch: () => void
}

/**
 * A read that survives losing the network: the answer is written to IndexedDB on every
 * success, and served from there — explicitly stamped as stale — when the server cannot be
 * reached.
 *
 * The stamp is not decoration. Slice 1 rejected an availability cache because a stale grid
 * "would tell the same lie more convincingly", and that reasoning still holds for a cache that
 * claims to be current. This one never claims it.
 */
export function useCachedQuery<T>(
  cacheKey: string,
  queryKey: unknown[],
  fetcher: () => Promise<T>,
): CachedQuery<T> {
  const client = useQueryClient()
  const [fallback, setFallback] = useState<{ value: T; fetchedAt: string } | undefined>()

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const value = await fetcher()
      await putCache(cacheKey, value)
      return value
    },
  })

  const failed = query.error != null

  useEffect(() => {
    if (!failed) {
      setFallback(undefined)
      return
    }
    let live = true
    void readCache<T>(cacheKey).then((entry) => {
      if (live && entry !== undefined) setFallback(entry)
    })
    return () => {
      live = false
    }
  }, [failed, cacheKey])

  // Four ordered branches. Extract them into a pure function and unit-test it: the ordering is
  // the whole correctness of this hook and it cannot be exercised without a React renderer.
  //
  // 1. !failed && data !== undefined  -> fresh: data, no fetchedAt, stale false, no error
  // 2. failed && fallback !== undefined -> stale: the cached value WITH its fetchedAt, error hidden
  // 3. failed && !fallbackChecked     -> pending: the cache read is still in flight
  // 4. otherwise                      -> surface the error
  return resolveCachedQuery({
    failed,
    data: query.data,
    fallback,
    fallbackChecked,
    error: query.error,
  })
}
```

**Branch 1 must be gated on `!failed`, and this is not a detail.** TanStack Query's error reducer
spreads `...state` and never clears `data`, so `data` and `error` coexist after a failed refetch.
Returning early on `query.data !== undefined` therefore fires on every failure that follows an
earlier success — the owner loads the calendar, loses signal, a focus-refetch fails — and hands
back the old in-memory grid reported as `stale: false` with no `fetchedAt`. That is an unstamped
stale availability grid, which is the "everything is free" failure the fourth invariant forbids and
the exact outcome the no-cache decision was protecting against. The stamp is the only thing making
this cache defensible; a path that bypasses it reinstates the rejected design.

Branch 3 exists so that going offline does not flash an error for one frame before the stale grid
appears. And `readCache` needs a `.catch` that still marks the read checked, or an IndexedDB
failure leaves the hook pending forever.

- [ ] **Step 6: Correct the query defaults and their comment**

In `web/src/main.tsx`, replace the `defaultOptions` block. The old comment forbids exactly what this slice introduces, so it is rewritten rather than left to contradict the code:

```ts
const client = new QueryClient({
  defaultOptions: {
    queries: {
      // Always refetched, never served from an in-memory cache without asking: the owner is
      // deciding whether a guest fits while looking at this. What may be shown when the server
      // cannot be reached is the IndexedDB cache, and only under a stamp saying how old it is —
      // see `offline/useOffline.ts`.
      staleTime: 0,
      refetchOnWindowFocus: true,
      retry: false,
    },
  },
})
```

- [ ] **Step 7: Run the web suite**

Run: `npm run --workspace web test`
Expected: PASS, every file.

- [ ] **Step 8: Commit**

```bash
git add web/src/api.ts web/src/offline/useOffline.ts web/src/main.tsx web/tests/offline-hooks.test.ts
git commit -m "feat(web): serve the last good read under a staleness stamp when the server is unreachable"
```

---

## Task 7: Capture a booking when the save cannot be sent

**Files:**

- Modify: `web/src/booking/NewBooking.tsx`
- Modify: `web/src/errors.ts`
- Test: `web/tests/capture.test.ts`

**Interfaces:**

- Consumes: `isOffline` (Task 6), `newCreateIntent` (Task 3), `putIntent` (Task 2)
- Produces: `captureOrPost(payload, currency, idempotencyKey, deps): Promise<'sent' | 'queued'>` from `web/src/offline/capture.ts`. The key is the caller's — see the note under Step 3.

The decision of what to do with a failed save is pulled out of the component so it can be tested without rendering React.

- [ ] **Step 1: Write the failing test**

Create `web/tests/capture.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../src/api'
import { captureOrPost } from '../src/offline/capture'
import type { CreatePayload } from '../src/offline/intents'

// The form holds one of these per sheet opening, so a retry replays it rather than minting anew.
const KEY = '33333333-3333-4333-8333-333333333333'

const PAYLOAD: CreatePayload = {
  house_id: '22222222-2222-4222-8222-222222222222',
  check_in: '2026-10-01',
  check_out: '2026-10-03',
  guest: { name: 'Аня', phone: '+375291234567' },
  price_per_night: 30000,
  addons: [],
  deposit: 0,
}

describe('captureOrPost', () => {
  it('posts when the server can be reached, and queues nothing', async () => {
    const post = vi.fn().mockResolvedValue({ id: 'engine-1' })
    const save = vi.fn()

    expect(await captureOrPost(PAYLOAD, 'RUB', KEY, { post, save })).toBe('sent')
    expect(save).not.toHaveBeenCalled()

    // The key travels with the request so a retry of this very call cannot double-book.
    expect(post.mock.calls[0]?.[1]).toMatchObject({ currency: 'RUB' })
    expect(post.mock.calls[0]?.[1]).toHaveProperty('idempotency_key')
  })

  it('queues the booking when the request never reached the server', async () => {
    const post = vi.fn().mockRejectedValue(new ApiError('offline', 0, 'Нет связи'))
    const save = vi.fn()

    expect(await captureOrPost(PAYLOAD, 'RUB', KEY, { post, save })).toBe('queued')
    expect(save).toHaveBeenCalledOnce()
    expect(save.mock.calls[0]?.[0]).toMatchObject({
      payload: PAYLOAD,
      currency: 'RUB',
      state: 'pending',
    })
  })

  it('queues under the same key it tried to post with', async () => {
    const post = vi.fn().mockRejectedValue(new ApiError('offline', 0, 'Нет связи'))
    const save = vi.fn()

    await captureOrPost(PAYLOAD, 'RUB', KEY, { post, save })

    // Otherwise a request that did reach the engine before the connection dropped would be
    // replayed later under a different key, and hold the night twice.
    expect(save.mock.calls[0]?.[0].id).toBe(post.mock.calls[0]?.[1].idempotency_key)
  })

  it('marks a queued intent as attempted, freezing its payload', async () => {
    const post = vi.fn().mockRejectedValue(new ApiError('offline', 0, 'Нет связи'))
    const save = vi.fn()

    await captureOrPost(PAYLOAD, 'RUB', KEY, { post, save })
    expect(save.mock.calls[0]?.[0].attempted).toBe(true)
  })

  it('re-throws anything the server actually answered', async () => {
    const post = vi.fn().mockRejectedValue(new ApiError('slot_unavailable', 409, 'taken'))
    const save = vi.fn()

    // The night is genuinely taken and the owner must see that now, not in a queue.
    await expect(captureOrPost(PAYLOAD, 'RUB', KEY, { post, save })).rejects.toThrow()
    expect(save).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run --workspace web test -- capture`
Expected: FAIL — cannot resolve `../src/offline/capture`.

- [ ] **Step 3: Write the implementation**

Create `web/src/offline/capture.ts`:

```ts
import { isOffline } from '../api'
import { newCreateIntent, type CreatePayload, type Intent } from './intents'

export interface CaptureDeps {
  post: <T>(path: string, body: unknown) => Promise<T>
  save: (intent: Intent) => Promise<void>
}

/**
 * Try to book; queue only if the request never left. Anything the server answered — a taken
 * night, a bad phone number — is the owner's to see now, because queueing it would replay a
 * request already known to fail.
 */
export async function captureOrPost(
  payload: CreatePayload,
  currency: string,
  idempotencyKey: string,
  deps: CaptureDeps,
): Promise<'sent' | 'queued'> {
  // The key comes from the caller, never minted here. The form holds one per sheet opening so a
  // retry after a lost answer replays it; minting inside this function would give every retry a
  // fresh key and let the engine hold the night twice.
  const intent = { ...newCreateIntent(payload, currency), id: idempotencyKey }

  try {
    await deps.post('/api/bookings', {
      ...payload,
      currency,
      idempotency_key: intent.id,
    })
    return 'sent'
  } catch (cause) {
    if (!isOffline(cause)) throw cause

    // Attempted, because the request may have reached the engine before the connection died.
    // Replaying this same key is what resolves that; changing the payload first would be
    // refused as `idempotency_key_reused`.
    await deps.save({ ...intent, attempted: true })
    return 'queued'
  }
}
```

- [ ] **Step 4: Run the test again**

Run: `npm run --workspace web test -- capture`
Expected: PASS, all five tests.

- [ ] **Step 5: Wire it into the form**

In `web/src/booking/NewBooking.tsx`, replace the `submit` function and add the imports:

```ts
import { api, type House } from '../api'
import { captureOrPost } from '../offline/capture'
import { putIntent } from '../offline/db'
```

```ts
async function submit(event: FormEvent) {
  event.preventDefault()
  setBusy(true)
  setError(undefined)
  try {
    const outcome = await captureOrPost(
      {
        house_id: house.id,
        check_in: checkIn,
        check_out: checkOut,
        guest: { name, phone },
        price_per_night: priceMinor,
        addons: chosen.map((code) => ({ code })),
        deposit: depositMinor,
        ...(note.trim() === '' ? {} : { note }),
      },
      currency.code,
      { post: api.post, save: putIntent },
    )
    onSaved(outcome)
  } catch (cause) {
    setError(messageFor(cause, 'Не удалось сохранить бронь'))
  } finally {
    setBusy(false)
  }
}
```

Change the prop type so the caller learns which happened:

```ts
interface Props {
  house: House
  checkIn: string
  checkOut: string
  onCancel: () => void
  onSaved: (outcome: 'sent' | 'queued') => void
}
```

- [ ] **Step 6: Add the copy for a queued save**

In `web/src/errors.ts`, add to `COPY`:

```ts
  // The queue's own vocabulary. Not server codes — these are raised here.
  queued: 'Нет сети. Бронь сохранена на телефоне и уйдёт, когда появится связь.',
  idempotency_key_reused: 'Эта бронь уже отправлялась. Дождитесь ответа сервера.',
```

- [ ] **Step 7: Update the caller so the app still compiles**

In `web/src/routes/Calendar.tsx`, `onSaved` now takes an argument. For now, ignore it — Task 9 renders the banner that reacts to it:

```ts
          onSaved={() => void refresh()}
```

becomes

```ts
          onSaved={(outcome) => void refresh(outcome)}
```

and `refresh` gains the parameter:

```ts
/** Nothing is optimistic: the calendar is refetched, because a stale one costs money. */
async function refresh(outcome: 'sent' | 'queued' = 'sent') {
  setOpen(undefined)
  dispatch({ type: 'cancel' })
  // A queued booking has nothing new to fetch; the overlay already shows it.
  if (outcome === 'sent') await queryClient.invalidateQueries({ queryKey: ['calendar'] })
}
```

- [ ] **Step 8: Typecheck and run the suite**

Run: `npm run --workspace web build`
Expected: PASS — `tsc --noEmit` clean, then the bundle builds.

Run: `npm run --workspace web test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add web/src/offline/capture.ts web/src/booking/NewBooking.tsx web/src/errors.ts web/src/routes/Calendar.tsx web/tests/capture.test.ts
git commit -m "feat(web): keep a booking on the phone when the save cannot leave it"
```

---

## Task 8: The sync loop

**Files:**

- Create: `web/src/offline/sync.ts`
- Test: `web/tests/sync.test.ts`

**Interfaces:**

- Consumes: `Intent` (Task 3); `ApiError`, `NotSignedIn`, `isOffline` (Tasks 6 and existing)
- Produces:
  - `type SyncOutcome = 'idle' | 'synced' | 'offline' | 'paused' | 'conflicts'`
  - `runSync(deps: SyncDeps): Promise<SyncOutcome>`
  - `interface SyncDeps { post; read; save; drop }`

- [ ] **Step 1: Write the failing test**

Create `web/tests/sync.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { ApiError, NotSignedIn } from '../src/api'
import { runSync, type SyncDeps } from '../src/offline/sync'
import { newCreateIntent, type CreatePayload, type Intent } from '../src/offline/intents'

const PAYLOAD: CreatePayload = {
  house_id: '22222222-2222-4222-8222-222222222222',
  check_in: '2026-10-01',
  check_out: '2026-10-03',
  guest: { name: 'Аня', phone: '+375291234567' },
  price_per_night: 30000,
  addons: [],
  deposit: 0,
}

function deps(
  intents: Intent[],
  post: SyncDeps['post'],
): SyncDeps & {
  saved: Intent[]
  dropped: string[]
} {
  const saved: Intent[] = []
  const dropped: string[] = []
  return {
    post,
    read: async () => intents,
    save: async (intent) => void saved.push(intent),
    drop: async (id) => void dropped.push(id),
    saved,
    dropped,
  }
}

describe('runSync', () => {
  it('does nothing when the queue is empty', async () => {
    const post = vi.fn()
    expect(await runSync(deps([], post))).toBe('idle')
    expect(post).not.toHaveBeenCalled()
  })

  it('sends a pending intent and drops it once the server has it', async () => {
    const intent = newCreateIntent(PAYLOAD, 'RUB')
    const context = deps([intent], vi.fn().mockResolvedValue({ id: 'engine-1' }))

    expect(await runSync(context)).toBe('synced')
    expect(context.dropped).toEqual([intent.id])
  })

  it('sends the intent id as the idempotency key', async () => {
    const intent = newCreateIntent(PAYLOAD, 'RUB')
    const post = vi.fn().mockResolvedValue({ id: 'engine-1' })
    await runSync(deps([intent], post))

    expect(post.mock.calls[0]?.[1]).toMatchObject({
      idempotency_key: intent.id,
      currency: 'RUB',
      house_id: PAYLOAD.house_id,
    })
  })

  it('processes intents one at a time, in capture order', async () => {
    const first = { ...newCreateIntent(PAYLOAD, 'RUB'), capturedAt: '2026-09-04T09:00:00.000Z' }
    const second = { ...newCreateIntent(PAYLOAD, 'RUB'), capturedAt: '2026-09-04T10:00:00.000Z' }

    const order: string[] = []
    const post = vi
      .fn()
      .mockImplementation(async (_path: string, body: { idempotency_key: string }) => {
        order.push(body.idempotency_key)
        return { id: 'engine-1' }
      })

    // Deliberately handed to sync in the wrong order: two queued creates can overlap each
    // other's nights, so the second must see the first's outcome.
    await runSync(deps([second, first], post))
    expect(order).toEqual([first.id, second.id])
  })

  it('parks a taken night as a conflict for the owner, and stops guessing', async () => {
    const intent = newCreateIntent(PAYLOAD, 'RUB')
    const context = deps(
      [intent],
      vi.fn().mockRejectedValue(new ApiError('slot_unavailable', 409, 'taken')),
    )

    expect(await runSync(context)).toBe('conflicts')
    expect(context.dropped).toEqual([])
    expect(context.saved[0]).toMatchObject({
      state: 'conflict',
      lastError: { code: 'slot_unavailable' },
    })
  })

  it('leaves an intent pending when the server could not be reached', async () => {
    const intent = newCreateIntent(PAYLOAD, 'RUB')
    const context = deps(
      [intent],
      vi.fn().mockRejectedValue(new ApiError('offline', 0, 'Нет связи')),
    )

    expect(await runSync(context)).toBe('offline')
    expect(context.dropped).toEqual([])
    expect(context.saved[0]?.state).toBe('pending')
  })

  it('retries rather than conflicts on the codes the engine calls retryable', async () => {
    for (const [code, status] of [
      ['concurrent_update', 503],
      ['rate_limited', 429],
      ['internal_error', 500],
    ] as const) {
      const intent = newCreateIntent(PAYLOAD, 'RUB')
      const context = deps([intent], vi.fn().mockRejectedValue(new ApiError(code, status, code)))

      expect(await runSync(context)).toBe('offline')
      expect(context.saved[0]?.state).toBe('pending')
    }
  })

  it('pauses the whole queue on a lost session without draining it', async () => {
    const first = { ...newCreateIntent(PAYLOAD, 'RUB'), capturedAt: '2026-09-04T09:00:00.000Z' }
    const second = { ...newCreateIntent(PAYLOAD, 'RUB'), capturedAt: '2026-09-04T10:00:00.000Z' }
    const post = vi.fn().mockRejectedValue(new NotSignedIn('unauthorized', 401, 'Сессия истекла'))
    const context = deps([first, second], post)

    expect(await runSync(context)).toBe('paused')
    // The session is a fixed 30-day TTL, so a long offline stretch expires it. A queue drained
    // by the login screen loses bookings that exist nowhere else.
    expect(context.dropped).toEqual([])
    expect(post).toHaveBeenCalledOnce()
  })

  it('marks an intent attempted before sending, not after', async () => {
    const intent = newCreateIntent(PAYLOAD, 'RUB')
    const context = deps(
      [intent],
      vi.fn().mockRejectedValue(new ApiError('offline', 0, 'Нет связи')),
    )

    await runSync(context)
    expect(context.saved[0]?.attempted).toBe(true)
  })

  it('skips intents already parked as conflicts', async () => {
    const parked: Intent = {
      ...newCreateIntent(PAYLOAD, 'RUB'),
      state: 'conflict',
      attempted: true,
    }
    const post = vi.fn()

    // Resending would earn the same refusal. It is the owner's to resolve.
    expect(await runSync(deps([parked], post))).toBe('conflicts')
    expect(post).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run --workspace web test -- sync`
Expected: FAIL — cannot resolve `../src/offline/sync`.

- [ ] **Step 3: Write the implementation**

Create `web/src/offline/sync.ts`:

```ts
import { ApiError, isOffline, NotSignedIn } from '../api'
import type { Intent } from './intents'

export interface SyncDeps {
  post: <T>(path: string, body: unknown) => Promise<T>
  read: () => Promise<Intent[]>
  save: (intent: Intent) => Promise<void>
  drop: (id: string) => Promise<void>
}

export type SyncOutcome = 'idle' | 'synced' | 'offline' | 'paused' | 'conflicts'

/**
 * Codes the engine documents as transient. They mean "ask again", not "the owner must decide",
 * and treating them as conflicts would put a resolution screen in front of a passing hiccup.
 */
const RETRYABLE = new Set([
  'concurrent_update',
  'rate_limited',
  'internal_error',
  'engine_unreachable',
])

/**
 * Replays the queue against this project's own server — never the engine, whose key is not in
 * this browser and must not be.
 *
 * One intent at a time, in capture order: two queued creates can cover the same nights, and
 * only a serial loop lets the second be judged against the first's result.
 */
export async function runSync(deps: SyncDeps): Promise<SyncOutcome> {
  const queue = (await deps.read()).sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
  if (queue.length === 0) return 'idle'

  let sent = 0
  let deferred = false
  // Counted as we go rather than re-read at the end: a second read would race whatever the
  // page has written since, and the loop already knows every outcome it produced.
  let conflicts = 0

  for (const intent of queue) {
    // Already refused for a reason resending cannot change.
    if (intent.state === 'conflict') {
      conflicts += 1
      continue
    }

    // Recorded before the request leaves, so a connection lost mid-flight still freezes the
    // payload. The engine refuses this key with a different body afterwards.
    const attempt: Intent = { ...intent, state: 'syncing', attempted: true }
    await deps.save(attempt)

    try {
      await deps.post('/api/bookings', {
        ...intent.payload,
        currency: intent.currency,
        idempotency_key: intent.id,
      })
      await deps.drop(intent.id)
      sent += 1
    } catch (cause) {
      if (cause instanceof NotSignedIn) {
        // Park this one and stop. Everything behind it would earn the same 401, and the owner
        // has to sign in before any of it can move.
        await deps.save({ ...attempt, state: 'pending' })
        return 'paused'
      }

      if (isOffline(cause) || (cause instanceof ApiError && RETRYABLE.has(cause.code))) {
        await deps.save({ ...attempt, state: 'pending' })
        deferred = true
        continue
      }

      await deps.save({
        ...attempt,
        state: 'conflict',
        lastError:
          cause instanceof ApiError
            ? { code: cause.code, message: cause.message }
            : { code: 'unknown', message: 'Не удалось отправить' },
      })
      conflicts += 1
    }
  }

  if (conflicts > 0) return 'conflicts'
  if (deferred) return 'offline'
  return sent > 0 ? 'synced' : 'idle'
}
```

- [ ] **Step 4: Run the test again**

Run: `npm run --workspace web test -- sync`
Expected: PASS, all eleven tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/offline/sync.ts web/tests/sync.test.ts
git commit -m "feat(web): replay the queue serially, treating the engine's refusal as the owner's decision"
```

---

## Task 9: The banner, the tray and the sync triggers

**Files:**

- Create: `web/src/offline/ConnectionBanner.tsx`
- Create: `web/src/offline/SyncTray.tsx`
- Create: `web/src/offline/offline.css`
- Modify: `web/src/offline/useOffline.ts`
- Modify: `web/src/App.tsx`

**Interfaces:**

- Consumes: `runSync` (Task 8), `allIntents`, `putIntent`, `dropIntent` (Task 2), `useOnline` (Task 6)
- Produces:
  - `useSync(): { outcome: SyncOutcome; intents: Intent[]; syncNow: () => void; reload: () => void }`
  - `<ConnectionBanner />`, `<SyncTray />`

- [ ] **Step 1: Add the sync hook**

Append to `web/src/offline/useOffline.ts`:

```ts
import { api } from '../api'
import { allIntents, dropIntent, putIntent } from './db'
import { runSync, type SyncOutcome } from './sync'
import type { Intent } from './intents'

export interface Sync {
  outcome: SyncOutcome
  intents: Intent[]
  syncNow: () => void
  reload: () => void
}

/**
 * Runs the queue on every signal that connectivity may have returned.
 *
 * `online` alone is not enough: a browser reports online on a captive portal with no route
 * anywhere. Focus and an explicit button cover what the event misses.
 *
 * Not the Background Sync API, which is Chromium-only — iOS Safari has never shipped it. The
 * consequence is real and documented rather than hidden: close the app while offline and
 * nothing is sent until it is opened again.
 */
export function useSync(): Sync {
  const [outcome, setOutcome] = useState<SyncOutcome>('idle')
  const [intents, setIntents] = useState<Intent[]>([])
  const online = useOnline()

  const reload = useCallback(() => {
    void allIntents().then(setIntents)
  }, [])

  const syncNow = useCallback(() => {
    void runSync({ post: api.post, read: allIntents, save: putIntent, drop: dropIntent })
      .then(setOutcome)
      .finally(reload)
  }, [reload])

  useEffect(reload, [reload])

  useEffect(() => {
    if (!online) {
      setOutcome('offline')
      return
    }
    syncNow()

    function onFocus() {
      if (document.visibilityState === 'visible') syncNow()
    }
    window.addEventListener('online', syncNow)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      window.removeEventListener('online', syncNow)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [online, syncNow])

  return { outcome, intents, syncNow, reload }
}
```

Add `useCallback` to the React import at the top of the file.

- [ ] **Step 2: Write the banner**

Create `web/src/offline/ConnectionBanner.tsx`:

```ts
import type { Intent } from './intents'
import type { SyncOutcome } from './sync'
import './offline.css'

interface Props {
  outcome: SyncOutcome
  intents: Intent[]
  onOpenTray: () => void
  onRetry: () => void
}

/**
 * The owner must never be unsure whether what they are looking at is real. This says so
 * continuously rather than only at the moment of saving.
 */
export function ConnectionBanner({ outcome, intents, onOpenTray, onRetry }: Props) {
  const conflicts = intents.filter((intent) => intent.state === 'conflict').length
  const waiting = intents.length - conflicts

  if (conflicts > 0) {
    return (
      <button className="conn conn--bad" type="button" onClick={onOpenTray}>
        {conflicts === 1 ? 'Одна бронь требует внимания' : `${conflicts} брони требуют внимания`}
      </button>
    )
  }

  if (outcome === 'offline' && waiting > 0) {
    return (
      <button className="conn conn--wait" type="button" onClick={onOpenTray}>
        Нет сети · {waiting} {waiting === 1 ? 'бронь ждёт' : 'брони ждут'} отправки
      </button>
    )
  }

  if (outcome === 'offline') {
    return <p className="conn conn--wait">Нет сети. Календарь показан на память.</p>
  }

  if (outcome === 'paused') {
    return (
      <button className="conn conn--bad" type="button" onClick={onRetry}>
        Сессия истекла. Войдите снова, чтобы отправить брони.
      </button>
    )
  }

  if (waiting > 0) {
    return <p className="conn conn--wait">Отправляем…</p>
  }

  return null
}
```

- [ ] **Step 3: Write the tray**

Create `web/src/offline/SyncTray.tsx`:

```ts
import { Sheet } from '../ui/Sheet'
import { formatStay } from '../booking/BookingDetails'
import type { Intent } from './intents'
import './offline.css'

interface Props {
  intents: Intent[]
  onClose: () => void
  onResolve: (intent: Intent) => void
  onRetry: () => void
}

/** Everything unsent, in one place, rather than hunted for across the calendar. */
export function SyncTray({ intents, onClose, onResolve, onRetry }: Props) {
  return (
    <Sheet
      title="Не отправлено"
      onClose={onClose}
      footer={
        <div className="actions">
          <button className="btn btn--quiet" type="button" onClick={onClose}>
            Закрыть
          </button>
          <button className="btn btn--primary" type="button" onClick={onRetry}>
            Отправить сейчас
          </button>
        </div>
      }
    >
      {intents.length === 0 && <p className="notice">Всё отправлено.</p>}

      <ul className="tray">
        {intents.map((intent) => (
          <li className="tray__row" key={intent.id}>
            <div>
              <p className="tray__who">{intent.payload.guest.name}</p>
              <p className="tray__when">
                {formatStay(intent.payload.check_in, intent.payload.check_out)}
              </p>
            </div>
            {intent.state === 'conflict' ? (
              <button className="btn btn--quiet" type="button" onClick={() => onResolve(intent)}>
                Разобраться
              </button>
            ) : (
              <span className="tray__state">{intent.attempted ? 'Отправляется' : 'Ждёт сети'}</span>
            )}
          </li>
        ))}
      </ul>
    </Sheet>
  )
}
```

`formatStay` is exported from `web/src/booking/NewBooking.tsx`, not `BookingDetails.tsx` — correct the import to `from '../booking/NewBooking'`.

- [ ] **Step 4: Write the styles**

Create `web/src/offline/offline.css`:

```css
/* A strip the width of the screen, above everything, so it cannot be scrolled past. */
.conn {
  display: block;
  width: 100%;
  padding: 0.5rem 1rem;
  border: 0;
  font: inherit;
  font-size: 0.85rem;
  text-align: center;
  cursor: pointer;
}

.conn--wait {
  background: #f4e6c3;
  color: #5b4a1f;
}

.conn--bad {
  background: #f3d0cc;
  color: #6d2019;
}

.tray {
  margin: 0;
  padding: 0;
  list-style: none;
}

.tray__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.75rem 0;
  border-bottom: 1px solid var(--line, #dcdedc);
}

.tray__who {
  margin: 0;
  font-weight: 600;
}

.tray__when,
.tray__state {
  margin: 0;
  font-size: 0.85rem;
  opacity: 0.7;
}
```

- [ ] **Step 5: Mount the banner app-wide**

In `web/src/App.tsx`, render `<ConnectionBanner />` above the routed content and hold the tray's open state. Read the file first and follow its existing structure; the banner belongs outside the router's switch so it shows on every screen.

- [ ] **Step 5b: Read the calendar through the cache and the overlay**

Tasks 4 and 6 produce `applyIntents` and `useCachedQuery` and nothing yet consumes them. Wire them in `web/src/routes/Calendar.tsx`:

- Replace the `calendar` and `houses` `useQuery` calls with `useCachedQuery`, keyed
  `calendar:<from>:<to>` and `houses`.
- Pass the result through `applyIntents(view, intents, houses)` before handing it to
  `Timeline`, taking `intents` from `useSync()`.
- When `stale` is true, render the fetched-at stamp above the grid — for example
  `Календарь на память, обновлён 14:32`. The error notice keeps its current behaviour when
  there is no cache to fall back on, because an empty grid must never render.
- A booking carrying `pending` opens the tray rather than `BookingDetails`: it has no engine
  id, so the details sheet has nothing to fetch.

- [ ] **Step 6: Typecheck and build**

Run: `npm run --workspace web build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/offline/ConnectionBanner.tsx web/src/offline/SyncTray.tsx web/src/offline/offline.css web/src/offline/useOffline.ts web/src/App.tsx
git commit -m "feat(web): say continuously whether the calendar is live and what is still unsent"
```

---

## Task 10: The conflict screen

**Files:**

- Create: `web/src/offline/ConflictScreen.tsx`
- Create: `web/src/offline/conflict.ts`
- Modify: `web/src/App.tsx`
- Test: `web/tests/conflict.test.ts`

**Interfaces:**

- Consumes: `Intent`, `editIntent` (Task 3), `dropIntent`, `putIntent` (Task 2)
- Produces: `conflictReason(intent: Intent): string`; `<ConflictScreen />`

- [ ] **Step 1: Write the failing test**

Create `web/tests/conflict.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { conflictReason } from '../src/offline/conflict'
import { newCreateIntent, type CreatePayload, type Intent } from '../src/offline/intents'

const PAYLOAD: CreatePayload = {
  house_id: '22222222-2222-4222-8222-222222222222',
  check_in: '2026-10-01',
  check_out: '2026-10-03',
  guest: { name: 'Аня', phone: '+375291234567' },
  price_per_night: 30000,
  addons: [],
  deposit: 0,
}

function withError(code: string): Intent {
  return {
    ...newCreateIntent(PAYLOAD, 'RUB'),
    state: 'conflict',
    attempted: true,
    lastError: { code, message: 'whatever the server said' },
  }
}

const CYRILLIC = /[а-яё]/i

describe('conflictReason', () => {
  it('says a taken night was taken, and that nothing was booked', () => {
    const said = conflictReason(withError('slot_unavailable'))
    expect(said).toMatch(CYRILLIC)
    // The owner has to know the booking does not exist, or they will not call the guest back.
    expect(said).toContain('не заведена')
  })

  it('explains a replayed key without using the word idempotency', () => {
    const said = conflictReason(withError('idempotency_key_reused'))
    expect(said).toMatch(CYRILLIC)
    expect(said.toLowerCase()).not.toContain('idempot')
  })

  it('never shows the message the server sent', () => {
    for (const code of ['slot_unavailable', 'outside_schedule', 'invalid_phone', 'something_new']) {
      expect(conflictReason(withError(code))).not.toContain('whatever the server said')
    }
  })

  it('falls back to a usable sentence for a code it does not know', () => {
    expect(conflictReason(withError('something_new'))).toMatch(CYRILLIC)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run --workspace web test -- conflict`
Expected: FAIL — cannot resolve `../src/offline/conflict`.

- [ ] **Step 3: Write the reason helper**

Create `web/src/offline/conflict.ts`:

```ts
import type { Intent } from './intents'

/**
 * Why the engine refused, in the owner's language and in terms of what they should do next.
 *
 * Deliberately separate from `errors.ts`: the same code means something different here. On a
 * form, `slot_unavailable` means "pick other nights". In the queue it also has to say that
 * the booking they wrote down half a day ago does not exist.
 */
const REASONS: Record<string, string> = {
  slot_unavailable:
    'Эти ночи заняли, пока телефон был без сети. Бронь не заведена — выберите другие даты или другой дом.',
  outside_schedule: 'Эти даты вне расписания дома. Бронь не заведена.',
  resource_inactive: 'Дом закрыт для брони. Бронь не заведена.',
  idempotency_key_reused:
    'Эту бронь уже отправляли с другими данными. Заведите её заново, чтобы не задвоить.',
  invalid_phone: 'Номер телефона не принят. Поправьте его и отправьте снова.',
  validation_error: 'Сервер не принял данные брони. Проверьте поля и отправьте снова.',
  not_found: 'Дом больше не существует. Бронь не заведена.',
}

const GENERIC =
  'Сервер не принял эту бронь. Бронь не заведена — проверьте данные и попробуйте снова.'

export function conflictReason(intent: Intent): string {
  return REASONS[intent.lastError?.code ?? ''] ?? GENERIC
}
```

- [ ] **Step 4: Run the test again**

Run: `npm run --workspace web test -- conflict`
Expected: PASS, all four tests.

- [ ] **Step 5: Write the screen**

Create `web/src/offline/ConflictScreen.tsx`:

```ts
import { Sheet } from '../ui/Sheet'
import { formatStay } from '../booking/NewBooking'
import { conflictReason } from './conflict'
import type { Intent } from './intents'
import './offline.css'

interface Props {
  intent: Intent
  onClose: () => void
  /** Re-open the booking form with these details, so nothing is retyped. */
  onRebook: (intent: Intent) => void
  onDiscard: (intent: Intent) => void
}

export function ConflictScreen({ intent, onClose, onRebook, onDiscard }: Props) {
  return (
    <Sheet
      title="Бронь не прошла"
      onClose={onClose}
      footer={
        <div className="actions">
          <button className="btn btn--quiet" type="button" onClick={() => onDiscard(intent)}>
            Удалить
          </button>
          <button className="btn btn--primary" type="button" onClick={() => onRebook(intent)}>
            Выбрать другие даты
          </button>
        </div>
      }
    >
      <p className="notice notice--bad" role="alert">
        {conflictReason(intent)}
      </p>

      {/* What was wanted, kept whole: the owner re-decides the nights, never the booking. */}
      <dl className="tray__what">
        <dt>Гость</dt>
        <dd>{intent.payload.guest.name}</dd>
        <dt>Телефон</dt>
        <dd>{intent.payload.guest.phone}</dd>
        <dt>Даты</dt>
        <dd>{formatStay(intent.payload.check_in, intent.payload.check_out)}</dd>
      </dl>
    </Sheet>
  )
}
```

- [ ] **Step 6: Wire it to the tray**

In `web/src/App.tsx`, hold the intent being resolved. `onRebook` drops the intent and opens the calendar's booking sheet pre-filled from `intent.payload`; `onDiscard` calls `dropIntent(intent.id)` and reloads the queue. Follow the structure already established in Task 9.

- [ ] **Step 7: Typecheck, build, run the whole web suite**

Run: `npm run --workspace web build && npm run --workspace web test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add web/src/offline/ConflictScreen.tsx web/src/offline/conflict.ts web/src/App.tsx web/tests/conflict.test.ts
git commit -m "feat(web): show what was wanted beside what the engine said, and keep the details"
```

---

## Task 11: The end-to-end journeys

**Files:**

- Create: `tests/ui/offline-booking.spec.ts`

**Interfaces:**

- Consumes: everything above; `seedHouse`, `resetAppDb`, `setOwnerPassword`, `monthStart`, `bookViaPage` from `tests/ui/helpers.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/ui/offline-booking.spec.ts`. Use a month offset no other spec file uses — read the other spec files and take the next free one, because `resetAppDb` clears this project's tables while the engine keeps its bookings for the whole run.

```ts
import { expect, test } from '@playwright/test'
import { addDays } from '../../web/src/calendar/nights'
import { bookViaPage, monthStart, resetAppDb, seedHouse, setOwnerPassword } from './helpers'

const PASSWORD = 'correct horse battery staple'

// Pick an offset no other spec uses; the engine's bookings outlive resetAppDb.
const MONTH = monthStart(6)

test.beforeEach(async ({ page }) => {
  await resetAppDb()
  await setOwnerPassword(PASSWORD)
  await seedHouse('Дом у озера', 'A')

  await page.goto('/')
  await page.getByLabel('Пароль').fill(PASSWORD)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByText('Календарь')).toBeVisible()
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
})

test('a booking taken with no signal reaches the engine when the signal returns', async ({
  page,
  context,
}) => {
  await context.setOffline(true)
  await page.reload()

  // The grid is the cached one, and it says so rather than pretending to be live.
  await expect(page.getByText(/Нет сети/)).toBeVisible()

  await page
    .getByRole('button', { name: new RegExp(`${MONTH.slice(8, 10)}`) })
    .first()
    .click()
  await page.getByLabel('Имя').fill('Аня')
  await page.getByLabel('Телефон').fill('+375291234567')
  await page.getByRole('button', { name: 'Сохранить' }).click()

  await expect(page.getByText(/ждёт отправки|ждут отправки/)).toBeVisible()

  await context.setOffline(false)
  await page.reload()

  // Nothing left unsent, and the booking is now the engine's.
  await expect(page.getByText(/ждёт отправки|ждут отправки/)).toBeHidden()
  await expect(page.getByText('Аня')).toBeVisible()

  const bookings = await page.evaluate(async (month: string) => {
    const response = await fetch(`/api/calendar?from=${month}&to=${month.slice(0, 8)}28`, {
      credentials: 'same-origin',
    })
    return ((await response.json()) as { bookings: Array<{ guest: { name: string } | null }> })
      .bookings
  }, MONTH)

  expect(bookings.filter((booking) => booking.guest?.name === 'Аня')).toHaveLength(1)
})

test('a night taken while offline is escalated, not silently dropped', async ({
  page,
  context,
}) => {
  const checkIn = addDays(MONTH, 10)
  const checkOut = addDays(MONTH, 12)

  await context.setOffline(true)
  await page.reload()

  await page
    .getByRole('button', { name: new RegExp(String(Number(checkIn.slice(8, 10)))) })
    .first()
    .click()
  await page.getByLabel('Имя').fill('Аня')
  await page.getByLabel('Телефон').fill('+375291234567')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByText(/ждёт отправки|ждут отправки/)).toBeVisible()

  // Someone takes the night behind the app's back while it is still offline.
  await context.setOffline(false)
  const houseId = await page.evaluate(async () => {
    const response = await fetch('/api/houses', { credentials: 'same-origin' })
    return ((await response.json()) as Array<{ id: string }>)[0]!.id
  })
  await bookViaPage(page, {
    house_id: houseId,
    check_in: checkIn,
    check_out: checkOut,
    guest: { name: 'Пётр', phone: '+375291112233' },
    price_per_night: 30000,
    addons: [],
    deposit: 0,
  })

  await page.reload()

  // Escalated to the owner, with the details kept.
  await expect(page.getByText(/требует внимания|требуют внимания/)).toBeVisible()
  await page.getByText(/требует внимания|требуют внимания/).click()
  await page.getByRole('button', { name: 'Разобраться' }).click()
  await expect(page.getByText(/Эти ночи заняли/)).toBeVisible()
  await expect(page.getByText('Аня')).toBeVisible()

  // And no duplicate was made.
  const bookings = await page.evaluate(async (month: string) => {
    const response = await fetch(`/api/calendar?from=${month}&to=${month.slice(0, 8)}28`, {
      credentials: 'same-origin',
    })
    return ((await response.json()) as { bookings: Array<{ guest: { name: string } | null }> })
      .bookings
  }, MONTH)

  expect(bookings.filter((booking) => booking.guest?.name === 'Аня')).toHaveLength(0)
  expect(bookings.filter((booking) => booking.guest?.name === 'Пётр')).toHaveLength(1)
})
```

- [ ] **Step 2: Run it**

Run: `npm run --workspace web build && npx playwright test tests/ui/offline-booking.spec.ts`
Expected: FAIL initially on selector details — the calendar's night buttons and the login labels must match what the app actually renders. Fix the selectors against the real DOM rather than changing the app to suit the test, unless the app genuinely lacks an accessible name.

- [ ] **Step 3: Make both journeys pass**

Adjust selectors and, where a control has no accessible name, add one. Do not weaken an assertion to make it pass — the duplicate check and the "не заведена" copy are the point of the test.

- [ ] **Step 4: Run the whole suite**

Run: `npx playwright test`
Expected: PASS, every spec including the existing ones.

- [ ] **Step 5: Commit**

```bash
git add tests/ui/offline-booking.spec.ts
git commit -m "test(ui): prove a booking survives a dead zone, and that a lost race is escalated"
```

---

## Task 12: Tell the architecture document what changed

Spec §9 makes this an obligation, not a nicety: the IndexedDB cache holds dates and booking statuses, which the server deliberately does not. A reader who finds that without explanation will conclude the second invariant was broken.

**Files:**

- Modify: `docs/architecture.md`

- [ ] **Step 1: Read the two sections that are now wrong**

Read `docs/architecture.md` §"The four invariants" and the section covering an unreachable engine. Both describe behaviour this slice changes.

- [ ] **Step 2: Correct the second invariant's wording**

Under "The engine is the single source of truth for occupancy", add:

```markdown
The browser keeps a cache of the last calendar it read, in IndexedDB, so a booking can be taken
with no network. It holds dates and statuses; the **server** still holds neither. The invariant
is about this project's records drifting from the engine's, and a cache that is never written
back cannot drift into anything — it is replaced wholesale by the next successful read and is
never merged with one. It is rendered only under a stamp saying when it was fetched.
```

- [ ] **Step 3: Correct the fourth invariant's section**

Under the unreachable-engine section, replace the claim that there is no cache:

```markdown
**An empty grid is still never rendered.** What may be rendered when the engine cannot be
reached is the last calendar this browser successfully read, under a stamp saying how old it is,
so the owner can record a booking taken in a dead zone. Anything captured that way is marked
unconfirmed until the engine accepts it, and the engine's refusal is escalated to the owner
rather than resolved automatically. See
[the offline bookings spec](superpowers/specs/2026-09-03-offline-bookings-design.md) for why
this reverses Slice 1's decision to keep no cache at all.

Sync runs when the app is open — on reconnect, on focus, after login, and on demand. It is not
the Background Sync API, which iOS Safari does not implement: **close the app while offline and
nothing is sent until it is opened again.**
```

- [ ] **Step 4: Add the create path's new inputs**

Wherever the document describes `POST /api/bookings`, record that the client now supplies
`idempotency_key` and `currency`, and why: a replayed request returns the booking already made
rather than holding the night twice, and a booking captured offline keeps the currency it was
agreed in.

- [ ] **Step 5: Check nothing else contradicts**

Run: `grep -n -i "cache\|offline\|stale" docs/architecture.md`
Read each hit and correct any that now states the opposite of what ships.

- [ ] **Step 6: Commit**

```bash
git add docs/architecture.md
git commit -m "docs: record the offline cache, the client idempotency key and the sync window"
```

---

## Self-Review

**Spec coverage.**

| Spec section                                       | Task                                                                 |
| -------------------------------------------------- | -------------------------------------------------------------------- |
| §2 The reversal                                    | 6 (the stamp), 12 (documented)                                       |
| §3 Desired state, collapse rules                   | 3 — create-only subset; the cancel-collapse row is Plan 2            |
| §4 Storage, `Intent`, `applyIntents`               | 2, 3, 4                                                              |
| §5 Sync triggers, serial, transitions, freeze rule | 8, 9                                                                 |
| §6 Conflicts                                       | 8 (branching), 10 (screen)                                           |
| §7 Server changes                                  | 5                                                                    |
| §8 Interface — five surfaces                       | 6 (stamp), 9 (banner, tray, pending treatment), 10 (conflict screen) |
| §9 Invariants unchanged                            | 12                                                                   |
| §10 Testing                                        | every task; 11 for the journeys                                      |
| §11 Build order                                    | this plan is the create half                                         |

Not covered, by design: §3's `create`-then-`cancel` collapse, and §6's `update` and `cancel` rows. Those operations do not exist until Plan 2, so testing their collapse now would test unreachable code.

**Gap found and filled:** the spec never says how the app opens with no network. Task 1 adds the service worker and says why it is not in the spec.

**Placeholder scan:** every code step carries real code. Three steps — 9.5, 10.6 and 11.3 — direct the implementer to read an existing file and follow its structure rather than quoting it, because `App.tsx` and the calendar's DOM are not reproduced in this plan. Each names the exact file and the exact decision to make.

**Type consistency:** `Intent`, `CreatePayload`, `IntentState` are defined once in Task 3 and used unchanged in 2, 4, 7, 8, 9, 10. `SyncDeps.post` and `CaptureDeps.post` share the signature of `api.post`. `OverlayBooking.pending` is `{ intentId, state }` in both Task 4's definition and Task 9's consumer. One correction applied inline: Task 9 imported `formatStay` from `BookingDetails`, but it is exported from `NewBooking`.
