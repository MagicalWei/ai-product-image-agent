import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Eye, LoaderCircle, RefreshCw } from 'lucide-react';

const VERIFY_LABELS = {
  confirmed_visual: '图片可直接证明',
  likely_visual: '合理推测，需确认',
  unsupported: '图片无法证明',
};

const confidenceLabel = (value) => {
  const score = Math.round((Number(value) || 0) * 100);
  return `${score}%`;
};

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  border: '1px solid var(--border)',
  borderRadius: 7,
  padding: '7px 9px',
  background: 'var(--surface)',
  color: 'var(--text-primary)',
  fontSize: '0.78rem',
};

export default function ProductAnalysisCard({
  analysis,
  onConfirm,
  onRetry,
  isConfirming = false,
  confirmed = false,
}) {
  const [draft, setDraft] = useState(analysis);
  const [selected, setSelected] = useState(
    () => new Set((analysis?.selling_points || []).map((_, index) => index))
  );
  const [localError, setLocalError] = useState('');

  const selectedPoints = useMemo(
    () => (draft?.selling_points || []).filter((_, index) => selected.has(index)),
    [draft, selected]
  );

  if (!draft || draft.error || draft.parse_error) {
    return (
      <div className="product-analysis-card" style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--warning, #b45309)' }}>
          <AlertTriangle size={16} />
          <span>商品图识别失败，没有进入 Agent 记忆。</span>
        </div>
        {onRetry && <RetryButton onClick={onRetry} />}
      </div>
    );
  }

  const updateProduct = (field, value) => {
    setDraft((prev) => ({ ...prev, product: { ...prev.product, [field]: value } }));
  };

  const updatePoint = (index, field, value) => {
    setDraft((prev) => ({
      ...prev,
      selling_points: prev.selling_points.map((point, pointIndex) => (
        pointIndex === index ? { ...point, [field]: value } : point
      )),
    }));
  };

  const togglePoint = (index) => {
    if (confirmed) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const handleConfirm = async () => {
    if (!draft.product?.product_name?.trim()) {
      setLocalError('请先填写商品名称。');
      return;
    }
    if (selectedPoints.length === 0) {
      setLocalError('请至少保留一条可信卖点。');
      return;
    }
    setLocalError('');
    await onConfirm?.({ ...draft, selling_points: selectedPoints, status: 'confirmed' });
  };

  return (
    <div className="product-analysis-card" style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        {confirmed && <CheckCircle2 size={17} color="#16a34a" />}
        <strong style={{ color: 'var(--text-primary)' }}>
          {confirmed ? '商品信息已确认' : '商品图识别草稿'}
        </strong>
        <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
          识别置信度 {confidenceLabel(draft.product?.confidence)}
        </span>
      </div>

      {!confirmed && (
        <div style={noticeStyle}>
          请核对后确认。确认前，这些内容不会进入 Agent 记忆。
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 8, marginBottom: 12 }}>
        <label style={labelStyle}>
          商品名称
          <input
            style={inputStyle}
            value={draft.product?.product_name || ''}
            disabled={confirmed}
            onChange={(event) => updateProduct('product_name', event.target.value)}
          />
        </label>
        <label style={labelStyle}>
          商品类别
          <input
            style={inputStyle}
            value={draft.product?.product_category || ''}
            disabled={confirmed}
            onChange={(event) => updateProduct('product_category', event.target.value)}
          />
        </label>
      </div>

      {(draft.visible_facts || []).length > 0 && (
        <section style={{ marginBottom: 12 }}>
          <SectionTitle icon={<Eye size={13} />}>图片中可见事实</SectionTitle>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {draft.visible_facts.map((fact, index) => <span key={index} style={factChipStyle}>{fact}</span>)}
          </div>
        </section>
      )}

      <section>
        <SectionTitle>候选卖点（选择后确认）</SectionTitle>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(draft.selling_points || []).map((point, index) => {
            const active = selected.has(index);
            return (
              <div key={index} style={{ ...pointStyle, opacity: active ? 1 : 0.55 }}>
                <button
                  type="button"
                  aria-label={active ? '取消该卖点' : '采用该卖点'}
                  onClick={() => togglePoint(index)}
                  style={checkStyle(active)}
                >
                  {active ? '✓' : ''}
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <input
                    style={{ ...inputStyle, fontWeight: 600 }}
                    value={point.title || ''}
                    disabled={confirmed}
                    onChange={(event) => updatePoint(index, 'title', event.target.value)}
                  />
                  <textarea
                    style={{ ...inputStyle, marginTop: 6, minHeight: 48, resize: 'vertical' }}
                    value={point.description || ''}
                    disabled={confirmed}
                    placeholder="卖点描述"
                    onChange={(event) => updatePoint(index, 'description', event.target.value)}
                  />
                  <div style={{ marginTop: 6, fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                    视觉证据
                  </div>
                  <input
                    style={{ ...inputStyle, marginTop: 3 }}
                    value={point.visual_evidence || ''}
                    disabled={confirmed}
                    onChange={(event) => updatePoint(index, 'visual_evidence', event.target.value)}
                  />
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
                    <select
                      style={{ ...inputStyle, width: 'auto' }}
                      value={point.verification || 'likely_visual'}
                      disabled={confirmed}
                      onChange={(event) => updatePoint(index, 'verification', event.target.value)}
                    >
                      {Object.entries(VERIFY_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
                      置信度 {confidenceLabel(point.confidence)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {(draft.uncertain_claims || []).length > 0 && (
        <div style={{ ...noticeStyle, marginTop: 10, color: '#92400e' }}>
          <strong>图片无法证明：</strong>{draft.uncertain_claims.join('；')}
        </div>
      )}

      {localError && <div style={{ marginTop: 8, color: '#dc2626', fontSize: '0.75rem' }}>{localError}</div>}

      {!confirmed && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          {onRetry && <RetryButton onClick={onRetry} />}
          <button type="button" onClick={handleConfirm} disabled={isConfirming} style={confirmButtonStyle}>
            {isConfirming ? <LoaderCircle size={14} className="spin" /> : <CheckCircle2 size={14} />}
            {isConfirming ? '正在保存…' : `确认商品信息（${selectedPoints.length} 条卖点）`}
          </button>
        </div>
      )}
    </div>
  );
}

function SectionTitle({ icon, children }) {
  return <div style={{ display: 'flex', gap: 5, alignItems: 'center', marginBottom: 7, fontSize: '0.78rem', fontWeight: 600 }}>{icon}{children}</div>;
}

function RetryButton({ onClick }) {
  return <button type="button" onClick={onClick} style={secondaryButtonStyle}><RefreshCw size={13} />重新分析</button>;
}

const cardStyle = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, margin: '8px 0', fontSize: '0.8rem', color: 'var(--text-primary)' };
const noticeStyle = { padding: '7px 9px', marginBottom: 12, borderRadius: 7, background: 'var(--surface-secondary, #f8fafc)', color: 'var(--text-secondary)', fontSize: '0.73rem', lineHeight: 1.5 };
const labelStyle = { display: 'flex', flexDirection: 'column', gap: 4, color: 'var(--text-secondary)', fontSize: '0.72rem' };
const factChipStyle = { padding: '3px 8px', borderRadius: 12, background: 'var(--surface-secondary, #f1f5f9)', color: 'var(--text-secondary)', fontSize: '0.7rem' };
const pointStyle = { display: 'flex', gap: 8, padding: 9, border: '1px solid var(--border)', borderRadius: 9, background: 'var(--surface)' };
const checkStyle = (active) => ({ width: 22, height: 22, flex: '0 0 22px', borderRadius: 6, border: `1px solid ${active ? 'var(--primary)' : 'var(--border)'}`, background: active ? 'var(--primary)' : 'transparent', color: '#fff', cursor: 'pointer' });
const secondaryButtonStyle = { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' };
const confirmButtonStyle = { display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px 12px', border: 0, borderRadius: 8, background: 'var(--primary)', color: '#fff', fontWeight: 600, cursor: 'pointer' };
