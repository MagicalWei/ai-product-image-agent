// src/components/ToolsPanel.jsx
import React, { useState, useRef } from 'react';
import { ShoppingBag, Scissors, BookOpen, Eye, Award, Video, Layers, ImageIcon, Cpu, RefreshCw, Check, UploadCloud, Download, Compass, Copy } from 'lucide-react';

// Helper to perform chroma-key / flood-fill background removal on a canvas
const removeBackgroundBFS = (imgElement) => {
  const canvas = document.createElement('canvas');
  canvas.width = imgElement.naturalWidth || imgElement.width;
  canvas.height = imgElement.naturalHeight || imgElement.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(imgElement, 0, 0);

  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imgData.data;
  const width = canvas.width;
  const height = canvas.height;

  const getPixel = (x, y) => {
    const idx = (y * width + x) * 4;
    return {
      r: data[idx],
      g: data[idx + 1],
      b: data[idx + 2],
      a: data[idx + 3]
    };
  };

  // 1. Sample 4 corners for adaptive background color detection
  const corners = [
    getPixel(0, 0),
    getPixel(width - 1, 0),
    getPixel(0, height - 1),
    getPixel(width - 1, height - 1)
  ];
  
  const sumColor = corners.reduce((acc, c) => {
    acc.r += c.r;
    acc.g += c.g;
    acc.b += c.b;
    return acc;
  }, { r: 0, g: 0, b: 0 });
  
  const bgR = Math.round(sumColor.r / 4);
  const bgG = Math.round(sumColor.g / 4);
  const bgB = Math.round(sumColor.b / 4);

  const lowThreshold = 20;
  const highThreshold = 65;

  // 2. Flood fill (BFS) starting from all borders
  const visited = new Uint8Array(width * height);
  const queue = [];

  const checkAndAdd = (x, y) => {
    const idx = y * width + x;
    if (!visited[idx]) {
      const px = getPixel(x, y);
      const dist = Math.sqrt((px.r - bgR) ** 2 + (px.g - bgG) ** 2 + (px.b - bgB) ** 2);
      if (dist < highThreshold) {
        visited[idx] = 1;
        queue.push(idx);
      }
    }
  };

  for (let x = 0; x < width; x++) {
    checkAndAdd(x, 0);
    checkAndAdd(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    checkAndAdd(0, y);
    checkAndAdd(width - 1, y);
  }

  let head = 0;
  const dx = [0, 0, 1, -1];
  const dy = [1, -1, 0, 0];

  while (head < queue.length) {
    const curr = queue[head++];
    const cx = curr % width;
    const cy = Math.floor(curr / width);

    for (let i = 0; i < 4; i++) {
      const nx = cx + dx[i];
      const ny = cy + dy[i];

      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const nidx = ny * width + nx;
        if (!visited[nidx]) {
          const px = getPixel(nx, ny);
          const dist = Math.sqrt((px.r - bgR) ** 2 + (px.g - bgG) ** 2 + (px.b - bgB) ** 2);
          if (dist < highThreshold) {
            visited[nidx] = 1;
            queue.push(nidx);
          }
        }
      }
    }
  }

  // 3. Process image data
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (visited[idx]) {
        const dataIdx = idx * 4;
        const r = data[dataIdx];
        const g = data[dataIdx + 1];
        const b = data[dataIdx + 2];
        
        const dist = Math.sqrt((r - bgR) ** 2 + (g - bgG) ** 2 + (b - bgB) ** 2);
        
        if (dist < lowThreshold) {
          data[dataIdx + 3] = 0;
        } else {
          const alphaFactor = (dist - lowThreshold) / (highThreshold - lowThreshold);
          const newAlpha = Math.round(255 * alphaFactor);
          data[dataIdx + 3] = Math.min(data[dataIdx + 3], newAlpha);
        }
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL('image/png');
};

const runBackgroundRemoval = (imgSrc) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = imgSrc;
    img.onload = () => {
      try {
        const result = removeBackgroundBFS(img);
        resolve(result);
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = (err) => reject(err);
  });
};

