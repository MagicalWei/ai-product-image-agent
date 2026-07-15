import React from 'react';
import { Download, X, Image, FileImage, Check } from 'lucide-react';
import './ExportModal.css';

const QUALITY_OPTIONS = [
  { scale: 1, title: '标准标清', label: '1x', icon: 'SD', desc: '适合网页预览与快速发送', color: '#6b7280' },
  { scale: 2, title: '高清 HD', label: '2x', icon: 'HD', desc: '推荐，适合社交平台与展示', color: '#3b82f6' },
  { scale: 3, title: '超清 UHD', label: '3x', icon: '4K', desc: '印刷级清晰度，适合海报', color: '#8b5cf6' },
  { scale: 4, title: '极清 SHD', label: '4x', icon: '8K', desc: '精细广告印刷画质', color: '#f59e0b' },
];

const FORMAT_OPTIONS = [
  { key: 'png', label: 'PNG', icon: Image, hint: '支持透明背景，画质无损' },
  { key: 'jpeg', label: 'JPEG', icon: FileImage, hint: '体积更小，适合快速分享' },
];

export default function ExportModal({
  isOpen,
  onClose,
  onConfirm,
  exportFormat,
  onFormatChange,
  exportScale,
  onScaleChange,
  exportItems = [],
  isExporting = false,
}) {
  if (!isOpen) return null;

  const getEstMb = (scale) => {
    if (!exportItems || exportItems.length === 0) return '0.00';
    const totalBytes = exportItems.reduce((sum, item) => {
      const scaledW = Math.round((item.width || 1200) * scale);
      const scaledH = Math.round((item.height || 800) * scale);
      const estBytes = scaledW * scaledH * (exportFormat === 'png' ? 0.35 : 0.08);
      return sum + estBytes;
    }, 0);
    return (totalBytes / (1024 * 1024)).toFixed(2);
  };

  const clusterCount = exportItems?.length || 0;
  const currentEstMb = getEstMb(exportScale);

  return (
    <div className="export-overlay" onClick={onClose}>
      <div className="export-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="export-header">
          <div className="export-header-left">
            <Download size={20} />
            <h2>导出图片设置</h2>
          </div>
          <button className="export-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {/* Format */}
        <div className="export-section">
          <label className="export-label">导出格式</label>
          <div className="export-format-row">
            {FORMAT_OPTIONS.map(({ key, label, icon: Icon, hint }) => (
              <button
                key={key}
                className={`export-format-card${exportFormat === key ? ' active' : ''}`}
                onClick={() => onFormatChange(key)}
              >
                <div className="export-format-top">
                  <Icon size={22} />
                  <span className="export-format-name">{label}</span>
                  {exportFormat === key && <Check size={16} className="export-format-check" />}
                </div>
                <span className="export-format-hint">{hint}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Quality */}
        <div className="export-section">
          <label className="export-label">选择清晰度</label>
          <div className="export-quality-grid">
            {QUALITY_OPTIONS.map(({ scale, title, label, icon, desc, color }) => (
              <button
                key={scale}
                className={`export-quality-card${exportScale === scale ? ' active' : ''}`}
                onClick={() => onScaleChange(scale)}
                style={{ '--accent': color }}
              >
                <div className="export-quality-badge" style={{ background: exportScale === scale ? color : 'var(--surface-container-high)' }}>
                  {icon}
                </div>
                <div className="export-quality-info">
                  <span className="export-quality-title">{label} · {title}</span>
                  <span className="export-quality-desc">{desc}</span>
                </div>
                <span className="export-quality-size">约 {getEstMb(scale)} MB</span>
              </button>
            ))}
          </div>
        </div>

        {/* Summary */}
        <div className="export-summary">
          <div className="export-summary-row">
            <span>导出分组</span>
            <strong>{clusterCount} 个</strong>
          </div>
          <div className="export-summary-row">
            <span>选择清晰度</span>
            <strong>{QUALITY_OPTIONS.find(q => q.scale === exportScale)?.title} ({exportScale}x)</strong>
          </div>
          <div className="export-summary-row">
            <span>预估总大小</span>
            <strong>约 {currentEstMb} MB</strong>
          </div>
        </div>

        {/* Actions */}
        <div className="export-actions">
          <button className="export-btn-cancel" onClick={onClose}>取消</button>
          <button className="export-btn-confirm" onClick={onConfirm} disabled={isExporting}>
            {isExporting ? '导出中...' : '开始导出'}
          </button>
        </div>
      </div>
    </div>
  );
}
