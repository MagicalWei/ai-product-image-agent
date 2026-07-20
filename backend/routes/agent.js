import { Router } from 'express';
import crypto from 'crypto';
import { authenticateSession } from '../auth/sessionMiddleware.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { createRateLimiter } from '../middleware/rateLimit.js';
import createStorageProvider from '../utils/storage.js';
import { appendConversationTurns, mergeConversationHistory, recoverConversationHistory, toModelConversationHistory } from '../utils/conversation.js';
import { loadBrandMemory, saveBrandMemory } from '../agents/contextStore.js';
import { fetchWithRetries, isConnectivityError } from '../utils/reliableFetch.js';
import { createResilientPool } from '../utils/transientErrors.js';
import { recoverCanvasFromAssets } from '../utils/canvasRecovery.js';
import { restoreStyleReferenceImages, selectStyleReferenceUrls } from '../utils/styleReferences.js';
import { indexMediaAsset } from '../utils/mediaIndex.js';

const router = Router();
const storage = createStorageProvider(process.env.STORAGE_TYPE || 'local');

// Python AI 服务地址
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

// 启动时检查 AI 服务可达性
(async () => {
  let lastError = null;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const resp = await fetch(`${AI_SERVICE_URL}/health`, { signal: AbortSignal.timeout(5000) });
      if (resp.ok) {
        console.log(`[Agent] AI service reachable at ${AI_SERVICE_URL}`);
        return;
      }
      lastError = new Error(`HTTP ${resp.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < 5) await new Promise(resolve => setTimeout(resolve, 1500));
  }
  console.warn(`[Agent] AI service at ${AI_SERVICE_URL} is not reachable: ${lastError?.message || 'unknown error'}`);
  console.warn('[Agent] Agent chat endpoints will fail until the Python service is started.');
})();
// 请求超时 60 秒
const AI_TIMEOUT_MS = 120_000;
const activeAgentStreams = new Map();
const MAX_AGENT_STREAMS_PER_USER = Number(process.env.MAX_AGENT_STREAMS_PER_USER || 1);
const AGENT_TOOL_STATUS_LABELS = {
  generate_image: '正在生成图片...',
  evaluate_image: '正在评估图片质量...',
  query_canvas: '正在查询画布状态...',
  search_knowledge: '正在搜索知识库...',
  generate_product_set: '正在生成你选择的商品图...',
  style_transfer_batch: '正在分析参考风格并生成图片...',
  plan_video_edit: '正在规划视频剪辑方案...',
  update_plan: '正在更新设计方案...',
  finish_task: '任务完成',
};

function agentToolStatusText(tool) {
  return `🔧 ${AGENT_TOOL_STATUS_LABELS[tool] || `正在执行: ${tool}`}`;
}

const agentStreamLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: Number(process.env.AGENT_STREAM_RATE_LIMIT_PER_MINUTE || 20),
  message: {
    error: 'Agent 请求过于密集，请等待当前任务完成后再继续。',
    code: 'AGENT_RATE_LIMITED',
  },
});

let pool;
export function setPool(p) {
  pool = createResilientPool(p);
}

// ─────────────────────────────────────────────────────────────────────────────
// Usage Log Helper
// ─────────────────────────────────────────────────────────────────────────────

async function writeUsageLog(uid, action, creditsDelta, creditsAfter, detail) {
  const id = 'ulog-' + crypto.randomUUID();
  await pool.query(
    `INSERT INTO usage_logs (id, uid, action, credits_delta, credits_after, detail)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, uid, action, creditsDelta, creditsAfter, detail || '']
  );
}

function normalizeConfirmedProductAnalysis(input) {
  const product = input?.product || {};
  const productName = String(product.product_name || '').trim().slice(0, 120);
  const productCategory = String(product.product_category || '').trim().slice(0, 120);
  const points = Array.isArray(input?.selling_points) ? input.selling_points : [];

  if (!productName) throw new AppError('请填写商品名称后再确认', 400);
  if (points.length < 1 || points.length > 5) {
    throw new AppError('请保留 1–5 条确认卖点', 400);
  }

  const sellingPoints = points.map((point, index) => {
    const title = String(point?.title || '').trim().slice(0, 80);
    const evidence = String(point?.visual_evidence || '').trim().slice(0, 240);
    if (!title || !evidence) {
      throw new AppError(`第 ${index + 1} 条卖点缺少标题或视觉证据`, 400);
    }
    const verification = ['confirmed_visual', 'likely_visual', 'unsupported'].includes(point.verification)
      ? point.verification
      : 'likely_visual';
    return {
      title,
      description: String(point.description || '').trim().slice(0, 240),
      visual_evidence: evidence,
      confidence: Math.max(0, Math.min(1, Number(point.confidence) || 0)),
      verification,
    };
  });

  return {
    schema_version: '1.0',
    status: 'confirmed',
    ...(Number.isFinite(Number(input?._timeline?.after_turn_count)) ? {
      _timeline: {
        after_turn_count: Math.max(0, Number(input._timeline.after_turn_count)),
        analyzed_at: String(input?._timeline?.analyzed_at || '').slice(0, 64),
      },
    } : {}),
    product: {
      product_name: productName,
      product_category: productCategory,
      confidence: Math.max(0, Math.min(1, Number(product.confidence) || 0)),
    },
    visible_facts: (Array.isArray(input.visible_facts) ? input.visible_facts : [])
      .map((item) => String(item).trim().slice(0, 200)).filter(Boolean).slice(0, 12),
    selling_points: sellingPoints,
    uncertain_claims: (Array.isArray(input.uncertain_claims) ? input.uncertain_claims : [])
      .map((item) => String(item).trim().slice(0, 240)).filter(Boolean).slice(0, 8),
    image_quality: {
      subject_complete: input?.image_quality?.subject_complete !== false,
      clarity: ['good', 'fair', 'poor'].includes(input?.image_quality?.clarity)
        ? input.image_quality.clarity
        : 'fair',
      issues: (Array.isArray(input?.image_quality?.issues) ? input.image_quality.issues : [])
        .map((item) => String(item).trim().slice(0, 200)).filter(Boolean).slice(0, 6),
    },
    visual_style: {
      style_summary: String(input?.visual_style?.style_summary || '').trim().slice(0, 240),
      background: String(input?.visual_style?.background || '').trim().slice(0, 160),
      lighting: String(input?.visual_style?.lighting || '').trim().slice(0, 160),
      composition: String(input?.visual_style?.composition || '').trim().slice(0, 160),
      color_palette: (Array.isArray(input?.visual_style?.color_palette) ? input.visual_style.color_palette : [])
        .map((item) => String(item).trim().slice(0, 48)).filter(Boolean).slice(0, 8),
      typography: String(input?.visual_style?.typography || '').trim().slice(0, 160),
      mood: String(input?.visual_style?.mood || '').trim().slice(0, 160),
    },
  };
}

