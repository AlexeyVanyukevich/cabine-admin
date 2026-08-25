import type { Migration } from 'kysely/migration'

/**
 * Migrations are listed explicitly instead of being discovered from disk, for the same reason
 * the engine does it: Kysely's FileMigrationProvider imports files at runtime, which fails
 * wherever the runtime cannot load TypeScript directly — Vitest's global setup, plain `node`
 * on the sources — and forces a build step before migrating. A static map works everywhere
 * and makes the order of application visible in review.
 *
 * Keys are the names Kysely records in `kysely_migration`; they are applied in lexicographic
 * order, so keep the numeric prefix. Task 3 adds `001_initial`.
 */
export const migrations: Record<string, Migration> = {}
