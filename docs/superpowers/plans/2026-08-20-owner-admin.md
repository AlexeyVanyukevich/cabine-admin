# The owner's journal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin tool for one owner of two nightly-rented houses: a live calendar of both houses, bookings created through the booking engine, and the guest, price, add-ons and deposit that the engine deliberately knows nothing about.

**Architecture:** A Fastify server with its own Postgres, and a React SPA it serves. The booking engine at `../booking-engine` remains the single source of truth for occupancy — this project stores no dates and no booking status, and joins the two by `engine_booking_id` at render time. Writes reach the engine first, so a failure leaves a booking missing its guest details rather than a record that does not hold the night.

**Tech Stack:** Node 24 · TypeScript strict · Fastify 5 · TypeBox · Kysely + `pg` · PostgreSQL 16 · React 19 + Vite · React Router · TanStack Query · Vitest + Testcontainers · Playwright

**Spec:** [2026-08-19-owner-admin-design.md](../specs/2026-08-19-owner-admin-design.md)

**Engine contract:** [architecture.md](../../../../booking-engine/docs/architecture.md) · [conventions.md](../../../../booking-engine/docs/conventions.md)

## Global Constraints

Restated here because a task may be executed by someone who sees only that task.

- TypeScript `strict: true`, NodeNext modules on the server. Relative imports carry a `.js` extension even in `.ts` files. No `any` outside Kysely migration signatures.
- The TypeBox package is `typebox` (not `@sinclair/typebox`), paired with `@fastify/type-provider-typebox`.
- Errors keep the shape `{ error, message, details? }`. Unknown fields in a request body are rejected, never ignored — `additionalProperties: false` on every body schema.
- **All money is integer minor units (копейки).** No `float`, no `number` holding rubles, anywhere near a total.
- **This project stores no booking dates and no booking status.** They come from the engine on every read. A task that adds such a column is wrong.
- **Writes go to the engine first, the local row second.** Never the reverse.
- **The engine API key is read from `ENGINE_API_KEY` in `server/src/engine/client.ts` and named nowhere else.** It must never be sent to the browser or embedded in the SPA bundle.
- **An unreachable engine renders an error, never an empty calendar.** An empty grid reads as "everything is free".
- Dates for the grid are derived from the offset the engine returns, never via `new Date()` in the browser.
- Test-driven: the failing test is written and run before the implementation, in every task.
- Commit at the end of every task.

## File Structure

**Server:**

| File | Responsibility |
| --- | --- |
| `server/src/config.ts` | Environment parsing, one validated object |
| `server/src/app.ts` | `buildApp`, error handler, route registration, static SPA |
| `server/src/server.ts` | Entrypoint |
| `server/src/db/{client,schema,migrate}.ts`, `db/migrations/` | Kysely wiring and the schema |
| `server/src/engine/schema.d.ts` | **Generated** from the engine's OpenAPI. Never hand-edited |
| `server/src/engine/errors.ts` | `EngineError`, code classification, retryability |
| `server/src/engine/client.ts` | The facade: key, timeout, backoff, idempotency |
| `server/src/shared/nights.ts` | Pure: local date extraction, night counting, half-open ranges |
| `server/src/shared/money.ts` | Pure: totals, balance |
| `server/src/shared/errors.ts` | `AppError` subclasses and the Fastify error handler |
| `server/src/modules/auth/` | Password, sessions, the `onRequest` guard, `Origin` check |
| `server/src/modules/houses/` | Houses and their add-ons |
| `server/src/modules/guests/` | Guests, phone normalisation, history |
| `server/src/modules/bookings/` | The engine-first write, the calendar join, orphans |

**Web:**

| File | Responsibility |
| --- | --- |
| `web/src/api.ts` | Typed calls to *this* server, never to the engine |
| `web/src/routes/{Login,Calendar,Guests}.tsx` | Pages |
| `web/src/calendar/{Timeline,NightGrid,useSelection}.tsx` | The month timeline over nights |
| `web/src/booking/BookingForm.tsx` | Guest, price, add-ons, deposit |

**Tests:** `server/tests/{unit,integration}/`, `tests/ui/` (Playwright, whole product).

---

### Task 1: Repository skeleton that boots and tests

**Files:**

- Create: `package.json`, `tsconfig.base.json`, `run`, `docker-compose.yml`, `.env.example`
- Create: `server/package.json`, `server/tsconfig.json`, `server/vitest.config.ts`
- Create: `server/src/config.ts`, `server/src/app.ts`, `server/src/server.ts`
- Test: `server/tests/unit/config.test.ts`, `server/tests/integration/health.test.ts`

**Interfaces:**

- Produces: `loadConfig(env): Config` with `{ databaseUrl, port, engineUrl, engineApiKey, engineTimeoutMs, sessionTtlDays, logLevel }`; `buildApp(deps): Promise<FastifyInstance>` serving `GET /api/health`. `AppDeps` is `{ config, db }` here and gains `engine` in Task 5.

- [ ] **Step 1: Create the workspace root**

`package.json`:

```json
{
  "name": "cabins-admin",
  "private": true,
  "type": "module",
  "workspaces": ["server", "web"],
  "engines": { "node": ">=24.0.0" },
  "scripts": {
    "test": "npm run --workspace server test",
    "build": "npm run --workspace server build && npm run --workspace web build",
    "check": "./run check"
  },
  "devDependencies": { "prettier": "^3.9.6", "typescript": "^7.0.2" }
}
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "target": "ES2023",
    "skipLibCheck": true
  }
}
```

`.prettierrc` — copy the engine's verbatim so both repositories format identically:

```json
{ "semi": false, "singleQuote": true, "printWidth": 100 }
```

- [ ] **Step 2: Create the server workspace**

`server/package.json`:

```json
{
  "name": "@cabins/server",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start": "node dist/src/server.js",
    "dev": "tsx watch src/server.ts",
    "migrate": "tsx src/db/migrate.ts",
    "test": "vitest run",
    "engine:types": "openapi-typescript $ENGINE_URL/docs/json -o src/engine/schema.d.ts"
  },
  "dependencies": {
    "@fastify/static": "^8.0.0",
    "@fastify/type-provider-typebox": "^6.1.0",
    "fastify": "^5.10.0",
    "kysely": "^0.29.4",
    "pg": "^8.22.0",
    "typebox": "^1.3.8"
  },
  "devDependencies": {
    "@testcontainers/postgresql": "^12.0.4",
    "@types/node": "^26.1.2",
    "@types/pg": "^8.20.0",
    "openapi-typescript": "^7.4.0",
    "testcontainers": "^12.0.4",
    "tsx": "^4.23.1",
    "vitest": "^4.1.10"
  }
}
```

`server/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "."
  },
  "include": ["src", "tests"]
}
```

`server/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globalSetup: ['./tests/integration/global-setup.ts'],
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    // The engine image is built once here; a cold build is slow.
    hookTimeout: 180_000,
    pool: 'forks',
    // One database, truncated between cases.
    fileParallelism: false,
  },
})
```

- [ ] **Step 3: Write the failing config test**

`server/tests/unit/config.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { loadConfig } from '../../src/config.js'

const valid = {
  DATABASE_URL: 'postgres://u:p@localhost:5434/cabins',
  ENGINE_URL: 'http://localhost:3000',
  ENGINE_API_KEY: 'bk_live_abcdefgh' + 'A'.repeat(43),
}

describe('loadConfig', () => {
  it('parses a fully specified environment', () => {
    expect(
      loadConfig({ ...valid, PORT: '4000', SESSION_TTL_DAYS: '7', ENGINE_TIMEOUT_MS: '2000' }),
    ).toEqual({
      databaseUrl: valid.DATABASE_URL,
      engineUrl: valid.ENGINE_URL,
      engineApiKey: valid.ENGINE_API_KEY,
      engineTimeoutMs: 2000,
      port: 4000,
      sessionTtlDays: 7,
      logLevel: 'info',
    })
  })

  it('defaults the port, the session lifetime and the engine timeout', () => {
    const config = loadConfig(valid)
    expect(config.port).toBe(4000)
    expect(config.sessionTtlDays).toBe(30)
    expect(config.engineTimeoutMs).toBe(5000)
  })

  it.each(['DATABASE_URL', 'ENGINE_URL', 'ENGINE_API_KEY'])('requires %s', (key) => {
    const incomplete = { ...valid, [key]: '' }
    expect(() => loadConfig(incomplete)).toThrow(new RegExp(key))
  })

  // A trailing slash makes every request path double up: `http://host//resources`.
  it('strips a trailing slash from the engine url', () => {
    expect(loadConfig({ ...valid, ENGINE_URL: 'http://localhost:3000/' }).engineUrl).toBe(
      'http://localhost:3000',
    )
  })

  it('rejects an engine key that is not one', () => {
    expect(() => loadConfig({ ...valid, ENGINE_API_KEY: 'nope' })).toThrow(/ENGINE_API_KEY/)
  })
})
```

- [ ] **Step 4: Run it and watch it fail**

Run: `npm run --workspace server test -- tests/unit/config.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement the config**

`server/src/config.ts`:

```ts
export interface Config {
  databaseUrl: string
  engineUrl: string
  engineApiKey: string
  /** How long a call to the engine may hang before it counts as unreachable. */
  engineTimeoutMs: number
  port: number
  sessionTtlDays: number
  logLevel: string
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]
  if (value === undefined || value.trim() === '') {
    throw new Error(`Invalid configuration: ${key} is required`)
  }
  return value.trim()
}

function positiveInt(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key]?.trim()
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid configuration: ${key} must be a positive integer, got "${raw}"`)
  }
  return value
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const engineApiKey = required(env, 'ENGINE_API_KEY')
  // Checked here rather than on first use: a typo in deployment should stop the process at
  // start, not surface as a 401 the first time the owner opens the calendar.
  if (!/^bk_live_[A-Za-z0-9]{51}$/.test(engineApiKey)) {
    throw new Error('Invalid configuration: ENGINE_API_KEY is not a booking-engine key')
  }

  return {
    databaseUrl: required(env, 'DATABASE_URL'),
    engineUrl: required(env, 'ENGINE_URL').replace(/\/+$/, ''),
    engineApiKey,
    engineTimeoutMs: positiveInt(env, 'ENGINE_TIMEOUT_MS', 5_000),
    port: positiveInt(env, 'PORT', 4000),
    sessionTtlDays: positiveInt(env, 'SESSION_TTL_DAYS', 30),
    logLevel: env.LOG_LEVEL?.trim() || 'info',
  }
}
```

- [ ] **Step 6: Write the failing health test**

`server/tests/integration/health.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildTestApp } from './helpers.js'

let app: FastifyInstance

beforeAll(async () => {
  app = await buildTestApp()
})
afterAll(async () => {
  await app.close()
})

describe('GET /api/health', () => {
  it('answers ok without a session', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok' })
  })

  it('never reveals the engine key', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' })
    expect(response.body).not.toContain('bk_live_')
  })
})
```

- [ ] **Step 7: Implement the app and the entrypoint**

`server/src/app.ts`:

```ts
import Fastify, { type FastifyInstance } from 'fastify'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import type { Kysely } from 'kysely'
import type { Config } from './config.js'
import type { Database } from './db/schema.js'
import { registerErrorHandler } from './shared/errors.js'

export interface AppDeps {
  config: Config
  db: Kysely<Database>
}

declare module 'fastify' {
  interface FastifyInstance {
    db: Kysely<Database>
    config: Config
  }
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: deps.config.logLevel,
      // The engine key travels in this header on every outbound call; a logged request from
      // a debugging session would outlive the key it belongs to.
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
    ajv: { customOptions: { removeAdditional: false } },
  }).withTypeProvider<TypeBoxTypeProvider>()

  app.decorate('db', deps.db)
  app.decorate('config', deps.config)
  registerErrorHandler(app)

  app.get('/api/health', { config: { public: true } }, async () => ({ status: 'ok' }))

  return app
}
```

`server/src/shared/errors.ts` — the same shape as the engine's, so both halves of the product answer alike:

```ts
import type { FastifyError, FastifyInstance } from 'fastify'

export abstract class AppError extends Error {
  abstract readonly statusCode: number
  abstract readonly code: string
  readonly details?: Record<string, unknown>

  constructor(message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = new.target.name
    this.details = details
  }
}

export class ValidationError extends AppError {
  readonly statusCode = 400
  readonly code = 'validation_error'
}

export class NotFoundError extends AppError {
  readonly statusCode = 404
  readonly code = 'not_found'
}

export class ConflictError extends AppError {
  readonly statusCode = 409
  readonly code = 'conflict'
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof AppError) {
      void reply.status(error.statusCode).send({
        error: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      })
      return
    }
    if (error.validation) {
      void reply.status(400).send({
        error: 'validation_error',
        message: error.message,
        details: { issues: error.validation },
      })
      return
    }
    if (typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500) {
      void reply.status(error.statusCode).send({ error: 'bad_request', message: error.message })
      return
    }
    request.log.error({ err: error }, 'unhandled error')
    void reply.status(500).send({ error: 'internal_error', message: 'Internal server error' })
  })

  app.setNotFoundHandler((_request, reply) => {
    void reply.status(404).send({ error: 'not_found', message: 'Route not found' })
  })
}
```

`server/src/server.ts`:

```ts
import { buildApp } from './app.js'
import { loadConfig } from './config.js'
import { createDb } from './db/client.js'

const config = loadConfig(process.env)
const db = createDb(config.databaseUrl)
const app = await buildApp({ config, db })

app.addHook('onClose', async () => {
  await db.destroy()
})

try {
  await app.listen({ port: config.port, host: '0.0.0.0' })
} catch (error) {
  app.log.error(error)
  process.exit(1)
}
```

- [ ] **Step 8: Add the compose file and the environment example**

`docker-compose.yml` — port 5434 on the host, because 5433 is the engine's:

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: cabins
    ports:
      - '5434:5432'
    volumes:
      - db-data:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U postgres -d cabins']
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  db-data:
```

