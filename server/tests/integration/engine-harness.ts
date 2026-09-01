import { GenericContainer, Network, Wait, type StartedTestContainer } from 'testcontainers'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHouseResource } from '../../src/engine/house-resource.js'

export interface EngineHandle {
  url: string
  apiKey: string
  /** Two day-based houses anchored at 15:00, open every day of the week. */
  resourceIds: string[]
  stop: () => Promise<void>
}

const HERE = dirname(fileURLToPath(import.meta.url))
const ENGINE_REPO = resolve(HERE, '../../../../booking-engine')
const IMAGE = 'cabins-admin/engine'
const CONSOLE_PORT = '3001'

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

  // Kept after the run so the next one reuses the layer cache instead of rebuilding.
  await GenericContainer.fromDockerfile(ENGINE_REPO).build(IMAGE, { deleteOnExit: false })

  // A fresh GenericContainer per role, never one reused. `withCommand` and friends mutate the
  // builder and return it, so chaining a second role off the same object silently gives it
  // the first role's command — an API container that runs the migrator, exits, and times out
  // waiting for a port that was never going to open.
  await (
    await new GenericContainer(IMAGE)
      .withNetwork(network)
      .withEnvironment({ DATABASE_URL: internalUrl })
      .withCommand(['node', 'dist/src/db/migrate.js'])
      .withWaitStrategy(Wait.forOneShotStartup())
      .start()
  ).stop()

  const api: StartedTestContainer = await new GenericContainer(IMAGE)
    .withNetwork(network)
    .withEnvironment({ DATABASE_URL: internalUrl, LOG_LEVEL: 'warn', PORT: '3000' })
    .withExposedPorts(3000)
    .withWaitStrategy(Wait.forHttp('/health', 3000))
    .start()

  // No published port: the console is reached only from inside this container. See
  // engine-bootstrap.mjs for why, and `../../../../booking-engine/src/console.ts` for whose
  // decision it is.
  const consoleContainer: StartedTestContainer = await new GenericContainer(IMAGE)
    .withNetwork(network)
    .withEnvironment({ DATABASE_URL: internalUrl, LOG_LEVEL: 'warn', CONSOLE_PORT })
    .withCommand(['node', 'dist/src/console.js'])
    .withCopyContentToContainer([
      {
        content: readFileSync(resolve(HERE, 'engine-bootstrap.mjs'), 'utf8'),
        target: '/tmp/engine-bootstrap.mjs',
      },
    ])
    .withWaitStrategy(
      Wait.forSuccessfulCommand(
        `node -e "await fetch('http://127.0.0.1:${CONSOLE_PORT}/tenants')"`,
      ),
    )
    .start()

  const url = `http://${api.getHost()}:${api.getMappedPort(3000)}`

  // Both keys come from one tenant, in one round trip into the container.
  const { siteBackend, backOffice } = await bootstrapKeys(consoleContainer)
  const resourceIds = await seedHouses(url, backOffice)

  return {
    url,
    apiKey: siteBackend,
    resourceIds,
    stop: async () => {
      await consoleContainer.stop()
      await api.stop()
      await db.stop()
      await network.stop()
    },
  }
}

async function bootstrapKeys(
  consoleContainer: StartedTestContainer,
): Promise<{ siteBackend: string; backOffice: string }> {
  const { output, exitCode } = await consoleContainer.exec([
    'node',
    '/tmp/engine-bootstrap.mjs',
    CONSOLE_PORT,
    'cabins-admin tests',
    'site_backend',
    'back_office',
  ])
  if (exitCode !== 0) throw new Error(`Bootstrapping the engine's keys failed:\n${output}`)

  const line = output.split('\n').find((candidate) => candidate.startsWith('BOOTSTRAP'))
  if (line === undefined) throw new Error(`The bootstrap printed no result:\n${output}`)

  const { secrets } = JSON.parse(line.slice('BOOTSTRAP'.length)) as {
    secrets: Record<string, string | undefined>
  }
  const siteBackend = secrets['site_backend']
  const backOffice = secrets['back_office']
  if (siteBackend === undefined || backOffice === undefined) {
    throw new Error(`The bootstrap did not return both keys:\n${output}`)
  }
  return { siteBackend, backOffice }
}

/**
 * `site_backend` cannot create resources, so the houses are seeded with a second, wider key
 * that is then discarded — tests must exercise the same authority production has.
 *
 * The shape comes from `createHouseResource`, the same function the setup command uses, so
 * the houses these tests run against are the houses production creates.
 *
 * The two deliberately differ in check-in time. A single anchor everywhere would let a
 * hardcoded 15:00 slip in unnoticed, and the calendar would be wrong for one house only.
 */
async function seedHouses(engineUrl: string, adminKey: string): Promise<string[]> {
  return [
    await createHouseResource(engineUrl, adminKey, {
      timezone: 'Europe/Warsaw',
      checkInTime: '15:00',
    }),
    await createHouseResource(engineUrl, adminKey, {
      timezone: 'Europe/Warsaw',
      checkInTime: '14:00',
    }),
  ]
}
