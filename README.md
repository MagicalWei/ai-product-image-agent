# AI Product Image Agent

AI 驱动的电商商品图智能生成、评估与编辑平台。用户通过自然语言对话即可生成专业级电商商品图，支持多类型图片、画布编辑、品牌记忆等完整工作流。

对标 Lovart、美图设计室等生图 Agent。

---

## 核心功能

- **自然语言生图**：说"生成一个保温杯的淘宝主图"即可自动生成，无需手动设置参数
- **双架构 Agent**：支持 sense-decide-act-review 单 Agent 四阶段循环和多 Agent 协作两种架构，通过 `AGENT_ARCHITECTURE` 环境变量切换
- **多 Agent 协作**：需求分析 → 竞品分析 → Prompt 撰写 → 生图 → 审查，5 个专职 Agent 通过 SharedContext 黑板协作
- **8 种图片类型**：主图、图标、卖点图、对比图、场景卖点图、结构图、场景标签图、人物场景图
- **商品套图生成**：根据商品原图一键生成主图、卖点图、详情图多尺寸套图
- **风格迁移**：上传参考图，自动分析色彩/灯光/构图/背景/情绪/字体等视觉语言，批量迁移到商品图
- **爆款结构复刻**：上传最长 60 秒的参考视频和新商品图片/视频，由多模态 Agent 拆解结构并生成原创复刻蓝图
- **真实图生视频**：商品图片先经 Seedance 生成动态镜头，再由 FFmpeg 完成拼接、字幕、音乐和 MP4 编码
- **真实阶段进度**：拆解期间显示环形进度，反馈素材校验、关键帧提取、多模态拆解、素材映射和蓝图保存阶段
- **智能剪辑**：支持视频裁剪、拼接、画幅转换、字幕、背景音乐、淡入淡出和异步任务恢复
- **无限画布**：Konva.js 画布支持图层编辑、拖拽、缩放、局部重绘、框选标注
- **区域编辑（Inpaint）**：框选局部区域，结合坐标+文字双锚定进行精确局部重绘
- **本地抠图**：WebAssembly 浏览器端抠图，无需服务器算力
- **品牌记忆**：跨会话记住品牌名称、风格、配色偏好
- **RAG 知识库**：pgvector 向量检索，自动注入电商 Prompt 模板和风格指南
- **SSE 流式响应**：实时推送 Agent 思考过程、生图进度、评估结果
- **画布版本树**：每次编辑自动创建新版本，支持撤销/回溯，不覆盖历史
- **会话持久化**：画布状态与会话绑定，断线重连自动恢复
- **SVG 导出**：画布内容导出为 SVG 矢量格式
- **邮箱验证码注册**：EmailJS 发送验证码，安全注册流程

---

## 界面截图

![工作台概览 - Agent 对话面板 + 无限画布](screenshots/screenshot-1.jpeg)

![商品图生成与画布编辑](screenshots/screenshot-2.jpeg)

![多类型图片生成结果](screenshots/screenshot-3.jpeg)

![无限画布多图编排](screenshots/screenshot-4.jpeg)

![Agent 工作流与图片预览](screenshots/screenshot-5.jpeg)

---

## 技术栈

| 层级 | 技术 |
|------|------|
| **前端** | React 19 + Vite + TypeScript + Tailwind CSS v4 |
| **画布** | react-konva (Konva.js) |
| **抠图** | @imgly/background-removal (WASM) |
| **后端 API** | Express 5 (Node.js) |
| **AI 微服务** | FastAPI (Python 3.12+) |
| **视频理解/生成** | 多模态模型 + 豆包 Seedance 图生视频 |
| **视频处理** | FFmpeg / FFprobe |
| **数据库** | PostgreSQL (Neon) + pgvector |
| **ORM** | Drizzle ORM (TypeScript) |
| **认证** | Better Auth (session cookie) + 邮箱验证码 |
| **支付** | Stripe |
| **AI 协议** | OpenAI 兼容（DeepSeek / GPT / 豆包 Seedream 均可接入） |
| **部署** | Docker Compose + Nginx 反代 |

---

## 架构概览

