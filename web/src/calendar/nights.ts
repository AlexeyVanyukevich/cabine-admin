/**
 * Dates here are plain `YYYY-MM-DD` strings and are never turned into a `Date` for arithmetic.
 * The server sends the date the house is in; converting through a `Date` would re-read it in
 * the browser's zone, and an owner one zone west would see every booking move by a day.
 */
const DAY_MS = 86_400_000

function toUtc(date: string): number {
  return Date.parse(`${date}T00:00:00Z`)
}

export function addDays(date: string, days: number): string {
  return new Date(toUtc(date) + days * DAY_MS).toISOString().slice(0, 10)
}

export function nightsBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS)
}

export function eachNight(from: string, to: string): string[] {
  return Array.from({ length: nightsBetween(from, to) }, (_, index) => addDays(from, index))
}

/** The first day of the month a date falls in, and the first day of the next. */
export function monthBounds(date: string): { from: string; to: string } {
  const from = `${date.slice(0, 7)}-01`
  const [year, month] = from.split('-').map(Number) as [number, number]
  const nextYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  return { from, to: `${nextYear}-${String(nextMonth).padStart(2, '0')}-01` }
}

export function shiftMonth(date: string, by: number): string {
  const [year, month] = date.split('-').map(Number) as [number, number]
  const zero = year * 12 + (month - 1) + by
  return `${Math.floor(zero / 12)}-${String((zero % 12) + 1).padStart(2, '0')}-01`
}

const MONTHS = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
]

export function monthName(date: string): string {
  const month = Number(date.slice(5, 7))
  return `${MONTHS[month - 1]} ${date.slice(0, 4)}`
}

const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']

export function weekday(date: string): string {
  return WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]!
}

export function isWeekend(date: string): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay()
  return day === 0 || day === 6
}

/** Today as the browser sees it. Used only to mark the row, never for arithmetic on stays. */
export function today(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** Minor units to something a person reads: 65000 → «650 ₽». */
export function money(minor: number | null): string {
  if (minor === null) return '—'
  return `${(minor / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`
}
