# Especificação — Página pública do torneio

Versão 1.0 · 29/10/2026 · Status: **implementada (Fase 1)**. Requisitos de produto em `docs/PRD_PAGINA_PUBLICA.md` (IDs RFP/RNP). Privacidade: DEC-12 e DEC-21. Design: DEC-22 (Arena Noturna).

## 1. Visão geral e arquitetura

```text
Organizador (painel, offline-first) ──push──▶ API ──▶ tournament_states
                                                │
 Juiz por link (/api/referee/push) ─────────────┤  refreshSnapshotIfAuto / botão Publicar
                                                ▼
                         buildPublicSnapshot(state)  (allowlist campo a campo)
                                                ▼
                               public_snapshots (slug, snapshot JSON, etag)
                                                ▲
 Visitante ── GET /api/public/:slug (If-None-Match, cache: no-cache, a cada 15 s) ──┘
      │
      ▼
 /p/<slug> → public.html + bundle próprio (src/public/main.tsx) → <PublicView snapshot conn />
```

- A página é um **bundle separado** do painel (`apps/web/public.html` → `src/public/main.tsx`), sem Dexie, sem runtime do organizador e sem service worker.
- O servidor **não renderiza** HTML: entrega um snapshot JSON; o cliente monta a tela (SPECS §2, alternativa SSR descartada no MVP).
- O mesmo componente `PublicView` serve a página real e a pré-visualização do organizador (`embedded`, tema claro, títulos um nível abaixo).
- A lógica sem DOM fica em `src/public/logic.ts` (testada em `node:test`); estilos em `src/public/public.css` (tokens vêm de `src/ui/styles.css`).

## 2. Rotas e entrega

| Rota | Origem | Resposta |
|---|---|---|
| `/p/<slug>` | nginx (`locations.inc.template`, `try_files /public.html`) | HTML da página; `Cache-Control: no-cache`; CSP restritiva |
| `/p/<slug>#categoria-<id>` | cliente | Abre e rola até a categoria; `<id>` é a `encodeURIComponent` do id |
| `GET /api/public/:slug` | API (sem autenticação) | 200 com o snapshot, 304 com `If-None-Match`, 404 se não publicado |
| `/assets/*` | nginx | Arquivos com hash, `immutable` |

Cabeçalhos da API pública: `ETag` (SHA-1 do JSON sem `generatedAt`) e `Cache-Control: public, max-age=30, stale-while-revalidate=120`. O cliente pede com `cache: 'no-cache'`, o que obriga a revalidar com o servidor a cada consulta (304 quando nada mudou), contornando o `max-age`. Ajustar o servidor para um valor menor é item da Fase 2.

Despublicar apaga a linha de `public_snapshots` (o link vira 404 na hora). O slug é estável por torneio (`tournament_slugs`).

## 3. Quando o snapshot é regenerado

| Gatilho | Regra |
|---|---|
| Botão **Publicar** (painel) | Sempre regenera |
| `POST /api/sync/push` com operações aplicadas | Regenera se `autoPublishOnSync` ligado **ou** se ainda não existe snapshot |
| `POST /api/referee/push` (juiz) com operações aplicadas | Idem (cada lote de pontos conta) |
| Job de retenção (anonimização LGPD) | Regenera torneios publicados afetados |
| Despublicar | Remove o snapshot |

O `generatedAt` muda a cada regeneração; o `ETag` ignora esse campo, então um snapshot idêntico continua devolvendo 304.

## 4. Contrato de dados (`PublicSnapshot`, `schemaVersion: 1`)

Definido em `packages/domain/src/public-snapshot.ts`. Só os campos abaixo saem do servidor.

