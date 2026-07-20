// src/components/OssHero.jsx
import { motion } from 'motion/react';
import {
  Layers, Users, Zap, ArrowRight, ChevronDown,
  ShoppingBag, Scissors, Palette, ImagePlus, Upload, Download
} from 'lucide-react';

const spring = (delay = 0) => ({
  type: 'spring',
  stiffness: 90,
  damping: 14,
  delay
});

const fadeUp = (delay = 0) => ({
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: spring(delay)
  }
});

export default function OssHero({ onEnter }) {
  return (
    <div className="oss-hero-page">
      {/* Background blobs */}
      <div className="oss-blobs">
        <div className="oss-blob oss-blob-1" />
        <div className="oss-blob oss-blob-2" />
        <div className="oss-blob oss-blob-3" />
      </div>

      {/* Top bar — skip button */}
      <div className="oss-hero-topbar">
        <motion.button
          className="oss-hero-skip-btn"
          onClick={onEnter}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.5 }}
        >
          跳过
          <ChevronDown size={12} />
        </motion.button>
      </div>

      {/* ═══ Section 1: Hero 主视觉 ═══ */}
      <section className="oss-hero-section oss-hero-main">
        <div className="oss-hero-content">
          {/* Glass avatar */}
          <motion.div
            className="oss-hero-avatar"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 80, damping: 12, delay: 0.1 }}
          >
            <Layers size={40} className="oss-hero-avatar-icon" />
          </motion.div>

          {/* Badge */}
          <motion.div
            className="oss-hero-badge-splash"
            variants={fadeUp()}
            initial="hidden"
            animate="visible"
            transition={spring(0.2)}
          >
            AI 驱动 · 秒级出图
          </motion.div>

          {/* Title */}
          <motion.h1
            className="oss-hero-title-splash"
            variants={fadeUp()}
            initial="hidden"
            animate="visible"
            transition={spring(0.35)}
          >
            AI <span className="highlight">商品图</span> 工作台
          </motion.h1>

          {/* Subtitle */}
          <motion.p
            className="oss-hero-subtitle-splash"
            variants={fadeUp()}
            initial="hidden"
            animate="visible"
            transition={spring(0.5)}
          >
            一句话描述你的商品，AI 多 Agent 团队自动完成文案策划、视觉设计、流量分析，
            三分钟生成可直接投放的电商主图
          </motion.p>

          {/* Feature tags */}
          <motion.div
            className="oss-hero-features-row"
            initial="hidden"
            animate="visible"
            variants={{
              visible: { transition: { staggerChildren: 0.08, delayChildren: 0.65 } }
            }}
          >
            {[
              { icon: Users, label: '多 Agent 协作' },
              { icon: null, label: '智能 AI 抠图' },
              { icon: Layers, label: '无限协作画布' },
              { icon: Zap, label: '秒级生成' },
            ].map((feat, i) => (
              <motion.div
                key={i}
                className="oss-hero-feature-tag"
                variants={{
                  hidden: { opacity: 0, y: 16 },
                  visible: { opacity: 1, y: 0, transition: spring() }
                }}
              >
                {feat.icon && <feat.icon size={12} />}
                {feat.label}
              </motion.div>
            ))}
          </motion.div>

          {/* CTA */}
          <motion.button
            className="oss-hero-cta-btn"
            onClick={onEnter}
            variants={fadeUp()}
            initial="hidden"
            animate="visible"
            transition={spring(0.85)}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
          >
            开始设计
            <ArrowRight size={18} />
          </motion.button>
        </div>

        {/* Scroll hint */}
        <motion.div
          className="oss-hero-scroll-hint"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.4 }}
        >
          <span>向下滚动了解更多</span>
          <ChevronDown size={16} />
        </motion.div>
      </section>

      {/* ═══ Section 2: 核心能力 ═══ */}
      <section className="oss-hero-section oss-hero-features">
        <div className="oss-hero-section-inner">
          <motion.h2
            className="oss-hero-section-title"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: '-80px' }}
            variants={fadeUp()}
          >
            核心能力
          </motion.h2>

          <div className="oss-hero-cards-grid">
            {[
              {
                icon: Users,
                title: '多 Agent 协作',
                desc: '文案策划 ✍️ + 视觉设计 🎨 + 流量分析 📊 三大 Agent 自动分工协作，各司其职，产出专业级商品图。',
              },
              {
                icon: Scissors,
                title: '智能 AI 抠图',
                desc: '一键上传商品照片，AI 自动识别主体并精准去背景，保留发丝级边缘细节，无需手动抠图。',
              },
              {
                icon: Palette,
                title: '无限协作画布',
                desc: '自由拖拽图层、添加文字、绘制标注，支持多人实时协作编辑，所见即所得的创作体验。',
              },
              {
                icon: null,
                title: '秒级出图',
                desc: '从输入需求到生成可投放电商主图，全流程自动化，三分钟内即可获得多套设计方案。',
              },
              {
                icon: ShoppingBag,
                title: '多场景覆盖',
                desc: '支持商品主图、详情页、A+ 页面、短视频封面等多种电商视觉场景一键生成。',
              },
              {
                icon: Download,
                title: '一键导出',
                desc: '支持 PNG / JPEG 多格式高清导出，自适应分辨率，直接对接各大电商平台上传要求。',
              },
            ].map((card, i) => (
              <motion.div
                key={i}
                className="oss-hero-card"
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: '-60px' }}
                variants={{
                  hidden: { opacity: 0, y: 32 },
                  visible: {
                    opacity: 1,
                    y: 0,
                    transition: { ...spring(i * 0.08) }
                  }
                }}
                whileHover={{ y: -4, boxShadow: '0 12px 32px rgba(0,0,0,0.06)' }}
              >
                <div className="oss-hero-card-icon">
                  <card.icon size={22} />
                </div>
                <h3 className="oss-hero-card-title">{card.title}</h3>
                <p className="oss-hero-card-desc">{card.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ Section 3: 工作流程 ═══ */}
      <section className="oss-hero-section oss-hero-workflow">
        <div className="oss-hero-section-inner">
          <motion.h2
            className="oss-hero-section-title"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: '-80px' }}
            variants={fadeUp()}
          >
            三步搞定
          </motion.h2>

          <div className="oss-hero-steps">
            {[
              {
                step: '01',
                icon: Upload,
                title: '上传商品',
                desc: '上传商品照片或描述商品信息，AI 自动识别品类特征与卖点。',
              },
              {
                step: '02',
                icon: Zap,
                title: 'AI 生成',
                desc: '多 Agent 自动协作，生成文案、设计视觉、评估优化，迭代至最佳效果。',
              },
              {
                step: '03',
                icon: ImagePlus,
                title: '导出投放',
                desc: '选择满意的方案，一键导出高清图片，直接上架各大电商平台。',
              },
            ].map((item, i) => (
              <motion.div
                key={i}
                className="oss-hero-step"
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: '-60px' }}
                variants={{
                  hidden: { opacity: 0, x: -24 },
                  visible: {
                    opacity: 1,
                    x: 0,
                    transition: { ...spring(i * 0.15) }
                  }
                }}
              >
                <div className="oss-hero-step-num">{item.step}</div>
                {item.icon && <div className="oss-hero-step-icon"><item.icon size={22} /></div>}
                <div className="oss-hero-step-text">
                  <h3>{item.title}</h3>
                  <p>{item.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ Section 4: CTA 底部 ═══ */}
      <section className="oss-hero-section oss-hero-footer">
        <motion.div
          className="oss-hero-footer-content"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-80px' }}
          variants={fadeUp()}
        >
          <h2>准备好开始了吗？</h2>
          <p>输入你的商品信息，AI 即刻为你生成专业级电商主图</p>
          <motion.button
            className="oss-hero-cta-btn"
            onClick={onEnter}
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.97 }}
          >
            免费开始设计
            <ArrowRight size={20} />
          </motion.button>
        </motion.div>
      </section>
    </div>
  );
}
