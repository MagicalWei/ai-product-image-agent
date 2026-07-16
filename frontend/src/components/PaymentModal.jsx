import React, { useState } from 'react';
import { Cpu, Check, ArrowRight, AlertCircle } from 'lucide-react';
import CloseButton from './CloseButton';

export default function PaymentModal({ onClose, onPaymentSuccess, currentUser }) {
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const plans = [
    {
      id: 'wei_studio_base',
      priceId: 'price_1TpzA3D0QMxGnKe7zTvcIwvE',
      name: '基础版',
      subtitle: 'Wei Studio Base',
      price: 9.99,
      credits: 20,
      benefits: [
        '每月 20 次 AI 商品图生成额度',
        '标准渲染速度',
        '高清画质导出',
        '基础抠图功能',
        'API 密钥云同步'
      ],
      color: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)'
    },
    {
      id: 'wei_studio_plus',
      priceId: 'price_1TpzR4D0QMxGnKe76kHCv3Fs',
      name: '专业版',
      subtitle: 'Wei Studio Plus',
      price: 19.99,
      credits: 60,
      badge: '最受欢迎',
      benefits: [
        '每月 60 次 AI 商品图生成额度',
        '开启创意画布「局部重绘笔刷」功能',
        '优先加速渲染通道 (免排队)',
        '2K 超高分辨率画质与无底抠图导出',
        'API 密钥多端自动安全云同步'
      ],
      color: 'linear-gradient(135deg, #0058bc 0%, #4c4aca 100%)'
    },
    {
      id: 'wei_studio_pro',
      priceId: 'price_1TpzB0D0QMxGnKe7Tfoq6Nd6',
      name: '企业版',
      subtitle: 'Wei Studio Pro',
      price: 99.99,
      credits: 300,
      badge: '企业专享',
      benefits: [
        '每月 300 次 极速 AI 生成额度',
        '超快独立 GPU 算力渲染专属通道',
        '4K 极清画质与无损分层 PSD 资产导出',
        '批量一键背景抠图与智能扩图',
        '支持商拍专属商品 LoRA 模型的在线训练'
      ],
      color: 'linear-gradient(135deg, #181c23 0%, #414755 100%)'
    }
  ];

  const handleSelectPlan = async (plan) => {
    if (!currentUser) {
      setErrorMsg('请先登录账号后再升级套餐');
      return;
    }

    setIsLoading(true);
    setErrorMsg('');

    try {
      const response = await fetch('/api/payment/create-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          planId: plan.id,
          priceId: plan.priceId
        }),
        credentials: 'include'
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `创建订单失败 (HTTP ${response.status})`);
      }

      if (data.order && data.order.checkoutUrl) {
        window.location.assign(data.order.checkoutUrl);
      } else {
        throw new Error(data.error || '未获取到有效的支付结账链接');
      }
    } catch (err) {
      console.error('[Payment] 创建订单失败:', err);
      setErrorMsg(err.message || '支付暂时不可用，请稍后再试');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="onboarding-modal-overlay" onClick={onClose}>
      <div
        className="onboarding-modal-content glass-panel"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '820px',
          padding: '24px',
          background: 'rgba(255, 255, 255, 0.9)',
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
        }}
      >
        <CloseButton onClick={onClose} />

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '16px' }}>
          <div style={{
            width: '38px', height: '38px', borderRadius: '50%',
            background: 'rgba(0, 88, 188, 0.08)', color: 'var(--primary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 8px', border: '1px solid rgba(0, 88, 188, 0.15)'
          }}>
            <Cpu size={18} className="logo-icon" />
          </div>
          <h2 className="headline-lg" style={{ fontSize: '1.2rem', fontWeight: 700 }}>
            升级尊贵会员，释放极致生图力
          </h2>
          <p style={{ fontSize: '0.75rem', color: 'var(--on-surface-variant)', marginTop: '4px' }}>
            选择最适合您商业规模的阶梯套餐
          </p>
        </div>

        {/* Plans Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', marginBottom: '16px' }}>
          {plans.map((p) => {

            return (
              <div
                key={p.id}
                className="glass-panel"
                style={{
                  border: '1px solid rgba(0, 88, 188, 0.12)',
                  borderRadius: '12px', padding: '18px',
                  display: 'flex', flexDirection: 'column',
                  position: 'relative', background: 'white',
                  boxShadow: '0 4px 20px rgba(0,0,0,0.02)'
                }}
              >
                {p.badge && (
                  <span style={{
                    position: 'absolute', top: '12px', right: '12px',
                    fontSize: '0.6rem', fontWeight: 700, background: p.color,
                    color: 'white', padding: '2px 8px', borderRadius: '4px'
                  }}>
                    {p.badge}
                  </span>
                )}

                <h3 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--on-surface)' }}>{p.name}</h3>
                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: '4px' }}>{p.subtitle}</span>

                <div style={{ display: 'flex', alignItems: 'baseline', marginTop: '6px', marginBottom: '2px' }}>
                  <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--primary)' }}>$</span>
                  <span style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--primary)', lineHeight: 1 }}>{p.price}</span>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginLeft: '2px' }}>/月</span>
                </div>

                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                    按月结算，随时可升级/取消
                  </span>

                <ul style={{
                  listStyle: 'none', padding: 0, margin: '14px 0 20px',
                  display: 'flex', flexDirection: 'column', gap: '8px',
                  fontSize: '0.72rem', color: 'var(--on-surface-variant)', flex: 1
                }}>
                  {p.benefits.map((benefit, i) => (
                    <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
                      <Check size={12} style={{ color: '#067a53', flexShrink: 0, marginTop: '2px' }} />
                      <span>{benefit}</span>
                    </li>
                  ))}
                </ul>

                <button
                  type="button"
                  className="settings-btn save"
                  style={{
                    width: '100%', padding: '10px 0', fontSize: '0.8rem', fontWeight: 700,
                    background: p.color, border: 'none',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
                  }}
                  onClick={() => handleSelectPlan(p)}
                  disabled={isLoading}
                >
                  <span>升级套餐</span>
                  <ArrowRight size={12} />
                </button>
              </div>
            );
          })}
        </div>

        {errorMsg && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '8px 12px', background: 'var(--error-container)',
            color: 'var(--on-error-container)', borderRadius: '8px',
            fontSize: '0.75rem', border: '1px solid rgba(186, 26, 26, 0.12)'
          }}>
            <AlertCircle size={14} />
            <span>{errorMsg}</span>
          </div>
        )}
      </div>
    </div>
  );
}
