/**
 * Every amount in this project is an integer in minor units, and nothing here ever converts
 * one currency into another. The symbol is supplied by the caller: a booking renders in the
 * currency it was agreed in, a price editor in the currency the owner is setting now.
 */

/**
 * Minor units to something a person reads: 65000 → «650 ₽».
 *
 * The symbol is passed in rather than baked in, and nothing here converts: 65000 is 650 of
 * whichever currency it is handed. A booking supplies the currency it was agreed in, so a
 * settled total keeps reading in roubles after the owner switches to euros.
 *
 * The number is always grouped `ru-RU` — the interface is Russian, and only the symbol
 * changes with the currency. Every currency on offer divides into 100 minor units, which the
 * server's `currency.ts` test enforces, so two decimals is right for all of them.
 */
export function money(minor: number | null, currency: { symbol: string }): string {
  if (minor === null) return '—'
  return `${(minor / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ${currency.symbol}`
}

/**
 * The owner types whole units; everything past this line is integer minor units. The rounding
 * happens once, here at the edge, so no total is ever computed from a fraction.
 */
export function toMinor(amount: string): number {
  const value = Number(amount.replace(',', '.').trim())
  if (!Number.isFinite(value) || value < 0) return Number.NaN
  return Math.round(value * 100)
}

/** Back to what the owner would type, for an input's value. */
export function toMajor(minor: number | null): string {
  return minor === null ? '' : String(minor / 100)
}

/**
 * How to render a currency code, from the list the server sent.
 *
 * Falls back to the code itself — «650 RUB» rather than a symbol belonging to some other
 * currency. That covers both the moment before the settings request lands and a booking
 * snapshotted in a currency since dropped from the list.
 */
export function currencyOf(
  code: string | null,
  offered: ReadonlyArray<{ code: string; symbol: string }> | undefined,
): { code: string; symbol: string } {
  if (code === null) return { code: '', symbol: '' }
  return offered?.find((currency) => currency.code === code) ?? { code, symbol: code }
}

/**
 * What a guest still owes, one figure per currency they owe it in.
 *
 * Amounts in different currencies must never be added: a guest who stayed before the owner
 * switched and again after it owes two sums, and a single number would be neither of them.
 * An overpaid stay is floored at zero rather than allowed to offset a debt, which is what the
 * screen did before currencies existed.
 */
export function owedByCurrency(
  stays: Array<{ balance: number | null; currency: string | null }>,
): Array<{ currency: string; owed: number }> {
  const totals = new Map<string, number>()
  for (const stay of stays) {
    // An orphan has no amounts here and nothing to denominate them in.
    if (stay.currency === null) continue
    totals.set(stay.currency, (totals.get(stay.currency) ?? 0) + Math.max(stay.balance ?? 0, 0))
  }
  return [...totals].filter(([, owed]) => owed > 0).map(([currency, owed]) => ({ currency, owed }))
}
