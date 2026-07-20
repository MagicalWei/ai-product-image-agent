// src/components/Onboarding.jsx
import { useState, useEffect } from 'react';
import { Cpu, ShoppingBag, Tag, Image as ImageIcon, Upload, CheckCircle2, FolderHeart } from 'lucide-react';
import CloseButton from './CloseButton';
import { useApp } from '../context/AppContext';
import { AnimatePresence, motion } from 'motion/react';

const VISUAL_STYLES = [
  { id: 'french_vintage', name: '法式复古风格', description: '暖金逆光、法式庄园、优雅慵懒' },
  { id: 'outdoor_sunlight', name: '户外阳光风格', description: '海滩假日、自然日光、开朗松弛' },
  { id: 'urban_minimalist', name: '都市极简风格', description: '冷淡白领、纯色背景、西装干练' },
  { id: 'minimalist_white', name: '极简白底风格', description: '经典电商画册、白底平铺' },
];

export default function Onboarding({ onSubmit, onClose, initialValues, currentUser, uploadedAssets = [] }) {
  const { autoCutout } = useApp();
  const [name, setName] = useState('');
  const [sellingPoints, setSellingPoints] = useState('');
  const [selectedStyle, setSelectedStyle] = useState('french_vintage');
  const [autoCutoutOnboard, setAutoCutoutOnboard] = useState(autoCutout);

  // Custom Product Upload States
  const [uploadType, setUploadType] = useState('custom');
  const [customImage, setCustomImage] = useState(null);
  const [customFileName, setCustomFileName] = useState('');
  const [selectedGalleryAsset, setSelectedGalleryAsset] = useState(null);
  const [isVisible, setIsVisible] = useState(true);
  const requestClose = () => setIsVisible(false);

  // Pre-fill initial values if sent from Portal command center
  useEffect(() => {
    if (initialValues) {
      if (initialValues.name) setName(initialValues.name);
      if (initialValues.sellingPoints) setSellingPoints(initialValues.sellingPoints);
      if (initialValues.styleId) setSelectedStyle(initialValues.styleId);
    }
  }, [initialValues]);

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setCustomFileName(file.name);
    const reader = new FileReader();
    reader.onloadend = () => {
      setCustomImage(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim() || !sellingPoints.trim()) return;

    let finalProductImage = '';
    let finalUploadType = uploadType;

    if (uploadType === 'custom') {
      if (!customImage) {
        alert('请上传商品图片！');
        return;
      }
      finalProductImage = customImage;
    } else {
      // Cloud Gallery
      if (!selectedGalleryAsset) {
        alert('请从您的云素材库点选一张图片！');
        return;
      }
      finalProductImage = selectedGalleryAsset.url;
      finalUploadType = 'custom';
    }

    onSubmit({
      name: name.trim(),
      sellingPoints: sellingPoints.trim(),
      styleId: selectedStyle,
      uploadType: finalUploadType,
      productImage: finalProductImage,
      autoCutout: autoCutoutOnboard
    });
  };

  const rawAssets = (uploadedAssets || []).filter(a => a.type === 'raw');

  return (
    <AnimatePresence onExitComplete={onClose}>
    {isVisible && <motion.div className="onboarding-modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
      <motion.div className="onboarding-modal-content" initial={{ opacity: 0, y: 8, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 5, scale: 0.99 }} transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }} style={{ maxWidth: '560px', width: '90%' }}>
        <CloseButton onClick={requestClose} />

        <div className="onboarding-header" style={{ marginBottom: '12px' }}>
          <div className="logo-section" style={{ justifyContent: 'center', marginBottom: '4px' }}>
            <Cpu className="logo-icon" size={24} />
            <h1 className="logo-text font-display gradient-text" style={{ fontSize: '1.4rem' }}>
              AI 电商商品图创作向导
            </h1>
          </div>
          <p className="onboarding-subtitle" style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            上传您的商品实拍图，AI将自动完成智能抠图与场景深度融合
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

          {/* Upload Method Selector */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" style={{ fontSize: '0.75rem', marginBottom: '6px' }}>
              <ImageIcon size={14} className="logo-icon" />
              商品图源设置 (Product Source)
            </label>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px', marginBottom: '10px' }}>
              <button
                type="button"
                className={`canvas-control-btn ${uploadType === 'custom' ? 'active' : ''}`}
                style={{ justifyContent: 'center', padding: '8px 0', fontSize: '0.75rem', borderRadius: '6px' }}
                onClick={() => {
                  setUploadType('custom');
                  setName('');
                  setSellingPoints('');
                  setCustomImage(null);
                  setCustomFileName('');
                }}
              >
                自定义上传照片
              </button>
              <button
                type="button"
                className={`canvas-control-btn ${uploadType === 'gallery' ? 'active' : ''}`}
                style={{ justifyContent: 'center', padding: '8px 0', fontSize: '0.75rem', borderRadius: '6px' }}
                onClick={() => {
                  setUploadType('gallery');
                  setName('');
                  setSellingPoints('');
                  setSelectedGalleryAsset(null);
                }}
              >
                从我的云端图库选择
              </button>
            </div>

            {/* Sub-panels based on selection */}
            {uploadType === 'custom' && (
              <div
                className="file-upload-zone"
                style={{
                  border: '2px dashed rgba(255,255,255,0.15)',
                  borderRadius: '8px',
                  padding: '16px',
                  textAlign: 'center',
                  background: 'rgba(255,255,255,0.02)',
                  cursor: 'pointer',
                  position: 'relative',
                  transition: 'all 0.2s'
                }}
                onMouseOver={(e) => e.currentTarget.style.borderColor = 'var(--primary)'}
                onMouseOut={(e) => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)'}
              >
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleFileUpload}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    opacity: 0,
                    cursor: 'pointer'
                  }}
                />
                {customImage ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                    <CheckCircle2 size={18} style={{ color: '#22c55e' }} />
                    <span style={{ fontSize: '0.75rem', color: '#22c55e', fontWeight: 600 }}>
                      上传成功: {customFileName.length > 20 ? customFileName.substring(0, 17) + '...' : customFileName}
                    </span>
                    <div style={{ width: '30px', height: '30px', borderRadius: '4px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.2)' }}>
                      <img src={customImage} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </div>
                  </div>
                ) : (
                  <div>
                    <Upload size={20} style={{ margin: '0 auto 6px', color: 'rgba(255,255,255,0.4)' }} />
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'rgba(255,255,255,0.8)' }}>点击或拖拽商品照片至此处</div>
                    <div style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.4)', marginTop: '2px' }}>建议采用纯色背景拍摄以获得最佳抠图效果</div>
                  </div>
                )}
              </div>
            )}

            {uploadType === 'gallery' && (
              <div
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  padding: '12px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255,255,255,0.06)',
                  minHeight: '84px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center'
                }}
              >
                {!currentUser ? (
                  <div style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                    <FolderHeart size={18} style={{ opacity: 0.5 }} />
                    <span>您尚未登录。请登录后查看您同步在云端的实拍商品图库。</span>
                  </div>
                ) : rawAssets.length === 0 ? (
                  <div style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                    <FolderHeart size={18} style={{ opacity: 0.5 }} />
                    <span>您的云图库中暂无素材。请先通过"自定义上传照片"上传实拍图。</span>
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', maxHeight: '110px', overflowY: 'auto', paddingRight: '4px' }}>
                    {rawAssets.map((asset) => (
                      <div
                        key={asset.id}
                        className={`style-card ${selectedGalleryAsset?.id === asset.id ? 'active' : ''}`}
                        onClick={() => {
                          setSelectedGalleryAsset(asset);
                          setName(asset.name.split('.')[0] || '自定义商品');
                          setSellingPoints('高保真面料细节、完美商业质感');
                        }}
                        style={{ padding: '6px 4px', textAlign: 'center', cursor: 'pointer' }}
                      >
                        <div style={{ width: '36px', height: '36px', margin: '0 auto 4px', borderRadius: '4px', overflow: 'hidden', background: '#fcfcfc', border: '1px solid rgba(0,0,0,0.05)' }}>
                          <img src={asset.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        </div>
                        <div
                          style={{ fontSize: '0.6rem', color: 'var(--on-surface)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                          title={asset.name}
                        >
                          {asset.name}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Product Name Input */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" style={{ fontSize: '0.75rem', marginBottom: '4px' }}>
              <ShoppingBag size={14} className="logo-icon" />
              商品名称 (Product Name)
            </label>
            <input
              type="text"
              className="form-input"
              style={{ padding: '8px 12px', fontSize: '0.85rem' }}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：黄金琥珀男士香水"
              required
            />
          </div>

          {/* Selling Points Input */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" style={{ fontSize: '0.75rem', marginBottom: '4px' }}>
              <Tag size={14} className="logo-icon" />
              核心卖点 (Selling Points)
            </label>
            <textarea
              className="form-textarea"
              style={{ padding: '8px 12px', fontSize: '0.85rem' }}
              value={sellingPoints}
              onChange={(e) => setSellingPoints(e.target.value)}
              placeholder="轻巧减震、奢华玻璃瓶身、法式香调"
              rows={2}
              required
            />
          </div>

          {/* Style Selector */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" style={{ fontSize: '0.75rem', marginBottom: '4px' }}>
              <ImageIcon size={14} className="logo-icon" />
              创意背景画风 (Visual Style)
            </label>
            <div className="style-selector-grid" style={{ gap: '8px' }}>
              {VISUAL_STYLES.map((style) => (
                <div
                  key={style.id}
                  className={`style-card ${selectedStyle === style.id ? 'active' : ''}`}
                  onClick={() => setSelectedStyle(style.id)}
                  style={{ padding: '8px 10px' }}
                >
                  <div className="style-name" style={{ fontSize: '0.8rem', fontWeight: 700 }}>{style.name}</div>
                  <div className="style-desc" style={{ fontSize: '0.65rem', opacity: 0.8 }}>{style.description}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Auto Cutout Option */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0', marginTop: '4px' }}>
            <input
              id="auto-cutout-checkbox"
              type="checkbox"
              checked={autoCutoutOnboard}
              onChange={(e) => setAutoCutoutOnboard(e.target.checked)}
              style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: 'var(--primary)' }}
            />
            <label
              htmlFor="auto-cutout-checkbox"
              style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--on-surface)', cursor: 'pointer', userSelect: 'none' }}
            >
              自动智能背景抠图 (Auto Background Cutout)
            </label>
          </div>

          <button
            type="submit"
            className="submit-btn gradient-bg"
            style={{ padding: '10px', fontSize: '0.9rem', margin: '4px 0 0', border: 'none', borderRadius: '6px' }}
          >
            启动 AI 抠图并生成商品图
          </button>
        </form>
      </motion.div>
    </motion.div>}
    </AnimatePresence>
  );
}
