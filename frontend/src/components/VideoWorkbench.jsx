import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BrainCircuit, Download, Film, Music, Play, Plus, Trash2, Upload } from 'lucide-react';
import ViralReplicationWorkbench from './ViralReplicationWorkbench';

const RATIO_SIZE = {
  '16:9': [1280, 720], '9:16': [720, 1280], '1:1': [1080, 1080], '4:5': [864, 1080],
};
const DEFAULT_PLAN = {
  aspect_ratio: '9:16', text_overlay: { text: '', position: 'bottom', font_size: 42, color: 'FFFFFF' },
  original_volume: 1, music_volume: 0.25, fade: true, fps: 30,
};
const MAX_VIDEO_DURATION_SECONDS = 60;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const mediaDuration = file => new Promise((resolve) => {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.onloadedmetadata = () => { resolve(Number(video.duration || 0)); URL.revokeObjectURL(url); };
  video.onerror = () => { resolve(0); URL.revokeObjectURL(url); };
  video.src = url;
});

const createTextOverlay = (overlay, aspectRatio) => new Promise((resolve, reject) => {
  const [width, height] = RATIO_SIZE[aspectRatio] || RATIO_SIZE['9:16'];
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  const fontSize = Number(overlay.font_size || 42);
  const text = String(overlay.text || '').trim();
  context.font = `700 ${fontSize}px "PingFang SC", "Microsoft YaHei", sans-serif`;
  context.textAlign = 'center'; context.textBaseline = 'middle';
  const maxWidth = width * 0.82;
  const boxWidth = Math.min(maxWidth, context.measureText(text).width) + fontSize * 1.4;
  const boxHeight = fontSize * 1.85;
  const centerY = overlay.position === 'top' ? height * 0.1 : overlay.position === 'center' ? height * 0.5 : height * 0.88;
  context.fillStyle = 'rgba(0,0,0,.48)';
  context.beginPath();
  context.roundRect((width - boxWidth) / 2, centerY - boxHeight / 2, boxWidth, boxHeight, fontSize * 0.35);
  context.fill();
  context.fillStyle = `#${overlay.color || 'FFFFFF'}`;
  context.fillText(text, width / 2, centerY, maxWidth);
  canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('文字图层生成失败')), 'image/png');
});

