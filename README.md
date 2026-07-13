# AI Product Image Agent

AI 驱动的电商商品图智能生成、评估与编辑平台。用户通过自然语言对话即可生成专业级电商商品图，支持多类型图片、画布编辑、品牌记忆等完整工作流。
对标Lovart, 美图设计室等等生图agent

---

## 核心功能

- **自然语言生图**：说"生成一个保温杯的淘宝主图"即可自动生成，无需手动设置参数
- **统一 Agent 架构**：一次 LLM 调用完成意图理解 → 信息提取 → Prompt 编写 → 生图 → 评估，LLM 自主决策工作流程
- **8 种图片类型**：主图、图标、卖点图、对比图、场景卖点图、结构图、场景标签图、人物场景图
- **无限画布**：Konva.js 画布支持图层编辑、拖拽、缩放、局部重绘
- **本地抠图**：WebAssembly 浏览器端抠图，无需服务器算力
- **多尺寸套图**：支持 1:1、16:9、9:16 等主流电商平台尺寸
- **品牌记忆**：跨会话记住品牌名称、风格、配色偏好
- **RAG 知识库**：pgvector 向量检索，自动注入电商 Prompt 模板和风格指南
- **SSE 流式响应**：实时推送 Agent 思考过程、生图进度、评估结果

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
| **认证** | Better Auth (session cookie) |
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
  ├── Better Auth session 认证
  ├── Drizzle ORM + PostgreSQL (Neon)
  ├── Stripe 支付
  ├── 文件上传 (local / S3)
  └── /api/agent/*  ──SSE 透传──→  agent_service (FastAPI :8000)

agent_service (:8000) — Python FastAPI
  ├── agent_loop.py      # 统一 Agent 循环（一次 LLM 调用 + 工具自主决策）
  ├── prompts.py         # LLM 系统提示词
  ├── config.py          # 图片类型配置 + 工具函数
  ├── chat_client.py     # 多协议 LLM 客户端（OpenAI / Anthropic 兼容）
  ├── tools.py           # Agent 工具定义（generate_image, evaluate_image 等）
  ├── memory.py          # 结构化 AgentMemory（槽位填充，防止上下文膨胀）
  ├── pipeline.py        # 流水线编排 + 旧版兼容（AGENT_MODE=legacy）
  └── rag/               # RAG 知识库模块
      ├── embeddings.py      # OpenAI 兼容 Embedding
      ├── vector_store.py    # pgvector CRUD + 检索
      ├── retrieval.py       # 检索增强 + 上下文构建
      ├── knowledge_base.py  # Markdown 知识库管理
      └── knowledge/         # 商品图知识库 .md 文件
```

---

## Agent 工作流程

```
用户消息: "生成一个保温杯的淘宝头图"
         ↓
   run_unified_agent()
         ↓
   LLM + Tools (单次对话循环)
   ├── 理解意图: quick_generate
   ├── 提取信息: product_name=保温杯, platform=Taobao, type=main
   ├── 编写 Prompt: 专业英文电商摄影 prompt
   ├── 调用 generate_image → 豆包 Seedream API
   ├── 可选 evaluate_image → 质量评估
   └── 调用 finish_task → 返回结果
```

**核心原则**：绝不追问用户。只要有产品名就直接生成。缺失字段用合理默认值填充。

---

## 快速开始

### 环境要求

- Node.js 20+
- Python 3.12+
- PostgreSQL（需启用 pgvector 扩展）
- pnpm

### 1. 克隆项目

```bash
git clone https://github.com/YOUR_USERNAME/ai-product-image-agent.git
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
DEEPSEEK_CHAT_MODEL=deepseek-v4-flash

# AI 生图模型（豆包 Seedream）
DOUBAO_API_KEY=ark-xxx
DOUBAO_IMAGE_MODEL=doubao-seedream-5-0-260128

# AI 服务地址
AI_SERVICE_URL=http://localhost:8000

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

完整的环境变量见 `.env` 文件，关键变量：

| 变量 | 说明 |
|------|------|
| `DEEPSEEK_API_KEY` | 对话模型 API 密钥 |
| `DOUBAO_API_KEY` | 生图模型 API 密钥（豆包 Seedream） |
| `AI_SERVICE_URL` | Python AI 服务地址 |
| `DATABASE_URL` | PostgreSQL 连接串 |
| `AGENT_MODE` | `unified`（默认，新架构）或 `legacy`（旧流水线） |

---

## 项目结构

```
ai-product-image-agent/
  frontend/              # React 19 + Vite + Tailwind CSS v4
    src/
      components/        # UI 组件（InfiniteCanvas, ChatSidebar 等）
      hooks/             # 自定义 Hooks（useAgentStream 等）
      lib/               # 工具函数 + Supabase 客户端
  backend/               # Express 5 (Node.js)
    agent_service/       # FastAPI (Python) — AI Agent 微服务
    auth/                # Better Auth 认证
    db/                  # Drizzle ORM schema + migrations
    middleware/           # Express 中间件（错误处理、安全）
    routes/              # API 路由（auth, ai, agent, payment, assets）
  nginx/                 # Nginx 反代配置
  docker-compose.yml     # 多服务编排
```

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
