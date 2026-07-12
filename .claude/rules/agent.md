# 项目规则：Agent + Canvas 生图系统

本文件为 Claude Code / Cursor 等编码工具提供项目级约束。所有涉及 agent 核心逻辑、画布状态、图层操作的代码改动，必须遵守以下规则。

## 0. 项目定位

这是一个类似 Lovart / 美图设计室的生图 Agent，核心架构为 **sense-decide-act-review** 循环 + **持久化画布状态（scene graph）**。这不是"prompt → image"的单步工具，而是一个带状态的多图层编排系统。

技术栈：Python / FastAPI（后端）/ Gradio（前端）/ OpenAI SDK 直连（不经中间框架）。

---

## 1. 架构总则（必须遵守）

1. **核心循环禁止使用 LangChain / LangGraph / AutoGen 等 agent 框架封装。** sense-decide-act-review 循环、画布状态管理、动作路由必须用原生 Python 实现（class + 状态机 / dataclass），保持完全可控可调试。
2. **LLM 调用一律直接使用 OpenAI SDK**，不经任何中间抽象层。decide 阶段的结构化输出使用 `response_format={"type": "json_schema", ...}` 或 function calling，不手写正则解析模型输出。
3. **画布状态是唯一事实来源（single source of truth）。** 任何图像操作前必须先读 canvas state，操作后必须先更新 state 再返回结果。禁止绕过 state 直接操作图片文件。
4. 允许在非核心逻辑（如第三方服务集成、通用工具函数）中使用现成库，但**图层编排、场景图、review 判断逻辑禁止外包给框架**。

---

## 2. 画布状态（Canvas State / Scene Graph）规则

### 2.1 数据结构
- 画布状态必须是**场景图结构**，不是单张最终图片。最小字段：

```python
class Layer(BaseModel):
    id: str
    type: Literal["background", "subject", "text", "decoration"]
    z_index: int
    bbox: BoundingBox          # 位置与尺寸
    asset_ref: str             # 指向 Asset Store 的引用，不直接存图片数据
    prompt_used: str | None
    style_tags: list[str] = []
    status: Literal["draft", "generating", "ready", "failed"]

class CanvasState(BaseModel):
    canvas_id: str
    size: tuple[int, int]
    layers: list[Layer]
    global_style: dict          # 主色调、光源方向等跨图层约束
    version: int
    parent_version: int | None  # 支持版本树/回溯
```

- 所有状态定义用 Pydantic，禁止用裸 dict 在模块间传递画布状态。

### 2.2 版本管理
- **每次编辑操作产生新版本，不覆盖旧版本。** `version` 自增，`parent_version` 指向来源，形成可回溯的版本树。
- 撤销/重新分支操作只需切换 `current_version` 指针，不删除历史节点。
- 版本快照持久化到 Asset Store（先用 SQLite/JSON 文件即可，接口需预留替换为数据库的空间）。

### 2.3 局部编辑原则
- 用户提出"改这一块/换个颜色"类指令时，**只更新对应 Layer，不重新生成整个画布**。
- 修改单个图层后，必须检查是否需要触发**全局一致性审查**（见第 4 节），而不是默认跳过。

---

## 3. 动作空间（Action Space）规则

### 3.1 注册方式
- 所有可执行动作必须在统一的 Action Registry 中注册，禁止在业务代码里硬编码工具调用逻辑：

```python
ACTION_REGISTRY: dict[str, ActionHandler] = {
    "generate_layer": generate_layer_fn,
    "inpaint_region": inpaint_region_fn,
    "remove_background": remove_background_fn,
    "compose": compose_fn,
    "upscale": upscale_fn,
    "layout_suggest": layout_suggest_fn,
}
```

- 每个 handler 签名统一：`async def handler(params: BaseModel, canvas: CanvasState) -> ActionResult`。
- decide 阶段只允许从 Registry 中已注册的动作里选择，不允许模型输出自由文本再二次解析成动作。

### 3.2 新增动作的要求
- 新增一个 action 时必须同时提供：输入 schema（Pydantic）、输出 schema、对应的单元测试、以及在本文件动作清单中登记。
- 动作函数内部不得直接操作全局状态，必须通过传入的 `canvas: CanvasState` 读写，返回新状态而非原地修改（不可变优先，除非有明确性能理由）。

---

## 4. Review / 重试规则

