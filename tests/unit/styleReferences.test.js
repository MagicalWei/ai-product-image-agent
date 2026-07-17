import { describe, expect, it, vi } from 'vitest';
import {
  restoreStyleReferenceImages,
  selectStyleReferenceUrls,
} from '../../backend/utils/styleReferences.js';

describe('style reference persistence', () => {
  it('replaces the previous reference when a new durable reference is sent', () => {
    expect(selectStyleReferenceUrls(
      { style_reference_image_urls: ['/uploads/old.png'] },
      [{ role: 'style_reference', url: '/uploads/new.png' }],
    )).toEqual(['/uploads/new.png']);
  });

  it('restores the stored reference on a later turn without attachments', () => {
    expect(selectStyleReferenceUrls(
      { style_reference_image_urls: ['/uploads/style.png'] },
      [],
    )).toEqual(['/uploads/style.png']);
  });

  it('does not persist transient data URLs as durable references', () => {
    expect(selectStyleReferenceUrls({}, [
      { role: 'style_reference', url: 'data:image/png;base64,LOCAL' },
    ])).toEqual([]);
  });

  it('loads a stored reference back into multimodal data URL form', async () => {
    const storage = {
      getFileBuffer: vi.fn().mockResolvedValue(Buffer.from('style-image')),
    };
    const images = await restoreStyleReferenceImages(storage, ['/uploads/style.webp']);

    expect(storage.getFileBuffer).toHaveBeenCalledWith('/uploads/style.webp');
    expect(images).toEqual([
      `data:image/webp;base64,${Buffer.from('style-image').toString('base64')}`,
    ]);
  });
});
