import { describe, expect, it } from 'vitest';
import { normalizeVideoAnalysis } from '../../backend/utils/videoAnalysis.js';

describe('normalizeVideoAnalysis', () => {
  it('clamps hallucinated source indexes and timestamps to real media bounds', () => {
    const result = normalizeVideoAnalysis({
      summary: '商品展示视频',
      scenes: [{ source_index: 99, start: -2, end: 99, description: '商品正面', importance: 90, quality: 82 }],
      recommended_plan: {
        aspect_ratio: '9:16',
        clips: [{ source_index: 99, start: -1, end: 60, reason: '核心展示' }],
      },
    }, [{ duration: 8.5, hasAudio: true }]);

    expect(result.scenes[0]).toMatchObject({ source_index: 0, start: 0, end: 8.5 });
    expect(result.recommended_plan.clips[0]).toMatchObject({ source_index: 0, start: 0, end: 8.5 });
    expect(result.sources).toEqual([{ source_index: 0, duration: 8.5, has_audio: true }]);
  });

  it('derives a plan from important scenes when the model omits clips', () => {
    const result = normalizeVideoAnalysis({
      scenes: [
        { source_index: 0, start: 0, end: 2, description: '低价值空镜', importance: 20 },
        { source_index: 0, start: 2, end: 5, description: '商品卖点展示', importance: 88 },
      ],
      recommended_plan: {},
    }, [{ duration: 6, hasAudio: false }]);
    expect(result.recommended_plan.clips).toEqual([
      { source_index: 0, start: 2, end: 5, reason: '商品卖点展示' },
    ]);
  });

  it('keeps reusable visual style descriptions for vector indexing', () => {
    const result = normalizeVideoAnalysis({
      visual_style: '高对比度蓝色科技风',
      scenes: [{
        source_index: 0, start: 0, end: 1, description: '商品特写',
        visual_style: '蓝色轮廓光与居中构图', importance: 90,
      }],
      recommended_plan: {},
    }, [{ duration: 2, hasAudio: false }]);
    expect(result.visual_style).toBe('高对比度蓝色科技风');
    expect(result.scenes[0].visual_style).toBe('蓝色轮廓光与居中构图');
  });
});
