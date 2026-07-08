// src/components/LayersOutlinePanel.jsx
import React, { useState } from 'react';
import { Layers, ChevronDown, Minus, X, Image as ImageIcon, Box, Type, Tag, MessageSquare } from 'lucide-react';

export default function LayersOutlinePanel({ currentVersion, onInsertRef, onClose }) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  if (!currentVersion) return null;

  const layers = [
    {
      id: 'bg',
      name: '背景图层',
      desc: currentVersion.image ? currentVersion.image.replace('bg_', '').replace('.png', '') : '自然风格场景',
      icon: ImageIcon,
      displayName: '背景图层'
    },
    ...(currentVersion.productCutout || currentVersion.productImage ? [
      {
        id: 'product',
        name: '商品主体图层',
        desc: '抠图融合主体',
        icon: Box,
        displayName: '商品主体图层'
      }
    ] : []),
    ...(currentVersion.adText?.title ? [
      {
        id: 'title',
        name: '主标题文本图层',
        desc: currentVersion.adText.title,
        icon: Type,
        displayName: '主标题文本图层'
      }
    ] : []),
    ...(currentVersion.adText?.desc ? [
      {
        id: 'desc',
        name: '副标题文本图层',
        desc: currentVersion.adText.desc,
        icon: Type,
        displayName: '副标题文本图层'
      }
    ] : []),
    ...(currentVersion.adText?.tag ? [
      {
        id: 'tag',
        name: '促销标签图层',
        desc: currentVersion.adText.tag,
        icon: Tag,
        displayName: '促销标签图层'
      }
    ] : []),
  ];

  return (
    <div className={`layers-outline-floating-panel glass-pane animate-slide-left ${isCollapsed ? 'collapsed' : ''}`} onClick={(e) => e.stopPropagation()}>
      <div
        className="layers-panel-header"
        onClick={() => setIsCollapsed(!isCollapsed)}
        style={{ cursor: 'pointer', userSelect: 'none' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, fontSize: '0.85rem' }}>
          <Layers size={14} style={{ color: 'var(--primary)' }} />
          <span>{isCollapsed ? '图层' : '图层大纲'}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            className="layers-panel-collapse-btn"
            onClick={(e) => {
              e.stopPropagation();
              setIsCollapsed(!isCollapsed);
            }}
            title={isCollapsed ? "展开" : "折叠"}
          >
            {isCollapsed ? <ChevronDown size={12} /> : <Minus size={12} />}
          </button>
          <button
            className="layers-panel-close-btn"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            title="关闭大纲"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <div className="layers-panel-body">
          {layers.map(layer => {
            const Icon = layer.icon;
            return (
              <div key={layer.id} className="layer-outline-item">
                <div className="layer-item-info">
                  <div className="layer-icon-wrapper">
                    <Icon size={12} />
                  </div>
                  <div className="layer-text-meta">
                    <div className="layer-title-name">{layer.name}</div>
                    <div className="layer-subtitle-desc" title={layer.desc}>
                      {layer.desc.length > 20 ? layer.desc.substring(0, 18) + '...' : layer.desc}
                    </div>
                  </div>
                </div>

                <button
                  className="btn-layer-insert-chat"
                  onClick={() => onInsertRef(layer.displayName)}
                  title={`引用此图层到对话输入框中`}
                >
                  <MessageSquare size={11} />
                  <span>引用修改</span>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
