import { fileURLToPath } from 'node:url';
import { $fetch, setup } from '@nuxt/test-utils/e2e';
import { describe, expect, it } from 'vitest';

describe('ssr', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('./fixtures/basic', import.meta.url)),
  });

  it('renders the index page', async () => {
    // Get response to a server-rendered page with `$fetch`.
    const html = await $fetch('/');
    // The fixture mounts `<LfcApp />`, so a successful render carries frontend-core's generator
    // tag. Asserting on it proves the module and frontend-core booted and server-rendered.
    expect(html).toContain('<meta name="generator" content="Laioutr">');
  });

  it('keeps the app credentials out of the client payload', async () => {
    const html = await $fetch<string>('/');

    // Nuxt serialises the public runtime config into the SSR payload, so anything the module
    // places there is readable by every visitor. `appKey` and `appToken` authenticate
    // server-to-server calls and must stay in the private config only.
    expect(html).not.toContain('fixture-app-key-must-not-leak');
    expect(html).not.toContain('fixture-app-token-must-not-leak');

    // Guards the assertions above: without a value that does reach the payload, they would pass
    // just as well if the module wired no public config at all.
    expect(html).toContain('vtexfixtureaccount');
  });
});