```ts
PublicSnapshot {
  schemaVersion: 1
  generatedAt: string                      // ISO; usado em "Atualizado às HH:MM"
  tournament: { name, organizationName, startDate, endDate, city, venue,
                description?, slug, status }          // status: draft | open | closed
  theme: DerivedTheme & { logoDataUrl? }               // cores derivadas; accentOnDark/accentOnLight
  categories: PublicCategory[]                         // ordenadas por nome
}
PublicCategory {
  id, name
  pairs?:   string[]                                   // seção "pairs": inscrições aprovadas, ordenadas
  matches?: PublicMatch[]                              // brackets | schedule | results
  groups?:  { name, rows: { pair, position, played, wins }[] }[]   // seção "results"
  podium?:  { first?, second?, third: string[] }       // seção "podium", só com categoria completa
}
PublicMatch {
  id, label, phase: 'group' | 'knockout'
  a, b: string | null                                  // null = "A definir"
  court?, scheduledAt?                                 // seção "schedule"
  status: 'not_started' | 'in_progress' | 'finished'
  live?:  { a, b, sets?: {a,b}[] }                     // só se in_progress: set atual + sets fechados
  score?: { sets?: {a,b}[], points?: {a,b} }           // seção "results"
  winner?: 'a'|'b', walkover?, retired?                // seção "results"
}
```

Regras de montagem:

- `matches` entra se **qualquer** de `brackets`, `schedule` ou `results` estiver ligada; dentro, `court`/`scheduledAt` só com `schedule`; `score`/`winner` só com `results`.
- Partidas com bye automático não aparecem.
- Nome da dupla: nome de exibição se `showDisplayNames` e existir; senão `Nome A / Nome B`. Atleta anonimizado vira "Atleta anonimizado".
- `live` só com o campo de pontos e sets numéricos; sem nomes, notas ou identificadores internos além do `id` da partida.
- **Nunca entram:** telefone, data de nascimento, cidade do atleta, e-mail, auditoria, justificativas de correção, nome do juiz, links de juiz, notas internas.

Teste de privacidade (obrigatório em todo commit): varre o snapshot e falha se encontrar chave fora da allowlist ou valor com aparência de telefone ou data de nascimento (`packages/domain/test`). O teste novo de `live.sets` exige as chaves exatas `a`, `b` e `sets`.

## 5. Ciclo de carregamento (`main.tsx`)

1. Lê o `slug` de `location.pathname` (segundo segmento).
2. Define o tema inicial: `localStorage['pt:contrast']` (`light`/`dark`) se existir; senão `prefers-color-scheme`.
3. Estados: `loading` (esqueleto com `aria-busy`), `ok`, `missing` (404), `error` (sem dados ainda).
4. Consulta `GET /api/public/<slug>` com `cache: 'no-cache'`, `accept: application/json` e timeout de 12 s.
5. Agendamento: **15 s** após cada consulta; **dobra a cada falha** (15 → 30 → 60 s, teto 60 s); só dispara se `document.visibilityState === 'visible'` (senão reagenda).
6. Reconsulta imediata (se a última tem mais de 5 s) ao voltar para a aba e no evento `online`.
7. Se `generatedAt` do novo snapshot for igual ao atual, **não troca o estado** (nada é redesenhado, a rolagem não pula).
8. Falha: mantém o último snapshot; marca `failing` após 2 falhas seguidas ou com `navigator.onLine === false`. Sem snapshot nenhum, mostra "Sem conexão" com **Tentar agora**.
9. 404: "Torneio não encontrado". Outros erros HTTP contam como falha.

## 6. Estrutura da tela (`PublicView`)

Ordem vertical (cada bloco só aparece quando há conteúdo):