export default function VideoWorkbench({ sessionId, initialPlan, onStateChange, onError, onSuccess }) {
  const restoredState = initialPlan?.workspace_state || {};
  const [workMode, setWorkMode] = useState(initialPlan?.mode === 'viral_structure_replication' ? 'viral' : 'edit');
  const [sources, setSources] = useState([]);
  const [clips, setClips] = useState([]);
  const [selectedClipId, setSelectedClipId] = useState('');
  const [plan, setPlan] = useState(() => ({
    ...DEFAULT_PLAN,
    ...(restoredState.plan || initialPlan || {}),
    text_overlay: { ...DEFAULT_PLAN.text_overlay, ...(restoredState.plan?.text_overlay || initialPlan?.text_overlay || {}) },
  }));
  const [instruction, setInstruction] = useState(restoredState.instruction || '提取商品最清晰、最有吸引力的镜头，制作节奏紧凑的信息流短视频');
  const [analysis, setAnalysis] = useState(restoredState.analysis || null);
  const [analyzing, setAnalyzing] = useState(false);
  const [music, setMusic] = useState(null);
  const [job, setJob] = useState(restoredState.job || null);
  const [submitting, setSubmitting] = useState(false);
  const previewsRef = useRef(new Set());
  const cancelledRef = useRef(false);
  const onStateChangeRef = useRef(onStateChange);
  onStateChangeRef.current = onStateChange;

  const addSources = useCallback(async fileList => {
    const files = Array.from(fileList || []).slice(0, Math.max(0, 4 - sources.length));
    if (!files.length) return;
    const additions = await Promise.all(files.map(async file => {
      const preview = URL.createObjectURL(file);
      previewsRef.current.add(preview);
      return { file, preview, duration: await mediaDuration(file) };
    }));
    const invalid = additions.find(source => !source.duration || source.duration > MAX_VIDEO_DURATION_SECONDS + 0.05);
    if (invalid) {
      additions.forEach(source => {
        URL.revokeObjectURL(source.preview);
        previewsRef.current.delete(source.preview);
      });
      onError?.(!invalid.duration
        ? `“${invalid.file.name}”无法读取视频时长，请确认格式可正常播放`
        : `“${invalid.file.name}”超过 ${MAX_VIDEO_DURATION_SECONDS} 秒，请先裁剪后再上传`);
      return;
    }
    const offset = sources.length;
    const addedClips = additions.map((source, index) => ({
      id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${index}`,
      source_index: offset + index, start: 0, end: Number(source.duration.toFixed(2)), reason: '完整素材',
    }));
    setSources(current => [...current, ...additions]);
    setClips(current => [...current, ...addedClips]);
    if (!selectedClipId && addedClips[0]) setSelectedClipId(addedClips[0].id);
    setAnalysis(null); setJob(null);
  }, [onError, selectedClipId, sources.length]);

  useEffect(() => () => {
    cancelledRef.current = true;
    previewsRef.current.forEach(url => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => {
    if (!initialPlan) return;
    setWorkMode(initialPlan.mode === 'viral_structure_replication' ? 'viral' : 'edit');
    const recovered = initialPlan.workspace_state || {};
    const recoveredPlan = recovered.plan || initialPlan;
    setPlan(current => ({ ...current, ...recoveredPlan, text_overlay: { ...current.text_overlay, ...(recoveredPlan.text_overlay || {}) } }));
    setInstruction(recovered.instruction || initialPlan.instruction || '提取商品最清晰、最有吸引力的镜头，制作节奏紧凑的信息流短视频');
    setAnalysis(recovered.analysis || null);
    setJob(recovered.job || null);
    setSources([]);
    setClips([]);
    setSelectedClipId('');
    initialFilesLoadedRef.current = null;
  }, [initialPlan]);

  useEffect(() => {
    if (workMode !== 'edit') return;
    const persistentPlan = Object.fromEntries(
      Object.entries(plan).filter(([key]) => key !== 'sourceFiles' && key !== 'workspace_state'),
    );
    onStateChangeRef.current?.({
      mode: 'video_edit',
      instruction,
      plan: persistentPlan,
      analysis,
      job,
      clips: clips.map(({ source_index, start, end, reason }) => ({ source_index, start, end, reason })),
      source_history: sources.map(source => ({
        name: source.file?.name || source.name || '视频素材',
        duration: source.duration || 0,
        url: source.stored_url || '',
      })),
    });
  }, [analysis, clips, instruction, job, plan, sources, workMode]);

  const initialFilesLoadedRef = useRef(null);
  useEffect(() => {
    const files = initialPlan?.sourceFiles;
    if (!Array.isArray(files) || !files.length || initialFilesLoadedRef.current === files) return;
    initialFilesLoadedRef.current = files;
    void addSources(files);
  }, [addSources, initialPlan]);

  const selectedClip = clips.find(clip => clip.id === selectedClipId) || clips[0];
  const selectedSource = selectedClip ? sources[selectedClip.source_index] : sources[0];
  const totalDuration = useMemo(() => clips.reduce((sum, clip) => sum + Math.max(0, Number(clip.end || 0) - Number(clip.start || 0)), 0), [clips]);

  if (workMode === 'viral') {
    return <ViralReplicationWorkbench sessionId={sessionId} initialPlan={initialPlan} onStateChange={onStateChange} onBack={() => setWorkMode('edit')} onError={onError} onSuccess={onSuccess} />;
  }

  const updateClip = (id, changes) => setClips(current => current.map(clip => clip.id === id ? { ...clip, ...changes } : clip));
  const removeClip = id => setClips(current => current.filter(clip => clip.id !== id));
  const addClip = sourceIndex => {
    const source = sources[sourceIndex];
    if (!source) return;
    const clip = { id: globalThis.crypto?.randomUUID?.() || String(Date.now()), source_index: sourceIndex, start: 0, end: Number(source.duration.toFixed(2)), reason: '手动片段' };
    setClips(current => [...current, clip]); setSelectedClipId(clip.id);
  };

  const analyze = async () => {
    if (!sources.length || analyzing) return;
    setAnalyzing(true); setAnalysis(null);
    try {
      const form = new FormData();
      sources.forEach(source => form.append('videos', source.file, source.file.name));
      form.append('instruction', instruction);
      form.append('workspace_type', 'video_edit');
      if (sessionId) form.append('session_id', sessionId);
      const response = await fetch('/api/video/analyze', { method: 'POST', credentials: 'include', body: form });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '多模态视频分析失败');
      setAnalysis(data.analysis);
      if (Array.isArray(data.source_assets)) {
        setSources(current => current.map((source, index) => ({ ...source, stored_url: data.source_assets[index]?.url || source.stored_url || '' })));
      }
      const recommended = data.analysis.recommended_plan || {};
      setPlan(current => ({ ...current, ...recommended, text_overlay: { ...current.text_overlay, ...(recommended.text_overlay || {}) } }));
      if (recommended.clips?.length) {
        const nextClips = recommended.clips.map((clip, index) => ({ ...clip, id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${index}` }));
        setClips(nextClips); setSelectedClipId(nextClips[0]?.id || '');
      }
      onSuccess?.('多模态素材理解完成，已生成推荐粗剪方案');
    } catch (error) {
      onError?.(error.message); setAnalysis({ error: error.message });
    } finally { setAnalyzing(false); }
  };

  const pollJob = async id => {
    while (!cancelledRef.current) {
      await sleep(1200);
      const response = await fetch(`/api/video/jobs/${id}`, { credentials: 'include' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '读取视频任务失败');
      setJob(data.job);
      if (['completed', 'failed'].includes(data.job.status)) return data.job;
    }
  };

  const render = async () => {
    if (!sources.length || !clips.length || submitting) return;
    setSubmitting(true); setJob({ status: 'queued', progress: 0 });
    try {
      const form = new FormData();
      sources.forEach(source => form.append('videos', source.file, source.file.name));
      if (music) form.append('music', music, music.name);
      const text = String(plan.text_overlay?.text || '').trim();
      if (text) form.append('overlay', await createTextOverlay({ ...plan.text_overlay, text }, plan.aspect_ratio), 'text-overlay.png');
      form.append('plan', JSON.stringify({ ...plan, clips: clips.map(({ source_index, start, end }) => ({ source_index, start: Number(start), end: Number(end) })), text_overlay: text ? { ...plan.text_overlay, text } : null }));
      form.append('workspace_type', 'video_edit');
      if (sessionId) form.append('session_id', sessionId);
      const response = await fetch('/api/video/jobs', { method: 'POST', credentials: 'include', body: form });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '创建视频任务失败');
      setJob(data.job);
      const completed = await pollJob(data.job.id);
      if (completed?.status === 'failed') throw new Error(completed.error || '视频处理失败');
      if (completed?.status === 'completed') onSuccess?.('成片已生成并保存到仓库');
    } catch (error) {
      setJob(current => ({ ...current, status: 'failed', error: error.message })); onError?.(error.message);
    } finally { setSubmitting(false); }
  };

  const panel = { background: 'var(--surface-container-lowest)', border: '1px solid var(--outline-variant)', borderRadius: 14 };
  return (
    <main style={{ padding: '0 22px 24px', height: 'calc(100vh - 88px)', boxSizing: 'border-box', display: 'grid', gridTemplateRows: 'auto minmax(0,1fr) 190px', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div><h2 style={{ margin: 0, fontSize: 20 }}>智能剪辑工作台</h2><p style={{ margin: '4px 0 0', color: 'var(--on-surface-variant)', fontSize: 12 }}>多模态 Agent 理解素材，FFmpeg 可靠执行粗剪与商品信息流成片</p></div>
        <div style={{ display: 'flex', gap: 9 }}>
          <button className="settings-btn cancel" onClick={() => setWorkMode('viral')}>爆款结构复刻</button>
          <label className="settings-btn cancel" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Upload size={15} />导入视频<input hidden type="file" multiple accept="video/mp4,video/quicktime,video/webm,video/x-matroska" onChange={event => addSources(event.target.files)} /></label>
          <button className="settings-btn save" disabled={!sources.length || analyzing} onClick={analyze}><BrainCircuit size={15} />{analyzing ? '正在理解素材…' : 'AI 分析并粗剪'}</button>
          <button className="settings-btn save" disabled={!clips.length || submitting} onClick={render}><Play size={15} />{submitting ? '正在生成…' : '生成成片'}</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '260px minmax(360px,1fr) 310px', gap: 14, minHeight: 0 }}>
        <section style={{ ...panel, padding: 13, overflow: 'auto' }}>
          <strong style={{ fontSize: 13 }}>素材与镜头</strong>
          {!sources.length && restoredState.source_history?.length > 0 && <div style={{ marginTop: 10, padding: 10, borderRadius: 10, background: 'var(--surface-container-low)', color: 'var(--on-surface-variant)', fontSize: 11, lineHeight: 1.6 }}>历史素材：{restoredState.source_history.map(item => `${item.name}${item.duration ? `（${Number(item.duration).toFixed(1)}秒）` : ''}`).join('、')}<br />历史方案和成片已恢复；继续剪辑时请重新选择本地源文件。</div>}
          {!sources.length && <label style={{ height: 150, marginTop: 12, border: '1px dashed var(--outline-variant)', borderRadius: 12, display: 'grid', placeItems: 'center', textAlign: 'center', cursor: 'pointer', color: 'var(--on-surface-variant)', fontSize: 12 }}><span><Upload size={25} /><br />上传最多 4 个视频，单个最长 60 秒<br />AI 将抽取时间戳关键帧</span><input hidden type="file" multiple accept="video/*" onChange={event => addSources(event.target.files)} /></label>}
          {sources.map((source, index) => <div key={source.preview} style={{ marginTop: 10, padding: 9, borderRadius: 10, background: 'var(--surface-container-low)' }}><video src={source.preview} muted style={{ width: '100%', height: 100, objectFit: 'cover', borderRadius: 8, background: '#111' }} /><div style={{ fontSize: 11, marginTop: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{index + 1}. {source.file.name}</div><button onClick={() => addClip(index)} style={{ border: 0, background: 'none', color: 'var(--primary)', fontSize: 11, cursor: 'pointer', marginTop: 4 }}><Plus size={11} /> 添加片段</button></div>)}
        </section>

        <section style={{ ...panel, padding: 14, minHeight: 0, display: 'grid', gridTemplateRows: 'minmax(0,1fr) auto' }}>
          <div style={{ minHeight: 0, display: 'grid', placeItems: 'center', background: '#090b10', borderRadius: 12, overflow: 'hidden' }}>
            {job?.output_url ? <video src={job.output_url} controls style={{ maxWidth: '100%', maxHeight: '100%' }} /> : selectedSource ? <video src={selectedSource.preview} controls style={{ maxWidth: '100%', maxHeight: '100%' }} /> : <div style={{ color: '#7f8796', textAlign: 'center' }}><Film size={42} /><div style={{ marginTop: 8, fontSize: 12 }}>导入视频后在这里预览</div></div>}
          </div>
          {job && <div style={{ marginTop: 10 }}><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}><span>{job.status === 'completed' ? '生成完成' : job.status === 'failed' ? '生成失败' : 'FFmpeg 正在处理'}</span><span>{job.progress || 0}%</span></div><div style={{ height: 6, marginTop: 6, borderRadius: 9, background: 'var(--surface-container-high)', overflow: 'hidden' }}><div style={{ width: `${job.progress || 0}%`, height: '100%', background: 'var(--primary)' }} /></div>{job.error && <div style={{ color: '#ef4444', fontSize: 11, marginTop: 5 }}>{job.error}</div>}{job.output_url && <a href={job.output_url} download={`智能剪辑_${job.id}.mp4`} className="settings-btn cancel" style={{ marginTop: 8, display: 'inline-flex', gap: 5, textDecoration: 'none' }}><Download size={13} />下载 MP4</a>}</div>}
        </section>

        <section style={{ ...panel, padding: 14, overflow: 'auto' }}>
          <strong style={{ fontSize: 13 }}>AI 导演</strong>
          <textarea className="settings-input" value={instruction} onChange={event => setInstruction(event.target.value)} style={{ width: '100%', height: 68, marginTop: 10, resize: 'vertical' }} />
          {analysis && !analysis.error && <div style={{ marginTop: 11, fontSize: 11, lineHeight: 1.55 }}><div style={{ fontWeight: 650 }}>素材理解</div><div style={{ color: 'var(--on-surface-variant)' }}>{analysis.summary}</div>{analysis.product && <div style={{ marginTop: 7 }}><b>识别商品：</b>{analysis.product}</div>}{analysis.selling_points?.length > 0 && <div style={{ marginTop: 7 }}><b>候选卖点：</b>{analysis.selling_points.join('、')}</div>}<div style={{ marginTop: 7 }}><b>推荐镜头：</b>{analysis.recommended_plan?.clips?.length || 0} 个</div>{analysis.content_risks?.length > 0 && <div style={{ marginTop: 7, color: '#b45309' }}><b>注意：</b>{analysis.content_risks.join('；')}</div>}</div>}
          {analysis?.error && <div style={{ color: '#ef4444', fontSize: 11, marginTop: 8 }}>{analysis.error}</div>}
          <div style={{ borderTop: '1px solid var(--outline-variant)', marginTop: 13, paddingTop: 12, display: 'grid', gap: 9 }}>
            <label className="settings-label">成片比例<select className="settings-select" value={plan.aspect_ratio} onChange={event => setPlan(current => ({ ...current, aspect_ratio: event.target.value }))}><option value="9:16">9:16 信息流</option><option value="16:9">16:9 横屏</option><option value="1:1">1:1 方形</option><option value="4:5">4:5 电商</option></select></label>
            <label className="settings-label">视频文案<input className="settings-input" value={plan.text_overlay?.text || ''} onChange={event => setPlan(current => ({ ...current, text_overlay: { ...current.text_overlay, text: event.target.value } }))} placeholder="例如：新品限时上市" /></label>
            <label className="settings-label"><Music size={13} /> 背景音乐<input type="file" accept="audio/*" onChange={event => setMusic(event.target.files?.[0] || null)} style={{ width: '100%', marginTop: 5 }} /></label>
            <label style={{ fontSize: 11 }}>原声 {Math.round(plan.original_volume * 100)}%<input type="range" min="0" max="2" step=".05" value={plan.original_volume} onChange={event => setPlan(current => ({ ...current, original_volume: Number(event.target.value) }))} style={{ width: '100%' }} /></label>
            <label style={{ fontSize: 11 }}>音乐 {Math.round(plan.music_volume * 100)}%<input type="range" min="0" max="2" step=".05" value={plan.music_volume} onChange={event => setPlan(current => ({ ...current, music_volume: Number(event.target.value) }))} style={{ width: '100%' }} /></label>
          </div>
        </section>
      </div>

      <section style={{ ...panel, padding: 13, overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><strong style={{ fontSize: 13 }}>粗剪时间线</strong><span style={{ fontSize: 11, color: 'var(--on-surface-variant)' }}>成片约 {totalDuration.toFixed(1)} 秒</span></div>
        <div style={{ display: 'flex', gap: 9, marginTop: 10, minWidth: 'max-content' }}>{clips.map((clip, index) => <div key={clip.id} onClick={() => setSelectedClipId(clip.id)} style={{ width: 190, padding: 9, borderRadius: 10, cursor: 'pointer', border: selectedClip?.id === clip.id ? '2px solid var(--primary)' : '1px solid var(--outline-variant)', background: 'var(--surface-container-low)' }}><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 650 }}><span>镜头 {index + 1} · 素材 {clip.source_index + 1}</span><button onClick={event => { event.stopPropagation(); removeClip(clip.id); }} style={{ border: 0, background: 'none', color: '#ef4444', cursor: 'pointer' }}><Trash2 size={12} /></button></div><div style={{ display: 'flex', gap: 6, marginTop: 8 }}><input className="settings-input" type="number" step=".1" min="0" value={clip.start} onChange={event => updateClip(clip.id, { start: event.target.value })} style={{ width: 72 }} /><span style={{ fontSize: 11, alignSelf: 'center' }}>→</span><input className="settings-input" type="number" step=".1" min="0" value={clip.end} onChange={event => updateClip(clip.id, { end: event.target.value })} style={{ width: 72 }} /></div><div style={{ fontSize: 10, color: 'var(--on-surface-variant)', marginTop: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{clip.reason || '手动片段'}</div></div>)}</div>
      </section>
    </main>
  );
}
