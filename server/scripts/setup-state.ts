import { createDb } from '../src/db/client.js'

/**
 * Reports what a fresh install still needs before the app is worth opening: a password to sign
 * in with, and a house to put a booking against. Migrations alone leave both missing, and the
 * symptom — a login that rejects every password — reads as a broken build rather than a step
 * not yet taken.
 *
 * It prints `owner=` and `houses=` for `./run` to read, not the instructions themselves, so
 * every sentence the operator sees stays in the run script beside the others.
 *
 * DATABASE_URL alone rather than the whole validated config: this asks a question about this
 * database and nothing else, and demanding an engine key to ask it would put the check out of
 * reach at exactly the moment it is most useful.
 */
const databaseUrl = process.env.DATABASE_URL?.trim()
if (databaseUrl === undefined || databaseUrl === '') {
  throw new Error('DATABASE_URL is required to report the setup state')
}

const db = createDb(databaseUrl)

try {
  // Presence is the whole question, so one row is enough to answer it.
  const owners = await db.selectFrom('owners').select('id').limit(1).execute()
  const houses = await db.selectFrom('houses').select('id').limit(1).execute()

  process.stdout.write(`owner=${owners.length > 0 ? 'present' : 'missing'}\n`)
  process.stdout.write(`houses=${houses.length > 0 ? 'present' : 'missing'}\n`)
} finally {
  await db.destroy()
}
