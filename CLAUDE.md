# ai-product-image-agent

AI Agent 工作指令。产品需求详见 [PRD.md](./PRD.md)。

## 核心规则

1. 如果有任何不确定，请列出问题清单让我确认，不要猜测。
2. 这是真正的可上线产品，不是 Demo。对每一处细节严格把控，GUI 界面符合人类美学。
3. 所有 AI 模型调用统一使用 OpenAI 兼容协议，方便后续做模型评估和选型。

## 项目结构

```
ai-product-image-agent/
  frontend/           # React 19 + Vite + Tailwind CSS v4
  backend/            # Express 5 (Node.js) — 认证/DB/支付/文件上传
    agent_service/    # FastAPI (Python) — AI Agent 微服务
    db/               # Drizzle ORM schema + migrations
    routes/           # Express API 路由
    auth/             # Better Auth 认证
  nginx/              # Nginx 反代配置
  docker-compose.yml  # 多服务编排
  PRD.md              # 产品需求文档
  CLAUDE.md           # 本文件
```

## 技术决策

| 维度 | 选型 |
|------|------|
| 前端框架 | React 19 + Vite + Tailwind CSS v4 |
| 路由 | react-router-dom (HashRouter) |
| 画布 | react-konva (Konva.js) |
| 抠图 | @imgly/background-removal (WASM) |
| 后端框架 | Express 5 (Node.js) + FastAPI (Python) AI 微服务 |
| AI 协议 | OpenAI 兼容（所有模型调用统一） |
| 图片生成 | 火山引擎 API（Seedream，OpenAI 兼容） |
## Agent 架构 (agent.md rules)

sense-decide-act-review 四阶段循环 + 场景图画布状态。详见 `.claude/rules/agent.md`。

```
前端 → pipeline.py → agent/core/loop.py  (或 agent_loop.py，通过 AGENT_ARCHITECTURE 切换)
                        ├── SENSE:  agent/intent/{classifier, safety_filter, context_assembler, clarifier, prompt_expander}
                        ├── DECIDE: LLM 结构化输出，从 ACTION_REGISTRY 选择动作
                        ├── ACT:    agent/actions/{registry, handlers/{generate_layer, inpaint_region, ...}}
                        └── REVIEW: agent/review/{local_review, global_review, retry_logic}

画布状态: agent/canvas/{state, version_tree, layer_ops} → CanvasState (Pydantic scene graph)
模型定义: agent/models.py
资源存储: agent/assets/store.py (JSON files, DB-replaceable interface)
```

**架构切换**: 环境变量 `AGENT_ARCHITECTURE`:
- `"unified"` (默认): 单 LLM tool-calling 循环 (`agent_loop.py`)
- `"sense-decide-act-review"`: 新四阶段循环 (`agent/core/loop.py`)

### 架构迁移状态（强制约束，优先级高于本文件其他描述）

当前处于从 `unified` 迁移到 `sense-decide-act-review` 的过渡期，规则如下：

1. **新功能一律只允许在 `agent/` 目录下按 sense-decide-act-review 架构实现**，
   禁止在 `pipeline.py`、`agent_loop.py`、`tools.py` 中新增任何逻辑。
2. `agent_loop.py`、`tools.py` 仅允许修复线上 bug，不接受任何 feature 改动。
   修 bug 时如果发现同样的能力新架构还没有，必须同步在 `agent/actions/`
   下补齐对应 action，而不是只修旧代码。
3. `AGENT_ARCHITECTURE` 默认值切换为 `sense-decide-act-review` 的前置条件：
   新架构需先完整覆盖 RAG 检索接入（`agent/intent/prompt_expander` 对接
   `rag/retrieval.py`）、CanvasState 与 memory 的同步逻辑解耦。
4. 默认值切换后，`unified` 路径进入两周观察期，期间只读不改；
   观察期结束后删除 `agent_loop.py`、`tools.py`、`pipeline.py` 中的旧分支。
5. 任何 PR 如果修改了 `pipeline.py` / `agent_loop.py` / `tools.py`，
   必须在 PR 描述中说明"为什么这个改动无法在 `agent/` 下实现"，
   否则视为违反规则，驳回重做。

| 向量数据库 | pgvector (PostgreSQL 扩展) |
| 数据库 | PostgreSQL (Neon) |
| ORM | Drizzle ORM (TypeScript) |
| 认证 | Better Auth（session cookie + bcryptjs） |
| 支付 | Stripe npm (Node.js) |
| 部署 | Docker Compose + Nginx 反代 |

## 架构概览

