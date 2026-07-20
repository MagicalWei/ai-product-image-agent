import { spawn } from 'node:child_process';

export const VIDEO_RATIOS = {
  '16:9': { width: 1280, height: 720 },
  '9:16': { width: 720, height: 1280 },
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 864, height: 1080 },
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));

export function normalizeVideoPlan(raw = {}, inputCount = 1) {
  const ratio = VIDEO_RATIOS[raw.aspect_ratio] ? raw.aspect_ratio : '9:16';
  const clipsInput = Array.isArray(raw.clips) && raw.clips.length
    ? raw.clips
    : Array.from({ length: inputCount }, (_, sourceIndex) => ({ source_index: sourceIndex }));
  if (clipsInput.length > 12) throw new Error('单次最多支持 12 个剪辑片段');

  const clips = clipsInput.map((clip) => {
    const sourceIndex = Math.trunc(Number(clip.source_index));
    if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= inputCount) {
      throw new Error('剪辑片段引用了无效的视频素材');
    }
    const start = clamp(clip.start, 0, 3600);
    const end = clip.end === '' || clip.end == null ? null : clamp(clip.end, 0, 3600);
    if (end != null && end <= start) throw new Error('结束时间必须晚于开始时间');
    return { source_index: sourceIndex, start, end };
  });

  const overlay = raw.text_overlay && String(raw.text_overlay.text || '').trim()
    ? {
        text: String(raw.text_overlay.text).trim().slice(0, 120),
        position: ['top', 'center', 'bottom'].includes(raw.text_overlay.position)
          ? raw.text_overlay.position
          : 'bottom',
        font_size: Math.round(clamp(raw.text_overlay.font_size || 42, 18, 96)),
        color: /^[0-9a-fA-F]{6}$/.test(String(raw.text_overlay.color || '').replace('#', ''))
          ? String(raw.text_overlay.color).replace('#', '')
          : 'FFFFFF',
      }
    : null;
  const timedTexts = (Array.isArray(raw.timed_texts) ? raw.timed_texts : []).slice(0, 12)
    .map((item) => {
      const start = clamp(item.start, 0, 180);
      const end = clamp(item.end, start, 180);
      return {
        text: String(item.text || '').trim().slice(0, 80),
        start,
        end,
        position: ['top', 'center', 'bottom'].includes(item.position) ? item.position : 'bottom',
        font_size: Math.round(clamp(item.font_size || 42, 18, 96)),
        color: /^[0-9a-fA-F]{6}$/.test(String(item.color || '').replace('#', ''))
          ? String(item.color).replace('#', '') : 'FFFFFF',
      };
    })
    .filter(item => item.text && item.end > item.start);
  const imageAnimations = (Array.isArray(raw.image_animations) ? raw.image_animations : []).slice(0, 8)
    .map((item) => {
      const sourceIndex = Math.trunc(Number(item.source_index));
      if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= inputCount) {
        throw new Error('图生视频任务引用了无效的商品图片');
      }
      return {
        source_index: sourceIndex,
        prompt: String(item.prompt || '').trim().slice(0, 1000),
        duration: Math.round(clamp(item.duration || 5, 4, 12)),
      };
    })
    .filter(item => item.prompt);

  if (new Set(imageAnimations.map(item => item.source_index)).size !== imageAnimations.length) {
    throw new Error('同一张商品图片只能创建一个图生视频任务');
  }

  return {
    aspect_ratio: ratio,
    clips,
    text_overlay: overlay,
    timed_texts: timedTexts,
    image_animations: imageAnimations,
    original_volume: clamp(raw.original_volume ?? 1, 0, 2),
    music_volume: clamp(raw.music_volume ?? 0.25, 0, 2),
    fade: Boolean(raw.fade),
    fps: [24, 25, 30].includes(Number(raw.fps)) ? Number(raw.fps) : 30,
  };
}

function runProcess(binary, args, { onStdout } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stdout.on('data', (chunk) => onStdout?.(String(chunk)));
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-16_000);
    });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) resolve({ stderr });
      else reject(new Error(`FFmpeg 处理失败 (${signal || code}): ${stderr.slice(-1200)}`));
    });
  });
}

export async function probeVideo(filePath, ffprobePath = process.env.FFPROBE_PATH || 'ffprobe') {
  let output = '';
  await runProcess(ffprobePath, [
    '-v', 'error', '-show_entries', 'format=duration:stream=codec_type',
    '-of', 'json', filePath,
  ], { onStdout: (chunk) => { output += chunk; } });
  const parsed = JSON.parse(output || '{}');
  const duration = Number(parsed?.format?.duration || 0);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('无法读取视频时长');
  return {
    duration,
    hasAudio: Array.isArray(parsed.streams) && parsed.streams.some(stream => stream.codec_type === 'audio'),
  };
}

const escapeDrawText = (value) => String(value)
  .replaceAll('\\', '\\\\')
  .replaceAll(':', '\\:')
  .replaceAll("'", "\\'")
  .replaceAll('%', '\\%')
  .replaceAll(',', '\\,')
  .replaceAll(';', '\\;');

