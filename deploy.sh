#!/bin/bash
# ───────────────────────────────────────────────────────────────────
# ai-product-image-agent 一键部署脚本
# 在 VPS 上执行: bash deploy.sh
# ───────────────────────────────────────────────────────────────────
set -euo pipefail

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║     ai-product-image-agent  生产部署脚本                    ║"
echo "╚══════════════════════════════════════════════════════════════╝"

# ── 0. 检查前置条件 ──────────────────────────────────────────────
command -v docker >/dev/null 2>&1 || { echo "❌ 需要安装 Docker"; exit 1; }
command -v git >/dev/null 2>&1 || { echo "❌ 需要安装 Git"; exit 1; }

# ── 1. 拉取代码 ──────────────────────────────────────────────────
if [ ! -d "ai-product-image-agent" ]; then
    echo "📦 克隆项目..."
    git clone https://github.com/你的用户名/ai-product-image-agent.git
fi
cd ai-product-image-agent

# ── 2. 创建 .env（如果不存在）────────────────────────────────────
if [ ! -f ".env" ]; then
    echo "⚠️  未找到 .env 文件，请先创建！"
    echo "   参考 .env.example 填写所有必需的环境变量"
    echo ""
    echo "   最少需要填写："
    echo "   - DATABASE_URL"
    echo "   - JWT_SECRET"
    echo "   - STRIPE_SECRET_KEY"
    echo "   - STRIPE_WEBHOOK_SECRET"
    echo "   - DEEPSEEK_API_KEY"
    echo "   - DOUBAO_API_KEY"
    echo "   - CORS_ORIGIN (你的域名)"
    echo "   - FRONTEND_URL (你的域名)"
    exit 1
fi

# ── 3. 构建并启动所有服务 ────────────────────────────────────────
echo "🔨 构建 Docker 镜像..."
docker compose build

echo "🚀 启动服务..."
docker compose up -d

# ── 4. 等待服务就绪 ──────────────────────────────────────────────
echo "⏳ 等待服务启动..."
sleep 5

# ── 5. 健康检查 ──────────────────────────────────────────────────
echo "🩺 健康检查..."
if curl -sf http://localhost:80/api/notifications > /dev/null 2>&1; then
    echo "✅ 后端 API 正常"
else
    echo "❌ 后端 API 异常，请检查日志: docker compose logs backend"
fi

if curl -sf http://localhost:8000/health > /dev/null 2>&1; then
    echo "✅ Python Agent 正常"
else
    echo "⚠️  Python Agent 异常，请检查日志: docker compose logs agent"
fi

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  🎉 部署完成！                                              ║"
echo "║                                                            ║"
echo "║  访问地址: http://你的服务器IP 或域名                       ║"
echo "║                                                            ║"
echo "║  常用命令:                                                 ║"
echo "║  docker compose logs -f      查看所有日志                   ║"
echo "║  docker compose restart      重启所有服务                   ║"
echo "║  docker compose down         停止所有服务                   ║"
echo "║  docker compose up -d        重新启动                       ║"
echo "╚══════════════════════════════════════════════════════════════╝"