| # | Bloco | Elemento | Conteúdo |
|---|---|---|---|
| 1 | Cabeçalho | `header` | Organização, botão **Modo sol / Tema escuro**, `h1` com o nome, "cidade · local · datas", selo (Em preparação / Torneio encerrado), "Sobre o torneio" recolhido |
| 2 | Atualização | `p` | "Atualizado às HH:MM", "(há X)" se defasado ≥ 5 min, "conferido há X" |
| 3 | Aviso de conexão | `p role="status"` | "Sem conexão. Mostrando dados das HH:MM. Tentando de novo…" (só quando `failing`) |
| 4 | Busca | `form role="search"` | Campo "Digite seu nome ou sobrenome"; ≥ 2 letras; até 8 resultados |
| 5 | Resultado da busca | `section` + `h2` | Duplas encontradas com **Seguir** e os jogos de cada uma (ao vivo, próximos, encerrados) |
| 6 | Meus jogos | `section` + `h2` | Duplas seguidas e seus jogos; primeiro bloco quando existe |
| 7 | Ao vivo agora | `section` + `h2` | Cartões grandes de jogos `in_progress` |
| 8 | Próximos jogos | `section` + `h2` | 6 primeiros; "Mostrar todos (N)" |
| 9 | Campeões | `section` + `h2` | 1º lugar de cada categoria com pódio |
| 10 | Em breve | `section` | Quando ainda não há jogos, chaves, grupos, pódio nem duplas publicados |
| 11 | Jogos por categoria | `nav` + `section` | Seletor fixo e categoria ativa |

Categoria ativa: a do hash `#categoria-<id>` se válida; senão a primeira com jogo ao vivo; senão a primeira. Com uma só categoria, o seletor não aparece. Dentro da categoria (`CategoryView`): título e selo de estado, pódio, mata-mata por fase (`knockoutRounds`), classificação por grupo (tabela), "Jogos da fase de grupos" (`details`, aberto se há jogo ao vivo no grupo), "Duplas inscritas" (`details`), ou "A chave desta categoria ainda não foi publicada. Esta página atualiza sozinha."

Estado da categoria (`categoryStatus`, com texto): `empty` "Chave ainda não publicada", `waiting` "Aguardando início", `live` "Tem jogo ao vivo", `running` "Em andamento", `done` "Encerrada".

### Cartão de partida (`MatchCard`)

- Cabeçalho: rótulo (`label`) e selo — **Ao vivo** (ponto pulsante, só com movimento permitido), **Encerrado**, **W.O.**, **Abandono**, **Aguardando**.
- Duas linhas (A e B): nome ("A definir" se nulo), placar em colunas e ✓ com o texto "(venceu)" no vencedor.
- Colunas de placar (`scoreColumns`): ao vivo = sets fechados + set atual (destacado); encerrado = sets finais ou placar único; W.O. = sem colunas.
- Meta: "Seu jogo ·" (dupla seguida), hora (`whenShort`: só a hora se for hoje em Brasília; senão "dia da semana, dd/mm hh:mm"), quadra e categoria (quando exibida fora da própria categoria).

## 7. Regras de comportamento

| Regra | Definição | Função |
|---|---|---|
| Normalização | minúsculas, sem acento, espaços colapsados | `norm` |
| Busca | todas as palavras digitadas devem estar no nome, em qualquer ordem; mínimo 2 caracteres | `matchesQuery` |
| Nomes pesquisáveis | duplas vistas em `pairs`, `groups` e `matches`, sem repetir, ordem pt-BR | `pairNames` |
| Próximos jogos | `not_started` com `a` e `b` definidos; por `scheduledAt` (sem horário vai ao fim, ordem original) | `upcoming` |
| Jogos de uma dupla | ao vivo → próximos (por horário) → encerrados (mais recente primeiro) | `matchesOfPair` |
| Fase | texto do `label` antes de " · " | `phaseOf` |
| Seguir | até 6 duplas por torneio; `localStorage['pt:fav']` = `{ [slug]: string[] }`; leitura tolerante a lixo (JSON inválido, tipos errados, nomes > 160) | `parseFollowed`, `serializeFollowed` |
| Anúncio ao leitor de tela | só quando muda o estado de um jogo de dupla seguida: começou, venceu/perdeu, W.O.; nunca a cada ponto | `announceDiff` |
| "há X" | `agora`, `há N s`, `há N min`, `há N h`; nunca negativo | `ago` |
| Datas | `America/Sao_Paulo`; intervalos por extenso | `whenShort`, `dateRange` |
| Cor sobre o destaque | texto preto ou branco conforme luminância | `onAccent` |