### 4.1 两级审查（不可只做一级）
- **局部审查**：单图层是否达标（是否符合 prompt、清晰度、是否有明显瑕疵）。
- **全局审查**：合成后整体是否协调（配色一致性、遮挡关系、留白是否合理）。
- 任何涉及多图层合成的操作，全局审查不可跳过；单图层生成/局部编辑可以只做局部审查。

### 4.2 重试逻辑
- **禁止"不满意就整体重来"的重试方式。** 重试前必须先输出失败/不满意的具体原因（结构化，如 `{"issue": "color_mismatch", "layer_id": "..."}`），再针对性调整对应参数重试。
- 重试次数需设上限（默认 2 次），超过上限后将问题和候选结果都返回给用户，不静默兜底。

### 4.3 审查用模型
- Review 阶段使用轻量 VLM，不默认调用最贵的多模态模型。仅在连续失败或用户主动要求"精细检查"时升级模型。

---

## 5. 意图理解 / 输入预处理规则

- 用户输入禁止直接透传给生成 prompt。必须经过：**输入分类 → 安全过滤 → 上下文拼装 → （按需）澄清 → prompt 扩写**，才能进入图像模型。
- 输入分类（新建 / 编辑 / 参考图上传 / 澄清回复）用轻量模型或规则完成，不占用主力模型调用。
- 是否需要多轮澄清由完整度打分决定，不做无条件追问：

```python
def needs_clarification(brief: DesignBrief) -> bool:
    required = ["subject", "use_case", "style_hint"]
    return any(not getattr(brief, k, None) for k in required)
```

- 安全过滤（真人肖像/版权角色/敏感内容）必须在预处理阶段前置拦截，不依赖图像模型自身的安全机制兜底。

---

## 6. 图片上传分析与设计建议模块

### 6.1 数据流
- 用户上传图片后，原图**原样存入 Asset Store，不做任何压缩/缩放**，后续所有环节引用该 asset_ref，不重新上传副本。
- VLM 读取原图，输出**结构化**设计建议（`DesignSuggestion`），不是自由文本。自由文本无法驱动后续 UI 渲染建议卡片，也无法被 decide 阶段直接消费。

```python
class DesignSuggestion(BaseModel):
    detected_subject: str
    current_issues: list[str]        # 如"背景杂乱"、"主体占比过小"
    suggested_layers: list[str]      # 建议拆分出的图层，如 ["背景","产品主体","卖点文字","促销角标"]
    suggested_crop: BoundingBox | None
    style_notes: dict                # 主色调、光线方向等，供后续图层生成时保持一致
    category_template_hint: str | None  # 命中的电商品类模板，如 "白底产品图"、"场景种草图"
```

### 6.2 电商场景不可完全依赖模型自由发挥
- 电商主图/详情图有行业惯例（白底占比、留白位置、角标规则、首图信息密度等），这些**用规则+模板先验实现，不指望 VLM 每次都记得**。
- 品类模板库需与 `suggested_layers` 对齐，模板命中后，生成阶段的图层拆分应直接复用模板结构，而不是让 decide 阶段重新规划一遍。

---

## 7. 标注框选与原图绑定（Region-Grounded Instruction）

### 7.1 核心原则
**标注框选操作只产生坐标元数据，不生成新图片、不裁剪、不栅格化。** 用户框选 + 下一次发送 prompt 时，打包给生成 agent 的必须是"原图引用 + bbox 坐标 + 文本"的组合，而不是一张"看起来像框选结果"的新图。这是避免多轮迭代后画质劣化的关键约束，不可为了实现方便而妥协。

### 7.2 数据结构

```python
class Annotation(BaseModel):
    id: str
    canvas_id: str
    source_asset_ref: str     # 指向原图 asset，禁止指向任何裁剪/截图版本
    bbox: BoundingBox         # 原图像素坐标系下的框选区域
    note: str | None          # 用户框选时附带的文字说明
    created_at: datetime
```

### 7.3 规则
1. 前端画布展示的图片可能是缩放后的预览，**用户画框产生的屏幕坐标必须在写入 Annotation 前换算回原图分辨率坐标**，不允许存储屏幕坐标。这是保证不失真的关键环节，换算逻辑需要单独测试覆盖。
2. 一次会话中可能产生多个 annotation，需在请求上下文中维护 annotation 列表（而非只保留最新一个），除非用户明确表示只针对某一个框操作。
3. 用户发送下一条 prompt 时，intent 预处理层组装的 payload 必须包含：`source_asset_ref`（原图，完整分辨率）+ 对应 annotation 的 `bbox` + `note` + 本次 prompt 文本。**禁止在此步骤对图片做任何裁剪、压缩或重新编码。**
4. **"理解"与"生成"必须使用不同版本的图片，不可共用一份：**
   - **理解阶段（VLM 判断用户意图）**：可以在原图基础上叠加一层不改变底层像素的半透明标记框，帮助模型直观定位，仅供模型"看"，不作为生成输入保存。
   - **生成/编辑执行阶段（inpaint 等）**：必须使用纯原图 + 精确 bbox 转换出的 mask，禁止使用叠加了标记框的版本，避免框线像素混入生成结果。
