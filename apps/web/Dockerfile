# syntax=docker/dockerfile:1.7
FROM node:22-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN pnpm install --filter @playtorneios/web...
RUN pnpm --filter @playtorneios/web build

FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
ARG REVISION=unknown
ARG CREATED=unknown
LABEL org.opencontainers.image.title="playtorneios-web" \
      org.opencontainers.image.revision=$REVISION \
      org.opencontainers.image.created=$CREATED
# A imagem base envelhece: atualiza os pacotes do Alpine (OpenSSL, zlib, musl, curl...) no momento do build.
USER root
RUN apk upgrade --no-cache
USER 101
# Os arquivos em templates/ passam por envsubst na partida (imagem oficial do nginx); só as variáveis API_* são trocadas.
COPY apps/web/templates/ /etc/nginx/templates/
ENV NGINX_ENVSUBST_FILTER=^API_ \
    API_UPSTREAM=http://api:3000 \
    API_RESOLVER=127.0.0.11 \
    API_RESOLVER_OPTS=ipv6=off
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
# O nginx usa "worker_processes auto" (um por CPU do servidor); em hospedagem compartilhada isso vira dezenas de processos
# e consome RAM à toa. Dois bastam para este site.
USER root
RUN sed -i 's/^worker_processes.*/worker_processes 2;/' /etc/nginx/nginx.conf && grep -q '^worker_processes 2;' /etc/nginx/nginx.conf
USER 101
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
