import { Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import multer from 'multer';
import { authenticateSession } from '../auth/sessionMiddleware.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import createStorageProvider from '../utils/storage.js';
import { buildFfmpegArgs, normalizeVideoPlan, probeVideo, renderVideo } from '../utils/videoFfmpeg.js';
import { analyzeVideoWithMultimodal, extractImageFrame, extractKeyframes } from '../utils/videoAnalysis.js';
import { createResilientPool } from '../utils/transientErrors.js';
import config from '../config.js';
import { indexMediaAsset } from '../utils/mediaIndex.js';

const router = Router();
const storage = createStorageProvider(process.env.STORAGE_TYPE || 'local');
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';
const MAX_VIDEO_DURATION_SECONDS = 60;
const tempDir = path.join(os.tmpdir(), 'ai-product-video-jobs');
fs.mkdirSync(tempDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: tempDir,
    filename: (_req, file, callback) => {
      const extension = path.extname(file.originalname).toLowerCase().slice(0, 8);
      callback(null, `${crypto.randomUUID()}${extension}`);
    },
  }),
  limits: { fileSize: 150 * 1024 * 1024, files: 24 },
  fileFilter: (_req, file, callback) => {
    const allowed = file.fieldname === 'music'
      ? ['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/ogg']
      : ['overlay', 'text_overlays'].includes(file.fieldname)
        ? ['image/png']
      : ['product_images', 'images'].includes(file.fieldname)
        ? ['image/jpeg', 'image/png', 'image/webp']
      : ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska'];
    callback(allowed.includes(file.mimetype) ? null : new AppError(`不支持的媒体格式：${file.mimetype}`, 400), allowed.includes(file.mimetype));
  },
});
const uploadMedia = upload.fields([
  { name: 'videos', maxCount: 8 }, { name: 'images', maxCount: 8 },
  { name: 'music', maxCount: 1 }, { name: 'overlay', maxCount: 1 },
  { name: 'text_overlays', maxCount: 12 },
]);
const handleMediaUpload = (req, res, next) => uploadMedia(req, res, (error) => {
  if (!error) return next();
  if (error instanceof multer.MulterError) {
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? '单个媒体文件不能超过 150MB'
      : '上传的视频文件数量或格式不符合要求';
    return next(new AppError(message, 400));
  }
  return next(error);
});
const uploadAnalysis = upload.array('videos', 4);
const handleAnalysisUpload = (req, res, next) => uploadAnalysis(req, res, (error) => {
  if (!error) return next();
  if (error instanceof multer.MulterError) {
    return next(new AppError(error.code === 'LIMIT_FILE_SIZE'
      ? '单个视频不能超过 150MB'
      : '单次最多分析 4 个视频素材', 400));
  }
  return next(error);
});
const uploadReplication = upload.fields([
  { name: 'reference', maxCount: 1 },
  { name: 'product_videos', maxCount: 8 },
  { name: 'product_images', maxCount: 8 },
]);
const handleReplicationUpload = (req, res, next) => uploadReplication(req, res, (error) => {
  if (!error) return next();
  if (error instanceof multer.MulterError) {
    return next(new AppError(error.code === 'LIMIT_FILE_SIZE'
      ? '单个视频不能超过 150MB'
      : '参考视频只能上传 1 个，商品素材最多上传 8 个', 400));
  }
  return next(error);
});

let pool;
let activeJobs = 0;
const queue = [];
const maxConcurrentJobs = Math.max(1, Number(process.env.VIDEO_JOB_CONCURRENCY || 2));
const replicationAnalysisProgress = new Map();

function setReplicationProgress(id, uid, percent, stage, error = '') {
  if (!id) return;
  replicationAnalysisProgress.set(id, {
    uid, percent: Math.max(0, Math.min(100, percent)), stage, error, updated_at: Date.now(),
  });
  if (percent === 100 || error) {
    const timer = setTimeout(() => replicationAnalysisProgress.delete(id), 10 * 60 * 1000);
    timer.unref?.();
  }
}

