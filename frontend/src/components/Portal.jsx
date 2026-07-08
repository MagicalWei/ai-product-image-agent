// src/components/Portal.jsx
import React, { useState, useRef } from 'react';
import { motion } from 'motion/react';
import {
  ShoppingBag, Scissors, BookOpen, Award, Video, Layers,
  Image as ImageIcon, Plus, Box, Lightbulb, ImagePlus, ChevronLeft, ChevronRight,
  Crown
} from 'lucide-react';

export default function Portal({ onStartOnboarding, onQuickToolClick, onDirectAgentStart, onImageUploaded, onOpenPricing }) {
  const [carouselIndex, setCarouselIndex] = useState(0);


  const quickTools = [
    { id: 'set', name: '商品套图', icon: ShoppingBag },
    { id: 'cut', name: '智能抠图', icon: Scissors },
    { id: 'detail', name: 'A+/详情页', icon: BookOpen },
    { id: 'cert', name: '证件照', icon: Award },
    { id: 'video_viral', name: '爆款视频', icon: Video },
    { id: 'copy', name: '爆款图复刻', icon: Layers },
    { id: 'ai_img', name: 'AI商品图', icon: ImageIcon },
  ];

  const fileInputRef = useRef(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [attachedImage, setAttachedImage] = useState(null);
  const [attachedDoc, setAttachedDoc] = useState(null);
  const attachInputRef = useRef(null);
  const docInputRef = useRef(null);
  const skillInputRef = useRef(null);

  const [showSkillModal, setShowSkillModal] = useState(false);
  const [customSkillApplied, setCustomSkillApplied] = useState(false);

  const [skillMdContent, setSkillMdContent] = useState('');

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files);
    if (files.length > 0) {
      handleFilesSelected(files);
    }
  };

  const handleFilesSelected = async (files) => {
    const list = [];
    for (let file of files) {
      const base64Url = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (re) => resolve(re.target.result);
        reader.readAsDataURL(file);
      });
      let urlToUse = base64Url;
      if (onImageUploaded) {
        try {
          const uploadedAsset = await onImageUploaded(file.name, base64Url, 'raw');
          if (uploadedAsset && uploadedAsset.url) {
            urlToUse = uploadedAsset.url;
          }
        } catch (e) {
          console.error("Failed to upload image during portal selection:", e);
        }
      }
      list.push({ name: file.name, base64: urlToUse });
    }
    onStartOnboarding({
      uploadType: 'custom',
      multipleImages: list
    });
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFilesSelected(files);
    }
  };

  const handleAttachClick = () => {
    attachInputRef.current?.click();
  };

  const handleAttachChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (readerEvent) => {
      setAttachedImage({
        name: file.name,
        base64: readerEvent.target.result
      });
    };
    reader.readAsDataURL(file);
  };

  const handleDocChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const sizeStr = file.size > 1024 * 1024
      ? (file.size / (1024 * 1024)).toFixed(2) + ' MB'
      : (file.size / 1024).toFixed(1) + ' KB';

    setAttachedDoc({
      name: file.name,
      size: sizeStr
    });
    e.target.value = '';
  };

  const handleSkillFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      setSkillMdContent(evt.target.result);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleSaveSkill = () => {
    setShowSkillModal(false);
    setCustomSkillApplied(true);
    try {
      localStorage.setItem('custom_skill_md', skillMdContent);
    } catch (err) {
      console.warn("Failed to save custom skill:", err);
    }
  };

  return (
    <div className="portal-container animate-fade-scale">

      {/* 3. Three-column Tool Grid */}
      <div className="tool-grid">
        {/* Col 1: Image Edit */}
        <div
          className={`tool-card glass-pane glass-pane-interactive ${isDragOver ? 'drag-over' : ''}`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          style={{
            border: isDragOver ? '2px dashed var(--primary)' : '1px solid var(--border-glass)',
            background: isDragOver ? 'rgba(0, 88, 188, 0.05)' : 'rgba(255, 255, 255, 0.02)',
            cursor: 'pointer'
          }}
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept="image/*"
            multiple
            style={{ display: 'none' }}
          />
          <div>
            <div className="tool-card-title">图片编辑</div>
            <div className="tool-card-desc">导入商品模版，智能替换商品与模特背景</div>
          </div>
          <div className="placeholder-box-glass">
            <div style={{ textAlign: 'center' }}>
              <ImagePlus size={32} style={{ opacity: 0.3, marginBottom: '8px' }} />
              <div style={{ fontSize: '0.75rem', opacity: 0.5 }}>点击导入或拖拽商品图</div>
            </div>
          </div>
        </div>

        {/* Col 2: Create Design */}
        <div className="tool-card glass-pane glass-pane-interactive" onClick={() => onStartOnboarding(null)}>
          <div>
            <div className="tool-card-title">创建设计</div>
            <div className="tool-card-desc">从空白画布自由设计定制化商品主图</div>
          </div>
          <div className="dashed-create-box">
            <Plus size={24} style={{ opacity: 0.6 }} />
          </div>
        </div>

        {/* Col 3: Quick Tool Icons Grid */}
        <div className="tool-card glass-pane">
          <div>
            <div className="tool-card-title">快捷工具</div>
            <div className="tool-card-desc">一键启动垂直创意小工具</div>
          </div>
          <div className="quick-tools-grid">
            {quickTools.map(tool => {
              const Icon = tool.icon;
              return (
                <div
                  key={tool.id}
                  className="quick-tool-item"
                  onClick={() => onQuickToolClick(tool.id)}
                >
                  <Icon size={18} className="quick-tool-icon" />
                  <span className="quick-tool-name">{tool.name}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Design Skill Modal */}
      {showSkillModal && (
        <div className="settings-modal-overlay" onClick={() => setShowSkillModal(false)} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 1050 }}>
          <div className="settings-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '540px', width: '90%' }}>
            <div className="settings-modal-header">
              <h3 className="settings-modal-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Lightbulb size={18} style={{ color: 'var(--primary)' }} />
                <span>AI 设计 Skill 配置中心</span>
              </h3>
              <button className="settings-close-btn" style={{ padding: '4px', height: 'auto', width: 'auto', border: 'none', background: 'none', fontSize: '1.5rem', cursor: 'pointer', color: 'var(--text-secondary)' }} onClick={() => setShowSkillModal(false)}>&times;</button>
            </div>

            <div className="settings-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '0 20px 20px 20px' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                通过加载自定义的 <strong>SKILL.md</strong> 设计规则，可以让 AI 视觉设计师、文案策划和排版引擎自动遵循您所设定的设计美学、比例构图与品牌文案风格。
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--on-surface)' }}>规则编辑器 (SKILL.md)</span>
                <button
                  type="button"
                  className="settings-btn cancel"
                  onClick={() => skillInputRef.current?.click()}
                  style={{
                    padding: '4px 10px',
                    fontSize: '0.7rem',
                    width: 'auto',
                    border: '1px solid var(--outline-variant)',
                    cursor: 'pointer'
                  }}
                >
                  📤 上传本地 SKILL.md
                </button>
              </div>

              <textarea
                value={skillMdContent}
                onChange={(e) => setSkillMdContent(e.target.value)}
                style={{
                  width: '100%',
                  height: '180px',
                  padding: '10px',
                  borderRadius: '8px',
                  border: '1px solid var(--outline-variant)',
                  background: 'var(--surface-container-low, rgba(0,0,0,0.02))',
                  color: 'var(--on-surface)',
                  fontFamily: 'monospace',
                  fontSize: '0.7rem',
                  lineHeight: '1.4',
                  resize: 'none'
                }}
                placeholder="# SKILL: 自定义设计规范\n..."
              />

              <div className="settings-actions" style={{ marginTop: '8px' }}>
                <button className="settings-btn cancel" type="button" onClick={() => setShowSkillModal(false)}>
                  取消
                </button>
                <button className="settings-btn save" type="button" onClick={handleSaveSkill}>
                  保存并应用此 Skill
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
