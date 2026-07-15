# AI Product Image Agent

AI 驱动的电商商品图智能生成、评估与编辑平台。用户通过自然语言对话即可生成专业级电商商品图，支持多类型图片、画布编辑、品牌记忆等完整工作流。

对标 Lovart、美图设计室等生图 Agent。

---

## 核心功能

- **自然语言生图**：说"生成一个保温杯的淘宝主图"即可自动生成，无需手动设置参数
- **双架构 Agent**：支持 sense-decide-act-review 单 Agent 四阶段循环和多 Agent 协作两种架构，通过 `AGENT_ARCHITECTURE` 环境变量切换
- **多 Agent 协作**：需求分析 → 竞品分析 → Prompt 撰写 → 生图 → 审查，5 个专职 Agent 通过 SharedContext 黑板协作
- **8 种图片类型**：主图、图标、卖点图、对比图、场景卖点图、结构图、场景标签图、人物场景图
- **无限画布**：Konva.js 画布支持图层编辑、拖拽、缩放、局部重绘、框选标注
- **本地抠图**：WebAssembly 浏览器端抠图，无需服务器算力
- **多尺寸套图**：支持 1:1、16:9、9:16 等主流电商平台尺寸
- **品牌记忆**：跨会话记住品牌名称、风格、配色偏好
- **RAG 知识库**：pgvector 向量检索，自动注入电商 Prompt 模板和风格指南
- **SSE 流式响应**：实时推送 Agent 思考过程、生图进度、评估结果
- **邮箱验证码注册**：EmailJS 发送验证码，安全注册流程

---

## 技术栈

| 层级 | 技术 |
|------|------|
| **前端** | React 19 + Vite + TypeScript + Tailwind CSS v4 |
| **画布** | react-konva (Konva.js) |
| **抠图** | @imgly/background-removal (WASM) |
| **后端 API** | Express 5 (Node.js) |
| **AI 微服务** | FastAPI (Python 3.12+) |
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
  └── /api/agent/*  ──SSE 透传──→  agent_service (FastAPI :8000)

agent_service (:8000) — Python FastAPI
  ├── pipeline.py           # 流水线编排，按 AGENT_ARCHITECTURE 选择架构
  ├── agent_loop.py         # 统一 Agent 循环（unified，已废弃）
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

agent/ — Python Agent 核心（sense-decide-act-review + multi-agent 双架构）
  ├── models.py             # Pydantic 模型（CanvasState, Layer, DesignBrief 等）
  ├── core/loop.py          # SenseDecideActReviewLoop 四阶段循环
  ├── canvas/               # 画布状态管理（state, version_tree, layer_ops）
  ├── actions/              # Action Registry + Handler（generate_layer, inpaint 等）
  ├── review/               # 局部/全局审查 + 重试逻辑
  ├── intent/               # 输入预处理（分类/安全/上下文/澄清/prompt 扩写）
  ├── assets/               # Asset Store 接口
  └── multi_agent/          # 多 Agent 协作架构（NEW）
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
DOUBAO_IMAGE_MODEL=doubao-seedream-5-0-260128

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
| `AI_SERVICE_URL` | Python AI 服务地址 |
| `DATABASE_URL` | PostgreSQL 连接串 |
| `EMAILJS_*` | EmailJS 邮箱验证码服务配置 |
| `CHAT_FALLBACK_1/2_*` | LLM fallback 链配置 |
| `IMAGE_FALLBACK_1/2/3_*` | 生图 fallback 链配置（DALL-E / Anthropic SVG） |

---

## 测试

```bash
# Python Agent 测试
cd backend/agent_service
python test_pipeline.py

# 前端测试
cd frontend
npx vitest run
```

---

## 与竞品对比

| 维度 | AI Product Image Agent | Lovart | 美图设计室 |
|------|----------------------|--------|-----------|
| 多 Agent 协作 | ✅ 2 种架构可选 | ❌ 单一流水线 | ❌ 单一流水线 |
| 画布编辑 | ✅ Konva 无限画布 | ✅ 基础画布 | ✅ 画布编辑 |
| 竞品分析 | ✅ LLM 自动分析 | ❌ | ❌ |
| RAG 知识库 | ✅ pgvector | ❌ | ❌ |
| 自动审查 | ✅ VLM + 规则双重 | ❌ | ❌ |
| 开源 | ✅ 完全开源 | ❌ 闭源 SaaS | ❌ 闭源 SaaS |