`.env.example`:

```
# Read by `./run` and by docker compose. Plain KEY=value, no quoting.
DATABASE_URL=postgres://postgres:postgres@localhost:5434/cabins
ENGINE_URL=http://localhost:3000
# Issued in the engine's console with the "Site backend" preset. Never goes to the browser.
ENGINE_API_KEY=
# A hung engine must not hang the owner's request.
ENGINE_TIMEOUT_MS=5000
PORT=4000
LOG_LEVEL=info
SESSION_TTL_DAYS=30
```

- [ ] **Step 9: Run both tests**

Run: `npm run --workspace server test`
Expected: PASS. `health.test.ts` needs `tests/integration/helpers.ts`, which Task 2 completes — for now stub it as a function that builds the app against a throwaway container. If that is not yet possible, run only the config test and finish health in Task 2.

- [ ] **Step 10: Commit**

```bash
git add package.json tsconfig.base.json .prettierrc docker-compose.yml .env.example server/
git commit -m "feat: workspace skeleton, config and the health route"
```

---

### Task 2: The test harness that runs a real engine

**Files:**

- Create: `server/tests/integration/global-setup.ts`, `server/tests/integration/helpers.ts`, `server/tests/integration/engine-harness.ts`
- Test: `server/tests/integration/engine-harness.test.ts`

**Interfaces:**

- Produces: `startEngine(): Promise<EngineHandle>` where `EngineHandle = { url: string; apiKey: string; resourceIds: string[]; stop(): Promise<void> }`; `getTestDb()`, `resetDb()`, `buildTestApp()`.

The spec's testing section chose a live engine over a stub: the defects worth catching live in the half-open night interval, the departure-date meeting point, the timezone, and a real `409` under a race — none of which a stub reproduces.

- [ ] **Step 1: Write the failing harness test**

`server/tests/integration/engine-harness.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { inject } from 'vitest'

describe('the engine harness', () => {
  it('publishes a url and a usable key', () => {
    expect(inject('engineUrl')).toMatch(/^http:\/\//)
    expect(inject('engineApiKey')).toMatch(/^bk_live_[A-Za-z0-9]{51}$/)
  })

  it('answers health', async () => {
    const response = await fetch(`${inject('engineUrl')}/health`)
    expect(response.status).toBe(200)
  })

  it('refuses an anonymous call, so the key is doing something', async () => {
    const response = await fetch(`${inject('engineUrl')}/resources`)
    expect(response.status).toBe(401)
  })

  it('has two houses seeded, day-based and anchored at 15:00', async () => {
    const response = await fetch(`${inject('engineUrl')}/resources`, {
      headers: { authorization: `Bearer ${inject('engineApiKey')}` },
    })
    const resources = (await response.json()) as Array<{
      id: string
      slot_duration: string
      slot_anchor_time: string
    }>
    expect(resources).toHaveLength(2)
    for (const resource of resources) {
      expect(resource.slot_duration).toBe('P1D')
      expect(resource.slot_anchor_time).toBe('15:00')
    }
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run --workspace server test -- tests/integration/engine-harness.test.ts`
Expected: FAIL — nothing provides `engineUrl`.

- [ ] **Step 3: Write the harness**

`server/tests/integration/engine-harness.ts`:

```ts
import { GenericContainer, Network, Wait, type StartedTestContainer } from 'testcontainers'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

export interface EngineHandle {
  url: string
  apiKey: string
  /** Two day-based houses anchored at 15:00, open every day of the week. */
  resourceIds: string[]
  stop: () => Promise<void>
}

const ENGINE_REPO = resolve(process.cwd(), '../../booking-engine')

/**
 * The engine is built from the sibling checkout rather than pulled from a registry, because
 * it publishes no image. That makes this the one place where the two repositories touch on
 * disk, so the failure is made explicit rather than surfacing as an opaque Docker error.
 */
function assertEngineCheckout(): void {
  if (!existsSync(resolve(ENGINE_REPO, 'Dockerfile'))) {
    throw new Error(
      `The booking engine is not checked out at ${ENGINE_REPO}. These tests build its image ` +
        'from source. Clone it beside this repository and try again.',
    )
  }
}

export async function startEngine(): Promise<EngineHandle> {
  assertEngineCheckout()

  const network = await new Network().start()

  const db: StartedPostgreSqlContainer = await new PostgreSqlContainer('postgres:16-alpine')
    .withNetwork(network)
    .withNetworkAliases('engine-db')
    .start()

  const internalUrl = `postgres://${db.getUsername()}:${db.getPassword()}@engine-db:5432/${db.getDatabase()}`

  const image = await GenericContainer.fromDockerfile(ENGINE_REPO).build('cabins-admin/engine')

  await (
    await image
      .withNetwork(network)
      .withEnvironment({ DATABASE_URL: internalUrl })
      .withCommand(['node', 'dist/src/db/migrate.js'])
      .withWaitStrategy(Wait.forOneShotStartup())
      .start()
  ).stop()

  const api: StartedTestContainer = await image
    .withNetwork(network)
    .withEnvironment({ DATABASE_URL: internalUrl, LOG_LEVEL: 'warn', PORT: '3000' })
    .withExposedPorts(3000)
    .withWaitStrategy(Wait.forHttp('/health', 3000))
    .start()

  const consoleContainer: StartedTestContainer = await image
    .withNetwork(network)
    .withEnvironment({ DATABASE_URL: internalUrl, LOG_LEVEL: 'warn', CONSOLE_PORT: '3001' })
    .withCommand(['node', 'dist/src/console.js'])
    .withExposedPorts(3001)
    .withWaitStrategy(Wait.forHttp('/tenants', 3001))
    .start()

  const url = `http://${api.getHost()}:${api.getMappedPort(3000)}`
  const consoleUrl = `http://${consoleContainer.getHost()}:${consoleContainer.getMappedPort(3001)}`

  const apiKey = await issueKey(consoleUrl)
  const resourceIds = await seedHouses(url, apiKey)

  return {
    url,
    apiKey,
    resourceIds,
    stop: async () => {
      await consoleContainer.stop()
      await api.stop()
      await db.stop()
      await network.stop()
    },
  }
}

