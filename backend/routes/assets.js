import { Router } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import config, { projectRoot } from '../config.js';
import { authenticateSession } from '../auth/sessionMiddleware.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import createStorageProvider from '../utils/storage.js';
import { createResilientPool } from '../utils/transientErrors.js';
import { indexMediaAsset, searchMediaAssets } from '../utils/mediaIndex.js';

const storage = createStorageProvider(config.STORAGE_TYPE || 'local');

const router = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.join(projectRoot, 'frontend', 'public', 'uploads');

// Ensure uploads directory exists
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Lazy pool reference — injected by index.js at startup
let pool;
export function setPool(p) {
  pool = createResilientPool(p);
}

// ─── POST /upload ─────────────────────────────────────────────────────────────
// Accepts base64 image data in the request body and saves to disk.
// Body size limit is enforced globally in server.js (16 MB JSON, enough for a 10 MB image).
router.post(
  '/upload',
  authenticateSession,
  asyncHandler(async (req, res) => {
    const { name, data, metrics, client_upload_id: clientUploadId } = req.body;
    const uid = req.user.uid;

    if (!data) {
      throw new AppError('缺少必需的上传参数', 400);
    }

    let mimeType = 'image/png';
    let base64Content = data;
    if (data.includes(',')) {
      const parts = data.split(',');
      const match = parts[0].match(/data:(.*?);/);
      if (match) mimeType = match[1];
      base64Content = parts[1];
    }
    
    // Validate mime type
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedMimeTypes.includes(mimeType)) {
      throw new AppError('不支持的文件类型，仅允许上传图片 (JPG, PNG, WEBP, GIF)', 400);
    }
    
    const buffer = Buffer.from(base64Content, 'base64');

    // Human-readable size string
    const bytes = buffer.length;
    let sizeStr;
    if (bytes > 1024 * 1024) sizeStr = `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    else if (bytes > 1024) sizeStr = `${Math.round(bytes / 1024)} KB`;
    else sizeStr = `${bytes} B`;

    const validClientUploadId = typeof clientUploadId === 'string' && /^[a-zA-Z0-9-]{8,80}$/.test(clientUploadId)
      ? clientUploadId
      : crypto.randomUUID();
    const assetId = `asset-${validClientUploadId}`;
    const existing = await pool.query(
      'SELECT * FROM assets WHERE id = $1 AND uid = $2',
      [assetId, uid]
    );
    if (existing.rowCount > 0) {
      if (existing.rows[0].index_status !== 'indexed') {
        indexMediaAsset({
          uid,
          asset_id: assetId,
          session_id: existing.rows[0].session_id || '',
          media_type: existing.rows[0].media_type || 'image',
          image_base64: `data:${mimeType};base64,${base64Content}`,
          file_name: existing.rows[0].name || name || 'image',
        }).catch((error) => {
          console.warn(`[MediaIndex] Retried asset ${assetId} was not indexed:`, error.message);
        });
      }
      return res.json({ success: true, asset: existing.rows[0], idempotent: true });
    }

    const ext = path.extname(name) || '.png';
    const uniqueFileName = `upload_${validClientUploadId}${ext}`;

    // A browser can retain a stale local session id after a session is deleted
    // or an account changes. Do not let that optional association break the
    // actual upload; only persist session ids owned by the current user.
    let sessionId = null;
    if (req.body.session_id) {
      const sessionResult = await pool.query(
        'SELECT session_id FROM doubao_agent_sessions WHERE session_id = $1 AND uid = $2',
        [req.body.session_id, uid]
      );
      sessionId = sessionResult.rows[0]?.session_id || null;
    }

    // Save binary file using StorageProvider
    const relativeUrl = await storage.saveFile(buffer, uniqueFileName);
    try {
      await pool.query(
        `INSERT INTO assets (id, uid, name, url, size, date, metrics, source, session_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO NOTHING`,
        [
          assetId,
          uid,
          name || uniqueFileName,
          relativeUrl,
          sizeStr,
          new Date().toISOString().split('T')[0],
          metrics ? (typeof metrics === 'string' ? metrics : JSON.stringify(metrics)) : null,
          'user_uploaded',
          sessionId
        ]
      );
    } catch (error) {
      await storage.deleteFile(relativeUrl).catch(() => {});
      throw error;
    }

    console.log(`[Assets] Saved asset ${relativeUrl} for user ${uid}.`);

    res.json({
      success: true,
      asset: {
        id: assetId,
        name: name || uniqueFileName,
        url: relativeUrl,
        size: sizeStr,
        date: new Date().toISOString().split('T')[0],
        metrics: metrics ? (typeof metrics === 'string' ? JSON.parse(metrics) : metrics) : null
      },
    });

    const imageDataUrl = `data:${mimeType};base64,${base64Content}`;
    indexMediaAsset({
      uid,
      asset_id: assetId,
      session_id: sessionId || '',
      media_type: 'image',
      image_base64: imageDataUrl,
      file_name: name || uniqueFileName,
    }).catch((error) => {
      console.warn(`[MediaIndex] Image asset ${assetId} was not indexed:`, error.message);
    });
  })
);

// ─── POST /search ───────────────────────────────────────────────────────────
// Semantic search is always scoped to the authenticated account server-side.
router.post(
  '/search',
  authenticateSession,
  asyncHandler(async (req, res) => {
    const query = String(req.body?.query || '').trim();
    if (!query) throw new AppError('请输入素材检索内容', 400);
    const vectorKind = ['content', 'style', 'product'].includes(req.body?.vector_kind)
      ? req.body.vector_kind : 'content';
    const mediaType = ['image', 'video'].includes(req.body?.media_type)
      ? req.body.media_type : null;
    try {
      const result = await searchMediaAssets({
        uid: req.user.uid,
        query,
        vector_kind: vectorKind,
        media_type: mediaType,
        top_k: Math.max(1, Math.min(Number(req.body?.top_k) || 6, 20)),
        min_score: Math.max(-1, Math.min(Number(req.body?.min_score) || 0, 1)),
      });
      res.json(result);
    } catch (error) {
      throw new AppError('媒体语义检索暂时不可用，请稍后重试', 503);
    }
  })
);

router.post(
  '/:id/reindex',
  authenticateSession,
  asyncHandler(async (req, res) => {
    const asset = await pool.query('SELECT * FROM assets WHERE id = $1 AND uid = $2', [req.params.id, req.user.uid]);
    if (asset.rowCount === 0) throw new AppError('找不到对应的素材记录', 404);
    const row = asset.rows[0];
    const analysis = req.body?.analysis && typeof req.body.analysis === 'object' ? req.body.analysis : {};
    if (Object.keys(analysis).length === 0) {
      throw new AppError('重新索引需要有效的素材分析结果', 400);
    }
    const result = await indexMediaAsset({
      uid: req.user.uid,
      asset_id: row.id,
      session_id: row.session_id || '',
      media_type: row.media_type || 'image',
      analysis,
      source_index: Number(req.body?.source_index) || 0,
    });
    res.json(result);
  })
);

// ─── POST /image-data ────────────────────────────────────────────────────────
// Resolve a canvas image through the authenticated backend. This restores
// region composition for provider URLs that cannot be read by browser canvas
// because they omit CORS headers.
router.post(
  '/image-data',
  authenticateSession,
  asyncHandler(async (req, res) => {
    const source = String(req.body?.url || '').trim();
    if (!source) throw new AppError('缺少图片地址', 400);
    if (source.startsWith('data:image/')) {
      return res.json({ success: true, data_url: source });
    }

    const assetResult = await pool.query(
      'SELECT url FROM assets WHERE uid = $1 AND url = $2 LIMIT 1',
      [req.user.uid, source]
    );
    const ownedAsset = assetResult.rowCount > 0;
    let pathname = source;
    let remoteUrl = null;
    if (/^https?:\/\//i.test(source)) {
      remoteUrl = new URL(source);
      pathname = remoteUrl.pathname;
    }

    let buffer;
    let mimeType = '';
    const isStoredPath = pathname.startsWith('/uploads/') || pathname.startsWith('/assets/');
    if (isStoredPath) {
      try {
        buffer = await storage.getFileBuffer(pathname);
      } catch {
        throw new AppError('素材文件不存在或已被删除，请重新上传', 404);
      }
    } else if (remoteUrl) {
      const configuredHosts = String(process.env.IMAGE_PROXY_ALLOWED_HOSTS || '')
        .split(',').map(item => item.trim().toLowerCase()).filter(Boolean);
      const allowedSuffixes = [
        'volces.com',
        'aliyuncs.com',
        'blob.core.windows.net',
        'amazonaws.com',
        'r2.dev',
        ...configuredHosts,
      ];
      const hostname = remoteUrl.hostname.toLowerCase();
      const providerAllowed = allowedSuffixes.some(
        suffix => hostname === suffix || hostname.endsWith(`.${suffix}`)
      );
      if (!ownedAsset && !providerAllowed) {
        throw new AppError('该图片地址不允许通过合成代理读取', 403);
      }
      let response;
      try {
        response = await fetch(remoteUrl, { signal: AbortSignal.timeout(20_000) });
      } catch {
        throw new AppError('云端图片暂时无法读取，请稍后重试', 502);
      }
      if (!response.ok) throw new AppError(`原图读取失败 (HTTP ${response.status})`, 502);
      mimeType = String(response.headers.get('content-type') || '').split(';')[0];
      if (mimeType && !mimeType.startsWith('image/')) {
        throw new AppError('原图地址返回的不是图片', 422);
      }
      buffer = Buffer.from(await response.arrayBuffer());
    } else {
      throw new AppError('无法识别原图地址', 400);
    }

    if (!buffer?.length) throw new AppError('原图内容为空', 422);
    if (buffer.length > 20 * 1024 * 1024) throw new AppError('原图超过 20MB，无法进行框选合成', 413);
    if (!mimeType) {
      const lowerPath = pathname.toLowerCase();
      mimeType = lowerPath.endsWith('.jpg') || lowerPath.endsWith('.jpeg')
        ? 'image/jpeg'
        : lowerPath.endsWith('.webp')
          ? 'image/webp'
          : lowerPath.endsWith('.gif')
            ? 'image/gif'
            : 'image/png';
    }
    res.json({
      success: true,
      data_url: `data:${mimeType};base64,${buffer.toString('base64')}`,
    });
  })
);

// ─── GET / ────────────────────────────────────────────────────────────────────
// Returns all assets belonging to the authenticated user.
router.get(
  '/',
  authenticateSession,
  asyncHandler(async (req, res) => {
    const uid = req.user.uid;

    const result = await pool.query(
      'SELECT * FROM assets WHERE uid = $1 ORDER BY date DESC, id DESC',
      [uid]
    );

    const assets = result.rows.map((asset) => ({
      ...asset,
      url: typeof asset.url === 'string' && asset.url.startsWith('uploads/')
        ? `/${asset.url}`
        : asset.url,
    }));
    res.json({ success: true, assets });
  })
);
// ─── GET /stats ───────────────────────────────────────────────────────────────
// Returns real aggregated asset metrics for the authenticated user.
router.get(
  '/stats',
  authenticateSession,
  asyncHandler(async (req, res) => {
    const uid = req.user.uid;

    // Total assets
    const totalRes = await pool.query(
      'SELECT COUNT(*)::int AS count FROM assets WHERE uid = $1',
      [uid]
    );
    const totalAssets = totalRes.rows[0].count;

    // Monthly new (current month)
    const now = new Date();
    const firstOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const monthlyRes = await pool.query(
      'SELECT COUNT(*)::int AS count FROM assets WHERE uid = $1 AND date >= $2',
      [uid, firstOfMonth]
    );
    const monthlyNew = monthlyRes.rows[0].count;

    // Breakdown by source
    const sourceRes = await pool.query(
      "SELECT source, COUNT(*)::int AS count FROM assets WHERE uid = $1 GROUP BY source",
      [uid]
    );
    let aiGenerated = 0;
    let userUploaded = 0;
    for (const row of sourceRes.rows) {
      if (row.source === 'ai_generated') aiGenerated = row.count;
      else if (row.source === 'user_uploaded') userUploaded = row.count;
    }

    res.json({
      success: true,
      totalAssets,
      monthlyNew,
      aiGenerated,
      userUploaded
    });
  })
);
// ─── DELETE /:id ──────────────────────────────────────────────────────────────
// Deletes asset file from disk and removes DB record.
// Verifies the asset belongs to the authenticated user.
router.delete(
  '/:id',
  authenticateSession,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const uid = req.user.uid;

    const result = await pool.query(
      'SELECT * FROM assets WHERE id = $1',
      [id]
    );

    if (result.rowCount === 0) {
      throw new AppError('找不到对应的素材记录', 404);
    }

    const asset = result.rows[0];

    // Verify ownership
    if (asset.uid !== uid) {
      throw new AppError('无权删除他人的素材', 403);
    }

    // Unlink the file from storage provider
    try {
      await storage.deleteFile(asset.url);
      console.log(`[Assets] Deleted file from storage provider: ${asset.url}`);
    } catch (err) {
      console.warn(`[Assets] Failed to delete file ${asset.url} from storage provider:`, err.message);
    }

    // Delete database row
    await pool.query('DELETE FROM assets WHERE id = $1', [id]);

    res.json({ success: true, message: '素材已成功删除' });
  })
);

export default router;
