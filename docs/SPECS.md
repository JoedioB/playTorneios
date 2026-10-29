# SPECS — Projeto técnico do playTorneios

**Versão:** 1.0 (rascunho para revisão)
**Base:** PRD v1.0, ARCHITECTURE, DECISIONS (DEC-01 a DEC-15), ROADMAP e CLAUDE.md
**Design escolhido:** *Arena Noturna* (central de comando com busca global, tema escuro)
**Stack escolhida:** React + Vite + TypeScript (PWA), Node + Fastify, PostgreSQL, **Docker** (build, desenvolvimento e implantação)
**Idioma do produto:** português brasileiro · datas `DD/MM/AAAA` · fuso `America/Sao_Paulo`

---

## 0. Como ler este documento

| Se você é… | Leia |
|---|---|
| Quem vai implementar o domínio (chaves, placar, classificação) | §5, §6, §16 |
| Quem vai implementar offline e sincronização | §7, §9, §16 |
| Quem vai implementar a interface | §10, §11, §12 |
| Quem revisa segurança e LGPD | §8, §13 |
| Quem monta ambiente, CI e implantação (Docker) | §17 |
| Quem planeja o trabalho | §15, §18 |

Convenções: **DEVE** e **NÃO DEVE** indicam requisito. **Decisão pendente** marca o que o PRD deixa em aberto e este documento propõe um padrão para confirmação. Valores numéricos padrão (duração de jogo, descanso, expiração de sessão) são **padrões do sistema, não regulamento oficial** (regra de negócio 15).

---

## 1. Objetivo e escopo técnico

### 1.1 O que será construído

Uma aplicação web responsiva (PWA) que permite a um único organizador conduzir um torneio local de futevôlei, inclusive sem internet, e publicar uma página pública somente leitura.

Três artefatos de software:

1. **Admin PWA**: interface do organizador, local-first, instalável.
2. **API**: autenticação, validação, sincronização, publicação e exportação no servidor.
3. **Página pública**: bundle separado e leve, somente leitura, alimentado por snapshot.

### 1.2 Fora do escopo (herdado do PRD §4.2)

Aplicativo nativo, offline em vários dispositivos, sincronização multi-dispositivo em tempo real, inscrição pública, pagamentos, notificações, ranking entre torneios, integrações externas, eliminação dupla e todos-contra-todos como formato independente.

### 1.3 Premissa que simplifica tudo

**Um único dispositivo administrativo por torneio durante o evento.** Isso elimina a necessidade de CRDTs. A sincronização é um log de operações com detecção de conflito por versão (§7). Conflitos reais são raros, mas o sistema NÃO DEVE perder dado quando acontecerem (RF-20).

---

## 2. Stack e justificativas

| Camada | Escolha | Por quê |
|---|---|---|
| Linguagem | TypeScript em modo `strict` em todo o repositório | Domínio compartilhado entre cliente e servidor (RNF-03: validar nos dois lados) |
| Build web | Vite | Rápido, bom suporte a PWA e a code-splitting |
| UI | React + React Router | Ecossistema, componentes acessíveis disponíveis |
| Primitivas acessíveis | Radix UI (Dialog, Select, Switch, Tabs, Toast, Popover) | Foco, ARIA e teclado corretos sem reinventar (RNF-08) |
| Estilo | CSS Modules + variáveis CSS (tokens) | Tema do torneio troca variáveis em runtime (RF-18); sem custo de runtime |
| Banco local | IndexedDB via **Dexie** | Transações, índices, `liveQuery` reativo (DEC-03) |
| Estado de UI | Zustand (somente estado efêmero de UI) | O estado de domínio vive no Dexie, não em store de memória |
| Dados remotos | TanStack Query (somente chamadas ao servidor: login, saúde, publicação) | O estado de domínio local NÃO passa por ele |
| Formulários | React Hook Form + Zod | Esquemas Zod compartilhados com a API |
| PWA | `vite-plugin-pwa` (Workbox) | Precache do shell, fontes e chunks de PDF |
| PDF | `pdfmake` carregado sob demanda | Tabelas prontas, funciona offline se o chunk estiver em precache |
| API | Node + **Fastify** | Validação por schema, plugins, desempenho |
| ORM e migrações | **Drizzle ORM** + `drizzle-kit` | SQL próximo do metal, tipos inferidos, migrações versionadas |
| Banco remoto | PostgreSQL (DEC-05) | Integridade, `jsonb`, transações |
| Hash de senha | `argon2` (argon2id) | RNF-04 |
| Logs | `pino` | Estruturado, sem PII |
| Testes | Vitest, fast-check, Playwright, axe-core | §14 |
| Gerenciador | pnpm workspaces | Monorepo simples |
| Contêineres | **Docker** (build multi-stage) + **Docker Compose** | Ambiente idêntico em desenvolvimento, CI e produção; sobe API, web e PostgreSQL com um comando (§17) |

**Versões:** fixar no `pnpm-lock.yaml` a versão estável corrente na criação do repositório. As imagens Docker são fixadas por **versão e digest** (`node:<versão>-slim@sha256:…`, `postgres:<versão>`, `nginx:<versão>-alpine@sha256:…`). Este documento NÃO fixa números de versão para não envelhecer.

**Alternativas descartadas:** Redux/RTK Query (duplicaria o estado que já está no Dexie); Tailwind (os tokens do tema do torneio ficam mais claros em CSS próprio); CRDT/Yjs (excesso para um dispositivo); SSR para a página pública (um snapshot JSON com cache dispensa servidor de renderização no MVP).

---

## 3. Estrutura do repositório

```text
playtorneios/
├─ apps/
│  ├─ web/                  # Admin PWA + página pública (dois entry points)
│  │  ├─ src/
│  │  │  ├─ admin/          # rotas, telas e features do organizador
│  │  │  ├─ public/         # página pública (bundle separado, sem Dexie)
│  │  │  ├─ data/           # Dexie: schema, repositórios, outbox
│  │  │  ├─ sync/           # motor de sincronização (sem React)
│  │  │  ├─ ui/             # design system Arena Noturna
│  │  │  ├─ pwa/            # registro do service worker, atualização
│  │  │  └─ lib/            # formatação, datas, utilidades
│  │  ├─ public.html
│  │  ├─ index.html
│  │  ├─ Dockerfile         # build do front + imagem nginx com os estáticos (§17.2)
│  │  └─ nginx.conf         # cabeçalhos de segurança, cache e fallback de SPA (§17.3)
│  └─ api/
│     ├─ Dockerfile         # build multi-stage da API (§17.2)
│     ├─ src/
│     │  ├─ http/           # rotas Fastify
│     │  ├─ auth/           # sessão, argon2id, limites de tentativa
│     │  ├─ sync/           # aplicação idempotente de operações
│     │  ├─ publish/        # construtor do snapshot público
│     │  ├─ db/             # schema Drizzle, migrações
│     │  └─ jobs/           # limpeza de sessões, retenção
│     └─ drizzle/
├─ packages/
│  ├─ domain/               # REGRAS PURAS: sem I/O, sem React, sem Dexie, sem Fastify
│  │  └─ src/{bracket,groups,scoring,standings,schedule,impact,results,eligibility,theme}
│  ├─ contracts/            # schemas Zod, tipos de operação, DTOs do sync e do snapshot
│  └─ config/               # tsconfig, eslint, prettier compartilhados
├─ docker-compose.yml       # base: api, web, db (§17.1)
├─ docker-compose.dev.yml   # sobreposição de desenvolvimento (hot reload, portas, volumes)
├─ docker-compose.prod.yml  # sobreposição de produção (imagens publicadas, recursos, segredos)
├─ .dockerignore
├─ .env.example             # variáveis documentadas, sem segredos
└─ docs/                    # PRD, ARCHITECTURE, DECISIONS, ROADMAP, CLAUDE, SPECS
```

### 3.1 Regras de dependência (verificadas por lint)

```text
apps/web ──▶ packages/domain, packages/contracts
apps/api ──▶ packages/domain, packages/contracts
packages/domain ──▶ (nada além de utilidades puras)
packages/contracts ──▶ zod, packages/domain (somente tipos)
```

- `packages/domain` NÃO DEVE importar `react`, `dexie`, `fastify`, `fetch`, `Date.now()` nem `Math.random()` diretamente. Tempo e aleatoriedade entram por parâmetro (`clock`, `rng`). Isso torna as regras determinísticas e testáveis (RNF-06, DEC-08).
- Componentes React NÃO DEVEM conter regra de competição. Eles chamam comandos do domínio e exibem o resultado.
- Regra de lint: `eslint-plugin-boundaries` (ou `no-restricted-imports`) quebra o build em violação.

---

## 4. Visão de camadas e fluxo de um comando

```text
 UI (React)
   │  dispara um COMANDO (ex.: registrarResultado)
   ▼
 Camada de aplicação (apps/web/src/data) ── valida com packages/domain
   │  transação Dexie única:
   │    1) aplica a mudança nas tabelas locais
   │    2) grava a OPERAÇÃO no outbox
   │    3) grava a linha de auditoria local
   ▼
 UI confirma "Salvo neste aparelho"     ← só DEPOIS do commit da transação (RF-19)
   │
   ▼  (em paralelo, quando houver rede)
 Motor de sync ── POST /sync/push ──▶ API valida de novo com packages/domain
                                      aplica no PostgreSQL, devolve status por operação
```

Garantias:

- **G1.** A UI NÃO DEVE mostrar "salvo" antes do commit local.
- **G2.** A UI NÃO DEVE mostrar "sincronizado" antes da confirmação do servidor para aquela operação.
- **G3.** Todo comando passa pela mesma validação no cliente e no servidor.
- **G4.** Classificação, avanço de chave e "partida pendente" são **derivados**, nunca digitados (regra 10).

---

## 5. Modelo de dados

### 5.1 Identificadores e versionamento

- Todos os IDs são **UUIDv7** gerados no cliente (ordenáveis no tempo, estáveis offline). Usar o pacote `uuidv7`.
- Toda linha de domínio tem: `id`, `organizationId`, `createdAt`, `updatedAt`, `version` (inteiro, incrementado **pelo servidor**), `deletedAt` (exclusão lógica).
- Todas as linhas carregam `organizationId` desde o MVP, mesmo com uma só organização (PRD §3.3, DEC-15). Toda consulta no servidor filtra por ele na camada de repositório.
- Datas e horas são instantes em **UTC ISO-8601** no armazenamento. A conversão para `America/Sao_Paulo` ocorre só na exibição (`Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' })`).

### 5.2 Entidades (tipos de domínio)

