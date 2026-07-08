import swaggerJsdoc from 'swagger-jsdoc';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'AI 广告画板 API',
      version: '1.0.0',
      description: 'AI Product Image Agent — 智能电商商品图生成平台后端 API 文档',
    },
    servers: [
      { url: 'http://localhost:3000', description: '本地开发环境' },
      { url: 'https://ai-product-image-agent.example.com', description: '生产环境' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: '在登录或注册接口获取 token，格式: Bearer <token>',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string', description: '错误码' },
            message: { type: 'string', description: '错误描述' },
          },
        },
        User: {
          type: 'object',
          properties: {
            uid: { type: 'string' },
            email: { type: 'string' },
            membership_type: { type: 'string', enum: ['free', 'pro', 'enterprise'] },
            billing_cycle: { type: 'string', enum: ['none', 'monthly', 'annual'] },
            remaining_credits: { type: 'integer' },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        Order: {
          type: 'object',
          properties: {
            order_id: { type: 'string' },
            status: { type: 'string', enum: ['pending', 'success', 'failed', 'cancelled'] },
            amount: { type: 'number' },
            credits: { type: 'integer' },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        Asset: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            uid: { type: 'string' },
            name: { type: 'string' },
            url: { type: 'string' },
            size: { type: 'string' },
            date: { type: 'string' },
            metrics: { type: 'object', nullable: true },
          },
        },
        Session: {
          type: 'object',
          properties: {
            session_id: { type: 'string' },
            uid: { type: 'string' },
            title: { type: 'string' },
            current_state: { type: 'string' },
            chat_history: { type: 'array', items: { type: 'object' } },
            last_params: { type: 'object' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        BrandMemory: {
          type: 'object',
          properties: {
            brand_name: { type: 'string' },
            style: { type: 'string' },
            color_palette: { type: 'array', items: { type: 'string' } },
            typography: { type: 'string' },
            logo_url: { type: 'string' },
            product_name: { type: 'string' },
            product_category: { type: 'string' },
            selling_points: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
    paths: {
      // ─── Auth (8) ────────────────────────────────────────────────────
      '/api/auth/send-code': {
        post: {
          tags: ['Auth'],
          summary: '发送邮箱验证码',
          description: '向指定邮箱发送 6 位验证码，有效期 5 分钟。',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['email'],
                  properties: { email: { type: 'string', format: 'email' } },
                },
              },
            },
          },
          responses: {
            200: { description: '验证码已发送' },
            400: { description: '邮箱格式无效' },
            500: { description: '邮件服务未配置或发送失败' },
          },
        },
      },
      '/api/auth/register': {
        post: {
          tags: ['Auth'],
          summary: '用户注册',
          description: '使用邮箱、密码和验证码注册新账户，返回 JWT token。',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['email', 'password', 'code'],
                  properties: {
                    email: { type: 'string', format: 'email' },
                    password: { type: 'string', minLength: 6 },
                    code: { type: 'string', description: '6 位邮箱验证码' },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: '注册成功，返回用户信息和 token' },
            400: { description: '验证码错误或邮箱已注册' },
          },
        },
      },
      '/api/auth/login': {
        post: {
          tags: ['Auth'],
          summary: '用户登录',
          description: '使用邮箱和密码登录，返回 JWT token。',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['email', 'password'],
                  properties: {
                    email: { type: 'string', format: 'email' },
                    password: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: '登录成功，返回用户信息和 token' },
            400: { description: '邮箱或密码错误' },
          },
        },
      },
      '/api/auth/sync-keys': {
        post: {
          tags: ['Auth'],
          summary: '同步 API 密钥',
          description: '更新用户的 AI 模型 API 密钥和代理配置。',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    evalKey1: { type: 'string', description: 'MIMO API Key' },
                    evalKey2: { type: 'string', description: 'Gemini API Key' },
                    evalKey3: { type: 'string', description: 'Qwen API Key' },
                    mimoKey: { type: 'string' },
                    geminiKey: { type: 'string' },
                    qwenKey: { type: 'string' },
                    customProxy: { type: 'string', description: '自定义代理地址' },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: '密钥同步成功' },
            404: { description: '用户不存在' },
          },
        },
      },
      '/api/auth/me': {
        get: {
          tags: ['Auth'],
          summary: '获取当前用户信息',
          description: '返回当前 JWT token 对应的用户资料。',
          security: [{ bearerAuth: [] }],
          responses: {
            200: { description: '返回用户资料' },
            404: { description: '用户不存在' },
          },
        },
      },
      '/api/auth/logout': {
        post: {
          tags: ['Auth'],
          summary: '用户登出',
          description: '将当前 JWT token 加入撤销列表。',
          security: [{ bearerAuth: [] }],
          responses: {
            200: { description: '登出成功' },
          },
        },
      },
      '/api/auth/profile/{uid}': {
        get: {
          tags: ['Auth'],
          summary: '获取指定用户资料',
          description: '获取指定 UID 的用户资料（仅限本人或管理员）。',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'uid', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            200: { description: '返回用户资料' },
            403: { description: '无权访问' },
            404: { description: '用户不存在' },
          },
        },
      },
      '/api/auth/test-upgrade': {
        post: {
          tags: ['Auth'],
          summary: '[DEV] 测试升级用户会员',
          description: '仅开发/测试环境可用，直接修改用户会员类型和额度。',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['uid'],
                  properties: {
                    uid: { type: 'string' },
                    membershipType: { type: 'string', enum: ['free', 'pro', 'enterprise'] },
                    billingCycle: { type: 'string', enum: ['none', 'monthly', 'annual'] },
                    remainingCredits: { type: 'integer' },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: '升级成功' },
            400: { description: '缺少 UID' },
          },
        },
      },

      // ─── Agent (8) ───────────────────────────────────────────────────
      '/api/agent/sessions': {
        get: {
          tags: ['Agent'],
          summary: '获取所有会话列表',
          description: '返回当前用户的所有设计会话。',
          security: [{ bearerAuth: [] }],
          responses: {
            200: { description: '返回会话列表' },
          },
        },
        post: {
          tags: ['Agent'],
          summary: '创建新会话',
          description: '创建一个新的设计会话。',
          security: [{ bearerAuth: [] }],
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { title: { type: 'string', default: '新设计会话' } },
                },
              },
            },
          },
          responses: {
            200: { description: '会话创建成功' },
          },
        },
      },
      '/api/agent/sessions/{id}': {
        get: {
          tags: ['Agent'],
          summary: '获取会话详情',
          description: '获取指定会话的完整信息，包括聊天历史。',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: '会话 ID' },
          ],
          responses: {
            200: { description: '返回会话详情' },
            404: { description: '会话未找到' },
          },
        },
        put: {
          tags: ['Agent'],
          summary: '重命名会话',
          description: '更新会话标题。',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['title'],
                  properties: { title: { type: 'string' } },
                },
              },
            },
          },
          responses: {
            200: { description: '标题更新成功' },
            400: { description: '缺少标题' },
          },
        },
        delete: {
          tags: ['Agent'],
          summary: '删除会话',
          description: '删除指定会话及其所有数据。',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            200: { description: '会话已删除' },
          },
        },
      },
      '/api/agent/chat': {
        post: {
          tags: ['Agent'],
          summary: 'Agent 对话',
          description: '两阶段 Agent 流水线：信息收集 → 批量生图。支持多轮对话和状态持久化。',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['message'],
                  properties: {
                    message: { type: 'string', description: '用户消息' },
                    product_image_base64: { type: 'string', description: '产品图片 base64' },
                    image_types: { type: 'array', items: { type: 'string' }, description: '需要的图片类型' },
                    session_id: { type: 'string', description: '会话 ID（不传则自动创建或使用最近会话）' },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: '返回 AI 回复或生成的图片' },
            403: { description: '额度耗尽' },
            503: { description: 'AI 引擎不可用' },
          },
        },
      },
      '/api/agent/brand-memory': {
        get: {
          tags: ['Agent'],
          summary: '获取品牌记忆',
          description: '获取用户的品牌记忆配置。',
          security: [{ bearerAuth: [] }],
          responses: {
            200: { description: '返回品牌记忆数据' },
          },
        },
        put: {
          tags: ['Agent'],
          summary: '更新品牌记忆',
          description: '保存或更新用户的品牌记忆配置。',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['brandMemory'],
                  properties: {
                    brandMemory: { $ref: '#/components/schemas/BrandMemory' },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: '品牌记忆更新成功' },
            400: { description: '缺少品牌记忆数据' },
          },
        },
      },

      // ─── Payment (5) ─────────────────────────────────────────────────
      '/api/payment/create-order': {
        post: {
          tags: ['Payment'],
          summary: '创建支付订单',
          description: '创建 Stripe 支付会话并生成待支付订单。',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['planId'],
                  properties: {
                    planId: {
                      type: 'string',
                      enum: ['pro_monthly', 'pro_annual', 'enterprise_monthly', 'enterprise_annual'],
                      description: '套餐 ID',
                    },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: '返回 Stripe 支付链接' },
            400: { description: '无效的套餐 ID' },
            500: { description: 'Stripe 未配置' },
          },
        },
      },
      '/api/payment/status/{orderId}': {
        get: {
          tags: ['Payment'],
          summary: '查询订单状态',
          description: '根据订单 ID 查询支付状态。',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'orderId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            200: { description: '返回订单状态' },
            403: { description: '无权查看该订单' },
            404: { description: '订单未找到' },
          },
        },
      },
      '/api/payment/webhook': {
        post: {
          tags: ['Payment'],
          summary: 'Stripe Webhook',
          description: 'Stripe 支付回调，验证签名后处理订单状态更新和额度充值。',
          requestBody: {
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          responses: {
            200: { description: 'Webhook 已处理' },
            400: { description: '签名验证失败' },
          },
        },
      },
      '/api/payment/deduct': {
        post: {
          tags: ['Payment'],
          summary: '扣减额度',
          description: '免费用户每次生图扣 1 点额度，付费用户不扣。',
          security: [{ bearerAuth: [] }],
          responses: {
            200: { description: '返回剩余额度' },
            403: { description: '免费额度已耗尽' },
            404: { description: '用户不存在' },
          },
        },
      },
      '/api/payment/orders': {
        get: {
          tags: ['Payment'],
          summary: '获取订单历史',
          description: '返回当前用户的所有支付订单记录，按时间倒序排列。',
          security: [{ bearerAuth: [] }],
          responses: {
            200: {
              description: '返回订单列表',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean' },
                      orders: { type: 'array', items: { $ref: '#/components/schemas/Order' } },
                    },
                  },
                },
              },
            },
          },
        },
      },

      // ─── AI/Generate (3) ─────────────────────────────────────────────
      '/api/generate/evaluate': {
        post: {
          tags: ['AI/Generate'],
          summary: 'AI 评估图片',
          description: '对生成的商品图进行 AI 质量评估，返回 CTR、CVR 等指标。',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['image', 'productInfo'],
                  properties: {
                    image: { type: 'string', description: '图片 base64 或路径' },
                    productInfo: { type: 'object', description: '商品信息' },
                    instruction: { type: 'string', description: '评估指令' },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: '返回评估指标' },
            400: { description: '缺少图片或商品信息' },
          },
        },
      },
      '/api/generate/matting': {
        post: {
          tags: ['AI/Generate'],
          summary: '图片抠图',
          description: '对商品图执行智能抠图处理（前端侧处理，后端为占位接口）。',
          security: [{ bearerAuth: [] }],
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { sampleId: { type: 'string' } },
                },
              },
            },
          },
          responses: {
            200: { description: '抠图处理就绪' },
          },
        },
      },
      '/api/generate/inpaint': {
        post: {
          tags: ['AI/Generate'],
          summary: 'AI 背景生成 (Inpaint)',
          description: '完整流水线：额度检查 → Prompt 改写 → 背景生成 → AI 评估 → 保存。',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['productInfo'],
                  properties: {
                    image: { type: 'string', description: '原图 base64' },
                    mask: { type: 'string', description: '遮罩 base64' },
                    prompt: { type: 'string', description: '背景描述' },
                    fidelity: { type: 'number', description: '保真度' },
                    productInfo: { type: 'object', description: '商品信息' },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: '返回生成的图片 URL 和评估指标' },
            400: { description: '缺少参数或 API Key 未配置' },
            403: { description: '额度耗尽' },
          },
        },
      },

      // ─── Assets (4) ──────────────────────────────────────────────────
      '/api/assets/upload': {
        post: {
          tags: ['Assets'],
          summary: '上传素材',
          description: '上传 base64 图片到云端存储，支持 JPG/PNG/WEBP/GIF。',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['data'],
                  properties: {
                    name: { type: 'string' },
                    data: { type: 'string', description: 'base64 图片数据（含 data URI 前缀）' },
                    metrics: { type: 'object' },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: '上传成功，返回素材元数据' },
            400: { description: '缺少参数或不支持的文件类型' },
          },
        },
      },
      '/api/assets/': {
        get: {
          tags: ['Assets'],
          summary: '获取用户素材列表',
          description: '返回当前用户的所有素材，按日期和 ID 倒序。',
          security: [{ bearerAuth: [] }],
          responses: {
            200: { description: '返回素材列表' },
          },
        },
      },
      '/api/assets/stats': {
        get: {
          tags: ['Assets'],
          summary: '获取素材统计数据',
          description: '返回聚合的素材统计指标：曝光量、点击量、CTR、CVR 对比、模型分布等。',
          security: [{ bearerAuth: [] }],
          responses: {
            200: { description: '返回统计数据' },
          },
        },
      },
      '/api/assets/{id}': {
        delete: {
          tags: ['Assets'],
          summary: '删除素材',
          description: '删除指定素材的文件和数据库记录。',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            200: { description: '素材已删除' },
            403: { description: '无权删除他人素材' },
            404: { description: '素材不存在' },
          },
        },
      },

      // ─── Notifications (1) ───────────────────────────────────────────
      '/api/notifications': {
        get: {
          tags: ['Notifications'],
          summary: '获取通知消息',
          description: '返回系统消息和活动通知（当前返回空数组占位）。',
          responses: {
            200: {
              description: '返回通知数据',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      system: { type: 'array', items: { type: 'object' } },
                      promotion: { type: 'array', items: { type: 'object' } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  apis: [], // We define all paths manually above, no JSDoc scanning needed
};

export const swaggerSpec = swaggerJsdoc(options);