async function loadStoredProductImage(uid, sessionId, previousParams) {
  let imageUrl = previousParams?.product_image_url || '';
  if (!imageUrl) {
    const assetResult = await pool.query(
      `SELECT id, url FROM assets
       WHERE uid = $1 AND session_id = $2 AND source = 'user_uploaded'
         AND COALESCE(metrics->>'asset_role', 'product') NOT IN ('style_reference', 'chat_attachment')
       ORDER BY created_at DESC LIMIT 1`,
      [uid, sessionId]
    );
    imageUrl = assetResult.rows[0]?.url || '';
  }
  if (!imageUrl) return { dataUrl: '', imageUrl: '' };
  if (imageUrl.startsWith('data:image/')) return { dataUrl: imageUrl, imageUrl };

  try {
    const imageBuffer = await storage.getFileBuffer(imageUrl);
    const pathname = imageUrl.split('?')[0].toLowerCase();
    const mime = pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')
      ? 'image/jpeg'
      : pathname.endsWith('.webp')
        ? 'image/webp'
        : pathname.endsWith('.gif')
          ? 'image/gif'
          : 'image/png';
    return { dataUrl: `data:${mime};base64,${imageBuffer.toString('base64')}`, imageUrl };
  } catch (error) {
    console.warn(`[Agent] Unable to restore product image ${imageUrl}: ${error.message}`);
    return { dataUrl: '', imageUrl };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 会话 CRUD（不变）
// ─────────────────────────────────────────────────────────────────────────────

// 1. GET /api/agent/brand-memory
router.get(
  '/brand-memory',
  authenticateSession,
  asyncHandler(async (req, res) => {
    const memory = await loadBrandMemory(pool, req.user.uid);
    res.json({ success: true, brandMemory: memory });
  })
);

// 2. PUT /api/agent/brand-memory
router.put(
  '/brand-memory',
  authenticateSession,
  asyncHandler(async (req, res) => {
    const { brandMemory } = req.body;
    if (!brandMemory) throw new AppError('缺少品牌记忆数据', 400);
    await saveBrandMemory(pool, req.user.uid, brandMemory);
    res.json({ success: true, message: '品牌记忆已成功同步更新！' });
  })
);

// 3. GET /api/agent/sessions
router.get(
  '/sessions',
  authenticateSession,
  asyncHandler(async (req, res) => {
    const query = String(req.query.q || '').trim().slice(0, 120);
    const terms = query.split(/\s+/).filter(Boolean).slice(0, 6);
    const params = [req.user.uid];
    const searchClauses = terms.map((term) => {
      params.push(`%${term.replace(/[\\%_]/g, '\\$&')}%`);
      const index = params.length;
      return `(s.title ILIKE $${index} ESCAPE '\\'
        OR COALESCE(s.last_params->>'product_name', '') ILIKE $${index} ESCAPE '\\'
        OR COALESCE(s.agent_memory->>'product_name', '') ILIKE $${index} ESCAPE '\\'
        OR COALESCE(s.chat_history::text, '') ILIKE $${index} ESCAPE '\\')`;
    });
    const searchSql = searchClauses.length ? ` AND ${searchClauses.join(' AND ')}` : '';
    const result = await pool.query(
      `SELECT s.session_id, s.title, s.current_state, s.updated_at,
              COALESCE(s.last_params->>'workspace_type', CASE
                WHEN EXISTS (
                  SELECT 1 FROM video_jobs v
                  WHERE v.session_id = s.session_id
                    AND (s.title ILIKE '%爆款%' OR jsonb_array_length(COALESCE(v.plan->'timed_texts', '[]'::jsonb)) > 0)
                ) THEN 'viral_replication'
                WHEN EXISTS (SELECT 1 FROM video_jobs v WHERE v.session_id = s.session_id) THEN 'video_edit'
                ELSE 'image_design'
              END) AS workspace_type,
              COALESCE(s.last_params->>'product_name', s.agent_memory->>'product_name', '') AS product_name,
              jsonb_array_length(s.chat_history) AS message_count,
              (SELECT COUNT(DISTINCT a.url)::int FROM assets a
               WHERE a.session_id = s.session_id
                 AND COALESCE(a.media_type, 'image') <> 'video'
                 AND (a.source = 'ai_generated'
                      OR COALESCE(a.metrics->>'asset_role', 'product') NOT IN ('style_reference', 'chat_attachment'))) AS image_count,
              (SELECT COUNT(DISTINCT a.url)::int FROM assets a
               WHERE a.session_id = s.session_id
                 AND a.media_type = 'video') AS video_count
       FROM doubao_agent_sessions s
       WHERE s.uid = $1
       ${searchSql}
       ORDER BY s.updated_at DESC`,
      params
    );
    res.json({ success: true, sessions: result.rows, query });
  })
);

// 4. GET /api/agent/sessions/:id
router.get(
  '/sessions/:id',
  authenticateSession,
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      'SELECT * FROM doubao_agent_sessions WHERE session_id = $1 AND uid = $2',
      [req.params.id, req.user.uid]
    );
    if (result.rowCount === 0) throw new AppError('会话未找到', 404);
    const session = result.rows[0];
    const existingLastParams = session.last_params && typeof session.last_params === 'object'
      ? session.last_params
      : {};
    if (!existingLastParams.workspace_type) {
      const videoJobResult = await pool.query(
        `SELECT id, status, progress, plan, output_url, error, created_at, updated_at
         FROM video_jobs WHERE session_id = $1 AND uid = $2
         ORDER BY created_at DESC LIMIT 1`,
        [req.params.id, req.user.uid],
      );
      if (videoJobResult.rowCount > 0) {
        const videoJob = videoJobResult.rows[0];
        const isReplication = session.title?.includes('爆款') || (Array.isArray(videoJob.plan?.timed_texts) && videoJob.plan.timed_texts.length > 0);
        session.last_params = {
          ...existingLastParams,
          workspace_type: isReplication ? 'viral_replication' : 'video_edit',
          video_workspace: {
            ...(existingLastParams.video_workspace || {}),
            mode: isReplication ? 'viral_structure_replication' : 'video_edit',
            plan: videoJob.plan || {},
            job: videoJob,
          },
        };
        await pool.query(
          'UPDATE doubao_agent_sessions SET last_params = $1 WHERE session_id = $2 AND uid = $3',
          [JSON.stringify(session.last_params), req.params.id, req.user.uid],
        );
      }
    }
    const assetResult = await pool.query(
      `SELECT id, name, url, source, metrics, created_at
       FROM assets WHERE session_id = $1 AND uid = $2 ORDER BY created_at`,
      [req.params.id, req.user.uid]
    );
    const recoveredCanvas = recoverCanvasFromAssets(session.canvas_state, assetResult.rows);
    if (recoveredCanvas.recoveredCount > 0) {
      session.canvas_state = recoveredCanvas.canvasState;
      await pool.query(
        'UPDATE doubao_agent_sessions SET canvas_state = $1 WHERE session_id = $2 AND uid = $3',
        [JSON.stringify(session.canvas_state), req.params.id, req.user.uid]
      );
    }
    const recoveredHistory = recoverConversationHistory(session.chat_history, session.agent_memory);
    if ((!session.chat_history || session.chat_history.length === 0) && recoveredHistory.length > 0) {
      session.chat_history = recoveredHistory;
      await pool.query(
        'UPDATE doubao_agent_sessions SET chat_history = $1 WHERE session_id = $2 AND uid = $3',
        [JSON.stringify(recoveredHistory), req.params.id, req.user.uid]
      );
    }
    res.json({ success: true, session });
  })
);

// 5. POST /api/agent/sessions
router.post(
  '/sessions',
  authenticateSession,
  asyncHandler(async (req, res) => {
    const uid = req.user.uid;
    const requestedSessionId = String(req.body.client_session_id || '');
    const sessionId = /^session-[a-zA-Z0-9-]{8,80}$/.test(requestedSessionId)
      ? requestedSessionId
      : 'session-' + crypto.randomUUID();
    const title = req.body.title || '新设计会话';
    const requestedWorkspaceType = String(req.body.workspace_type || 'image_design');
    const workspaceType = ['image_design', 'video_edit', 'viral_replication'].includes(requestedWorkspaceType)
      ? requestedWorkspaceType
      : 'image_design';
    const requestedLastParams = req.body.last_params && typeof req.body.last_params === 'object' && !Array.isArray(req.body.last_params)
      ? req.body.last_params
      : {};
    const lastParams = { ...requestedLastParams, workspace_type: workspaceType };
    await pool.query(
      `INSERT INTO doubao_agent_sessions (session_id, uid, title, current_state, chat_history, last_params)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (session_id) DO NOTHING`,
      [sessionId, uid, title, workspaceType === 'image_design' ? 'COLLECTING_INFO' : 'VIDEO_EDITING', JSON.stringify([]), JSON.stringify(lastParams)]
    );
    res.json({
      success: true,
      session: {
        session_id: sessionId,
        title,
        current_state: workspaceType === 'image_design' ? 'COLLECTING_INFO' : 'VIDEO_EDITING',
        chat_history: [],
        last_params: lastParams,
        workspace_type: workspaceType,
      }
    });
  })
);

