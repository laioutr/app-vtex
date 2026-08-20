/* eslint-disable @typescript-eslint/no-empty-object-type */
import { createResolver, defineNuxtModule, installModule } from '@nuxt/kit';
import { defu } from 'defu';
import { registerLaioutrApp } from '@laioutr-core/kit';
import { name, version } from '../package.json';

/**
 * The options the module adds to the nuxt.config.ts.
 */
export interface ModuleOptions {
  /** VTEX account name — the store's subdomain on the VTEX platform. */
  accountName: string;
  /** Which VTEX environment to address. Production stores use `vtexcommercestable`. */
  environment: 'vtexcommercestable' | 'myvtex';
  /** Application key for server-to-server calls, sent as `X-VTEX-API-AppKey`. */
  appKey: string;
  /** Application token for server-to-server calls, sent as `X-VTEX-API-AppToken`. */
  appToken: string;
  /** Sales channel ("trade policy") to scope catalog and checkout reads to. */
  salesChannel: string;
  /** Market slug -> VTEX sales channel id. Falls back to {@link ModuleOptions.salesChannel}. */
  salesChannelByMarket?: Record<string, string>;
  /** Which search backend to use. Intelligent Search requires an active VTEX IO store. */
  searchProvider: 'legacy' | 'intelligent';
}

/**
 * The config the module adds to nuxt.runtimeConfig.public['@laioutr/app-vtex']
 *
 * Carries only values that are safe to ship to the browser. `appKey` and `appToken` are
 * deliberately absent — they authenticate server-to-server calls and would be readable by
 * anyone if exposed here.
 */
export interface RuntimeConfigModulePublic extends Pick<ModuleOptions, 'accountName' | 'environment' | 'salesChannel'> {}

/**
 * The config the module adds to nuxt.runtimeConfig['@laioutr/app-vtex']
 */
export interface RuntimeConfigModulePrivate extends ModuleOptions {}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name,
    version,
    configKey: name, // configKey must match package name
  },
  defaults: {
    accountName: '',
    environment: 'vtexcommercestable',
    appKey: '',
    appToken: '',
    salesChannel: '1',
    searchProvider: 'legacy',
  },
  async setup(options, nuxt) {
    const { resolve } = createResolver(import.meta.url);
    const resolveRuntimeModule = (path: string) => resolve('./runtime', path);

    nuxt.options.build.transpile.push(resolve('./runtime'));

    nuxt.options.runtimeConfig[name] = defu(nuxt.options.runtimeConfig[name] as Parameters<typeof defu>[0], options);

    const { accountName, environment, salesChannel } = options;
    nuxt.options.runtimeConfig.public[name] = defu(nuxt.options.runtimeConfig.public[name] as Parameters<typeof defu>[0], {
      accountName,
      environment,
      salesChannel,
    });

    // Make app-assets publicly available, namespaced so they cannot collide with another app's.
    nuxt.options.nitro.publicAssets ??= [];
    nuxt.options.nitro.publicAssets.push({
      dir: resolveRuntimeModule('./app/public'),
      maxAge: 60 * 60 * 24 * 365,
    });

    await registerLaioutrApp({
      name,
      version,
      orchestrDirs: [resolveRuntimeModule('server/orchestr')],
      sections: [resolveRuntimeModule('app/sections')],
      blocks: [resolveRuntimeModule('app/blocks')],
    });

    // Install peer-dependency modules only on prepare-step.
    // This makes auto-imports and import-aliases work. Remove any modules you might not need.
    if (nuxt.options._prepare) {
      await installModule('@nuxt/image');
      await installModule('@laioutr-core/frontend-core');
      await installModule('@laioutr-core/orchestr');
      await installModule('@laioutr-app/ui');
    }

    // Shared
    // Imports and other stuff which is shared between client and server

    // Client
    // Add plugins, composables, etc.

    // Server
    // Add server-only imports, etc.
  },
});