export function buildFfmpegArgs({ inputs, inputKinds = [], musicPath, overlayPath, timedOverlayPaths = [], outputPath, plan, probes }) {
  const { width, height } = VIDEO_RATIOS[plan.aspect_ratio];
  const args = ['-hide_banner', '-y'];
  inputs.forEach((input, index) => {
    if (inputKinds[index] === 'image') args.push('-loop', '1', '-framerate', String(plan.fps));
    args.push('-i', input);
  });
  const musicIndex = inputs.length;
  if (musicPath) args.push('-stream_loop', '-1', '-i', musicPath);
  const overlayIndex = inputs.length + (musicPath ? 1 : 0);
  if (overlayPath) args.push('-loop', '1', '-i', overlayPath);
  const timedOverlayStartIndex = overlayIndex + (overlayPath ? 1 : 0);
  timedOverlayPaths.forEach(timedOverlayPath => args.push('-loop', '1', '-i', timedOverlayPath));

  const filters = [];
  const videoLabels = [];
  const audioLabels = [];
  let totalDuration = 0;

  plan.clips.forEach((clip, index) => {
    const probe = probes[clip.source_index];
    const end = clip.end == null ? probe.duration : Math.min(clip.end, probe.duration);
    const duration = end - clip.start;
    if (!(duration > 0)) throw new Error('剪辑区间超出视频时长');
    totalDuration += duration;
    const trim = `trim=start=${clip.start.toFixed(3)}:end=${end.toFixed(3)},setpts=PTS-STARTPTS`;
    const baseVisual = `[${clip.source_index}:v]${trim},scale=${width}:${height}:force_original_aspect_ratio=decrease,`+
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;
    const visualFilter = inputKinds[clip.source_index] === 'image'
      ? `${baseVisual},zoompan=z='min(zoom+0.0008,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${width}x${height}:fps=${plan.fps},format=yuv420p[v${index}]`
      : `${baseVisual},fps=${plan.fps},format=yuv420p[v${index}]`;
    filters.push(visualFilter);
    videoLabels.push(`[v${index}]`);

    if (probe.hasAudio) {
      filters.push(
        `[${clip.source_index}:a]atrim=start=${clip.start.toFixed(3)}:end=${end.toFixed(3)},`+
        `asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,`+
        `volume=${plan.original_volume}[a${index}]`,
      );
    } else {
      filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${duration.toFixed(3)},asetpts=PTS-STARTPTS[a${index}]`);
    }
    audioLabels.push(`[a${index}]`);
  });

  if (totalDuration > 60) throw new Error('成片时长不能超过 60 秒');
  if (videoLabels.length === 1) {
    filters.push(`${videoLabels[0]}null[vcat]`);
    filters.push(`${audioLabels[0]}anull[acat]`);
  } else {
    filters.push(`${videoLabels.join('')}concat=n=${videoLabels.length}:v=1:a=0[vcat]`);
    filters.push(`${audioLabels.join('')}concat=n=${audioLabels.length}:v=0:a=1[acat]`);
  }

  let videoInput = '[vcat]';
  if (plan.fade) {
    const fadeOut = Math.max(0, totalDuration - 0.35);
    filters.push(`${videoInput}fade=t=in:st=0:d=0.35,fade=t=out:st=${fadeOut.toFixed(3)}:d=0.35[vfade]`);
    videoInput = '[vfade]';
  }
  if (overlayPath) {
    filters.push(`[${overlayIndex}:v]scale=${width}:${height},format=rgba[overlay]`);
    filters.push(`${videoInput}[overlay]overlay=0:0:shortest=1[vout]`);
  } else if (plan.timed_texts?.length && timedOverlayPaths.length === plan.timed_texts.length) {
    plan.timed_texts.forEach((overlay, index) => {
      const outputLabel = index === plan.timed_texts.length - 1 ? 'vout' : `vtext${index}`;
      filters.push(`[${timedOverlayStartIndex + index}:v]scale=${width}:${height},format=rgba[tov${index}]`);
      filters.push(
        `${videoInput}[tov${index}]overlay=0:0:enable='between(t,${overlay.start.toFixed(3)},${overlay.end.toFixed(3)})'[${outputLabel}]`,
      );
      videoInput = `[${outputLabel}]`;
    });
  } else if (plan.text_overlay) {
    const overlay = plan.text_overlay;
    const y = overlay.position === 'top' ? 'h*0.08' : overlay.position === 'center' ? '(h-text_h)/2' : 'h-text_h-h*0.08';
    const fontFile = process.env.FFMPEG_FONT_FILE;
    const font = fontFile ? `fontfile='${escapeDrawText(fontFile)}':` : '';
    filters.push(
      `${videoInput}drawtext=${font}text='${escapeDrawText(overlay.text)}':fontcolor=#${overlay.color}:`+
      `fontsize=${overlay.font_size}:x=(w-text_w)/2:y=${y}:box=1:boxcolor=black@0.45:boxborderw=18[vout]`,
    );
  } else {
    filters.push(`${videoInput}null[vout]`);
  }

  let audioOutput = '[acat]';
  if (musicPath) {
    filters.push(
      `[${musicIndex}:a]atrim=duration=${totalDuration.toFixed(3)},asetpts=PTS-STARTPTS,`+
      `aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${plan.music_volume}[music]`,
    );
    filters.push(`[acat][music]amix=inputs=2:duration=first:dropout_transition=2[aout]`);
    audioOutput = '[aout]';
  }

  args.push(
    '-filter_complex', filters.join(';'),
    '-map', '[vout]', '-map', audioOutput,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '21',
    '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart',
    '-t', totalDuration.toFixed(3),
    '-progress', 'pipe:1', '-nostats', outputPath,
  );
  return { args, duration: totalDuration };
}

export async function renderVideo({ args, duration, onProgress, ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg' }) {
  let pending = '';
  return runProcess(ffmpegPath, args, {
    onStdout: (chunk) => {
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() || '';
      for (const line of lines) {
        const [key, value] = line.split('=', 2);
        if (key === 'out_time_us') {
          const seconds = Number(value) / 1_000_000;
          onProgress?.(Math.min(99, Math.max(1, Math.round((seconds / duration) * 100))));
        }
      }
    },
  });
}
