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
