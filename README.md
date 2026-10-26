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

Testes de integração da API (Postgres real, `app.inject`): crie um banco **descartável** e rode
`createdb pt_api && TEST_DATABASE_URL=postgres://USUARIO:SENHA@localhost:5432/pt_api pnpm --filter @playtorneios/api test`.
Sem `TEST_DATABASE_URL` eles são pulados. O teste apaga o schema `public` desse banco e recusa nomes que não contenham `test` ou `pt_api`.

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

## Retenção de dados pessoais (LGPD)

A API anonimiza sozinha (uma vez por dia) os atletas de torneios **encerrados há mais de 12 meses**: nome, telefone, nascimento e
cidade são apagados; partidas, resultados e pódio permanecem. Ajuste com `RETENTION_MONTHS` no `.env` (0 desliga). Para ver o que seria
anonimizado sem alterar nada: `docker compose run --rm --entrypoint "node src/retention-cli.ts" api --dry-run`. Aparelhos só recebem a
anonimização na próxima sincronização, e backups em arquivo baixados antes continuam com os dados originais.

## Vários torneios no mesmo aparelho

O botão **Trocar torneio** (topo do app) abre outro torneio ou cria um novo. Cada torneio tem seu próprio banco local; os que vêm do
servidor são baixados no primeiro acesso (precisa de internet). A fila de envio de cada torneio só segue enquanto ele está aberto:
o app avisa se você trocar com alterações ainda pendentes.

## HTTPS (TLS)

Em produção o cookie de sessão é `Secure` e só funciona sob HTTPS. O overlay `docker-compose.tls.yml` coloca um Caddy na frente
(certificado Let's Encrypt automático, renovação sozinha):

```bash
# .env: DOMAIN=torneios.exemplo.com.br  ACME_EMAIL=voce@exemplo.com.br  COOKIE_SECURE=true
docker compose -f docker-compose.yml -f docker-compose.tls.yml up -d --build
```

Requisitos: o DNS do domínio aponta para o servidor e as portas 80 e 443 estão abertas. A porta 8080 deixa de ser publicada.
O web ganha um segundo listener interno (8081, não publicado) que confia no `X-Forwarded-For` do Caddy, para o limite de taxa
da API enxergar cada visitante. Teste local: `DOMAIN=localhost` e abra `https://localhost` (aceite o certificado local do Caddy).
Confira depois: `curl -sI https://SEU_DOMINIO/api/health` e, no navegador, o cookie de sessão marcado como `Secure`.

## Cloudflare Tunnel (servidor em casa, sem abrir portas)

Alternativa ao Caddy para uma máquina local ou atrás de CGNAT. O `cloudflared` abre uma conexão de saída com a Cloudflare, que entrega o HTTPS:

```bash
# .env: TUNNEL_TOKEN=...   (token do túnel criado no painel da Cloudflare)
docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d --build
```

No painel, o hostname público do túnel aponta para `HTTP` `web:8082`. Essa porta interna (não publicada) confia no `CF-Connecting-IP`,
então o limite de tentativas de login por IP enxerga cada visitante. Passo a passo completo: `docs/TUTORIAL_MAQUINA_LOCAL.md`.
Não use junto com `docker-compose.tls.yml`.

## Operação na quadra

- **Placar na quadra:** `#/placar/<partida>` (botão "Abrir placar" na Central). Botões grandes, desfazer, tela acesa.
- **Juízes por quadra:** em **Juízes (placar)** gere um link/QR por quadra. O juiz abre `/juiz.html#<token>` no celular, sem conta, e só vê e lança a quadra dele. O link vale até o fim do torneio (máx. 7 dias) e pode ser revogado. Exige internet (há uma fila curta para quedas breves de sinal). Detalhes em `docs/SPEC_JUIZ.md`.
- **Telão:** `#/telao`, para TV ou projetor: o que está em jogo em cada quadra e os próximos chamados.
- **Súmulas em papel:** `#/imprimir`, folhas de reserva por quadra.

## Dados fictícios para testes (seed)

Com a stack no ar (`docker compose up --build`), popule o banco com torneios de mentira:

```bash
pnpm seed                                   # cria a conta de teste e os torneios (opções: pnpm seed --carga, --reset, --only=copa)
docker compose --profile seed run --rm seed --reset          # apaga e recria os torneios seed-*
docker compose --profile seed run --rm seed --carga          # inclui o torneio grande (104 duplas)
docker compose --profile seed run --rm seed --only=encerrado # só um torneio
```

O seed usa a API de verdade (cadastro, login e `/api/sync/push`), então versões, slugs e páginas públicas ficam coerentes.
Conta criada: `organizador@teste.playtorneios.dev` / `SenhaDeTeste#2026` (mude com `SEED_EMAIL` e `SEED_PASSWORD` no `.env`).
Exige `ALLOW_SIGNUP=true` na primeira execução (ou uma conta já existente com o mesmo e-mail e senha).

| Torneio (id) | O que testa |
| --- | --- |
| Copa Praia Grande (`seed-copa`) | Em andamento. Masculina: 12 duplas, grupos completos com W.O., desistência e correção com justificativa, mata-mata até as semifinais, final ao vivo. Feminina: grupo com **empate circular em aberto** (desempate manual). Mista: 8 vagas, lista de espera, inscrição pendente e cancelada, partida em andamento. Agenda em 3 quadras. Página pública publicada |
| Open de Inverno (`seed-encerrado`) | Encerrado, pódio completo em duas categorias, página pública |
| Torneio de Verão (`seed-rascunho`) | Rascunho sem duplas (fluxo de configuração) |
| Circuito Estadual (`seed-carga`, só com `--carga`) | 104 duplas, 6 quadras, centenas de partidas (desempenho) |

Todos os nomes são sorteados de listas comuns e os telefones usam DDD `00` (inexistente). **O app mostra um torneio por aparelho**
(o mais recentemente atualizado, que é a Copa); para ver outro, rode o seed com `--only=<nome> --reset` e abra em janela anônima
ou limpe os dados do site. Não rode o seed em produção: ele cria uma conta com senha conhecida.

## Primeira subida: roteiro de verificação

Nada da camada de API (Fastify, `pg`, argon2) e do build do Vite foi executado antes da entrega: foram checados por tipos e, no caso do SQL, contra um Postgres 16. Siga na ordem e pare no primeiro passo que falhar.

1. `pnpm install` (gera o `pnpm-lock.yaml`; faça commit dele).
2. `pnpm typecheck && pnpm lint && pnpm test` — esperado: tudo verde (68 testes).
3. `cp .env.example .env` e preencha `POSTGRES_PASSWORD` e `COOKIE_SECRET` (32+ caracteres).
4. `docker compose up --build` — esperado: `db` saudável, `migrate` termina com código 0, `api` em `/api/health`, `web` em `http://localhost:8080`.
5. Crie a primeira conta com `ALLOW_SIGNUP=true` (depois volte para `false`), entre, crie um torneio e confira o chip de sincronização.
6. `pnpm test:web` — teste de fumaça no navegador (precisa de `pnpm exec playwright install chromium`).
7. Desligue a rede do navegador, registre um placar, religue: a fila deve esvaziar sozinha.

Se algo falhar, anote o comando, a saída completa e `docker compose logs api` — é o material necessário para corrigir.
