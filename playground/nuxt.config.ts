import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import srcModule from '../src/module';

// `laioutrrc.json` is gitignored and fetched per checkout via `@laioutr/cli project fetch-rc`, so
// CI and fresh clones have no copy. A bare import of it fails the entire config, taking
// `dev:prepare`, lint and the test suite down with it — fall back to an empty rc instead, which
// leaves the module buildable with only the remote project configuration missing.
const rcPath = fileURLToPath(new URL('../laioutrrc.json', import.meta.url));
const laioutrrc = existsSync(rcPath) ? JSON.parse(readFileSync(rcPath, 'utf8')) : {};

// Disable project secret key for playground
laioutrrc.laioutr = { ...laioutrrc.laioutr, projectSecretKey: false };

export default defineNuxtConfig({
  modules: [
    srcModule,
    '@pinia/nuxt', // Added to show in devtools
    '@laioutr-core/frontend-core',
    '@laioutr-core/devtools',
  ],
  laioutr: {
    laioutrrc: laioutrrc as any,
  },
  // Credentials come from the gitignored `.env`; see .env.example for the shape.
  '@laioutr/app-vtex': {
    accountName: import.meta.env.VTEX_ACCOUNT_NAME,
    environment: import.meta.env.VTEX_ENVIRONMENT,
    appKey: import.meta.env.VTEX_APP_KEY,
    appToken: import.meta.env.VTEX_APP_TOKEN,
    salesChannel: import.meta.env.VTEX_SALES_CHANNEL,
  },
  devtools: { enabled: true },
  compatibilityDate: '2025-09-11',
});
