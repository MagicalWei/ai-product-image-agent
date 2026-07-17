import { describe, expect, it } from 'vitest';
import { resolveAssetUrl } from '../../frontend/src/lib/utils.js';

describe('resolveAssetUrl', () => {
  it('does not prefix an already absolute upload path twice', () => {
    expect(resolveAssetUrl('/uploads/generated-image-1.png'))
      .toBe('/uploads/generated-image-1.png');
  });

  it('normalizes relative stored paths and bare filenames', () => {
    expect(resolveAssetUrl('uploads/product.png')).toBe('/uploads/product.png');
    expect(resolveAssetUrl('assets/product.png')).toBe('/assets/product.png');
    expect(resolveAssetUrl('product.png')).toBe('/uploads/product.png');
  });

  it('preserves remote, data, and blob URLs', () => {
    expect(resolveAssetUrl('https://example.com/product.png')).toBe('https://example.com/product.png');
    expect(resolveAssetUrl('data:image/png;base64,abc')).toBe('data:image/png;base64,abc');
    expect(resolveAssetUrl('blob:http://localhost/image-id')).toBe('blob:http://localhost/image-id');
  });
});
