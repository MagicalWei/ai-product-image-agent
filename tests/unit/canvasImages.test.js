import { describe, expect, it } from 'vitest';
import { isReferenceCanvasImage } from '../../frontend/src/lib/canvasImages';

describe('canvas reference material filtering', () => {
  it('keeps uploaded images and excludes generated outputs', () => {
    const elements = [
      { id: 'product', type: 'image', source: 'user_uploaded' },
      { id: 'legacy-upload', type: 'image' },
      { id: 'main', type: 'image', source: 'ai_generated', isGenerated: true },
      { id: 'shape', type: 'rect' },
    ];
    expect(elements.filter(isReferenceCanvasImage).map(item => item.id)).toEqual([
      'product',
      'legacy-upload',
    ]);
  });
});
