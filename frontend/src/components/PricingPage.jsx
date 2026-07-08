import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Cpu, Zap, Building2 } from 'lucide-react';

const plans = [
  {
    id: 'free',
    name: '免费版',
    price: '0',
    period: '永久',
    icon: Cpu,
    credits: '5 次生图',
    features: [
      '5 次 AI 生图额度',
      '基础背景生成',
      'WebAssembly 本地抠图',
      '1:1 比例导出',
      '标准画质输出'
    ],
    cta: '当前方案',
    highlighted: false
  },
  {
    id: 'pro',
    name: 'Pro 专业版',
    price: '9.9',
    period: '月',
    icon: Zap,
    credits: '200 次/月',
    features: [
      '200 次 AI 生图额度',
      '所有生图模型（含 Doubao）',
      '批量多类型商品图生成',
      '全比例导出（1:1 / 16:9 / 9:16）',
      '高清画质 + 智能抠图融合',
      '品牌记忆持久化',
      'Agent 两阶段流水线',
      '无限画布 + 图层管理'
    ],
    cta: '立即开通',
    highlighted: true
  },
  {
    id: 'enterprise',
    name: '企业版',
    price: '29.9',
    period: '月',
    icon: Building2,
    credits: '无限量',
    features: [
      '无限 AI 生图额度',
      '所有 Pro 功能',
      'API 接口接入',
      '自定义模型配置',
      '团队协作管理',
      '优先技术支持',
      'SLA 保障'
    ],
    cta: '联系开通',
    highlighted: false
  }
];

export default function PricingPage({ currentUser, onSelectPlan, onBack }) {
  const navigate = useNavigate();
  const isPremium = currentUser?.membership_type === 'pro' || currentUser?.membership_type === 'enterprise';

  const handleSelect = (plan) => {
    if (plan.id === 'free') return;
    if (onSelectPlan) {
      onSelectPlan(plan);
    }
  };

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      navigate(-1);
    }
  };

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px 24px',
      background: 'var(--background)',
      overflow: 'auto'
    }}>
      {/* Back button */}
      <button
        onClick={handleBack}
        style={{
          position: 'absolute',
          top: '24px',
          left: '24px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '8px 14px',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border)',
          background: 'var(--background)',
          color: 'var(--foreground)',
          fontFamily: 'var(--font-sans)',
          fontSize: '0.8rem',
          fontWeight: 600,
          cursor: 'pointer',
          transition: 'all 0.15s ease'
        }}
      >
        <ArrowLeft size={16} />
        返回
      </button>

      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: '40px', marginTop: '20px' }}>
        <h1 style={{
          fontFamily: 'var(--font-heading)',
          fontSize: '2rem',
          fontWeight: 800,
          color: 'var(--foreground)',
          marginBottom: '8px',
          letterSpacing: '-0.02em'
        }}>
          选择适合你的方案
        </h1>
        <p style={{
          fontSize: '0.95rem',
          color: 'var(--muted-foreground)',
          maxWidth: '480px',
          lineHeight: 1.6
        }}>
          从免费体验开始，随业务增长灵活升级。所有方案均包含 AI 商品图生成核心能力。
        </p>
      </div>

      {/* Pricing Cards */}
      <div style={{
        display: 'flex',
        gap: '20px',
        flexWrap: 'wrap',
        justifyContent: 'center',
        maxWidth: '960px',
        width: '100%'
      }}>
        {plans.map(plan => {
          const Icon = plan.icon;
          const isCurrentPlan = isPremium && plan.id !== 'free';

          return (
            <div
              key={plan.id}
              style={{
                flex: '1 1 280px',
                maxWidth: '320px',
                minWidth: '260px',
                padding: '28px 24px',
                borderRadius: 'var(--radius-2xl)',
                border: plan.highlighted
                  ? '2px solid var(--brand-primary)'
                  : '1px solid var(--border)',
                background: plan.highlighted
                  ? 'linear-gradient(180deg, rgba(255,107,53,0.04) 0%, var(--background) 40%)'
                  : 'var(--card)',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
                position: 'relative',
                transition: 'all 0.25s ease',
                boxShadow: plan.highlighted
                  ? '0 8px 32px rgba(255,107,53,0.1)'
                  : '0 2px 12px rgba(0,0,0,0.04)'
              }}
            >
              {plan.highlighted && (
                <div style={{
                  position: 'absolute',
                  top: '-12px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  padding: '4px 14px',
                  borderRadius: '99px',
                  background: 'var(--brand-primary)',
                  color: 'white',
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  fontFamily: 'var(--font-sans)'
                }}>
                  最受欢迎
                </div>
              )}

              {/* Plan icon + name */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: 'var(--radius-lg)',
                  background: plan.highlighted ? 'rgba(255,107,53,0.1)' : 'var(--muted)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: plan.highlighted ? 'var(--brand-primary)' : 'var(--foreground)'
                }}>
                  <Icon size={20} />
                </div>
                <div>
                  <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: '1rem', color: 'var(--foreground)' }}>
                    {plan.name}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--muted-foreground)' }}>
                    {plan.credits}
                  </div>
                </div>
              </div>

              {/* Price */}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '2px' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--foreground)', fontWeight: 600 }}>¥</span>
                <span style={{
                  fontFamily: 'var(--font-heading)',
                  fontSize: '2.2rem',
                  fontWeight: 800,
                  color: 'var(--foreground)',
                  lineHeight: 1
                }}>
                  {plan.price}
                </span>
                <span style={{ fontSize: '0.8rem', color: 'var(--muted-foreground)' }}>/ {plan.period}</span>
              </div>

              {/* Features */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
                {plan.features.map((f, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Check size={14} style={{ color: 'var(--brand-primary)', flexShrink: 0 }} />
                    <span style={{ fontSize: '0.78rem', color: 'var(--foreground)' }}>{f}</span>
                  </div>
                ))}
              </div>

              {/* CTA */}
              <button
                onClick={() => handleSelect(plan)}
                disabled={plan.id === 'free' || (isCurrentPlan && plan.id !== 'free')}
                style={{
                  width: '100%',
                  padding: '12px 0',
                  borderRadius: 'var(--radius-xl)',
                  border: plan.highlighted ? 'none' : '1px solid var(--border)',
                  background: plan.highlighted ? 'var(--brand-primary)' : 'transparent',
                  color: plan.highlighted ? 'white' : 'var(--foreground)',
                  fontFamily: 'var(--font-heading)',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  cursor: plan.id === 'free' || isCurrentPlan ? 'default' : 'pointer',
                  opacity: plan.id === 'free' || isCurrentPlan ? 0.5 : 1,
                  transition: 'all 0.15s ease'
                }}
              >
                {isCurrentPlan && plan.id !== 'free' ? '当前方案' : plan.cta}
              </button>
            </div>
          );
        })}
      </div>

      {/* Footer note */}
      <p style={{
        marginTop: '32px',
        fontSize: '0.75rem',
        color: 'var(--muted-foreground)',
        textAlign: 'center',
        maxWidth: '500px',
        lineHeight: 1.5
      }}>
        所有价格均为含税价格。升级后立即生效，可随时取消订阅。
        如需定制企业方案，请联系我们获取专属报价。
      </p>
    </div>
  );
}
