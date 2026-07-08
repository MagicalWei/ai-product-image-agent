// src/components/DashboardPanel.jsx
import React from 'react';
import { BarChart2, TrendingUp, ShoppingCart, Award, CheckCircle2, AlertTriangle, ArrowUpRight, ArrowDownRight } from 'lucide-react';

export default function DashboardPanel({ metrics, previousMetrics, className = "dashboard-card glass-panel" }) {
  if (!metrics) {
    return (
      <div className={className} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
        暂无评估数据
      </div>
    );
  }

  const safeMetrics = {
    ctr: metrics.ctr || 0,
    cvr: metrics.cvr || 0,
    quality: metrics.quality || 0,
    details: metrics.details || { lighting: 0, composition: 0, branding: 0, photorealism: 0 },
    positives: metrics.positives || [],
    negatives: metrics.negatives || [],
  };

  const prevDetails = previousMetrics?.details || {};
  const safePrevDetails = {
    lighting: prevDetails.lighting || 0,
    composition: prevDetails.composition || 0,
    branding: prevDetails.branding || 0,
    photorealism: prevDetails.photorealism || 0,
  };
  // Calculate differences if previous metrics are provided
  const getChangeIndicator = (current, previous, isPercentage = false) => {
    if (!previous || current === previous) return null;
    const diff = current - previous;
    const isUp = diff > 0;
    const formattedDiff = isPercentage 
      ? `${isUp ? '+' : ''}${diff.toFixed(2)}%`
      : `${isUp ? '+' : ''}${diff.toFixed(1)}`;
      
    return (
      <span className={`kpi-change ${isUp ? 'up' : 'down'}`}>
        {isUp ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
        {formattedDiff}
      </span>
    );
  };

  const getScoreChangeIndicator = (current, previous) => {
    if (!previous || current === previous) return null;
    const diff = current - previous;
    const isUp = diff > 0;
    return (
      <span className={`kpi-change ${isUp ? 'up' : 'down'}`}>
        {isUp ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
        {isUp ? '+' : ''}{diff}
      </span>
    );
  };

  return (
    <div className={`${className} animate-fade-in`}>
      <h2 className="dashboard-title">
        <BarChart2 size={18} className="logo-icon" />
        AI 视觉效果预估决策看板 (AI Performance Predictor)
      </h2>

      {/* Primary KPI Metrics Grid */}
      <div className="metrics-grid">
        {/* CTR KPI Card */}
        <div className="metric-kpi-card" style={{ borderLeft: '4px solid var(--primary)' }}>
          <div className="kpi-header">
            <span>预测点击率 (CTR)</span>
            <TrendingUp size={16} className="kpi-icon" />
          </div>
          <div className="kpi-body">
            <span className="kpi-value gradient-text">{safeMetrics.ctr.toFixed(2)}%</span>
            {getChangeIndicator(safeMetrics.ctr, previousMetrics?.ctr, true)}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            行业均值: 3.20% | 爆款率偏高
          </div>
        </div>

        {/* CVR KPI Card */}
        <div className="metric-kpi-card" style={{ borderLeft: '4px solid var(--secondary)' }}>
          <div className="kpi-header">
            <span>预测转化率 (CVR)</span>
            <ShoppingCart size={16} className="kpi-icon" />
          </div>
          <div className="kpi-body">
            <span className="kpi-value" style={{ color: 'var(--secondary)' }}>{safeMetrics.cvr.toFixed(2)}%</span>
            {getChangeIndicator(safeMetrics.cvr, previousMetrics?.cvr, true)}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            行业均值: 1.20% | 购买欲适中
          </div>
        </div>

        {/* Quality Score KPI Card */}
        <div className="metric-kpi-card" style={{ borderLeft: '4px solid var(--accent)' }}>
          <div className="kpi-header">
            <span>视觉品质评估 (AQA)</span>
            <Award size={16} className="kpi-icon" />
          </div>
          <div className="kpi-body">
            <span className="kpi-value" style={{ color: 'var(--accent)' }}>{safeMetrics.quality}</span>
            {getScoreChangeIndicator(safeMetrics.quality, previousMetrics?.quality)}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            总分: 100 | AI 细节融合评分
          </div>
        </div>
      </div>

      {/* Details Grid: Progress Bars vs Feature Tags */}
      <div className="dashboard-details-grid">
        
        {/* Progress bars of visual characteristics */}
        <div className="quality-scores-section" style={{ borderRight: '1px solid var(--border-light)', paddingRight: '20px' }}>
          <div className="feature-group-label">视觉维度特征评分</div>
          
          <div className="score-row">
            <div className="score-info">
              <span className="score-name">自然光影渲染 (Lighting)</span>
              <span className="score-value">
                {safeMetrics.details.lighting}%
                {getScoreChangeIndicator(safeMetrics.details.lighting, safePrevDetails.lighting)}
              </span>
            </div>
            <div className="score-bar-bg">
              <div className="score-bar-fill" style={{ width: `${safeMetrics.details.lighting}%`, background: 'var(--primary)' }}></div>
            </div>
          </div>

          <div className="score-row">
            <div className="score-info">
              <span className="score-name">构图比例美学 (Composition)</span>
              <span className="score-value">
                {safeMetrics.details.composition}%
                {getScoreChangeIndicator(safeMetrics.details.composition, safePrevDetails.composition)}
              </span>
            </div>
            <div className="score-bar-bg">
              <div className="score-bar-fill" style={{ width: `${safeMetrics.details.composition}%`, background: 'var(--secondary)' }}></div>
            </div>
          </div>

          <div className="score-row">
            <div className="score-info">
              <span className="score-name">品牌调性一致性 (Branding)</span>
              <span className="score-value">
                {safeMetrics.details.branding}%
                {getScoreChangeIndicator(safeMetrics.details.branding, safePrevDetails.branding)}
              </span>
            </div>
            <div className="score-bar-bg">
              <div className="score-bar-fill" style={{ width: `${safeMetrics.details.branding}%`, background: 'var(--accent)' }}></div>
            </div>
          </div>

          <div className="score-row">
            <div className="score-info">
              <span className="score-name">质感高拟真度 (Photorealism)</span>
              <span className="score-value">
                {safeMetrics.details.photorealism}%
                {getScoreChangeIndicator(safeMetrics.details.photorealism, safePrevDetails.photorealism)}
              </span>
            </div>
            <div className="score-bar-bg">
              <div className="score-bar-fill" style={{ width: `${safeMetrics.details.photorealism}%`, background: 'var(--success)' }}></div>
            </div>
          </div>
        </div>

        {/* Feature Tags Breakdown */}
        <div className="features-section">
          {/* Positives */}
          <div>
            <div className="feature-group-label" style={{ color: 'var(--success)' }}>视觉优势特征 (Positive Drivers)</div>
            <div className="feature-tags-container">
              {safeMetrics.positives.map((tag, i) => (
                <span key={i} className="feature-tag positive">
                  <CheckCircle2 size={12} style={{ flexShrink: 0 }} />
                  {tag}
                </span>
              ))}
            </div>
          </div>

          {/* Negatives */}
          <div style={{ marginTop: '12px' }}>
            <div className="feature-group-label" style={{ color: 'var(--accent)' }}>视觉劣化特征 (Negative Drivers)</div>
            <div className="feature-tags-container">
              {safeMetrics.negatives && safeMetrics.negatives.length > 0 ? (
                safeMetrics.negatives.map((tag, i) => (
                  <span key={i} className="feature-tag negative">
                    <AlertTriangle size={12} style={{ flexShrink: 0 }} />
                    {tag}
                  </span>
                ))
              ) : (
                <span className="feature-tag positive" style={{ border: 'none', background: 'transparent', paddingLeft: 0 }}>
                  <CheckCircle2 size={12} />
                  无明显视觉硬伤，表现极佳
                </span>
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
