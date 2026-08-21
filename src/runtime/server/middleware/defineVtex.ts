import { parseCookies } from 'h3';
import { defineOrchestr, setManagedCookie, useRuntimeConfig } from '#imports';
import { name } from '../../../../package.json';
import { parseVtexSetCookie } from '../client/cookies';
import { resolveSalesChannel } from '../client/salesChannel';
import { createVtexClient } from '../client/vtexClientFactory';

export const defineVtex = defineOrchestr
  .meta({
    app: name,
    label: 'VTEX',
    logoUrl: '/app-vtex/vtex-logo.svg',
  })
  .extendRequest(async (args) => {
    const config = useRuntimeConfig()[name] as {
      accountName: string;
      environment: string;
      appKey: string;
      appToken: string;
      salesChannel: string;
      salesChannelByMarket?: Record<string, string>;
    };

    const salesChannel = resolveSalesChannel(args.clientEnv.market, config);

    const vtexClient = createVtexClient({
      accountName: config.accountName,
      environment: config.environment,
      appKey: config.appKey,
      appToken: config.appToken,
      salesChannel,
      cookies: parseCookies(args.event),
      onSetCookie: (raw) => {
        const cookie = parseVtexSetCookie(raw, config.accountName);
        if (!cookie) return;

        // `sameSite: 'lax'` rather than 'strict': the shopper returns from VTEX's checkout domain
        // on a top-level GET, which 'strict' would strip the cart cookie from.
        setManagedCookie(args.event, cookie.name, cookie.value, {
          httpOnly: true,
          path: '/',
          sameSite: 'lax',
          expires: cookie.expires,
        });
      },
    });

    // Keys are namespaced: this object merges into a context shared by every installed app.
    return {
      context: {
        vtexClient,
        vtexAccountName: config.accountName,
        vtexSalesChannel: salesChannel,
        vtexIsAuthenticated: vtexClient.isAuthenticated,
      },
    };
  });

export const defineVtexQuery = defineVtex.queryHandler;
export const defineVtexAction = defineVtex.actionHandler;
export const defineVtexLink = defineVtex.linkHandler;
export const defineVtexComponentResolver = defineVtex.componentResolver;
export const defineVtexPageIndex = defineVtex.pageIndex;
export const defineVtexQueryTemplateProvider = defineVtex.queryTemplateProvider;
