import { useRef, useState } from 'react';
import {
  BookOpen, Compass, Copy, Download, Layers,
  Scissors, ShoppingBag, UploadCloud,
} from 'lucide-react';

const TOOL_DEFINITIONS = [
  { id: 'cut', name: '智能抠图', icon: Scissors, desc: '本地 AI 主体分割，结果自动保存到仓库并加入画布。', action: '上传图片并开始抠图' },
  { id: 'direction-prompt', name: '图向反推提示词', icon: Compass, desc: '多模态模型分析主体、构图、镜头、光线与色彩，输出中英文提示词。' },
  { id: 'detail', name: 'A+/详情页', icon: BookOpen, desc: '上传商品图和卖点，由 Agent 生成可编辑的纵向详情页图片。', action: '打开 A+/详情页生成器' },
  { id: 'set', name: '商品套图', icon: ShoppingBag, desc: '一次生成主图、卖点图和详情图，结果进入当前会话、画布与仓库。', action: '打开商品套图生成器' },
  { id: 'copy', name: '爆款图复刻', icon: Layers, desc: '分别上传风格参考图和新商品图，只迁移视觉语言，不复制品牌与原文案。', action: '打开爆款图复刻器' },
];

const TOOL_INSTRUCTIONS = {
  cut: '上传一张商品图，自动移除背景并将透明图加入画布。',
  detail: '上传商品图，填写商品信息与卖点，生成纵向 A+/详情页。',
  set: '上传商品图并选择需要的图片类型，批量生成视觉统一的套图。',
  copy: '上传一张风格参考图和一张新商品图，生成主图、卖点图和详情图。',
};

const fileToDataUrl = file => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error('图片读取失败'));
  reader.readAsDataURL(file);
});

const downloadText = (content, name) => {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  URL.revokeObjectURL(url);
};

const formatReverseResult = result => [
  `推荐比例：${result.recommended_ratio}`,
  `主体：${result.subject}`,
  `构图：${result.composition}`,
  `镜头：${result.camera}`,
  `光线：${result.lighting}`,
  `配色：${result.color_palette?.join('、') || ''}`,
  `背景：${result.background}`,
  `排版：${result.typography}`,
  '', '中文 Prompt：', result.prompt_cn,
  '', 'English Prompt:', result.prompt_en,
  '', 'Negative Prompt:', result.negative_prompt,
  '', '可见证据：', ...(result.visible_evidence || []).map(item => `- ${item}`),
  '', '无法确认：', ...(result.uncertain_elements || []).map(item => `- ${item}`),
].join('\n');

