import { useRef, useState } from 'react';
import {
  ArrowUp, ChevronDown, Film, Image as ImageIcon, Paperclip,
  Palette, Plus, X,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

const SUGGESTIONS = [
  '为商品制作一张高转化主图',
  '提炼卖点并生成卖点图',
  '制作完整的 A+/详情页',
  '参考样图风格生成商品套图',
];

const MAX_VIDEO_DURATION_SECONDS = 60;

const readAsDataUrl = file => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error || new Error('文件读取失败'));
  reader.readAsDataURL(file);
});

const getVideoDuration = file => new Promise((resolve) => {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.onloadedmetadata = () => {
    resolve(Number(video.duration || 0));
    URL.revokeObjectURL(url);
  };
  video.onerror = () => {
    resolve(0);
    URL.revokeObjectURL(url);
  };
  video.src = url;
});

export default function Portal({ onQuickToolClick, onDirectAgentStart }) {
  const shouldReduceMotion = useReducedMotion();
  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState('product');
  const [productImages, setProductImages] = useState([]);
  const [styleReference, setStyleReference] = useState(null);
  const [videos, setVideos] = useState([]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const productInputRef = useRef(null);
  const styleInputRef = useRef(null);
  const videoInputRef = useRef(null);

  const addProductImages = async event => {
    const files = Array.from(event.target.files || []).slice(0, Math.max(0, 4 - productImages.length));
    event.target.value = '';
    if (!files.length) return;
    setError('');
    const additions = await Promise.all(files.map(async file => ({
      id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${file.name}`,
      name: file.name,
      base64: await readAsDataUrl(file),
    })));
    setProductImages(current => [...current, ...additions].slice(0, 4));
  };

  const addStyleReference = async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError('');
    setStyleReference({
      id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${file.name}`,
      name: file.name,
      base64: await readAsDataUrl(file),
    });
  };

  const addVideos = async event => {
    const files = Array.from(event.target.files || []).slice(0, Math.max(0, 4 - videos.length));
    event.target.value = '';
    if (!files.length) return;
    const inspected = await Promise.all(files.map(async file => ({ file, duration: await getVideoDuration(file) })));
    const tooLong = inspected.find(item => item.duration > MAX_VIDEO_DURATION_SECONDS + 0.05);
    if (tooLong) {
      setError(`“${tooLong.file.name}”超过 ${MAX_VIDEO_DURATION_SECONDS} 秒，请先裁剪后再上传。`);
      return;
    }
    setError('');
    setVideos(current => [...current, ...inspected.map(item => ({
      id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${item.file.name}`,
      name: item.file.name,
      file: item.file,
      duration: item.duration,
    }))].slice(0, 4));
  };

  const submit = async () => {
    const instruction = prompt.trim();
    if (!instruction) {
      setError('请先描述你想制作的内容。');
      return;
    }
    if (mode === 'video' && videos.length === 0) {
      setError(`请先上传至少一个 ${MAX_VIDEO_DURATION_SECONDS} 秒以内的视频素材。`);
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      if (mode === 'video') {
        onQuickToolClick?.('video_edit', { instruction, sourceFiles: videos.map(item => item.file) });
      } else {
        await onDirectAgentStart?.(instruction, productImages[0] || null, {
          productImages,
          styleReference,
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const attachments = mode === 'video' ? videos : [
    ...productImages.map(item => ({ ...item, kind: '商品图' })),
    ...(styleReference ? [{ ...styleReference, kind: '风格参考' }] : []),
  ];

  return (
    <motion.main
      className="portal-container portal-home"
      initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: shouldReduceMotion ? 0.1 : 0.2, ease: [0.22, 1, 0.36, 1] }}
    >
      <section className="portal-home-inner" aria-labelledby="portal-title">
        <div className="portal-kicker">AI 商品创作 Agent</div>
        <h1 id="portal-title">今天想为哪个商品做设计？</h1>
        <p className="portal-subtitle">上传商品素材并说出目标，Agent 会理解商品、规划内容并完成创作。</p>

        <div className="portal-composer">
          <textarea
            value={prompt}
            onChange={event => setPrompt(event.target.value)}
            onKeyDown={event => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') submit();
            }}
            placeholder={mode === 'product'
              ? '例如：为这款保温杯制作自然户外风格的主图、卖点图和详情图…'
              : '例如：提取商品最清晰的镜头，剪成节奏紧凑的 9:16 信息流视频…'}
            aria-label="描述商品设计需求"
          />

          <AnimatePresence initial={false}>
          {attachments.length > 0 && (
            <motion.div className="portal-attachments" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <AnimatePresence initial={false} mode="popLayout">
              {attachments.map(item => (
                <motion.div
                  layout
                  className="portal-attachment"
                  key={item.id}
                  initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 4, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -3, scale: 0.97 }}
                  transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                >
                  {item.base64
                    ? <img src={item.base64} alt="" />
                    : <span className="portal-video-thumb"><Film size={18} /></span>}
                  <span><b>{item.kind || '视频'}</b>{item.name}</span>
                  <button type="button" aria-label={`移除 ${item.name}`} onClick={() => {
                    if (item.kind === '风格参考') setStyleReference(null);
                    else if (mode === 'video') setVideos(current => current.filter(file => file.id !== item.id));
                    else setProductImages(current => current.filter(image => image.id !== item.id));
                  }}><X size={13} /></button>
                </motion.div>
              ))}
              </AnimatePresence>
            </motion.div>
          )}
          </AnimatePresence>

          <div className="portal-composer-actions">
            <div className="portal-composer-tools">
              <button type="button" className="portal-icon-button" onClick={() => (mode === 'video' ? videoInputRef : productInputRef).current?.click()} title="上传素材">
                <Plus size={19} />
              </button>
              <button type="button" className="portal-mode-button" onClick={() => setMode(current => current === 'product' ? 'video' : 'product')}>
                {mode === 'product' ? <ImageIcon size={16} /> : <Film size={16} />}
                {mode === 'product' ? '商品图' : '智能剪辑'}
                <ChevronDown size={14} />
              </button>
              {mode === 'product' && (
                <>
                  <button type="button" className="portal-tool-button" onClick={() => productInputRef.current?.click()}><Paperclip size={15} />商品素材</button>
                  <button type="button" className={`portal-tool-button ${styleReference ? 'active' : ''}`} onClick={() => styleInputRef.current?.click()}><Palette size={15} />风格参考</button>
                </>
              )}
              {mode === 'video' && <button type="button" className="portal-tool-button" onClick={() => videoInputRef.current?.click()}><Film size={15} />视频素材 · 最长60秒</button>}
            </div>
            <button type="button" className="portal-submit" disabled={submitting || !prompt.trim()} onClick={submit} aria-label="发送需求">
              <ArrowUp size={19} />
            </button>
          </div>
        </div>

        {error && <div className="portal-error" role="alert">{error}</div>}
        <div className="portal-suggestions" aria-label="快捷需求">
          {SUGGESTIONS.map(suggestion => (
            <button type="button" key={suggestion} onClick={() => setPrompt(suggestion)}>{suggestion}</button>
          ))}
        </div>

        <input ref={productInputRef} hidden type="file" multiple accept="image/*" onChange={addProductImages} />
        <input ref={styleInputRef} hidden type="file" accept="image/*" onChange={addStyleReference} />
        <input ref={videoInputRef} hidden type="file" multiple accept="video/mp4,video/quicktime,video/webm" onChange={addVideos} />
      </section>
    </motion.main>
  );
}
