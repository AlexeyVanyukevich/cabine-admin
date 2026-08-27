/**
 * What a house *is*, in the engine's vocabulary — stated once.
 *
 * The engine keeps a resource opaque on purpose: it cannot know whether it is holding a cabin,
 * a barber's chair or a tennis court, so it offers a generic shape and lets each client decide
 * the values. These are this product's values, and this file is the only place they appear.
 *
 * It lives here rather than in the engine because it is policy, not mechanism. Nothing is
 * added to the engine; this calls the same generic `POST /resources` any client would.
 *
 * The setup command and the test harness both go through it, so a shape the tests prove is
 * the shape production creates. Written twice, they would eventually disagree, and the tests
 * would keep passing against a house that no longer exists anywhere else.
 */
export interface HouseShape {
  /** Immutable in the engine once set, which is why the client may cache it. */
  timezone: string
  /**
   * The house's check-in time, `HH:MM`. This becomes `slot_anchor_time`: the instant a night
   * begins. A guest leaving at 11:00 leaves inside the slot that ends here, so the gap is
   * turnaround — which is why check-out is not an engine concept at all.
   */
  checkInTime: string
}

/** Fixed for every house in this product, and not worth a question the owner cannot answer. */
const NIGHTLY = {
  slot_duration: 'P1D',
  capacity: 1,
  concurrency_mode: 'exclusive',
} as const

/** Open every day. Day-based rules carry null times. */
const OPEN_EVERY_DAY = [0, 1, 2, 3, 4, 5, 6].map((day_of_week) => ({
  day_of_week,
  start_time: null,
  end_time: null,
}))

/**
 * Needs `resources.write` and `schedule.write`, which the running service deliberately does
 * not have — its key is a Site backend preset. The caller supplies a wider key for this one
 * act and discards it, exactly as the test harness does.
 */
export async function createHouseResource(
  engineUrl: string,
  adminKey: string,
  shape: HouseShape,
): Promise<string> {
  const call = async (path: string, init: RequestInit): Promise<Response> =>
    fetch(`${engineUrl}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${adminKey}`,
        ...(init.headers ?? {}),
      },
    })

  const created = await call('/resources', {
    method: 'POST',
    body: JSON.stringify({
      timezone: shape.timezone,
      slot_anchor_time: shape.checkInTime,
      ...NIGHTLY,
    }),
  })

  if (created.status !== 201) {
    throw new Error(
      `The engine refused to create the resource: ${created.status} ${await created.text()}`,
    )
  }

  const { id } = (await created.json()) as { id: string }

  const schedule = await call(`/resources/${id}/schedule`, {
    method: 'PUT',
    body: JSON.stringify(OPEN_EVERY_DAY),
  })
  if (!schedule.ok) {
    throw new Error(`The engine refused the schedule: ${schedule.status} ${await schedule.text()}`)
  }

  return id
}
