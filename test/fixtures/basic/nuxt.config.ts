import MyModule from '../../../src/module';

export default defineNuxtConfig({
  modules: [MyModule, '@laioutr-core/frontend-core'],
  '@laioutr/app-vtex': {
    accountName: 'vtexfixtureaccount',
    appKey: 'fixture-app-key-must-not-leak',
    appToken: 'fixture-app-token-must-not-leak',
  },
});