```ts
type Uuid = string;
type TournamentStatus = 'draft' | 'open' | 'closed';                 // RF-03
type Gender = 'male' | 'female' | 'mixed';
type Level = 'beginner' | 'intermediate' | 'advanced' | 'open';
type RegistrationStatus = 'pending' | 'approved' | 'canceled' | 'waitlist'; // RF-07

interface Tournament {
  id: Uuid; organizationId: Uuid; name: string; organizationName: string;
  startDate: string; endDate: string;            // 'YYYY-MM-DD'
  city: string; venue: string; description?: string;
  status: TournamentStatus;
  slug: string;                                  // usado na URL pública
  theme: { primary: string; accent: string; logoAssetId?: Uuid };      // RF-18
  publish: PublishSettings;
  defaults: { matchDurationMin: number; restMin: number };            // padrão do sistema
}

interface PublishSettings {
  published: boolean;
  autoPublishOnSync: boolean;
  sections: { pairs: boolean; brackets: boolean; schedule: boolean; results: boolean; podium: boolean };
  showDisplayNames: boolean;                      // nunca telefone nem nascimento por padrão
}

interface Court { id: Uuid; tournamentId: Uuid; name: string; location?: string; order: number }

interface Category {
  id: Uuid; tournamentId: Uuid; name: string;
  level?: Level; gender?: Gender; ageRange?: { min?: number; max?: number; referenceDate?: string };
  format: 'single_elimination' | 'groups_then_knockout';
  formatConfig: FormatConfig;
  scoring: ScoringRule;                           // §6.3
  tiebreakers: TiebreakerKey[];                   // ordenados (RF-11)
  capacity?: number; waitlistEnabled: boolean;
  thirdPlaceMatch: boolean;                       // §6.2
  lockedAt?: string;                              // regras congeladas ao iniciar (RF-11)
}

interface Athlete {
  id: Uuid; fullName: string; phone?: string; birthDate?: string; city?: string;
  anonymizedAt?: string;                          // LGPD (§13)
}

interface Pair {                                  // dupla
  id: Uuid; tournamentId: Uuid; athleteAId: Uuid; athleteBId: Uuid; displayName?: string;
}

interface Registration {
  id: Uuid; tournamentId: Uuid; categoryId: Uuid; pairId: Uuid;
  status: RegistrationStatus; waitlistPosition?: number;
  checkedInA: boolean; checkedInB: boolean;       // RF-13 (dupla = ambos)
  seed?: number; protectedSeed?: boolean;
}

type Slot =
  | { kind: 'pair'; pairId: Uuid }
  | { kind: 'winnerOf'; matchId: Uuid }
  | { kind: 'loserOf'; matchId: Uuid }
  | { kind: 'groupPosition'; groupId: Uuid; position: number }
  | { kind: 'bye' };

interface Match {
  id: Uuid; tournamentId: Uuid; categoryId: Uuid;
  phase: 'group' | 'knockout'; groupId?: Uuid;
  round: number; indexInRound: number; label: string;   // ex.: 'Quartas · jogo 1'
  slotA: Slot; slotB: Slot;
  courtId?: Uuid; scheduledAt?: string; durationMin?: number;
  lifecycle: 'not_started' | 'in_progress' | 'finished';
}

type ResultKind = 'normal' | 'walkover' | 'retired' | 'pending';  // RF-14, regra 7

interface ResultRevision {                        // append-only (RF-14, DEC-11)
  id: Uuid; matchId: Uuid; revision: number;      // 1, 2, 3…
  kind: ResultKind;
  winnerPairId?: Uuid;                            // obrigatório em normal/walkover/retired
  sets?: Array<{ a: number; b: number }>;         // modelo por sets
  points?: { a: number; b: number };              // modelo por pontuação-alvo
  retiredPairId?: Uuid;                           // quem abandonou
  reason?: string;                                // obrigatório quando revision > 1
  supersedesRevisionId?: Uuid;
  invalidatedAt?: string; invalidatedBy?: 'bracket_change' | 'correction';
  recordedAt: string; deviceId: string;
}
```

O **resultado atual** de uma partida é a revisão mais alta que não esteja invalidada. Nunca se atualiza uma revisão: acrescenta-se outra (§6.8).

### 5.3 Tabelas PostgreSQL (essenciais)

```sql
create extension if not exists citext;            -- necessário para users.email

create table organizations (id uuid primary key, name text not null, created_at timestamptz not null default now());

create table users (
  id uuid primary key, organization_id uuid not null references organizations,
  email citext unique not null, password_hash text not null,
  failed_logins int not null default 0, locked_until timestamptz,
  created_at timestamptz not null default now()
);

create table sessions (
  id_hash bytea primary key,                      -- hash SHA-256 do token; o token nunca é gravado
  user_id uuid not null references users, created_at timestamptz not null default now(),
  last_seen_at timestamptz not null, expires_at timestamptz not null, user_agent text
);

create table tournaments (
  id uuid primary key, organization_id uuid not null references organizations,
  name text not null, slug text not null, status text not null check (status in ('draft','open','closed')),
  data jsonb not null,                            -- demais campos validados por Zod
  version int not null default 1, deleted_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, slug)
);
-- categories, courts, athletes, pairs, registrations, matches seguem o mesmo padrão:
-- colunas de chave/consulta explícitas + `data jsonb` + version + deleted_at.

create table result_revisions (
  id uuid primary key, match_id uuid not null, revision int not null,
  data jsonb not null, recorded_at timestamptz not null, device_id text not null,
  unique (match_id, revision)
);

create table applied_operations (                  -- idempotência (RF-20)
  device_id text not null, op_id uuid not null, seq bigint not null,
  status text not null check (status in ('applied','rejected','conflict','blocked')),
  response jsonb not null, received_at timestamptz not null default now(),
  primary key (device_id, op_id)
);

create table sync_conflicts (
  id uuid primary key, tournament_id uuid not null, entity_type text not null, entity_id uuid not null,
  device_op jsonb not null, server_value jsonb not null,
  status text not null default 'open' check (status in ('open','resolved')),
  resolution text check (resolution in ('keep_device','keep_server')),
  created_at timestamptz not null default now(), resolved_at timestamptz
);

create table audit_log (
  id uuid primary key, organization_id uuid not null, tournament_id uuid,
  entity_type text not null, entity_id uuid not null, action text not null,
  before jsonb, after jsonb, reason text, device_id text, at timestamptz not null default now()
);

create table public_snapshots (
  tournament_id uuid not null, version bigint not null, payload jsonb not null,
  published_at timestamptz not null default now(), primary key (tournament_id, version)
);

create table assets (id uuid primary key, organization_id uuid not null, kind text not null,
  mime text not null, bytes bytea not null, sha256 text not null, created_at timestamptz not null default now());
```

Decisão de modelagem: colunas explícitas só para o que se filtra, junta ou ordena; o restante vai em `data jsonb` validado por Zod. Isso reduz migrações enquanto o produto ainda muda, e mantém integridade onde importa (chaves estrangeiras, unicidade, índices).

Índices mínimos: `(organization_id, tournament_id)` em todas as tabelas de domínio; `matches (category_id, round, index_in_round)`; `matches (court_id, scheduled_at)`; `registrations (category_id, status)`; `result_revisions (match_id, revision desc)`; `audit_log (tournament_id, at desc)`.

### 5.4 Schema do Dexie (cliente)

```ts
db.version(1).stores({
  tournaments:   'id, organizationId, status, slug',
  categories:    'id, tournamentId',
  courts:        'id, tournamentId, order',
  athletes:      'id, fullName',                         // + índice de busca normalizada (§12.4)
  pairs:         'id, tournamentId, athleteAId, athleteBId',
  registrations: 'id, tournamentId, categoryId, pairId, status, [categoryId+status]',
  matches:       'id, tournamentId, categoryId, courtId, scheduledAt, [categoryId+round]',
  results:       'id, matchId, [matchId+revision]',
  liveDrafts:    'matchId',                              // placar em andamento (§9.3)
  outbox:        '++localSeq, opId, status, entityId, createdAt',
  conflicts:     'id, status, entityId',
  discardedOps:  'opId, discardedAt',                    // nada é descartado em silêncio
  auditLocal:    'id, tournamentId, at',
  assets:        'id, sha256',
  meta:          'key'                                   // deviceId, cursor de pull, versão do schema
});
```

Migrações do Dexie ficam em `data/migrations/` com um teste por versão (abre um banco da versão N−1 com dados reais de fixture e confere a atualização).

---

## 6. Módulo de domínio (`packages/domain`)

Todas as funções são puras, tipadas e sem relógio nem aleatoriedade internos.

### 6.1 Contratos públicos do módulo

```ts
// bracket
generateSingleElimination(input: { pairs: SeededPair[]; thirdPlace: boolean; rng: Rng }): BracketPlan
generateGroupsThenKnockout(input: { pairs: SeededPair[]; groups: number; advancePerGroup: number; rng: Rng; thirdPlace: boolean }): BracketPlan
validateFormat(format: FormatConfig, pairCount: number): FormatValidation   // RF-09

// scoring
validateScore(rule: ScoringRule, entry: ScoreEntry): ValidationIssue[]
decideWinner(rule: ScoringRule, entry: ScoreEntry): { winner: 'a' | 'b' } | { error: string }

// standings
computeGroupStandings(input: { pairs: Uuid[]; matches: Match[]; results: CurrentResults; rule: ScoringRule; tiebreakers: TiebreakerKey[] }): Standing[]
computePodium(category: Category, matches: Match[], results: CurrentResults): Podium

// resolução da chave
resolveBracket(matches: Match[], results: CurrentResults, groupStandings: Record<Uuid, Standing[]>): ResolvedMatch[]

// agenda
proposeSchedule(input: ScheduleInput): ScheduleProposal
detectScheduleIssues(schedule: ScheduledMatch[], opts: ScheduleOpts): ScheduleIssue[]

// impacto
analyzeBracketChange(before: BracketState, after: BracketState, results: ResultRevision[]): ImpactReport
analyzeResultCorrection(state: BracketState, newResult: ResultRevision): ImpactReport

// tema
deriveTheme(input: { primary: string; accent: string }): ThemeResult           // RF-18
```

### 6.2 Chaves

**Eliminação simples.**

1. `size` = menor potência de 2 ≥ `n`. `byes = size − n`.
2. Semeadura padrão (1 contra `size`, 2 contra `size−1`…) montada pelo algoritmo clássico de posições espelhadas, de forma que cabeças de chave só se encontrem o mais tarde possível.
3. **Cabeças de chave e posições protegidas** (RF-10): duplas com `seed` ocupam as posições canônicas. As demais são sorteadas nas posições livres.
4. **Byes** vão para as melhores semeaduras. Uma partida com bye gera `Slot { kind: 'bye' }` e a dupla avança sem registro de resultado. O bye NÃO conta como vitória na classificação.
5. O sorteio usa um PRNG com semente (`mulberry32` ou similar). **A semente e a versão do algoritmo são gravadas** com a chave. Isso permite reproduzir e auditar o sorteio.
6. **3º lugar:** `Category.thirdPlaceMatch` (padrão `false`). Sem a disputa, as duas duplas derrotadas nas semifinais ficam **empatadas em 3º** e o sistema apresenta o empate, sem inventar ordem (RF-15). Com a disputa, gera-se uma partida `loserOf(semi1)` x `loserOf(semi2)`.
7. Número mínimo: 2 duplas (final direta). Com 1 dupla ou nenhuma, `validateFormat` devolve inviável com mensagem clara.

**Grupos seguidos de eliminatórias.**

1. `validateFormat`: cada grupo precisa de ao menos 3 duplas (padrão do sistema), `groups × advancePerGroup` deve formar uma chave válida (potência de 2 ou aceitar byes). Configuração inviável devolve a lista de alternativas válidas (ex.: "12 duplas: 4 grupos de 3, classificam 2 → 8 na eliminatória").
2. Distribuição em grupos por **serpentina** a partir da semeadura (evita cabeças no mesmo grupo); duplas sem semente são sorteadas.
3. Cada grupo gera todos-contra-todos interno (partidas `phase: 'group'`).
4. A eliminatória usa `Slot { kind: 'groupPosition', groupId, position }`, resolvida só quando todos os jogos do grupo estiverem decididos.
5. **Cruzamento padrão:** 1º de um grupo contra 2º de outro, evitando reencontro do mesmo grupo na primeira rodada.

### 6.3 Pontuação (RF-11)

```ts
type ScoringRule =
  | { model: 'target'; targetPoints: number; winBy: 1 | 2; cap?: number }
  | { model: 'sets';   bestOf: 1 | 3 | 5; setPoints: number; decidingSetPoints?: number; winBy: 1 | 2; cap?: number };

type TiebreakerKey =
  | 'wins' | 'head_to_head' | 'set_diff' | 'point_diff' | 'points_for' | 'manual_draw';
```

**Padrões do sistema** (identificados na UI como "Padrão do sistema, não regulamento oficial"):

| Categoria típica | Modelo | Valores |
|---|---|---|
| Grupos | `target` | 18 pontos, diferença de 2, teto 21 |
| Eliminatória | `sets` | melhor de 3, set de 18, decisivo de 15, diferença de 2 |

`validateScore` recusa: placar que não decide vencedor, vencedor com menos pontos que o alvo, diferença menor que `winBy` fora do teto, quantidade de sets incompatível com `bestOf`, valores negativos ou não inteiros. As mensagens de erro dizem o que corrigir ("O set 2 precisa terminar com diferença de 2 pontos").