```
Nginx (:80)
  ├── /api/*  →  backend (Express :3000)
  └── /*      →  frontend (Vite :5173 开发 / 静态文件 生产)

Express backend (:3000)
  ├── Better Auth session 认证
  ├── Drizzle ORM + PostgreSQL (Neon)
  ├── Stripe 支付
  ├── 文件上传 (local/S3)
  └── /api/agent/*  →  agent_service (FastAPI :8000)

agent_service (:8000) — Python FastAPI
  ├── pipeline.py        # Agent 流水线（双架构：unified / sense-decide-act-review）
  ├── agent_loop.py      # ReAct Agent 循环（unified 架构，deprecated 过渡期保留）
  ├── prompts.py         # LLM 系统提示词（含 sense/decide/review 专用 prompt）
  ├── config.py          # 图片类型配置 + 工具函数
  ├── chat_client.py     # 多协议 LLM 客户端
  ├── tools.py           # Agent 工具定义（unified 架构，过渡期保留）
  ├── memory.py          # Agent 会话记忆（含 CanvasState 双向同步）
  └── rag/               # RAG 知识库模块
      ├── embeddings.py      # OpenAI 兼容 Embedding
      ├── vector_store.py    # pgvector CRUD + 检索
      ├── retrieval.py       # 检索增强 + 上下文构建
      ├── knowledge_base.py  # Markdown 知识库管理
      └── knowledge/         # 商品图知识库 .md 文件

agent/ — 新四阶段架构（sense-decide-act-review）
  ├── models.py          # Pydantic 模型定义（CanvasState, Layer, DesignBrief 等）
  ├── core/loop.py       # SenseDecideActReviewLoop 主循环
  ├── canvas/            # 画布状态管理（state, version_tree, layer_ops）
  ├── actions/           # Action Registry + Handler 实现
  ├── review/            # 局部/全局审查 + 重试逻辑
  ├── intent/            # 输入预处理管道（分类/安全/上下文/澄清/prompt扩写）
  └── assets/            # Asset Store 接口（JSON 文件，预留 DB 替换）
```

## 实施阶段

### Phase 0: 项目脚手架 ✅
- Vite + React 19 + TypeScript + Tailwind CSS v4
- Express 5 + Drizzle ORM + PostgreSQL (Neon)
- Vite proxy `/api` → `:3000`

### Phase 1: 认证系统 ✅
- Better Auth session cookie 注册/登录/鉴权

### Phase 2: 核心布局 ✅
- Workspace 页面：左侧 Agent 面板 + 右侧 Konva 画布
- 路由落地

### Phase 3: Agent 对话 + 图片生成 ✅
- Agent 对话协议（text / question / recommendation / image_result / harness / copy_result）
- 火山引擎 API 封装
- 图片生成 → 自动入画布 + 编号

### Phase 4: 文案 Agent 🔜
- Plan → ReAct → Reflection 三阶段
- SSE streaming 输出

### Phase 5: RAG 知识库 ✅
- pgvector + Embedding + 余弦相似度检索
- 商品图知识库：Prompt 模板 / 风格指南 / 平台规则 / 文案模板
- 集成到 Agent Think 阶段，注入检索上下文提升 prompt 质量

### Phase 6: 画布集成 ✅
- Konva 画布 + 抠图(WASM) + 图层编辑

### Phase 7: 支付 ✅
- Stripe checkout + webhook

### Phase 8: 收尾 🔜
- 错误处理、loading、空状态、响应式
- 内容审核、幻觉防护、品牌安全检查

## Harness Engineering

Agent 系统的可靠性和安全护栏：

### 可观测性
- Agent 对话链路全量落库，记录每次 LLM 调用（prompt / response / latency / token_usage）
- 关键节点打日志：状态切换、API 调用、异常重试

### 安全护栏 🔜
- 内容审核：生成图片和文案在返回前端前，检查是否包含违规内容（色情/暴力/政治敏感）
- 幻觉防护：文案生成后，检查是否虚构了产品不存在的功能，与用户输入的卖点交叉验证
- 品牌安全：检查生成内容是否包含竞品名称或不恰当的关联

### 异常处理
- 火山引擎 API 降级：调用失败 → fallback 链（DALL-E 3 → DALL-E 2 → Anthropic SVG）
- ReAct Agent 循环保护：最大迭代次数 10 轮，超过则强制终止并返回当前最优结果
- Token 过期：401 响应 → 前端清除 session → 跳转 /login

### 性能目标
- 图片生成 ≤ 15s
- 文案 Agent ≤ 30s
- 前端首屏 ≤ 3s
- 画布 ≥ 30fps

## 代码规范

- 前端：TypeScript strict mode，组件按功能拆文件，避免单个文件 > 300 行
- 后端 (Express)：路由按功能分文件，中间件统一错误处理
- 后端 (Python)：Python 3.12+，async/await 全链路，Pydantic 做请求/响应模型校验
- 所有 API 路由统一前缀 `/api/`
- 环境变量：前端 `VITE_*` 前缀，后端 `.env` 文件
- 错误信息对用户友好，不暴露内部调用栈
