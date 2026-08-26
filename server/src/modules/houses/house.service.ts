import type { EngineClient } from '../../engine/client.js'
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors.js'
import type { House, HouseInput, HouseRepository } from './house.repository.js'

export class HouseService {
  constructor(
    private readonly repository: HouseRepository,
    private readonly engine: EngineClient,
  ) {}

  list(): Promise<House[]> {
    return this.repository.list()
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
      addons?: Array<{ code: string; label: string; default_price: number }>
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