**W.O. e abandono** (regra 7):

- `walkover`: `winnerPairId` obrigatório; não há placar; **não entra** no saldo de pontos por padrão. Configurável por categoria: `woCredit: 'none' | { a: number; b: number }`.
- `retired`: `winnerPairId` e `retiredPairId` obrigatórios; o placar parcial é guardado e **entra** nos totais como jogado.
- `pending`: partida não decidida; **não avança** a chave (regra 6).

### 6.4 Classificação e desempate (RF-15, regra 10)

`computeGroupStandings` devolve, por dupla: jogos, vitórias, derrotas, saldo de sets, saldo de pontos, pontos pró, posição **e uma marca de empate não resolvido**.

Ordem padrão dos critérios: `wins → head_to_head → set_diff → point_diff → points_for → manual_draw`. A categoria pode reordenar (lista ordenada, RF-11).

**Confronto direto com mais de duas duplas empatadas:** formar a "mini-tabela" só com os jogos entre as empatadas e reaplicar os critérios seguintes apenas dentro dela. Se a mini-tabela ainda empata, passa ao próximo critério global.

**Empate irredutível:** NÃO inventar ordem. A posição sai com `tie: { with: Uuid[], resolvedBy: null }` e a UI mostra "Empate em 2º lugar" com a ação **Decidir por sorteio ou critério do organizador**. A decisão vira um `ResultRevision`-like `TieResolution` auditável. Só então a posição fica definida.

`computePodium` aplica o mesmo princípio: devolve apenas posições justificadas pelos resultados, com empates explícitos (ex.: dois 3º lugares sem disputa de 3º).

### 6.5 Resolução da chave (avanço derivado)

`resolveBracket` percorre as partidas em ordem topológica e substitui cada `Slot` por uma dupla quando é possível:

- `winnerOf(m)` → vencedor do resultado atual de `m`, se `kind ≠ pending`.
- `loserOf(m)` → o outro.
- `groupPosition` → posição da classificação, se o grupo estiver completo e sem empate irresolvido.
- `bye` → a dupla adversária avança sem resultado.

Como o avanço é **calculado e não gravado**, uma correção de placar atualiza toda a chave de forma consistente, sem estado duplicado para ficar defasado. É a base da integridade exigida por RNF-03.

### 6.6 Agenda (RF-12)

**Entrada:** partidas, quadras, início do dia, duração (padrão **40 min**), descanso (padrão **20 min**), restrições manuais já fixadas.

**Proposta automática** (`proposeSchedule`), heurística gulosa por camadas:

1. Ordenar partidas por (fase, rodada, índice). Grupos antes da eliminatória.
2. Para cada partida, achar o **menor início** em alguma quadra tal que: a quadra esteja livre; as duas duplas (se já conhecidas) tenham terminado o jogo anterior há pelo menos `restMin`; o início seja ≥ fim de cada partida predecessora (`winnerOf`/`loserOf`).
3. Desempate entre quadras: a que fica livre mais cedo; depois a de menor `order`.
4. Partidas que não cabem (fim do dia configurado) ficam **sem horário** e entram na lista de pendências. O sistema permite partidas sem horário (RF-12).

**Verificação** (`detectScheduleIssues`) devolve problemas tipados:

| Código | Gravidade | Regra |
|---|---|---|
| `PAIR_OVERLAP` | **bloqueio** | Mesma dupla em duas partidas sobrepostas (regra 5). Nunca pode ser salvo |
| `COURT_OVERLAP` | **bloqueio** | Duas partidas na mesma quadra no mesmo intervalo |
| `DEPENDENCY_ORDER` | **bloqueio** | Partida programada antes do fim da que a alimenta |
| `REST_VIOLATION` | **bloqueio com exceção** | Descanso menor que `restMin`. O organizador pode forçar com confirmação explícita, e a exceção é registrada na auditoria |
| `OVER_DAY_LIMIT` | aviso | Fora da janela de horário do dia |

A estimativa de duração é só auxiliar. A UI nunca apresenta como garantia de horário (RF-12). Partidas atrasadas são reprogramadas manualmente.

Duplas ainda desconhecidas (`winnerOf`) não geram conflito de dupla até serem resolvidas. Quando a chave resolve e cria sobreposição, o conflito aparece na hora e na Central (card "Conflito de agenda").

### 6.7 Análise de impacto (RF-10, regra 9)

`analyzeBracketChange(before, after, results)` classifica cada resultado existente:

- **preservado**: a partida mantém exatamente as mesmas duas duplas.
- **invalidado**: pelo menos uma dupla da partida mudou.
- **recalculado**: partida cujos participantes derivados mudam por consequência.

O relatório lista, em português, o que acontece com cada resultado e quais partidas perdem horário. A aplicação exige um **token de confirmação** derivado do hash do relatório. Se o estado mudar entre a pré-visualização e a confirmação, o token deixa de valer e o relatório é refeito. Resultados invalidados ganham `invalidatedAt` e permanecem no histórico, recuperáveis. **Nada é apagado.**

Se `blocking: true` (ex.: troca que tornaria um resultado logicamente impossível), a aplicação automática é recusada e a UI oferece apenas cancelar ou fazer a troca em duas etapas.

### 6.8 Correção de resultado (RF-14, DEC-11)

1. Primeira gravação: `revision = 1`, sem justificativa.
2. Correção: `revision = n+1`, `reason` obrigatória (mínimo **10 caracteres**, ver §11.5), `supersedesRevisionId`.
3. O comando chama `analyzeResultCorrection`. Se a mudança de vencedor afetar partidas já jogadas adiante, o impacto é exibido e exige confirmação (mesmo token de §6.7).
4. A auditoria guarda: valor anterior, novo valor, justificativa, data/hora e dispositivo.

### 6.9 Elegibilidade

`checkEligibility(athlete, category, referenceDate)` aplica faixa etária e gênero. O resultado é **aviso explícito ao administrador**, nunca bloqueio silencioso. Datas de nascimento só são pedidas quando a categoria tem faixa etária (RF-04, minimização).

### 6.10 Tema do torneio (RF-18)

`deriveTheme({ primary, accent })`:

1. Calcula a luminância relativa (WCAG) de cada cor.
2. Escolhe `onPrimary` e `onAccent` entre `#0A0E14` e `#F2F5F7`, o que der maior contraste.
3. **Rejeita** (`ok: false`, motivo em português) se:
   - `onPrimary` sobre `primary` tiver contraste < **4,5:1**;
   - `primary` contra a superfície `--surf` (`#121922`) tiver contraste < **3:1** (bordas e foco legíveis);
   - `primary` e `accent` forem próximas demais (ΔE baixo) para distinguir estados.
4. Gera variações (hover, fundo suave) por mistura com `--bg`.
5. **Cores semânticas (ok, aviso, erro, info, ao vivo) são fixas** e não vêm do tema, para que o significado nunca dependa da cor do torneio.

---

## 7. Sincronização (RF-19, RF-20, DEC-06)

### 7.1 Operação

```ts
interface Operation {
  opId: Uuid;                  // UUIDv7, idempotência
  deviceId: string;            // gerado uma vez, guardado em meta
  seq: number;                 // crescente por dispositivo (localSeq)
  type: OperationType;         // 'tournament.update' | 'result.record' | 'bracket.generate' | ...
  entityType: string; entityId: Uuid; tournamentId: Uuid;
  baseVersion?: number;        // versão do servidor que o cliente conhecia
  payload: unknown;            // validado por Zod do tipo correspondente
  clientCreatedAt: string;
  schemaVersion: number;
  resolution?: { conflictId: Uuid; keep: 'device' };
}
```

Cada tipo de operação corresponde a um **comando de negócio**, não a um `UPDATE` genérico. O servidor reaplica as regras do domínio (G3).

### 7.2 Protocolo

| Endpoint | Função |
|---|---|
| `POST /sync/push` | Lote de operações em ordem de `seq`. Resposta com status por operação |
| `GET /sync/pull?since=<cursor>` | Mudanças do servidor desde o cursor (restauração e detecção de divergência) |
| `GET /sync/conflicts` | Conflitos abertos |
| `POST /sync/conflicts/:id/resolve` | `keep: 'device' \| 'server'` |
| `GET /health` | Verificação leve de rede real (§7.5) |

**Resposta de `push`** (por operação):

```json
{ "opId": "…", "status": "applied | duplicate | rejected | conflict | blocked",
  "newVersion": 7, "error": { "code": "…", "message": "…" }, "conflictId": "…" }
```

### 7.3 Idempotência

- A chave é `(deviceId, opId)`. O servidor consulta `applied_operations`. Se existir, devolve **a resposta guardada** (`duplicate`) sem reaplicar.
- A gravação em `applied_operations` e a aplicação da operação ocorrem **na mesma transação** do PostgreSQL. Não existe estado em que a operação foi aplicada e não registrada.
- Uma resposta perdida (rede caiu depois do commit) é tratada pelo reenvio: devolve `duplicate` com o mesmo resultado. O cliente então marca como sincronizada.

### 7.4 Detecção de conflito

- O servidor compara `op.baseVersion` com a `version` atual da entidade.
- `baseVersion == version`: aplica e incrementa `version`.
- `baseVersion < version` **e** campos sobrepostos: **não aplica**. Grava `sync_conflicts` com a operação do dispositivo e o valor do servidor. Devolve `conflict`.
- `baseVersion < version` sem sobreposição de campos: aplica (merge por campo).
- Operações posteriores sobre a mesma entidade ficam `blocked` até o conflito ser resolvido, preservando a ordem causal.

**Resolução** (a única parte que exige o organizador):

- **Manter este aparelho:** o cliente reenvia a operação com `resolution.keep = 'device'` e `baseVersion` = versão atual do servidor. O servidor aplica como nova revisão e **guarda o valor antigo do servidor** no histórico.
- **Manter servidor:** o cliente aplica o valor do servidor localmente e move a operação local para `discardedOps` (recuperável). **Nunca se descarta sem registro** (regra 12, RF-20).

Como o MVP usa um único dispositivo, o conflito típico é de edição fora do dispositivo (outro navegador, correção direta no servidor). A UI mostra os dois valores lado a lado, em linguagem simples (§11.6).

### 7.5 Estados e transições

```text
            ┌────────────┐ perde rede      ┌──────────┐
            │  ONLINE    │────────────────▶│ OFFLINE  │
            │ (em dia)   │◀────────────────│          │
            └─────┬──────┘  volta rede     └────┬─────┘
       op local   │                              │ volta rede e outbox > 0
                  ▼                              ▼
            ┌────────────┐   ok          ┌────────────┐
            │ SINCRONIZ. │──────────────▶│  ONLINE    │
            │            │ erro retentável│           │
            └─────┬──────┘               └────────────┘
                  │ rejected/conflict
                  ▼
        ┌──────────────────┐
        │ CONFLITO / ERRO  │  exige ação do organizador
        └──────────────────┘
```

O estado exibido é **derivado** de: `rede real`, `outbox.pending`, `outbox.inFlight`, `conflicts.open`, `lastError`.

| Estado na UI | Condição |
|---|---|
| Online | rede ok, outbox vazio, sem conflitos |
| Offline | `/health` falha |
| Sincronizando | `inFlight > 0` |
| Pendente | rede ok, `pending > 0`, aguardando próxima tentativa |
| Falha recuperável | último push falhou por erro de rede ou 5xx |
| Conflito | `conflicts.open > 0` |

**Rede real:** `navigator.onLine` não basta (ele diz "tem interface", não "tem servidor"). O motor combina os eventos `online`/`offline` com um *heartbeat* em `GET /health` a cada 15 s enquanto a aba está visível, e imediatamente após falha de `push`.

**Retentativas:** *backoff* exponencial com jitter, 2 s → 5 s → 15 s → 30 s → 60 s (teto). Disparos extras: evento `online`, retorno da aba ao foco, botão "Sincronizar agora", e 1 s depois de uma gravação local. **Erros 4xx de validação não são reenviados** automaticamente: a operação vira `rejected`, é exibida com a mensagem e fica no outbox até o organizador decidir.