/** The same bootstrap the engine's own `./run smoke` performs, for the same reason. */
async function issueKey(consoleUrl: string): Promise<string> {
  const post = (path: string, fields: Record<string, string>) =>
    fetch(`${consoleUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields),
      redirect: 'manual',
    })

  const created = await post('/tenants', { name: 'cabins-admin tests' })
  if (created.status !== 303) throw new Error(`Console refused a tenant: ${created.status}`)

  const listing = await (await fetch(`${consoleUrl}/tenants`)).text()
  const tenantId = [...listing.matchAll(/([0-9a-f-]{36})\/api-keys/g)].at(-1)?.[1]
  if (tenantId === undefined) throw new Error('Could not find the tenant just created')

  const issued = await post(`/tenants/${tenantId}/api-keys`, {
    name: 'tests',
    preset: 'site_backend',
  })
  const location = issued.headers.get('location')
  if (location === null) throw new Error(`Console refused a key: ${issued.status}`)

  const revealed = await (await fetch(new URL(location, consoleUrl))).text()
  const secret = /bk_live_[A-Za-z0-9]{51}/.exec(revealed)?.[0]
  if (secret === undefined) throw new Error('The console did not reveal a secret')
  return secret
}

/**
 * `site_backend` cannot create resources, so the houses are seeded with a second, wider key
 * that is then discarded — tests must exercise the same authority production has.
 */
async function seedHouses(engineUrl: string, apiKey: string): Promise<string[]> {
  void apiKey
  throw new Error('seedHouses is completed in Step 4')
}
```

- [ ] **Step 4: Seed the houses with a discarded admin key**

Replace `seedHouses`, and extend `issueKey` to take a preset:

```ts
async function seedHouses(consoleUrl: string, engineUrl: string): Promise<string[]> {
  // A back-office key issued only to create the houses, then never used again. Production
  // never holds one, and neither should the tests beyond this line.
  const adminKey = await issueKeyFor(consoleUrl, 'back_office')

  const call = (path: string, init: RequestInit) =>
    fetch(`${engineUrl}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${adminKey}`,
        ...(init.headers ?? {}),
      },
    })

  const ids: string[] = []
  for (const _ of [0, 1]) {
    const created = await call('/resources', {
      method: 'POST',
      body: JSON.stringify({
        timezone: 'Europe/Warsaw',
        slot_duration: 'P1D',
        slot_anchor_time: '15:00',
        capacity: 1,
        concurrency_mode: 'exclusive',
      }),
    })
    if (created.status !== 201) throw new Error(`Seeding a house failed: ${created.status}`)
    const id = ((await created.json()) as { id: string }).id

    // Open every day of the week. Day-based rules carry null times.
    const schedule = [0, 1, 2, 3, 4, 5, 6].map((day_of_week) => ({
      day_of_week,
      start_time: null,
      end_time: null,
    }))
    await call(`/resources/${id}/schedule`, { method: 'PUT', body: JSON.stringify(schedule) })
    ids.push(id)
  }
  return ids
}
```

Both keys come from the same tenant, so `issueKey` becomes `issueKeyFor(consoleUrl, preset)` reusing one tenant id; hoist the tenant creation above both calls.

- [ ] **Step 5: Wire the global setup**

`server/tests/integration/global-setup.ts`:

```ts
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { createDb } from '../../src/db/client.js'
import { runMigrations } from '../../src/db/migrate.js'
import { startEngine, type EngineHandle } from './engine-harness.js'

let ownDb: StartedPostgreSqlContainer
let engine: EngineHandle

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string
    engineUrl: string
    engineApiKey: string
    houseA: string
    houseB: string
  }
}

interface GlobalSetupContext {
  provide: <K extends keyof import('vitest').ProvidedContext>(key: K, value: string) => void
}

export async function setup({ provide }: GlobalSetupContext): Promise<void> {
  ownDb = await new PostgreSqlContainer('postgres:16-alpine').start()
  const databaseUrl = ownDb.getConnectionUri()

  const db = createDb(databaseUrl)
  try {
    await runMigrations(db)
  } finally {
    await db.destroy()
  }

  engine = await startEngine()

  provide('databaseUrl', databaseUrl)
  provide('engineUrl', engine.url)
  provide('engineApiKey', engine.apiKey)
  provide('houseA', engine.resourceIds[0]!)
  provide('houseB', engine.resourceIds[1]!)
}

export async function teardown(): Promise<void> {
  await engine?.stop()
  await ownDb?.stop()
}
```

- [ ] **Step 6: Write the shared helpers**

`server/tests/integration/helpers.ts`:

```ts
import { inject } from 'vitest'
import { sql, type Kysely } from 'kysely'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.js'
import { createDb } from '../../src/db/client.js'
import type { Database } from '../../src/db/schema.js'

let cached: Kysely<Database> | undefined

export function getTestDb(): Kysely<Database> {
  cached ??= createDb(inject('databaseUrl'))
  return cached
}

export async function closeTestDb(): Promise<void> {
  await cached?.destroy()
  cached = undefined
}

export async function resetDb(): Promise<void> {
  await sql`truncate table booking_details, guests, house_addon_prices, houses, sessions, owners restart identity cascade`.execute(
    getTestDb(),
  )
}

export async function buildTestApp(): Promise<FastifyInstance> {
  const app = await buildApp({
    config: {
      databaseUrl: inject('databaseUrl'),
      engineUrl: inject('engineUrl'),
      engineApiKey: inject('engineApiKey'),
      engineTimeoutMs: 5_000,
      port: 0,
      sessionTtlDays: 30,
      logLevel: 'silent',
    },
    db: getTestDb(),
  })
  await app.ready()
  return app
}
```

Task 5 Step 8 adds an `engine` to both `AppDeps` and this helper's optional argument; until then `buildApp` takes only the two.

- [ ] **Step 7: Run the harness test**

Run: `npm run --workspace server test -- tests/integration/engine-harness.test.ts`
Expected: PASS. The first run builds the engine image and is slow; subsequent runs reuse the Docker layer cache.

- [ ] **Step 8: Commit**

```bash
git add server/tests/integration/
git commit -m "test: harness that runs the real engine, seeded with two houses"
```

---

### Task 3: Database schema and migrations

**Files:**

- Create: `server/src/db/client.ts`, `server/src/db/schema.ts`, `server/src/db/migrate.ts`, `server/src/db/migrations/{index,001_initial}.ts`
- Test: `server/tests/integration/migrations.test.ts`

**Interfaces:**

- Produces: `Database` with `houses`, `house_addon_prices`, `guests`, `booking_details`, `owners`, `sessions`; `createDb(url)`, `runMigrations(db)`.

- [ ] **Step 1: Write the failing schema test**

`server/tests/integration/migrations.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'kysely'
import { closeTestDb, getTestDb, resetDb } from './helpers.js'

beforeEach(resetDb)
afterAll(closeTestDb)

describe('schema', () => {
  it.each(['houses', 'house_addon_prices', 'guests', 'booking_details', 'owners', 'sessions'])(
    'creates the %s table',
    async (table) => {
      const { rows } = await sql<{ count: string }>`
        select count(*)::text as count from information_schema.tables
        where table_schema = 'public' and table_name = ${table}
      `.execute(getTestDb())
      expect(rows[0]!.count).toBe('1')
    },
  )

  // The forward-compatible half of the login design: reshaping `owners` later is cheap, but
  // a sessions table without this column cannot gain it without a backfill.
  it('ties every session to an owner', async () => {
    const { rows } = await sql<{ is_nullable: string }>`
      select is_nullable from information_schema.columns
      where table_name = 'sessions' and column_name = 'owner_id'
    `.execute(getTestDb())
    expect(rows[0]?.is_nullable).toBe('NO')
  })

  // The single most important structural guarantee: no dates, no status, stored here.
  it.each(['start_time', 'end_time', 'check_in', 'check_out', 'status', 'nights', 'total'])(
    'has no %s column on booking_details',
    async (column) => {
      const { rows } = await sql<{ count: string }>`
        select count(*)::text as count from information_schema.columns
        where table_name = 'booking_details' and column_name = ${column}
      `.execute(getTestDb())
      expect(rows[0]!.count).toBe('0')
    },
  )

  it('stores money as integers', async () => {
    const { rows } = await sql<{ column_name: string; data_type: string }>`
      select column_name, data_type from information_schema.columns
      where (table_name, column_name) in
        (('houses','price_per_night'), ('house_addon_prices','default_price'),
         ('booking_details','price_per_night'), ('booking_details','deposit'))
    `.execute(getTestDb())
    expect(rows).toHaveLength(4)
    for (const row of rows) expect(row.data_type).toBe('integer')
  })

  it('refuses two bookings for the same engine booking', async () => {
    const db = getTestDb()
    const guest = await db
      .insertInto('guests')
      .values({ name: 'Ivan', phone: '+48111222333' })
      .returning('id')
      .executeTakeFirstOrThrow()

    const row = {
      engine_booking_id: '00000000-0000-4000-8000-000000000000',
      guest_id: guest.id,
      price_per_night: 30000,
      addons_snapshot: JSON.stringify([]),
      deposit: 0,
    }
    await db.insertInto('booking_details').values(row).execute()
    await expect(db.insertInto('booking_details').values(row).execute()).rejects.toThrow()
  })

  it('refuses a second guest with the same phone', async () => {
    const db = getTestDb()
    await db.insertInto('guests').values({ name: 'Ivan', phone: '+48111222333' }).execute()
    await expect(
      db.insertInto('guests').values({ name: 'Someone else', phone: '+48111222333' }).execute(),
    ).rejects.toThrow()
  })

  it.each([
    ['a negative price', { price_per_night: -1 }],
    ['a negative deposit', { deposit: -1 }],
  ])('refuses %s', async (_name, override) => {
    const db = getTestDb()
    const guest = await db
      .insertInto('guests')
      .values({ name: 'Ivan', phone: '+48111222333' })
      .returning('id')
      .executeTakeFirstOrThrow()

    await expect(
      db
        .insertInto('booking_details')
        .values({
          engine_booking_id: '00000000-0000-4000-8000-000000000001',
          guest_id: guest.id,
          price_per_night: 30000,
          addons_snapshot: JSON.stringify([]),
          deposit: 0,
          ...override,
        })
        .execute(),
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run --workspace server test -- tests/integration/migrations.test.ts`
Expected: FAIL — no tables.

- [ ] **Step 3: Write the Kysely wiring**

`server/src/db/client.ts`:

```ts
import { Kysely, PostgresDialect } from 'kysely'
import pg from 'pg'
import type { Database } from './schema.js'

// Postgres returns int8 as a string to avoid losing precision; every count in this project
// fits comfortably in a JS number, and a string count is a bug waiting to be concatenated.
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value))

export function createDb(connectionString: string): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString }) }),
  })
}
```

`server/src/db/schema.ts`:

```ts
import type { ColumnType, Generated } from 'kysely'

export interface HousesTable {
  id: Generated<string>
  /** The engine's resource. This project never stores what the engine says about it. */
  engine_resource_id: string
  name: string
  /** Minor units. */
  price_per_night: number
  created_at: Generated<Date>
}

export interface HouseAddonPricesTable {
  id: Generated<string>
  house_id: string
  code: string
  label: string
  default_price: number
}

export interface GuestsTable {
  id: Generated<string>
  name: string
  /** Normalised; this is the guest's identity. */
  phone: string
  note: string | null
  created_at: Generated<Date>
}

/** One add-on as it was priced when the booking was made. */
export interface AddonSnapshot {
  code: string
  label: string
  price: number
}

/**
 * Everything the engine does not know about a booking. Deliberately holds no dates and no
 * status: those come from the engine on every read, so this row cannot disagree with it.
 */
export interface BookingDetailsTable {
  id: Generated<string>
  engine_booking_id: string
  guest_id: string
  price_per_night: number
  addons_snapshot: ColumnType<AddonSnapshot[], string, string>
  deposit: number
  note: string | null
  created_at: Generated<Date>
  updated_at: ColumnType<Date, Date | undefined, Date>
}

/**
 * One row today. An ordinary primary key rather than a secret pinned to `id = 1`, because a
 * row nothing can be joined to has to be rewritten the day a second owner appears.
 */
export interface OwnersTable {
  id: Generated<string>
  /** For display only. There is no username: login asks for the password alone. */
  label: string
  password_hash: string
  created_at: Generated<Date>
  updated_at: ColumnType<Date, Date | undefined, Date>
}

export interface SessionsTable {
  id: Generated<string>
  owner_id: string
  token_hash: string
  expires_at: ColumnType<Date, Date | string, Date | string>
  created_at: Generated<Date>
  last_seen_at: ColumnType<Date, Date | string | undefined, Date | string>
}

export interface Database {
  houses: HousesTable
  house_addon_prices: HouseAddonPricesTable
  guests: GuestsTable
  booking_details: BookingDetailsTable
  owners: OwnersTable
  sessions: SessionsTable
}
```

- [ ] **Step 4: Write the migration**

`server/src/db/migrations/001_initial.ts`:

```ts
import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('houses')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('engine_resource_id', 'uuid', (col) => col.notNull().unique())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('price_per_night', 'integer', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('houses_price_not_negative', sql`price_per_night >= 0`)
    .addCheckConstraint('houses_name_not_blank', sql`length(btrim(name)) > 0`)
    .execute()

  await db.schema
    .createTable('house_addon_prices')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('house_id', 'uuid', (col) =>
      col.notNull().references('houses.id').onDelete('cascade'),
    )
    .addColumn('code', 'text', (col) => col.notNull())
    .addColumn('label', 'text', (col) => col.notNull())
    .addColumn('default_price', 'integer', (col) => col.notNull())
    .addUniqueConstraint('house_addon_prices_code_unique', ['house_id', 'code'])
    .addCheckConstraint('house_addon_prices_price_not_negative', sql`default_price >= 0`)
    .execute()

  await db.schema
    .createTable('guests')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('phone', 'text', (col) => col.notNull().unique())
    .addColumn('note', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('guests_name_not_blank', sql`length(btrim(name)) > 0`)
    .execute()

  await db.schema
    .createTable('booking_details')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    // Not a foreign key: it points into another system's database.
    .addColumn('engine_booking_id', 'uuid', (col) => col.notNull().unique())
    .addColumn('guest_id', 'uuid', (col) =>
      col.notNull().references('guests.id').onDelete('restrict'),
    )
    .addColumn('price_per_night', 'integer', (col) => col.notNull())
    .addColumn('addons_snapshot', 'jsonb', (col) => col.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('deposit', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('note', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('booking_details_price_not_negative', sql`price_per_night >= 0`)
    .addCheckConstraint('booking_details_deposit_not_negative', sql`deposit >= 0`)
    .execute()

  await db.schema.createIndex('booking_details_guest_idx').on('booking_details').column('guest_id').execute()

  // One row today, and no `id = 1` check: a second owner is likely enough that pinning the
  // secret to a fixed key would only have to be undone. See the spec's login section.
  await db.schema
    .createTable('owners')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('label', 'text', (col) => col.notNull())
    .addColumn('password_hash', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  // `owner_id` is here from the first migration on purpose. Reshaping `owners` later is cheap;
  // adding a not-null foreign key to a live sessions table means a backfill or signing
  // everybody out to get one.
  await db.schema
    .createTable('sessions')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('owner_id', 'uuid', (col) =>
      col.notNull().references('owners.id').onDelete('cascade'),
    )
    .addColumn('token_hash', 'text', (col) => col.notNull().unique())
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('last_seen_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  await db.schema.createIndex('sessions_expires_idx').on('sessions').column('expires_at').execute()
  await db.schema.createIndex('sessions_owner_idx').on('sessions').column('owner_id').execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('sessions').execute()
  await db.schema.dropTable('owners').execute()
  await db.schema.dropTable('booking_details').execute()
  await db.schema.dropTable('guests').execute()
  await db.schema.dropTable('house_addon_prices').execute()
  await db.schema.dropTable('houses').execute()
}
```

`server/src/db/migrations/index.ts` and `migrate.ts` mirror the engine's: a static map of migrations and a `runMigrations(db)` that applies them.

- [ ] **Step 5: Run to green**

Run: `npm run --workspace server test -- tests/integration/migrations.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/db/ server/tests/integration/migrations.test.ts
git commit -m "feat: schema for houses, guests, booking details and sessions

booking_details deliberately carries no dates and no status: a test asserts
the absence of those columns, because adding one is how this project would
start disagreeing with the engine.

owners is a table with an ordinary key rather than one hashed secret pinned
to id = 1, and sessions carries owner_id from the first migration. There is
one owner today; the table is cheap to reshape later, while adding a not-null
foreign key to a live sessions table is not."
```

---

### Task 4: Pure night and money arithmetic

**Files:**

- Create: `server/src/shared/nights.ts`, `server/src/shared/money.ts`
- Test: `server/tests/unit/nights.test.ts`, `server/tests/unit/money.test.ts`

**Interfaces:**

- Produces: `localDate(iso: string): string`, `nightsBetween(checkIn: string, checkOut: string): number`, `eachNight(checkIn: string, checkOut: string): string[]`, `addDays(date: string, days: number): string`; `totalFor(input: { pricePerNight: number; nights: number; addons: AddonSnapshot[] }): number`, `balanceFor(total: number, deposit: number): number`.

- [ ] **Step 1: Write the failing night test**

`server/tests/unit/nights.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { addDays, eachNight, localDate, nightsBetween } from '../../src/shared/nights.js'

describe('localDate', () => {
  // The engine renders timestamps in the house's zone. Taking the date from that string is
  // what keeps an owner in another timezone from seeing every booking shifted by a day.
  it('takes the date from the offset the engine sent, not from this machine', () => {
    expect(localDate('2026-09-01T15:00:00+02:00')).toBe('2026-09-01')
    expect(localDate('2026-01-01T00:00:00+13:00')).toBe('2026-01-01')
  })

  it.each(['', 'nonsense', '2026-9-1T15:00:00+02:00', '2026-09-01'])(
    'refuses %j rather than guessing',
    (value) => {
      expect(() => localDate(value)).toThrow(/timestamp/)
    },
  )
})

describe('nightsBetween', () => {
  it.each([
    ['2026-09-01', '2026-09-02', 1],
    ['2026-09-20', '2026-09-22', 2],
    ['2026-09-01', '2026-10-01', 30],
    // A month boundary and a leap day, where naive arithmetic goes wrong.
    ['2028-02-28', '2028-03-01', 2],
  ])('counts %s to %s as %i nights', (from, to, expected) => {
    expect(nightsBetween(from, to)).toBe(expected)
  })

  // Across a daylight-saving change these are plain dates, so no hour is lost or gained.
  it('is unaffected by a daylight-saving transition', () => {
    expect(nightsBetween('2026-03-28', '2026-03-30')).toBe(2)
    expect(nightsBetween('2026-10-24', '2026-10-26')).toBe(2)
  })

  it.each([
    ['2026-09-02', '2026-09-01'],
    ['2026-09-01', '2026-09-01'],
  ])('refuses %s to %s', (from, to) => {
    expect(() => nightsBetween(from, to)).toThrow(/at least one night/)
  })
})

describe('eachNight', () => {
  it('lists the nights, excluding the departure date', () => {
    expect(eachNight('2026-09-20', '2026-09-22')).toEqual(['2026-09-20', '2026-09-21'])
  })

  // The property the whole calendar rests on: the departure date is free for a new arrival.
  it('lets two stays meet on one date without sharing a night', () => {
    const first = eachNight('2026-09-20', '2026-09-22')
    const second = eachNight('2026-09-22', '2026-09-24')
    expect(first.filter((night) => second.includes(night))).toEqual([])
  })
})

describe('addDays', () => {
  it.each([
    ['2026-09-30', 1, '2026-10-01'],
    ['2026-12-31', 1, '2027-01-01'],
    ['2028-02-28', 1, '2028-02-29'],
    ['2026-09-02', -1, '2026-09-01'],
  ])('%s plus %i is %s', (date, days, expected) => {
    expect(addDays(date, days)).toBe(expected)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run --workspace server test -- tests/unit/nights.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`server/src/shared/nights.ts`:

```ts
const TIMESTAMP = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * The calendar date of an engine timestamp, in the house's own zone.
 *
 * The engine renders every timestamp with the resource's offset — `2026-09-01T15:00:00+02:00`
 * — so the first ten characters already *are* the local date. Parsing into a `Date` and asking
 * it for a date would answer in the reader's zone instead, and an owner travelling one zone
 * west would see every booking move by a day.
 */
export function localDate(iso: string): string {
  const match = TIMESTAMP.exec(iso)
  if (match === null) throw new Error(`Not an offset-carrying timestamp: ${JSON.stringify(iso)}`)
  return match[1]!
}

function assertDate(value: string): void {
  if (!DATE.test(value)) throw new Error(`Not a YYYY-MM-DD date: ${JSON.stringify(value)}`)
}

/** Plain dates in UTC, so no zone and no transition can shift the arithmetic. */
function toUtc(date: string): number {
  assertDate(date)
  return Date.parse(`${date}T00:00:00Z`)
}

const DAY_MS = 86_400_000

export function nightsBetween(checkIn: string, checkOut: string): number {
  const nights = (toUtc(checkOut) - toUtc(checkIn)) / DAY_MS
  if (nights < 1) throw new Error('A stay must be at least one night')
  return nights
}

/** The nights a stay occupies. The departure date is not among them. */
export function eachNight(checkIn: string, checkOut: string): string[] {
  const count = nightsBetween(checkIn, checkOut)
  return Array.from({ length: count }, (_, index) => addDays(checkIn, index))
}

export function addDays(date: string, days: number): string {
  return new Date(toUtc(date) + days * DAY_MS).toISOString().slice(0, 10)
}
```

- [ ] **Step 4: Write the failing money test**

`server/tests/unit/money.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { balanceFor, totalFor } from '../../src/shared/money.js'

describe('totalFor', () => {
  it('multiplies nights and adds the extras', () => {
    expect(
      totalFor({
        pricePerNight: 30000,
        nights: 2,
        addons: [{ code: 'sauna', label: 'Баня', price: 5000 }],
      }),
    ).toBe(65000)
  })

  it('handles no extras', () => {
    expect(totalFor({ pricePerNight: 30000, nights: 3, addons: [] })).toBe(90000)
  })

  it('stays an integer — no rounding, ever', () => {
    const total = totalFor({ pricePerNight: 33333, nights: 3, addons: [] })
    expect(Number.isInteger(total)).toBe(true)
    expect(total).toBe(99999)
  })

  it.each([
    ['a fractional price', { pricePerNight: 300.5, nights: 1, addons: [] }],
    ['a fractional night count', { pricePerNight: 300, nights: 1.5, addons: [] }],
    ['a negative price', { pricePerNight: -1, nights: 1, addons: [] }],
    ['no nights', { pricePerNight: 300, nights: 0, addons: [] }],
  ])('refuses %s', (_name, input) => {
    expect(() => totalFor(input)).toThrow()
  })
})

describe('balanceFor', () => {
  it('is what is still owed', () => {
    expect(balanceFor(65000, 20000)).toBe(45000)
  })

  it('is zero when settled', () => {
    expect(balanceFor(65000, 65000)).toBe(0)
  })

  // An overpayment is real — a guest rounds up, or cancels after paying. Showing it as a
  // negative balance is honest; clamping to zero would hide money the owner may owe back.
  it('goes negative on an overpayment rather than clamping', () => {
    expect(balanceFor(65000, 70000)).toBe(-5000)
  })
})
```

- [ ] **Step 5: Implement money**

`server/src/shared/money.ts`:

```ts
import type { AddonSnapshot } from '../db/schema.js'

/**
 * Every amount in this project is an integer in minor units. There is no rounding step here
 * and there must never be one: the moment a total is computed from a float, two screens
 * showing the same booking start disagreeing by a копейка.
 */
function assertMinorUnits(value: number, what: string): void {
  if (!Number.isInteger(value)) throw new Error(`${what} must be an integer in minor units`)
  if (value < 0) throw new Error(`${what} must not be negative`)
}

export function totalFor(input: {
  pricePerNight: number
  nights: number
  addons: AddonSnapshot[]
}): number {
  assertMinorUnits(input.pricePerNight, 'The nightly price')
  if (!Number.isInteger(input.nights) || input.nights < 1) {
    throw new Error('A stay must be a whole number of nights, at least one')
  }
  let total = input.pricePerNight * input.nights
  for (const addon of input.addons) {
    assertMinorUnits(addon.price, `The price of ${addon.code}`)
    total += addon.price
  }
  return total
}

/** Negative when the guest has overpaid. Not clamped — see the test that says why. */
export function balanceFor(total: number, deposit: number): number {
  assertMinorUnits(deposit, 'The deposit')
  return total - deposit
}
```

- [ ] **Step 6: Run both to green**

Run: `npm run --workspace server test -- tests/unit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/shared/nights.ts server/src/shared/money.ts server/tests/unit/
git commit -m "feat: night and money arithmetic, both pure

localDate reads the date out of the engine's offset rather than converting
through a Date, which is what keeps an owner in another timezone from
seeing every booking shifted by a day."
```

---

### Task 5: The engine client

**Files:**

- Create: `server/src/engine/schema.d.ts` (generated), `server/src/engine/errors.ts`, `server/src/engine/client.ts`
- Modify: `server/src/app.ts`, `server/src/server.ts`, `server/tests/integration/helpers.ts`
- Test: `server/tests/unit/engine-errors.test.ts`, `server/tests/integration/engine-client.test.ts`

**Interfaces:**

- Consumes: `Config` (Task 1), the harness (Task 2).
- Produces: `createEngineClient(options)`, and `app.engine` for every task after this one.

```ts
export interface EngineBooking {
  id: string
  resourceId: string
  checkIn: string   // YYYY-MM-DD, house-local
  checkOut: string  // YYYY-MM-DD, house-local
  status: 'held' | 'confirmed' | 'cancelled' | 'completed' | 'no_show' | 'expired'
}
export interface EngineSlot { date: string; available: boolean }

export interface EngineClient {
  listBookings(from: string, to: string): Promise<EngineBooking[]>
  getBooking(id: string): Promise<EngineBooking | undefined>
  availability(resourceId: string, from: string, to: string): Promise<EngineSlot[]>
  createBooking(resourceId: string, checkIn: string, checkOut: string, idempotencyKey: string): Promise<EngineBooking>
  reschedule(id: string, checkIn: string, checkOut: string): Promise<EngineBooking>
  cancel(id: string): Promise<EngineBooking>
}
export class EngineError extends Error { code: string; status: number; details?: unknown }
export class EngineUnreachableError extends Error {}
```

- [ ] **Step 1: Generate the engine types**

With the engine running (`cd ../booking-engine && ./run dev --bg`):

```bash
ENGINE_URL=http://localhost:3000 npm run --workspace server engine:types
git add server/src/engine/schema.d.ts
```

The file is committed. It is never hand-edited: it is the engine's contract, and a second hand-written copy would drift silently while TypeScript kept checking confidently against the stale one.

- [ ] **Step 2: Write the failing classification test**

`server/tests/unit/engine-errors.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { EngineError, isRetryable, isOwnerFacing } from '../../src/engine/errors.js'

const error = (code: string, status: number) => new EngineError(code, status, 'message')

describe('isRetryable', () => {
  // The engine translates contention and refuses to retry on purpose, leaving the decision
  // to its caller. We are the caller.
  it.each(['concurrent_update', 'rate_limited'])('retries %s', (code) => {
    expect(isRetryable(error(code, code === 'rate_limited' ? 429 : 503))).toBe(true)
  })

  it.each(['slot_unavailable', 'outside_schedule', 'unauthorized', 'not_found'])(
    'does not retry %s',
    (code) => {
      expect(isRetryable(error(code, 409))).toBe(false)
    },
  )
})

describe('isOwnerFacing', () => {
  // Things the owner can understand and act on, versus defects and outages.
  it.each(['slot_unavailable', 'outside_schedule', 'resource_inactive'])(
    '%s is something to show the owner',
    (code) => {
      expect(isOwnerFacing(error(code, 409))).toBe(true)
    },
  )

  it.each(['invalid_slot_boundary', 'idempotency_key_reused', 'validation_error'])(
    '%s is a defect on our side, not the owner’s problem',
    (code) => {
      expect(isOwnerFacing(error(code, 400))).toBe(false)
    },
  )

  // A revoked key is an operational alert. Telling the owner "network error" would have
  // them reloading the page for half an hour.
  it('unauthorized is neither retryable nor the owner’s fault', () => {
    expect(isRetryable(error('unauthorized', 401))).toBe(false)
    expect(isOwnerFacing(error('unauthorized', 401))).toBe(false)
  })
})
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npm run --workspace server test -- tests/unit/engine-errors.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the classification**

`server/src/engine/errors.ts`:

```ts
/** An answer from the engine that carries its `{ error, message, details }` body. */
export class EngineError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'EngineError'
  }
}

/** No answer at all: connection refused, DNS failure, or our own timeout. */
export class EngineUnreachableError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message)
    this.name = 'EngineUnreachableError'
  }
}

/**
 * The engine reports contention as `503 concurrent_update` and explicitly does not retry,
 * so that the decision stays with the caller. `429` is a limit we can wait out.
 */
const RETRYABLE = new Set(['concurrent_update', 'rate_limited'])

/**
 * Errors describing something the owner did or can fix, as opposed to defects here and
 * outages over there. The distinction decides whether the interface shows an explanation or
 * an apology.
 */
const OWNER_FACING = new Set([
  'slot_unavailable',
  'outside_schedule',
  'resource_inactive',
  'invalid_state_transition',
  'hold_expired',
  'invalid_interval',
])

export function isRetryable(error: EngineError): boolean {
  return RETRYABLE.has(error.code)
}

export function isOwnerFacing(error: EngineError): boolean {
  return OWNER_FACING.has(error.code)
}
```

- [ ] **Step 5: Write the failing client test against the real engine**

`server/tests/integration/engine-client.test.ts`:

```ts
import { beforeAll, describe, expect, it, inject } from 'vitest'
import { createEngineClient, type EngineClient } from '../../src/engine/client.js'
import { EngineError, EngineUnreachableError } from '../../src/engine/errors.js'

let engine: EngineClient
let houseA: string

beforeAll(() => {
  engine = createEngineClient({
    engineUrl: inject('engineUrl'),
    engineApiKey: inject('engineApiKey'),
  })
  houseA = inject('houseA')
})

const key = () => `test-${Math.random().toString(36).slice(2)}`

describe('availability', () => {
  it('reports nights, in the house’s own dates', async () => {
    const slots = await engine.availability(houseA, '2026-09-01', '2026-09-05')
    expect(slots.map((slot) => slot.date)).toEqual([
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
    ])
    for (const slot of slots) expect(slot.available).toBe(true)
  })
})

describe('createBooking', () => {
  it('creates a confirmed booking and returns house-local dates', async () => {
    const booking = await engine.createBooking(houseA, '2026-10-01', '2026-10-03', key())
    expect(booking.checkIn).toBe('2026-10-01')
    expect(booking.checkOut).toBe('2026-10-03')
    expect(booking.status).toBe('confirmed')
    expect(booking.resourceId).toBe(houseA)
  })

  it('marks the nights unavailable afterwards', async () => {
    await engine.createBooking(houseA, '2026-10-10', '2026-10-12', key())
    const slots = await engine.availability(houseA, '2026-10-09', '2026-10-13')
    const byDate = Object.fromEntries(slots.map((slot) => [slot.date, slot.available]))
    expect(byDate['2026-10-10']).toBe(false)
    expect(byDate['2026-10-11']).toBe(false)
    // The departure date is free again — the property the calendar depends on.
    expect(byDate['2026-10-12']).toBe(true)
  })

  it('lets a new stay start on the previous one’s departure date', async () => {
    await engine.createBooking(houseA, '2026-11-01', '2026-11-03', key())
    const next = await engine.createBooking(houseA, '2026-11-03', '2026-11-05', key())
    expect(next.status).toBe('confirmed')
  })

  it('raises slot_unavailable on an overlap', async () => {
    await engine.createBooking(houseA, '2026-12-01', '2026-12-03', key())
    await expect(
      engine.createBooking(houseA, '2026-12-02', '2026-12-04', key()),
    ).rejects.toMatchObject({ code: 'slot_unavailable' })
  })

  // The reason the facade mints a key per attempt: a retried request must not book twice.
  it('replays an identical request under the same key instead of booking twice', async () => {
    const shared = key()
    const first = await engine.createBooking(houseA, '2027-01-05', '2027-01-07', shared)
    const second = await engine.createBooking(houseA, '2027-01-05', '2027-01-07', shared)
    expect(second.id).toBe(first.id)
  })
})

describe('reschedule and cancel', () => {
  it('moves a booking and frees the old nights', async () => {
    const booking = await engine.createBooking(houseA, '2027-02-01', '2027-02-03', key())
    const moved = await engine.reschedule(booking.id, '2027-02-05', '2027-02-08')

    expect(moved.id).toBe(booking.id)
    expect(moved.checkIn).toBe('2027-02-05')
    const slots = await engine.availability(houseA, '2027-02-01', '2027-02-03')
    expect(slots.every((slot) => slot.available)).toBe(true)
  })

  it('cancels and frees the nights', async () => {
    const booking = await engine.createBooking(houseA, '2027-03-01', '2027-03-03', key())
    expect((await engine.cancel(booking.id)).status).toBe('cancelled')
    const slots = await engine.availability(houseA, '2027-03-01', '2027-03-03')
    expect(slots.every((slot) => slot.available)).toBe(true)
  })
})

describe('listBookings and getBooking', () => {
  it('lists both houses in one call', async () => {
    await engine.createBooking(houseA, '2027-04-01', '2027-04-03', key())
    await engine.createBooking(inject('houseB'), '2027-04-01', '2027-04-03', key())

    const bookings = await engine.listBookings('2027-04-01', '2027-04-05')
    expect(new Set(bookings.map((booking) => booking.resourceId)).size).toBe(2)
  })

  it('answers undefined for a booking that is not there', async () => {
    expect(await engine.getBooking('00000000-0000-4000-8000-000000000000')).toBeUndefined()
  })
})

describe('failure modes', () => {
  it('raises unauthorized for a wrong key, without retrying', async () => {
    const wrong = createEngineClient({
      engineUrl: inject('engineUrl'),
      engineApiKey: `bk_live_${'A'.repeat(51)}`,
    })
    await expect(wrong.availability(houseA, '2026-09-01', '2026-09-02')).rejects.toBeInstanceOf(
      EngineError,
    )
  })

  it('raises EngineUnreachableError when nothing answers', async () => {
    // Port 1 is reserved and refuses immediately, so this does not wait out the timeout.
    const dead = createEngineClient({
      engineUrl: 'http://127.0.0.1:1',
      engineApiKey: `bk_live_${'A'.repeat(51)}`,
    })
    await expect(dead.availability(houseA, '2026-09-01', '2026-09-02')).rejects.toBeInstanceOf(
      EngineUnreachableError,
    )
  })
})
```

- [ ] **Step 6: Implement the facade**

`server/src/engine/client.ts`:

```ts
import { EngineError, EngineUnreachableError, isRetryable } from './errors.js'
import { localDate } from '../shared/nights.js'

export interface EngineBooking {
  id: string
  resourceId: string
  /** House-local, YYYY-MM-DD. */
  checkIn: string
  checkOut: string
  status: 'held' | 'confirmed' | 'cancelled' | 'completed' | 'no_show' | 'expired'
}

export interface EngineSlot {
  date: string
  available: boolean
}

export interface EngineClient {
  listBookings: (from: string, to: string) => Promise<EngineBooking[]>
  getBooking: (id: string) => Promise<EngineBooking | undefined>
  availability: (resourceId: string, from: string, to: string) => Promise<EngineSlot[]>
  createBooking: (
    resourceId: string,
    checkIn: string,
    checkOut: string,
    idempotencyKey: string,
  ) => Promise<EngineBooking>
  reschedule: (id: string, checkIn: string, checkOut: string) => Promise<EngineBooking>
  cancel: (id: string) => Promise<EngineBooking>
}

export interface EngineClientOptions {
  engineUrl: string
  engineApiKey: string
  /** A hung engine must not hang this request; the owner would watch a spinner with no reason. */
  timeoutMs?: number
  maxAttempts?: number
}

interface RawBooking {
  id: string
  resource_id: string
  start_time: string
  end_time: string
  status: EngineBooking['status']
}

export function createEngineClient(options: EngineClientOptions): EngineClient {
  const timeoutMs = options.timeoutMs ?? 5_000
  const maxAttempts = options.maxAttempts ?? 3

  async function call<T>(path: string, init: RequestInit = {}): Promise<T | undefined> {
    let lastError: EngineError | undefined

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let response: Response
      try {
        response = await fetch(`${options.engineUrl}${path}`, {
          ...init,
          headers: {
            'content-type': 'application/json',
            // The only place this key is named.
            authorization: `Bearer ${options.engineApiKey}`,
            ...(init.headers ?? {}),
          },
          signal: AbortSignal.timeout(timeoutMs),
        })
      } catch (cause) {
        throw new EngineUnreachableError(`The booking engine did not answer ${path}`, cause)
      }

      if (response.status === 404) return undefined
      if (response.ok) {
        return response.status === 204 ? undefined : ((await response.json()) as T)
      }

      const body = (await response.json().catch(() => ({}))) as {
        error?: string
        message?: string
        details?: unknown
      }
      lastError = new EngineError(
        body.error ?? 'unknown',
        response.status,
        body.message ?? `The engine answered ${response.status}`,
        body.details,
      )

      if (!isRetryable(lastError) || attempt === maxAttempts) throw lastError
      // Linear backoff is enough: contention here is two of the owner's own tabs, not a herd.
      await new Promise((resolve) => setTimeout(resolve, attempt * 250))
    }

    throw lastError
  }

  const toBooking = (raw: RawBooking): EngineBooking => ({
    id: raw.id,
    resourceId: raw.resource_id,
    checkIn: localDate(raw.start_time),
    checkOut: localDate(raw.end_time),
    status: raw.status,
  })

  return {
    async listBookings(from, to) {
      const raw = (await call<RawBooking[]>(`/bookings?from=${from}&to=${to}`)) ?? []
      return raw.map(toBooking)
    },

    async getBooking(id) {
      const raw = await call<RawBooking>(`/bookings/${id}`)
      return raw === undefined ? undefined : toBooking(raw)
    },

    async availability(resourceId, from, to) {
      const raw = await call<{ slots: Array<{ start: string; available: boolean }> }>(
        `/resources/${resourceId}/availability?from=${from}&to=${to}`,
      )
      return (raw?.slots ?? []).map((slot) => ({
        date: localDate(slot.start),
        available: slot.available,
      }))
    },

    async createBooking(resourceId, checkIn, checkOut, idempotencyKey) {
      const raw = await call<RawBooking>(`/resources/${resourceId}/bookings`, {
        method: 'POST',
        body: JSON.stringify({
          // Deliberately no customer_id. The engine has no way to change it later, so putting
          // our guest id there would make reassigning a booking to another guest impossible
          // to reflect. The guest link lives here, where it can be corrected.
          start_time: `${checkIn}T00:00:00Z`,
          end_time: `${checkOut}T00:00:00Z`,
          idempotency_key: idempotencyKey,
        }),
      })
      if (raw === undefined) throw new EngineError('not_found', 404, `No house ${resourceId}`)
      return toBooking(raw)
    },

    async reschedule(id, checkIn, checkOut) {
      const raw = await call<RawBooking>(`/bookings/${id}/reschedule`, {
        method: 'POST',
        body: JSON.stringify({
          start_time: `${checkIn}T00:00:00Z`,
          end_time: `${checkOut}T00:00:00Z`,
        }),
      })
      if (raw === undefined) throw new EngineError('not_found', 404, `No booking ${id}`)
      return toBooking(raw)
    },

    async cancel(id) {
      const raw = await call<RawBooking>(`/bookings/${id}/cancel`, { method: 'POST' })
      if (raw === undefined) throw new EngineError('not_found', 404, `No booking ${id}`)
      return toBooking(raw)
    },
  }
}
```

- [ ] **Step 7: Fix the timestamps the engine actually expects**

Run: `npm run --workspace server test -- tests/integration/engine-client.test.ts`

`2026-10-01T00:00:00Z` is **not** on the grid of a house anchored at 15:00 Europe/Warsaw — the engine answers `400 invalid_slot_boundary`. The client must send the anchor instant.

The house's timezone and anchor come from `GET /resources/:id`, so the client caches the resource once per id — these are immutable in the engine — and formats the boundary from it:

```ts
const resources = new Map<string, { timezone: string; anchor: string }>()

async function resourceOf(resourceId: string) {
  const cached = resources.get(resourceId)
  if (cached !== undefined) return cached
  const raw = await call<{ timezone: string; slot_anchor_time: string }>(`/resources/${resourceId}`)
  if (raw === undefined) throw new EngineError('not_found', 404, `No house ${resourceId}`)
  // Immutable in the engine — `timezone` cannot be patched — so this cache cannot go stale.
  const value = { timezone: raw.timezone, anchor: raw.slot_anchor_time.slice(0, 5) }
  resources.set(resourceId, value)
  return value
}
```

Formatting `YYYY-MM-DD` plus `HH:MM` in a named zone into an offset timestamp needs the zone's rules, so add `luxon` to the server and use `DateTime.fromISO(\`${date}T${anchor}\`, { zone })`. `reschedule` needs the resource id, which `getBooking` supplies.

Expected after the fix: PASS, all cases.

- [ ] **Step 8: Wire the client into the app**

The client takes its configuration as arguments and reads no environment of its own — that is what makes the next three lines possible, and what keeps `process.env` out of every route written after this task.

`server/src/app.ts` gains it beside `db`:

```ts
export interface AppDeps {
  config: Config
  db: Kysely<Database>
  engine: EngineClient
}

declare module 'fastify' {
  interface FastifyInstance {
    db: Kysely<Database>
    config: Config
    engine: EngineClient
  }
}
```

with `app.decorate('engine', deps.engine)` next to the other two.

`server/src/server.ts` builds it from the one validated config:

```ts
const config = loadConfig(process.env)
const db = createDb(config.databaseUrl)
const engine = createEngineClient({
  engineUrl: config.engineUrl,
  engineApiKey: config.engineApiKey,
  timeoutMs: config.engineTimeoutMs,
})
const app = await buildApp({ config, db, engine })
```

`buildTestApp` in `server/tests/integration/helpers.ts` gains one overrides argument and builds the same way `server.ts` does:

```ts
export async function buildTestApp(
  overrides: { config?: Partial<Config>; engine?: EngineClient } = {},
): Promise<FastifyInstance> { … }
```

By default it points a real client at the harness's engine. Overriding `config` covers Task 10, which points one at a dead port and at a revoked key so that the real fetch path is what fails; overriding `engine` is the escape hatch for a failure the real client cannot be talked into producing.

Injecting rather than importing a module-level singleton is what makes any of this reachable. A client that read its own environment could only be steered by mutating the environment, and the test that matters most in this project is the one where the engine does not answer.

- [ ] **Step 9: Commit**

```bash
git add server/src/engine/ server/src/app.ts server/src/server.ts \
        server/tests/integration/helpers.ts server/tests/unit/engine-errors.test.ts \
        server/tests/integration/engine-client.test.ts server/package.json
git commit -m "feat: the engine client — generated types, a facade over them

Types come from the engine's OpenAPI and are committed; a hand-written
second copy of a contract drifts silently while the compiler keeps
checking confidently against the stale one.

The facade is the only place the key, the timeout, the backoff and the
meaning of each error code live. It deliberately does not send
customer_id: the engine offers no way to change it, so a booking
reassigned to another guest could never be corrected there.

It takes its url, key and timeout as arguments and reads no environment,
so server.ts builds it from config and routes reach for app.engine. A
client that read process.env could only be tested by mutating the
environment, and 'the engine does not answer' is the case that most
needs a test."
```

---

### Task 6: Login and sessions

**Files:**

- Create: `server/src/modules/auth/{password.ts,owner.repository.ts,session.repository.ts,auth.service.ts,auth.routes.ts,guard.ts}`, `server/scripts/set-password.ts`
- Modify: `server/src/app.ts`, `server/package.json`
- Test: `server/tests/unit/password.test.ts`, `server/tests/integration/auth.test.ts`

**Interfaces:**

- Produces: `registerAuth(app)` adding an `onRequest` guard and an `Origin` check; `POST /api/login`, `POST /api/logout`, `GET /api/me`; `request.session`. Routes opt out with `config: { public: true }`.

- [ ] **Step 1: Install argon2 and the cookie plugin**

```bash
npm install --workspace server @fastify/cookie @fastify/rate-limit @node-rs/argon2
```

`@node-rs/argon2` rather than the `argon2` C++ binding: no node-gyp, prebuilt for every platform the project runs on.

- [ ] **Step 2: Write the failing password test**

`server/tests/unit/password.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from '../../src/modules/auth/password.js'

describe('password hashing', () => {
  it('verifies the right password', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true)
  })

  it('rejects the wrong one', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(await verifyPassword('Correct horse battery staple', hash)).toBe(false)
  })

  // Argon2id, unlike the engine's SHA-256 over API keys: this is a human password with
  // little entropy, and slowing an offline attack is exactly the point.
  it('produces an argon2id hash with a per-password salt', async () => {
    const first = await hashPassword('same')
    const second = await hashPassword('same')
    expect(first).toMatch(/^\$argon2id\$/)
    expect(first).not.toBe(second)
  })

  it('rejects a corrupt hash without throwing', async () => {
    expect(await verifyPassword('anything', 'not-a-hash')).toBe(false)
  })

  it.each(['', '   ', 'short'])('refuses to hash %j', async (weak) => {
    await expect(hashPassword(weak)).rejects.toThrow(/at least/)
  })
})
```

- [ ] **Step 3: Implement the password module**

`server/src/modules/auth/password.ts`:

```ts
import { hash, verify } from '@node-rs/argon2'

const MIN_LENGTH = 12

/**
 * Argon2id, deliberately unlike the engine's SHA-256 over API keys. There the secret carries
 * 256 bits from a CSPRNG and there is nothing to brute-force; here it is a phrase a person
 * chose, and making each guess expensive is the whole defence.
 */
export async function hashPassword(password: string): Promise<string> {
  if (password.trim().length < MIN_LENGTH) {
    throw new Error(`The password must be at least ${MIN_LENGTH} characters`)
  }
  return hash(password)
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    return await verify(stored, password)
  } catch {
    // A malformed stored hash is a failed login, not a 500.
    return false
  }
}
```

- [ ] **Step 4: Write the failing auth test**

`server/tests/integration/auth.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildTestApp, closeTestDb, getTestDb, resetDb } from './helpers.js'
import { hashPassword } from '../../src/modules/auth/password.js'

let app: FastifyInstance
const PASSWORD = 'correct horse battery staple'

beforeAll(async () => {
  app = await buildTestApp()
})
beforeEach(async () => {
  await resetDb()
  await getTestDb()
    .insertInto('owners')
    .values({ label: 'The owner', password_hash: await hashPassword(PASSWORD) })
    .execute()
})
afterAll(async () => {
  await app.close()
  await closeTestDb()
})

const login = (password = PASSWORD) =>
  app.inject({ method: 'POST', url: '/api/login', payload: { password } })

describe('login', () => {
  it('sets an httpOnly session cookie', async () => {
    const response = await login()
    expect(response.statusCode).toBe(204)

    const cookie = response.cookies.find((c) => c.name === 'session')
    expect(cookie?.httpOnly).toBe(true)
    expect(cookie?.sameSite?.toLowerCase()).toBe('lax')
    expect(cookie?.path).toBe('/')
  })

  it('refuses the wrong password with the same answer as a missing one', async () => {
    const wrong = await login('nope')
    expect(wrong.statusCode).toBe(401)
    expect(wrong.json()).toEqual({ error: 'unauthorized', message: 'Wrong password' })
  })

  it('stores only a hash of the token, never the token', async () => {
    const response = await login()
    const token = response.cookies.find((c) => c.name === 'session')!.value
    const rows = await getTestDb().selectFrom('sessions').select('token_hash').execute()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.token_hash).not.toBe(token)
  })

  it('ties the session to the owner it authenticated', async () => {
    await login()
    const owner = await getTestDb().selectFrom('owners').select('id').executeTakeFirstOrThrow()
    const session = await getTestDb()
      .selectFrom('sessions')
      .select('owner_id')
      .executeTakeFirstOrThrow()
    expect(session.owner_id).toBe(owner.id)
  })

  // The same answer as a wrong password: whether this server has been configured at all is
  // not something an attacker should be able to read off the login form.
  it('answers a server with no owner exactly as it answers a wrong password', async () => {
    await getTestDb().deleteFrom('owners').execute()

    const response = await login()
    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ error: 'unauthorized', message: 'Wrong password' })
  })

  // There is no username, so a password alone identifies nobody once there are two owners.
  // The failure must be loud and on the server: that error is the signal to add an identifier.
  it('refuses to guess when a second owner exists', async () => {
    await getTestDb()
      .insertInto('owners')
      .values({ label: 'A second owner', password_hash: await hashPassword('another password') })
      .execute()

    const response = await login()
    expect(response.statusCode).toBe(500)
    expect(await getTestDb().selectFrom('sessions').selectAll().execute()).toHaveLength(0)
  })
})

describe('the guard', () => {
  it('refuses a protected route without a session', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/me' })
    expect(response.statusCode).toBe(401)
  })

  it('admits one with a session', async () => {
    const cookie = (await login()).cookies.find((c) => c.name === 'session')!
    const response = await app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { session: cookie.value },
    })
    expect(response.statusCode).toBe(200)
  })

  it('refuses a session that has been deleted — sign out everywhere works', async () => {
    const cookie = (await login()).cookies.find((c) => c.name === 'session')!
    await getTestDb().deleteFrom('sessions').execute()

    const response = await app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { session: cookie.value },
    })
    expect(response.statusCode).toBe(401)
  })

  it('refuses an expired session', async () => {
    const cookie = (await login()).cookies.find((c) => c.name === 'session')!
    await getTestDb()
      .updateTable('sessions')
      .set({ expires_at: new Date(Date.now() - 1000) })
      .execute()

    const response = await app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { session: cookie.value },
    })
    expect(response.statusCode).toBe(401)
  })

  it('leaves health public', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200)
  })
})

describe('the origin check', () => {
  it('refuses a write from a foreign origin', async () => {
    const cookie = (await login()).cookies.find((c) => c.name === 'session')!
    const response = await app.inject({
      method: 'POST',
      url: '/api/logout',
      cookies: { session: cookie.value },
      headers: { origin: 'https://evil.example', host: 'cabins.example' },
    })
    expect(response.statusCode).toBe(403)
  })

  it('allows one whose origin matches the host it was addressed to', async () => {
    const cookie = (await login()).cookies.find((c) => c.name === 'session')!
    const response = await app.inject({
      method: 'POST',
      url: '/api/logout',
      cookies: { session: cookie.value },
      headers: { origin: 'https://cabins.example', host: 'cabins.example' },
    })
    expect(response.statusCode).toBe(204)
  })
})
```

- [ ] **Step 5: Implement sessions and the guard**

`server/src/modules/auth/session.repository.ts` stores `sha256(token)`, never the token — a leaked database backup must not hand over live sessions. `auth.service.ts` mints 32 random bytes as the token, inserts the hash with `owner_id` and `expires_at = now + ttl`, and on each authenticated request slides `expires_at` at most once an hour (the same lazy-write shape as the engine's `last_used_at`, for the same reason).

`owner.repository.ts` holds the one query that assumes a single owner:

```ts
/**
 * Login asks for a password and no identifier, which identifies a person only while there is
 * exactly one owner. Two rows is not a login failure — it is that assumption expiring, and it
 * belongs in the log as a defect rather than being silently resolved by trying each hash in
 * turn.
 */
export async function theOnlyOwner(db: Kysely<Database>): Promise<Owner | undefined> {
  const owners = await db.selectFrom('owners').selectAll().limit(2).execute()
  if (owners.length > 1) {
    throw new Error('More than one owner exists, and login has no way to tell them apart')
  }
  return owners[0]
}
```

The two cases are answered differently on purpose. **No owner** returns `undefined` and the route answers the same `401` as a wrong password — the absence of a password must not be detectable from outside. To keep that true of the clock as well as the body, the service verifies against a fixed dummy hash when there is no owner, so a login attempt against an unconfigured server does not return noticeably faster than a failed one. **More than one owner** throws, and the generic `500` handler logs it: nobody at the login form caused it, and it is the signal that an identifier column is now due.

`server/src/modules/auth/guard.ts`:

```ts
import type { FastifyInstance } from 'fastify'
import { AppError } from '../../shared/errors.js'
import type { AuthService } from './auth.service.js'

export class UnauthorizedError extends AppError {
  readonly statusCode = 401
  readonly code = 'unauthorized'
}

export class ForbiddenOriginError extends AppError {
  readonly statusCode = 403
  readonly code = 'forbidden_origin'
}

declare module 'fastify' {
  interface FastifyRequest {
    sessionId: string
  }
  interface FastifyContextConfig {
    public?: true
  }
}

export function registerGuard(app: FastifyInstance, service: AuthService): void {
  app.decorateRequest('sessionId', '')

  // Compared against the host the request was addressed to rather than a configured origin,
  // so the check keeps working behind a proxy and on an ephemeral test port.
  app.addHook('onRequest', async (request) => {
    if (request.method === 'GET' || request.method === 'HEAD') return
    const origin = request.headers.origin
    if (origin === undefined) return
    const host = request.headers.host
    if (host === undefined || new URL(origin).host !== host) {
      throw new ForbiddenOriginError('This request did not come from the console')
    }
  })

  app.addHook('onRequest', async (request) => {
    if (request.routeOptions.config?.public === true) return

    const token = request.cookies.session
    if (token === undefined) throw new UnauthorizedError('Sign in first')

    const session = await service.resolve(token)
    if (session === undefined) throw new UnauthorizedError('Sign in first')

    request.sessionId = session.id
  })
}
```

`auth.routes.ts` registers `POST /api/login` (`public: true`, rate-limited to 10 per minute per IP), `POST /api/logout`, and `GET /api/me`. The login route answers `401 unauthorized` with one message whether the password is wrong or no password has been set, so the absence of a password is not something an attacker can detect.

`server/scripts/set-password.ts` reads a password from stdin, hashes it, and updates the single `owners` row — inserting one labelled `The owner` if the table is empty. It refuses to run when the table holds more than one row, for the same reason login does: it has no way to be told which owner is meant. Wired as `npm run --workspace server owner:password`.

- [ ] **Step 6: Run to green**

Run: `npm run --workspace server test -- tests/unit/password.test.ts tests/integration/auth.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/modules/auth/ server/scripts/ server/src/app.ts server/package.json \
        server/tests/unit/password.test.ts server/tests/integration/auth.test.ts
git commit -m "feat: password login and revocable sessions

Sessions are rows, not JWTs, for one reason: revocation. 'Sign out
everywhere' with a JWT needs a blocklist, which is the same table arrived
at the hard way.

Only a hash of the session token is stored, so a leaked backup does not
hand over live sessions.

Login takes a password and no username, which identifies a person only
while there is exactly one owner. Finding two is a 500 and a log line, not
a guess between them: that error is the signal to add an identifier."
```

---

### Task 7: Houses and guests

**Files:**

- Create: `server/src/modules/houses/{house.repository.ts,house.service.ts,house.routes.ts,house.schemas.ts}`, `server/src/modules/guests/{guest.repository.ts,guest.service.ts,guest.routes.ts,guest.schemas.ts,phone.ts}`
- Test: `server/tests/unit/phone.test.ts`, `server/tests/integration/houses.test.ts`, `server/tests/integration/guests.test.ts`

**Interfaces:**

- Produces: `GET/POST/PATCH /api/houses`, `GET/POST/PATCH /api/guests`, `GET /api/guests?phone=`; `normalisePhone(raw: string): string`.

- [ ] **Step 1: Write the failing phone test**

`server/tests/unit/phone.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { normalisePhone } from '../../src/modules/guests/phone.js'

describe('normalisePhone', () => {
  // The phone is the guest's identity, so two spellings of one number must not become two
  // guests with two separate histories.
  it.each([
    ['+7 (912) 345-67-89', '+79123456789'],
    ['+7 912 345 67 89', '+79123456789'],
    ['8 912 345 67 89', '+79123456789'],
    ['89123456789', '+79123456789'],
    ['+79123456789', '+79123456789'],
  ])('reduces %s to %s', (raw, expected) => {
    expect(normalisePhone(raw)).toBe(expected)
  })

  it('keeps other country codes as given', () => {
    expect(normalisePhone('+48 111 222 333')).toBe('+48111222333')
  })

  it.each(['', 'not a phone', '123', '+'])('refuses %j', (raw) => {
    expect(() => normalisePhone(raw)).toThrow(/phone/i)
  })
})
```

- [ ] **Step 2: Implement**

`server/src/modules/guests/phone.ts`:

```ts
import { ValidationError } from '../../shared/errors.js'

/**
 * The phone is the guest's identity, so `8 912 …` and `+7 912 …` must reduce to one value —
 * otherwise the same person accumulates two histories and the owner sees neither in full.
 *
 * Only the Russian leading `8` is rewritten, because that is the local convention this owner
 * meets. Everything else keeps the country code it was given.
 */
export function normalisePhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, '')
  const withCountry = digits.startsWith('8') ? `+7${digits.slice(1)}` : digits
  const normalised = withCountry.startsWith('+') ? withCountry : `+${withCountry}`

  if (!/^\+\d{10,15}$/.test(normalised)) {
    throw new ValidationError(`Not a phone number: ${JSON.stringify(raw)}`)
  }
  return normalised
}
```

- [ ] **Step 3: Write the failing houses test**

`server/tests/integration/houses.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, inject } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildTestApp, closeTestDb, resetDb } from './helpers.js'
import { signIn } from './auth-helper.js'

let app: FastifyInstance
let cookies: Record<string, string>

beforeAll(async () => {
  app = await buildTestApp()
})
beforeEach(async () => {
  await resetDb()
  cookies = await signIn(app)
})
afterAll(async () => {
  await app.close()
  await closeTestDb()
})

const house = (overrides = {}) => ({
  engine_resource_id: inject('houseA'),
  name: 'Дом у озера',
  price_per_night: 30000,
  ...overrides,
})

describe('POST /api/houses', () => {
  it('creates a house with its add-ons', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/houses',
      cookies,
      payload: { ...house(), addons: [{ code: 'sauna', label: 'Баня', default_price: 5000 }] },
    })

    expect(response.statusCode).toBe(201)
    expect(response.json().addons).toEqual([
      expect.objectContaining({ code: 'sauna', label: 'Баня', default_price: 5000 }),
    ])
  })

  it('refuses a second house pointing at the same engine resource', async () => {
    await app.inject({ method: 'POST', url: '/api/houses', cookies, payload: house() })
    const second = await app.inject({
      method: 'POST',
      url: '/api/houses',
      cookies,
      payload: house({ name: 'Другой' }),
    })
    expect(second.statusCode).toBe(409)
  })

  it.each([
    ['a negative price', { price_per_night: -1 }],
    ['a fractional price — money is minor units', { price_per_night: 300.5 }],
    ['a blank name', { name: '  ' }],
    ['an engine id that is not a uuid', { engine_resource_id: 'nope' }],
  ])('refuses %s', async (_name, override) => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/houses',
      cookies,
      payload: house(override),
    })
    expect(response.statusCode).toBe(400)
  })

  it('refuses an unknown field rather than ignoring it', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/houses',
      cookies,
      payload: { ...house(), timezone: 'Europe/Warsaw' },
    })
    expect(response.statusCode).toBe(400)
  })

  it('needs a session', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/houses', payload: house() })
    expect(response.statusCode).toBe(401)
  })
})

describe('GET /api/houses', () => {
  it('lists houses with their add-ons', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/houses',
      cookies,
      payload: { ...house(), addons: [{ code: 'sauna', label: 'Баня', default_price: 5000 }] },
    })
    const response = await app.inject({ method: 'GET', url: '/api/houses', cookies })
    expect(response.json()).toHaveLength(1)
    expect(response.json()[0].addons).toHaveLength(1)
  })
})
```

`tests/integration/auth-helper.ts` seeds the owner password once and returns the session cookie, so every suite that is not about authentication says `cookies` and nothing more.

- [ ] **Step 4: Implement houses and guests**

Routes, services and repositories follow the engine's three-layer split. Two decisions worth stating in code comments:

`house.service.ts` — creating a house **verifies the resource exists in the engine** before storing it, so a typo in `engine_resource_id` fails at creation rather than as an empty calendar column later:

```ts
const resource = await this.engine.getResource(body.engine_resource_id)
if (resource === undefined) {
  throw new ValidationError('No such resource in the booking engine', {
    field: 'engine_resource_id',
  })
}
```

`guest.service.ts` — `findOrCreate(name, phone, note)` normalises the phone and returns the existing guest when it matches, updating the name only when the stored one is blank. A returning guest must not silently overwrite the name the owner has already corrected.

- [ ] **Step 5: Run to green**

Run: `npm run --workspace server test -- tests/unit/phone.test.ts tests/integration/houses.test.ts tests/integration/guests.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/modules/houses/ server/src/modules/guests/ server/tests/
git commit -m "feat: houses with add-ons, guests keyed by a normalised phone"
```

---

### Task 8: Creating a booking, engine first

**Files:**

- Create: `server/src/modules/bookings/{booking.repository.ts,booking.service.ts,booking.routes.ts,booking.schemas.ts}`
- Test: `server/tests/integration/create-booking.test.ts`

**Interfaces:**

- Consumes: `EngineClient` (Task 5), `GuestService` (Task 7), `totalFor`/`balanceFor` (Task 4).
- Produces: `POST /api/bookings` taking `{ house_id, check_in, check_out, guest: { name, phone, note? }, price_per_night, addons: [{ code }], deposit, note? }` and answering the joined view.

- [ ] **Step 1: Write the failing test**

`server/tests/integration/create-booking.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildTestApp, closeTestDb, getTestDb, resetDb } from './helpers.js'
import { signIn, seedHouse } from './auth-helper.js'

let app: FastifyInstance
let cookies: Record<string, string>
let houseId: string

beforeAll(async () => {
  app = await buildTestApp()
})
beforeEach(async () => {
  await resetDb()
  cookies = await signIn(app)
  houseId = await seedHouse(app, cookies)
})
afterAll(async () => {
  await app.close()
  await closeTestDb()
})

const booking = (overrides = {}) => ({
  house_id: houseId,
  check_in: '2026-09-20',
  check_out: '2026-09-22',
  guest: { name: 'Иван', phone: '+7 912 345 67 89' },
  price_per_night: 30000,
  addons: [{ code: 'sauna' }],
  deposit: 20000,
  ...overrides,
})

describe('POST /api/bookings', () => {
  it('creates it and returns the joined view', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/bookings',
      cookies,
      payload: booking(),
    })

    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({
      check_in: '2026-09-20',
      check_out: '2026-09-22',
      nights: 2,
      // 2 × 30000 + 5000
      total: 65000,
      balance: 45000,
      guest: { name: 'Иван', phone: '+79123456789' },
    })
  })

  it('snapshots the add-on price, so raising it later does not rewrite this total', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/bookings',
      cookies,
      payload: booking(),
    })
    const id = created.json().id as string

    await getTestDb().updateTable('house_addon_prices').set({ default_price: 9999 }).execute()

    const reread = await app.inject({ method: 'GET', url: `/api/bookings/${id}`, cookies })
    expect(reread.json().total).toBe(65000)
  })

  it('reuses an existing guest with the same phone', async () => {
    await app.inject({ method: 'POST', url: '/api/bookings', cookies, payload: booking() })
    await app.inject({
      method: 'POST',
      url: '/api/bookings',
      cookies,
      payload: booking({
        check_in: '2026-10-01',
        check_out: '2026-10-03',
        guest: { name: 'Иван Иванов', phone: '8 912 345 67 89' },
      }),
    })
    expect(await getTestDb().selectFrom('guests').selectAll().execute()).toHaveLength(1)
  })

  it('refuses an add-on the house does not offer', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/bookings',
      cookies,
      payload: booking({ addons: [{ code: 'helipad' }] }),
    })
    expect(response.statusCode).toBe(400)
  })

  it('reports an occupied stay as a conflict the owner can understand', async () => {
    await app.inject({ method: 'POST', url: '/api/bookings', cookies, payload: booking() })
    const clash = await app.inject({
      method: 'POST',
      url: '/api/bookings',
      cookies,
      payload: booking({ check_in: '2026-09-21', check_out: '2026-09-23' }),
    })

    expect(clash.statusCode).toBe(409)
    expect(clash.json().error).toBe('slot_unavailable')
  })

  it('lets a stay begin on the previous departure date', async () => {
    await app.inject({ method: 'POST', url: '/api/bookings', cookies, payload: booking() })
    const next = await app.inject({
      method: 'POST',
      url: '/api/bookings',
      cookies,
      payload: booking({ check_in: '2026-09-22', check_out: '2026-09-24' }),
    })
    expect(next.statusCode).toBe(201)
  })

  // The ordering the whole design rests on: the engine holds the night even when our own
  // write fails, so the failure is a missing name rather than a double booking.
  it('leaves the engine booking in place when the local write fails', async () => {
    const db = getTestDb()
    const insert = vi.spyOn(db, 'insertInto')
    insert.mockImplementationOnce(((table: string) => {
      if (table === 'booking_details') throw new Error('disk on fire')
      return insert.getMockImplementation()
    }) as never)

    const response = await app.inject({
      method: 'POST',
      url: '/api/bookings',
      cookies,
      payload: booking(),
    })
    expect(response.statusCode).toBe(500)

    // The night is held, and the calendar will show the booking as an orphan.
    const calendar = await app.inject({
      method: 'GET',
      url: '/api/calendar?from=2026-09-01&to=2026-10-01',
      cookies,
    })
    const orphans = calendar.json().bookings.filter((b: { orphan: boolean }) => b.orphan)
    expect(orphans).toHaveLength(1)
    insert.mockRestore()
  })

  it.each([
    ['a departure before the arrival', { check_in: '2026-09-22', check_out: '2026-09-20' }],
    ['a zero-night stay', { check_in: '2026-09-20', check_out: '2026-09-20' }],
    ['a fractional price', { price_per_night: 300.5 }],
    ['a negative deposit', { deposit: -1 }],
    ['a blank guest name', { guest: { name: ' ', phone: '+79123456789' } }],
    ['a phone that is not one', { guest: { name: 'Иван', phone: 'нет' } }],
  ])('refuses %s', async (_name, override) => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/bookings',
      cookies,
      payload: booking(override),
    })
    expect(response.statusCode).toBe(400)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run --workspace server test -- tests/integration/create-booking.test.ts`
Expected: FAIL — no route.

- [ ] **Step 3: Implement the service**

`server/src/modules/bookings/booking.service.ts`, the create path:

```ts
async create(body: CreateBookingBody): Promise<BookingView> {
  const house = await this.houses.loadOrFail(body.house_id)
  const addons = this.snapshotAddons(house, body.addons)
  // Validated before anything is written, so a bad request never reaches the engine.
  const nights = nightsBetween(body.check_in, body.check_out)
  totalFor({ pricePerNight: body.price_per_night, nights, addons })

  const guest = await this.guests.findOrCreate(body.guest)

  // The engine first, always. If the write below fails, a booking exists whose guest details
  // are missing: the night is correctly held and the calendar shows it as an orphan for the
  // owner to repair. The reverse order can leave a row for a booking that does not hold the
  // night, which is how two guests end up in one house.
  const engineBooking = await this.engine.createBooking(
    house.engine_resource_id,
    body.check_in,
    body.check_out,
    randomUUID(),
  )

  await this.repository.insert({
    engine_booking_id: engineBooking.id,
    guest_id: guest.id,
    price_per_night: body.price_per_night,
    addons_snapshot: JSON.stringify(addons),
    deposit: body.deposit,
    note: body.note ?? null,
  })

  return this.view(engineBooking, house, guest, {
    price_per_night: body.price_per_night,
    addons,
    deposit: body.deposit,
  })
}
```

`snapshotAddons` copies `code`, `label` and the house's **current** `default_price` onto the booking. Referencing the house's price live would mean that raising the rate rewrites the total of a booking already made, and the owner would see a debt that does not exist.

`booking.routes.ts` translates `EngineError` through the table in the spec: `slot_unavailable` and `outside_schedule` become the owner-facing `409`/`400` with the engine's own code preserved, and everything else becomes a `502` naming the engine, so a defect here is never dressed up as the owner's mistake.

- [ ] **Step 4: Run to green**

Run: `npm run --workspace server test -- tests/integration/create-booking.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/modules/bookings/ server/tests/integration/create-booking.test.ts
git commit -m "feat: create a booking, engine first

A failing local write leaves a booking whose guest details are missing —
the night is held and the calendar flags it for repair. The reverse order
would leave a record that does not hold the night."
```

---

### Task 9: The calendar view, orphans, reschedule and cancel

**Files:**

- Modify: `server/src/modules/bookings/{booking.service.ts,booking.routes.ts}`
- Test: `server/tests/integration/calendar.test.ts`, `server/tests/integration/amend-booking.test.ts`

**Interfaces:**

- Produces: `GET /api/calendar?from&to` returning `{ houses: [{ id, name, nights: [{ date, available }] }], bookings: [BookingView] }`; `POST /api/bookings/:id/reschedule`, `POST /api/bookings/:id/cancel`, `PATCH /api/bookings/:id` for money and notes.

- [ ] **Step 1: Write the failing calendar test**

`server/tests/integration/calendar.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildTestApp, closeTestDb, getTestDb, resetDb } from './helpers.js'
import { seedBooking, seedHouse, signIn } from './auth-helper.js'

let app: FastifyInstance
let cookies: Record<string, string>
let houseId: string

beforeAll(async () => {
  app = await buildTestApp()
})
beforeEach(async () => {
  await resetDb()
  cookies = await signIn(app)
  houseId = await seedHouse(app, cookies)
})
afterAll(async () => {
  await app.close()
  await closeTestDb()
})

const calendar = (from = '2026-09-01', to = '2026-10-01') =>
  app.inject({ method: 'GET', url: `/api/calendar?from=${from}&to=${to}`, cookies })

describe('GET /api/calendar', () => {
  it('reports availability per night, from the engine', async () => {
    const response = await calendar()
    expect(response.statusCode).toBe(200)

    const house = response.json().houses.find((h: { id: string }) => h.id === houseId)
    expect(house.nights).toHaveLength(30)
    expect(house.nights[0]).toEqual({ date: '2026-09-01', available: true })
  })

  it('marks the booked nights but not the departure date', async () => {
    await seedBooking(app, cookies, { houseId, checkIn: '2026-09-20', checkOut: '2026-09-22' })
    const house = (await calendar()).json().houses.find((h: { id: string }) => h.id === houseId)
    const byDate = Object.fromEntries(
      house.nights.map((n: { date: string; available: boolean }) => [n.date, n.available]),
    )

    expect(byDate['2026-09-20']).toBe(false)
    expect(byDate['2026-09-21']).toBe(false)
    expect(byDate['2026-09-22']).toBe(true)
  })

  it('joins guest and money onto each booking', async () => {
    await seedBooking(app, cookies, { houseId, checkIn: '2026-09-20', checkOut: '2026-09-22' })
    const [booking] = (await calendar()).json().bookings

    expect(booking).toMatchObject({
      check_in: '2026-09-20',
      nights: 2,
      total: 65000,
      balance: 45000,
      orphan: false,
    })
    expect(booking.guest.name).toBe('Иван')
  })

  // Both mismatches are shown rather than hidden: a hidden booking is a night the owner
  // believes is free.
  it('flags a booking the engine has and we do not', async () => {
    await seedBooking(app, cookies, { houseId, checkIn: '2026-09-20', checkOut: '2026-09-22' })
    await getTestDb().deleteFrom('booking_details').execute()

    const [booking] = (await calendar()).json().bookings
    expect(booking.orphan).toBe(true)
    expect(booking.guest).toBeNull()
    expect(booking.check_in).toBe('2026-09-20')
  })

  it('does not show cancelled bookings as occupying nights', async () => {
    const id = await seedBooking(app, cookies, {
      houseId,
      checkIn: '2026-09-20',
      checkOut: '2026-09-22',
    })
    await app.inject({ method: 'POST', url: `/api/bookings/${id}/cancel`, cookies })

    const house = (await calendar()).json().houses.find((h: { id: string }) => h.id === houseId)
    expect(house.nights.every((n: { available: boolean }) => n.available)).toBe(true)
  })

  it.each([
    ['a window wider than a year', '2026-01-01', '2028-01-01'],
    ['an inverted window', '2026-10-01', '2026-09-01'],
    ['a malformed date', '01-09-2026', '2026-10-01'],
  ])('refuses %s', async (_name, from, to) => {
    expect((await calendar(from, to)).statusCode).toBe(400)
  })
})
```

- [ ] **Step 2: Write the failing amend test**

`server/tests/integration/amend-booking.test.ts` covers: rescheduling frees the old nights and **changes the total** because the night count changed; cancelling leaves `booking_details` in place as history; `PATCH` updates deposit and note without touching the engine; rescheduling into an occupied stay answers `409` and leaves the booking where it was; rescheduling a booking the engine does not have answers `404`.

```ts
it('recomputes the total when the stay gets longer', async () => {
  const id = await seedBooking(app, cookies, {
    houseId,
    checkIn: '2026-09-20',
    checkOut: '2026-09-22',
  })
  expect((await app.inject({ method: 'GET', url: `/api/bookings/${id}`, cookies })).json().total)
    .toBe(65000)

  await app.inject({
    method: 'POST',
    url: `/api/bookings/${id}/reschedule`,
    cookies,
    payload: { check_in: '2026-09-20', check_out: '2026-09-23' },
  })

  // Three nights now, and the add-on is unchanged: 3 × 30000 + 5000.
  const after = await app.inject({ method: 'GET', url: `/api/bookings/${id}`, cookies })
  expect(after.json()).toMatchObject({ nights: 3, total: 95000, balance: 75000 })
})
```

That case is the reason the total is computed on read: a stored total would have to be recomputed on every path that moves a booking, and one of them would eventually forget.

- [ ] **Step 3: Implement the join**

`booking.service.ts`:

```ts
/**
 * The calendar is assembled from two systems and stores nothing of its own. Occupancy comes
 * from the engine's availability, which already accounts for closed dates and cancellations;
 * the bookings come from the engine's listing; the guest and the money come from here.
 */
async calendar(from: string, to: string): Promise<CalendarView> {
  assertWindow(from, to)
  const houses = await this.houses.list()

  const [bookings, ...availability] = await Promise.all([
    this.engine.listBookings(from, to),
    ...houses.map((house) => this.engine.availability(house.engine_resource_id, from, to)),
  ])

  const details = await this.repository.byEngineIds(bookings.map((booking) => booking.id))
  const byEngineId = new Map(details.map((row) => [row.engine_booking_id, row]))

  return {
    houses: houses.map((house, index) => ({
      id: house.id,
      name: house.name,
      nights: availability[index]!,
    })),
    // A booking with no local row is shown with `orphan: true` and a null guest rather than
    // dropped: a hidden booking is a night the owner believes is free.
    bookings: bookings.map((booking) => this.view(booking, byEngineId.get(booking.id))),
  }
}
```

`assertWindow` rejects an inverted window and anything wider than 366 days, matching the bound the engine enforces on its own listings — better to refuse here with a clear message than to forward a request the engine will reject anyway.

- [ ] **Step 4: Run to green**

Run: `npm run --workspace server test -- tests/integration/calendar.test.ts tests/integration/amend-booking.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/modules/bookings/ server/tests/integration/
git commit -m "feat: the calendar join, orphans in both directions, reschedule and cancel

Totals are computed on read, so rescheduling from two nights to three
changes the amount without a recomputation step that a future path could
forget to call."
```

---

### Task 10: When the engine is unreachable

**Files:**

- Modify: `server/src/modules/bookings/booking.routes.ts`, `server/src/shared/errors.ts`
- Test: `server/tests/integration/engine-down.test.ts`

- [ ] **Step 1: Write the failing test**

`server/tests/integration/engine-down.test.ts` builds an app pointed at a dead port and asserts the shape of the failure. This is the case the spec calls the only one that can cost money.

```ts
it('answers 503 with a distinct code, never an empty calendar', async () => {
  const app = await buildTestApp({ config: { engineUrl: 'http://127.0.0.1:1' } })
  const cookies = await signIn(app)

  const response = await app.inject({
    method: 'GET',
    url: '/api/calendar?from=2026-09-01&to=2026-10-01',
    cookies,
  })

  expect(response.statusCode).toBe(503)
  expect(response.json().error).toBe('engine_unreachable')
  // The one thing that must never happen: a 200 with no bookings, which the interface would
  // draw as a month of free nights.
  expect(response.statusCode).not.toBe(200)
  await app.close()
})

it('distinguishes a revoked key from an outage', async () => {
  const app = await buildTestApp({ config: { engineApiKey: `bk_live_${'A'.repeat(51)}` } })
  const cookies = await signIn(app)

  const response = await app.inject({
    method: 'GET',
    url: '/api/calendar?from=2026-09-01&to=2026-10-01',
    cookies,
  })

  expect(response.statusCode).toBe(502)
  expect(response.json().error).toBe('engine_rejected_our_key')
})
```

Both cases use the overrides argument `buildTestApp` gained in Task 5 Step 8, and both let the real client do the failing — a stub would prove only that the translation layer handles what the stub was told to throw.

- [ ] **Step 2: Implement the translation**

Two new `AppError` subclasses — `EngineUnreachableAppError` (`503 engine_unreachable`) and `EngineKeyRejectedError` (`502 engine_rejected_our_key`) — and one place in `booking.routes.ts` that maps `EngineUnreachableError` and `EngineError` onto them. A revoked key must not read as a network blip, or the owner will spend half an hour reloading.

- [ ] **Step 3: Run to green and commit**

```bash
git add server/src/ server/tests/integration/engine-down.test.ts
git commit -m "feat: an unreachable engine is an error, never an empty calendar"
```

---

### Task 11: The SPA shell — build, login, session

**Files:**

- Create: `web/package.json`, `web/vite.config.ts`, `web/index.html`, `web/src/{main.tsx,App.tsx,api.ts,routes/Login.tsx,routes/Calendar.tsx}`
- Modify: `server/src/app.ts` (serve the build)
- Test: `tests/ui/login.spec.ts`, `playwright.config.ts`, `tests/ui/global-setup.ts`

- [ ] **Step 1: Create the web workspace**

```bash
npm install --workspace web react react-dom react-router @tanstack/react-query
npm install --workspace web -D @vitejs/plugin-react vite typescript @types/react @types/react-dom
```

`web/vite.config.ts` proxies `/api` to the server in development, so the browser has one origin and there is no CORS:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:4000' } },
  build: { outDir: '../server/public', emptyOutDir: true },
})
```

- [ ] **Step 2: Serve the build from the server**

In `buildApp`, after the API routes:

```ts
// The SPA is served by the same origin as the API: one deployable, no CORS, and the session
// cookie needs no cross-site relaxation. Unknown paths fall through to index.html so that a
// client-side route survives a reload.
await app.register(fastifyStatic, { root: resolve(import.meta.dirname, '../public') })
app.setNotFoundHandler((request, reply) => {
  if (request.url.startsWith('/api/')) {
    return reply.status(404).send({ error: 'not_found', message: 'Route not found' })
  }
  return reply.sendFile('index.html')
})
```

- [ ] **Step 3: Write the failing login journey**

`tests/ui/login.spec.ts`:

```ts
import { expect, test } from '@playwright/test'
import { appUrl, resetAppDb, setOwnerPassword } from './helpers.js'

test.beforeEach(async () => {
  await resetAppDb()
  await setOwnerPassword('correct horse battery staple')
})

test('signs in and lands on the calendar', async ({ page }) => {
  await page.goto(appUrl('/'))
  await expect(page).toHaveURL(/\/login$/)

  await page.getByLabel('Пароль').fill('correct horse battery staple')
  await page.getByRole('button', { name: 'Войти' }).click()

  await expect(page.getByRole('heading', { name: /Календарь/ })).toBeVisible()
})

test('says so when the password is wrong, and stays put', async ({ page }) => {
  await page.goto(appUrl('/login'))
  await page.getByLabel('Пароль').fill('nope')
  await page.getByRole('button', { name: 'Войти' }).click()

  await expect(page.getByText('Неверный пароль')).toBeVisible()
  await expect(page).toHaveURL(/\/login$/)
})

test('a client-side route survives a reload', async ({ page }) => {
  await page.goto(appUrl('/login'))
  await page.getByLabel('Пароль').fill('correct horse battery staple')
  await page.getByRole('button', { name: 'Войти' }).click()
  await page.reload()

  await expect(page.getByRole('heading', { name: /Календарь/ })).toBeVisible()
})

test('the engine key is nowhere in what the browser receives', async ({ page }) => {
  const bodies: string[] = []
  page.on('response', async (response) => {
    if (response.request().resourceType() === 'document' || response.url().includes('/assets/')) {
      bodies.push(await response.text().catch(() => ''))
    }
  })

  await page.goto(appUrl('/login'))
  await page.getByLabel('Пароль').fill('correct horse battery staple')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { name: /Календарь/ })).toBeVisible()

  expect(bodies.join('\n')).not.toContain('bk_live_')
})
```

`playwright.config.ts` mirrors the engine's: `testMatch: '**/*.spec.ts'`, `workers: 1`, one chromium project, trace on first retry. `tests/ui/global-setup.ts` starts the engine harness, this project's Postgres, runs migrations, builds the SPA and starts the server on an ephemeral port.

- [ ] **Step 4: Implement the shell**

`web/src/api.ts` wraps `fetch` with `credentials: 'same-origin'` and turns a `401` into a redirect to `/login`, so an expired session does not surface as a broken page. `App.tsx` wires the router and a `QueryClientProvider`.

- [ ] **Step 5: Run to green and commit**

```bash
npx playwright test tests/ui/login.spec.ts
git add web/ playwright.config.ts tests/ui/ server/src/app.ts package.json
git commit -m "feat: the SPA shell, served by the API server on one origin"
```

---

### Task 12: The calendar in the browser

**Files:**

- Create: `web/src/calendar/{Timeline.tsx,NightCell.tsx,useSelection.ts,useCalendar.ts}`, `web/src/booking/BookingForm.tsx`
- Test: `tests/ui/calendar.spec.ts`, `web/tests/useSelection.test.ts`

- [ ] **Step 1: Write the failing selection test**

`web/tests/useSelection.test.ts` covers the pure part of dragging — the reducer, not the DOM:

```ts
import { describe, expect, it } from 'vitest'
import { selectionReducer, type SelectionState } from '../src/calendar/useSelection.js'

