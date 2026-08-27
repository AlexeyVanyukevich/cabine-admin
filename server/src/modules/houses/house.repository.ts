import type { Kysely } from 'kysely'
import type { Database } from '../../db/schema.js'

export interface AddonPrice {
  id: string
  code: string
  label: string
  default_price: number
}

export interface House {
  id: string
  engine_resource_id: string
  name: string
  price_per_night: number
  addons: AddonPrice[]
}

export interface HouseInput {
  engine_resource_id: string
  name: string
  price_per_night: number
  addons?: Array<{ code: string; label: string; default_price: number }>
}

export class HouseRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async list(): Promise<House[]> {
    const houses = await this.db.selectFrom('houses').selectAll().orderBy('created_at').execute()
    const addons = await this.db.selectFrom('house_addon_prices').selectAll().execute()

    return houses.map((house) => ({
      id: house.id,
      engine_resource_id: house.engine_resource_id,
      name: house.name,
      price_per_night: house.price_per_night,
      addons: addons
        .filter((addon) => addon.house_id === house.id)
        .map(({ id, code, label, default_price }) => ({ id, code, label, default_price })),
    }))
  }

  async byId(id: string): Promise<House | undefined> {
    return (await this.list()).find((house) => house.id === id)
  }

  async create(input: HouseInput): Promise<House> {
    return this.db.transaction().execute(async (trx) => {
      const house = await trx
        .insertInto('houses')
        .values({
          engine_resource_id: input.engine_resource_id,
          name: input.name.trim(),
          price_per_night: input.price_per_night,
        })
        .returningAll()
        .executeTakeFirstOrThrow()

      const addons =
        input.addons === undefined || input.addons.length === 0
          ? []
          : await trx
              .insertInto('house_addon_prices')
              .values(input.addons.map((addon) => ({ ...addon, house_id: house.id })))
              .returningAll()
              .execute()

      return {
        id: house.id,
        engine_resource_id: house.engine_resource_id,
        name: house.name,
        price_per_night: house.price_per_night,
        addons: addons.map(({ id, code, label, default_price }) => ({
          id,
          code,
          label,
          default_price,
        })),
      }
    })
  }

  async update(
    id: string,
    patch: { name?: string; price_per_night?: number },
  ): Promise<House | undefined> {
    if (Object.keys(patch).length > 0) {
      const updated = await this.db
        .updateTable('houses')
        .set(patch)
        .where('id', '=', id)
        .returning('id')
        .executeTakeFirst()
      if (updated === undefined) return undefined
    }
    return this.byId(id)
  }

  async replaceAddons(
    houseId: string,
    addons: Array<{ code: string; label: string; default_price: number }>,
  ): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom('house_addon_prices').where('house_id', '=', houseId).execute()
      if (addons.length > 0) {
        await trx
          .insertInto('house_addon_prices')
          .values(addons.map((addon) => ({ ...addon, house_id: houseId })))
          .execute()
      }
    })
  }

  async existsForResource(engineResourceId: string): Promise<boolean> {
    const row = await this.db
      .selectFrom('houses')
      .select('id')
      .where('engine_resource_id', '=', engineResourceId)
      .executeTakeFirst()
    return row !== undefined
  }
}