### 7.6 Compactação do outbox

Operações sucessivas que só sobrescrevem o mesmo estado transitório podem ser colapsadas **antes do envio**, e só estas:

- `match.live_score` da mesma partida → mantém a última (§9.3).
- Nunca colapsar `result.record`, `bracket.*`, `registration.*`: cada uma é um fato de negócio auditável.

### 7.7 Ordem e dependências

O envio respeita `seq`. Uma operação que depende de entidade criada por outra só é enviada depois que a anterior for `applied`. Em caso de `rejected`, as dependentes ficam `blocked` e a UI mostra a cadeia.

---

## 8. API e segurança

### 8.1 Endpoints principais

| Grupo | Rotas |
|---|---|
| Auth | `POST /auth/login`, `POST /auth/logout`, `GET /auth/session` |
| Sync | ver §7.2 |
| Assets | `POST /assets` (logotipo), `GET /assets/:id` |
| Publicação | `POST /tournaments/:id/publish`, `GET /tournaments/:id/publish/status` |
| Exportação servidor | `GET /tournaments/:id/export.json` (backup completo) |
| Público | `GET /public/tournaments/:slug` (snapshot, `ETag`) |
| Saúde | `GET /health` |

A API NÃO expõe CRUD genérico das entidades. A escrita de domínio entra **somente** por `POST /sync/push`. Isso garante um único caminho para validação, idempotência e auditoria.

### 8.2 Autenticação e sessão (RF-01, RNF-04)

- Senha: **argon2id**; nunca em texto puro, nunca em log.
- Sessão: token aleatório de 256 bits em cookie `HttpOnly; Secure; SameSite=Strict`. No banco guarda-se apenas o **hash** do token.
- **Expiração por inatividade:** padrão **8 h** (Decisão pendente). Renovação deslizante em cada requisição autenticada. **Expiração absoluta:** 7 dias.
- **Limite de tentativas:** 5 falhas por conta e por IP em 15 min → bloqueio progressivo. Resposta de erro idêntica para usuário inexistente e senha errada.
- **CSRF:** `SameSite=Strict` mais verificação de cabeçalho `Origin`. Cabeçalho `X-Requested-With` nas chamadas do app. Como `web` e `api` são servidos pela **mesma origem** (§17.1), não há CORS aberto.
- **Cabeçalhos:** CSP restritiva (`default-src 'self'`; sem scripts inline; fontes e imagens `self`/`data:`), `X-Content-Type-Options`, `Referrer-Policy: same-origin`, HSTS (RNF-04).

### 8.3 Autorização

Um único papel `admin` no MVP (DEC-10). Mesmo assim, **toda** consulta passa por um repositório que força `organization_id = sessão.organizationId`. Isso evita acesso entre organizações quando houver mais de uma.

### 8.4 Validação

Schemas Zod em `packages/contracts`, usados no cliente (formulários e comandos) e no servidor (entrada de `push`). Tamanhos máximos em todo campo de texto; rejeitar campos desconhecidos (`strict()`).

### 8.5 Sessão offline (Decisão pendente DEC-17)

Offline, o servidor não pode validar a sessão. O PRD exige expiração por inatividade. Proposta:

1. O app guarda o estado "autenticado em <data>" localmente após login online.
2. Offline, a **expiração por inatividade é aplicada no cliente** (tela de bloqueio após o prazo).
3. Para desbloquear offline, um **PIN local** definido no login online. Armazenar só um verificador derivado (PBKDF2 via WebCrypto) em IndexedDB, nunca o PIN.
4. Ao voltar a rede, a sessão do servidor é revalidada. Se expirou, o app exige login completo, **sem apagar** dados locais nem o outbox.

Risco assumido e documentado: quem tem acesso ao dispositivo desbloqueado tem acesso aos dados locais (que ficam em IndexedDB sem criptografia do app). Mitigações: bloqueio por PIN, orientação operacional (bloqueio de tela do dispositivo), limpeza de dados pessoais na exportação.

---

## 9. PWA e operação offline (RNF-05)

### 9.1 Service worker

- `vite-plugin-pwa`, `registerType: 'prompt'`. **Não** usar `skipWaiting` automático.
- **Precache:** shell, chunks das rotas administrativas, fontes autoalojadas, chunk do `pdfmake`, ícones.
- **Runtime cache:** `GET /public/...` com `StaleWhileRevalidate` (somente a página pública). `POST /sync/*` **nunca** é cacheado nem reexecutado pelo service worker. O reenvio é do motor de sync, que conhece idempotência.
- Fallback de navegação offline para o shell.

### 9.2 Atualização segura do app

Atualizar o código pode trocar a versão do schema do Dexie. Para não surpreender no meio de um jogo:

1. O app detecta nova versão e mostra "Atualização disponível" **sem recarregar**.
2. Só oferece "Atualizar agora" quando **não há diálogo aberto nem placar em edição**.
3. Antes de aplicar uma migração de schema, o app **grava um backup JSON** local (store `meta`) e oferece baixar o arquivo.
4. Dexie executa a migração; em falha, o app mantém o schema anterior, mostra erro e preserva o backup.

### 9.3 Placar ao vivo e rascunho

O mockup mostra botões `+1` direto na partida em andamento. No produto:

- Cada toque grava em `liveDrafts` (Dexie, durável, sobrevive a recarga). **Não** gera uma operação de sync por ponto.
- A cada alteração, uma operação `match.live_score` é enfileirada e **compactada** (§7.6), enviando no máximo o último valor. A página pública pode mostrar "ao vivo" com atraso, **somente** a versão sincronizada (PRD §9).
- **Finalizar partida** valida com `validateScore`, cria `ResultRevision #1` e remove o rascunho. Esta é a operação de negócio auditável.
- **Desfazer ponto** remove o último evento do rascunho (guardar a sequência de pontos, não só o total).

### 9.4 Persistência e cota

- Chamar `navigator.storage.persist()` ao concluir a preparação inicial e mostrar o resultado na tela de preparação.
- Monitorar `navigator.storage.estimate()`; avisar acima de 80% da cota.
- **Safari/iOS** pode limpar dados de sites pouco usados. Orientar na documentação: instalar o PWA na tela inicial e **exportar backup antes do evento**.
- Tela **Preparar para o evento** (checklist verificável): service worker ativo, dados baixados, persistência concedida, backup exportado, relógio do dispositivo conferido.

### 9.5 Backup e restauração (RF-22)

- **Exportar:** arquivo JSON versionado (`schemaVersion`), com todas as entidades do torneio, resultados, auditoria e outbox, mais hash SHA-256 de integridade. Nome: `playtorneios-<slug>-AAAAMMDD-HHMM.json`.
- **Importar:** validar com Zod, mostrar **pré-visualização** (contagens), e restaurar em um **banco novo** (nunca mesclar silenciosamente). Confirmação explícita antes de substituir o banco atual, que é antes salvo em backup automático.
- Backups automáticos locais antes de: migração de schema, refazer sorteio, encerrar/reabrir torneio, importação.

---

## 10. Página pública (RF-16, DEC-07)

### 10.1 Princípios

- Bundle **separado** (`public.html`), sem Dexie nem lógica administrativa. Meta: ≤ 80 kB gzip.
- Lê **somente** `GET /public/tournaments/:slug`.
- NÃO DEVE conter nenhum código que escreva dados.

### 10.2 Snapshot e filtragem por lista de permissão

O servidor monta o snapshot com `toPublicSnapshot(tournament, publishSettings)`, uma função que **constrói o objeto campo a campo** (lista de permissão). Nunca copia uma entidade inteira e remove campos.

```ts
interface PublicSnapshot {
  version: number; publishedAt: string;
  tournament: { name: string; dates: string; city: string; venue: string; description?: string; theme: {…}; logoUrl?: string };
  categories: Array<{ id: string; name: string; format: string }>;
  pairs?: Array<{ id: string; categoryId: string; name: string }>;       // só nomes (ou nome de exibição)
  matches?: Array<{ id: string; categoryId: string; round: string; courtName?: string; scheduledAt?: string;
                    a: string | null; b: string | null; status: string; result?: PublicResult }>;
  standings?: …; podium?: …;
}
```

- **Nunca** entram: telefone, data de nascimento, cidade do atleta, justificativas de correção, histórico, dados de check-in, IDs internos de atleta.
- Um teste automatizado percorre o JSON do snapshot e falha se encontrar qualquer chave fora da lista de permissão, ou qualquer valor que case com padrões de telefone/data de nascimento da fixture.
- Seções desligadas em `PublishSettings` não aparecem no JSON (não são só escondidas na tela).

### 10.3 Quando publica

- Manual (botão **Publicar**) ou automático ao final de um `push` bem-sucedido (`autoPublishOnSync`).
- Cada publicação cria uma linha em `public_snapshots` com `version` crescente; a página mostra `publishedAt`.
- **Com o admin offline, o público continua vendo a última versão publicada.** A UI do administrador mostra isso de forma explícita ("o público vê a versão das 15:02"), cumprindo a limitação do PRD §9.
- A página consulta a cada **15 s** com a aba visível (decisão de 29/10/2026), com `cache: 'no-cache'` para não ficar com placar velho; pausa em segundo plano, dobra o intervalo a cada falha (até 60 s) e avisa "Sem conexão. Mostrando dados das HH:MM".

### 10.4 Acessibilidade e leitura em celular ao sol

A página pública usa o mesmo sistema visual, com tema configurável. Decisões de 29/10/2026 (auditoria de UX):

- **Tema:** segue o aparelho (escuro ou claro, `prefers-color-scheme`); o botão **Modo sol** troca para o tema claro de alto contraste (§11.7) e lembra a escolha, já que o uso típico é no celular ao ar livre.
- **Fonte:** fonte do sistema, sem fontes de terceiros nem arquivos de fonte extras (mantém a página leve em rede fraca e a CSP `font-src 'self'`).
- **Seguir uma dupla:** o nome da dupla fica só no `localStorage` do aparelho do visitante (até 6 por torneio) e nada é enviado ao servidor.

---

## 11. Design e interface: *Arena Noturna*

O mockup `m2.html` é a **referência visual e de interação**, não código de produção. A tabela abaixo lista o que o mockup simplifica e o que o produto precisa fazer de diferente.

| No mockup | No produto |
|---|---|
| Fontes via Google Fonts | **Autoalojar** com `@fontsource` e colocar em precache. Sem rede, a CDN não existe |
| Estado de rede e sync simulado por botões | Estado real do motor de sync (§7.5). Os botões viram um painel de desenvolvimento, desligado em produção |
| Dados em arrays JS | Dexie + `liveQuery` |
| Placar `+1` altera o total direto | Rascunho durável + eventos de ponto (§9.3) |
| Agenda com horários exatos como linhas | Grade com eixo de tempo e arrastar com alternativa por teclado (§11.3) |
| Quatro itens de navegação | Navegação completa (§11.2) |
| Troca de chave simplificada | Fluxo de impacto completo (§6.7) |

### 11.1 Tokens (variáveis CSS)

Valores do mockup, já medidos (contrastes calculados com a fórmula WCAG):

```css
:root {
  color-scheme: dark;
  --bg:#0A0E14;  --surf:#121922;  --surf2:#1A2330;  --hair:#263140;  --line:#5C6B7E;
  --tx:#F2F5F7;  --tx2:#A4AFBB;
  --amber:#FFB020; --on-amber:#0A0E14;          /* primária do torneio (tema) */
  --live:#FF6A4D;                                /* acento "ao vivo" (tema) */
  --ok:#2EE59D; --warn:#FFC53D; --err:#FF7A88; --info:#4DB8FF;   /* FIXAS, fora do tema */
  --f-head:'Saira Condensed',…; --f-body:'Barlow',…; --f-num:'JetBrains Mono',…;
}
```

