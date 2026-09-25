# ==========================================
# BASE: Configuração inicial do pnpm
# ==========================================
# O contexto de build é a RAIZ do monorepo: o lockfile e o pnpm-workspace.yaml
# vivem lá, e o pnpm precisa dos dois para resolver o workspace.
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.24.0 --activate
# libc6-compat é necessário para algumas dependências nativas do Next.js
RUN apk add --no-cache libc6-compat

# ==========================================
# ESTÁGIO 1: Dependências (deps)
# ==========================================
FROM base AS deps
WORKDIR /repo

# Só os manifests primeiro: a camada de install só é invalidada quando uma
# dependência muda de verdade, e não a cada alteração de código.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/

RUN pnpm install --frozen-lockfile --filter web...

# ==========================================
# ESTÁGIO 2: Builder (Compilação)
# ==========================================
FROM base AS builder
WORKDIR /repo

# O node_modules da raiz carrega o store do pnpm; o de apps/web são os
# symlinks que apontam para ele. Os dois precisam vir juntos.
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/web/node_modules ./apps/web/node_modules
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web ./apps/web

# Desativa a telemetria do Next.js (boa prática para CI/CD)
ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /repo/apps/web
RUN pnpm build

# ==========================================
# ESTÁGIO 3: Runner (Imagem de Produção)
# ==========================================
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Cria um usuário não-root por segurança
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Com outputFileTracingRoot na raiz do monorepo, o standalone preserva a
# estrutura do workspace: server.js sai em apps/web/ e o node_modules na raiz
# do bundle. Por isso os estáticos vão para apps/web/ e não para a raiz.
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/public ./apps/web/public

# Muda para o usuário seguro
USER nextjs

EXPOSE 3000
ENV PORT=3000
# Sem HOSTNAME o server.js escuta só em localhost e a porta publicada não responde.
ENV HOSTNAME=0.0.0.0

CMD ["node", "apps/web/server.js"]