5. 多轮框选累积编辑时，每次操作后画布状态按第 2 节的版本树规则生成新版本，`source_asset_ref` 始终指向未被历次编辑污染的原始底图（除非用户操作的目标就是替换底图本身）。

### 7.4 兜底方案：坐标数值 + 区域文字描述

- 视觉标记框依赖模型的 grounding 能力，在复杂图片或小尺寸目标上定位可能不准。**当叠加标记框方案的理解准确率不达标时，启用兜底方案**：不再依赖模型"看图上的框"，而是显式传入坐标数值 + 该区域内容的文字描述，双重锚定。

```python
class RegionGroundingPayload(BaseModel):
    source_asset_ref: str        # 原图引用，完整分辨率
    bbox_normalized: BoundingBox # 归一化坐标 (0~1)，避免不同分辨率下数值误解
    bbox_pixel: BoundingBox      # 原图像素坐标，供下游生成/mask 精确使用
    region_caption: str          # 该区域内容的文字描述，由 VLM 预先生成或由用户 note 补充
    user_note: str | None
```

- `region_caption` 由系统在 annotation 创建时**提前生成一次并缓存**（对该 bbox 区域单独跑一次轻量图像理解，生成简短文字描述，如"图片左下角的红色手提包提手部分"），不要等到用户发 prompt 时才现场生成，避免延迟。
- 组装给 decide/生成阶段的最终 payload 中，`bbox_normalized`、`bbox_pixel`、`region_caption` 三者必须同时提供，不能只传坐标数值而省略文字描述（纯数值对模型不直观，容易理解错区域），也不能只传文字描述而省略坐标（会退化成模糊的整图理解，失去精确框选的意义）。
- 是否启用兜底方案（叠加标记框 vs 坐标+文字双锚定）由 review 阶段的历史准确率决定，两种方案不互斥，可以在同一次请求中同时提供，供生成模型综合参考，具体是否双发默认由配置开关控制，不写死在代码逻辑里。

---

## 8. 目录结构约定

```
/agent
  /core           # sense-decide-act-review 循环主体，纯 Python，无框架依赖
  /canvas         # CanvasState、Layer、版本树管理
  /actions        # Action Registry + 各 handler 实现
  /review         # 局部/全局审查逻辑
  /intent         # 输入预处理、意图澄清、prompt 扩写
  /assets         # Asset Store 接口（当前 SQLite/JSON，预留数据库替换）
/api              # FastAPI 路由层，只做请求转发和序列化，不含业务逻辑
/ui               # Gradio 前端
/tests
```

- 业务逻辑不得写在 `/api` 或 `/ui` 层，这两层只做输入输出适配。

---

## 9. 禁止事项清单

- ❌ 用 LangChain/LangGraph 封装 sense-decide-act-review 主循环
- ❌ 画布状态用裸 dict 或直接操作图片文件跳过 state 层
- ❌ 局部编辑触发整画布重新生成
- ❌ Review 只做单一层级（只查局部或只查全局)
- ❌ 重试不带诊断信息、无限重试或静默重试
- ❌ 用户原始输入不经预处理直接拼入生成 prompt
- ❌ 在 `/api` 或 `/ui` 层写业务逻辑
- ❌ 框选/标注后把渲染结果截图或裁剪成新图片再发给生成 agent
- ❌ 前端画布坐标不经换算直接当作原图坐标存储
- ❌ 用叠加了标记框的图片版本直接作为 inpaint/生成的输入
- ❌ VLM 输出的设计建议用自由文本而非结构化 schema
- ❌ 坐标兜底方案只传数值不传区域文字描述，或只传文字描述不传坐标
- ❌ `region_caption` 在用户发送 prompt 时才现场生成（应在 annotation 创建时预生成并缓存）

---

## 10. 变更本规则

对以上规则的任何调整（尤其是第 1、2、3 节的架构性约束）需要在 PR 描述中说明理由，不可直接在代码里绕开规则实现。