| Par | Contraste medido |
|---|---|
| `--tx` sobre `--bg` | 17,7:1 |
| `--tx2` sobre `--surf` | 7,9:1 |
| `--on-amber` sobre `--amber` | 10,6:1 |
| `#0A0E14` sobre `--live` | 6,8:1 |
| `--line` (borda) sobre `--surf` | 3,2:1 |

Escala tipográfica: `Saira Condensed` 600/700/800 em maiúsculas para títulos; `Barlow` 400–700 para texto; `JetBrains Mono` 600/700 para placares e horários, sempre com `font-variant-numeric: tabular-nums`.

Regras: raio de 6 a 8 px; sem sombras decorativas além do brilho do placar (≤ 12 px, só no valor numérico); movimento só em (a) troca de dígito do placar e (b) giro do ícone de sincronização, ambos desligados com `prefers-reduced-motion`.

### 11.2 Mapa de navegação e rotas

Barra lateral em seções que seguem o ciclo de vida do torneio (preparar, inscrever, chaves e agenda, dia do evento, depois do evento, sistema), mais a barra superior fixa (busca global, estado de sync, atalho de placar). A ordem e os rótulos foram revistos em 29/10/2026 após auditoria de UX.

| Seção | Item | Rota | Observação |
|---|---|---|---|
| (sem rótulo) | Central | `/t/:id` | Mostra o próximo passo da preparação |
| Preparar | Dados do torneio | `/t/:id/torneio` | Passo 1 |
| | Quadras | `/t/:id/quadras` | Pré-requisito da Agenda |
| | Categorias e regras | `/t/:id/categorias` | Pré-requisito de inscrições e chaves |
| Inscrições | Atletas e duplas | `/t/:id/duplas` | Cadastro e “Inscrever” em categoria |
| | Inscrições e check-in | `/t/:id/inscricoes` | Aprovar, lista de espera, check-in |
| Chaves e agenda | Chaves | `/t/:id/chaves/:categoryId?` | |
| | Agenda | `/t/:id/agenda` | |
| Dia do evento | Resultados | `/t/:id/resultados` | Partidas e pódio |
| | Links dos juízes | `/t/:id/juizes` | Link e QR por quadra (DEC-29) |
| | Telão | `/t/:id/telao` | Tela cheia (DEC-30) |
| | Imprimir súmulas | `/t/:id/imprimir` | Reserva em papel |
| Depois do evento | Página pública | `/t/:id/publico` | |
| | Relatórios | `/t/:id/relatorios` | |
| | Encerramento | `/t/:id/encerramento` | |
| Sistema | Sincronização | `/sync` | |
| | Backup e segurança | `/sistema` | Backup, PIN e dados pessoais |
| | Login e bloqueio | `/login`, `/bloqueio` | |

Cada item pode mostrar uma segunda linha curta quando falta um pré-requisito (“Crie categorias antes”) ou há pendência (“2 a aprovar”); nenhum item some. Em telas estreitas (até 52 rem) o menu fica recolhido atrás do botão **Menu**, com a lista vertical por seções. A Central traz o cartão “Preparação do torneio”, com os passos deduzidos do estado local e o próximo passo destacado. As telas **novas** seguem os mesmos componentes e tokens, sem criar padrões novos.

### 11.3 Componentes

| Componente | Observações de implementação |
|---|---|
| `AppShell` | Landmarks `header`, `nav aria-label="Principal"`, `main#conteudo`; link "Ir para o conteúdo" |
| `GlobalSearch` | Atalho `/` e `Ctrl+K`. Padrão combobox (`role="combobox"`, `aria-expanded`, `aria-controls`, setas navegam, `Enter` abre, `Esc` fecha). Busca local no Dexie, funciona offline |
| `SyncChip` e `SyncCenter` | Região `role="status" aria-live="polite" aria-atomic="true"` **presente desde o carregamento**; `role="alert"` só para conflito. Anúncios com debounce de 2 s |
| `StatusBadge` | Sempre **ícone + texto + forma de borda** (tabela abaixo). A cor só reforça |
| `AlertCard` | Botão que leva à tela de resolução. Contagens em fonte mono |
| `LiveMatchCard` | Linhas de placar com botão `+1` de 56 px com nome acessível "Ponto para <dupla>". Desfazer ponto e Finalizar partida |
| `ScheduleGrid` | `<table>` real: `caption`, `th scope="col"` (quadras), `th scope="row"` (horários); célula vazia diz "Livre". Alternativa **Lista por horário** sempre disponível. Mover partida: arrastar **e** botões "Mover" com seletor de quadra e horário |
| `BracketView` e `BracketList` | Visual em colunas por rodada **e** lista aninhada `<ol>`. Cada jogo declara para onde o vencedor segue ("avança para Semifinal 1"). Não usar `role="tree"` |
| `ScoreDialog` | `<dialog>` modal com Radix; foco inicial no primeiro passo; Esc fecha; devolve o foco ao botão de origem |
| `JustificationForm` | `label` visível, `required`, contador de caracteres em texto, erro com `aria-invalid` e `aria-describedby`; botão com verbo da ação ("Corrigir resultado") |
| `ImpactDialog` | Lista "será invalidado" e "será preservado"; foco inicial no botão seguro (**Manter chave atual**), nunca no destrutivo |
| `ConflictResolver` | Dois cartões lado a lado (aparelho x servidor) com hora de cada versão |
| `Toast` com desfazer | **≥ 10 s e pausável** ao receber foco ou mouse (WCAG 2.2.1) |
| `ThemePicker` | Mostra o resultado de `deriveTheme` e o motivo quando rejeita |

**Codificação de status** (cor nunca é o único sinal):

| Estado | Ícone | Texto | Forma |
|---|---|---|---|
| Online | sinal | Online | borda contínua |
| Offline | sinal cortado | Offline | borda tracejada |
| Sincronizando | setas (estático em movimento reduzido) | Sincronizando… | borda contínua azul |
| Pendente | relógio | N pendentes | borda tracejada |
| Conflito | triângulo | Conflito | borda **dupla** |
| Agendada / Em andamento / Finalizada | calendário / reproduzir / check | texto igual | contínua / preenchida / contínua |
| W.O. / Abandono | bandeira / saída | "W.O." / "Abandono" | contínua |
| Inscrição pendente / aprovada / cancelada / espera | relógio / check / X / fila | texto igual | tracejada / contínua / pontilhada / tracejada |
| Check-in | check em círculo | "Check-in feito" / "Aguardando check-in" | contínua / tracejada |

Abreviações como "W.O." usam `<abbr title="Vitória por ausência do adversário">`.

### 11.4 Telas e comportamento esperado

**Central** (`/t/:id`): quatro cartões de alerta (conflito de agenda, partidas pendentes, inscrições a aprovar, vagas); lista "Em andamento" com placar rápido; "Próximos jogos"; cartão da página pública com endereço e botão copiar (com fallback de seleção quando a área de transferência recusar).

**Registro de placar em até 3 toques** (RNF-01), por qualquer um destes caminhos:
1. Botão **Registrar placar** da barra superior → partida → pontos → confirmar.
2. Busca global → ficha da dupla → Registrar placar.
3. Cartão "Em andamento" → `+1` por ponto → Finalizar partida.

**Ficha da dupla:** próximo jogo, quadra, check-in (alternar), histórico e correções.

**Agenda:** grade quadra × horário, modo lista, conflitos inline com texto e `aria-describedby`, ação "Gerar proposta" e "Mover".

**Chaves:** seletor de categoria, visual e lista, ação **Trocar posições** e **Refazer sorteio**, ambas com `ImpactDialog` quando já houver resultados.

**Encerramento:** exibe partidas pendentes; só habilita **Encerrar torneio** com confirmação explícita ("Entendo que N partidas ficarão sem resultado"). **Reabrir** exige justificativa (RF-03).

### 11.5 Regras de formulário

- Justificativa de correção: **≥ 10 caracteres** (padrão do sistema).
- Mensagens de erro dizem o que corrigir. Nada de "Erro inválido".
- Alvos de toque ≥ **48 px** nas ações do administrador; 56 px nos botões de ponto; 8 px entre alvos vizinhos. Nunca colocar ação destrutiva ao lado de ação frequente.
- Nada depende de arrastar; todo arrastar tem equivalente por botão (WCAG 2.5.7).

### 11.6 Conflito de sincronização (texto de interface)

> **Conflito: 1 partida precisa da sua decisão.**
> Tiago / Vinícius x Pedro / Gustavo
> Este aparelho: 21 x 17 (salvo às 15:48). Servidor: 21 x 19 (recebido às 15:51).
> As duas versões ficam guardadas. Escolha a que vale.

### 11.7 Acessibilidade (RNF-08, WCAG 2.2 AA, meta AAA em texto do admin)

1. Contraste: texto normal ≥ 4,5:1 (meta 7:1 no admin); componentes de UI ≥ 3:1.
2. Foco visível: `outline: 3px solid var(--amber)`, `outline-offset: 3px`, mais halo escuro; `scroll-padding` para o foco nunca ficar sob a barra fixa (WCAG 2.4.11).
3. Um `h1` por rota; hierarquia sem saltos; `lang="pt-BR"`.
4. Tabelas com `caption` e escopo de cabeçalho; rolagem horizontal só dentro de região com `tabindex="0"` e `aria-label`.
5. `prefers-reduced-motion`, `prefers-contrast` e `forced-colors` respeitados (bordas reais, não só sombra).
6. Fonte em `rem`; layout sem quebra a 200% de fonte e reflow a 320 px; nunca `user-scalable=no`.
7. **Modo claro de alto contraste** como alternativa ao tema escuro (uso ao sol), selecionável e persistido em `meta`.
8. Quando o seletor de tema do torneio rejeita uma cor, a mensagem explica o motivo.

---

## 12. Exportação (RF-17, DEC-13)

### 12.1 CSV compatível com Excel (pt-BR)

- Codificação **UTF-8 com BOM**, separador **`;`**, quebra de linha **CRLF**, decimais com vírgula.
- Escapar aspas dobrando-as; envolver em aspas qualquer campo com `;`, aspas ou quebra de linha.
- **Mitigar injeção de fórmulas:** valores de texto que começam com `=`, `+`, `-`, `@` ganham `'` na frente.
- Primeiras linhas fixas: torneio, categoria, **data/hora de geração em `America/Sao_Paulo`**.

### 12.2 PDF

- `pdfmake` em chunk carregado sob demanda e incluído no precache, para funcionar offline.
- Cabeçalho em todas as páginas: nome do torneio, categoria, data/hora da geração. Rodapé com paginação.
- Usa as cores do torneio **com `deriveTheme`** (garante contraste impresso). Logotipo em PNG/JPEG.

### 12.3 Relatórios

| Relatório | CSV | PDF |
|---|---|---|
| Inscritos por categoria | ✔ | ✔ |
| Atletas e duplas | ✔ | ✔ |
| Chaves e confrontos | ✔ | ✔ |
| Programação por quadra e horário | ✔ | ✔ |
| Resultados e classificação | ✔ | ✔ |
| Pódio por categoria | ✔ | ✔ |

A exportação **completa** (relatórios com telefone e nascimento) é exclusiva do administrador e **avisa** o conteúdo pessoal antes de gerar.

### 12.4 Busca e normalização

Para busca por nome tolerante a acento e maiúscula, guardar `searchKey` (minúsculas, sem diacríticos via `normalize('NFD')`) nas linhas de atleta e dupla. Usado na busca global e na detecção de duplicidade (RF-04: "localizar atletas existentes antes de criar novos").

---

## 13. Privacidade e LGPD (RF-21, DEC-12)

### 13.1 Inventário de dados

| Dado | Finalidade | Obrigatório | Público | Retenção proposta |
|---|---|---|---|---|
| Nome completo | Identificar a dupla | Sim | Sim (ou nome de exibição) | Enquanto o torneio existir |
| Telefone | Contato do organizador | Conforme configuração mínima | **Nunca por padrão** | Até pedido de remoção ou 12 meses após o torneio (Decisão pendente) |
| Data de nascimento | Elegibilidade por idade | Só se a categoria tem faixa etária | **Nunca por padrão** | Idem |
| Cidade | Contexto do atleta | Não | Não | Idem |
| Resultados | Registro esportivo | Sim | Sim | Preservados (anonimizáveis) |