// 6. DELETE /api/agent/sessions/:id
router.delete(
  '/sessions/:id',
  authenticateSession,
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      'DELETE FROM doubao_agent_sessions WHERE session_id = $1 AND uid = $2 RETURNING session_id',
      [req.params.id, req.user.uid],
    );
    if (result.rowCount === 0) throw new AppError('会话不存在或已被删除', 404);
    res.json({ success: true, message: '会话已删除' });
  })
);

// 7. PUT /api/agent/sessions/:id
router.put(
  '/sessions/:id',
  authenticateSession,
  asyncHandler(async (req, res) => {
    const { title, canvas_state, last_params, current_state } = req.body;
    const uid = req.user.uid;
    const sid = req.params.id;

    // Build conditional SET clause
    const setClauses = [];
    const values = [];
    let paramIdx = 1;

    if (title !== undefined && title.trim() !== '') {
      setClauses.push(`title = $${paramIdx++}`);
      values.push(title.trim());
    }
    if (canvas_state !== undefined) {
      setClauses.push(`canvas_state = $${paramIdx++}`);
      values.push(JSON.stringify(canvas_state));
    }
    if (last_params !== undefined) {
      if (!last_params || typeof last_params !== 'object' || Array.isArray(last_params)) {
        throw new AppError('工作台状态格式错误', 400);
      }
      const serialized = JSON.stringify(last_params);
      if (serialized.length > 250_000) throw new AppError('工作台状态数据过大', 400);
      setClauses.push(`last_params = COALESCE(last_params, '{}'::jsonb) || $${paramIdx++}::jsonb`);
      values.push(serialized);
    }
    if (current_state !== undefined) {
      const allowedStates = ['COLLECTING_INFO', 'GENERATING_IMAGES', 'DONE', 'VIDEO_EDITING', 'VIDEO_RENDERING'];
      if (!allowedStates.includes(current_state)) throw new AppError('会话状态无效', 400);
      setClauses.push(`current_state = $${paramIdx++}`);
      values.push(current_state);
    }

    if (setClauses.length === 0) {
      throw new AppError('缺少要更新的会话字段', 400);
    }

    setClauses.push('updated_at = CURRENT_TIMESTAMP');
    values.push(sid, uid);

    await pool.query(
      `UPDATE doubao_agent_sessions SET ${setClauses.join(', ')} WHERE session_id = $${paramIdx++} AND uid = $${paramIdx}`,
      values
    );
    res.json({ success: true, message: '会话已更新' });
  })
);

// Repair/sync the user-visible conversation timeline. This endpoint exists for
// legacy sessions whose tool status records only survived in browser cache.
// The current durable server history must remain an ordered subsequence, so a
// stale or incomplete client can add missing UI records but cannot erase chat.
router.put(
  '/sessions/:id/conversation-history',
  authenticateSession,
  asyncHandler(async (req, res) => {
    const submitted = Array.isArray(req.body?.chat_history) ? req.body.chat_history : null;
    if (!submitted) throw new AppError('缺少对话历史数据', 400);
    if (submitted.length > 1000) throw new AppError('对话历史记录过长', 400);

    const normalized = submitted
      .map((turn) => {
        const role = ['user', 'assistant', 'status'].includes(turn?.role) ? turn.role : '';
        const content = String(turn?.content || '').trim().slice(0, 20_000);
        if (!role || !content) return null;
        return {
          ...(turn.id ? { id: String(turn.id).slice(0, 160) } : {}),
          role,
          content,
          ...(turn.agent ? { agent: String(turn.agent).slice(0, 80) } : {}),
          ...(turn.type ? { type: String(turn.type).slice(0, 80) } : {}),
          ...(role === 'user' && Array.isArray(turn.images) ? { images: turn.images.slice(0, 12) } : {}),
        };
      })
      .filter(Boolean);

    const currentResult = await pool.query(
      'SELECT chat_history FROM doubao_agent_sessions WHERE session_id = $1 AND uid = $2',
      [req.params.id, req.user.uid],
    );
    if (currentResult.rowCount === 0) throw new AppError('会话未找到', 404);
    const current = Array.isArray(currentResult.rows[0].chat_history)
      ? currentResult.rows[0].chat_history
      : [];

    let incomingIndex = 0;
    for (const durableTurn of current) {
      while (
        incomingIndex < normalized.length
        && !(normalized[incomingIndex].role === durableTurn.role
          && normalized[incomingIndex].content === durableTurn.content)
      ) incomingIndex += 1;
      if (incomingIndex >= normalized.length) {
        throw new AppError('本地对话版本过旧，已保留云端历史', 409);
      }
      incomingIndex += 1;
    }

    await pool.query(
      `UPDATE doubao_agent_sessions
       SET chat_history = $1, updated_at = CURRENT_TIMESTAMP
       WHERE session_id = $2 AND uid = $3`,
      [JSON.stringify(normalized), req.params.id, req.user.uid],
    );
    res.json({ success: true, repaired_count: Math.max(0, normalized.length - current.length) });
  }),
);

// 7.5 PUT /api/agent/sessions/:id/canvas-state — 专门保存画布状态
router.put(
  '/sessions/:id/canvas-state',
  authenticateSession,
  asyncHandler(async (req, res) => {
    const { canvas_state } = req.body;
    if (!canvas_state) throw new AppError('缺少 canvas_state', 400);
    await pool.query(
      'UPDATE doubao_agent_sessions SET canvas_state = $1, updated_at = CURRENT_TIMESTAMP WHERE session_id = $2 AND uid = $3',
      [JSON.stringify(canvas_state), req.params.id, req.user.uid]
    );
    res.json({ success: true, message: '画布状态已保存' });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// 8.8 POST /api/agent/analyze-product-image — 商品图多模态分析（透传）
// ─────────────────────────────────────────────────────────────────────────────

router.post(
  '/tools/reverse-image-prompt',
  authenticateSession,
  asyncHandler(async (req, res) => {
    const imageBase64 = String(req.body?.image_base64 || '');
    if (!imageBase64.startsWith('data:image/')) {
      throw new AppError('请上传有效的参考图片', 400);
    }
    const pythonResponse = await fetchWithRetries(`${AI_SERVICE_URL}/agent/tools/reverse-image-prompt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Token': process.env.MEDIA_INDEX_INTERNAL_TOKEN || config.JWT_SECRET || '',
      },
      body: JSON.stringify({
        image_base64: imageBase64,
        composition_preference: String(req.body?.composition_preference || 'auto').slice(0, 80),
      }),
    }, { attempts: 2, timeoutMs: 120_000 });
    const data = await pythonResponse.json().catch(() => ({}));
    if (!pythonResponse.ok) {
      throw new AppError(data.detail || '图片提示词反推失败', pythonResponse.status >= 500 ? 502 : 400);
    }
    res.json(data);
  })
);

router.post(
  '/analyze-product-image',
  authenticateSession,
  asyncHandler(async (req, res) => {
    const { image_base64, file_name, session_id } = req.body;
    if (!image_base64) {
      throw new AppError('缺少图片数据', 400);
    }
    if (!session_id) {
      throw new AppError('请先创建或选择一个设计会话', 400);
    }

    const session = await pool.query(
      'SELECT session_id, chat_history FROM doubao_agent_sessions WHERE session_id = $1 AND uid = $2',
      [session_id, req.user.uid]
    );
    if (session.rowCount === 0) throw new AppError('会话未找到', 404);

    console.log(`[Agent] Forwarding product image analysis for: ${file_name || 'unnamed'}`);

    const pythonResponse = await fetchWithRetries(`${AI_SERVICE_URL}/agent/analyze-product-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_base64, file_name: file_name || '' }),
    }, { attempts: 3, timeoutMs: AI_TIMEOUT_MS });

    if (!pythonResponse.ok) {
      const errText = await pythonResponse.text();
      console.error('[Agent] analyze-product-image failed:', pythonResponse.status, errText);
      throw new AppError(`图片分析失败: ${errText}`, 502);
    }

    const result = await pythonResponse.json();
    if (!result.success || !result.analysis) {
      throw new AppError('多模态模型未返回有效分析结果', 502);
    }
    const storedAnalysis = {
      ...result.analysis,
      _timeline: {
        after_turn_count: Array.isArray(session.rows[0]?.chat_history) ? session.rows[0].chat_history.length : 0,
        analyzed_at: new Date().toISOString(),
      },
    };
    await pool.query(
      `UPDATE doubao_agent_sessions
       SET product_analysis_draft = $1, updated_at = CURRENT_TIMESTAMP
       WHERE session_id = $2 AND uid = $3`,
      [JSON.stringify(storedAnalysis), session_id, req.user.uid]
    );
    res.json({ ...result, analysis: storedAnalysis });
  })
);

