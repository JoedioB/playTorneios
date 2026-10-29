# Especificação: juiz da partida (placar na quadra)

Status: **implementado com os padrões propostos** (aguarda ensaio com 3 celulares e aprovação formal do DEC-29). Contexto informado pelo organizador: cerca de 3 quadras com jogos simultâneos (pode variar) e bom sinal de wi-fi em todas.

## DEC-29 (proposta) — Juiz por link de quadra, sem conta

- **Decisão:** o organizador gera um link (e QR) por quadra. Quem abre o link vira "juiz daquela quadra": vê só as partidas dela, abre a partida, lança pontos, desfaz e finaliza. Não há conta nem senha do juiz nesta fase.
- **Justificativa:** com 3 quadras simultâneas, o aparelho único do organizador é o gargalo. Contas e papéis completos exigiriam revisar o PRD (que define um perfil único e deixa o módulo de arbitragem fora do MVP) e a operação offline em vários aparelhos. Com wi-fi bom, um juiz só-online resolve o gargalo com muito menos risco.
- **Consequências:**
  - revisa parcialmente DEC-10 (perfil único) e DEC-15 (um aparelho), e o item "módulo de arbitragem separado" do PRD §4.2;
  - mantém DEC-18: o juiz também escreve por operações de negócio com identificador estável, só por um endpoint com lista de permissão;
  - mantém DEC-11/DEC-20: o juiz grava a revisão 1 do resultado; qualquer correção posterior é do organizador, com justificativa;
  - mantém DEC-12: o aparelho do juiz não recebe telefone, data de nascimento nem dados de inscrição.

## O que o juiz faz

1. Abre o link da quadra e vê a partida em andamento e as próximas (até 3) daquela quadra.
2. **Abrir partida** (`match.start`).
3. **+1 ponto** para cada lado (`match.live_score`), com **desfazer** do último ponto.
4. **Finalizar** (`result.record`, tipo normal, com os sets ou pontos): confirma o placar e grava a revisão 1.
5. Vê o resultado gravado e a próxima partida. Se o organizador já lançou o resultado, vê o aviso "O organizador já registrou este resultado".

Fora do escopo do juiz: W.O., abandono, corrigir resultado, mexer em horário, quadra, chave ou inscrição. Esses casos seguem com o organizador.

## O que o organizador ganha

- Tela **Juízes** (junto de Quadras): gerar link e QR por quadra, copiar, revogar, ver "visto há N min" e a validade.
- Os pontos aparecem no painel do organizador e na página pública (com o atraso de sincronização já existente).
- Resultados lançados pelo juiz aparecem com a origem na auditoria ("juiz, Quadra 2") e podem ser corrigidos pelo fluxo normal.

## Fase 1 — Tela de placar (reaproveitada na fase 2)

Rota `#/placar/<partida>` no app do organizador, em tela cheia, sem navegação:

- botões de ponto grandes (≥ 56 px, 8 px de distância entre alvos), um por dupla, com o placar em fonte numérica grande;
- **Desfazer ponto** separado dos botões de ponto; **Finalizar partida** com confirmação do placar;
- região viva anuncia cada ponto ("Dupla A, 12 a 10"); funciona só com teclado e leitor de tela;
- mantém a tela acesa (Wake Lock) quando o navegador permite;
- uso no aparelho do organizador (tablet na quadra) já é útil, mas **não resolve as 3 quadras simultâneas**: isso é a fase 2.

## Fase 2 — Link do juiz (online)

### Dados

Tabela `referee_links`: `id`, `organization_id`, `tournament_id`, `court_id`, `token_hash` (SHA-256), `label`, `created_at`, `expires_at`, `revoked_at`, `last_seen_at`. O token tem 256 bits aleatórios e nunca é guardado em claro. Validade padrão: até o fim do último dia do torneio (configurável, máximo 7 dias).

### Acesso

- URL: `/juiz.html#<token>`. O token vai no fragmento (não aparece em logs nem em `Referer`) e fica em `sessionStorage`; as chamadas usam `Authorization: Bearer`. Sem cookie, o CSRF não se aplica.
- Bundle próprio e leve (como a página pública): sem Dexie nem telas administrativas.

### Endpoints