Armazenamento local (todo acesso com `try/catch`; a página funciona sem ele):

| Chave | Valor | Uso |
|---|---|---|
| `pt:contrast` | `light` / `dark` | tema escolhido (compartilhada com o painel) |
| `pt:fav` | JSON por slug | duplas seguidas |

## 8. Design e tema

- Sistema visual do painel (Arena Noturna): fundo escuro por padrão, cartões em superfície mais clara, destaque âmbar; **ao vivo = coral** (cor semântica fixa). O tema do torneio troca só o destaque (`accentOnDark` / `accentOnLight`, já corrigidos para contraste).
- Dois conjuntos de tokens: escuro e claro. O **claro é o modo sol** (alto contraste). Não há terceiro tema.
- Tipografia: fonte do sistema; algarismos tabulares nos placares (`.num`); nome do torneio em caixa normal; set atual do ao vivo em corpo maior (1,4 rem; 1,9 rem no destaque).
- Layout: contêiner de até 72 rem, centralizado; padding 1 rem (1,5 rem a partir de 48 rem). Grades de cartões `repeat(auto-fill, minmax(min(100%, 19rem), 1fr))`; tabelas de classificação em grade de 22 rem; duplas inscritas em 2 colunas (≥ 48 rem) e 3 (≥ 72 rem). Seletor de categorias é uma faixa horizontal fixa (`sticky`) rolável.
- Contraste medido (WCAG), escuro / claro: texto 17,7 / 19,3; texto secundário 7,9 / 8,5; "ao vivo" 6,3 / 6,0; placar sobre fundo ao vivo 6,8 / 6,5; ✓ do vencedor 10,8 / 6,0; borda de campo 4,4 / 5,9. Bordas decorativas de cartão (1,3–1,5) não carregam informação.
- Movimento: o ponto pulsante e o esqueleto só animam com `prefers-reduced-motion: no-preference`. Modo de cores forçadas (`forced-colors`) usa bordas de `CanvasText`.

## 9. Acessibilidade

- Landmarks: `header`, `main#conteudo` (na página real), `form role="search"`, `nav aria-label="Categorias"`. Um único `h1`; blocos com `h2` ligados por `aria-labelledby`.
- Tabelas de classificação com `caption` e `th scope`, dentro de região rolável com `role="region"`, `aria-label` e `tabIndex=0`.
- Alvos de toque ≥ 44 px (campo de busca 52 px); foco visível; sem armadilhas de teclado.
- Estado nunca só por cor: texto e ícone (Ao vivo, Encerrado, ✓ "(venceu)", chip da categoria com "(tem jogo ao vivo)" para leitor de tela).
- `aria-pressed` no botão **Seguir**, `aria-expanded` nos controles "Mostrar todos"; `details/summary` nativos.
- Região viva `aria-live="polite"` única e discreta (RFP-14); a contagem de resultados da busca usa `role="status"`.
- Reflow até 320 px (zoom de 400%) sem rolagem horizontal da página; só as tabelas rolam.
- `noscript` explica a necessidade de JavaScript.

## 10. Desempenho

| Item | Meta | Medido |
|---|---|---|
| Bundle da página (gzip) | ≤ 80 kB | ~73 kB (JS 67,9 + CSS 5,5) |
| Primeira dobra (375×667) | ao vivo visível sem rolar | 449 px do topo |
| Altura da página de exemplo (375 px) | — | 4.598 px (antes: 12.027) |
| Rede | 304 barato; sem repintar sem mudança | implementado |
| Peso do snapshot | pequeno (centenas de partidas) | JSON único sem imagens além do logotipo (`logoDataUrl`, opcional) |