### 13.2 Direitos e rotinas

- **Corrigir:** edição normal, com auditoria.
- **Anonimizar:** `anonymizeAthlete(id)` substitui nome por "Atleta removido #N", apaga telefone, nascimento e cidade, e **mantém resultados e classificação** (preserva o registro esportivo). Reflete no snapshot público na próxima publicação.
- **Excluir:** para atletas sem participação registrada, exclusão definitiva. Com participação, aplica-se anonimização.
- **Logs e auditoria** não gravam telefone nem nascimento em texto.
- Textos de privacidade e base legal: **precisam de revisão do responsável pelo serviço antes da publicação** (nota do PRD). O sistema oferece o campo e o link no rodapé da página pública, mas não fornece o texto jurídico.

---

## 14. Estratégia de testes (RNF-06, critério 17)

### 14.1 Pirâmide

| Nível | Ferramenta | Alvo |
|---|---|---|
| Unidade e propriedades | Vitest + fast-check | `packages/domain` (cobertura de linhas ≥ 90%, ramos ≥ 85%) |
| Contrato | Vitest | Schemas Zod, snapshot público, compatibilidade de operações |
| Integração servidor | Vitest + PostgreSQL em contêiner (Testcontainers localmente; serviço do Compose no CI) | `push` idempotente, conflitos, transações, isolamento por organização |
| Integração cliente | Vitest + `fake-indexeddb` | Comando → transação Dexie → outbox |
| Fim a fim | Playwright (imagem oficial do Playwright no CI) contra o Compose completo | Fluxos do organizador, offline, recarga, sincronização |
| Acessibilidade | `@axe-core/playwright` | Todas as rotas, nos estados online, offline e conflito |
| Desempenho | Lighthouse CI + testes de volume | Orçamentos de §16 |

### 14.2 Propriedades do domínio (fast-check)

- **Chave:** para qualquer `n` entre 2 e 128, toda dupla aparece exatamente uma vez; número de partidas = `n − 1` (sem disputa de 3º); byes só nas melhores semeaduras; cabeças de chave não se enfrentam antes do previsto.
- **Reprodutibilidade:** mesma semente + mesma entrada ⇒ mesma chave.
- **Placar:** `validateScore` e `decideWinner` concordam; nenhum placar válido produz dois vencedores.
- **Classificação:** determinística; permutar a ordem de entrada não muda o resultado; empates irresolvíveis nunca recebem posição inventada.
- **Avanço:** `resolveBracket` é idempotente; corrigir o placar e depois corrigir de volta restaura o estado original.
- **Agenda:** `proposeSchedule` nunca produz `PAIR_OVERLAP`, `COURT_OVERLAP` nem `DEPENDENCY_ORDER`.
- **Impacto:** `preservado ∪ invalidado ∪ recalculado` cobre todos os resultados existentes, sem interseção.
- **Tema:** `deriveTheme` nunca devolve `ok: true` com contraste abaixo do limite.

### 14.3 Testes de sincronização (os mais valiosos)

Um servidor de teste em memória com **injeção de falhas** (perda de resposta, duplicação, reordenação, queda no meio do lote, 500 intermitente) e um teste de convergência:

> Para qualquer sequência aleatória de comandos e de falhas, ao final, `estado local == estado do servidor`, nenhuma operação aplicada duas vezes, nenhuma operação perdida.

Casos nomeados obrigatórios: resposta perdida após commit (vira `duplicate`); queda entre o commit local e o envio; recarga com outbox cheio; conflito de versão com e sem sobreposição de campos; `keep_server` guarda a operação em `discardedOps`; operação dependente `blocked` por rejeição anterior.

### 14.4 Fim a fim com offline real

Playwright com `context.setOffline(true)` e service worker ativo:

1. Carrega o app online (preparação), vai para offline, **recarrega a página** e confirma que abre.
2. Cadastra dupla, registra placar, corrige com justificativa. Recarrega. Dados presentes.
3. Volta online. Verifica estados **Pendente → Sincronizando → Online** e que o servidor recebeu cada operação uma vez.
4. Simula queda durante o envio; confirma que nada foi marcado como sincronizado sem confirmação.

### 14.5 Rastreabilidade dos critérios de aceitação

Cada um dos 17 critérios do PRD §10 ganha ao menos um teste Playwright com o nome do critério no título (`[CA-07] Corrigir resultado exige justificativa e guarda o anterior`). A matriz de §18 liga critério → teste.

---

## 15. Plano de implementação por fases (alinhado ao ROADMAP)

Estimativas em semanas de uma pessoa em tempo integral; servem para ordenar e dimensionar, não para prometer prazo.

### Fase 0 — Fundação (1 sem)
- Monorepo pnpm, TypeScript `strict`, ESLint com regras de fronteira, Prettier, Husky.
- CI: lint, tipos, testes, build, `axe` em modo smoke, **build das imagens Docker e varredura de vulnerabilidades**.
- Esqueleto de `apps/web`, `apps/api`, `packages/*`.
- **Docker:** `Dockerfile` da API e do web, `docker-compose.yml` com `db`, `api` e `web`, `.dockerignore`, `.env.example`, healthchecks.
- **Pronto quando:** `docker compose up` sobe o ambiente do zero em uma máquina limpa e o `/health` responde; `pnpm test` e `pnpm build` verdes em CI; regra de fronteira quebra o build em import proibido.

### Fase 1 — Domínio e persistência (2 sem)
- Tipos e Zod de todas as entidades (§5.2).
- Esquema Drizzle + migração inicial; esquema Dexie v1.
- **Domínio puro:** `scoring`, `bracket` (eliminação simples), `standings`, `resolveBracket`, com os testes de propriedade correspondentes.
- Auditoria local e remota; ResultRevision append-only.
- **Pronto quando:** propriedades de §14.2 (chave, placar, classificação, avanço) passam com 1.000 execuções.

### Fase 2 — Administração básica (3 sem)
- Login, sessão, limites de tentativa, bloqueio e PIN offline (DEC-17).
- Design system *Arena Noturna*: tokens, `AppShell`, `StatusBadge`, diálogos, formulários, `Toast`.
- CRUD local-first de torneio, categorias, quadras, atletas, duplas e inscrições (aprovação, vagas, espera, check-in).
- Busca global local e detecção de duplicidade.
- **Pronto quando:** CA-01 a CA-03 passam, e tudo funciona offline após preparação.

### Fase 3 — Chaves e agenda (3 sem)
- Grupos + eliminatória, cabeças de chave, validação de formato, `thirdPlaceMatch`.
- `ImpactDialog` e `analyzeBracketChange`; refazer sorteio com impacto.
- `proposeSchedule`, `detectScheduleIssues`, `ScheduleGrid` com modo lista e movimentação por teclado.
- **Pronto quando:** CA-04 e CA-05 passam; propriedades de agenda e impacto passam.

### Fase 4 — Resultados e classificação (2 sem)
- `ScoreDialog`, rascunho de placar ao vivo, W.O., abandono, pendente.
- Correção com justificativa, impacto em cascata, `TieResolution`.
- Classificação, pódio, tela de Resultados.
- **Pronto quando:** CA-06 a CA-09 passam.

### Fase 5 — Sincronização (3 sem)
- Outbox, motor de sync, heartbeat, backoff, compactação.
- API `push`/`pull`, idempotência, conflitos, `ConflictResolver`, `SyncCenter`.
- PWA: service worker, atualização segura, persistência, tela **Preparar para o evento**, backup/restauração.
- **Pronto quando:** teste de convergência com falhas passa; CA-11 a CA-14 e CA-16 passam; teste de recarga offline passa em Chromium e WebKit.

### Fase 6 — Público e relatórios (2 sem)
- `toPublicSnapshot`, publicação, bundle público, tema do torneio e `deriveTheme`, upload de logotipo.
- CSV e PDF (offline).
- **Pronto quando:** CA-10 e CA-15 passam; teste de lista de permissão do snapshot passa.

### Fase 7 — Validação e endurecimento (2 sem)
- Torneio simulado de ponta a ponta (≥ 200 duplas, 3 categorias, 4 quadras).
- Auditoria de acessibilidade manual: teclado, leitor de tela (NVDA e VoiceOver), zoom 200% e 400%, teste ao ar livre.
- Revisão de segurança e privacidade; teste de carga leve na API.
- **Pronto quando:** CA-17 e a Definição de Pronto do PRD §14 estão cumpridos.

### Fase 8 — Release (1 sem)
- Documentação operacional: instalação, preparação, uso, exportação e restauração.
- Checklist de véspera do evento; acompanhamento do primeiro torneio real.

**Total estimado:** ~19 semanas de uma pessoa. Fases 1, 2 e 3 têm trabalho paralelizável entre domínio e interface.

---

## 16. Orçamentos de desempenho e qualidade (RNF-07)

| Métrica | Meta |
|---|---|
| JS inicial do admin (gzip) | ≤ 250 kB; telas pesadas em chunks sob demanda |
| JS da página pública (gzip) | ≤ 80 kB |
| `computeGroupStandings` para 300 duplas | < 50 ms |
| `proposeSchedule` para 500 partidas | < 1 s |
| `resolveBracket` para 128 duplas | < 20 ms |
| Abertura do admin offline (após carga fria) | < 2 s em tablet de entrada |
| Registro de ponto (toque → valor na tela) | < 100 ms |
| Lista de inscritos com 500 linhas | Rolagem fluida; virtualizar acima de 300 linhas mantendo semântica de tabela |

Medições: Lighthouse CI em PR (orçamentos como falha), testes de volume no Vitest com fixture de 300 duplas.

---

## 17. Infraestrutura, Docker, ambientes e operação

### 17.1 Serviços (Docker Compose)

| Serviço | Imagem | Função | Porta |
|---|---|---|---|
| `db` | `postgres` (versão fixada) | Banco relacional (DEC-05) | 5432 (somente rede interna em produção) |
| `api` | Imagem própria (`apps/api/Dockerfile`) | Fastify: autenticação, `sync`, publicação, exportação | 3000 |
| `web` | Imagem própria (`apps/web/Dockerfile`, nginx) | Admin PWA e página pública (estáticos) | 8080 |
| `migrate` | Mesma imagem da `api` | Executa `drizzle-kit migrate` e termina (*one-shot*) | — |

```text
          navegador
              │  HTTPS (TLS terminado no proxy da hospedagem ou em um proxy reverso)
              ▼
        ┌──────────┐   /api, /sync, /auth, /public   ┌─────────┐      ┌────────┐
        │   web    │────────────────────────────────▶│   api   │─────▶│   db   │
        │  (nginx) │   estáticos: PWA e público      │ Fastify │      │Postgres│
        └──────────┘                                 └─────────┘      └────────┘
```

O `web` serve os estáticos e encaminha as rotas de API para o serviço `api`, de modo que o navegador fala com **uma origem só**. Isso mantém `SameSite=Strict`, dispensa CORS e simplifica a CSP (§8.2).

Regras do Compose:

- `depends_on` com `condition: service_healthy` (a `api` espera o `db`) e `condition: service_completed_successfully` (a `api` espera o `migrate`).
- **Healthchecks:** `db` (`pg_isready`), `api` (`GET /health`), `web` (`GET /` retornando 200).
- Volume nomeado **somente** para os dados do `db`. `api` e `web` são *stateless*.
- Rede interna dedicada; só o `web` publica porta para fora.
- `restart: unless-stopped` nos três serviços.

### 17.2 Imagens (build multi-stage)

**API** (`apps/api/Dockerfile`):

