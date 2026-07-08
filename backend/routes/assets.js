import { Router } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import config, { projectRoot } from '../config.js';
import { authenticateSession } from '../auth/sessionMiddleware.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import createStorageProvider from '../utils/storage.js';

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
  pool = p;
}

// ─── POST /upload ─────────────────────────────────────────────────────────────
// Accepts base64 image data in the request body and saves to disk.
// Body size limit is enforced globally in index.js (10 MB).
router.post(
  '/upload',
  authenticateSession,
  asyncHandler(async (req, res) => {
    const { name, data, metrics } = req.body;
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

    const ext = path.extname(name) || '.png';
    const uniqueFileName = `upload_${Date.now()}_${Math.floor(Math.random() * 1000)}${ext}`;

    // Save binary file using StorageProvider
    const relativeUrl = await storage.saveFile(buffer, uniqueFileName);
    const assetId = 'asset-' + crypto.randomUUID();

    // Persist asset metadata in DB
    await pool.query(
      'INSERT INTO assets (id, uid, name, url, size, date, metrics, source, session_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [
        assetId,
        uid,
        name || uniqueFileName,
        relativeUrl,
        sizeStr,
        new Date().toISOString().split('T')[0],
        metrics ? (typeof metrics === 'string' ? metrics : JSON.stringify(metrics)) : null,
        'user_uploaded',
        req.body.session_id || null
      ]
    );

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

    res.json({ success: true, assets: result.rows });
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
