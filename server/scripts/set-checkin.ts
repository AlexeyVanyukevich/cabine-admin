import { createInterface } from 'node:readline/promises'
import { createDb } from '../src/db/client.js'
import { createEngineClient } from '../src/engine/client.js'
import { bookingsBlockingCheckInChange } from '../src/modules/houses/checkin.js'

/**
 * Moves a house's check-in time — its `slot_anchor_time`, the instant a night begins.
 *
 * This is not an edit like a price. Changing it re-cuts every night boundary, so a booking
 * already made would straddle two of the new slots: availability would show two nights taken
 * instead of one, and rescheduling it could fail the engine's own boundary check. Nothing is
 * corrupted, but the calendar quietly stops matching reality — the failure this whole project
 * is arranged to prevent.
 *
 * Hence the guard: refuse while the house has a booking from today onward. "Come back when
 * the house is empty, or move those guests first" is a worse answer than silence only if you
 * have never had to explain a double booking.
 */
const databaseUrl = process.env.DATABASE_URL?.trim()
const engineUrl = process.env.ENGINE_URL?.trim()
const apiKey = process.env.ENGINE_API_KEY?.trim()
if (!databaseUrl || !engineUrl || !apiKey) {
  throw new Error('DATABASE_URL, ENGINE_URL and ENGINE_API_KEY are required')
}

const rl = createInterface({ input: process.stdin })
const lines = rl[Symbol.asyncIterator]()

async function ask(question: string): Promise<string> {
  process.stderr.write(`${question}: `)
  const next = await lines.next()
  const answer = (next.done === true ? '' : next.value).trim()
  if (answer === '') throw new Error(`${question} is required`)
  return answer
}

const db = createDb(databaseUrl)

try {
  const houses = await db.selectFrom('houses').selectAll().orderBy('created_at').execute()
  if (houses.length === 0) throw new Error('There are no houses yet')

  process.stderr.write('\n')
  houses.forEach((house, index) => process.stderr.write(`  ${index + 1}. ${house.name}\n`))
  process.stderr.write('\n')

  const chosen = houses[Number(await ask('Which house (number)')) - 1]
  if (chosen === undefined) throw new Error('No such house')

  const engine = createEngineClient({ engineUrl, engineApiKey: apiKey })

  const upcoming = await bookingsBlockingCheckInChange(engine, chosen.engine_resource_id)

  if (upcoming.length > 0) {
    process.stderr.write(
      `\n${chosen.name} has ${upcoming.length} booking(s) from today onward:\n` +
        upcoming.map((b) => `  ${b.checkIn} → ${b.checkOut}\n`).join('') +
        '\nMoving check-in now would re-cut their nights, and the calendar would stop\n' +
        'matching reality. Move or cancel them first, then run this again.\n',
    )
    process.exitCode = 1
  } else {
    const checkInTime = await ask('New check-in time (HH:MM)')
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(checkInTime)) {
      throw new Error(`Check-in must look like 15:00, got "${checkInTime}"`)
    }

    // `resources.write`, which the running service deliberately does not hold.
    const adminKey =
      process.env.ENGINE_ADMIN_KEY?.trim() || (await ask('Engine key with resources.write'))

    const response = await fetch(`${engineUrl}/resources/${chosen.engine_resource_id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${adminKey}` },
      body: JSON.stringify({ slot_anchor_time: checkInTime }),
    })
    if (!response.ok) {
      throw new Error(`The engine refused: ${response.status} ${await response.text()}`)
    }

    process.stderr.write(`\nCheck-in for ${chosen.name} is now ${checkInTime}.\n`)
  }
} finally {
  rl.close()
  await db.destroy()
}
