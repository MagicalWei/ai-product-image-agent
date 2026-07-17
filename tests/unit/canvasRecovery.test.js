import { describe, expect, it } from 'vitest';
import { recoverCanvasFromAssets } from '../../backend/utils/canvasRecovery';

describe('canvas asset recovery', () => {
  it('adds missing AI assets without duplicating product or existing layers', () => {
    const existing = {
      elements: [{
        id: 'product', type: 'image', url: '/uploads/product.png',
        x: -200, y: -200, width: 400, height: 400, source: 'user_uploaded',
      }],
      camera: { x: 400, y: 300, zoom: 1 },
    };
    const { canvasState, recoveredCount } = recoverCanvasFromAssets(existing, [
      { id: 'style', url: '/uploads/style.png', source: 'user_uploaded', metrics: { asset_role: 'style_reference' } },
      { id: 'main', name: 'Agent_main_设计', url: '/uploads/main.jpg', source: 'ai_generated' },
      { id: 'selling', name: 'Agent_selling_point_设计', url: '/uploads/selling.jpg', source: 'ai_generated' },
    ]);

    expect(recoveredCount).toBe(2);
    expect(canvasState.elements.map(element => element.url)).toEqual([
      '/uploads/product.png', '/uploads/main.jpg', '/uploads/selling.jpg',
    ]);
    expect(canvasState.elements[1]).toMatchObject({ source: 'ai_generated', imageType: 'main' });
    expect(canvasState.elements[2]).toMatchObject({ source: 'ai_generated', imageType: 'selling_point' });
  });

  it('is idempotent when the generated asset already exists on canvas', () => {
    const state = {
      elements: [{ id: 'main', type: 'image', url: '/uploads/main.jpg' }],
    };
    const result = recoverCanvasFromAssets(state, [
      { id: 'main-asset', url: '/uploads/main.jpg', source: 'ai_generated' },
    ]);

    expect(result.recoveredCount).toBe(0);
    expect(result.canvasState.elements).toHaveLength(1);
  });

  it('rebuilds an empty historical canvas from linked product and generated assets', () => {
    const result = recoverCanvasFromAssets({ elements: [] }, [
      { id: 'product', name: '商品原图', url: '/uploads/product.png', source: 'user_uploaded', metrics: { asset_role: 'product' } },
      { id: 'style', name: '风格图', url: '/uploads/style.png', source: 'user_uploaded', metrics: { asset_role: 'style_reference' } },
      { id: 'region', name: '框选图', url: '/uploads/region.png', source: 'user_uploaded', metrics: { asset_role: 'chat_attachment' } },
      { id: 'detail', name: 'Agent_detail_设计', url: '/uploads/detail.jpg', source: 'ai_generated', metrics: { image_type: 'detail' } },
    ]);

    expect(result.recoveredCount).toBe(2);
    expect(result.canvasState.elements).toHaveLength(2);
    expect(result.canvasState.elements[0]).toMatchObject({ url: '/uploads/product.png', source: 'user_uploaded', imageType: 'product' });
    expect(result.canvasState.elements[1]).toMatchObject({ url: '/uploads/detail.jpg', source: 'ai_generated', imageType: 'detail' });
  });
});
