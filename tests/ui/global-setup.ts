import { spawn, spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { startEngine } from '../../server/tests/integration/engine-harness.js'

const REPO = resolve(import.meta.dirname, '../..')
export const PORT = 4123

/**
 * Boots the whole product the way a deployment does: this project's Postgres, a real booking
 * engine beside it, the SPA built to disk, and the server serving both the API and that build
 * from one origin. Nothing here is stubbed, because the things worth catching in a browser —
 * a session cookie that does not stick, a client route that dies on reload, the engine key
 * leaking into a bundle — only appear when all of it is real.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const db = await new PostgreSqlContainer('postgres:16-alpine').start()
  const databaseUrl = db.getConnectionUri()

  const engine = await startEngine()

  const env = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    ENGINE_URL: engine.url,
    ENGINE_API_KEY: engine.apiKey,
    PORT: String(PORT),
    LOG_LEVEL: 'warn',
    NODE_ENV: 'test',
    // Every journey signs in, and they all come from 127.0.0.1, so the real limit of 10 a
    // minute throttles the suite itself rather than an attacker. The limit has its own test
    // in the server suite, which builds an app with a limit of 2 and watches it bite.
    LOGIN_ATTEMPTS_PER_MINUTE: '1000',
  }

  const migrate = spawnSync('npx', ['tsx', 'server/src/db/migrate.ts'], {
    cwd: REPO,
    env,
    encoding: 'utf8',
  })
  if (migrate.status !== 0) {
    throw new Error(`Migrations failed:\n${migrate.stdout}\n${migrate.stderr}`)
  }

  const build = spawnSync('npm', ['run', '--workspace', 'web', 'build'], {
    cwd: REPO,
    encoding: 'utf8',
  })
  if (build.status !== 0) {
    throw new Error(`The SPA did not build:\n${build.stdout}\n${build.stderr}`)
  }

  const server = spawn('npx', ['tsx', 'server/src/server.ts'], { cwd: REPO, env })
  server.stdout.on('data', (chunk: Buffer) => process.stdout.write(`[server] ${chunk}`))
  server.stderr.on('data', (chunk: Buffer) => process.stderr.write(`[server] ${chunk}`))

  await waitForHealth()

  // The specs run in their own processes, so the connection details go through a file.
  writeFileSync(
    resolve(REPO, 'tests/ui/.runtime.json'),
    JSON.stringify({
      baseURL: `http://127.0.0.1:${PORT}`,
      databaseUrl,
      houseA: engine.resourceIds[0],
      houseB: engine.resourceIds[1],
    }),
  )

  return async () => {
    server.kill('SIGTERM')
    await engine.stop()
    await db.stop()
  }
}

async function waitForHealth(): Promise<void> {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/api/health`)
      if (response.ok) return
    } catch {
      // Not listening yet.
    }
    await new Promise((done) => setTimeout(done, 250))
  }
  throw new Error('The server never answered /api/health')
}