export default function ToolsPanel({ currentVersion }) {
  const [activeTool, setActiveTool] = useState('cut'); // 'cut' | 'clear' | 'detail' | 'set' | 'copy'
  const [processState, setProcessState] = useState('idle'); // 'idle' | 'processing' | 'success'
  const [selectedCutImg, setSelectedCutImg] = useState(null);
  const [cutoutResult, setCutoutResult] = useState(null);

  // Interactive Tools state
  const [detailCategory, setDetailCategory] = useState('');
  const [detailSellingPoints, setDetailSellingPoints] = useState('');
  const [detailStyle, setDetailStyle] = useState('经典杂志风');

  const [selectedRatios, setSelectedRatios] = useState(['1:1', '3:4']);
  const [setAmbient, setSetAmbient] = useState('现代都市橱窗');

  const [copyPrompt, setCopyPrompt] = useState('');

  // Direction Prompt states
  const [directionImage, setDirectionImage] = useState(null);
  const [directionComposition, setDirectionComposition] = useState('centered');
  const [directionOrientation, setDirectionOrientation] = useState('');
  const [directionImgRatio, setDirectionImgRatio] = useState(1);
  const [reconstructedPromptResult, setReconstructedPromptResult] = useState('');
  const directionPromptFileInputRef = useRef(null);

  React.useEffect(() => {
    if (!directionImage) return;
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || 1;
      const h = img.naturalHeight || 1;
      const ratio = w / h;
      setDirectionImgRatio(ratio);
      let orientationText = '方形比例 1:1';
      if (ratio > 1.15) {
        orientationText = `横向比例 ${w}:${h}`;
      } else if (ratio < 0.85) {
        orientationText = `纵向比例 ${w}:${h}`;
      }
      setDirectionOrientation(orientationText);
    };
    img.src = getImgSrc(directionImage);
  }, [directionImage]);

  const fileInputRef = useRef(null);

  const toolsList = [
    { id: 'cut', name: '智能抠图', icon: Scissors, desc: '发丝级抠图，自动生成透明背景商品图' },
    { id: 'direction-prompt', name: '图向反推提示词', icon: Compass, desc: '分析图片画幅方向与构图线条，智能生成最契合场景的创意生图描述' },
    { id: 'detail', name: 'A+/详情页', icon: BookOpen, desc: '根据商品图一键生成电商主图及详情页排版' },
    { id: 'set', name: '商品套图', icon: ShoppingBag, desc: '自动适配各大电商平台尺寸及背景图规范' },
    { id: 'copy', name: '爆款图复刻', icon: Layers, desc: '输入竞品链接，高保真仿制其构图与场景风格' },
  ];

  function getImgSrc(imgNameOrData) {
    if (!imgNameOrData) return '';
    if (imgNameOrData.startsWith('data:') || imgNameOrData.startsWith('blob:')) {
      return imgNameOrData;
    }
    return `assets/${imgNameOrData}`;
  }

  const handleRunTool = async () => {
    setProcessState('processing');
    if (activeTool === 'cut') {
      try {
        const src = getImgSrc(selectedCutImg);
        const result = await runBackgroundRemoval(src);
        setTimeout(() => {
          setCutoutResult(result);
          setProcessState('success');
        }, 1500);
      } catch (err) {
        console.error(err);
        setProcessState('idle');
        alert('抠图处理失败，请重试');
      }
    } else {
      setTimeout(() => {
        setProcessState('success');
      }, 2000);
    }
  };

  const resetTool = () => {
    setProcessState('idle');
    if (activeTool === 'cut') {
      setCutoutResult(null);
    } else if (activeTool === 'direction-prompt') {
      setReconstructedPromptResult('');
    }
  };

  const scanStyle = `
    @keyframes scan {
      0% { top: 0%; }
      50% { top: 100%; }
      100% { top: 0%; }
    }
  `;

  const handleCycleCutImage = () => {
    // Trigger file input to allow user upload instead of cycling mock data
    const input = document.getElementById('cut-image-upload');
    if (input) input.click();
  };

  const handleUploadImage = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      setSelectedCutImg(event.target.result);
      setCutoutResult(null);
      setProcessState('idle');
    };
    reader.readAsDataURL(file);
  };

  const handleUploadDirectionImage = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      setDirectionImage(event.target.result);
      setReconstructedPromptResult('');
      setProcessState('idle');
    };
    reader.readAsDataURL(file);
  };

  const handleRunDirectionPrompt = () => {
    setProcessState('processing');
    setTimeout(() => {
      let compositionName = '居中对称构图';
      if (directionComposition === 'rule_of_thirds') compositionName = '三分法则构图';
      else if (directionComposition === 'symmetry') compositionName = '镜像对称构图';
      else if (directionComposition === 'top_down') compositionName = '俯视平铺构图';

      const prompts = `[画面比例] ${directionOrientation}
[构图偏好] ${compositionName}
[智能构图分析] 画面主体结构稳固，利用线条将视觉重点聚焦于黄金分割位置，构图张力饱满，视角具有现代设计美感。

[AI生图提示词 (Prompt)]:
Professional studio product photography of a premium item, ${directionOrientation === '方形比例 1:1' ? '1:1 square aspect ratio' : directionOrientation.includes('纵向') ? 'vertical cinematic portrait format, 3:4 aspect ratio' : 'landscape wide aspect ratio, 16:9 format'}, ${directionComposition === 'centered' ? 'perfectly centered placement, central composition style' : directionComposition === 'rule_of_thirds' ? 'rule of thirds, dynamic off-center placement' : directionComposition === 'symmetry' ? 'perfect symmetric balance, reflection' : 'flat lay, top-down grid perspective'}, high end commercial lighting, soft ambient shadows, ultra sharp details, 8k resolution, photorealistic depth of field`;

      setReconstructedPromptResult(prompts);
      setProcessState('success');
    }, 1500);
  };

  const handleCycleDirectionImage = () => {
    // Trigger file input to allow user upload instead of cycling mock data
    if (directionPromptFileInputRef.current) directionPromptFileInputRef.current.click();
  };

  const handleDownload = () => {
    if (!cutoutResult) return;
    const link = document.createElement('a');
    link.href = cutoutResult;
    link.download = `cutout_${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getAmbientBg = (ambient) => {
    // Return a CSS gradient placeholder — real backgrounds are generated server-side
    switch (ambient) {
      case '夏日阳光海滩':
        return 'linear-gradient(135deg, #fde68a 0%, #fbbf24 40%, #3b82f6 100%)';
      case '法式落日庄园':
        return 'linear-gradient(135deg, #fcd34d 0%, #f97316 50%, #7c2d12 100%)';
      case '现代都市橱窗':
        return 'linear-gradient(135deg, #e0e7ff 0%, #818cf8 50%, #312e81 100%)';
      default:
        return 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)';
    }
  };

  return (
    <div className="tools-panel-container animate-fade-scale" style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '20px', height: 'calc(100vh - 110px)', padding: '10px 0' }}>
      <style>{scanStyle}</style>

      {/* Left List of Tools */}
      <div className="tools-sidebar glass-panel" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '6px', color: 'var(--on-surface)' }}>
          🛠️ 快捷工具箱
        </h3>
        {toolsList.map(t => {
          const Icon = t.icon;
          const isActive = activeTool === t.id;
          return (
            <div
              key={t.id}
              className={`tool-list-card glass-pane-interactive ${isActive ? 'active' : ''}`}
              style={{
                padding: '12px',
                borderRadius: '12px',
                cursor: 'pointer',
                border: isActive ? '1px solid var(--primary)' : '1px solid var(--border-glass)',
                background: isActive ? 'rgba(0, 88, 188, 0.05)' : 'rgba(255,255,255,0.4)',
                transition: 'all 0.2s ease'
              }}
              onClick={() => {
                setActiveTool(t.id);
                resetTool();
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontWeight: 600, fontSize: '0.85rem', color: isActive ? 'var(--primary)' : 'var(--on-surface)' }}>
                <Icon size={16} />
                <span>{t.name}</span>
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px', lineHeight: '1.3' }}>
                {t.desc}
              </div>
            </div>
          );
        })}
      </div>

      {/* Right Playground */}
      <div className="tools-playground glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', overflowY: 'auto' }}>
        
        {/* Header */}
        <div style={{ borderBottom: '1px solid var(--border-light)', paddingBottom: '12px' }}>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--on-surface)' }}>
            {toolsList.find(t => t.id === activeTool)?.name}
          </h2>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
            {toolsList.find(t => t.id === activeTool)?.desc}
          </p>
        </div>

        {/* Content Area */}
        <div style={{ flex: 1, display: 'flex', gap: '24px', alignItems: 'center', justifyContent: 'center' }}>
          {activeTool === 'cut' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center', width: '100%' }}>
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleUploadImage} 
                accept="image/*" 
                style={{ display: 'none' }} 
              />
              
              <div style={{ display: 'flex', gap: '30px', justifyContent: 'center', width: '100%', flexWrap: 'wrap' }}>
                {/* Before */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>原始图片 (Before)</span>
                  <div 
                    onClick={() => processState !== 'processing' && fileInputRef.current?.click()}
                    style={{ 
                      width: '220px', 
                      height: '220px', 
                      borderRadius: '12px', 
                      border: '1px dashed var(--border-glass)', 
                      overflow: 'hidden', 
                      background: '#ffffff', 
                      position: 'relative', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center',
                      cursor: processState === 'processing' ? 'default' : 'pointer',
                      transition: 'border-color 0.2s'
                    }}
                    title="点击上传本地自定义图片"
                  >
                    <img src={getImgSrc(selectedCutImg)} style={{ width: '85%', height: '85%', objectFit: 'contain' }} alt="original" />
                    <div style={{ position: 'absolute', bottom: '8px', right: '8px', background: 'rgba(0,0,0,0.5)', borderRadius: '50%', width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                      <UploadCloud size={12} />
                    </div>
                  </div>
                </div>

                {/* Arrow / Loading */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: '80px' }}>
                  {processState === 'processing' ? (
                    <RefreshCw size={24} className="logo-icon" style={{ animation: 'spin 1.5s infinite linear', color: 'var(--primary)' }} />
                  ) : (
                    <div style={{ width: '30px', height: '2px', background: 'var(--outline-variant)', position: 'relative' }}>
                      <div style={{ width: '6px', height: '6px', borderTop: '2px solid var(--outline)', borderRight: '2px solid var(--outline)', transform: 'rotate(45deg)', position: 'absolute', right: 0, top: '-2px' }}></div>
                    </div>
                  )}
                </div>

                {/* After */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>抠图结果 (After)</span>
                  <div 
                    style={{ 
                      width: '220px', 
                      height: '220px', 
                      borderRadius: '12px', 
                      border: '1px solid var(--border-glass)', 
                      overflow: 'hidden', 
                      position: 'relative', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center',
                      backgroundSize: '16px 16px', 
                      backgroundImage: 'linear-gradient(45deg, #eee 25%, transparent 25%, transparent 75%, #eee 75%, #eee), linear-gradient(45deg, #eee 25%, #fff 25%, #fff 75%, #eee 75%, #eee)', 
                      backgroundPosition: '0 0, 8px 8px'
                    }}
                  >
                    {processState === 'success' && cutoutResult ? (
                      <img src={cutoutResult} style={{ width: '85%', height: '85%', objectFit: 'contain', background: 'transparent' }} alt="processed" />
                    ) : processState === 'processing' ? (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                        <span>正在剔除背景...</span>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                        等待算法执行
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Controls */}
              <div style={{ display: 'flex', gap: '12px', marginTop: '10px' }}>
                <button 
                  className="settings-btn cancel" 
                  onClick={() => fileInputRef.current?.click()}
                  disabled={processState === 'processing'}
                  style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  <UploadCloud size={14} />
                  上传自定义图片
                </button>
                {processState !== 'success' ? (
                  <button className="settings-btn save" onClick={handleRunTool} disabled={processState === 'processing'}>
                    {processState === 'processing' ? '抠图算法执行中...' : '一键智能抠图'}
                  </button>
                ) : (
                  <>
                    <button className="settings-btn save" style={{ background: '#067a53' }} onClick={resetTool}>
                      <Check size={14} style={{ marginRight: '6px' }} />
                      已完成，重新抠图
                    </button>
                    <button 
                      className="settings-btn save" 
                      style={{ background: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '4px' }} 
                      onClick={handleDownload}
                    >
                      <Download size={14} />
                      下载抠图结果
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
          {activeTool === 'direction-prompt' && (
            <div style={{ display: 'flex', gap: '24px', width: '100%', height: '100%', alignItems: 'stretch' }}>
              {/* Left Settings Panel */}
              <div style={{ width: '300px', display: 'flex', flexDirection: 'column', gap: '16px', paddingRight: '20px', borderRight: '1px solid var(--border-light)' }}>
                
                {/* Upload Section */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>1. 上传参考商品图</label>
                  <input 
                    type="file" 
                    ref={directionPromptFileInputRef} 
                    onChange={handleUploadDirectionImage} 
                    accept="image/*" 
                    style={{ display: 'none' }} 
                  />
                  <div 
                    onClick={() => processState !== 'processing' && directionPromptFileInputRef.current?.click()}
                    style={{
                      height: directionImgRatio ? `${Math.round(Math.min(Math.max(280 / directionImgRatio, 120), 220))}px` : '140px',
                      borderRadius: '12px',
                      border: '1px dashed var(--border-glass)',
                      cursor: processState === 'processing' ? 'default' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      overflow: 'hidden',
                      position: 'relative',
                      background: 'var(--surface-container-low)',
                      transition: 'height 0.25s cubic-bezier(0.4, 0, 0.2, 1)'
                    }}
                    title="点击更换图片"
                  >
                    {directionImage ? (
                      <img src={getImgSrc(directionImage)} style={{ width: '100%', height: '100%', objectFit: 'contain' }} alt="direction reference" />
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', color: 'var(--text-muted)' }}>
                        <UploadCloud size={24} />
                        <span style={{ fontSize: '0.7rem', marginTop: '6px' }}>点击选择本地图片</span>
                      </div>
                    )}
                    <span style={{ position: 'absolute', bottom: '6px', right: '6px', background: 'rgba(0,0,0,0.5)', color: '#fff', fontSize: '0.6rem', padding: '2px 6px', borderRadius: '4px' }}>
                      更换图片
                    </span>
                  </div>
                  <button 
                    className="settings-btn cancel" 
                    style={{ width: '100%', fontSize: '0.75rem', padding: '6px 0', marginTop: '4px' }} 
                    onClick={handleCycleDirectionImage}
                    disabled={processState === 'processing'}
                  >
                    上传本地图片
                  </button>
                </div>

                {/* Aspect Ratio Detected Info */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>2. 智能识别画面方向</label>
                  <div style={{
                    padding: '8px 12px',
                    borderRadius: '8px',
                    background: 'var(--surface-container-high)',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    color: 'var(--primary)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}>
                    🧭 {directionOrientation || '正在检测中...'}
                  </div>
                </div>

                {/* Composition Preference Selector */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>3. 构图偏好选择</label>
                  <select
                    value={directionComposition}
                    onChange={(e) => setDirectionComposition(e.target.value)}
                    className="settings-input"
                    disabled={processState === 'processing'}
                    style={{ fontSize: '0.8rem', padding: '6px 10px' }}
                  >
                    <option value="centered">🎯 居中对称构图 (Centered / Symmetric)</option>
                    <option value="rule_of_thirds">📐 三分法则构图 (Rule of Thirds)</option>
                    <option value="symmetry">🪞 左右镜像构图 (Symmetry)</option>
                    <option value="top_down">🧇 俯视平铺构图 (Flat lay / Top-down)</option>
                  </select>
                </div>

                {/* Action Button */}
                <button 
                  className="settings-btn save" 
                  style={{ width: '100%', marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }} 
                  onClick={handleRunDirectionPrompt} 
                  disabled={processState === 'processing' || !directionImage}
                >
                  <Cpu size={14} />
                  {processState === 'processing' ? '正在反推提示词...' : '智能反推构图提示词'}
                </button>
              </div>

              {/* Right Output Panel */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '12px', justifyContent: 'stretch' }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--on-surface)' }}>反推提示词生成结果</label>
                
                {processState === 'processing' && (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', background: 'var(--surface-container-low)', borderRadius: '12px', border: '1px solid var(--border-glass)', minHeight: '220px' }}>
                    <div className="spinning" style={{ width: '28px', height: '28px', border: '3px solid var(--primary)', borderTopColor: 'transparent', borderRadius: '50%' }}></div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>构图线条反推与提示词重构中，请稍候...</span>
                  </div>
                )}

                {processState === 'success' && reconstructedPromptResult && (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ flex: 1, position: 'relative', minHeight: '220px' }}>
                      <textarea
                        readOnly
                        value={reconstructedPromptResult}
                        style={{
                          width: '100%',
                          height: '100%',
                          minHeight: '220px',
                          background: 'var(--surface-container-low)',
                          border: '1px solid var(--border-glass)',
                          borderRadius: '12px',
                          padding: '16px',
                          fontSize: '0.8rem',
                          fontFamily: 'monospace',
                          lineHeight: '1.5',
                          color: 'var(--on-surface)',
                          resize: 'none',
                          outline: 'none'
                        }}
                      />
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(reconstructedPromptResult);
                          alert('构图提示词已成功复制到剪贴板！');
                        }}
                        style={{
                          position: 'absolute',
                          top: '12px',
                          right: '12px',
                          background: 'var(--surface-container-high)',
                          border: '1px solid var(--border-glass)',
                          borderRadius: '6px',
                          padding: '6px 10px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          fontSize: '0.7rem',
                          fontWeight: 600,
                          color: 'var(--primary)'
                        }}
                        title="复制到剪贴板"
                      >
                        <Copy size={12} />
                        复制提示词
                      </button>
                    </div>

                    <div className="tip-box" style={{ background: 'var(--primary-container-low)', color: 'var(--primary)', padding: '10px 14px', borderRadius: '8px', fontSize: '0.7rem', border: '1px solid var(--primary-container)' }}>
                      💡 <strong>提示：</strong>本功能现为高保真前端界面，已具备图片方向（横版/竖版/方版）自动识别与构图选择响应。后续将直接接入视觉多模态大模型反推算法，为您生成更精确的创意构图提示词！
                    </div>
                  </div>
                )}

                {processState === 'idle' && (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px', background: 'var(--surface-container-low)', borderRadius: '12px', border: '1px dashed var(--border-glass)', color: 'var(--text-muted)', minHeight: '220px' }}>
                    <Compass size={36} style={{ opacity: 0.3 }} />
                    <span style={{ fontSize: '0.75rem' }}>在左侧上传图片并设置构图选项，点击按钮生成构图提示词</span>
                  </div>
                )}
              </div>
            </div>
          )}



          {activeTool === 'detail' && (
            <div style={{ display: 'flex', gap: '24px', width: '100%', height: '100%', alignItems: 'stretch' }}>
              {/* Left Settings Panel */}
              <div style={{ width: '280px', display: 'flex', flexDirection: 'column', gap: '12px', paddingRight: '20px', borderRight: '1px solid var(--border-light)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>商品品类</label>
                  <input
                    type="text"
                    value={detailCategory}
                    onChange={(e) => setDetailCategory(e.target.value)}
                    className="settings-input"
                    style={{ fontSize: '0.8rem', padding: '6px 10px' }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>核心卖点 (以 | 分隔)</label>
                  <input
                    type="text"
                    value={detailSellingPoints}
                    onChange={(e) => setDetailSellingPoints(e.target.value)}
                    className="settings-input"
                    style={{ fontSize: '0.8rem', padding: '6px 10px' }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>排版风格</label>
                  <select
                    value={detailStyle}
                    onChange={(e) => setDetailStyle(e.target.value)}
                    className="settings-input"
                    style={{ fontSize: '0.8rem', padding: '6px 10px' }}
                  >
                    <option value="经典杂志风">📖 经典杂志风</option>
                    <option value="现代极简风">✨ 现代极简风</option>
                    <option value="国潮复古风">🏮 国潮复古风</option>
                  </select>
                </div>
                <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {processState !== 'success' ? (
                    <button className="settings-btn save" style={{ width: '100%' }} onClick={handleRunTool} disabled={processState === 'processing'}>
                      {processState === 'processing' ? '详情排版计算中...' : '生成详情排版'}
                    </button>
                  ) : (
                    <button className="settings-btn save" style={{ width: '100%', background: '#067a53' }} onClick={resetTool}>
                      <Check size={14} style={{ marginRight: '6px' }} />
                      重置配置
                    </button>
                  )}
                </div>
              </div>

              {/* Right Output Panel */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.02)', borderRadius: '12px', padding: '20px', minHeight: '340px', overflowY: 'auto' }}>
                {processState === 'processing' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center' }}>
                    <RefreshCw size={28} className="logo-icon" style={{ animation: 'spin 1.5s infinite linear', color: 'var(--primary)' }} />
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>AI 详情主图排版引擎正在编排图文层次...</span>
                  </div>
                )}
                {processState === 'idle' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center', color: 'var(--text-muted)' }}>
                    <BookOpen size={40} style={{ opacity: 0.3 }} />
                    <span style={{ fontSize: '0.8rem' }}>设置左侧卖点和风格，一键排版生成高质视觉图</span>
                  </div>
                )}
                {processState === 'success' && (
                  <div className="glass-panel animate-fade-scale" style={{ width: '280px', height: '360px', background: '#fff', boxShadow: '0 10px 40px rgba(0,0,0,0.1)', overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative' }}>
                    {/* Header bar */}
                    <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--primary)', letterSpacing: '2px', textTransform: 'uppercase' }}>{detailStyle}</span>
                      <span style={{ fontSize: '0.55rem', padding: '2px 6px', background: 'rgba(0,88,188,0.1)', color: 'var(--primary)', borderRadius: '10px', fontWeight: 600 }}>A+ DETAIL</span>
                    </div>

                    {/* Image Area */}
                    <div style={{ 
                      flex: 1, 
                      position: 'relative', 
                      background: detailStyle === '现代极简风' 
                        ? 'linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)' 
                        : detailStyle === '国潮复古风'
                        ? 'linear-gradient(135deg, #fff0f0 0%, #ffe0e0 100%)'
                        : 'linear-gradient(135deg, #fffcf5 0%, #e9e4db 100%)', 
                      overflow: 'hidden',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}>
                      <div style={{ position: 'absolute', inset: 0, opacity: 0.08, background: 'radial-gradient(circle, var(--primary) 10%, transparent 11%)', backgroundSize: '16px 16px' }}></div>
                      
                      <img 
                        src={cutoutResult || getImgSrc(selectedCutImg)} 
                        style={{ 
                          width: '70%', 
                          height: '70%', 
                          objectFit: 'contain',
                          zIndex: 2,
                          filter: 'drop-shadow(0 10px 20px rgba(0,0,0,0.15))'
                        }} 
                        alt="detail product" 
                      />

                      {/* Product Name overlay */}
                      <div style={{ 
                        position: 'absolute', 
                        bottom: '12px', 
                        left: '12px', 
                        right: '12px', 
                        zIndex: 10, 
                        background: 'rgba(255,255,255,0.92)', 
                        backdropFilter: 'blur(8px)', 
                        padding: '8px 12px', 
                        borderRadius: '8px', 
                        border: '1px solid rgba(255,255,255,0.6)',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.08)'
                      }}>
                        <h4 style={{ fontSize: '0.75rem', fontWeight: 800, color: '#111', margin: 0 }}>{detailCategory}</h4>
                        <p style={{ fontSize: '0.55rem', color: '#666', margin: '2px 0 0 0' }}>AI 详情视觉排版系统自动合成</p>
                      </div>
                    </div>

                    {/* Selling points detail area */}
                    <div style={{ padding: '12px 16px', background: '#fafafa', borderTop: '1px solid #f0f0f0', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-secondary)' }}>💡 设计亮点与核心卖点</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {detailSellingPoints.split('|').map((sp, idx) => (
                          <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.65rem', color: '#333' }}>
                            <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: 'var(--primary)' }}></span>
                            <span>{sp.trim()}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTool === 'set' && (
            <div style={{ display: 'flex', gap: '24px', width: '100%', height: '100%', alignItems: 'stretch' }}>
              {/* Left Settings Panel */}
              <div style={{ width: '280px', display: 'flex', flexDirection: 'column', gap: '14px', paddingRight: '20px', borderRight: '1px solid var(--border-light)' }}>
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>适配尺寸比例</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {[
                      { id: '1:1', label: '1:1 淘宝方形主图' },
                      { id: '3:4', label: '3:4 小红书垂直图' },
                      { id: '9:16', label: '9:16 抖音竖屏主图' }
                    ].map(ratio => (
                      <label key={ratio.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.75rem', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={selectedRatios.includes(ratio.id)}
                          onChange={() => {
                            if (selectedRatios.includes(ratio.id)) {
                              setSelectedRatios(selectedRatios.filter(r => r !== ratio.id));
                            } else {
                              setSelectedRatios([...selectedRatios, ratio.id]);
                            }
                          }}
                        />
                        <span>{ratio.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>场景氛围</label>
                  <select
                    value={setAmbient}
                    onChange={(e) => setSetAmbient(e.target.value)}
                    className="settings-input"
                    style={{ fontSize: '0.8rem', padding: '6px 10px' }}
                  >
                    <option value="夏日阳光海滩">🌊 夏日阳光海滩</option>
                    <option value="法式落日庄园">🏰 法式落日庄园</option>
                    <option value="现代都市橱窗">🏢 现代都市橱窗</option>
                  </select>
                </div>

                <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {processState !== 'success' ? (
                    <button className="settings-btn save" style={{ width: '100%' }} onClick={handleRunTool} disabled={processState === 'processing' || selectedRatios.length === 0}>
                      {processState === 'processing' ? '分发合成计算中...' : '一键生成分发套图'}
                    </button>
                  ) : (
                    <button className="settings-btn save" style={{ width: '100%', background: '#067a53' }} onClick={resetTool}>
                      <Check size={14} style={{ marginRight: '6px' }} />
                      重新适配生成
                    </button>
                  )}
                </div>
              </div>

              {/* Right Output Panel */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.02)', borderRadius: '12px', padding: '20px', minHeight: '340px', overflowY: 'auto' }}>
                {processState === 'processing' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center' }}>
                    <RefreshCw size={28} className="logo-icon" style={{ animation: 'spin 1.5s infinite linear', color: 'var(--primary)' }} />
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>AI 套图分发模块正按比例重新裁剪与融光合图中...</span>
                  </div>
                )}
                {processState === 'idle' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center', color: 'var(--text-muted)' }}>
                    <ShoppingBag size={40} style={{ opacity: 0.3 }} />
                    <span style={{ fontSize: '0.8rem' }}>选择尺寸与场景氛围，批量分发合成精美商品主图套图</span>
                  </div>
                )}
                {processState === 'success' && (
                  <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', justifyContent: 'center', width: '100%' }} className="animate-fade-scale">
                    {selectedRatios.includes('1:1') && (
                      <div className="glass-panel" style={{ padding: '8px', background: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--text-secondary)' }}>1:1 淘宝主图</span>
                        <div style={{ position: 'relative', width: '120px', height: '120px', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border-glass)' }}>
                          <div style={{ width: '100%', height: '100%', background: getAmbientBg(setAmbient) }} />
                          <img 
                            src={cutoutResult || getImgSrc(selectedCutImg)} 
                            style={{ 
                              position: 'absolute', 
                              top: '50%', 
                              left: '50%', 
                              transform: 'translate(-50%, -42%)', 
                              width: '75%', 
                              height: '75%', 
                              objectFit: 'contain',
                              filter: 'drop-shadow(0 6px 12px rgba(0,0,0,0.22))' 
                            }} 
                            alt="1:1 product" 
                          />
                        </div>
                      </div>
                    )}
                    {selectedRatios.includes('3:4') && (
                      <div className="glass-panel" style={{ padding: '8px', background: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--text-secondary)' }}>3:4 小红书图</span>
                        <div style={{ position: 'relative', width: '120px', height: '160px', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border-glass)' }}>
                          <div style={{ width: '100%', height: '100%', background: getAmbientBg(setAmbient) }} />
                          <img 
                            src={cutoutResult || getImgSrc(selectedCutImg)} 
                            style={{ 
                              position: 'absolute', 
                              top: '50%', 
                              left: '50%', 
                              transform: 'translate(-50%, -42%)', 
                              width: '75%', 
                              height: '75%', 
                              objectFit: 'contain',
                              filter: 'drop-shadow(0 8px 16px rgba(0,0,0,0.22))' 
                            }} 
                            alt="3:4 product" 
                          />
                        </div>
                      </div>
                    )}
                    {selectedRatios.includes('9:16') && (
                      <div className="glass-panel" style={{ padding: '8px', background: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--text-secondary)' }}>9:16 抖音图</span>
                        <div style={{ position: 'relative', width: '100px', height: '177px', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border-glass)' }}>
                          <div style={{ width: '100%', height: '100%', background: getAmbientBg(setAmbient) }} />
                          <img 
                            src={cutoutResult || getImgSrc(selectedCutImg)} 
                            style={{ 
                              position: 'absolute', 
                              top: '50%', 
                              left: '50%', 
                              transform: 'translate(-50%, -42%)', 
                              width: '75%', 
                              height: '75%', 
                              objectFit: 'contain',
                              filter: 'drop-shadow(0 8px 16px rgba(0,0,0,0.22))' 
                            }} 
                            alt="9:16 product" 
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
 
          {activeTool === 'copy' && (
            <div style={{ display: 'flex', gap: '24px', width: '100%', height: '100%', alignItems: 'stretch' }}>
              {/* Left Settings Panel */}
              <div style={{ width: '280px', display: 'flex', flexDirection: 'column', gap: '12px', paddingRight: '20px', borderRight: '1px solid var(--border-light)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>竞品参考底图</label>
                  <div style={{ height: '80px', borderRadius: '8px', border: '1px dashed var(--border-glass)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'oklch(0 0 0 / 0.03)', cursor: 'pointer', overflow: 'hidden' }}>
                    <ImageIcon size={24} style={{ opacity: 0.2 }} />
                  </div>
                  <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textAlign: 'center' }}>请上传竞品参考图</span>
                </div>
 
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>仿写风格提示词</label>
                  <textarea
                    rows={2}
                    value={copyPrompt}
                    onChange={(e) => setCopyPrompt(e.target.value)}
                    className="settings-input"
                    style={{ fontSize: '0.8rem', padding: '6px 10px', resize: 'none' }}
                  />
                </div>
 
                <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {processState !== 'success' ? (
                    <button className="settings-btn save" style={{ width: '100%' }} onClick={handleRunTool} disabled={processState === 'processing'}>
                      {processState === 'processing' ? '复刻深度提取中...' : '启动爆款风格复刻'}
                    </button>
                  ) : (
                    <button className="settings-btn save" style={{ width: '100%', background: '#067a53' }} onClick={resetTool}>
                      <Check size={14} style={{ marginRight: '6px' }} />
                      重新复刻
                    </button>
                  )}
                </div>
              </div>
 
              {/* Right Output Panel */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.02)', borderRadius: '12px', padding: '20px', minHeight: '340px', overflowY: 'auto' }}>
                {processState === 'processing' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center', width: '100%' }}>
                    {/* Scanning animation */}
                    <div style={{ position: 'relative', width: '220px', height: '220px', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border-glass)', background: 'oklch(0 0 0 / 0.03)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Cpu size={36} style={{ opacity: 0.15 }} />
                      <div className="scanning-line" style={{ position: 'absolute', left: 0, right: 0, height: '3px', background: 'var(--primary)', boxShadow: '0 0 10px var(--primary)', animation: 'scan 1.5s infinite ease-in-out' }}></div>
                    </div>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>AI 正在反推构图线条、透视及光影调色参数...</span>
                  </div>
                )}
                {processState === 'idle' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center', color: 'var(--text-muted)' }}>
                    <Layers size={40} style={{ opacity: 0.3 }} />
                    <span style={{ fontSize: '0.8rem' }}>设置左侧竞品底图与风格词，高保真克隆其排版光影</span>
                  </div>
                )}
                {processState === 'success' && (
                  <div style={{ display: 'flex', gap: '20px', alignItems: 'center', justifyContent: 'center', width: '100%' }} className="animate-fade-scale">
                    {/* Left: Competitor */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--text-secondary)' }}>竞品参考原图</span>
                      <div style={{ width: '160px', height: '160px', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border-glass)', background: 'oklch(0 0 0 / 0.03)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <ImageIcon size={28} style={{ opacity: 0.15 }} />
                      </div>
                    </div>
                    {/* Arrow */}
                    <span style={{ fontSize: '1.2rem', color: 'var(--text-muted)', fontWeight: 'bold' }}>➔</span>
                    {/* Right: Replicated */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--primary)' }}>AI 克隆复刻版</span>
                      <div style={{ 
                        position: 'relative',
                        width: '160px', 
                        height: '160px', 
                        borderRadius: '8px', 
                        overflow: 'hidden', 
                        border: '2px solid var(--primary)', 
                        boxShadow: '0 4px 15px rgba(0,88,188,0.15)' 
                      }}>
                        <div style={{ width: '100%', height: '100%', background: getAmbientBg('现代都市橱窗'), filter: 'brightness(1.05) saturate(1.1)' }} />
                        <img 
                          src={cutoutResult || getImgSrc(selectedCutImg)} 
                          style={{ 
                            position: 'absolute', 
                            top: '50%', 
                            left: '50%', 
                            transform: 'translate(-50%, -42%)', 
                            width: '75%', 
                            height: '75%', 
                            objectFit: 'contain',
                            filter: 'drop-shadow(0 8px 16px rgba(0,0,0,0.25)) sepia(0.08) brightness(1.03)' 
                          }} 
                          alt="replicated product" 
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
