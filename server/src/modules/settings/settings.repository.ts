import type { Kysely } from 'kysely'
import type { Database } from '../../db/schema.js'

export class SettingsRepository {
  constructor(private readonly db: Kysely<Database>) {}

  /**
   * The row is created by migration and only ever updated, so its absence means the database
   * was never migrated. Throwing beats falling back to a default: a settings read that quietly
   * invents one would put the wrong symbol on every price on the screen, and nothing would
   * say so.
   */
  async currency(): Promise<string> {
    const row = await this.db
      .selectFrom('settings')
      .select('currency')
      .orderBy('created_at')
      .executeTakeFirst()
    if (row === undefined) throw new Error('There is no settings row; run the migrations')
    return row.currency
  }

  /** No `where`: there is one row, and "the settings" is what is being written. */
  async setCurrency(currency: string): Promise<void> {
    await this.db.updateTable('settings').set({ currency, updated_at: new Date() }).execute()
  }
}
