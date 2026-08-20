import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Plain `defineConfig` rather than `@nuxt/test-utils`' `defineVitestConfig`: that helper boots a
    // Nuxt instance and pulls in happy-dom to build a DOM these suites never touch, and it
    // regenerates the root `.nuxt` without the playground's config, leaving `vue-tsc` reporting
    // phantom errors until the next `pnpm dev:prepare`.
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'node',
  },
});