1. `deps`: instala dependências com `pnpm fetch` e `pnpm install --frozen-lockfile --offline` (cache de camadas reaproveitável).
2. `build`: compila `packages/*` e `apps/api` (TypeScript → JavaScript).
3. `prune`: `pnpm deploy --prod` gera só as dependências de produção.
4. `runtime`: imagem `node:<versão>-slim`, **usuário não-root** (`USER node`), `NODE_ENV=production`, sem *compilers*, sem código-fonte, `HEALTHCHECK` com `GET /health`, `CMD ["node","dist/server.js"]`, sinal `SIGTERM` tratado para encerrar conexões com elegância.

**Web** (`apps/web/Dockerfile`):

1. `build`: compila o Vite (admin e público) com o *workspace* inteiro.
2. `runtime`: `nginx:<versão>-alpine` com os estáticos em `/usr/share/nginx/html` e o `nginx.conf` do projeto. Executa como usuário sem privilégios (`nginx-unprivileged` ou equivalente), porta 8080.

Boas práticas obrigatórias:

- `.dockerignore` exclui `node_modules`, `.git`, `dist`, `.env*`, relatórios de teste e `docs/`.
- Nenhum segredo em `ARG`, `ENV` de build ou camada de imagem. Segredos entram em tempo de execução (§17.4).
- Imagens fixadas por versão **e digest**; atualizações por PR automatizado.
- **Rótulos OCI** (`org.opencontainers.image.revision`, `.created`, `.source`) com o *commit* de origem.
- Tamanho-alvo: API ≤ 250 MB; web ≤ 60 MB (acompanhado no CI).

### 17.3 `nginx.conf` do front

O PWA depende de regras de cache **exatas**. Errar aqui quebra a atualização do aplicativo ou o modo offline.

