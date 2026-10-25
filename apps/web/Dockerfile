# syntax=docker/dockerfile:1.7
FROM node:22-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --filter @playtorneios/web...
RUN pnpm --filter @playtorneios/web build

FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
ARG REVISION=unknown
ARG CREATED=unknown
LABEL org.opencontainers.image.title="playtorneios-web" \
      org.opencontainers.image.revision=$REVISION \
      org.opencontainers.image.created=$CREATED
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
