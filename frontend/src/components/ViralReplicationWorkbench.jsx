import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CheckCircle2, Download, Film, Image as ImageIcon, Music, Play, Upload } from 'lucide-react';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function AnalysisProgressCircle({ progress }) {
  const percent = Math.max(0, Math.min(100, Number(progress?.percent || 0)));
  const radius = 43;
  const circumference = 2 * Math.PI * radius;
  return <div role="status" aria-live="polite" style={{ display: 'grid', justifyItems: 'center', gap: 14 }}>
    <div style={{ width: 108, height: 108, position: 'relative' }}>
      <svg viewBox="0 0 108 108" width="108" height="108" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="54" cy="54" r={radius} fill="none" stroke="var(--surface-container-high)" strokeWidth="8" />
        <circle cx="54" cy="54" r={radius} fill="none" stroke="var(--primary)" strokeWidth="8" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={circumference * (1 - percent / 100)} style={{ transition: 'stroke-dashoffset .45s ease' }} />
      </svg>
      <strong style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 20 }}>{percent}%</strong>
    </div>
    <div style={{ textAlign: 'center' }}><strong style={{ fontSize: 13 }}>{progress?.stage}</strong><div style={{ marginTop: 5, fontSize: 10, color: 'var(--on-surface-variant)' }}>素材越长、镜头越多，拆解耗时越久</div></div>
  </div>;
}
const getVideoDuration = file => new Promise(resolve => {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'metadata';
  let settled = false;
  const finish = duration => {
    if (settled) return;
    settled = true;
    window.clearTimeout(timeout);
    URL.revokeObjectURL(url);
    video.removeAttribute('src');
    video.load();
    resolve(duration);
  };
  const timeout = window.setTimeout(() => finish(0), 12_000);
  video.onloadedmetadata = () => finish(Number(video.duration || 0));
  video.onerror = () => finish(0);
  video.src = url;
});

const createTimedTextOverlay = overlay => new Promise((resolve, reject) => {
  const width = 720; const height = 1280;
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
  canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('分时字幕排版失败')), 'image/png');
});

