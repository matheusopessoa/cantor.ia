# ==========================================
# ESTÁGIO 1: Builder
# ==========================================
FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@10.24.0 --activate

WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/

RUN pnpm install --frozen-lockfile --filter api...

COPY apps/api ./apps/api

WORKDIR /repo/apps/api

RUN pnpm prisma generate

RUN pnpm build

# ==========================================
# ESTÁGIO 2: Runner
# ==========================================
FROM node:20-alpine AS runner

WORKDIR /repo/apps/api

COPY --from=builder /repo/node_modules /repo/node_modules
COPY --from=builder /repo/apps/api/node_modules ./node_modules
COPY --from=builder /repo/apps/api/package.json ./
COPY --from=builder /repo/apps/api/dist ./dist
COPY --from=builder /repo/apps/api/prisma ./prisma
COPY --from=builder /repo/apps/api/prisma.config.ts ./

EXPOSE 3333

CMD ["npm", "run", "start"]
