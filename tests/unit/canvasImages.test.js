import { describe, expect, it } from 'vitest';
import { getCanvasMaterialImages, isReferenceCanvasImage } from '../../frontend/src/lib/canvasImages';

describe('canvas reference material filtering', () => {
  it('keeps both uploaded and generated canvas images', () => {
    const elements = [
      { id: 'product', type: 'image', source: 'user_uploaded' },
      { id: 'legacy-upload', type: 'image' },
      { id: 'main', type: 'image', source: 'ai_generated', isGenerated: true },
      { id: 'shape', type: 'rect' },
    ];
    expect(elements.filter(isReferenceCanvasImage).map(item => item.id)).toEqual([
      'product',
      'legacy-upload',
      'main',
    ]);
  });

  it('shows an exact generated URL only once', () => {
    const elements = [
      { id: 'main-stream', type: 'image', url: '/uploads/main.jpg', source: 'ai_generated' },
      { id: 'main-recovered', type: 'image', url: '/uploads/main.jpg', source: 'ai_generated' },
      { id: 'selling', type: 'image', url: '/uploads/selling.jpg', source: 'ai_generated' },
    ];
    expect(getCanvasMaterialImages(elements).map(item => item.id)).toEqual([
      'main-stream',
      'selling',
    ]);
  });
});
