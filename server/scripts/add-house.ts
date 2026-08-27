import { createInterface } from 'node:readline/promises'
import { createDb } from '../src/db/client.js'
import { createHouseResource } from '../src/engine/house-resource.js'

/**
 * Sets up a house: creates its resource in the engine, then records it here.
 *
 * A command rather than a screen because it happens twice and then never again, and because
 * the six engine concepts a resource needs — duration, anchor, capacity, concurrency mode,
 * schedule, timezone — are not things to put in front of the owner. Five of them are this
 * product's fixed answers; only the timezone and the check-in time are real questions.
 *
 * It needs a wider key than the running service holds. The service's key is a Site backend
 * preset with no `resources.write`, and that is deliberate: an internet-facing service should
 * not be able to delete the tenant's resources for the rest of its life to save a step taken
 * twice. Supply the wider key here, for this one act, and discard it.
 */
const databaseUrl = process.env.DATABASE_URL?.trim()
const engineUrl = process.env.ENGINE_URL?.trim()
if (databaseUrl === undefined || databaseUrl === '') {
  throw new Error('DATABASE_URL is required')
}
if (engineUrl === undefined || engineUrl === '') {
  throw new Error('ENGINE_URL is required')
}

const rl = createInterface({ input: process.stdin })

/**
 * Lines are pulled one at a time rather than asked for with `rl.question`.
 *
 * Given a pipe, readline emits every line as soon as it can, and `question` only captures the
 * one that arrives while it happens to be waiting — so the second prompt onwards hangs
 * forever on `printf ... | ./run house:add`. Pulling from the async iterator applies
 * backpressure, and behaves the same way at a terminal.
 */
const lines = rl[Symbol.asyncIterator]()

async function ask(question: string, fallback?: string): Promise<string> {
  process.stderr.write(fallback === undefined ? `${question}: ` : `${question} [${fallback}]: `)

  const next = await lines.next()
  const answer = (next.done === true ? '' : next.value).trim()

  if (answer !== '') return answer
  if (fallback !== undefined) return fallback
  throw new Error(`${question} is required`)
}

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/

const db = createDb(databaseUrl)

try {
  const adminKey =
    process.env.ENGINE_ADMIN_KEY?.trim() ||
    (await ask('Engine key with resources.write and schedule.write'))

  const name = await ask('House name')
  const priceRoubles = await ask('Price per night, ₽')
  const timezone = await ask('Timezone', 'Europe/Warsaw')
  const checkInTime = await ask('Check-in time', '15:00')
  const checkoutTime = await ask('Check-out time', '11:00')

  const price = Number(priceRoubles.replace(',', '.'))
  if (!Number.isFinite(price) || price < 0) throw new Error(`Not a price: ${priceRoubles}`)
  // Roubles are converted once, here at the edge. Everything past this line is minor units.
  const pricePerNight = Math.round(price * 100)

  for (const [label, value] of [
    ['Check-in', checkInTime],
    ['Check-out', checkoutTime],
  ] as const) {
    if (!HH_MM.test(value)) throw new Error(`${label} must look like 15:00, got "${value}"`)
  }

  // The engine first, then the row here — the same ordering as a booking, and for the same
  // reason: a house recorded here whose resource does not exist would render an empty column
  // that reads as "never booked".
  const engineResourceId = await createHouseResource(engineUrl, adminKey, {
    timezone,
    checkInTime,
  })

  await db
    .insertInto('houses')
    .values({
      engine_resource_id: engineResourceId,
      name,
      price_per_night: pricePerNight,
      checkout_time: checkoutTime,
    })
    .execute()

  process.stderr.write(
    `\nAdded "${name}".\n` +
      `  engine resource ${engineResourceId}\n` +
      `  check-in ${checkInTime}, check-out ${checkoutTime}, ${timezone}\n` +
      `\nAdd its extras — sauna, hot tub — on the Houses screen.\n`,
  )
} finally {
  rl.close()
  await db.destroy()
}
