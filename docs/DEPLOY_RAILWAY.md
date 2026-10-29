# Implantação na Railway (DEC-31)

Tudo na Railway: banco (PostgreSQL), API e front (nginx), na mesma origem. Não usa Vercel (DEC-31). A configuração fica no painel da Railway; não há `railway.json`, porque a Railway marcou o *config as code* como obsoleto (arquivos existentes só valem até 01/12/2026).

## 1. Visão

```text
Internet ──HTTPS──▶ web (nginx, porta 8083) ──rede privada──▶ api (Fastify, :3000) ──▶ Postgres
                    serve o PWA, /p/<slug>, /juiz.html        /api/*                    (rede privada)
```

- Só o `web` tem domínio público. A `api` e o banco ficam na rede privada (`*.railway.internal`).
- O navegador fala com uma origem só, então valem `SameSite=Strict`, a checagem de CSRF e a ausência de CORS.
- A imagem do `web` troca o destino da API por variáveis de ambiente (`API_UPSTREAM`, `API_RESOLVER`, `API_RESOLVER_OPTS`); o padrão continua sendo o do Docker Compose.

## 2. Passo a passo

1. **Projeto**: em railway.app, *New Project* → *Deploy from GitHub repo* → `JoedioB/playTorneios` (branch `main`). Escolha a região mais próxima do Brasil que o seu plano oferecer.
2. **Banco**: *+ New* → *Database* → *PostgreSQL*. Anote o nome do serviço (abaixo, `Postgres`).
3. **Serviço `api`** (o serviço criado a partir do repositório; renomeie para `api`):
   - *Root Directory*: deixe vazio (o build precisa da raiz do repositório).
   - Variáveis:

   | Variável | Valor |
   | --- | --- |
   | `RAILWAY_DOCKERFILE_PATH` | `apps/api/Dockerfile` |
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
   | `COOKIE_SECRET` | 64 caracteres aleatórios (`openssl rand -hex 32`) |
   | `COOKIE_SECURE` | `true` |
   | `NODE_ENV` | `production` |
   | `PORT` | `3000` |
   | `HOST` | `::` (a rede privada da Railway usa IPv6) |
   | `MIGRATE_ON_START` | `true` |
   | `ALLOW_SIGNUP` | `true` só até criar a conta do organizador; depois `false` |

   - *Settings → Healthcheck Path*: `/api/health`. Não gere domínio público para a `api`.
4. **Serviço `web`**: *+ New* → *GitHub Repo* → o mesmo repositório; renomeie para `web`.
   - Variáveis:

   | Variável | Valor |
   | --- | --- |
   | `RAILWAY_DOCKERFILE_PATH` | `apps/web/Dockerfile` |
   | `PORT` | `8083` (o listener preparado para o proxy da Railway) |
   | `API_UPSTREAM` | `http://api.railway.internal:3000` |
   | `API_RESOLVER` | `[fd12::10]` |
   | `API_RESOLVER_OPTS` | `ipv6=on` |

   - *Settings → Healthcheck Path*: `/healthz`. *Networking → Generate Domain* (ou domínio próprio).
5. **Primeiro acesso**: abra o domínio, crie a conta do organizador, depois ponha `ALLOW_SIGNUP=false` na `api`.
6. **Limite de gasto**: em *Usage*, defina um teto mensal para uma surpresa na fatura não passar do que você aceita.

Observações:
- O nome `api` em `api.railway.internal` é o nome do serviço; se usar outro, ajuste `API_UPSTREAM`.
- As migrações rodam na partida da `api` (`MIGRATE_ON_START`), com advisory lock; mantenha uma única réplica.
- Deploys saem a cada push na branch configurada. Para publicar só com aprovação, desligue o deploy automático ou use uma branch de produção.

## 3. Verificação depois do deploy

1. `https://<domínio>/healthz` responde `ok` e `https://<domínio>/api/health` responde `{"ok":true,...}`.
2. Login, criação de torneio e sincronização funcionam (cookie `Secure`, sem erro de CSRF).
3. `/p/<slug>` abre a página pública e `/juiz.html#<token>` abre a do juiz; gere um link na tela "Juízes".
4. **IP do visitante e limite de login.** A documentação da Railway sobre quem preenche `X-Forwarded-For` não é consistente (há respostas oficiais que se contradizem). O `web` usa o primeiro IP não confiável da direita, o que não deixa o visitante forjar o IP. Confirme: erre a senha 3 vezes de um celular em dados móveis e depois entre normalmente de outra rede; se o segundo acesso for bloqueado, o limite está agrupando todo mundo num IP e é preciso ajustar `set_real_ip_from` em `apps/web/templates/default.conf.template`. O bloqueio por conta (5 erros) vale de qualquer forma.
5. Repita o ensaio de `docs/ENSAIO_E_CHECKLIST.md` (3 celulares, queda de wi-fi, revogação).

## 4. Backup e restauração

Não confie só nos recursos da plataforma até confirmar, na sua conta, se há backup automático do volume do Postgres e por quanto tempo.

1. No serviço do banco, copie a URL pública (`DATABASE_PUBLIC_URL`, pelo proxy TCP).
2. Numa máquina sua com `pg_dump` 16: `BACKUP_DATABASE_URL='<url>' scripts/backup.sh` (agende no cron). O script valida o dump e faz rotação.
3. Teste a restauração com `scripts/restore-test.sh` (usa um Postgres local do Compose e um banco temporário).
4. Cópia externa dos arquivos (nuvem ou disco) continua sendo necessária.

## 5. Reversão

- Código: na Railway, *Deployments* → redeploy da versão anterior. As migrações são expansivas (o app anterior segue compatível).
- Dados: restaurar o último dump num banco novo e apontar `DATABASE_URL` para ele.

## 6. Pendências e riscos desta opção

- **Localização dos dados**: confirme a região disponível. Se for fora do Brasil, trate como transferência internacional na revisão da DEC-26.
- **Latência**: o juiz grava a cada ponto; meça no ensaio com a região escolhida.
- **Backup da plataforma**: não verificado; vale o backup próprio acima.
- **Custo**: cobrança por uso (CPU, RAM, tráfego, volume); acompanhe a primeira fatura e mantenha o teto.
- **Rede privada IPv6**: se o `web` não alcançar a `api`, confira `API_RESOLVER`, `API_RESOLVER_OPTS` e `HOST=::` (sintoma: 502 em `/api/`).
