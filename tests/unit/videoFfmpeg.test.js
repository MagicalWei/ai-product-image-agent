import { describe, expect, it } from 'vitest';
import { buildFfmpegArgs, normalizeVideoPlan } from '../../backend/utils/videoFfmpeg.js';

describe('normalizeVideoPlan', () => {
  it('keeps a bounded image-to-video instruction for an uploaded image', () => {
    const plan = normalizeVideoPlan({
      clips: [{ source_index: 1, start: 0, end: 5 }],
      image_animations: [{ source_index: 1, prompt: '保持商品一致并缓慢推进', duration: 20 }],
    }, 2);
    expect(plan.image_animations).toEqual([{
      source_index: 1,
      prompt: '保持商品一致并缓慢推进',
      duration: 12,
    }]);
  });

  it('rejects duplicate image-to-video tasks for one source', () => {
    expect(() => normalizeVideoPlan({
      image_animations: [
        { source_index: 0, prompt: '推进' },
        { source_index: 0, prompt: '平移' },
      ],
    }, 1)).toThrow('同一张商品图片');
  });

  it('normalizes a safe FFmpeg edit plan', () => {
    expect(normalizeVideoPlan({
      aspect_ratio: '16:9',
      clips: [{ source_index: 0, start: 1.5, end: 4 }],
      text_overlay: { text: '新品上市', position: 'top', font_size: 999, color: '#FF6600' },
      original_volume: 0.8,
    }, 1)).toMatchObject({
      aspect_ratio: '16:9',
      clips: [{ source_index: 0, start: 1.5, end: 4 }],
      text_overlay: { text: '新品上市', position: 'top', font_size: 96, color: 'FF6600' },
      original_volume: 0.8,
    });
  });

  it('rejects invalid source indexes and time ranges', () => {
    expect(() => normalizeVideoPlan({ clips: [{ source_index: 2 }] }, 1)).toThrow('无效的视频素材');
    expect(() => normalizeVideoPlan({ clips: [{ source_index: 0, start: 5, end: 2 }] }, 1)).toThrow('结束时间');
  });

  it('normalizes timed copy for a replication timeline', () => {
    const plan = normalizeVideoPlan({
      clips: [{ source_index: 0, start: 0, end: 2 }],
      timed_texts: [
        { text: '三秒抓住注意力', start: 0, end: 1.8, position: 'bottom', font_size: 42 },
        { text: '', start: 1.8, end: 2 },
      ],
    }, 1);
    expect(plan.timed_texts).toHaveLength(1);
    expect(plan.timed_texts[0]).toMatchObject({ text: '三秒抓住注意力', start: 0, end: 1.8 });
  });
});

describe('buildFfmpegArgs', () => {
  it('builds argument arrays without exposing a shell command surface', () => {
    const plan = normalizeVideoPlan({
      clips: [{ source_index: 0, start: 0, end: 2 }],
      text_overlay: { text: "新品'; rm -rf /", position: 'bottom' },
      fade: true,
    }, 1);
    const { args, duration } = buildFfmpegArgs({
      inputs: ['/tmp/source.mp4'],
      musicPath: '',
      outputPath: '/tmp/output.mp4',
      plan,
      probes: [{ duration: 3, hasAudio: false }],
    });

    expect(duration).toBe(2);
    expect(args[0]).toBe('-hide_banner');
    expect(args).not.toContain('sh');
    expect(args).not.toContain('-c');
    expect(args.at(-1)).toBe('/tmp/output.mp4');
    expect(args[args.indexOf('-filter_complex') + 1]).toContain("rm -rf /");
  });

  it('creates video and audio concat graphs for multiple clips', () => {
    const plan = normalizeVideoPlan({ clips: [
      { source_index: 0, start: 0, end: 1 },
      { source_index: 1, start: 0, end: 2 },
    ] }, 2);
    const { args, duration } = buildFfmpegArgs({
      inputs: ['/tmp/one.mp4', '/tmp/two.mp4'],
      musicPath: '/tmp/music.mp3',
      outputPath: '/tmp/out.mp4',
      plan,
      probes: [{ duration: 1, hasAudio: true }, { duration: 2, hasAudio: false }],
    });
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(duration).toBe(3);
    expect(graph).toContain('concat=n=2:v=1:a=0');
    expect(graph).toContain('concat=n=2:v=0:a=1');
    expect(graph).toContain('amix=inputs=2');
  });

  it('builds a finite animated image clip with timed copy', () => {
    const plan = normalizeVideoPlan({
      clips: [{ source_index: 0, start: 0, end: 2.5 }],
      timed_texts: [{ text: '商品亮点', start: 0.2, end: 2.2, position: 'bottom' }],
    }, 1);
    const { args, duration } = buildFfmpegArgs({
      inputs: ['/tmp/product.png'],
      inputKinds: ['image'],
      musicPath: '',
      timedOverlayPaths: ['/tmp/caption.png'],
      outputPath: '/tmp/replica.mp4',
      plan,
      probes: [{ duration: 2.5, hasAudio: false }],
    });
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(duration).toBe(2.5);
    expect(args).toContain('-loop');
    expect(graph).toContain('zoompan=');
    expect(graph).toContain("overlay=0:0:enable='between(t,0.200,2.200)'");
  });

  it('rejects an output timeline longer than 60 seconds', () => {
    const plan = normalizeVideoPlan({ clips: [
      { source_index: 0, start: 0, end: 31 },
      { source_index: 1, start: 0, end: 30 },
    ] }, 2);

    expect(() => buildFfmpegArgs({
      inputs: ['/tmp/one.mp4', '/tmp/two.mp4'],
      outputPath: '/tmp/out.mp4',
      plan,
      probes: [{ duration: 31, hasAudio: false }, { duration: 30, hasAudio: false }],
    })).toThrow('成片时长不能超过 60 秒');
  });
});