```
Nginx (:80)
  ├── /api/*  →  backend (Express :3000)
  └── /*      →  frontend (Vite :5173 dev / 静态文件 production)

Express backend (:3000)
  ├── Better Auth session 认证 + 邮箱验证码
  ├── Drizzle ORM + PostgreSQL (Neon)
  ├── Stripe 支付
  ├── 文件上传 (local / S3)
  ├── 视频任务、拆解进度和 FFmpeg 编排
  └── /api/agent/*  ──SSE 透传──→  agent_service (FastAPI :8000)

agent_service (:8000) — Python FastAPI
  ├── pipeline.py           # 流水线编排，按 AGENT_ARCHITECTURE 选择架构
  ├── agent_loop.py         # ReAct Agent 循环（unified，过渡期保留）
  ├── prompts.py            # LLM 系统提示词
  ├── config.py             # 图片类型配置 + 工具函数
  ├── chat_client.py        # 多协议 LLM 客户端（OpenAI / Anthropic 兼容），3 层 fallback
  ├── memory.py             # 结构化 AgentMemory（槽位填充，CanvasState 双向同步）
  └── rag/                  # RAG 知识库模块
      ├── embeddings.py         # OpenAI 兼容 Embedding
      ├── vector_store.py       # pgvector CRUD + 检索
      ├── retrieval.py          # 检索增强 + 上下文构建
      ├── knowledge_base.py     # Markdown 知识库管理
      └── knowledge/            # 商品图知识库 .md 文件

backend/utils/
  ├── videoAnalysis.js      # FFprobe 探测、关键帧提取与多模态视频分析
  └── videoFfmpeg.js        # 白名单剪辑计划校验与 FFmpeg 参数构建

agent/ — Python Agent 核心（sense-decide-act-review + multi-agent 双架构）
  ├── models.py             # Pydantic 模型（CanvasState, Layer, DesignBrief 等）
  ├── core/loop.py          # SenseDecideActReviewLoop 四阶段循环
  ├── canvas/               # 画布状态管理
  │   ├── state.py              # CanvasState 场景图
  │   ├── version_tree.py       # 版本树（支持撤销/回溯）
  │   ├── layer_ops.py          # 图层 CRUD 操作
  │   └── identity.py           # 画布身份绑定（session/product）
  ├── actions/              # Action Registry + Handler
  │   ├── registry.py          # 统一动作注册表
  │   └── handlers/            # 动作处理器
  │       ├── generate_layer.py        # 单图层生成
  │       ├── generate_product_set.py  # 商品套图批量生成
  │       ├── style_transfer_batch.py  # 风格迁移批量处理
  │       ├── inpaint_region.py        # 局部重绘
  │       ├── remove_background.py     # 抠图
  │       ├── compose.py               # 图层合成
  │       ├── upscale.py               # 超分辨率放大
  │       ├── layout_suggest.py        # 布局建议
  │       ├── search_knowledge.py      # 知识库搜索
  │       ├── plan_video_edit.py       # 智能剪辑方案
  │       ├── plan_viral_replication.py # 爆款结构复刻工作台计划
  │       └── generate_video_clip.py   # Seedance 商品图片转动态视频片段
  ├── review/               # 局部/全局审查 + 重试逻辑
  ├── intent/               # 输入预处理（分类/安全/上下文/澄清/prompt 扩写）
  ├── assets/               # Asset Store 接口
  └── multi_agent/          # 多 Agent 协作架构
      ├── shared_context.py     # SharedContext 黑板 + AgentRole + AgentMessage
      ├── base.py               # BaseAgent 抽象基类
      ├── workflow.py           # DAG 工作流 + 拓扑排序调度器
      ├── orchestrator.py       # MultiAgentOrchestrator 编排器
      └── agents/               # 5 个专职 Agent
          ├── requirement_collector.py  # 需求收集
          ├── competitor_analyst.py     # 竞品分析
          ├── prompt_writer.py          # Prompt 撰写
          ├── image_generator.py        # 生图
          └── reviewer.py               # 质量审查
```

---

## Agent 工作流程

### 架构一：sense-decide-act-review（默认）

```
用户消息 → SENSE → DECIDE → ACT → REVIEW → (循环)
             │        │        │        │
        意图分类   LLM选动作   执行动作   质量审查
        安全过滤   (从注册表)  (生图等)   (局部+全局)
        上下文拼装                       + 重试逻辑
```

单 Agent 四阶段循环，最大 10 轮迭代，单动作最多重试 2 次。

### 架构二：multi-agent（可选）

```
用户 → 编排 Agent (Orchestrator)
         │
         ├── 需求收集 Agent    ──→ SharedContext.design_brief
         │
         ├── 竞品分析 Agent    ──→ SharedContext.competitor_report  ←── 并行
         ├── RAG 知识检索      ──→ SharedContext.rag_context        ←── 并行
         │
         ├── Prompt 撰写 Agent ──→ SharedContext.final_prompts
         │
         ├── 生图 Agent         ──→ SharedContext.generated_images
         │
         └── 审查 Agent         ──→ SharedContext.review_results
```

