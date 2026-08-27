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
