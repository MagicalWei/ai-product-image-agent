// src/components/ModeSelectModal.jsx
import React from 'react';
import { Layers, Cpu, MousePointerClick } from 'lucide-react';
import CloseButton from './CloseButton';

export default function ModeSelectModal({ onSelectMode, onClose }) {
  return (
    <div className="onboarding-modal-overlay animate-fade-in" style={{ zIndex: 1000 }}>
      <div 
        className="onboarding-modal-content glass-pane animate-fade-scale" 
        style={{ 
          maxWidth: '640px', 
          width: '90%', 
          padding: '28px',
          background: 'rgba(20, 21, 26, 0.85)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.6)'
        }}
      >
        <CloseButton onClick={onClose} />

        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '8px' }}>
            <Cpu style={{ color: 'var(--primary)' }} size={24} />
            <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#ffffff', margin: 0 }}>
              选择您的设计工作流模式
            </h2>
          </div>
          <p style={{ fontSize: '0.8rem', color: 'rgba(255, 255, 255, 0.6)', maxWidth: '420px', margin: '0 auto' }}>
            商品素材与抠图已就绪！请选择最契合您当前任务的 AI 协同模式开始创作。
          </p>
        </div>

        <div 
          style={{ 
            display: 'grid', 
            gridTemplateColumns: '1fr 1fr', 
            gap: '20px', 
            marginTop: '10px' 
          }}
        >
          {/* Option 1: Agent Mode */}
          <div 
            className="style-card"
            style={{ 
              display: 'flex',
              flexDirection: 'column',
              padding: '24px',
              borderRadius: '16px',
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.06)',
              textAlign: 'center',
              cursor: 'pointer',
              transition: 'all 0.25s ease',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
              e.currentTarget.style.borderColor = 'var(--primary)';
              e.currentTarget.style.transform = 'translateY(-4px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.06)';
              e.currentTarget.style.transform = 'none';
            }}
            onClick={() => onSelectMode('agent')}
          >
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div 
                style={{ 
                  width: '56px', 
                  height: '56px', 
                  borderRadius: '50%', 
                  background: 'rgba(255, 107, 53, 0.1)', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  marginBottom: '16px',
                  color: 'var(--primary)'
                }}
              >
                <Cpu size={24} />
              </div>
              <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#ffffff', margin: '0 0 8px 0' }}>
                Agent Mode (智能体托管)
              </h3>
              <p style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.5)', lineHeight: '1.4', margin: '0 0 16px 0' }}>
                AI 全权托底。您只需以对话指令、或者用画笔在图上直接圈画不满意的地方，AI 智能体即可代劳完成重绘和生成。极速省心。
              </p>
            </div>
            <button 
              className="settings-btn save" 
              style={{ width: '100%', padding: '10px 0', border: 'none', borderRadius: '8px', fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer' }}
              onClick={() => onSelectMode('agent')}
            >
              开启 Agent 创作之旅
            </button>
          </div>

          {/* Option 2: CoWork Mode */}
          <div 
            className="style-card"
            style={{ 
              display: 'flex',
              flexDirection: 'column',
              padding: '24px',
              borderRadius: '16px',
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.06)',
              textAlign: 'center',
              cursor: 'pointer',
              transition: 'all 0.25s ease',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
              e.currentTarget.style.borderColor = 'var(--secondary)';
              e.currentTarget.style.transform = 'translateY(-4px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.06)';
              e.currentTarget.style.transform = 'none';
            }}
            onClick={() => onSelectMode('cowork')}
          >
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div 
                style={{ 
                  width: '56px', 
                  height: '56px', 
                  borderRadius: '50%', 
                  background: 'rgba(0, 88, 188, 0.1)', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  marginBottom: '16px',
                  color: 'var(--secondary)'
                }}
              >
                <Layers size={24} />
              </div>
              <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#ffffff', margin: '0 0 8px 0' }}>
                CoWork Mode (人机协作画布)
              </h3>
              <p style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.5)', lineHeight: '1.4', margin: '0 0 16px 0' }}>
                您是总导演。提供类似 Figma 的无限大画布，由您主导图层排版、缩放和位置微调，AI 决策助手在侧边打分并为您提供建议。
              </p>
            </div>
            <button 
              className="settings-btn save" 
              style={{ 
                width: '100%', 
                padding: '10px 0', 
                border: 'none', 
                borderRadius: '8px', 
                fontWeight: 700, 
                fontSize: '0.8rem', 
                cursor: 'pointer',
                background: 'var(--secondary)'
              }}
              onClick={() => onSelectMode('cowork')}
            >
              打开专业协作画布
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