export default function ToolsPanel({ onLaunchTool, onSaveAsset, onError, onSuccess }) {
  const [activeTool, setActiveTool] = useState('cut');
  const [directionImage, setDirectionImage] = useState('');
  const [directionFile, setDirectionFile] = useState(null);
  const [composition, setComposition] = useState('auto');
  const [reverseResult, setReverseResult] = useState(null);
  const [reverseText, setReverseText] = useState('');
  const [processing, setProcessing] = useState(false);
  const directionInputRef = useRef(null);
  const active = TOOL_DEFINITIONS.find(tool => tool.id === activeTool) || TOOL_DEFINITIONS[0];
  const ActiveIcon = active.icon;

  const chooseDirectionImage = async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return onError?.('仅支持 JPG、PNG、WEBP 图片');
    if (file.size > 10 * 1024 * 1024) return onError?.('图片不能超过 10MB');
    try {
      setDirectionImage(await fileToDataUrl(file));
      setDirectionFile(file); setReverseResult(null); setReverseText('');
    } catch (error) { onError?.(error.message); }
  };

  const reversePrompt = async () => {
    if (!directionImage || processing) return;
    setProcessing(true); setReverseResult(null);
    try {
      const response = await fetch('/api/agent/tools/reverse-image-prompt', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_base64: directionImage, composition_preference: composition }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || data.detail || '图片提示词反推失败');
      setReverseResult(data.reverse_prompt);
      setReverseText(formatReverseResult(data.reverse_prompt));
      if (directionFile && onSaveAsset) {
        await onSaveAsset(directionFile.name, directionImage, 'prompt_reference');
      }
      onSuccess?.('图片分析完成，已生成可编辑提示词');
    } catch (error) { onError?.(error.message); }
    finally { setProcessing(false); }
  };

  return <main style={{ display: 'grid', gridTemplateColumns: '310px minmax(0,1fr)', gap: 18, minHeight: 'calc(100vh - 110px)', padding: '10px 0 24px' }}>
    <aside className="glass-panel" style={{ padding: 15, alignSelf: 'start' }}>
      <h2 style={{ fontSize: 16, margin: '0 0 5px' }}>快捷工具箱</h2>
      <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: '0 0 13px' }}>所有工具均连接真实算法或 Agent 工作流</p>
      <div style={{ display: 'grid', gap: 8 }}>
        {TOOL_DEFINITIONS.map(tool => {
          const Icon = tool.icon; const selected = activeTool === tool.id;
          return <button key={tool.id} onClick={() => setActiveTool(tool.id)} style={{ textAlign: 'left', padding: 12, borderRadius: 11, cursor: 'pointer', border: selected ? '1px solid var(--primary)' : '1px solid var(--outline-variant)', background: selected ? 'var(--primary-container-low)' : 'var(--surface-container-lowest)', color: 'var(--on-surface)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13 }}><span aria-hidden="true" style={{ width: 20, height: 20, display: 'grid', placeItems: 'center', flex: '0 0 20px', lineHeight: 0 }}><Icon size={16} style={{ display: 'block' }} /></span>{tool.name}</span>
            <span style={{ display: 'block', marginTop: 5, fontSize: 10, lineHeight: 1.5, color: 'var(--text-secondary)' }}>{tool.desc}</span>
          </button>;
        })}
      </div>
    </aside>

    <section className="glass-panel" style={{ padding: 22, minHeight: 520 }}>
      <header style={{ paddingBottom: 14, borderBottom: '1px solid var(--outline-variant)' }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>{active.name}</h1>
        <p style={{ margin: '5px 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>{active.desc}</p>
      </header>

      {activeTool !== 'direction-prompt' ? <div style={{ minHeight: 410, display: 'grid', placeItems: 'center' }}>
        <div style={{ maxWidth: 520, textAlign: 'center' }}>
          <span aria-hidden="true" style={{ width: 64, height: 64, display: 'grid', placeItems: 'center', margin: '0 auto 12px', color: 'var(--primary)', lineHeight: 0 }}><ActiveIcon size={52} style={{ display: 'block' }} /></span>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.7, margin: '0 0 20px' }}>{TOOL_INSTRUCTIONS[activeTool]}</p>
          <button className="settings-btn save" onClick={() => onLaunchTool?.(activeTool)}>{active.action}</button>
        </div>
      </div> : <div style={{ display: 'grid', gridTemplateColumns: '300px minmax(0,1fr)', gap: 20, paddingTop: 18 }}>
        <div>
          <input ref={directionInputRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={chooseDirectionImage} />
          <button onClick={() => directionInputRef.current?.click()} style={{ width: '100%', height: 230, border: '1px dashed var(--outline-variant)', borderRadius: 13, cursor: 'pointer', overflow: 'hidden', background: 'var(--surface-container-low)', color: 'var(--text-secondary)' }}>
            {directionImage ? <img src={directionImage} alt="反推参考图" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span><UploadCloud size={30} /><br />上传参考图片<br /><small>JPG / PNG / WEBP，最大 10MB</small></span>}
          </button>
          <label className="settings-label" style={{ marginTop: 13 }}>构图偏好
            <select className="settings-select" value={composition} onChange={event => setComposition(event.target.value)}>
              <option value="auto">自动识别</option><option value="centered">居中对称</option><option value="rule_of_thirds">三分法</option><option value="top_down">俯拍平铺</option><option value="dynamic">动态斜线构图</option>
            </select>
          </label>
          <button className="settings-btn save" disabled={!directionImage || processing} onClick={reversePrompt} style={{ marginTop: 13, width: '100%', justifyContent: 'center' }}><Compass size={15} />{processing ? '多模态模型分析中…' : '开始反推提示词'}</button>
        </div>
        <div style={{ minHeight: 410, border: '1px solid var(--outline-variant)', borderRadius: 13, background: 'var(--surface-container-low)', padding: 15 }}>
          {!reverseResult ? <div style={{ height: '100%', display: 'grid', placeItems: 'center', textAlign: 'center', color: 'var(--text-secondary)', fontSize: 12 }}>{processing ? '正在识别可见主体、构图、光线、色彩和排版…' : '分析结果会显示在这里，并明确区分可见证据与无法确认的信息。'}</div> : <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}><strong>反推结果 · {reverseResult.recommended_ratio}</strong><div style={{ display: 'flex', gap: 6 }}><button className="settings-btn cancel" onClick={async () => { await navigator.clipboard.writeText(reverseText); onSuccess?.('提示词已复制'); }}><Copy size={13} />复制</button><button className="settings-btn cancel" onClick={() => downloadText(reverseText, `反推提示词_${Date.now()}.txt`)}><Download size={13} />下载</button></div></div>
            <textarea value={reverseText} onChange={event => setReverseText(event.target.value)} style={{ width: '100%', minHeight: 365, resize: 'vertical', border: 0, outline: 0, background: 'transparent', color: 'var(--on-surface)', lineHeight: 1.6, fontSize: 12 }} />
          </>}
        </div>
      </div>}
    </section>
  </main>;
}
