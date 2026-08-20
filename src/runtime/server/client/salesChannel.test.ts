import { describe, expect, it } from 'vitest';
import { resolveSalesChannel } from './salesChannel';

describe('resolveSalesChannel', () => {
  const options = { salesChannel: '1', salesChannelByMarket: { switzerland: '2', austria: '3' } };

  it('uses the mapped channel for a known market', () => {
    expect(resolveSalesChannel({ slug: 'switzerland' }, options)).toBe('2');
  });

  it('falls back to the default for an unmapped market', () => {
    expect(resolveSalesChannel({ slug: 'germany' }, options)).toBe('1');
  });

  it('falls back to the default when no map is configured at all', () => {
    expect(resolveSalesChannel({ slug: 'switzerland' }, { salesChannel: '1' })).toBe('1');
  });
});
