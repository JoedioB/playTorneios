# playTorneios

Sistema de gerenciamento de torneios de futevôlei. **Local-first**: o organizador trabalha no celular ou no
notebook, com ou sem internet, e o servidor sincroniza quando a rede volta. Documentação de produto e de
projeto em `docs/` (PRD, SPECS, DECISIONS, ROADMAP).

## Subir tudo com Docker

```bash
cp .env.example .env        # edite POSTGRES_PASSWORD e COOKIE_SECRET
docker compose up --build   # http://localhost:8080
```

Crie sua conta na tela de entrada (depois desligue `ALLOW_SIGNUP` no `.env`). Serviços: `db` (PostgreSQL 16),
`migrate` (roda as migrações e termina), `api` (Fastify) e `web` (nginx com o PWA e a página pública).
A página pública de cada torneio fica em `/p/<endereço-do-torneio>`.

Desenvolvimento com recarga automática: `pnpm dev` (usa `docker-compose.dev.yml`; front em `:5173`, API em `:3000`).

## Sem Docker

Requisitos: Node ≥ 22.18, pnpm 9, PostgreSQL 16.

```bash
pnpm install
export DATABASE_URL=postgres://usuario:senha@localhost:5432/playtorneios
export COOKIE_SECRET=$(openssl rand -base64 48) COOKIE_SECURE=false
pnpm --filter @playtorneios/api migrate
pnpm --filter @playtorneios/api start        # API em :3000
pnpm --filter @playtorneios/web dev          # front em :5173 (proxy /api → :3000)
```

## Testes

```bash
pnpm test         # domínio, sincronização, contratos, arquitetura, API (estático) — Node test runner, sem dependências
pnpm typecheck
pnpm lint
pnpm test:web     # teste de fumaça no Chromium (precisa de Playwright: pnpm exec playwright install chromium)
```

## Estrutura

| Pasta | O que é |
|---|---|
| `packages/domain` | Regras do torneio em TypeScript puro: chaves, pontuação, classificação, agenda, impacto, tema, comandos (`apply`), snapshot público, CSV. **Sem dependências.** |
| `packages/sync` | Aplicador idempotente do servidor, motor do cliente (fila, backoff, conflitos), armazenamentos em memória. |
| `packages/contracts` | Schemas Zod de todas as operações e requisições. |
| `apps/api` | Fastify + PostgreSQL: autenticação, `/api/sync/*`, publicação, exportação, exclusão (LGPD). |
| `apps/web` | PWA em React + Vite (Dexie/IndexedDB). Admin e página pública. |

As regras de dependência entre pastas são verificadas por `test/architecture.test.ts`.

## Primeiro uso

Rode `pnpm install` uma vez e **faça commit do `pnpm-lock.yaml`** (o CI e as imagens usam instalação congelada).