const idle: SelectionState = { kind: 'idle' }
const free = ['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23']

describe('selectionReducer', () => {
  it('turns a drag into a half-open range', () => {
    let state = selectionReducer(idle, { type: 'start', date: '2026-09-20' })
    state = selectionReducer(state, { type: 'over', date: '2026-09-21', free })

    // Two nights selected means a departure on the 22nd.
    expect(state).toMatchObject({ checkIn: '2026-09-20', checkOut: '2026-09-22' })
  })

  it('works when dragged backwards', () => {
    let state = selectionReducer(idle, { type: 'start', date: '2026-09-23' })
    state = selectionReducer(state, { type: 'over', date: '2026-09-21', free })
    expect(state).toMatchObject({ checkIn: '2026-09-21', checkOut: '2026-09-24' })
  })

  // An occupied night stops the drag rather than swallowing it: a selection that silently
  // skipped a booked night would submit a stay the engine refuses.
  it('stops at an occupied night instead of jumping over it', () => {
    let state = selectionReducer(idle, { type: 'start', date: '2026-09-20' })
    state = selectionReducer(state, { type: 'over', date: '2026-09-23', free: ['2026-09-20', '2026-09-21'] })
    expect(state).toMatchObject({ checkIn: '2026-09-20', checkOut: '2026-09-22' })
  })

  it('refuses to start on an occupied night', () => {
    const state = selectionReducer(idle, { type: 'start', date: '2026-09-25', free })
    expect(state.kind).toBe('idle')
  })
})
```

- [ ] **Step 2: Write the failing browser journey**

`tests/ui/calendar.spec.ts`:

```ts
test('drag across free nights and book them', async ({ page }) => {
  await signIn(page)
  await dragNights(page, 'Дом у озера', '2026-09-20', '2026-09-21')

  await page.getByLabel('Имя').fill('Иван')
  await page.getByLabel('Телефон').fill('+7 912 345 67 89')
  await page.getByLabel('Баня').check()
  await page.getByLabel('Аванс').fill('200')
  await page.getByRole('button', { name: 'Сохранить' }).click()

  const bar = page.getByTestId('booking-bar').filter({ hasText: 'Иван' })
  await expect(bar).toBeVisible()
  await expect(page.getByText('Остаток 450 ₽')).toBeVisible()
})

