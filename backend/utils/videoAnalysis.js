import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const analysisRoot = path.join(os.tmpdir(), 'ai-product-video-analysis');
fs.mkdirSync(analysisRoot, { recursive: true });

function run(binary, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-6000); });
    child.once('error', reject);
    child.once('close', code => code === 0
      ? resolve()
      : reject(new Error(`关键帧提取失败 (${code}): ${stderr.slice(-600)}`)));
  });
}

const frameFilter = interval => [
  ...(interval ? [`fps=1/${interval.toFixed(4)}`] : []),
  'scale=512:-2:force_original_aspect_ratio=decrease',
  'format=rgb24',
].join(',');

async function extractFramesIndividually({ binary, filePath, directory, duration, maxFrames }) {
  const frameCount = Math.max(1, Math.min(maxFrames, Math.ceil(Math.max(duration, 0.5) / 0.5)));
  const interval = Math.max(0.5, duration / frameCount);
  const timestamps = Array.from({ length: frameCount }, (_, index) => (
    Math.min(Math.max(0, duration - 0.05), index * interval)
  ));
  for (let index = 0; index < timestamps.length; index += 1) {
    const output = path.join(directory, `frame-${String(index + 1).padStart(2, '0')}.png`);
    await run(binary, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', filePath, '-ss', timestamps[index].toFixed(4),
      '-map', '0:V:0', '-frames:v', '1', '-an', '-sn', '-dn',
      '-vf', frameFilter(), '-c:v', 'png', '-compression_level', '6', output,
    ]);
    const stat = await fs.promises.stat(output).catch(() => null);
    if (!stat?.size) throw new Error(`时间点 ${timestamps[index].toFixed(2)} 秒没有可解码画面`);
  }
  return interval;
}

const listPngFrames = async directory => (
  (await fs.promises.readdir(directory)).filter(name => name.endsWith('.png')).sort()
);

export async function extractImageFrame(filePath) {
  const directory = path.join(analysisRoot, crypto.randomUUID());
  await fs.promises.mkdir(directory, { recursive: true });
  const output = path.join(directory, 'frame-01.png');
  try {
    await run(process.env.FFMPEG_PATH || 'ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', filePath,
      '-map', '0:v:0', '-frames:v', '1', '-an', '-sn', '-dn',
      '-vf', frameFilter(), '-c:v', 'png', '-compression_level', '6', output,
    ]);
    const stat = await fs.promises.stat(output).catch(() => null);
    if (!stat?.size) throw new Error('图片转换后没有输出画面');
    return {
      directory,
      frames: [{
        timestamp: 0,
        mimeType: 'image/png',
        base64: (await fs.promises.readFile(output)).toString('base64'),
      }],
    };
  } catch (error) {
    console.warn('[Video Analysis] Product image decoding failed:', error.message);
    await fs.promises.rm(directory, { recursive: true, force: true });
    throw new Error('商品图片无法读取，请使用 JPG、PNG 或 WebP 格式后重试');
  }
}

export async function extractKeyframes(filePath, duration, maxFrames = 8) {
  const directory = path.join(analysisRoot, crypto.randomUUID());
  await fs.promises.mkdir(directory, { recursive: true });
  const interval = Math.max(0.5, duration / Math.max(1, maxFrames));
  const pattern = path.join(directory, 'frame-%02d.png');
  const binary = process.env.FFMPEG_PATH || 'ffmpeg';
  let effectiveInterval = interval;
  try {
    await run(binary, [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', filePath,
      '-map', '0:V:0', '-an', '-sn', '-dn',
      '-vf', frameFilter(interval), '-frames:v', String(maxFrames),
      '-fps_mode', 'vfr', '-c:v', 'png', '-compression_level', '6', pattern,
    ]);
    if ((await listPngFrames(directory)).length === 0) {
      throw new Error('批量抽帧没有产出画面');
    }
  } catch (primaryError) {
    await Promise.allSettled((await fs.promises.readdir(directory)).map(name => (
      fs.promises.unlink(path.join(directory, name))
    )));
    try {
      effectiveInterval = await extractFramesIndividually({
        binary, filePath, directory, duration, maxFrames,
      });
    } catch (fallbackError) {
      console.warn('[Video Analysis] Keyframe extraction failed in both modes:', {
        primary: primaryError.message,
        fallback: fallbackError.message,
      });
      await fs.promises.rm(directory, { recursive: true, force: true });
      throw new Error('无法读取该视频的画面，请将视频转为 MP4（H.264、8-bit、yuv420p）后重试');
    }
  }
  const names = await listPngFrames(directory);
  if (names.length === 0) {
    await fs.promises.rm(directory, { recursive: true, force: true });
    throw new Error('视频中没有可读取的画面');
  }
  const frames = await Promise.all(names.map(async (name, index) => ({
    timestamp: Math.min(duration, index * effectiveInterval),
    mimeType: 'image/png',
    base64: (await fs.promises.readFile(path.join(directory, name))).toString('base64'),
  })));
  return { directory, frames };
}

function parseJsonContent(content) {
  let text = String(content || '').trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) text = text.slice(start, end + 1);
  return JSON.parse(text);
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));