| Caminho | Regra |
|---|---|
| `/assets/*` (arquivos com *hash* no nome) | `Cache-Control: public, max-age=31536000, immutable` |
| `/sw.js`, `/workbox-*.js` | `Cache-Control: no-cache` (o navegador sempre revalida o service worker) |
| `/index.html`, `/public.html`, `/manifest.webmanifest` | `Cache-Control: no-cache` |
| `/api/*`, `/sync/*`, `/auth/*`, `/public/*` | Proxy para `api:3000`; sem cache no nginx; repassa `X-Forwarded-*` |
| Qualquer rota desconhecida do admin | Fallback para `/index.html` (rotas do React Router) |
| Rotas da página pública | Fallback para `/public.html` |
| Todas | `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `Strict-Transport-Security` (quando atrás de TLS), compressão `gzip`/`brotli` |

### 17.4 Configuração e segredos

- **Variáveis de ambiente** validadas por Zod na inicialização da `api` (falha rápida, mensagem clara). `.env.example` documenta cada uma.
- `DATABASE_URL`, segredo de sessão e credenciais **nunca** entram na imagem nem no repositório.
- Desenvolvimento: arquivo `.env` local (ignorado pelo Git). Produção: *secrets* do orquestrador ou da hospedagem (arquivos montados em `/run/secrets/*` e lidos por variável `*_FILE`).
- O contêiner da `api` não tem acesso de escrita ao sistema de arquivos (`read_only: true` com `tmpfs` para `/tmp`) e descarta *capabilities* (`cap_drop: [ALL]`, `no-new-privileges`).

### 17.5 Ambientes

| Ambiente | Como sobe | Observações |
|---|---|---|
| `local` | `docker compose -f docker-compose.yml -f docker-compose.dev.yml up` | `web` roda o servidor de desenvolvimento do Vite com *hot reload* (porta 5173); `api` com `tsx watch`; código montado por volume; `db` na porta 5432 do anfitrião |
| `ci` | Compose + imagem do Playwright | Sobe `db`, `migrate`, `api` e `web` a partir das **imagens construídas no próprio pipeline**; roda testes de integração e Playwright |
| `staging` | `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d` com imagens publicadas | Dados fictícios; mesmo caminho de implantação da produção |
| `produção` | Idem, no host escolhido | TLS, backups do banco, monitoramento |

**Detalhe importante do desenvolvimento local:** o *service worker* do PWA não deve ficar ativo em `local`/`dev`, pois mascara alterações de código. O `vite-plugin-pwa` fica **desligado** no servidor de desenvolvimento e ligado no *build* de produção. Para testar o modo offline localmente, usar `docker compose -f docker-compose.yml up --build` (imagem de produção do `web`).

### 17.6 CI/CD

1. Pull request: lint, tipos, testes de unidade e de propriedade, `axe`, **build das imagens** (sem publicar).
2. Merge na `main`: build das imagens com *cache* de camadas, **varredura de vulnerabilidades** (Trivy ou equivalente; falha em severidade crítica/alta sem correção documentada), publicação em registro (ex.: GHCR), com *tag* do *commit* e *tag* de versão.
3. Implantação: `docker compose pull && docker compose up -d` (ou o equivalente da hospedagem). O serviço `migrate` roda **antes** da nova `api`.
4. *Rollback:* voltar à *tag* anterior das imagens. Como as migrações são **expansivas primeiro** (§17.7), o app anterior continua compatível com o banco migrado.

### 17.7 Banco e migrações

- **Migração expansiva primeiro** (adicionar coluna/tabela), remoção só em *release* posterior. Isso mantém o aplicativo antigo, ainda em cache no dispositivo do organizador, compatível com a API nova.
- A `api` recusa `schemaVersion` desconhecido do cliente com mensagem que manda atualizar o app.
- **Backup do PostgreSQL:** `pg_dump` agendado (contêiner dedicado ou *job* da hospedagem) com retenção definida e **teste de restauração periódico** em staging. O backup do banco é complementar à exportação manual do torneio (§9.5).
- Dados em produção ficam num volume com *backup* do provedor; o volume NUNCA é recriado por `docker compose down -v` fora de `local`.

### 17.8 Hospedagem (Decisão pendente, PRD §9)

Com Docker, o requisito para a hospedagem passa a ser **executar contêineres e oferecer PostgreSQL** (gerenciado ou em contêiner com volume e backup). Comparar candidatos por custo, exportação de dados, latência no Brasil e suporte a *secrets*. Duas opções razoáveis para um MVP de baixo custo:

| Opção | Descrição | Prós | Contras |
|---|---|---|---|
| A. Uma VM com Docker Compose | `web`, `api` e `db` na mesma máquina, TLS por proxy reverso | Mais barata, simples, igual ao ambiente local | Backup e atualização do sistema por conta da equipe |
| B. Plataforma de contêineres + PostgreSQL gerenciado | `web` e `api` como serviços; banco gerenciado | Backups, TLS e escala prontos | Custo maior, ajustes de rede e *secrets* |

A decisão não bloqueia a Fase 0: o Compose funciona igual nas duas.

### 17.9 Observabilidade e operação

- Logs `pino` em JSON no `stdout` (coletados pelo Docker); `requestId` em cada requisição; sem PII.
- Métricas de `push` (aplicadas, duplicadas, rejeitadas, conflitos); alerta quando `rejected` ou `conflict` sobe.
- `GET /health` devolve estado do banco e `serverTime`. O app avisa se o relógio do dispositivo divergir mais de 2 minutos do servidor, pois ele carimba horários de resultado.
- Job diário limpa sessões expiradas e aplica a retenção de dados pessoais (§13).
- Encerramento ordenado: `SIGTERM` interrompe novas requisições, conclui as em curso e fecha o *pool* do banco.

---

## 18. Rastreabilidade: requisitos → módulos → testes

| Requisito | Onde é atendido | Teste principal |
|---|---|---|
| RF-01 Autenticação | §8.2, §8.5, `apps/api/auth` | CA-01, limite de tentativas, expiração |
| RF-02, RF-03 Torneio e ciclo de vida | §5.2, §11.4 (Encerramento) | CA-01, CA-09 |
| RF-04, RF-05 Atletas e duplas | §5.2, §12.4 | Duplicidade, troca de atleta com aviso |
| RF-06 Categorias | §6.9, §6.3 | Elegibilidade |
| RF-07 Inscrições | §5.2, §11.3 | CA-03 (vagas e espera) |
| RF-08 Quadras | §5.2, §11.2 | CA-02 |
| RF-09 Formatos | §6.2 | `validateFormat`, propriedades de chave |
| RF-10 Sorteio e chaves | §6.2, §6.7 | CA-04, impacto |
| RF-11 Pontuação | §6.3 | Propriedades de placar |
| RF-12 Agenda | §6.6 | CA-05 |
| RF-13 Check-in | §5.2, §11.3 | Estado visível na lista |
| RF-14 Resultados | §6.8, §9.3 | CA-06, CA-07 |
| RF-15 Classificação e pódio | §6.4 | CA-08, empates |
| RF-16 Página pública | §10 | CA-10, lista de permissão |
| RF-17 Relatórios | §12 | CA-15, CSV com BOM, injeção de fórmula |
| RF-18 Identidade visual | §6.10, §11.1 | `deriveTheme`, contraste |
| RF-19 Offline | §4, §9 | CA-11, CA-12, CA-16 |
| RF-20 Sincronização | §7 | CA-13, CA-14, convergência |
| RF-21 Privacidade | §10.2, §13 | Snapshot sem PII, anonimização |
| RF-22 Backup | §9.5 | Exportar, importar, restaurar |
| RNF-01 Usabilidade | §11.4 | Medição de toques |
| RNF-02 Localização | §5.1 | Formatação de data e fuso |
| RNF-03 Integridade | §4 (G1 a G4), §6.5 | Convergência, idempotência |
| RNF-04 Segurança | §8 | Testes de autenticação, CSP, CSRF |
| RNF-05 Disponibilidade offline | §9 | Playwright offline com recarga |
| RNF-06 Manutenibilidade | §3.1 | Regras de fronteira em lint |
| RNF-07 Desempenho | §16 | Lighthouse CI, volume |
| RNF-08 Acessibilidade | §11.7 | axe em todas as rotas e estados |

---

## 19. Riscos técnicos e mitigação

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Navegador limpa IndexedDB (Safari/iOS, pouco espaço) | Média | Crítico | `storage.persist()`, instalar PWA, backup antes do evento, aviso de cota (§9.4) |
| Atualização do app quebra migração no meio do torneio | Baixa | Alto | Atualização só por escolha, backup automático antes de migrar (§9.2) |
| Heurística de agenda produz grade ruim | Média | Médio | Ajuste manual sempre possível; verificação separada da proposta; testes de propriedade |
| Regras de desempate divergem do regulamento local | Alta | Médio | Critérios configuráveis e ordenáveis; padrão rotulado "do sistema"; empate irresolvido pede decisão |
| Conflito de sync mal explicado ao organizador | Média | Alto | Texto simples, comparação lado a lado, nada descartado em silêncio (§7.4, §11.6) |
| Relógio do dispositivo errado | Média | Médio | Aviso de divergência com o servidor (§17) |
| Vazamento de PII na página pública | Baixa | Crítico | Lista de permissão, teste de varredura do snapshot, seções desligadas fora do JSON |
| Bateria e tela ao sol no evento | Alta | Médio | Modo claro de alto contraste, alvos grandes, orientação operacional |
| Cache errado do `sw.js` ou do `index.html` impede atualizar o app, ou serve versão antiga | Média | Alto | Regras de cache do nginx (§17.3) testadas no CI com Playwright; `sw.js` sempre `no-cache` |
| Imagem com vulnerabilidade conhecida | Média | Médio | Imagens enxutas e fixadas, varredura no CI, atualização automatizada (§17.6) |
| Perda do volume do banco em produção | Baixa | Crítico | Backup agendado com teste de restauração; `down -v` proibido fora de `local` (§17.7) |
| Escopo cresce (novos formatos, multi-dispositivo) | Média | Alto | Fronteiras do MVP (§1.2); `organizationId` e `version` já prevêem evolução |

---

## 20. Decisões a confirmar e ADRs propostos

Sugestão de registrar em `docs/DECISIONS.md`, seguindo o formato existente.

| ID | Decisão proposta | Pendência |
|---|---|---|
| DEC-16 | Stack: React + Vite + TS, Dexie, Fastify, Drizzle, PostgreSQL, monorepo pnpm, Docker | Confirmada nesta rodada |
| DEC-17 | Sessão offline com bloqueio por inatividade no cliente e PIN local (§8.5) | **Confirmar** |
| DEC-18 | Escrita de domínio só via `POST /sync/push`; sem CRUD genérico | Proposta |
| DEC-19 | Avanço de chave e classificação **derivados**, nunca gravados | Proposta |
| DEC-20 | Resultados em revisões **append-only**; invalidação em vez de exclusão | Proposta |
| DEC-21 | Snapshot público por lista de permissão; seções desligadas ausentes do JSON | Proposta |
| DEC-22 | Design *Arena Noturna*, com modo claro de alto contraste como alternativa | Confirmada nesta rodada |
| DEC-23 | Expiração de sessão: 8 h por inatividade, 7 dias absoluta | **Confirmar** |
| DEC-24 | Padrões do sistema: 40 min por jogo, 20 min de descanso, justificativa ≥ 10 caracteres | **Confirmar** |
| DEC-25 | 3º lugar: sem disputa por padrão; empate de 3º exibido, com opção de disputa | **Confirmar** |
| DEC-26 | Retenção de telefone e nascimento: 12 meses após o torneio | **Confirmar com jurídico** |
| DEC-27 | Provedor de hospedagem e do PostgreSQL (precisa executar contêineres, §17.8) | **Em aberto** |
| DEC-28 | **Docker** e Docker Compose para desenvolvimento, CI e implantação; `web` (nginx) e `api` em imagens separadas, mesma origem; migração como serviço `migrate` | Confirmada nesta rodada |

### Perguntas que o PRD não responde e que afetam o código

1. Quantos grupos e quantos classificados por grupo devem ser oferecidos como opções no MVP? (§6.2 propõe uma lista de combinações válidas geradas automaticamente.)
2. W.O. credita placar para o vencedor? (§6.3 assume que não, configurável por categoria.)
3. O telefone do atleta é obrigatório? (RF-04 deixa a configuração mínima em aberto; este documento o trata como opcional.)
4. A disputa de 3º lugar é desejada nas categorias típicas?

---

## Apêndice A. Mapeamento mockup → produção (Arena Noturna)

| Elemento do mockup `m2.html` | Componente / módulo de produção |
|---|---|
| Barra lateral e `nav` com `aria-current` | `AppShell` + `SideNav` |
| Busca global com `/` | `GlobalSearch` (§11.3) |
| Chip de sync e diálogo | `SyncChip`, `SyncCenter`, `ConflictResolver` |
| Cartões de alerta | `AlertCard` alimentado por seletores derivados do Dexie |
| "Em andamento" com `+1` | `LiveMatchCard` + `liveDrafts` (§9.3) |
| Tabela de agenda e "Lista por horário" | `ScheduleGrid` + `ScheduleList` |
| Chave em colunas e lista | `BracketView` + `BracketList` |
| Diálogo de correção com justificativa | `ScoreDialog` + `JustificationForm` |
| Diálogo de impacto da troca | `ImpactDialog` |
| Prévia pública | Rota pública real, em iframe de pré-visualização no admin |
| Painel "Simular conexão" | Ferramenta de desenvolvimento, desligada em produção |

## Apêndice B. Dados de exemplo para fixtures

Reaproveitar os dados dos mockups (Copa Praia Grande de Futevôlei, 22/10/2026, 4 quadras, categorias Masculina Open, Feminina Intermediária e Mista Iniciante, duplas como "Renato / Thiago" e "Camila / Bia") como fixtures de teste e de demonstração, **marcados como fictícios**. Cenários mínimos: conflito de agenda por descanso, W.O., abandono, correção com justificativa, empate irresolvido em grupo, categoria lotada com lista de espera, conflito de sincronização (21 x 17 contra 21 x 19).

## Apêndice C. Glossário

| Termo | Significado |
|---|---|
| Dupla | Dois atletas inscritos juntos numa categoria |
| Bye | Passagem direta de rodada, sem adversário |
| Cabeça de chave | Dupla semeada para não encontrar outras fortes cedo |
| W.O. | Vitória por ausência do adversário |
| Outbox | Fila local de operações ainda não confirmadas pelo servidor |
| Idempotência | Reenviar a mesma operação não muda o resultado além da primeira vez |
| Snapshot público | Cópia filtrada e versionada dos dados que o público pode ver |

## Apêndice D. Desvios da implementação (MVP entregue)

Este apêndice registra onde o código entregue difere do desenho acima. Nenhum requisito do PRD foi alterado; os desvios são de técnica ou de escopo de interface.

| # | Desenho (SPECS) | Implementado | Motivo / consequência |
|---|---|---|---|
| D1 | Pacotes: domain, contracts, app | Adicionado `packages/sync` (motor de sincronização cliente e servidor, sem dependências) | Permite testar convergência com falhas injetadas sem rede nem banco |
| D2 | Vitest | `node:test` (Node 22, type stripping) | Domínio e sync rodam sem instalar nada |
| D3 | Drizzle ORM | SQL puro (`apps/api/migrations/001_init.sql`) + `pg` | Menos camadas; transações SERIALIZABLE com retry em 40001 |
| D4 | Tabelas normalizadas no servidor | Estado do torneio como agregado JSONB, mais tabelas de operações, conflitos, sessões e publicação | O mesmo `apply()` roda no cliente e no servidor; normalizar duplicaria regras |
| D5 | Rotas `/auth`, `/sync`, `/public` | Tudo sob `/api/*`; saúde em `/api/health`; página pública em `/p/<slug>` | Um único prefixo para o proxy do nginx |
| D6 | React Router, `/t/:id` | Roteador por hash; um torneio por dispositivo | Funciona offline sem configuração de servidor |
| D7 | Radix para diálogos | Elemento nativo `<dialog>` | Foco e Esc nativos, sem dependência |
| D8 | Pull incremental | Pull do agregado inteiro (`since=-1` força o estado) | Torneios locais são pequenos; elimina classe de divergências |
| D9 | Build do servidor | Node executa o TypeScript diretamente (sem etapa de compilação) | Imagem Docker mais simples |
| D10 | Fontes por CDN | `@fontsource` empacotadas | Funciona offline e sem terceiros (LGPD) |
| D11 | Classificados por grupo configurável | Apenas 1 ou 2 por grupo | Mais que 2 não é suportado; `validateFormat` avisa |
| D12 | Desempate por sorteio | Registrado como decisão manual de ordem (`tie.resolve`), não como resultado | Mantém a regra de negócio 10 |
| D13 | Trocar formato com resultados | Bloqueado até zerar a chave | Evita invalidação em massa |
| D14 | Arrastar e soltar na agenda | Botão "Mover" | Acessível por teclado; drag-and-drop fica para depois |
| D15 | axe e Playwright e2e no CI | Teste de fumaça próprio (14 rotas, 375px, offline/online) | Registro sem acesso ao registro npm; adicionar axe no CI é pendência |

### Não verificado nesta entrega
Build das imagens Docker, execução real de Fastify, `pg`, Dexie e Vite, ESLint, e o `pnpm-lock.yaml` (gerado no primeiro `pnpm install`). Verificados por execução: domínio e sync (54 testes), typecheck com shims, e a interface empacotada com esbuild exercitada em navegador com servidores em memória.

## Apêndice E. Revisão pós-implementação

Duas revisões independentes (conformidade e código) foram feitas. Conformidade medida: 25 de 62 itens atendidos, 25 parciais, 12 não verificáveis aqui (ponderado: 60% a 75%).

**Corrigido após a revisão:** `tournamentId` restrito a `[A-Za-z0-9-]` (curinga de LIKE); consultas por prefixo com `starts_with`; torneio checado por organização em push, pull, conflitos e cursor; colisão de slug resolvida com sufixo (antes travava a fila); `on update cascade` em `public_snapshots`; `trustProxy: 1` e `X-Forwarded-For` fixado no nginx; cabeçalhos de segurança repetidos em cada `location`; DNS do upstream re-resolvido; `pool.on('error')`; retry com jitter em 40001; payload normalizado por JSON no `dispatch`; correção de placar sempre calcula impacto; refazer a chave preserva `lifecycle` das partidas finalizadas; pódio de 3 duplas; agenda recusa sobreposição de quadra ou dupla (`SCHEDULE_CONFLICT`); torneio encerrado é somente leitura; publicar gera o snapshot na primeira vez; skip link; `esbuild` e `playwright` como devDependencies; `permissions` no CI.

**Corrigido na segunda rodada:** gravação local atômica (estado, meta e fila numa transação Dexie, com desfazer em memória se falhar) e serialização de `dispatch`, `pull` e `rebase`; validação Zod no cliente e rejeição por operação no servidor (um 400 não derruba mais o lote; `organizationId: 'local'` vira a organização da sessão); bloqueio por PIN (PBKDF2) ao abrir e após inatividade, e "Sair da conta"; exclusão LGPD só apaga localmente se o servidor confirmar (ou o usuário escolher "só deste aparelho"); `tournament_id` gravado em `applied_operations`; conflitos resolvidos purgados ao anonimizar; 6 relatórios CSV com cabeçalho (torneio, categoria, data/hora de Brasília) e rodapé de página no PDF; guarda `PARTICIPANTS_CHANGED` no lançamento de placar; agenda sem limite de linhas; checagem de `Origin`, HSTS; job de CI com Postgres 16 real (`apps/api/test/db-check.sql`) e Trivy também na imagem web.

**Verificado em Postgres 16 real nesta sessão:** a migração `001_init.sql` aplica sem erro e as consultas de `pg-store`/`app.ts` (upserts, `starts_with`, junções por organização, troca de slug com `on update cascade`, exclusão LGPD) se comportam como esperado, inclusive "curinga não vaza entre torneios". O driver `pg` e o Fastify não puderam ser instalados, então o código TypeScript da API continua sem execução real.

**Corrigido na terceira rodada:** editar atleta e dupla (troca de atleta com partidas iniciadas exige confirmação e fica na auditoria, `pair.athlete_changed`); critérios de desempate editáveis e ordenáveis na categoria; ação "Trocar posições" na chave (`bracket.swap`, com análise de impacto e confirmação quando há resultados; refazer o sorteio desfaz trocas manuais); logotipo (reduzido no aparelho, vai para a página pública e para o PDF).

**Corrigido na quarta rodada:** operações `blocked` sem causa local voltam sozinhas para a fila; uma aba por vez (`navigator.locks`) com aviso na segunda aba; contagem de falhas de login atômica e resposta única (401) para senha errada ou conta bloqueada (não revela e-mails); purge de sessões expiradas a cada hora. Consultas de bloqueio e purge validadas em Postgres 16 real.

**Medido na quinta rodada:**
- Orçamento de JavaScript (esbuild minificado, sem Dexie, pdf-lib e fontes, que são carregados à parte): página pública 61 kB gzip (meta 80 kB); painel 130 kB gzip (meta 250 kB). Os números finais dependem do build real do Vite.
- Contraste: teste automático (`apps/web/test/contrast.test.ts`) das cores do tema escuro e do claro. Achou `--line` com 2,91:1 sobre `surf2` (meta 3:1); corrigido para `#6a7a8e`.

**Pendente (ordem sugerida):**
1. `pnpm-lock.yaml` (gerar no primeiro `pnpm install`) e testes de API com `app.inject()` e Postgres no CI.
2. TLS na stack (cookie `Secure`; hoje exige proxy HTTPS à frente), política de retenção de dados pessoais (decisão do responsável legal) e limite de login por IP além do rate limit.
3. Posições protegidas por posição fixa (hoje só por semente).
4. axe no CI e auditoria manual (NVDA, VoiceOver, zoom 200% e 400%); Lighthouse e abertura offline em menos de 2 s.
5. Desvios não declarados no Apêndice D: `pdf-lib` no lugar de `pdfmake`; tema ajusta cor em vez de rejeitar; snapshot sem histórico; toasts de 6 s.