O logotipo vai embutido no snapshot (`data:`); logotipos grandes aumentam cada resposta, então a tela de identidade deve limitar o tamanho.

## 11. Segurança e privacidade

- Rota pública sem autenticação, somente leitura (`GET`), sem cookies.
- CSP: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'` etc.; sem scripts inline nem terceiros.
- Sem analytics e sem rastreadores. Favoritos e tema ficam só no aparelho do visitante.
- Snapshot por allowlist (§4); o slug é a única "chave" de acesso e não é secreto (a página é pública por definição).
- Rate limit da API geral se aplica; a rota pública é barata (uma linha por slug).

## 12. Testes e rastreabilidade

| Camada | Arquivo | Cobre |
|---|---|---|
| Unitário (10) | `apps/web/test/public.test.ts` (+ `public-fixture.ts`) | busca, nomes, ao vivo e próximos, jogos da dupla, mata-mata, estado da categoria, colunas do placar, anúncio, seguir, textos |
| Domínio | `packages/domain/test/misc.test.ts` e testes de privacidade | `live.sets` com chaves exatas; nenhum campo pessoal |
| Arquitetura | `test/architecture.test.ts` | uso de `localStorage` só com chaves permitidas (`pt:fav` incluída) |
| Navegador | `apps/web/test/smoke.cjs` (página real servida em `/p/copa-teste`) | ver tabela abaixo |
| CI | `.github/workflows/ci.yml` | `pnpm test`, `pnpm test:web`, axe-core nas rotas, tipos |

| RFP | Teste de navegador |
|---|---|
| 02, 03, 04, 07, 17 | primeira dobra (ao vivo em 375×667), ordem das seções, landmarks, metadados, sem rolagem horizontal em 320/375 e com 8 categorias, alvos ≥ 44 px, sem script inline |
| 11 | tema segue o aparelho, Modo sol troca e é lembrado |
| 05, 06 | busca, seguir, "Meus jogos" no topo, lembra ao recarregar, funciona sem `localStorage` |
| 08 | seletor, `#categoria-<id>`, sem seletor com 1 categoria |
| 12 | vazio, encerrado, sem agenda, 404, erro inicial com "Tentar agora", carregando |
| 09, 10, 14 | consulta ~15 s com revalidação, sem remontar nem pular a tela, anúncio só dos jogos seguidos, aviso de sem conexão e recuperação |
| 04 (RNP) | `prefers-reduced-motion` |

Lacunas conhecidas: sem teste com leitor de tela real, sem celular real ao sol, axe-core só no CI (não instalado no ambiente de desenvolvimento).

## 13. Dependências de servidor e domínio (Fase 2)

| Melhoria | Mudança necessária |
|---|---|
| `Cache-Control` menor | `apps/api/src/app.ts` (`/api/public/:slug`): `no-cache` com ETag ou `max-age` curto |
| Árvore da chave | snapshot ganha `round`, `indexInRound` e origem do vencedor; atualizar allowlist e teste de privacidade |
| "há X" sem depender do relógio do aparelho | snapshot ganha `serverNow` (ou cabeçalho `Date`) |
| Prévia de link por torneio | HTML gerado no servidor (ou rota no nginx) com título e imagem do torneio |
| Offline | service worker para `/p/` (hoje o PWA exclui `/p/` do fallback de navegação) |
| Carga por ponto do juiz | compactar ou limitar a regeneração do snapshot em jogos ao vivo |

## 14. Decisões e histórico

| Data | Decisão |
|---|---|
| 29/10/2026 | Tema segue o aparelho; Modo sol troca e é lembrado |
| 29/10/2026 | Consulta de 15 s com `no-cache` (SPECS §10.3 atualizada) |
| 29/10/2026 | Fonte do sistema, sem fontes extras |
| 29/10/2026 | Seguir dupla guardado só no aparelho, até 6 por torneio |
| 29/10/2026 | `live.sets` incluído no snapshot (apenas números) |
