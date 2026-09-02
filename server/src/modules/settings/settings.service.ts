import { CURRENCIES, currencyFor, type Currency, type CurrencyCode } from '../../shared/currency.js'
import type { SettingsRepository } from './settings.repository.js'

export interface SettingsView {
  currency: Currency
  /**
   * Sent with every read so the browser needs no copy of the table. A second copy in the web
   * workspace would drift, and the first sign of it would be a price rendered with the wrong
   * symbol.
   */
  currencies: readonly Currency[]
}

export class SettingsService {
  constructor(private readonly repository: SettingsRepository) {}

  async read(): Promise<SettingsView> {
    return this.view(await this.repository.currency())
  }

  async update(input: { currency: CurrencyCode }): Promise<SettingsView> {
    await this.repository.setCurrency(input.currency)
    return this.view(input.currency)
  }

  /**
   * The code a booking made right now should be snapshotted with. Nothing converts and nothing
   * recomputes: this setting decides what the *next* price means, never what an agreed one did.
   */
  async currentCurrency(): Promise<string> {
    return this.repository.currency()
  }

  private view(code: string): SettingsView {
    return { currency: currencyFor(code), currencies: CURRENCIES }
  }
}
