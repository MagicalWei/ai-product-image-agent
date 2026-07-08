# ───────────────────────────────────────────────────────────────────
# Node.js Express Backend
# ───────────────────────────────────────────────────────────────────
FROM node:22-alpine AS node-backend

WORKDIR /app

# pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile --prod

COPY . .

EXPOSE 3000
CMD ["node", "server.js"]