export function setPool(value) {
  pool = createResilientPool(value);
  pool.query(
    `UPDATE video_jobs SET status = 'failed', error = '服务重启，源素材已清理，请重新提交', updated_at = CURRENT_TIMESTAMP
     WHERE status IN ('queued', 'processing')`,
  ).catch(error => console.warn('[Video] Failed to recover interrupted jobs:', error.message));
}

async function ensureVideoSession(uid, requestedSessionId, workspaceType = 'video_edit') {
  const normalizedType = workspaceType === 'viral_replication' ? 'viral_replication' : 'video_edit';
  const title = normalizedType === 'viral_replication' ? '爆款结构复刻' : '智能剪辑';
  const requested = /^session-[a-zA-Z0-9-]{8,80}$/.test(String(requestedSessionId || ''))
    ? String(requestedSessionId)
    : '';
  if (requested) {
    const existing = await pool.query(
      'SELECT session_id FROM doubao_agent_sessions WHERE session_id = $1 AND uid = $2',
      [requested, uid],
    );
    if (existing.rowCount > 0) return requested;
  }
  const sessionId = `session-${crypto.randomUUID()}`;
  await pool.query(
    `INSERT INTO doubao_agent_sessions (session_id, uid, title, current_state, chat_history, last_params)
     VALUES ($1, $2, $3, 'VIDEO_EDITING', '[]'::jsonb, $4::jsonb)`,
    [sessionId, uid, title, JSON.stringify({
      workspace_type: normalizedType,
      video_workspace: { mode: normalizedType === 'viral_replication' ? 'viral_structure_replication' : 'video_edit' },
    })],
  );
  return sessionId;
}

const cleanupFiles = async (paths) => Promise.allSettled(
  paths.filter(Boolean).map(filePath => fs.promises.unlink(filePath)),
);

function drainQueue() {
  while (activeJobs < maxConcurrentJobs && queue.length > 0) {
    const task = queue.shift();
    activeJobs += 1;
    task().finally(() => {
      activeJobs -= 1;
      drainQueue();
    });
  }
}

function enqueue(task) {
  queue.push(task);
  drainQueue();
}

const frameData = frame => ({
  timestamp: frame.timestamp,
  image: `data:${frame.mimeType || 'image/jpeg'};base64,${frame.base64}`,
});

router.get(
  '/replicate/analyze-progress/:id',
  authenticateSession,
  asyncHandler(async (req, res) => {
    const progress = replicationAnalysisProgress.get(req.params.id);
    if (!progress || progress.uid !== req.user.uid) throw new AppError('拆解进度不存在或已过期', 404);
    res.json({ success: true, progress: {
      percent: progress.percent, stage: progress.stage, error: progress.error,
    } });
  }),
);

async function generateVideoFromImage({ file, animation }) {
  const stat = await fs.promises.stat(file.path);
  if (stat.size > 20 * 1024 * 1024) {
    throw new Error(`商品图片“${file.originalname}”超过 20MB，无法发送给图生视频模型`);
  }
  const imageBuffer = await fs.promises.readFile(file.path);
  const response = await fetch(`${AI_SERVICE_URL}/agent/video/generate-clip`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Token': process.env.MEDIA_INDEX_INTERNAL_TOKEN || config.JWT_SECRET || '',
    },
    body: JSON.stringify({
      image_base64: `data:${file.mimetype || 'image/png'};base64,${imageBuffer.toString('base64')}`,
      prompt: animation.prompt,
      duration: animation.duration,
      ratio: '9:16',
    }),
    signal: AbortSignal.timeout(660_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.video_url) {
    throw new Error(data.detail || data.error || '图生视频模型没有返回可用的视频');
  }

  let videoUrl;
  try {
    videoUrl = new URL(data.video_url);
  } catch {
    throw new Error('图生视频模型返回了无效的视频地址');
  }
  if (videoUrl.protocol !== 'https:') throw new Error('图生视频模型返回了不安全的视频地址');
  const videoResponse = await fetch(videoUrl, { signal: AbortSignal.timeout(180_000) });
  if (!videoResponse.ok) throw new Error(`图生视频结果下载失败（HTTP ${videoResponse.status}）`);
  const declaredLength = Number(videoResponse.headers.get('content-length') || 0);
  if (declaredLength > 100 * 1024 * 1024) throw new Error('图生视频结果超过 100MB，已停止下载');
  const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
  if (!videoBuffer.length || videoBuffer.length > 100 * 1024 * 1024) {
    throw new Error('图生视频结果为空或文件过大');
  }
  const outputPath = path.join(tempDir, `generated-clip-${crypto.randomUUID()}.mp4`);
  await fs.promises.writeFile(outputPath, videoBuffer);
  return outputPath;
}

