import { describe, expect, it } from 'vitest';
import { normalizeImageUrl, toCatalogImage, toCatalogImages, toVtexImage } from './media';

describe('normalizeImageUrl', () => {
  it('drops the dimensions VTEX bakes into the id segment', () => {
    expect(normalizeImageUrl('https://x.vteximg.com.br/arquivos/ids/157422-55-55/a.jpg?v=1')).toBe(
      'https://x.vteximg.com.br/arquivos/ids/157422/a.jpg?v=1'
    );
  });

  it('leaves a url carrying no size alone', () => {
    expect(normalizeImageUrl('https://x/arquivos/ids/157422/a.jpg')).toBe(
      'https://x/arquivos/ids/157422/a.jpg'
    );
  });

  it('passes through a url that is not served from VTEX s file store', () => {
    expect(normalizeImageUrl('https://cdn.example/a.jpg')).toBe('https://cdn.example/a.jpg');
  });
});

describe('toVtexImage', () => {
  it('normalizes every image it builds, whatever endpoint the url came from', () => {
    expect(toVtexImage('https://x/arquivos/ids/157422-55-55/a.jpg').sources[0]?.src).toBe(
      'https://x/arquivos/ids/157422/a.jpg'
    );
  });

  it('addresses the vtex provider so resizing happens on VTEX s CDN', () => {
    expect(toVtexImage('https://x/arquivos/ids/1/a.jpg', 'Shoe')).toEqual({
      type: 'image',
      alt: 'Shoe',
      sources: [{ provider: 'vtex', src: 'https://x/arquivos/ids/1/a.jpg' }],
    });
  });

  it('omits an empty alt rather than carrying a blank one', () => {
    expect(toVtexImage('https://x/a.jpg', '').alt).toBeUndefined();
    expect(toVtexImage('https://x/a.jpg').alt).toBeUndefined();
  });
});

describe('toCatalogImage', () => {
  it('prefers the image text, falling back to the label', () => {
    const src = 'https://x/arquivos/ids/1/a.jpg';
    expect(toCatalogImage({ imageUrl: src, imageText: 'Text', imageLabel: 'Label' }).alt).toBe(
      'Text'
    );
    expect(toCatalogImage({ imageUrl: src, imageText: null, imageLabel: 'Label' }).alt).toBe(
      'Label'
    );
    expect(toCatalogImage({ imageUrl: src, imageText: '', imageLabel: '' }).alt).toBeUndefined();
  });

  it('normalizes a sized catalog url, which some VTEX endpoints return', () => {
    expect(toCatalogImage({ imageUrl: 'https://x/arquivos/ids/1-292-292/a.jpg' }).sources[0]?.src).toBe(
      'https://x/arquivos/ids/1/a.jpg'
    );
  });
});

describe('toCatalogImages', () => {
  it('returns the same list under both keys, since every image is media', () => {
    const result = toCatalogImages([{ imageUrl: 'https://x/arquivos/ids/1/a.jpg' }]);
    expect(result.images).toHaveLength(1);
    expect(result.media).toEqual(result.images);
  });
});
