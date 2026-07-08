// src/components/HistoryPanel.jsx
import React, { useState } from 'react';
import { ArrowLeftRight, Check, Cpu, TrendingUp, TrendingDown, ArrowRight, CornerDownLeft } from 'lucide-react';

export default function HistoryPanel({ versions, onSelectVersion, currentVersionIndex }) {
  const [pkLeftIndex, setPkLeftIndex] = useState(0);
  const [pkRightIndex, setPkRightIndex] = useState(versions.length > 1 ? 1 : 0);

  if (!versions || versions.length === 0) {
    return (
      <div className="glass-panel" style={{ padding: '40px', textAlign: 'center', height: 'calc(100vh - 110px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px' }}>
        <ArrowLeftRight size={48} style={{ opacity: 0.2, color: 'var(--primary)' }} />
        <h3 style={{ fontSize: '1.1rem', fontWeight: 600 }}>暂无历史版本数据</h3>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', maxWidth: '400px' }}>
          请先前往“门户主页”或使用“创意工作台”生成您的首个服装广告图，即可解锁多版本对比 PK 功能。
        </p>
      </div>
    );
  }

  const leftVer = versions[pkLeftIndex] || versions[0];
  const rightVer = versions[pkRightIndex] || versions[versions.length - 1] || versions[0];

  // Safe metrics accessor
  const safeMetrics = (ver) => {
    if (!ver || !ver.metrics) {
      return { ctr: 0, cvr: 0, quality: 0, details: {}, positives: [] };
    }
    return ver.metrics;
  };

  const leftMetrics = safeMetrics(leftVer);
  const rightMetrics = safeMetrics(rightVer);

  // Compare helper
  const getCompareMetric = (leftVal, rightVal, isPercentage = false) => {
    const diff = rightVal - leftVal;
    if (diff === 0) return null;
    const isUp = diff > 0;
    const formatted = isPercentage ? `${isUp ? '+' : ''}${diff.toFixed(2)}%` : `${isUp ? '+' : ''}${diff.toFixed(1)}`;
    return (
      <span style={{ 
        marginLeft: '8px', 
        fontSize: '0.75rem', 
        fontWeight: 700, 
        color: isUp ? '#067a53' : '#ba1a1a', 
        background: isUp ? 'rgba(16,185,129,0.08)' : 'rgba(186,26,26,0.05)',
        padding: '2px 6px',
        borderRadius: '4px',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '2px'
      }}>
        {isUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
        {formatted}
      </span>
    );
  };


  const renderVersionPreview = (ver, label, versionIndex) => {
    if (!ver) return null;

    
    const aspect = ver.aspect || '1:1';
    const originalWidth = aspect === '1:1' ? 380 : 320;
    const originalHeight = aspect === '1:1' ? 380 : 426.67;
    const scale = 220 / originalWidth;
    const previewHeight = 220 * (aspect === '1:1' ? 1 : 4/3);

    const displayImage = ver.displayMattingState === 'ai_standard'
      ? (ver.aiMatting || ver.image)
      : (ver.refinedMatting || ver.image);

    return (
      <div
        style={{ display: 'flex', justifyContent: 'center', background: '#f5f6fa', borderRadius: '12px', padding: '12px', border: '1px solid var(--border-glass)', cursor: 'pointer' }}
        onClick={() => onSelectVersion(versionIndex)}
        title="点击跳转到画布工作台"
      >
        <div style={{
          width: '220px', 
          height: `${previewHeight}px`,
          position: 'relative', 
          borderRadius: '8px', 
          overflow: 'hidden',
          background: '#e2e8f0',
          boxShadow: '0 4px 12px rgba(0,0,0,0.08)'
        }}>
          <div 
            style={{
              position: 'absolute',
              top: '6px',
              left: '6px',
              zIndex: 20,
              display: 'flex',
              alignItems: 'center',
              gap: '3px',
              background: 'rgba(0,0,0,0.7)',
              backdropFilter: 'blur(2px)',
              padding: '2px 6px',
              borderRadius: '10px',
              fontSize: '0.55rem',
              color: 'white',
              fontWeight: 500,
              pointerEvents: 'none',
              userSelect: 'none'
            }}
          >
            {ver.displayMattingState === 'refined' ? '🟢 精修' : '🟡 AI原版'}
          </div>

          <img
            src={displayImage && (displayImage.startsWith('data:') || displayImage.startsWith('http') || displayImage.startsWith('uploads/') || displayImage.startsWith('assets/')) ? displayImage : `assets/${displayImage}`}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            alt={label}
          />
          

        </div>
      </div>
    );
  };

  return (
    <div className="history-panel-container animate-fade-scale" style={{ display: 'flex', flexDirection: 'column', gap: '20px', height: 'calc(100vh - 110px)', padding: '10px 0' }}>
      
      {/* Header with selector dropdowns */}
      <div className="glass-panel" style={{ padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <ArrowLeftRight size={20} className="logo-icon" />
          <h2 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--on-surface)' }}>
            版本同屏对比决策舱 (Version PK Board)
          </h2>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>对比版本 A:</span>
            <select 
              className="form-input" 
              value={pkLeftIndex}
              onChange={(e) => setPkLeftIndex(parseInt(e.target.value))}
              style={{ fontSize: '0.8rem', padding: '6px 12px' }}
            >
              {versions.map((v, i) => (
                <option key={v.id} value={i}>V{i + 1} - {v.name}</option>
              ))}
            </select>
          </div>

          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>VS</div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>对比版本 B:</span>
            <select 
              className="form-input" 
              value={pkRightIndex}
              onChange={(e) => setPkRightIndex(parseInt(e.target.value))}
              style={{ fontSize: '0.8rem', padding: '6px 12px' }}
            >
              {versions.map((v, i) => (
                <option key={v.id} value={i}>V{i + 1} - {v.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Main PK Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', flex: 1, minHeight: 0 }}>
        
        {/* Left Column - Version A */}
        <div className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px', overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-light)', paddingBottom: '8px' }}>
            <span style={{ background: 'var(--primary)', color: 'white', padding: '3px 10px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 700 }}>
              VERSION A (V{pkLeftIndex + 1})
            </span>
            <button 
              className="settings-btn cancel" 
              style={{ padding: '4px 10px', fontSize: '0.75rem' }} 
              onClick={() => onSelectVersion(pkLeftIndex)}
            >
              <CornerDownLeft size={12} style={{ marginRight: '4px' }} />
              激活为工作台当前版
            </button>
          </div>

          {/* Preview Canvas */}
          {renderVersionPreview(leftVer, "version a", pkLeftIndex)}

          {/* Metrics List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', alignItems: 'center', fontSize: '0.8rem' }}>
              <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>核心点击率 CTR:</span>
              <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--primary)' }}>{leftMetrics.ctr.toFixed(2)}%</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', alignItems: 'center', fontSize: '0.8rem' }}>
              <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>核心转化率 CVR:</span>
              <span style={{ fontSize: '1.0rem', fontWeight: 700, color: 'var(--secondary)' }}>{leftMetrics.cvr.toFixed(2)}%</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', alignItems: 'center', fontSize: '0.8rem' }}>
              <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>视觉综合评分 AQA:</span>
              <span style={{ fontSize: '1.0rem', fontWeight: 700, color: 'var(--accent)' }}>{leftMetrics.quality}分</span>
            </div>
            
            <div style={{ borderTop: '1px dashed var(--border-light)', paddingContent: '8px', marginTop: '4px' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>视觉维度评分:</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '0.75rem' }}>
                <div>💡 自然光影: <strong>{leftMetrics.details?.lighting || 0}%</strong></div>
                <div>📐 构图比例: <strong>{leftMetrics.details?.composition || 0}%</strong></div>
                <div>🛡️ 品牌一致: <strong>{leftMetrics.details?.branding || 0}%</strong></div>
                <div>✨ 高拟真度: <strong>{leftMetrics.details?.photorealism || 0}%</strong></div>
              </div>
            </div>

            <div style={{ borderTop: '1px dashed var(--border-light)', paddingTop: '8px' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#067a53', marginBottom: '4px' }}>优势项 (Positives):</div>
              <ul style={{ paddingLeft: '16px', margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                {leftMetrics.positives.map((p, idx) => <li key={idx}>{p}</li>)}
              </ul>
            </div>
          </div>
        </div>

        {/* Right Column - Version B */}
        <div className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px', overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-light)', paddingBottom: '8px' }}>
            <span style={{ background: 'var(--secondary)', color: 'white', padding: '3px 10px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 700 }}>
              VERSION B (V{pkRightIndex + 1})
            </span>
            <button 
              className="settings-btn cancel" 
              style={{ padding: '4px 10px', fontSize: '0.75rem' }} 
              onClick={() => onSelectVersion(pkRightIndex)}
            >
              <CornerDownLeft size={12} style={{ marginRight: '4px' }} />
              激活为工作台当前版
            </button>
          </div>

          {/* Preview Canvas */}
          {renderVersionPreview(rightVer, "version b", pkRightIndex)}

          {/* Metrics List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', alignItems: 'center', fontSize: '0.8rem' }}>
              <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>核心点击率 CTR:</span>
              <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--primary)' }}>
                {rightMetrics.ctr.toFixed(2)}%
                {getCompareMetric(leftMetrics.ctr, rightMetrics.ctr, true)}
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', alignItems: 'center', fontSize: '0.8rem' }}>
              <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>核心转化率 CVR:</span>
              <span style={{ fontSize: '1.0rem', fontWeight: 700, color: 'var(--secondary)' }}>
                {rightMetrics.cvr.toFixed(2)}%
                {getCompareMetric(leftMetrics.cvr, rightMetrics.cvr, true)}
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', alignItems: 'center', fontSize: '0.8rem' }}>
              <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>视觉综合评分 AQA:</span>
              <span style={{ fontSize: '1.0rem', fontWeight: 700, color: 'var(--accent)' }}>
                {rightMetrics.quality}分
                {getCompareMetric(leftMetrics.quality, rightMetrics.quality)}
              </span>
            </div>
            
            <div style={{ borderTop: '1px dashed var(--border-light)', paddingContent: '8px', marginTop: '4px' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>视觉维度评分:</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '0.75rem' }}>
                <div>💡 自然光影: <strong>{rightMetrics.details?.lighting || 0}%</strong> {getCompareMetric(leftMetrics.details?.lighting || 0, rightMetrics.details?.lighting || 0)}</div>
                <div>📐 构图比例: <strong>{rightMetrics.details?.composition || 0}%</strong> {getCompareMetric(leftMetrics.details?.composition || 0, rightMetrics.details?.composition || 0)}</div>
                <div>🛡️ 品牌一致: <strong>{rightMetrics.details?.branding || 0}%</strong> {getCompareMetric(leftMetrics.details?.branding || 0, rightMetrics.details?.branding || 0)}</div>
                <div>✨ 高拟真度: <strong>{rightMetrics.details?.photorealism || 0}%</strong> {getCompareMetric(leftMetrics.details?.photorealism || 0, rightMetrics.details?.photorealism || 0)}</div>
              </div>
            </div>

            <div style={{ borderTop: '1px dashed var(--border-light)', paddingTop: '8px' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#067a53', marginBottom: '4px' }}>优势项 (Positives):</div>
              <ul style={{ paddingLeft: '16px', margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                {rightMetrics.positives.map((p, idx) => <li key={idx}>{p}</li>)}
              </ul>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