// The property the whole rendering rests on, verified in the browser.
test('two stays meet on a departure date without overlapping', async ({ page }) => {
  await signIn(page)
  await seedBookingViaApi(page, { checkIn: '2026-09-20', checkOut: '2026-09-22' })
  await page.reload()

  // The 22nd is still selectable, because the first guest leaves that morning.
  await dragNights(page, 'Дом у озера', '2026-09-22', '2026-09-23')
  await expect(page.getByRole('dialog', { name: 'Новая бронь' })).toBeVisible()
})

test('shows an error, not an empty month, when the engine is down', async ({ page }) => {
  await signIn(page)
  await stopEngine()
  await page.reload()

  await expect(page.getByText('Движок недоступен')).toBeVisible()
  await expect(page.getByTestId('night-cell')).toHaveCount(0)
  await startEngine()
})

test('an orphan booking is visible and asks to be completed', async ({ page }) => {
  await signIn(page)
  await seedOrphanViaEngine({ checkIn: '2026-09-20', checkOut: '2026-09-22' })
  await page.reload()

  await expect(page.getByText('Бронь без данных')).toBeVisible()
})
```

- [ ] **Step 3: Implement the timeline**

Rows are houses, columns are nights. A booking is an absolutely positioned bar starting at its
check-in column and spanning `nights` columns — so it stops at the left edge of the departure
date and two stays meeting there abut rather than overlap. Occupied cells carry
`data-available="false"` and the selection hook refuses them.

After every mutation the calendar query is invalidated and refetched. There are no optimistic
updates: showing a stale calendar at the moment the owner decides whether a guest fits is the
one case where an instant response is worse than the truth.

- [ ] **Step 4: Run to green and commit**

```bash
npx playwright test
git add web/ tests/ui/
git commit -m "feat: the night timeline, drag selection and the booking form"
```

---

### Task 13: The run script, docs and the first deployment

**Files:**

- Create: `run`, `README.md`, `Dockerfile`, `Caddyfile`
- Modify: `package.json`

- [ ] **Step 1: Write the run script**

Modelled on the engine's, with the same preflight-and-explain habit. Scenarios: `dev` (this project's Postgres in Docker, server and Vite together with labelled output, `--bg` and `stop`), `test`, `test:ui`, `check`, `psql`, `migrate`, `owner:password`.

`dev` additionally checks that the engine answers on `ENGINE_URL` and fails with an instruction if it does not — the calendar is unusable without it, and "connection refused" in a browser console is a worse first experience than a sentence naming the cause.

- [ ] **Step 2: Write the README**

Quick start, the engine as a prerequisite, how to issue the `Site backend` key in the engine's console, the environment table, and one short section repeating why the key never reaches the browser.

- [ ] **Step 3: Write the Dockerfile and the Caddyfile**

Multi-stage: build both workspaces, ship `server/dist` and `server/public`. Caddy terminates TLS and proxies to the server; the comment records that HTTPS is not decoration — the session cookie is `Secure` and simply will not be set without it.

- [ ] **Step 4: Full verification**

Run: `./run check && npx playwright test`
Expected: types clean, formatting clean, every suite green.

- [ ] **Step 5: Commit**

```bash
git add run README.md Dockerfile Caddyfile package.json
git commit -m "docs: run scenarios, deployment and the key handling rules"
```

---

## Self-review

**Spec coverage.** §1 purpose → Tasks 7–9. §2 boundaries and stack → Tasks 1, 11. §2 hand-rolled calendar → Task 12. §3 generated types → Task 5 Step 1. §3 facade, error table, idempotency → Task 5. §4 schema → Task 3; engine-first ordering → Task 8; orphans → Task 9; price snapshots → Tasks 3, 8. §5 login → Task 6. §6 calendar → Tasks 9, 12; timezone → Task 4 (`localDate`). §7 engine failures → Task 10; totals computed on read → Task 9. §8 testing → the harness in Task 2, and every task's own layer. §9 configuration → Task 1. §10 deferred needs no task.

**Deviations from the spec, deliberate:**

- The spec's login section names no table; Task 3 adds `owners`, since a hashed secret must live somewhere. It is an ordinary keyed table rather than one row pinned at `id = 1`, and `sessions.owner_id` exists from the first migration — a second owner is likely enough that the cheap half of the accommodation is worth making now.
- Task 5 Step 7 discovers that the engine rejects midnight boundaries for a house anchored at 15:00 and adds a resource cache plus `luxon` to the server. The spec's client section did not anticipate it; the fix is small and the cache cannot go stale because the engine makes `timezone` immutable.
- The client deliberately does **not** send `customer_id`, although the engine offers it. Recorded in Task 5: the engine has no endpoint to change it, so a booking reassigned to another guest could never be corrected there, and the guest link belongs where it can be fixed.
