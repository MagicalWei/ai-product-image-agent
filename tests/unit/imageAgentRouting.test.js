import { describe, expect, it } from 'vitest';
import {
  resolveAttachmentImageRoles,
  routeMessageForAttachments,
  stripAttachmentRoutingFromDisplay,
} from '../../frontend/src/lib/imageAgentRouting';

describe('composer attachment routing', () => {
  it('does not alter text-only messages', () => {
    expect(routeMessageForAttachments('你好', [])).toBe('你好');
  });

  it('routes any attached image directly to the image Agent', () => {
    expect(routeMessageForAttachments('调整背景', [{ id: 'image-1' }]))
      .toBe('[[DIRECT_IMAGE_AGENT]]\n调整背景');
  });

  it('uses region-edit routing for an annotated rectangle attachment', () => {
    expect(routeMessageForAttachments('改成蓝色', [{ id: 'region-1', kind: 'region_edit' }]))
      .toBe('[[DIRECT_IMAGE_AGENT_REGION]]\n改成蓝色');
  });

  it('routes a style reference to the dedicated style-transfer workflow', () => {
    expect(routeMessageForAttachments('生成套图', [{ id: 'style-1', role: 'style_reference' }]))
      .toBe('生成套图');
  });

  it('hides routing and region context markers from the user bubble', () => {
    expect(stripAttachmentRoutingFromDisplay(
      '[[DIRECT_IMAGE_AGENT_REGION]]\n[系统] 画布框选区域:\n- 蓝色框\n\n[用户指令] 框选的字体都修改一下'
    )).toBe('框选的字体都修改一下');
  });
});

describe('attachment image roles', () => {
  it('keeps the confirmed product and treats a new generic attachment as context', () => {
    expect(resolveAttachmentImageRoles({
      attachments: [{ id: 'reference' }],
      encodedImages: ['REFERENCE'],
      establishedProductImage: 'PRODUCT',
    })).toEqual({
      productImage: 'PRODUCT',
      referenceImages: ['REFERENCE'],
      styleReferenceImages: [],
    });
  });

  it('uses the first generic upload as product only when no product exists', () => {
    expect(resolveAttachmentImageRoles({
      attachments: [{ id: 'product' }],
      encodedImages: ['PRODUCT'],
    })).toEqual({
      productImage: 'PRODUCT',
      referenceImages: [],
      styleReferenceImages: [],
    });
  });

  it('preserves explicitly marked style references', () => {
    expect(resolveAttachmentImageRoles({
      attachments: [{ id: 'style', role: 'style_reference' }],
      encodedImages: ['STYLE'],
      establishedProductImage: 'PRODUCT',
    })).toEqual({
      productImage: 'PRODUCT',
      referenceImages: [],
      styleReferenceImages: ['STYLE'],
    });
  });
});
