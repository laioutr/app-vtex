/**
 * Stands in for Nitro's `#imports` under Vitest, which resolves modules itself and so never builds
 * the alias Nuxt generates. Each export mirrors the runtime contract closely enough for a unit
 * test and no further — `defineCachedFunction` deliberately does not cache, so a suite observes
 * every upstream call the handler makes.
 */
export const defineCachedFunction = <T extends (...args: never[]) => unknown>(fn: T): T => fn;