export default function ViralReplicationWorkbench({ sessionId, initialPlan, onStateChange, onBack, onError, onSuccess }) {
  const restoredState = initialPlan?.workspace_state || {};
  const maxReferenceDuration = Number(initialPlan?.max_reference_duration || 60);
  const [reference, setReference] = useState(null);
  const [sources, setSources] = useState([]);
  const [strength, setStrength] = useState(restoredState.strength || initialPlan?.strength || 'medium');
  const [instruction, setInstruction] = useState(restoredState.instruction || '保留参考视频的钩子、节奏和卖点结构，文案改写为适合新商品的原创表达');
  const [blueprint, setBlueprint] = useState(restoredState.blueprint || null);
  const [confirmed, setConfirmed] = useState(Boolean(restoredState.confirmed));
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(null);
  const [rendering, setRendering] = useState(false);
  const [job, setJob] = useState(restoredState.job || null);
  const [music, setMusic] = useState(null);
  const [referenceLoadState, setReferenceLoadState] = useState({ status: 'idle', message: '' });
  const [sourceLoadState, setSourceLoadState] = useState({ status: 'idle', message: '' });
  const urlsRef = useRef(new Set());
  const referenceInputRef = useRef(null);
  const productInputRef = useRef(null);
  const onStateChangeRef = useRef(onStateChange);
  const analysisTimerRef = useRef(null);
  onStateChangeRef.current = onStateChange;

  useEffect(() => () => {
    urlsRef.current.forEach(url => URL.revokeObjectURL(url));
    if (analysisTimerRef.current) window.clearInterval(analysisTimerRef.current);
  }, []);

  useEffect(() => {
    const recovered = initialPlan?.workspace_state;
    if (!recovered) return;
    setStrength(recovered.strength || initialPlan?.strength || 'medium');
    setInstruction(recovered.instruction || '保留参考视频的钩子、节奏和卖点结构，文案改写为适合新商品的原创表达');
    setBlueprint(recovered.blueprint || null);
    setConfirmed(Boolean(recovered.confirmed));
    setJob(recovered.job || null);
    setReference(null);
    setSources([]);
  }, [initialPlan]);

  useEffect(() => {
    onStateChangeRef.current?.({
      mode: 'viral_structure_replication',
      strength,
      instruction,
      blueprint,
      confirmed,
      job,
      reference_history: reference
        ? { name: reference.file?.name || '参考视频', duration: reference.duration || 0 }
        : (restoredState.reference_history || null),
      source_history: sources.length
        ? sources.map(source => ({
            name: source.file?.name || '商品素材',
            kind: source.kind,
            duration: source.duration || 0,
            url: source.stored_url || '',
          }))
        : (restoredState.source_history || []),
      plan: { mode: 'viral_structure_replication', strength, max_reference_duration: maxReferenceDuration },
    });
  }, [blueprint, confirmed, instruction, job, maxReferenceDuration, reference, restoredState.reference_history, restoredState.source_history, sources, strength]);

  const setReferenceFile = async file => {
    if (!file) return;
    if (!file.type.startsWith('video/')) {
      const message = '参考素材必须是视频文件';
      setReferenceLoadState({ status: 'error', message });
      onError?.(message);
      return;
    }
    setReferenceLoadState({ status: 'loading', message: `正在读取“${file.name}”…` });
    const duration = await getVideoDuration(file);
    if (!duration) {
      const message = '参考视频读取失败，请确认文件未损坏且浏览器支持该视频编码';
      setReferenceLoadState({ status: 'error', message });
      onError?.(message);
      return;
    }
    if (duration > maxReferenceDuration) {
      const message = `参考视频时长为 ${duration.toFixed(1)} 秒，不能超过 ${maxReferenceDuration} 秒`;
      setReferenceLoadState({ status: 'error', message });
      onError?.(message);
      return;
    }
    if (reference?.preview) URL.revokeObjectURL(reference.preview);
    const preview = URL.createObjectURL(file); urlsRef.current.add(preview);
    setReference({ file, preview, duration }); setBlueprint(null); setConfirmed(false); setJob(null);
    setReferenceLoadState({ status: 'ready', message: `参考视频已加载到当前页面 · ${duration.toFixed(1)} 秒` });
    onSuccess?.('参考视频加载成功，可以在页面中预览');
  };

  const addProductSources = async fileList => {
    const files = Array.from(fileList || []).slice(0, Math.max(0, 8 - sources.length));
    if (!files.length) {
      const message = sources.length >= 8 ? '商品素材最多上传 8 个' : '没有读取到所选文件，请重新选择';
      setSourceLoadState({ status: 'error', message });
      onError?.(message);
      return;
    }
    setSourceLoadState({ status: 'loading', message: `正在读取 ${files.length} 个商品素材…` });
    const inspected = await Promise.all(files.map(async file => {
      const kind = file.type.startsWith('video/') ? 'video' : file.type.startsWith('image/') ? 'image' : '';
      if (!kind) return { file, error: '不支持的文件类型' };
      const duration = kind === 'video' ? await getVideoDuration(file) : 0;
      if (kind === 'video' && !duration) return { file, error: '视频无法读取或编码不受支持' };
      if (kind === 'video' && duration > maxReferenceDuration) {
        return { file, error: `视频超过 ${maxReferenceDuration} 秒` };
      }
      const preview = URL.createObjectURL(file); urlsRef.current.add(preview);
      return { file, kind, preview, duration };
    }));
    const additions = inspected.filter(item => !item.error);
    const failures = inspected.filter(item => item.error);
    if (additions.length) {
      setSources(current => [...current, ...additions]); setBlueprint(null); setConfirmed(false); setJob(null);
      const total = sources.length + additions.length;
      setSourceLoadState({ status: failures.length ? 'warning' : 'ready', message: `已加载 ${total} 个商品素材到当前页面${failures.length ? `；${failures.map(item => `${item.file.name}：${item.error}`).join('；')}` : ''}` });
      onSuccess?.(`商品素材加载成功，共 ${total} 个`);
    } else {
      const message = failures[0]?.error || '商品素材读取失败';
      setSourceLoadState({ status: 'error', message });
      onError?.(message);
    }
  };

  const groupedSources = useMemo(() => ({
    videos: sources.filter(source => source.kind === 'video'),
    images: sources.filter(source => source.kind === 'image'),
  }), [sources]);

  const analyze = async () => {
    if (analyzing) return;
    if (!reference) {
      const message = '请先上传 1 个爆款参考视频';
      setReferenceLoadState({ status: 'error', message });
      onError?.(message);
      referenceInputRef.current?.click();
      return;
    }
    if (!sources.length) {
      const message = '请至少上传 1 个新商品图片或视频，Agent 需要把参考结构映射到新商品素材';
      setSourceLoadState({ status: 'error', message });
      onError?.(message);
      productInputRef.current?.click();
      return;
    }
    setAnalyzing(true); setBlueprint(null); setConfirmed(false); setJob(null);
    const analysisId = globalThis.crypto?.randomUUID?.() || `analysis-${Date.now()}`;
    setAnalysisProgress({ percent: 5, stage: '正在上传参考视频与商品素材' });
    if (analysisTimerRef.current) window.clearInterval(analysisTimerRef.current);
    analysisTimerRef.current = window.setInterval(async () => {
      try {
        const progressResponse = await fetch(`/api/video/replicate/analyze-progress/${analysisId}`, { credentials: 'include' });
        if (!progressResponse.ok) return;
        const progressData = await progressResponse.json();
        if (progressData.progress) setAnalysisProgress(progressData.progress);
      } catch {
        // The analysis request remains authoritative; a transient progress poll
        // failure must not cancel the actual multimodal task.
      }
    }, 800);
    try {
      const form = new FormData();
      form.append('reference', reference.file, reference.file.name);
      groupedSources.videos.forEach(source => form.append('product_videos', source.file, source.file.name));
      groupedSources.images.forEach(source => form.append('product_images', source.file, source.file.name));
      form.append('instruction', instruction); form.append('strength', strength);
      form.append('workspace_type', 'viral_replication');
      form.append('analysis_id', analysisId);
      if (sessionId) form.append('session_id', sessionId);
      const response = await fetch('/api/video/replicate/analyze', { method: 'POST', credentials: 'include', body: form });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || data.detail || '爆款结构分析失败');
      if (analysisTimerRef.current) window.clearInterval(analysisTimerRef.current);
      analysisTimerRef.current = null;
      setAnalysisProgress({ percent: 100, stage: '复刻蓝图整理完成' });
      await sleep(240);
      setBlueprint(data.blueprint);
      if (Array.isArray(data.source_assets)) {
        setSources(current => current.map((source, index) => ({ ...source, stored_url: data.source_assets[index]?.url || source.stored_url || '' })));
      }
      onSuccess?.('参考视频已拆解，请确认复刻蓝图后再生成');
    } catch (error) {
      onError?.(error.message);
    } finally {
      if (analysisTimerRef.current) window.clearInterval(analysisTimerRef.current);
      analysisTimerRef.current = null;
      setAnalyzing(false);
    }
  };

  const confirmBlueprint = () => {
    if (!blueprint) return;
    const fallbackImage = groupedSources.images.length > 0;
    const shots = blueprint.shots.map(shot => shot.product_source_kind === 'missing' && fallbackImage
      ? { ...shot, product_source_kind: 'image', product_source_index: 0, product_start: 0, product_end: shot.target_duration, match_reason: '缺失镜头使用首张商品图的缓慢推近效果补齐' }
      : shot);
    if (!shots.some(shot => shot.product_source_kind !== 'missing')) {
      return onError?.('当前没有可执行镜头，请补充一张商品图片或更完整的商品视频');
    }
    setBlueprint(current => ({
      ...current, shots,
      mapped_shots: shots.filter(shot => shot.product_source_kind !== 'missing').length,
      missing_shots: shots.filter(shot => shot.product_source_kind === 'missing').length,
    }));
    setConfirmed(true); onSuccess?.('复刻蓝图已确认，可以生成成片');
  };

  const pollJob = async id => {
    while (true) {
      await sleep(1200);
      const response = await fetch(`/api/video/jobs/${id}`, { credentials: 'include' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '读取视频任务失败');
      setJob(data.job);
      if (['completed', 'failed'].includes(data.job.status)) return data.job;
    }
  };

  const render = async () => {
    if (!confirmed || rendering) return;
    setRendering(true); setJob({ status: 'queued', progress: 0 });
    try {
      const clips = [];
      const timedTexts = [];
      const imageAnimationDrafts = new Map();
      let timeline = 0;
      blueprint.shots.forEach(shot => {
        if (shot.product_source_kind === 'missing') return;
        const isVideo = shot.product_source_kind === 'video';
        const sourceIndex = isVideo
          ? shot.product_source_index
          : groupedSources.videos.length + shot.product_source_index;
        const duration = isVideo
          ? Math.max(0.1, shot.product_end - shot.product_start)
          : Math.min(12, Math.max(0.5, shot.target_duration));
        clips.push({
          source_index: sourceIndex,
          start: isVideo ? shot.product_start : 0,
          end: isVideo ? shot.product_end : duration,
        });
        if (!isVideo) {
          const current = imageAnimationDrafts.get(sourceIndex) || { duration: 4, details: [] };
          current.duration = Math.max(current.duration, Math.ceil(duration));
          current.details.push([shot.purpose, shot.shot_type, shot.camera, shot.motion, shot.visual_style].filter(Boolean).join('，'));
          imageAnimationDrafts.set(sourceIndex, current);
        }
        if (shot.adapted_copy) {
          timedTexts.push({ text: shot.adapted_copy, start: timeline, end: timeline + duration, position: 'bottom', font_size: 42, color: 'FFFFFF' });
        }
        timeline += duration;
      });
      if (!clips.length) throw new Error('蓝图中没有可执行镜头');
      const imageAnimations = Array.from(imageAnimationDrafts, ([sourceIndex, item]) => ({
        source_index: sourceIndex,
        duration: Math.min(12, item.duration),
        prompt: `保持商品主体、结构、颜色、Logo、包装与可见文字完全一致，不新增或改写商品信息。仅增加自然且克制的商品运动、环境动态和镜头运动，避免变形、闪烁、物体增减。镜头要求：${item.details.join('；')}`,
      }));
      const form = new FormData();
      groupedSources.videos.forEach(source => form.append('videos', source.file, source.file.name));
      groupedSources.images.forEach(source => form.append('images', source.file, source.file.name));
      if (music) form.append('music', music, music.name);
      const textOverlayBlobs = await Promise.all(timedTexts.map(createTimedTextOverlay));
      textOverlayBlobs.forEach((blob, index) => form.append('text_overlays', blob, `replica-caption-${index}.png`));
      form.append('plan', JSON.stringify({
        aspect_ratio: '9:16', clips, timed_texts: timedTexts,
        image_animations: imageAnimations,
        original_volume: 1, music_volume: 0.25, fade: true, fps: 30,
      }));
      form.append('workspace_type', 'viral_replication');
      if (sessionId) form.append('session_id', sessionId);
      const response = await fetch('/api/video/jobs', { method: 'POST', credentials: 'include', body: form });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '创建复刻任务失败');
      setJob(data.job);
      const completed = await pollJob(data.job.id);
      if (completed.status === 'failed') throw new Error(completed.error || '复刻视频生成失败');
      onSuccess?.('爆款结构复刻视频已生成并保存到仓库');
    } catch (error) {
      setJob(current => ({ ...current, status: 'failed', error: error.message })); onError?.(error.message);
    } finally { setRendering(false); }
  };

  const panel = { background: 'var(--surface-container-lowest)', border: '1px solid var(--outline-variant)', borderRadius: 14 };
  return <main style={{ padding: '0 22px 24px', height: 'calc(100vh - 88px)', overflow: 'auto', boxSizing: 'border-box' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
      <div><button onClick={onBack} style={{ border: 0, background: 'none', padding: 0, color: 'var(--on-surface-variant)', cursor: 'pointer', display: 'flex', gap: 5 }}><ArrowLeft size={14} />返回智能粗剪</button><h2 style={{ margin: '7px 0 0', fontSize: 20 }}>爆款结构复刻</h2><p style={{ margin: '4px 0 0', color: 'var(--on-surface-variant)', fontSize: 12 }}>复用高转化结构与节奏，不复制品牌、Logo 和完整文案</p></div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div role="status" style={{ fontSize: 10, lineHeight: 1.45, color: reference && sources.length ? '#067a53' : 'var(--on-surface-variant)', textAlign: 'right' }}><div>{reference ? '✓ 参考视频已就绪' : '○ 缺少参考视频'}</div><div>{sources.length ? `✓ 新商品素材 ${sources.length} 个` : '○ 缺少新商品素材'}</div></div><button className="settings-btn save" disabled={analyzing} onClick={analyze}>{analyzing ? '正在拆解…' : '生成复刻蓝图'}</button><button className="settings-btn save" disabled={!confirmed || rendering} onClick={render}><Play size={15} />{rendering ? '正在生成…' : '生成复刻成片'}</button></div>
    </div>

    <div style={{ display: 'grid', gridTemplateColumns: '280px minmax(420px,1fr) 320px', gap: 14, minHeight: 480 }}>
      <section style={{ ...panel, padding: 14 }}><strong style={{ fontSize: 13 }}>1. 参考与商品素材</strong>
        {!reference && restoredState.reference_history && <div style={{ marginTop: 10, padding: 9, borderRadius: 9, background: 'var(--surface-container-low)', color: 'var(--on-surface-variant)', fontSize: 10, lineHeight: 1.55 }}>历史参考：{restoredState.reference_history.name} · {Number(restoredState.reference_history.duration || 0).toFixed(1)} 秒<br />蓝图和成片记录已恢复；重新分析或生成时需重新选择本地文件。</div>}
        <input ref={referenceInputRef} hidden type="file" accept="video/*" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; setReferenceFile(file); }} />
        {reference ? <div style={{ marginTop: 11 }}>
          <video src={reference.preview} controls playsInline preload="metadata" style={{ width: '100%', height: 170, display: 'block', objectFit: 'contain', borderRadius: 11, background: '#111' }} onError={() => setReferenceLoadState({ status: 'error', message: '视频预览加载失败，请尝试 MP4（H.264）格式' })} />
          <div style={{ marginTop: 7, fontSize: 10, color: 'var(--on-surface-variant)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={reference.file.name}>{reference.file.name} · {reference.duration.toFixed(1)} 秒</div>
          <button type="button" className="settings-btn cancel" style={{ width: '100%', marginTop: 7, justifyContent: 'center' }} onClick={() => referenceInputRef.current?.click()}>更换参考视频</button>
        </div> : <button type="button" onClick={() => referenceInputRef.current?.click()} style={{ marginTop: 11, width: '100%', height: 150, border: '1px dashed var(--outline-variant)', borderRadius: 11, display: 'grid', placeItems: 'center', cursor: 'pointer', overflow: 'hidden', textAlign: 'center', fontSize: 11, background: 'transparent', color: 'var(--on-surface-variant)' }}>
          <span><Film size={25} /><br />上传参考视频<br />最长 {maxReferenceDuration} 秒</span>
        </button>}
        {referenceLoadState.message && <div role="status" style={{ marginTop: 7, padding: '7px 8px', borderRadius: 8, fontSize: 10, lineHeight: 1.45, color: referenceLoadState.status === 'error' ? '#b91c1c' : referenceLoadState.status === 'ready' ? '#067a53' : 'var(--on-surface-variant)', background: referenceLoadState.status === 'error' ? 'rgba(254,226,226,.72)' : referenceLoadState.status === 'ready' ? 'rgba(209,250,229,.72)' : 'var(--surface-container-low)' }}>{referenceLoadState.message}{referenceLoadState.status === 'ready' && <div style={{ marginTop: 2, opacity: .78 }}>点击“生成复刻蓝图”后才会上传给 Agent 分析</div>}</div>}
        <label className="settings-btn cancel" style={{ marginTop: 12, width: '100%', cursor: 'pointer', display: 'flex', justifyContent: 'center', gap: 5 }}><Upload size={14} />上传新商品素材<input ref={productInputRef} hidden multiple type="file" accept="video/*,image/jpeg,image/png,image/webp" onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ''; void addProductSources(files); }} /></label>
        {sourceLoadState.message && <div role="status" style={{ marginTop: 7, fontSize: 10, color: sourceLoadState.status === 'error' ? '#b91c1c' : sourceLoadState.status === 'ready' ? '#067a53' : 'var(--on-surface-variant)' }}>{sourceLoadState.message}</div>}
        {!sources.length && restoredState.source_history?.length > 0 && <div style={{ marginTop: 8, fontSize: 10, color: 'var(--on-surface-variant)', lineHeight: 1.5 }}>历史商品素材：{restoredState.source_history.map(item => item.name).join('、')}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7, marginTop: 9 }}>{sources.map((source, index) => <div key={source.preview} style={{ background: 'var(--surface-container-low)', borderRadius: 9, overflow: 'hidden' }}>{source.kind === 'video' ? <video src={source.preview} controls playsInline preload="metadata" style={{ width: '100%', height: 90, display: 'block', objectFit: 'contain', background: '#111' }} /> : <img src={source.preview} alt="" style={{ width: '100%', height: 90, objectFit: 'cover' }} />}<div style={{ padding: 5, fontSize: 9, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={source.file.name}>{source.kind === 'video' ? <Film size={9} /> : <ImageIcon size={9} />} {index + 1}. {source.file.name}{source.kind === 'video' ? ` · ${source.duration.toFixed(1)}秒` : ''}</div></div>)}</div>
      </section>

      <section style={{ ...panel, padding: 14, overflow: 'auto' }}><div style={{ display: 'flex', justifyContent: 'space-between' }}><strong style={{ fontSize: 13 }}>2. 复刻蓝图</strong>{blueprint && <span style={{ fontSize: 10 }}>{blueprint.mapped_shots}/{blueprint.shots.length} 镜头已匹配</span>}</div>
        {!blueprint && <div style={{ height: 390, display: 'grid', placeItems: 'center', textAlign: 'center', color: 'var(--on-surface-variant)', fontSize: 12 }}>{analyzing && analysisProgress ? <AnalysisProgressCircle progress={analysisProgress} /> : <span>上传参考视频和新商品素材后<br />Agent 将拆解钩子、节奏、镜头与 CTA</span>}</div>}
        {blueprint && <><div style={{ marginTop: 10, padding: 10, borderRadius: 9, background: 'var(--surface-container-low)', fontSize: 11, lineHeight: 1.55 }}><b>{blueprint.title}</b><div>{blueprint.summary}</div><div style={{ marginTop: 5 }}><b>钩子：</b>{blueprint.hook_type} · {blueprint.hook_pattern}</div><div><b>整体风格：</b>{blueprint.overall_style}</div></div>
          <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>{blueprint.shots.map((shot, index) => <div key={`${shot.reference_start}-${index}`} style={{ padding: 10, border: `1px solid ${shot.product_source_kind === 'missing' ? '#f59e0b' : 'var(--outline-variant)'}`, borderRadius: 10, fontSize: 10 }}><div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}><span>镜头 {index + 1} · {shot.purpose}</span><span>{shot.reference_start.toFixed(1)}–{shot.reference_end.toFixed(1)}s → {shot.target_duration.toFixed(1)}s</span></div><div style={{ marginTop: 5, color: 'var(--on-surface-variant)' }}>{shot.shot_type} · {shot.camera} · {shot.motion}</div><div style={{ marginTop: 4 }}><b>原创文案：</b>{shot.adapted_copy || '无字幕'}</div><div style={{ marginTop: 4 }}><b>素材：</b>{shot.product_source_kind === 'missing' ? '缺失' : `${shot.product_source_kind === 'video' ? '视频' : '图片'} ${shot.product_source_index + 1}`} · {shot.match_reason}</div>{shot.historical_candidates?.length > 0 && <div style={{ marginTop: 4, color: 'var(--primary)' }}>历史素材候选：{shot.historical_candidates.map(item => `${item.asset_name} (${Math.round(item.score * 100)}%)`).join('、')}</div>}</div>)}</div>
          <button className="settings-btn save" onClick={confirmBlueprint} disabled={confirmed} style={{ marginTop: 11, width: '100%', justifyContent: 'center' }}><CheckCircle2 size={14} />{confirmed ? '蓝图已确认' : '确认蓝图并锁定时间线'}</button></>}
      </section>

      <section style={{ ...panel, padding: 14, overflow: 'auto' }}><strong style={{ fontSize: 13 }}>3. 复刻设置与成片</strong>
        <label className="settings-label" style={{ marginTop: 12 }}>复刻强度<select className="settings-select" value={strength} onChange={event => { setStrength(event.target.value); setBlueprint(null); setConfirmed(false); }}><option value="light">轻度：结构与节奏</option><option value="medium">中度：结构、镜头与风格</option><option value="high">高度：尽量匹配时长和顺序</option></select></label>
        <label className="settings-label" style={{ marginTop: 10 }}>Agent 补充要求<textarea className="settings-input" value={instruction} onChange={event => { setInstruction(event.target.value); setConfirmed(false); }} style={{ width: '100%', minHeight: 90, resize: 'vertical' }} /></label>
        <div style={{ marginTop: 10, padding: 9, borderRadius: 9, background: 'var(--surface-container-low)', fontSize: 10 }}>固定输出 9:16。图片镜头会先由图生视频模型生成动态片段，再由 FFmpeg 完成剪辑、字幕与音频合成。</div>
        <label className="settings-label" style={{ marginTop: 10 }}><Music size={13} /> 背景音乐<input type="file" accept="audio/*" onChange={event => setMusic(event.target.files?.[0] || null)} style={{ width: '100%', marginTop: 5 }} /></label>
        {blueprint?.originality_notes?.length > 0 && <div style={{ marginTop: 12, fontSize: 10, lineHeight: 1.55 }}><b>原创安全：</b>{blueprint.originality_notes.join('；')}</div>}
        {job && <div style={{ marginTop: 15 }}><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}><span>{job.status === 'completed' ? '生成完成' : job.status === 'failed' ? '生成失败' : job.plan?.image_animations?.length && Number(job.progress || 0) < 65 ? 'AI 正在把商品图片生成动态镜头' : 'FFmpeg 正在复刻时间线'}</span><span>{job.progress || 0}%</span></div><div style={{ height: 6, marginTop: 6, background: 'var(--surface-container-high)', borderRadius: 8, overflow: 'hidden' }}><div style={{ width: `${job.progress || 0}%`, height: '100%', background: 'var(--primary)' }} /></div>{job.error && <div style={{ color: '#ef4444', fontSize: 10, marginTop: 5 }}>{job.error}</div>}{job.output_url && <><video src={job.output_url} controls style={{ width: '100%', marginTop: 10, borderRadius: 9, background: '#111' }} /><a href={job.output_url} download={`爆款结构复刻_${job.id}.mp4`} className="settings-btn cancel" style={{ marginTop: 8, display: 'inline-flex', gap: 5, textDecoration: 'none' }}><Download size={13} />下载 MP4</a></>}</div>}
      </section>
    </div>
  </main>;
}
