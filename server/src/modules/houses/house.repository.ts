import { randomBytes } from 'node:crypto'
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
  /** `HH:MM`. Check-in is the engine's, and is not stored here. */
  checkout_time: string
  addons: AddonPrice[]
}

export interface AddonInput {
  code?: string
  label: string
  default_price: number
}

export interface HouseInput {
  engine_resource_id: string
  name: string
  price_per_night: number
  checkout_time?: string
  addons?: AddonInput[]
}

/**
 * Opaque and short. The label is stored alongside it in every snapshot, so nothing is gained
 * by making this readable, and asking a person to invent one guarantees two spellings of the
 * same extra.
 */
function generateCode(): string {
  return randomBytes(6).toString('base64url')
}

const withCodes = (addons: AddonInput[]) =>
  addons.map((addon) => ({
    code: addon.code ?? generateCode(),
    label: addon.label,
    default_price: addon.default_price,
  }))

/** Postgres hands back `HH:MM:SS`; the interface and the API deal in `HH:MM`. */
const toHhMm = (time: string) => time.slice(0, 5)

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
      checkout_time: toHhMm(house.checkout_time),
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
          ...(input.checkout_time === undefined ? {} : { checkout_time: input.checkout_time }),
        })
        .returningAll()
        .executeTakeFirstOrThrow()

      const addons =
        input.addons === undefined || input.addons.length === 0
          ? []
          : await trx
              .insertInto('house_addon_prices')
              .values(withCodes(input.addons).map((addon) => ({ ...addon, house_id: house.id })))
              .returningAll()
              .execute()

      return {
        id: house.id,
        engine_resource_id: house.engine_resource_id,
        name: house.name,
        price_per_night: house.price_per_night,
        checkout_time: toHhMm(house.checkout_time),
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
    patch: { name?: string; price_per_night?: number; checkout_time?: string },
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

  /**
   * Replaces the price list wholesale. Existing bookings are unaffected by construction: they
   * carry their own snapshot, so an extra that is repriced or removed here keeps charging what
   * it charged on the day it was sold.
   */
  async replaceAddons(houseId: string, addons: AddonInput[]): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom('house_addon_prices').where('house_id', '=', houseId).execute()
      if (addons.length > 0) {
        await trx
          .insertInto('house_addon_prices')
          .values(withCodes(addons).map((addon) => ({ ...addon, house_id: houseId })))
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
