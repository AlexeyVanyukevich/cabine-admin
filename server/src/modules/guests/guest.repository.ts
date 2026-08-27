import type { Kysely, Selectable } from 'kysely'
import type { Database, GuestsTable } from '../../db/schema.js'

export type Guest = Selectable<GuestsTable>

export class GuestRepository {
  constructor(private readonly db: Kysely<Database>) {}

  list(): Promise<Guest[]> {
    return this.db.selectFrom('guests').selectAll().orderBy('created_at', 'desc').execute()
  }

  byId(id: string): Promise<Guest | undefined> {
    return this.db.selectFrom('guests').selectAll().where('id', '=', id).executeTakeFirst()
  }

  byPhone(phone: string): Promise<Guest | undefined> {
    return this.db.selectFrom('guests').selectAll().where('phone', '=', phone).executeTakeFirst()
  }

  create(values: { name: string; phone: string; note?: string | null }): Promise<Guest> {
    return this.db.insertInto('guests').values(values).returningAll().executeTakeFirstOrThrow()
  }

  update(
    id: string,
    patch: { name?: string; phone?: string; note?: string | null },
  ): Promise<Guest | undefined> {
    if (Object.keys(patch).length === 0) return this.byId(id)
    return this.db
      .updateTable('guests')
      .set(patch)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst()
  }
}
