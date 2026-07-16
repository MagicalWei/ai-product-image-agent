import { describe, expect, it } from 'vitest';
import { routeMessageForAttachments } from '../../frontend/src/lib/imageAgentRouting';

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
});
