export interface Config {
  databaseUrl: string
  engineUrl: string
  engineApiKey: string
  /** How long a call to the engine may hang before it counts as unreachable. */
  engineTimeoutMs: number
  port: number
  sessionTtlDays: number
  /**
   * Login attempts allowed per minute per IP. Configurable because it is the only way to
   * exercise the limit in a test without making every other test race it.
   */
  loginAttemptsPerMinute: number
  logLevel: string
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]
  if (value === undefined || value.trim() === '') {
    throw new Error(`Invalid configuration: ${key} is required`)
  }
  return value.trim()
}

function positiveInt(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key]?.trim()
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid configuration: ${key} must be a positive integer, got "${raw}"`)
  }
  return value
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const engineApiKey = required(env, 'ENGINE_API_KEY')
  // Checked here rather than on first use: a typo in deployment should stop the process at
  // start, not surface as a 401 the first time the owner opens the calendar.
  if (!/^bk_live_[A-Za-z0-9]{51}$/.test(engineApiKey)) {
    throw new Error('Invalid configuration: ENGINE_API_KEY is not a booking-engine key')
  }

  return {
    databaseUrl: required(env, 'DATABASE_URL'),
    engineUrl: required(env, 'ENGINE_URL').replace(/\/+$/, ''),
    engineApiKey,
    engineTimeoutMs: positiveInt(env, 'ENGINE_TIMEOUT_MS', 5_000),
    port: positiveInt(env, 'PORT', 4000),
    sessionTtlDays: positiveInt(env, 'SESSION_TTL_DAYS', 30),
    loginAttemptsPerMinute: positiveInt(env, 'LOGIN_ATTEMPTS_PER_MINUTE', 10),
    logLevel: env.LOG_LEVEL?.trim() || 'info',
  }
}