export function normalizeVideoAnalysis(raw, probes) {
  const sources = probes.map((probe, index) => ({
    source_index: index,
    duration: Number(probe.duration.toFixed(3)),
    has_audio: Boolean(probe.hasAudio),
  }));
  const rawScenes = Array.isArray(raw?.scenes) ? raw.scenes : [];
  const scenes = rawScenes.slice(0, 40).map((scene) => {
    const sourceIndex = Math.min(sources.length - 1, Math.max(0, Math.trunc(Number(scene?.source_index) || 0)));
    const duration = sources[sourceIndex]?.duration || 0;
    const start = clamp(scene?.start, 0, duration);
    const end = clamp(scene?.end ?? start + 1, start, duration);
    return {
      source_index: sourceIndex,
      start,
      end,
      description: String(scene?.description || '').trim().slice(0, 300),
      visual_style: String(scene?.visual_style || '').trim().slice(0, 240),
      importance: clamp(scene?.importance ?? 50, 0, 100),
      quality: clamp(scene?.quality ?? 70, 0, 100),
    };
  }).filter(scene => scene.end > scene.start && scene.description);

  const rawPlan = raw?.recommended_plan || {};
  const rawClips = Array.isArray(rawPlan.clips) ? rawPlan.clips : [];
  const clips = rawClips.slice(0, 12).map((clip) => {
    const sourceIndex = Math.min(sources.length - 1, Math.max(0, Math.trunc(Number(clip?.source_index) || 0)));
    const duration = sources[sourceIndex]?.duration || 0;
    const start = clamp(clip?.start, 0, duration);
    const end = clamp(clip?.end ?? start + 1, start, duration);
    return {
      source_index: sourceIndex,
      start,
      end,
      reason: String(clip?.reason || '').trim().slice(0, 180),
    };
  }).filter(clip => clip.end > clip.start);

  return {
    summary: String(raw?.summary || '视频素材分析完成').trim().slice(0, 1000),
    product: String(raw?.product || '').trim().slice(0, 160),
    selling_points: (Array.isArray(raw?.selling_points) ? raw.selling_points : [])
      .map(point => String(point).trim().slice(0, 120)).filter(Boolean).slice(0, 8),
    content_risks: (Array.isArray(raw?.content_risks) ? raw.content_risks : [])
      .map(risk => String(risk).trim().slice(0, 160)).filter(Boolean).slice(0, 8),
    visual_style: String(raw?.visual_style || '').trim().slice(0, 500),
    scenes,
    sources,
    recommended_plan: {
      aspect_ratio: ['9:16', '16:9', '1:1', '4:5'].includes(rawPlan.aspect_ratio)
        ? rawPlan.aspect_ratio : '9:16',
      clips: clips.length ? clips : scenes
        .filter(scene => scene.importance >= 60)
        .slice(0, 6)
        .map(scene => ({
          source_index: scene.source_index, start: scene.start, end: scene.end, reason: scene.description,
        })),
      text_overlay: rawPlan.text_overlay && String(rawPlan.text_overlay.text || '').trim()
        ? {
            text: String(rawPlan.text_overlay.text).trim().slice(0, 120),
            position: ['top', 'center', 'bottom'].includes(rawPlan.text_overlay.position)
              ? rawPlan.text_overlay.position : 'bottom',
            font_size: Math.round(clamp(rawPlan.text_overlay.font_size || 42, 18, 96)),
            color: String(rawPlan.text_overlay.color || 'FFFFFF').replace('#', '').slice(0, 6),
          }
        : null,
      original_volume: clamp(rawPlan.original_volume ?? 1, 0, 2),
      music_volume: clamp(rawPlan.music_volume ?? 0.25, 0, 2),
      fade: rawPlan.fade !== false,
      fps: [24, 25, 30].includes(Number(rawPlan.fps)) ? Number(rawPlan.fps) : 30,
    },
  };
}

export async function analyzeVideoWithMultimodal({ frameGroups, probes, instruction, apiKey, baseUrl, model }) {
  if (!apiKey || !baseUrl || !model) throw new Error('未配置可用的多模态视频分析模型');
  const content = [{
    type: 'text',
    text: `你是电商短视频剪辑导演。请根据随后带素材编号和时间戳的关键帧，理解商品、镜头内容和卖点，输出可执行粗剪方案。\n用户要求：${String(instruction || '生成节奏紧凑的商品信息流短视频').slice(0, 500)}`,
  }];
  frameGroups.forEach((group, sourceIndex) => {
    group.frames.forEach((frame) => {
      content.push({ type: 'text', text: `素材 ${sourceIndex}，时间 ${frame.timestamp.toFixed(2)} 秒` });
      content.push({ type: 'image_url', image_url: { url: `data:${frame.mimeType || 'image/jpeg'};base64,${frame.base64}`, detail: 'low' } });
    });
  });
  content.push({
    type: 'text',
    text: `素材元数据：${JSON.stringify(probes.map((probe, index) => ({ source_index: index, duration: probe.duration, has_audio: probe.hasAudio })))}。`+
      '只根据可见证据判断，不虚构商品功能。返回严格 JSON：' +
      '{"summary":"","product":"","selling_points":[""],"content_risks":[""],"visual_style":"光线、配色、构图、镜头语言与氛围","scenes":[{"source_index":0,"start":0,"end":1,"description":"","visual_style":"该镜头的可见风格","importance":0,"quality":0}],"recommended_plan":{"aspect_ratio":"9:16","clips":[{"source_index":0,"start":0,"end":1,"reason":""}],"text_overlay":{"text":"","position":"bottom","font_size":42,"color":"FFFFFF"},"original_volume":1,"music_volume":0.25,"fade":true,"fps":30}}',
  });

  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: '你负责视频理解和结构化剪辑决策，不负责执行命令。所有时间必须位于素材真实时长内。' },
        { role: 'user', content },
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || `多模态视频分析失败 (HTTP ${response.status})`);
  const parsed = parseJsonContent(data.choices?.[0]?.message?.content);
  return normalizeVideoAnalysis(parsed, probes);
}
