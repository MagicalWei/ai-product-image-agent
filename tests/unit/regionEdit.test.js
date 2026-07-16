// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { composeImageWithRegions, createImageEditRegion } from '../../frontend/src/lib/regionEdit';

describe('region edit composition', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('waits for the source image and draws scaled rectangle signals', async () => {
    class MockImage {
      set src(value) {
        this._src = value;
        this.naturalWidth = 400;
        this.naturalHeight = 300;
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('Image', MockImage);
    const context = {
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      set fillStyle(_value) {},
      set strokeStyle(_value) {},
      set lineWidth(_value) {},
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,Y29tcG9zaXRl');

    const result = await composeImageWithRegions(
      { width: 200, height: 150, url: 'data:image/png;base64,c291cmNl' },
      [{ relX: 10, relY: 20, width: 30, height: 40, color: '#EF4444' }],
    );

    expect(result).toBe('data:image/png;base64,Y29tcG9zaXRl');
    expect(context.drawImage).toHaveBeenCalledWith(expect.any(MockImage), 0, 0, 400, 300);
    expect(context.fillRect).toHaveBeenCalledWith(20, 40, 60, 80);
    expect(context.strokeRect).toHaveBeenCalledWith(20, 40, 60, 80);
  });

  it('links and clips a rectangle to the frontmost image under its center', () => {
    const result = createImageEditRegion(
      { id: 'rect-1', type: 'rect', x: 80, y: 90, width: 80, height: 60, color: '#EF4444' },
      [{ id: 'image-1', type: 'image', x: 100, y: 100, width: 200, height: 150 }],
    );

    expect(result.targetImage.id).toBe('image-1');
    expect(result.region).toMatchObject({
      imageId: 'image-1',
      x: 100,
      y: 100,
      width: 60,
      height: 50,
      relX: 0,
      relY: 0,
      isEditRegion: true,
    });
  });
});