| Endpoint | O que faz |
| --- | --- |
| `GET /api/referee/matches` | Projeção mínima das partidas da quadra: id, rótulo, nomes de exibição das duplas, regras de pontuação (sets, pontos), placar ao vivo, estado e resultado. Nada de telefone, nascimento ou inscrição |
| `POST /api/referee/push` | Aceita só `match.start`, `match.live_score` e `result.record` normal, apenas para partidas da quadra e do torneio do link, e só enquanto a partida não tiver resultado. Reaplica pelo mesmo motor de domínio (`pushOperations`), com `deviceId = ref-<id do link>` |
| `POST /api/tournaments/:id/referee-links` (+ `DELETE`) | Do organizador, com a sessão normal: criar, listar e revogar |

Cada operação do juiz leva `expectedA` e `expectedB`: se a chave mudou, o resultado é recusado, como já acontece hoje.

### Regras de conflito

- O placar ao vivo toca só o campo `live`; horário e quadra tocam outros campos, então não colidem.
- Resultado já registrado pelo organizador → o servidor recusa o do juiz com `ALREADY_RECORDED`; a tela explica e mostra o resultado vigente.
- Com o link revogado ou vencido, a tela mostra "Link encerrado. Peça um novo ao organizador" e **mantém na tela o placar local**, para o juiz não perder o jogo em andamento.

### Conectividade

Online-only, com aviso claro quando cair. Uma fila curta em `localStorage` guarda as operações pendentes (idempotentes por `opId`) para reenvio automático após uma queda breve de sinal.

### Segurança e privacidade

- limite de taxa por link e por IP; token inválido responde igual a token inexistente;
- lista de permissão no servidor, validada antes do domínio; tentativa de operação fora dela é recusada e registrada;
- o juiz só enxerga nomes de exibição já usados na página pública;
- o link é uma credencial: compartilhar em grupo aberto de mensagens é um risco aceito e mitigado por revogação e validade curta.

## Testes

- **Domínio e API:** o juiz não consegue enviar tipos fora da lista, partida de outra quadra, de outro torneio ou de outra organização; link revogado e vencido são recusados; a projeção não contém campos pessoais (varredura automática, como no snapshot público); resultado duplicado vira `ALREADY_RECORDED`; idempotência de reenvio.
- **Navegador (smoke + axe):** tela de placar, em dois temas, sem violações sérias; reflow a 320 px; fluxo abrir → pontos → desfazer → finalizar.
- **Integração (CI com Postgres):** três quadras lançando em paralelo, com o organizador corrigindo um resultado no meio.

## Decisões em aberto (propostas entre parênteses)

1. Validade do link: fim do torneio, no máximo 7 dias (proposto).
2. O juiz pode lançar W.O. e abandono? (não, só o organizador).
3. Resultado do juiz precisa de confirmação do organizador? (não nesta fase; a correção com justificativa já cobre).
4. Link por quadra ou por partida? (por quadra).

## Ordem de entrega

1. Tela de placar no app do organizador (fase 1), com testes e axe.
2. Tabela e endpoints do juiz, com os testes de autorização.
3. Bundle do juiz, tela **Juízes** do organizador e QR.
4. Ensaio com 3 celulares, usando o seed.

## Estado da implementação

- Tela de placar: `#/placar/<partida>` (organizador, tela cheia) e componente compartilhado `ui/scoreboard.tsx`.
- Backend do juiz: migração `003_referee_links.sql`, `referee-core.ts`, `referee.ts`, rotas `/api/referee/*` e `/api/tournaments/:id/referee-links`.
- Página do juiz: `/juiz.html#<token>` (bundle próprio, sem Dexie), com fila curta em `localStorage`.
- Tela **Juízes** do organizador com QR (gerador próprio em `lib/qr.ts`, conferido com um decodificador independente).
- Também entregues nesta etapa: **Telão** (`#/telao`, TV ou projetor, atualiza sozinho) e **Imprimir súmulas** (`#/imprimir`, folhas de reserva por quadra).
- Tempo real: o painel do organizador já puxa mudanças a cada 15 s; os pontos do juiz aparecem nesse ritmo. A página pública mostra o placar com o atraso do snapshot.
- Limite conhecido: o snapshot público mostra só o placar do set em andamento (`live.a/b`), sem os sets já fechados.