5 个专职 Agent 通过 SharedContext 黑板协作，DAG 拓扑调度最大化并行度。

**切换方式**：设置 `AGENT_ARCHITECTURE=multi-agent`，默认 `sense-decide-act-review`。

---

## 智能剪辑与爆款结构复刻

### 工作流程

```text
参考视频 + 新商品图片/视频
          ↓
视频探测与关键帧提取
          ↓
多模态 Agent 拆解钩子、节奏、镜头、文案公式和 CTA
          ↓
将参考镜头映射到新商品素材，生成原创复刻蓝图
          ↓
用户确认蓝图
          ↓
商品图片 → Seedance 图生视频
商品视频 ───────────────┐
                       ↓
FFmpeg 拼接 + 分时字幕 + 音乐混流 + H.264/AAC 编码
                       ↓
成片写入仓库并关联当前账号和会话
```

### 拆解进度

“生成复刻蓝图”不是前端假进度。Express 会记录并按账号隔离以下真实后端阶段，前端通过进度接口更新环形进度：

1. 素材接收与视频信息校验
2. 参考视频关键帧提取
3. 新商品图片/视频读取
4. 多模态 Agent 拆解钩子、节奏与镜头
5. 新商品素材映射与蓝图保存
6. 蓝图完成（100%）

### 图生视频与 FFmpeg 的职责边界

- Seedance 负责让静态商品图片产生真实动态镜头。
- 生成提示词强制保持商品主体、结构、颜色、Logo、包装和可见文字一致，限制商品变形、闪烁和物体增减。
- FFmpeg 不冒充生成模型，只负责镜头裁剪/拼接、画幅适配、字幕、音频混流、淡入淡出和最终编码。
- 没有图片镜头时，任务保持原有纯视频 FFmpeg 工作流，不调用图生视频模型。
- 图片生成任务失败时返回具体的模型配置、权限、超时或下载错误，不静默降级成静态缩放。

### 当前限制

- 参考视频和单个商品视频最长 60 秒。
- 新商品图片与视频合计最多 8 个。
- 单个媒体文件最大 150MB；发送到图生视频模型的单张图片最大 20MB。
- 爆款复刻第一版固定输出 9:16，单个图片动态片段为 4–12 秒。
- 图生视频会产生模型调用费用。CI 和自动化测试使用模拟任务，不会主动提交付费生成。

---

## 快速开始

### 环境要求

- Node.js 20+
- Python 3.12+
- PostgreSQL（需启用 pgvector 扩展）
- pnpm

### 1. 克隆项目

```bash
git clone https://github.com/MagicalWei/ai-product-image-agent.git
cd ai-product-image-agent
```

### 2. 配置环境变量

在项目根目录创建 `.env` 文件：

> `.env` 已被 `.gitignore` 排除。不要把真实的数据库连接串、Ark Key、JWT Secret 或支付密钥提交到 GitHub；仓库只提交 `.env.example`。

```env
# 数据库
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require
DB_SSL=true

# JWT
JWT_SECRET=your_random_secret_here

# AI 对话模型（DeepSeek / OpenAI 兼容）
DEEPSEEK_API_KEY=sk-xxx
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_CHAT_MODEL=deepseek-chat

# AI 生图模型（豆包 Seedream）
DOUBAO_API_KEY=ark-xxx
DOUBAO_IMAGE_MODEL=doubao-seedream-5-0-lite-260128

# AI 图生视频（豆包 Seedance）
# VIDEO_API_KEY 留空时复用 DOUBAO_API_KEY
VIDEO_API_KEY=
VIDEO_API_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
VIDEO_MODEL=doubao-seedance-1-5-pro-251215
VIDEO_GENERATION_TIMEOUT_SECONDS=600

# AI 服务地址
AI_SERVICE_URL=http://localhost:8000

# Agent 架构（sense-decide-act-review | multi-agent）
AGENT_ARCHITECTURE=sense-decide-act-review

# EmailJS（邮箱验证码）
EMAILJS_SERVICE_ID=service_xxx
EMAILJS_TEMPLATE_ID=template_xxx
EMAILJS_PUBLIC_KEY=xxx
EMAILJS_ACCESS_TOKEN=xxx

# Stripe（可选）
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx

# 前端地址
CORS_ORIGIN=http://localhost:5173,http://localhost:3000
FRONTEND_URL=http://localhost:5173
```

### 3. 初始化数据库

```bash
cd backend
pnpm install
pnpm db:generate
pnpm db:migrate
```

### 4. 安装依赖

