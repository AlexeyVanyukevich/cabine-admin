import type { EngineClient } from '../../engine/client.js'
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors.js'
import type { AddonInput, House, HouseInput, HouseRepository } from './house.repository.js'

/** A house as the API answers it: its own columns, plus check-in read from the engine. */
export interface HouseWithCheckIn extends House {
  checkin_time: string | null
}

export class HouseService {
  constructor(
    private readonly repository: HouseRepository,
    private readonly engine: EngineClient,
  ) {}

  /**
   * Check-in is the engine's `slot_anchor_time`, read rather than copied — a local copy would
   * be a second answer to a question the engine owns.
   *
   * Best-effort on purpose: if the engine cannot be reached the houses still list, with
   * check-in unknown. Renaming a house or fixing a price should not require the engine to be
   * up, and unlike the calendar there is nothing here that a missing value makes dangerous.
   */
  async list(): Promise<HouseWithCheckIn[]> {
    const houses = await this.repository.list()

    const checkInById = new Map<string, string>()
    try {
      for (const resource of await this.engine.listResources()) {
        checkInById.set(resource.id, resource.checkInTime)
      }
    } catch {
      // Left empty; each house answers with a null check-in below.
    }

    return houses.map((house) => ({
      ...house,
      checkin_time: checkInById.get(house.engine_resource_id) ?? null,
    }))
  }

  async byId(id: string): Promise<House> {
    const house = await this.repository.byId(id)
    if (house === undefined) throw new NotFoundError(`No house ${id}`)
    return house
  }

  async create(input: HouseInput): Promise<House> {
    // Checked against the engine at creation. A typo would otherwise surface much later as a
    // column that is permanently empty, which reads as "never booked" rather than "wrong id".
    const resource = await this.engine.getResource(input.engine_resource_id)
    if (resource === undefined) {
      throw new ValidationError('No such resource in the booking engine', {
        field: 'engine_resource_id',
      })
    }

    if (await this.repository.existsForResource(input.engine_resource_id)) {
      throw new ConflictError('Another house already points at that resource', {
        field: 'engine_resource_id',
      })
    }

    return this.repository.create(input)
  }

  async update(
    id: string,
    patch: {
      name?: string
      price_per_night?: number
      checkout_time?: string
      addons?: AddonInput[]
    },
  ): Promise<House> {
    await this.byId(id)

    const { addons, ...columns } = patch
    // Changing the price list never touches a booking already made: those carry their own
    // snapshot, which is the whole reason the snapshot exists.
    if (addons !== undefined) await this.repository.replaceAddons(id, addons)

    const updated = await this.repository.update(id, columns)
    if (updated === undefined) throw new NotFoundError(`No house ${id}`)
    return updated
  }
}