// Confirming is the only path that promotes a draft into Agent memory.
router.put(
  '/sessions/:id/product-analysis/confirm',
  authenticateSession,
  asyncHandler(async (req, res) => {
    const confirmed = normalizeConfirmedProductAnalysis(req.body?.analysis);
    const sessionResult = await pool.query(
      `SELECT agent_memory, last_params FROM doubao_agent_sessions
       WHERE session_id = $1 AND uid = $2`,
      [req.params.id, req.user.uid]
    );
    if (sessionResult.rowCount === 0) throw new AppError('会话未找到', 404);

    const session = sessionResult.rows[0];
    const titles = confirmed.selling_points.map((point) => point.title);
    const latestAsset = await pool.query(
      `SELECT url FROM assets
       WHERE uid = $1 AND session_id = $2 AND source = 'user_uploaded'
         AND COALESCE(metrics->>'asset_role', 'product') NOT IN ('style_reference', 'chat_attachment')
       ORDER BY created_at DESC LIMIT 1`,
      [req.user.uid, req.params.id]
    );
    const productImageUrl = latestAsset.rows[0]?.url || session.last_params?.product_image_url || '';
    const nextMemory = {
      ...(session.agent_memory || {}),
      product_name: confirmed.product.product_name,
      product_category: confirmed.product.product_category,
      selling_points: titles.join('，'),
      product_image_analysis: confirmed,
      product_analysis_confirmed: true,
      reference_image_urls: productImageUrl ? [productImageUrl] : (session.agent_memory?.reference_image_urls || []),
    };
    const nextParams = {
      ...(session.last_params || {}),
      product_name: confirmed.product.product_name,
      selling_points: titles.join('，'),
      product_image_url: productImageUrl,
    };

    await pool.query(
      `UPDATE doubao_agent_sessions
       SET product_analysis_confirmed = $1,
           product_analysis_draft = '{}'::jsonb,
           agent_memory = $2,
           last_params = $3,
           updated_at = CURRENT_TIMESTAMP
       WHERE session_id = $4 AND uid = $5`,
      [JSON.stringify(confirmed), JSON.stringify(nextMemory), JSON.stringify(nextParams), req.params.id, req.user.uid]
    );

    if (latestAsset.rows[0]?.id) {
      indexMediaAsset({
        uid: req.user.uid,
        asset_id: latestAsset.rows[0].id,
        session_id: req.params.id,
        media_type: 'image',
        analysis: confirmed,
      }).catch((error) => {
        console.warn(`[MediaIndex] Confirmed product ${latestAsset.rows[0].id} was not indexed:`, error.message);
      });
    }

    res.json({ success: true, analysis: confirmed });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// 9. POST /api/agent/chat-stream — SSE 流式透传
// ─────────────────────────────────────────────────────────────────────────────

router.post(
  '/chat-stream',
  authenticateSession,
  agentStreamLimiter,
  asyncHandler(async (req, res) => {
    const uid = req.user.uid;
    const activeCount = activeAgentStreams.get(uid) || 0;
    if (activeCount >= MAX_AGENT_STREAMS_PER_USER) {
      return res.status(409).json({
        error: 'Agent 正在处理上一条请求，请等待当前生成完成后再发送。',
        code: 'AGENT_REQUEST_IN_PROGRESS',
      });
    }
    activeAgentStreams.set(uid, activeCount + 1);
    let activeReleased = false;
    const releaseActiveSlot = () => {
      if (activeReleased) return;
      activeReleased = true;
      const nextCount = (activeAgentStreams.get(uid) || 1) - 1;
      if (nextCount > 0) {
        activeAgentStreams.set(uid, nextCount);
      } else {
        activeAgentStreams.delete(uid);
      }
    };

    const {
      message, product_image_base64, image_types: clientImageTypes,
      session_id,
      product_name: clientProductName,
      selling_points: clientSellingPoints,
      mask_data,
      canvas_snapshot,
      stitch_regions,
      current_images,
      style_preference: clientStyle,
      aspect_ratio: clientAspectRatio,
      reference_images: clientReferenceImages,
      style_reference_images: clientStyleReferenceImages,
      style_transfer_mode: clientStyleTransferMode,
      product_set_mode: clientProductSetMode,
      message_images: clientMessageImages,
      display_message: clientDisplayMessage,
    } = req.body;

    if (!message || message.trim() === '') {
      throw new AppError('请输入有效的指令消息', 400);
    }
    const explicitStyleReferences = Array.isArray(clientStyleReferenceImages)
      ? clientStyleReferenceImages.filter(Boolean)
      : [];
    const untypedReferences = Array.isArray(clientReferenceImages)
      ? clientReferenceImages.filter(Boolean)
      : [];
    // 用户校验
    const userRes = await pool.query('SELECT * FROM users WHERE uid = $1', [uid]);
    if (userRes.rowCount === 0) throw new AppError('未找到当前用户信息', 404);
    const user = userRes.rows[0];

    // 免费体验：跳过额度检查
    let remainingCredits = 'unlimited';

    // 解析 / 创建会话
    let currentSessionId = session_id;
    if (!currentSessionId) {
      const recentRes = await pool.query(
        'SELECT session_id FROM doubao_agent_sessions WHERE uid = $1 ORDER BY updated_at DESC LIMIT 1',
        [uid]
      );
      currentSessionId = recentRes.rowCount > 0 ? recentRes.rows[0].session_id : 'session-' + crypto.randomUUID();
    }

    // 加载会话状态
    let sessionRes = await pool.query(
      'SELECT * FROM doubao_agent_sessions WHERE session_id = $1 AND uid = $2',
      [currentSessionId, uid]
    );
    if (sessionRes.rowCount === 0) {
      await pool.query(
        'INSERT INTO doubao_agent_sessions (session_id, uid, title, current_state, chat_history, last_params) VALUES ($1, $2, $3, $4, $5, $6)',
        [currentSessionId, uid, '新设计会话', 'COLLECTING_INFO', JSON.stringify([]), JSON.stringify({})]
      );
      sessionRes = await pool.query(
        'SELECT * FROM doubao_agent_sessions WHERE session_id = $1 AND uid = $2',
        [currentSessionId, uid]
      );
    }

    const session = sessionRes.rows[0];
    const previousState = session.current_state;
    const previousHistory = session.chat_history || [];
    // Persist the user's turn before any model or image request. Conversation
    // durability must not depend on the Agent finishing successfully.
    const durableMessageImages = Array.isArray(clientMessageImages)
      ? clientMessageImages
        .filter(image => image && typeof image.url === 'string' && !image.url.startsWith('data:'))
        .slice(0, 5)
        .map(image => ({
          id: String(image.id || '').slice(0, 120),
          name: String(image.name || '图片').slice(0, 160),
          url: String(image.url).slice(0, 2048),
          role: image.role === 'style_reference' ? 'style_reference' : undefined,
          kind: image.kind === 'region_edit' ? 'region_edit' : undefined,
        }))
      : [];
    const durableRequestHistory = appendConversationTurns(
      previousHistory,
      String(clientDisplayMessage || message),
      [],
      durableMessageImages.length > 0 ? { images: durableMessageImages } : {},
    );
    await pool.query(
      'UPDATE doubao_agent_sessions SET chat_history = $1, updated_at = CURRENT_TIMESTAMP WHERE session_id = $2 AND uid = $3',
      [JSON.stringify(durableRequestHistory), currentSessionId, uid]
    );
    const previousParams = session.last_params || {};
    const toolResults = session.tool_results || {};
    const agentMemory = session.agent_memory || {};
    const currentTurnHasStyleReference = durableMessageImages.some(
      (image) => image.role === 'style_reference'
    );
    let recoveredStyleReferenceUrls = [];
    if (
      !currentTurnHasStyleReference
      && !(Array.isArray(agentMemory.style_reference_image_urls)
        && agentMemory.style_reference_image_urls.length > 0)
    ) {
      const legacyStyleAssets = await pool.query(
        `SELECT url FROM assets
         WHERE uid = $1 AND session_id = $2 AND source = 'user_uploaded'
           AND metrics->>'asset_role' = 'style_reference'
         ORDER BY created_at DESC LIMIT 3`,
        [uid, currentSessionId]
      );
      recoveredStyleReferenceUrls = legacyStyleAssets.rows.map((asset) => asset.url).filter(Boolean);
    }
    const memoryWithRecoveredStyle = recoveredStyleReferenceUrls.length > 0
      ? { ...agentMemory, style_reference_image_urls: recoveredStyleReferenceUrls }
      : agentMemory;
    const styleReferenceUrls = selectStyleReferenceUrls(memoryWithRecoveredStyle, durableMessageImages);
    const requestAgentMemory = {
      ...memoryWithRecoveredStyle,
      style_reference_image_urls: styleReferenceUrls,
      ...(currentTurnHasStyleReference || recoveredStyleReferenceUrls.length > 0
        ? { reference_images_intent: 'style_transfer' }
        : {}),
    };

    // Persist the durable reference before calling the Agent. A downstream
    // model failure must not make an already-uploaded reference disappear.
    if (currentTurnHasStyleReference || recoveredStyleReferenceUrls.length > 0) {
      await pool.query(
        'UPDATE doubao_agent_sessions SET agent_memory = $1, updated_at = CURRENT_TIMESTAMP WHERE session_id = $2 AND uid = $3',
        [JSON.stringify(requestAgentMemory), currentSessionId, uid]
      );
    }
    const effectiveStyleReferenceImages = explicitStyleReferences.length > 0
      ? explicitStyleReferences
      : await restoreStyleReferenceImages(storage, styleReferenceUrls);
    if (
      clientStyleTransferMode
      && effectiveStyleReferenceImages.length + untypedReferences.length === 0
    ) {
      releaseActiveSlot();
      throw new AppError('风格参考图无法恢复，请重新上传后再发送', 400);
    }

    // 加载品牌记忆（异常会直接上抛给 asyncHandler）
    const brandMemory = await loadBrandMemory(pool, uid);

    // 设置 SSE 响应头
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const heartbeat = setInterval(() => {
      if (!res.writableEnded && !res.destroyed) res.write(': heartbeat\n\n');
    }, 15000);
    heartbeat.unref?.();

    let fullResult = null;  // stores the final result for DB persistence
    const emittedAssistantMessages = [];
    let sseEnded = false;
    let pythonStreamCompleted = false;
    const finishStream = () => {
      clearInterval(heartbeat);
      releaseActiveSlot();
    };

    // 监听 SSE 响应关闭/客户端断连
    res.on('close', () => {
      sseEnded = true;
      finishStream();
      console.log('[Agent SSE] Client disconnected');
    });

    const sendSSE = (data) => {
      if (!sseEnded) {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      }
    };

    try {
      console.log(`[Agent SSE] Calling AI service stream. Phase: ${previousState}`);

      // Always resolve the persisted product asset URL. The first request
      // carries base64 directly, but follow-up requests must be able to restore
      // the same source image after a reload or a new login.
      const storedProductImage = await loadStoredProductImage(uid, currentSessionId, previousParams);
      const restoredProductImage = product_image_base64
        ? { dataUrl: product_image_base64, imageUrl: storedProductImage.imageUrl }
        : storedProductImage;

      const pythonResponse = await fetchWithRetries(`${AI_SERVICE_URL}/agent/run-stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Token': process.env.MEDIA_INDEX_INTERNAL_TOKEN || process.env.JWT_SECRET || '',
        },
        body: JSON.stringify({
          current_phase: previousState,
          session_id: currentSessionId,
          user_id: uid,
          chat_history: toModelConversationHistory(durableRequestHistory),
          message: message,
          product_name: clientProductName || previousParams.product_name || '',
          selling_points: clientSellingPoints || previousParams.selling_points || '',
          ecom_platform: previousParams.ecom_platform || '',
          aspect_ratio: clientAspectRatio || previousParams.aspect_ratio || '1:1',
          language: previousParams.language || 'zh',
          target_country: previousParams.target_country || '',
          image_types: clientImageTypes || previousParams.image_types || [],
          product_image_base64: restoredProductImage.dataUrl || previousParams.product_image_base64 || '',
          style_preference: clientStyle || previousParams.style_preference || '',
          reference_images: untypedReferences.length > 0 ? untypedReferences : (previousParams.reference_images || []),
          style_reference_images: effectiveStyleReferenceImages,
          style_transfer_mode: Boolean(clientStyleTransferMode),
          product_set_mode: Boolean(clientProductSetMode),
          color_palette: previousParams.color_palette || [],
          negative_prompt: previousParams.negative_prompt || '',
          brand_memory: brandMemory,
          agent_memory: requestAgentMemory,
          skip_info_collection: req.body.skip_info_collection || false,
          skip_design_planning: req.body.skip_design_planning || false,
          single_image_mode: req.body.single_image_mode || false,
          target_single_type: req.body.target_single_type || '',
          refinement_mode: req.body.refinement_mode || false,
          mask_data: mask_data || null,
          canvas_snapshot: canvas_snapshot || null,
          stitch_regions: stitch_regions || [],
          current_images: current_images || previousParams.current_images || {},
          tool_results: toolResults,
        }),
      }, {
        attempts: 3,
        timeoutMs: (clientStyleTransferMode || clientProductSetMode) ? 240_000 : AI_TIMEOUT_MS,
        timeoutScope: 'connect',
        retryStatuses: new Set([502, 503, 504]),
        retryNetwork: isConnectivityError,
      });

      if (!pythonResponse.ok) {
        const errText = await pythonResponse.text();
        sendSSE({
          event: 'error',
          code: 'AGENT_SERVICE_ERROR',
          retryable: pythonResponse.status >= 500,
          message: pythonResponse.status >= 500
            ? 'AI 服务暂时不可用，请稍后重试。'
            : `AI 处理失败: ${errText}`,
        });
        res.end();
        finishStream();
        return;
      }

      // 透传 SSE 流
      const reader = pythonResponse.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (!sseEnded) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';  // keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const payload = line.slice(6);
            try {
              const event = JSON.parse(payload);
              if (event.event === 'done') pythonStreamCompleted = true;
              if (['agent_message', 'chitchat_reply', 'new_design_started'].includes(event.event) && String(event.text || '').trim()) {
                emittedAssistantMessages.push({
                  role: 'assistant',
                  content: event.text.trim(),
                  agent: event.agent || 'coordinator',
                });
              }
              if (event.event === 'clarification_needed' && Array.isArray(event.questions) && event.questions.length > 0) {
                emittedAssistantMessages.push({
                  role: 'assistant',
                  agent: event.agent || 'requirement_collector',
                  content: `在生成之前，我想确认：\n${event.questions.map((question, index) => `${index + 1}. ${question}`).join('\n')}`,
                });
              }
              if (event.event === 'agent_tool_start' && event.tool) {
                emittedAssistantMessages.push({
                  role: 'status',
                  agent: 'react_agent',
                  type: 'agent_status',
                  content: agentToolStatusText(event.tool),
                });
              }
              if (event.event === 'info_complete') {
                const lastAssistant = [...(event.chat_history || [])].reverse().find(
                  (turn) => turn?.role === 'assistant' && String(turn.content || '').trim()
                );
                if (lastAssistant) {
                  emittedAssistantMessages.push({
                    role: 'assistant',
                    agent: 'planner',
                    content: String(lastAssistant.content).trim(),
                  });
                }
              }
              // Track phase info for DB update
              if (event.event === 'phase_complete') {
                fullResult = {
                  ...fullResult,
                  current_phase: 'GENERATING_IMAGES',
                  product_name: event.product_name,
                  selling_points: event.selling_points,
                  image_types: event.image_types,
                  style_preference: event.style_preference || '',
                  aspect_ratio: event.aspect_ratio || '',
                };
              } else if (event.event === 'info_complete') {
                // Collect info / modify chat_history captured
                fullResult = {
                  ...fullResult,
                  chat_history: event.chat_history || [],
                  current_phase: event.phase === 'MODIFY' ? 'DONE' : 'COLLECTING_INFO',
                };
              } else if (event.event === 'chitchat_reply') {
                // Chitchat — persist chat history, keep current phase
                fullResult = {
                  ...fullResult,
                  chat_history: event.chat_history || [],
                  current_phase: event.phase || session.current_state,
                };
              } else if (event.event === 'new_design_started') {
                // Reset design slots but keep the complete session transcript.
                fullResult = {
                  ...fullResult,
                  current_phase: 'COLLECTING_INFO',
                  product_name: '',
                  selling_points: '',
                  image_types: [],
                };
              } else if (event.event === 'image_done') {
                fullResult = {
                  ...fullResult,
                  generated_images: event.all_images || {},
                  current_images: event.all_images || {},
                  current_phase: 'DONE',
                };
              } else if (event.event === 'error') {
                fullResult = { ...fullResult, error: event.message };
                if (String(event.message || '').trim()) {
                  emittedAssistantMessages.push({
                    role: 'assistant',
                    agent: 'coordinator',
                    content: `生成未完成：${event.message.trim()}`,
                  });
                }
              } else if (event.event === 'tool_call') {
                // Store pending tool call for tracking
                const pendingTools = session.pending_tool_calls || [];
                pendingTools.push({ tool: event.tool, args: event.args, timestamp: new Date().toISOString() });
                await pool.query(
                  'UPDATE doubao_agent_sessions SET pending_tool_calls = $1, updated_at = CURRENT_TIMESTAMP WHERE session_id = $2 AND uid = $3',
                  [JSON.stringify(pendingTools), currentSessionId, uid]
                );
              } else if (event.event === 'design_plan') {
                // Layer 1: Design plan — store for reference
                fullResult = {
                  ...fullResult,
                  design_plan: event.design_plan,
                };
              } else if (event.event === 'evaluation_progress') {
                // Layer 2: ReAct loop evaluation progress — forward to frontend
                // Store latest evaluation for session tracking
                if (event.status === 'evaluated') {
                  const evals = fullResult?.evaluations || {};
                  const imgType = event.image_type;
                  if (!evals[imgType]) evals[imgType] = [];
                  evals[imgType].push({
                    round: event.round,
                    score: event.score,
                    passed: event.passed,
                    issues: event.issues || [],
                    suggestions: event.suggestions || [],
                  });
                  fullResult = { ...fullResult, evaluations: evals };
                }
              } else if (event.event === 'memory_updated') {
                // Phase 1: Structured agent memory updated
                fullResult = {
                  ...fullResult,
                  agent_memory: event.agent_memory || {},
                };
              }
            } catch {
              // skip malformed JSON
            }
            // 透传给前端
            res.write(line + '\n');
          }
        }
      }

      // 处理 buffer 中剩余数据
      if (buffer.startsWith('data: ') && !sseEnded) {
        res.write(buffer + '\n');
        try {
          const finalEvent = JSON.parse(buffer.slice(6));
          if (finalEvent.event === 'done') pythonStreamCompleted = true;
        } catch {}
      }

      if (!pythonStreamCompleted && !sseEnded) {
        sendSSE({
          event: 'error',
          code: 'AGENT_STREAM_INTERRUPTED',
          retryable: true,
          message: 'Agent 连接中断，已保留当前结果，请重试本次操作。',
        });
      }

      // 下载并持久化生成的图片
      const generatedImages = fullResult?.generated_images || {};
      const imageTypeEntries = Object.entries(generatedImages);
      const localImageUrls = [];

      if (imageTypeEntries.length > 0) {
        // 免费体验：跳过额度扣减
        await writeUsageLog(uid, 'charge', 0, user.remaining_credits || 0,
          `SSE free generation: ${(fullResult?.image_types || []).join(', ')}, product: ${fullResult?.product_name || 'unknown'}`
        );

        // 并行下载所有图片
        const downloadTasks = imageTypeEntries.map(async ([imgType, imgUrl]) => {
          console.log(`[Agent SSE] Downloading [${imgType}]: ${imgUrl}`);
          const imgFetch = await fetchWithRetries(imgUrl, {}, {
            attempts: 3,
            timeoutMs: 30_000,
            retryNetwork: () => true,
          });
          if (!imgFetch.ok) {
            throw new Error(`Download failed: HTTP ${imgFetch.status}`);
          }
          const buffer = Buffer.from(await imgFetch.arrayBuffer());
          const fileName = `agent_${imgType}_${Date.now()}_${Math.floor(Math.random() * 1000)}.jpg`;
          const localUrl = await storage.saveFile(buffer, fileName);

          // 写入 assets 表
          const assetId = 'asset-' + crypto.randomUUID();
          const bytes = buffer.length;
          const sizeStr = bytes > 1024 * 1024
            ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
            : `${Math.round(bytes / 1024)} KB`;

          await pool.query(
            'INSERT INTO assets (id, uid, name, url, size, date, metrics, source, session_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
            [assetId, uid, `Agent_${imgType}_${fullResult.product_name?.substring(0, 12) || '设计'}`, localUrl, sizeStr, new Date().toISOString().split('T')[0], null, 'ai_generated', currentSessionId]
          );

          return { type: imgType, url: localUrl };
        });

        const results = await Promise.allSettled(downloadTasks);
        for (const r of results) {
          if (r.status === 'fulfilled') {
            localImageUrls.push(r.value);
          } else {
            console.error('[Agent SSE] Image download failed:', r.reason?.message);
          }
        }

        // 免费体验：跳过退款逻辑（未扣款无需退款）
        if (localImageUrls.length === 0) {
          console.log('[Agent SSE] All downloads failed, but no credits were charged.');
        }
      }

      // 更新会话状态到 DB
      if (fullResult) {
        const nextPhase = fullResult.current_phase || 'COLLECTING_INFO';
        const lastParams = {
          ...previousParams,
          product_name: fullResult.product_name || fullResult.agent_memory?.product_name || previousParams.product_name || '',
          selling_points: fullResult.selling_points || fullResult.agent_memory?.selling_points || previousParams.selling_points || '',
          image_types: fullResult.image_types || fullResult.agent_memory?.image_types || previousParams.image_types || [],
          current_images: fullResult.current_images || previousParams.current_images || {},
          style_preference: fullResult.style_preference || fullResult.agent_memory?.style_preference || previousParams.style_preference || '',
          aspect_ratio: fullResult.aspect_ratio || fullResult.agent_memory?.aspect_ratio || previousParams.aspect_ratio || '1:1',
          product_image_url: restoredProductImage.imageUrl || previousParams.product_image_url || '',
        };

        // 持久化 chat_history（Phase 1 完成后的完整对话上下文）
        const nextChatHistory = appendConversationTurns(
          durableRequestHistory,
          '',
          emittedAssistantMessages
        );

        let nextTitle = session.title;
        if ((!nextTitle || nextTitle === '新设计会话' || nextTitle === '新对话') && lastParams.product_name) {
          nextTitle = `${lastParams.product_name} 的设计会话`;
        }

        await pool.query(
          'UPDATE doubao_agent_sessions SET current_state = $1, chat_history = $2, last_params = $3, agent_memory = $4, title = $5, updated_at = CURRENT_TIMESTAMP WHERE session_id = $6 AND uid = $7',
          [nextPhase, JSON.stringify(nextChatHistory), JSON.stringify(lastParams), JSON.stringify(fullResult.agent_memory || requestAgentMemory), nextTitle, currentSessionId, uid]
        );
      } else if (emittedAssistantMessages.length > 0) {
        const nextChatHistory = appendConversationTurns(
          durableRequestHistory,
          '',
          emittedAssistantMessages,
        );
        await pool.query(
          'UPDATE doubao_agent_sessions SET chat_history = $1, updated_at = CURRENT_TIMESTAMP WHERE session_id = $2 AND uid = $3',
          [JSON.stringify(nextChatHistory), currentSessionId, uid]
        );
      }

      // 告诉前端本地化后的图片 URL
      const imagesMap = {};
      for (const img of localImageUrls) {
        imagesMap[img.type] = img.url;
      }
      if (Object.keys(imagesMap).length > 0) {
        // Persist generated layers server-side before notifying the browser.
        // This survives refreshes and client disconnects before the canvas PUT.
        const canvasResult = await pool.query(
          'SELECT canvas_state FROM doubao_agent_sessions WHERE session_id = $1 AND uid = $2',
          [currentSessionId, uid]
        );
        const durableAssets = localImageUrls.map((image) => ({
          id: `${currentSessionId}-${image.type}-${crypto.randomUUID()}`,
          name: `Agent_${image.type}_${fullResult?.product_name?.substring(0, 12) || '设计'}`,
          url: image.url,
          source: 'ai_generated',
          metrics: { image_type: image.type },
        }));
        const recoveredCanvas = recoverCanvasFromAssets(
          canvasResult.rows[0]?.canvas_state || {},
          durableAssets,
        );
        if (recoveredCanvas.recoveredCount > 0) {
          await pool.query(
            'UPDATE doubao_agent_sessions SET canvas_state = $1 WHERE session_id = $2 AND uid = $3',
            [JSON.stringify(recoveredCanvas.canvasState), currentSessionId, uid]
          );
        }
        sendSSE({ event: 'images_saved', images: imagesMap, remainingCredits });
      }

      res.end();
      finishStream();
    } catch (err) {
      console.error('[Agent SSE] Stream error:', err.message);
      const unavailable = isConnectivityError(err);
      const failureMessage = unavailable
        ? '生成未完成：AI 引擎正在恢复连接，请稍后重试。'
        : '生成未完成：Agent 执行暂时失败，当前会话已保留，请重试。';
      try {
        const failureHistory = appendConversationTurns(
          durableRequestHistory,
          '',
          [...emittedAssistantMessages, failureMessage],
        );
        await pool.query(
          'UPDATE doubao_agent_sessions SET chat_history = $1, updated_at = CURRENT_TIMESTAMP WHERE session_id = $2 AND uid = $3',
          [JSON.stringify(failureHistory), currentSessionId, uid]
        );
      } catch (historyError) {
        console.error('[Agent SSE] Failed to persist error turn:', historyError.message);
      }
      if (!sseEnded) {
        sendSSE({
          event: 'error',
          code: unavailable ? 'AGENT_SERVICE_UNAVAILABLE' : 'AGENT_STREAM_FAILED',
          retryable: true,
          message: unavailable
            ? 'AI 引擎正在恢复连接，请稍后重试。'
            : 'Agent 执行暂时失败，当前会话已保留，请重试。',
        });
        res.end();
      }
      finishStream();
    }
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// 8.5 POST /api/agent/tool-result — Tool Use SSE 协议回传
// ─────────────────────────────────────────────────────────────────────────────

router.post(
  '/tool-result',
  authenticateSession,
  asyncHandler(async (req, res) => {
    const uid = req.user.uid;
    const { session_id, tool_name, result } = req.body;

    if (!session_id || !tool_name) {
      throw new AppError('缺少 session_id 或 tool_name', 400);
    }

    console.log(`[Agent Tool] Received tool_result from ${uid}: ${tool_name} = ${JSON.stringify(result).substring(0, 200)}`);

    // Store the tool result in the session for the Python agent to pick up
    const sessionRes = await pool.query(
      'SELECT * FROM doubao_agent_sessions WHERE session_id = $1 AND uid = $2',
      [session_id, uid]
    );

    if (sessionRes.rowCount === 0) {
      throw new AppError('会话不存在', 404);
    }

    const session = sessionRes.rows[0];
    const pendingTools = session.pending_tool_calls || [];
    const toolResults = session.tool_results || {};

    // Record this tool result
    toolResults[tool_name] = {
      result,
      timestamp: new Date().toISOString()
    };

    // Remove from pending
    const updatedPending = pendingTools.filter(t => t.tool !== tool_name);

    await pool.query(
      'UPDATE doubao_agent_sessions SET tool_results = $1, pending_tool_calls = $2, updated_at = CURRENT_TIMESTAMP WHERE session_id = $3 AND uid = $4',
      [JSON.stringify(toolResults), JSON.stringify(updatedPending), session_id, uid]
    );

    res.json({ success: true });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// 8. POST /api/agent/chat — 核心 AI 流水线（已重构）
// ─────────────────────────────────────────────────────────────────────────────

router.post(
  '/chat',
  authenticateSession,
  asyncHandler(async (req, res) => {
    const uid = req.user.uid;
    const { message, product_image_base64, image_types: clientImageTypes, session_id } = req.body;

    if (!message || message.trim() === '') {
      throw new AppError('请输入有效的指令消息', 400);
    }

    // A. 用户校验
    const userRes = await pool.query('SELECT * FROM users WHERE uid = $1', [uid]);
    if (userRes.rowCount === 0) throw new AppError('未找到当前用户信息', 404);
    const user = userRes.rows[0];
    let remainingCredits = 'unlimited';

    // 免费体验：跳过额度检查

    // B. 解析 / 创建会话
    let currentSessionId = session_id;
    if (!currentSessionId) {
      const recentRes = await pool.query(
        'SELECT session_id FROM doubao_agent_sessions WHERE uid = $1 ORDER BY updated_at DESC LIMIT 1',
        [uid]
      );
      currentSessionId = recentRes.rowCount > 0 ? recentRes.rows[0].session_id : 'session-' + crypto.randomUUID();
    }

    // 重置会话
    if (message.toLowerCase() === '/reset' || message.toLowerCase() === '/clear') {
      const resetSession = await pool.query(
        'SELECT chat_history FROM doubao_agent_sessions WHERE session_id = $1 AND uid = $2',
        [currentSessionId, uid]
      );
      const resetHistory = appendConversationTurns(
        resetSession.rows[0]?.chat_history || [],
        message,
        ['会话状态已重置，历史对话已保留。']
      );
      await pool.query(
        'UPDATE doubao_agent_sessions SET current_state = $1, chat_history = $2, last_params = $3, updated_at = CURRENT_TIMESTAMP WHERE session_id = $4 AND uid = $5',
        ['COLLECTING_INFO', JSON.stringify(resetHistory), JSON.stringify({}), currentSessionId, uid]
      );
      return res.json({
        success: true, intent: 'clarify', clarify_msg: '会话已重置，您可以开始新的设计任务了！',
        brandMemory: {}, images: null, metrics: null,
        remainingCredits, membershipType: user.membership_type,
        phase: 'COLLECTING_INFO', session_id: currentSessionId
      });
    }

    // 加载 / 初始化会话状态
    let sessionRes = await pool.query(
      'SELECT * FROM doubao_agent_sessions WHERE session_id = $1 AND uid = $2',
      [currentSessionId, uid]
    );
    if (sessionRes.rowCount === 0) {
      await pool.query(
        'INSERT INTO doubao_agent_sessions (session_id, uid, title, current_state, chat_history, last_params) VALUES ($1, $2, $3, $4, $5, $6)',
        [currentSessionId, uid, '新设计会话', 'COLLECTING_INFO', JSON.stringify([]), JSON.stringify({})]
      );
      sessionRes = await pool.query(
        'SELECT * FROM doubao_agent_sessions WHERE session_id = $1 AND uid = $2',
        [currentSessionId, uid]
      );
    }

    const session = sessionRes.rows[0];
    const previousState = session.current_state;
    const previousHistory = session.chat_history || [];
    const previousParams = session.last_params || {};

    // C. 加载品牌记忆
    const brandMemory = await loadBrandMemory(pool, uid);

    // D. 转发到 Python AI 服务（API key 由 Python 端自己管理）
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

    let pythonResponse;
    try {
      console.log(`[Agent] Calling AI service. Phase: ${previousState}`);
      pythonResponse = await fetch(`${AI_SERVICE_URL}/agent/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Token': process.env.MEDIA_INDEX_INTERNAL_TOKEN || process.env.JWT_SECRET || '',
        },
        body: JSON.stringify({
          current_phase: previousState,
          session_id: currentSessionId,
          user_id: uid,
          chat_history: toModelConversationHistory(previousHistory),
          message: message,
          product_name: previousParams.product_name || '',
          selling_points: previousParams.selling_points || '',
          ecom_platform: previousParams.ecom_platform || '',
          aspect_ratio: previousParams.aspect_ratio || '1:1',
          language: previousParams.language || 'zh',
          target_country: previousParams.target_country || '',
          image_types: clientImageTypes || previousParams.image_types || [],
          product_image_base64: product_image_base64 || previousParams.product_image_base64 || '',
          style_preference: previousParams.style_preference || '',
          reference_images: clientReferenceImages && clientReferenceImages.length > 0 ? clientReferenceImages : (previousParams.reference_images || []),
          color_palette: previousParams.color_palette || [],
          negative_prompt: previousParams.negative_prompt || '',
          brand_memory: brandMemory,
        }),
        signal: controller.signal,
      });
    } catch (netErr) {
      clearTimeout(timeoutId);
      if (netErr.name === 'AbortError') {
        console.error('[Agent] AI service timeout');
        throw new AppError('AI 服务响应超时，请稍后重试', 504);
      }
      console.error('[Agent] AI service unreachable:', netErr.message);
      throw new AppError('AI 引擎未启动，请确保 Python 后台服务运行中', 503);
    } finally {
      clearTimeout(timeoutId);
    }

    if (!pythonResponse.ok) {
      const errText = await pythonResponse.text();
      console.error('[Agent] AI service error:', pythonResponse.status, errText);
      throw new AppError(`AI 处理失败: ${errText}`, 502);
    }

    const result = await pythonResponse.json();

    // 部分失败但不是致命错误 —— 仍有图片生成成功时放行
    if (result.error && (!result.generated_images || Object.keys(result.generated_images).length === 0)) {
      throw new AppError(result.error, 500);
    }

    // D. 更新会话状态
    const nextPhase = result.current_phase || 'COLLECTING_INFO';
    const pipelineHistory = mergeConversationHistory(previousHistory, result.chat_history);
    const nextHistory = appendConversationTurns(
      pipelineHistory,
      message,
      [result.clarify_msg || result.reply || result.message || '']
    );
    const lastParams = {
      product_name: result.product_name || previousParams.product_name || '',
      selling_points: result.selling_points || previousParams.selling_points || '',
      ecom_platform: result.ecom_platform || previousParams.ecom_platform || '',
      aspect_ratio: result.aspect_ratio || previousParams.aspect_ratio || '1:1',
      language: result.language || previousParams.language || 'zh',
      target_country: result.target_country || previousParams.target_country || '',
      image_types: result.image_types || previousParams.image_types || [],
      style_preference: result.style_preference || previousParams.style_preference || '',
      color_palette: result.color_palette || previousParams.color_palette || [],
      product_image_base64: product_image_base64 || previousParams.product_image_base64 || '',
      reference_images: clientReferenceImages && clientReferenceImages.length > 0 ? clientReferenceImages : (previousParams.reference_images || []),
      negative_prompt: result.negative_prompt || previousParams.negative_prompt || ''
    };

    let nextTitle = session.title;
    if ((!nextTitle || nextTitle === '新设计会话' || nextTitle === '新对话') && lastParams.product_name) {
      nextTitle = `${lastParams.product_name} 的设计会话`;
    }

    await pool.query(
      'UPDATE doubao_agent_sessions SET current_state = $1, chat_history = $2, last_params = $3, title = $4, updated_at = CURRENT_TIMESTAMP WHERE session_id = $5 AND uid = $6',
      [nextPhase, JSON.stringify(nextHistory), JSON.stringify(lastParams), nextTitle, currentSessionId, uid]
    );

    // E. 并行下载生成的图片
    const generatedImages = result.generated_images || {};
    const imageTypeEntries = Object.entries(generatedImages);

    if (imageTypeEntries.length > 0) {
      // 免费体验：跳过额度扣减
      await writeUsageLog(uid, 'charge', 0, user.remaining_credits || 0,
        `Free generation: ${(lastParams.image_types || []).join(', ')}, product: ${lastParams.product_name || 'unknown'}`
      );

      // 并行下载所有图片
      const downloadTasks = imageTypeEntries.map(async ([imgType, imgUrl]) => {
        console.log(`[Agent] Downloading [${imgType}]: ${imgUrl}`);
        const imgFetch = await fetch(imgUrl, { signal: AbortSignal.timeout(30_000) });
        if (!imgFetch.ok) {
          throw new Error(`Download failed: HTTP ${imgFetch.status}`);
        }
        const buffer = Buffer.from(await imgFetch.arrayBuffer());
        const fileName = `agent_${imgType}_${Date.now()}_${Math.floor(Math.random() * 1000)}.jpg`;
        const localUrl = await storage.saveFile(buffer, fileName);

        // 写入 assets 表
        const assetId = 'asset-' + crypto.randomUUID();
        const bytes = buffer.length;
        const sizeStr = bytes > 1024 * 1024
          ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
          : `${Math.round(bytes / 1024)} KB`;

        await pool.query(
          'INSERT INTO assets (id, uid, name, url, size, date, metrics, source, session_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
          [assetId, uid, `Agent_${imgType}_${lastParams.product_name?.substring(0, 12) || '设计'}`, localUrl, sizeStr, new Date().toISOString().split('T')[0], null, 'ai_generated', currentSessionId]
        );

        return { type: imgType, url: localUrl };
      });

      const results = await Promise.allSettled(downloadTasks);

      // 收集成功和失败
      const localImageUrls = [];
      for (const r of results) {
        if (r.status === 'fulfilled') {
          localImageUrls.push(r.value);
        } else {
          console.error('[Agent] Image download failed:', r.reason?.message);
        }
      }

      // 免费体验：跳过退款逻辑
      if (localImageUrls.length === 0) {
        console.log('[Agent] All downloads failed, but no credits were charged.');
        throw new AppError('所有图片下载失败，请稍后重试', 500);
      }

      // F. 返回结果
      const imagesMap = {};
      for (const img of localImageUrls) {
        imagesMap[img.type] = img.url;
      }

      return res.json({
        success: true,
        intent: 'generate',
        phase: 'GENERATING_IMAGES',
        images: imagesMap,
        prompts: result.prompts || {},
        product_name: lastParams.product_name,
        selling_points: lastParams.selling_points,
        image_types: lastParams.image_types,
        aspect_ratio: lastParams.aspect_ratio,
        style_preference: lastParams.style_preference,
        reasoning: [
          'Phase 1: 信息收集完成',
          `产品: ${lastParams.product_name || '未知'}`,
          `图片类型: ${(lastParams.image_types || []).join(', ')}`,
          'Phase 2: 批量生图完成'
        ],
        brandMemory: {},
        metrics: null,
        remainingCredits,
        membershipType: user.membership_type,
        session_id: currentSessionId
      });
    }

    // 信息收集阶段 - 返回追问消息
    const lastMsg = nextHistory[nextHistory.length - 1];
    const replyText = lastMsg?.content || '请告诉我您的产品信息和需要的图片类型，我将为您批量生成商品图！';

    res.json({
      success: true,
      intent: 'clarify',
      phase: 'COLLECTING_INFO',
      clarify_msg: replyText,
      product_name: lastParams.product_name,
      selling_points: lastParams.selling_points,
      image_types: lastParams.image_types,
      brandMemory: {},
      images: null,
      metrics: null,
      remainingCredits,
      membershipType: user.membership_type,
      session_id: currentSessionId
    });
  })
);

export default router;