```bash
# 后端
cd backend && pnpm install

# 前端
cd frontend && pnpm install

# Python AI 服务
cd backend/agent_service && pip install -r requirements.txt
```

### 5. 启动开发服务

```bash
# 终端 1: Express 后端
cd backend && pnpm dev

# 终端 2: Python AI 服务
cd backend/agent_service && python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# 终端 3: 前端
cd frontend && pnpm dev
```

访问 `http://localhost:5173` 开始使用。

### Docker 部署

```bash
docker-compose up -d
```

---

## 环境变量

| 变量 | 说明 |
|------|------|
| `AGENT_ARCHITECTURE` | Agent 架构选择：`sense-decide-act-review`（默认）或 `multi-agent` |
| `DEEPSEEK_API_KEY` | 对话模型 API 密钥 |
| `DOUBAO_API_KEY` | 生图模型 API 密钥（豆包 Seedream） |
| `VIDEO_API_KEY` | 可选的独立图生视频密钥；未配置时复用 `DOUBAO_API_KEY` |
| `VIDEO_API_BASE_URL` | Ark 图生视频任务 API 地址，默认 `https://ark.cn-beijing.volces.com/api/v3` |
| `VIDEO_MODEL` | 图生视频模型，默认 `doubao-seedance-1-5-pro-251215` |
| `VIDEO_GENERATION_TIMEOUT_SECONDS` | 单个图生视频任务轮询超时，默认 600 秒 |
| `AI_SERVICE_URL` | Python AI 服务地址 |
| `DATABASE_URL` | PostgreSQL 连接串 |
| `EMAILJS_*` | EmailJS 邮箱验证码服务配置 |
| `CHAT_FALLBACK_1/2_*` | LLM fallback 链配置 |
| `IMAGE_FALLBACK_1/2/3_*` | 生图 fallback 链配置（DALL-E / Anthropic SVG） |

---

## 测试

```bash
# Python Agent 测试
pytest tests/ -v

# 视频计划与前端单元测试
npx vitest run --config tests/vitest.config.js

# 前端生产构建与代码检查
npm --prefix frontend run build
./frontend/node_modules/.bin/eslint frontend/src/components/ViralReplicationWorkbench.jsx

# 前端 E2E 测试
./test_e2e.sh
```

---

## 项目路线图

| 阶段 | 内容 | 状态 |
|------|------|------|
| Phase 0 | 项目脚手架（Vite + Express + Drizzle + PostgreSQL） | ✅ |
| Phase 1 | 认证系统（Better Auth + 邮箱验证码） | ✅ |
| Phase 2 | 核心布局（Workspace + Agent 面板 + Konva 画布） | ✅ |
| Phase 3 | Agent 对话 + 图片生成（火山引擎 Seedream） | ✅ |
| Phase 4 | 文案 Agent（Plan → ReAct → Reflection + SSE） | 🔜 |
| Phase 5 | RAG 知识库（pgvector + Embedding + 检索增强） | ✅ |
| Phase 6 | 画布集成（Konva + WASM 抠图 + 图层编辑 + 版本树） | ✅ |
| Phase 7 | 支付（Stripe checkout + webhook） | ✅ |
| Phase 8 | 智能剪辑 + 爆款结构复刻 + Seedance 图生视频 | ✅ |
| Phase 9 | 收尾（错误处理、内容审核、品牌安全） | 🔜 |

---

## 与竞品对比

| 维度 | AI Product Image Agent | Lovart | 美图设计室 |
|------|----------------------|--------|-----------|
| 多 Agent 协作 | ✅ 2 种架构可选 | ❌ 单一流水线 | ❌ 单一流水线 |
| 画布编辑 | ✅ Konva 无限画布 + 版本树 | ✅ 基础画布 | ✅ 画布编辑 |
| 风格迁移 | ✅ 参考图视觉分析 + 批量迁移 | ❌ | ❌ |
| 商品套图 | ✅ 一键多尺寸多类型 | ✅ | ✅ |
| 局部重绘 | ✅ 坐标+文字双锚定 Inpaint | ❌ | ❌ |
| 竞品分析 | ✅ LLM 自动分析 | ❌ | ❌ |
| RAG 知识库 | ✅ pgvector | ❌ | ❌ |
| 自动审查 | ✅ VLM + 规则双重 | ❌ | ❌ |
| 会话持久化 | ✅ 画布状态 + 断线恢复 | ❌ | ❌ |
| 视频结构复刻 | ✅ 多模态拆解 + 图生视频 + FFmpeg | ❌ | ❌ |
| 开源 | ✅ 完全开源 | ❌ 闭源 SaaS | ❌ 闭源 SaaS |
