import { describe, expect, it } from 'vitest';
import { getImage } from './vtex';

const ctx = {} as never;
const src = 'https://acct.vteximg.com.br/arquivos/ids/156952/1917_1.jpg.jpg?v=6392284';

describe('vtex image provider', () => {
  it('writes the requested size into the id segment', () => {
    expect(getImage(src, { modifiers: { width: 300, height: 300 } }, ctx).url).toBe(
      'https://acct.vteximg.com.br/arquivos/ids/156952-300-300/1917_1.jpg.jpg?v=6392284'
    );
  });

  it('asks VTEX to derive the missing dimension rather than guessing it', () => {
    expect(getImage(src, { modifiers: { width: 800 } }, ctx).url).toContain('/ids/156952-800-0/');
    expect(getImage(src, { modifiers: { height: 500 } }, ctx).url).toContain('/ids/156952-0-500/');
  });

  it('replaces a size already present instead of appending another', () => {
    const sized = 'https://acct.vteximg.com.br/arquivos/ids/156952-300-300/1917_1.jpg.jpg';
    expect(getImage(sized, { modifiers: { width: 80, height: 80 } }, ctx).url).toBe(
      'https://acct.vteximg.com.br/arquivos/ids/156952-80-80/1917_1.jpg.jpg'
    );
  });

  it('rounds a fractional density-derived width, which VTEX would reject', () => {
    expect(getImage(src, { modifiers: { width: 266.66 } }, ctx).url).toContain('-267-0/');
  });

  it('returns the original when no size is asked for', () => {
    expect(getImage(src, {}, ctx).url).toBe(src);
  });

  it('passes through a URL that is not from the VTEX file store', () => {
    const other = 'https://cdn.example/img/shoe.jpg';
    expect(getImage(other, { modifiers: { width: 300 } }, ctx).url).toBe(other);
  });
});
