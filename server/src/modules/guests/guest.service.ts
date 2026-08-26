import { NotFoundError } from '../../shared/errors.js'
import type { Guest, GuestRepository } from './guest.repository.js'
import { normalisePhone } from './phone.js'

export interface FoundGuest {
  guest: Guest
  /** False when an existing record matched, which the route answers with 200 rather than 201. */
  created: boolean
}

export class GuestService {
  constructor(private readonly repository: GuestRepository) {}

  list(phone?: string): Promise<Guest[]> {
    if (phone === undefined) return this.repository.list()
    // Normalised on the way in too, so searching for the number as the guest writes it finds
    // the record stored as the owner typed it.
    return this.repository
      .byPhone(normalisePhone(phone))
      .then((guest) => (guest === undefined ? [] : [guest]))
  }

  async byId(id: string): Promise<Guest> {
    const guest = await this.repository.byId(id)
    if (guest === undefined) throw new NotFoundError(`No guest ${id}`)
    return guest
  }

  /**
   * The phone is the identity. A returning guest is the same record, and their name is left
   * alone: the owner may have corrected `иван` to `Иван Петров`, and the next booking typed
   * in a hurry must not undo that.
   */
  async findOrCreate(input: { name: string; phone: string; note?: string }): Promise<FoundGuest> {
    const phone = normalisePhone(input.phone)
    const existing = await this.repository.byPhone(phone)

    if (existing !== undefined) {
      const storedNameIsBlank = existing.name.trim().length === 0
      const guest = storedNameIsBlank
        ? ((await this.repository.update(existing.id, { name: input.name.trim() })) ?? existing)
        : existing
      return { guest, created: false }
    }

    const guest = await this.repository.create({
      name: input.name.trim(),
      phone,
      note: input.note ?? null,
    })
    return { guest, created: true }
  }

  async update(
    id: string,
    patch: { name?: string; phone?: string; note?: string | null },
  ): Promise<Guest> {
    await this.byId(id)

    const values = {
      ...patch,
      ...(patch.name === undefined ? {} : { name: patch.name.trim() }),
      ...(patch.phone === undefined ? {} : { phone: normalisePhone(patch.phone) }),
    }

    const updated = await this.repository.update(id, values)
    if (updated === undefined) throw new NotFoundError(`No guest ${id}`)
    return updated
  }
}
