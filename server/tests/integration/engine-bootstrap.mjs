/**
 * Runs *inside* the engine's console container, because the console binds 127.0.0.1 and
 * refuses to be configurable about it — `src/console.ts` says so in as many words: issuing a
 * key there is unauthenticated, which is safe only while the port is unreachable from
 * anywhere else. So the port is never published; this script is executed in the container's
 * own network namespace instead, and prints the secrets on stdout.
 *
 * It talks to the console over the same HTML forms a person would use. Reaching into the
 * engine's compiled modules would be faster and would couple these tests to its internals.
 *
 * Usage: node engine-bootstrap.mjs <consolePort> <tenantName> <preset>...
 */

const [portArg, tenantName, ...presets] = process.argv.slice(2)
const base = `http://127.0.0.1:${portArg}`

const form = (path, fields) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
    redirect: 'manual',
  })

const created = await form('/tenants', { name: tenantName })
if (created.status !== 303) throw new Error(`Console refused a tenant: ${created.status}`)

const listing = await (await fetch(`${base}/tenants`)).text()
const tenantId = [...listing.matchAll(/([0-9a-f-]{36})\/api-keys/g)].at(-1)?.[1]
if (tenantId === undefined) throw new Error('Could not find the tenant just created')

const secrets = {}
for (const preset of presets) {
  const issued = await form(`/tenants/${tenantId}/api-keys`, { name: `tests:${preset}`, preset })
  const location = issued.headers.get('location')
  if (location === null) throw new Error(`Console refused a ${preset} key: ${issued.status}`)

  const revealed = await (await fetch(new URL(location, base))).text()
  const secret = /bk_live_[A-Za-z0-9]{51}/.exec(revealed)?.[0]
  if (secret === undefined) throw new Error(`The console did not reveal the ${preset} secret`)
  secrets[preset] = secret
}

// The one line the harness parses. Anything else on stdout is the container's own noise.
console.log(`BOOTSTRAP${JSON.stringify({ tenantId, secrets })}`)
