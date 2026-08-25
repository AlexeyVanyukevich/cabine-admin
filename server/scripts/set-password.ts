import { createInterface } from 'node:readline/promises'
import { loadConfig } from '../src/config.js'
import { createDb } from '../src/db/client.js'
import { hashPassword } from '../src/modules/auth/password.js'

/**
 * The whole of password recovery. There is no reset link and no security question: the owner
 * is one person, and the recovery channel is having a shell on the server.
 */
const config = loadConfig(process.env)
const db = createDb(config.databaseUrl)

try {
  const owners = await db.selectFrom('owners').select(['id', 'label']).limit(2).execute()
  if (owners.length > 1) {
    throw new Error(
      'More than one owner exists. This script has no way to be told which one is meant; ' +
        'give it an identifier before adding a second owner.',
    )
  }

  const rl = createInterface({ input: process.stdin, output: process.stderr })
  const password = await rl.question('New password: ')
  rl.close()

  const passwordHash = await hashPassword(password)
  const existing = owners[0]

  if (existing === undefined) {
    await db
      .insertInto('owners')
      .values({ label: 'The owner', password_hash: passwordHash })
      .execute()
    process.stderr.write('Created the owner and set the password.\n')
  } else {
    await db
      .updateTable('owners')
      .set({ password_hash: passwordHash, updated_at: new Date() })
      .where('id', '=', existing.id)
      .execute()

    // Changing the password signs every device out. Slice 1 has no "sign out everywhere"
    // button, so this command is the only lever the owner has after losing a phone — and a
    // password change that left the lost phone signed in would not be a recovery at all.
    const { numDeletedRows } = await db.deleteFrom('sessions').executeTakeFirstOrThrow()
    process.stderr.write(
      `Set the password for ${existing.label} and signed out ${numDeletedRows} session(s).\n`,
    )
  }
} finally {
  await db.destroy()
}