router.post(
  '/replicate/analyze',
  authenticateSession,
  handleReplicationUpload,
  asyncHandler(async (req, res) => {
    const referenceFile = req.files?.reference?.[0];
    const productVideos = req.files?.product_videos || [];
    const productImages = req.files?.product_images || [];
    const allFiles = [referenceFile, ...productVideos, ...productImages].filter(Boolean);
    const frameGroups = [];
    const requestedAnalysisId = String(req.body.analysis_id || '');
    const analysisId = /^[a-zA-Z0-9-]{8,80}$/.test(requestedAnalysisId) ? requestedAnalysisId : crypto.randomUUID();
    setReplicationProgress(analysisId, req.user.uid, 12, '素材已接收，正在校验视频信息');
    try {
      if (!referenceFile) throw new AppError('请上传一个爆款参考视频', 400);
      if (productVideos.length + productImages.length === 0) {
        throw new AppError('请至少上传一个新商品图片或视频', 400);
      }
      if (productVideos.length + productImages.length > 8) {
        throw new AppError('新商品图片和视频合计最多上传 8 个', 400);
      }
      const sessionId = await ensureVideoSession(req.user.uid, req.body.session_id, 'viral_replication');
      const referenceProbe = await probeVideo(referenceFile.path);
      if (referenceProbe.duration > MAX_VIDEO_DURATION_SECONDS + 0.001) {
        throw new AppError(`参考视频时长不能超过 ${MAX_VIDEO_DURATION_SECONDS} 秒`, 400);
      }
      setReplicationProgress(analysisId, req.user.uid, 24, '正在提取参考视频关键帧');
      const referenceGroup = await extractKeyframes(referenceFile.path, referenceProbe.duration, 8);
      frameGroups.push(referenceGroup);

      setReplicationProgress(analysisId, req.user.uid, 42, '正在读取新商品图片与视频');
      const productSources = [];
      const productVideoProbes = await Promise.all(productVideos.map(file => probeVideo(file.path)));
      const oversizedProductVideo = productVideoProbes.find(probe => probe.duration > MAX_VIDEO_DURATION_SECONDS + 0.001);
      if (oversizedProductVideo) {
        throw new AppError(`商品视频时长不能超过 ${MAX_VIDEO_DURATION_SECONDS} 秒`, 400);
      }
      const productVideoGroups = await Promise.all(productVideos.map((file, index) => (
        extractKeyframes(file.path, productVideoProbes[index].duration, 3)
      )));
      frameGroups.push(...productVideoGroups);
      for (let index = 0; index < productVideos.length; index += 1) {
        const probe = productVideoProbes[index];
        const group = productVideoGroups[index];
        productSources.push({
          kind: 'video', source_index: index, duration: probe.duration,
          frames: group.frames.map(frameData), probe, file: productVideos[index],
        });
      }
      const productImageGroups = await Promise.all(productImages.map(file => extractImageFrame(file.path)));
      frameGroups.push(...productImageGroups);
      for (let index = 0; index < productImages.length; index += 1) {
        const file = productImages[index];
        productSources.push({
          kind: 'image', source_index: index, duration: 0,
          frames: productImageGroups[index].frames.map(frameData),
          file,
        });
      }
      setReplicationProgress(analysisId, req.user.uid, 62, '多模态 Agent 正在拆解钩子、节奏与镜头');
      const response = await fetch(`${AI_SERVICE_URL}/agent/video/replicate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Token': process.env.MEDIA_INDEX_INTERNAL_TOKEN || config.JWT_SECRET || '',
        },
        body: JSON.stringify({
          uid: req.user.uid,
          reference_duration: referenceProbe.duration,
          reference_frames: referenceGroup.frames.map(frameData),
          product_sources: productSources.map(({ file, probe, ...source }) => source),
          instruction: req.body.instruction || '',
          strength: ['light', 'medium', 'high'].includes(req.body.strength) ? req.body.strength : 'medium',
        }),
        signal: AbortSignal.timeout(180_000),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new AppError(data.detail || '爆款结构蓝图生成失败', response.status >= 500 ? 502 : 400);

      setReplicationProgress(analysisId, req.user.uid, 86, '正在映射新商品素材并保存蓝图');
      const sourceAssets = [];
      for (const source of productSources) {
        const file = source.file;
        const assetId = `asset-replica-source-${crypto.randomUUID()}`;
        const extension = path.extname(file.originalname).toLowerCase() || (source.kind === 'image' ? '.png' : '.mp4');
        const storedUrl = await storage.saveFileFromPath(file.path, `replica_source_${crypto.randomUUID()}${extension}`);
        const size = file.size >= 1024 * 1024
          ? `${(file.size / 1024 / 1024).toFixed(1)} MB`
          : `${Math.max(1, Math.round(file.size / 1024))} KB`;
        try {
          await pool.query(
            `INSERT INTO assets (
               id, uid, name, url, size, date, metrics, source, session_id, media_type, index_status
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'user_uploaded', $8, $9, 'pending')`,
            [
              assetId, req.user.uid, file.originalname, storedUrl, size,
              new Date().toISOString().slice(0, 10),
              JSON.stringify({ asset_role: 'viral_replication_source', source_index: source.source_index }),
              sessionId, source.kind,
            ],
          );
        } catch (error) {
          await storage.deleteFile(storedUrl).catch(() => {});
          throw error;
        }
        sourceAssets.push({ id: assetId, url: storedUrl, kind: source.kind, source_index: source.source_index });
        const relatedShots = data.blueprint.shots.filter(
          shot => shot.product_source_kind === source.kind && shot.product_source_index === source.source_index,
        );
        const indexAnalysis = source.kind === 'video'
          ? {
              summary: data.blueprint.summary,
              product: data.blueprint.title,
              visual_style: data.blueprint.overall_style,
              scenes: relatedShots.map(shot => ({
                source_index: source.source_index,
                start: shot.product_start,
                end: shot.product_end,
                description: `${shot.purpose}：${shot.match_reason}`,
                visual_style: shot.visual_style,
                importance: 80,
                quality: 75,
              })),
            }
          : {
              product: { product_name: data.blueprint.title, product_category: '商品素材' },
              visible_facts: relatedShots.map(shot => shot.match_reason || shot.purpose),
              selling_points: [],
              visual_style: { style_summary: data.blueprint.overall_style },
            };
        indexMediaAsset({
          uid: req.user.uid,
          asset_id: assetId,
          session_id: sessionId,
          media_type: source.kind,
          analysis: indexAnalysis,
          source_index: source.source_index,
        }).catch(error => console.warn(`[MediaIndex] Replica source ${assetId} was not indexed:`, error.message));
      }
      setReplicationProgress(analysisId, req.user.uid, 100, '复刻蓝图整理完成');
      res.json({ ...data, source_assets: sourceAssets, session_id: sessionId, analysis_id: analysisId });
    } catch (error) {
      setReplicationProgress(analysisId, req.user.uid, 0, '拆解失败', String(error.message || '拆解失败').slice(0, 240));
      throw error;
    } finally {
      await cleanupFiles(allFiles.map(file => file.path));
      await Promise.allSettled(frameGroups.map(group => fs.promises.rm(group.directory, { recursive: true, force: true })));
    }
  }),
);

router.post(
  '/analyze',
  authenticateSession,
  handleAnalysisUpload,
  asyncHandler(async (req, res) => {
    const videoFiles = Array.isArray(req.files) ? req.files : [];
    if (videoFiles.length === 0) throw new AppError('请至少上传一个视频素材', 400);
    const sessionId = await ensureVideoSession(req.user.uid, req.body.session_id, 'video_edit');
    const frameGroups = [];
    try {
      const probes = await Promise.all(videoFiles.map(file => probeVideo(file.path)));
      const oversizedVideo = probes.find(probe => probe.duration > MAX_VIDEO_DURATION_SECONDS + 0.001);
      if (oversizedVideo) {
        throw new AppError(`单个视频时长不能超过 ${MAX_VIDEO_DURATION_SECONDS} 秒`, 400);
      }
      for (let index = 0; index < videoFiles.length; index += 1) {
        frameGroups.push(await extractKeyframes(videoFiles[index].path, probes[index].duration, 8));
      }
      const userResult = await pool.query(
        'SELECT mimo_key, gemini_key, qwen_key, custom_proxy FROM users WHERE uid = $1',
        [req.user.uid],
      );
      const user = userResult.rows[0] || {};
      const model = process.env.MULTIMODAL_MODEL || config.AI_CHAT_MODEL;
      const candidates = [
        { apiKey: user.qwen_key || user.mimo_key || user.gemini_key, baseUrl: user.custom_proxy },
        { apiKey: process.env.MULTIMODAL_API_KEY || process.env.DASHSCOPE_API_KEY, baseUrl: process.env.MULTIMODAL_BASE_URL },
        { apiKey: config.AI_API_KEY || config.GEMINI_API_KEY, baseUrl: config.AI_BASE_URL },
      ].filter(candidate => candidate.apiKey && candidate.baseUrl && model);
      if (candidates.length === 0) throw new AppError('未配置可用的多模态视频分析模型', 503);
      let analysis = null;
      let lastModelError = null;
      const attempted = new Set();
      for (const candidate of candidates) {
        const identity = `${candidate.baseUrl}|${candidate.apiKey.slice(-6)}`;
        if (attempted.has(identity)) continue;
        attempted.add(identity);
        try {
          const parsedUrl = new URL(candidate.baseUrl);
          if (!['http:', 'https:'].includes(parsedUrl.protocol)) continue;
          if (parsedUrl.hostname === 'proxy.local') continue;
          analysis = await analyzeVideoWithMultimodal({
            frameGroups, probes, instruction: req.body.instruction, model, ...candidate,
          });
          break;
        } catch (error) {
          lastModelError = error;
          console.warn('[Video Analysis] Model candidate failed:', error.message);
        }
      }
      if (!analysis) throw lastModelError || new Error('没有可用的多模态模型端点');
      const sourceAssets = [];
      for (let index = 0; index < videoFiles.length; index += 1) {
        const file = videoFiles[index];
        const assetId = `asset-video-source-${crypto.randomUUID()}`;
        const extension = path.extname(file.originalname).toLowerCase() || '.mp4';
        const storedUrl = await storage.saveFileFromPath(file.path, `video_source_${crypto.randomUUID()}${extension}`);
        const size = file.size >= 1024 * 1024
          ? `${(file.size / 1024 / 1024).toFixed(1)} MB`
          : `${Math.max(1, Math.round(file.size / 1024))} KB`;
        try {
          await pool.query(
            `INSERT INTO assets (
               id, uid, name, url, size, date, metrics, source, session_id, media_type, index_status
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'user_uploaded', $8, 'video', 'pending')`,
            [
              assetId, req.user.uid, file.originalname, storedUrl, size,
              new Date().toISOString().slice(0, 10),
              JSON.stringify({ asset_role: 'video_source', duration: probes[index].duration, has_audio: probes[index].hasAudio }),
              sessionId,
            ],
          );
        } catch (error) {
          await storage.deleteFile(storedUrl).catch(() => {});
          throw error;
        }
        sourceAssets.push({ id: assetId, name: file.originalname, url: storedUrl, source_index: index });
        indexMediaAsset({
          uid: req.user.uid,
          asset_id: assetId,
          session_id: sessionId,
          media_type: 'video',
          analysis,
          source_index: index,
        }).catch((error) => {
          console.warn(`[MediaIndex] Video source ${assetId} was not indexed:`, error.message);
        });
      }
      res.json({ success: true, analysis, source_assets: sourceAssets, session_id: sessionId });
    } catch (error) {
      if (error instanceof AppError) throw error;
      console.error('[Video Analysis] Failed:', error.message);
      throw new AppError('多模态视频分析暂时失败，素材仍可手动剪辑', 502);
    } finally {
      await cleanupFiles(videoFiles.map(file => file.path));
      await Promise.allSettled(frameGroups.map(group => fs.promises.rm(group.directory, { recursive: true, force: true })));
    }
  }),
);

async function executeVideoJob({ jobId, uid, sessionId, plan, videoFiles, imageFiles, musicFile, overlayFile, textOverlayFiles }) {
  const inputPaths = [...videoFiles, ...imageFiles].map(file => file.path);
  const inputKinds = [...videoFiles.map(() => 'video'), ...imageFiles.map(() => 'image')];
  const outputPath = path.join(tempDir, `${jobId}.mp4`);
  const allTempPaths = [...inputPaths, musicFile?.path, overlayFile?.path, ...textOverlayFiles.map(file => file.path), outputPath];
  try {
    await pool.query(
      `UPDATE video_jobs SET status = 'processing', progress = 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [jobId],
    );
    for (let index = 0; index < plan.image_animations.length; index += 1) {
      const animation = plan.image_animations[index];
      const imageIndex = animation.source_index - videoFiles.length;
      const imageFile = imageFiles[imageIndex];
      if (!imageFile || inputKinds[animation.source_index] !== 'image') {
        throw new Error('图生视频镜头没有找到对应的商品图片');
      }
      await pool.query(
        `UPDATE video_jobs SET progress = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [Math.round(5 + (index / Math.max(1, plan.image_animations.length)) * 55), jobId],
      );
      const generatedPath = await generateVideoFromImage({ file: imageFile, animation });
      allTempPaths.push(generatedPath);
      inputPaths[animation.source_index] = generatedPath;
      inputKinds[animation.source_index] = 'video';
    }
    const probes = await Promise.all(inputPaths.map(async (inputPath, sourceIndex) => {
      if (inputKinds[sourceIndex] === 'video') return probeVideo(inputPath);
      const duration = Math.max(0.6, ...plan.clips
        .filter(clip => clip.source_index === sourceIndex)
        .map(clip => Number(clip.end || 3)));
      return { duration, hasAudio: false };
    }));
    const { args, duration } = buildFfmpegArgs({
      inputs: inputPaths,
      inputKinds,
      musicPath: musicFile?.path || '',
      overlayPath: overlayFile?.path || '',
      timedOverlayPaths: textOverlayFiles.map(file => file.path),
      outputPath,
      plan,
      probes,
    });
    const ffmpegProgressStart = plan.image_animations.length ? 65 : 1;
    let persistedProgress = ffmpegProgressStart;
    await renderVideo({
      args,
      duration,
      onProgress: (progress) => {
        const scaledProgress = plan.image_animations.length
          ? Math.min(99, Math.round(ffmpegProgressStart + progress * 0.34))
          : progress;
        if (scaledProgress - persistedProgress < 4) return;
        persistedProgress = scaledProgress;
        pool.query(
          `UPDATE video_jobs SET progress = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
          [scaledProgress, jobId],
        ).catch(() => {});
      },
    });

    const outputName = `video_${jobId}.mp4`;
    const outputUrl = await storage.saveFileFromPath(outputPath, outputName);
    const stat = await fs.promises.stat(outputPath);
    const size = stat.size >= 1024 * 1024
      ? `${(stat.size / 1024 / 1024).toFixed(1)} MB`
      : `${Math.max(1, Math.round(stat.size / 1024))} KB`;
    const assetId = `asset-video-${jobId}`;
    try {
      await pool.query(
        `INSERT INTO assets (id, uid, name, url, size, date, metrics, source, session_id, media_type, index_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'ai_generated', $8, 'video', 'pending')
         ON CONFLICT (id) DO UPDATE SET url = EXCLUDED.url, size = EXCLUDED.size, media_type = 'video'`,
        [
          assetId, uid, `商品视频_${new Date().toISOString().slice(0, 10)}.mp4`, outputUrl, size,
          new Date().toISOString().slice(0, 10),
          JSON.stringify({ asset_role: 'video', video_job_id: jobId, duration, aspect_ratio: plan.aspect_ratio }),
          sessionId,
        ],
      );
      await pool.query(
        `UPDATE video_jobs SET status = 'completed', progress = 100, output_url = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [outputUrl, jobId],
      );
      if (sessionId) {
        await pool.query(
          `UPDATE doubao_agent_sessions
           SET current_state = 'DONE',
               last_params = COALESCE(last_params, '{}'::jsonb) || jsonb_build_object(
                 'video_workspace', COALESCE(last_params->'video_workspace', '{}'::jsonb) || jsonb_build_object('job', $1::jsonb)
               ),
               updated_at = CURRENT_TIMESTAMP
           WHERE session_id = $2 AND uid = $3`,
          [JSON.stringify({ id: jobId, status: 'completed', progress: 100, output_url: outputUrl }), sessionId, uid],
        );
      }
      indexMediaAsset({
        uid,
        asset_id: assetId,
        session_id: sessionId || '',
        media_type: 'video',
        analysis: {
          summary: `智能剪辑生成的视频，画幅 ${plan.aspect_ratio}`,
          product: '',
          selling_points: plan.text_overlay?.text ? [plan.text_overlay.text] : [],
          visual_style: `画幅 ${plan.aspect_ratio}，${plan.fade ? '包含淡入淡出' : '直接剪辑'}`,
          scenes: [{
            source_index: 0,
            start: 0,
            end: duration,
            description: plan.text_overlay?.text || '智能剪辑生成的商品视频',
            visual_style: `画幅 ${plan.aspect_ratio}`,
            importance: 80,
            quality: 80,
          }],
        },
        source_index: 0,
      }).catch((error) => {
        console.warn(`[MediaIndex] Generated video ${assetId} was not indexed:`, error.message);
      });
    } catch (error) {
      await pool.query('DELETE FROM assets WHERE id = $1', [assetId]).catch(() => {});
      await storage.deleteFile(outputUrl).catch(() => {});
      throw error;
    }
  } catch (error) {
    console.error(`[Video] Job ${jobId} failed:`, error.message);
    const publicError = String(error.message || '').includes('FFmpeg')
      ? '视频编码失败，请确认素材可正常播放、剪辑区间有效后重试'
      : String(error.message || '视频处理失败').slice(0, 300);
    await pool.query(
      `UPDATE video_jobs SET status = 'failed', error = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [publicError, jobId],
    ).catch(() => {});
    if (sessionId) {
      await pool.query(
        `UPDATE doubao_agent_sessions
         SET current_state = 'VIDEO_EDITING',
             last_params = COALESCE(last_params, '{}'::jsonb) || jsonb_build_object(
               'video_workspace', COALESCE(last_params->'video_workspace', '{}'::jsonb) || jsonb_build_object('job', $1::jsonb)
             ),
             updated_at = CURRENT_TIMESTAMP
         WHERE session_id = $2 AND uid = $3`,
        [JSON.stringify({ id: jobId, status: 'failed', progress: 0, error: publicError }), sessionId, uid],
      ).catch(() => {});
    }
  } finally {
    await cleanupFiles(allTempPaths);
  }
}

router.post(
  '/jobs',
  authenticateSession,
  handleMediaUpload,
  asyncHandler(async (req, res) => {
    const videoFiles = req.files?.videos || [];
    const imageFiles = req.files?.images || [];
    const musicFile = req.files?.music?.[0] || null;
    const overlayFile = req.files?.overlay?.[0] || null;
    const textOverlayFiles = req.files?.text_overlays || [];
    const uploadedPaths = [
      ...videoFiles, ...imageFiles, ...textOverlayFiles,
    ].map(file => file.path).concat([musicFile?.path, overlayFile?.path]);
    if (videoFiles.length + imageFiles.length === 0) {
      await cleanupFiles(uploadedPaths);
      throw new AppError('请至少上传一个图片或视频素材', 400);
    }

    let rawPlan;
    try {
      rawPlan = JSON.parse(req.body.plan || '{}');
    } catch {
      await cleanupFiles(uploadedPaths);
      throw new AppError('视频剪辑方案格式错误', 400);
    }

    let plan;
    try {
      plan = normalizeVideoPlan(rawPlan, videoFiles.length + imageFiles.length);
    } catch (error) {
      await cleanupFiles(uploadedPaths);
      throw new AppError(error.message, 400);
    }
    if (plan.text_overlay && !overlayFile) {
      await cleanupFiles(uploadedPaths);
      throw new AppError('文字叠加缺少已排版的透明图层', 400);
    }
    if (plan.timed_texts.length !== textOverlayFiles.length) {
      await cleanupFiles(uploadedPaths);
      throw new AppError('分时字幕缺少已排版的透明图层', 400);
    }

    const uploadedVideoProbes = await Promise.all(videoFiles.map(file => probeVideo(file.path)));
    if (uploadedVideoProbes.some(probe => probe.duration > MAX_VIDEO_DURATION_SECONDS + 0.001)) {
      await cleanupFiles(uploadedPaths);
      throw new AppError(`单个视频时长不能超过 ${MAX_VIDEO_DURATION_SECONDS} 秒`, 400);
    }

    const uid = req.user.uid;
    const running = await pool.query(
      `SELECT COUNT(*)::int AS count FROM video_jobs WHERE uid = $1 AND status IN ('queued', 'processing')`,
      [uid],
    );
    if (running.rows[0].count >= 3) {
      await cleanupFiles(uploadedPaths);
      throw new AppError('当前已有 3 个视频任务，请等待其中一个完成', 429);
    }

    const requestedWorkspaceType = req.body.workspace_type === 'viral_replication' || plan.timed_texts.length > 0
      ? 'viral_replication'
      : 'video_edit';
    const sessionId = await ensureVideoSession(uid, req.body.session_id, requestedWorkspaceType);

    const jobId = `vjob-${crypto.randomUUID()}`;
    await pool.query(
      `INSERT INTO video_jobs (id, uid, session_id, status, progress, plan) VALUES ($1, $2, $3, 'queued', 0, $4)`,
      [jobId, uid, sessionId, JSON.stringify(plan)],
    );
    if (sessionId) {
      await pool.query(
        `UPDATE doubao_agent_sessions
         SET current_state = 'VIDEO_RENDERING', updated_at = CURRENT_TIMESTAMP
         WHERE session_id = $1 AND uid = $2`,
        [sessionId, uid],
      );
    }
    enqueue(() => executeVideoJob({ jobId, uid, sessionId, plan, videoFiles, imageFiles, musicFile, overlayFile, textOverlayFiles }));
    res.status(202).json({ success: true, job: { id: jobId, status: 'queued', progress: 0, plan } });
  }),
);

router.get(
  '/jobs/:id',
  authenticateSession,
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `SELECT id, session_id, status, progress, plan, output_url, error, created_at, updated_at
       FROM video_jobs WHERE id = $1 AND uid = $2`,
      [req.params.id, req.user.uid],
    );
    if (result.rowCount === 0) throw new AppError('视频任务不存在', 404);
    res.json({ success: true, job: result.rows[0] });
  }),
);

router.get(
  '/jobs',
  authenticateSession,
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `SELECT id, session_id, status, progress, plan, output_url, error, created_at, updated_at
       FROM video_jobs WHERE uid = $1 ORDER BY created_at DESC LIMIT 30`,
      [req.user.uid],
    );
    res.json({ success: true, jobs: result.rows });
  }),
);

export default router;
