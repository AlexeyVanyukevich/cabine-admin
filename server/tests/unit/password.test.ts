import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from '../../src/modules/auth/password.js'

describe('password hashing', () => {
  it('verifies the right password', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true)
  })

  it('rejects the wrong one', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(await verifyPassword('Correct horse battery staple', hash)).toBe(false)
  })

  // Argon2id, unlike the engine's SHA-256 over API keys: this is a human password with
  // little entropy, and slowing an offline attack is exactly the point.
  it('produces an argon2id hash with a per-password salt', async () => {
    const first = await hashPassword('same password here')
    const second = await hashPassword('same password here')
    expect(first).toMatch(/^\$argon2id\$/)
    expect(first).not.toBe(second)
  })

  it('rejects a corrupt hash without throwing', async () => {
    expect(await verifyPassword('anything', 'not-a-hash')).toBe(false)
  })

  it.each(['', '   ', 'short'])('refuses to hash %j', async (weak) => {
    await expect(hashPassword(weak)).rejects.toThrow(/at least/)
  })
})
