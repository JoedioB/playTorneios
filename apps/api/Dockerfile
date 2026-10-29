# syntax=docker/dockerfile:1.7
# API: Fastify rodando TypeScript direto pelo Node (type stripping, Node >= 22.18). Sem etapa de compilação.
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/domain/package.json packages/domain/
COPY packages/sync/package.json packages/sync/
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --prod --filter @playtorneios/api...

FROM node:22-slim AS runtime
ARG REVISION=unknown
ARG CREATED=unknown
LABEL org.opencontainers.image.title="playtorneios-api" \
      org.opencontainers.image.revision=$REVISION \
      org.opencontainers.image.created=$CREATED
ENV NODE_ENV=production
# O runtime só executa `node`: remover npm/npx/corepack tira do contêiner dependências embutidas que não usamos (e seus CVEs).
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn* /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/packages ./packages
COPY --from=deps /repo/apps/api/node_modules ./apps/api/node_modules
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
USER node
WORKDIR /repo/apps/api
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# MIGRATE_ON_START=true aplica as migrações antes de subir (PaaS sem serviço "migrate"); a migração usa advisory lock, então é segura.
CMD ["sh", "-c", "if [ \"$MIGRATE_ON_START\" = \"true\" ]; then node src/migrate.ts; fi; exec node src/server.ts"]
