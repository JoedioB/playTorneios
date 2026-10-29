# PRD — Página pública do torneio

Versão 1.1 · 29/10/2026 · Status: **Fase 1 implementada; Fase 2 parcial** (cache, hora do servidor, cabeçalho enxuto e “Todas as categorias” feitos; offline, árvore da chave e prévia por torneio em backlog).
Complementa o `docs/PRD.md` (RF-16, RF-18, RF-21) e é detalhado tecnicamente em `docs/SPEC_PAGINA_PUBLICA.md`.

## 1. Resumo

A página pública (`/p/<slug>`) é a vitrine do torneio para quem **não** é o organizador: atletas, familiares, amigos e curiosos. Ela responde, em segundos e no celular, às quatro perguntas de quem está na areia:

1. **Quando e onde é o meu jogo?**
2. **Qual é o placar agora?**
3. **Como está a chave e a classificação?**
4. **Quem ganhou?**

É somente leitura, não exige cadastro e atualiza sozinha. Mostra apenas o que o organizador decidiu publicar e nunca expõe dados pessoais (PRD RF-21, DEC-12 e DEC-21).

## 2. Problema e oportunidade

Sem uma página pública boa, o organizador vira central de informação: é interrompido o tempo todo com "que horas é meu jogo?", "em que quadra?", "quem ganhou?". Isso consome atenção justamente no momento de maior pressão, e quadros impressos ficam desatualizados.

A primeira versão da página era uma lista longa: o jogo ao vivo ficava a cerca de 14 telas do topo no celular, não havia como achar a própria dupla, o cache podia mostrar placar velho por minutos e o tema era sempre claro. A auditoria de UX de 29/10/2026 transformou isso nos requisitos abaixo.

## 3. Objetivos e métricas de sucesso

| # | Objetivo | Como medir (ensaio e piloto) |
|---|---|---|
| O1 | O visitante acha o próprio jogo rapidamente | Em teste com 5 pessoas que nunca viram a página: ≥ 4 acham a hora e a quadra do próprio jogo em ≤ 15 s (meta de produto: 5 s com "Seguir" já ativo) |
| O2 | Placar confiável | Defasagem entre o ponto lançado e o que o visitante vê ≤ 30 s em condições normais (consulta de 15 s + publicação) |
| O3 | Reduzir perguntas ao organizador | Contagem informal de interrupções "hora/quadra/placar" antes e depois, no piloto |
| O4 | Funcionar em rede ruim e sol forte | Carrega e rola em celular com 3G; legível ao sol (modo claro de alto contraste) |
| O5 | Zero vazamento de dados pessoais | Teste automatizado de privacidade do snapshot passa em todo commit |
| O6 | Acessível | Sem violação séria ou crítica no axe; navegação por leitor de tela validada no piloto |

Fora de métricas: não há conta, analytics de terceiros nem rastreamento do visitante.

## 4. Público e cenários

### 4.1 Perfis

| Perfil | Quem é | O que quer | Contexto |
|---|---|---|---|
| **Atleta** | Joga o torneio | Hora e quadra do próximo jogo, adversário, resultado, posição | De pé, ao sol, celular na mão, com pressa; pode estar entre dois jogos |
| **Torcedor** | Família e amigos | Placar ao vivo da dupla que acompanha; saber quando o jogo começa | Na arquibancada ou a distância; pode abrir o link por mensagem de WhatsApp |
| **Curioso** | Público geral | Ver quem lidera, chaves, campeões | Navegação casual, às vezes no computador |
| **Organizador** (como espectador) | Quem criou o torneio | Conferir o que o público enxerga e se está atualizado | Usa a pré-visualização no painel e a página real |

### 4.2 Jornadas principais

1. **Atleta chega à quadra.** Abre o link, digita o sobrenome, toca em **Seguir**. Daí em diante vê "Meus jogos" no topo, com hora, quadra e adversário, e ao reabrir a página o favorito continua lá.
2. **Torcedor acompanha ao vivo.** Abre o link, vê "Ao vivo agora" logo abaixo da busca, com o placar do set atual e os sets fechados, e acompanha sem recarregar.
3. **Curioso vê a chave.** Escolhe a categoria no seletor fixo no topo, vê mata-mata por fase, classificação dos grupos e, ao final, o pódio.
4. **Compartilhamento.** O organizador manda no grupo o link da categoria (`/p/<slug>#categoria-<id>`); quem abre cai direto nela.
5. **Rede cai.** A página mantém o que já carregou, avisa "Sem conexão. Mostrando dados das HH:MM" e volta sozinha quando a rede retorna.

## 5. Escopo

### 5.1 Dentro (Fase 1, implementado)

- Cabeçalho com organização, nome, cidade, local, datas, descrição recolhível e selo de estado (em preparação, encerrado).
- Busca de dupla por nome ou sobrenome (sem acento, qualquer ordem).
- **Seguir** duplas (até 6 por torneio), guardado só no aparelho; "Meus jogos" no topo.
- **Ao vivo agora**, **Próximos jogos** (com "Mostrar todos"), **Campeões**.
- Seção por categoria, com seletor fixo (inclui **Todas**, que lista as categorias em sequência): selo de estado, pódio, mata-mata por fase, classificação de grupos, jogos da fase de grupos e duplas inscritas (recolhíveis).
- Cartão de partida: fase, estado (ao vivo, aguardando, encerrado, W.O., abandono), hora, quadra, categoria, placar por sets e vencedor.
- Atualização automática a cada 15 s, aviso de conexão, anúncio discreto para leitor de tela.
- Tema escuro ou claro pelo aparelho e botão **Modo sol**.
- Estados: carregando, torneio não encontrado, erro, vazio ("Em breve"), encerrado, seção desligada.
- Metadados básicos (descrição, theme-color, Open Graph genérico).
- Pré-visualização no painel do organizador, reaproveitando a mesma visão.

### 5.2 Fora (por ora)

- Contas, login, comentários, curtidas, notificações push, e-mail ou WhatsApp automático.
- Edição de qualquer dado (a página é somente leitura).
- Estatísticas avançadas, histórico entre torneios, rankings globais.
- Vídeo, transmissão e fotos.
- Pagamentos e inscrição pública (continuam fora do MVP, PRD §4.2).

### 5.3 Fase 2 (backlog priorizado)

| Item | Valor | Depende de |
|---|---|---|
| Uso offline da página (cache do último snapshot) | Reabrir sem rede | Service worker para `/p/` |
| Árvore visual da chave | Entender caminhos até a final | Snapshot com rodada e origem do vencedor |
| Prévia do link por torneio (nome, imagem) no WhatsApp | Mais cliques ao compartilhar | HTML gerado no servidor por torneio |
| Cor primária do torneio na página | Identidade visual | Garantia de contraste; decisão do organizador (§13) |

Feito na Fase 2 (29/10/2026): `Cache-Control: no-cache` na API pública (sempre revalida por ETag); hora do servidor pelo cabeçalho `Date` (sem mudar o snapshot); cabeçalho enxuto até 380 px (botão de tema só com ícone); opção **Todas** no seletor de categorias.

## 6. Requisitos funcionais

Prefixo **RFP** (requisito da página pública). Todos os itens "Implementado" têm teste automatizado (ver SPEC §12).

| ID | Requisito | Prioridade | Estado |
|---|---|---|---|
| RFP-01 | A página mostra nome, organização, cidade, local, datas e descrição do torneio publicado | Deve | Implementado |
| RFP-02 | O organizador escolhe o que publicar: duplas, chaves, programação, resultados e pódio; seção desligada não existe no dado enviado | Deve | Implementado |
| RFP-03 | Mostra jogos **ao vivo** em destaque, com placar do set atual e sets fechados | Deve | Implementado |
| RFP-04 | Mostra **próximos jogos** (duplas já definidas), por horário, com opção de ver todos | Deve | Implementado |
| RFP-05 | Busca de dupla por nome ou sobrenome, ignorando acento e maiúsculas, com ≥ 2 letras, palavras em qualquer ordem | Deve | Implementado |
| RFP-06 | O visitante pode **seguir** até 6 duplas; elas ficam só no aparelho (nenhum dado vai ao servidor), aparecem em "Meus jogos" no topo e marcam "Seu jogo" nos cartões | Deve | Implementado |
| RFP-07 | Mostra chaves por fase (mata-mata), classificação de grupos, jogos de grupos, duplas inscritas e pódio, conforme publicado | Deve | Implementado |
| RFP-08 | Seletor de categorias fixo no topo, com link compartilhável `#categoria-<id>`; com uma só categoria, não aparece | Deve | Implementado |
| RFP-09 | Atualização automática a cada 15 s com a aba visível; pausa em segundo plano; atualiza ao voltar à aba ou à rede | Deve | Implementado |
| RFP-10 | Em falha de rede, mantém os dados e avisa "Sem conexão. Mostrando dados das HH:MM"; volta sozinha | Deve | Implementado |
| RFP-11 | Tema escuro ou claro conforme o aparelho; botão **Modo sol** troca e lembra a escolha | Deve | Implementado |
| RFP-12 | Estados claros: carregando, não encontrado (404), erro com "Tentar agora", sem conteúdo ("Em breve"), torneio em preparação, torneio encerrado com campeões | Deve | Implementado |
| RFP-13 | Estado do jogo e o vencedor nunca dependem só de cor (texto e ícone) | Deve | Implementado |
| RFP-14 | Leitor de tela recebe anúncio discreto **só** quando começa ou termina um jogo de dupla seguida (sem anúncio a cada ponto) | Deve | Implementado |
| RFP-15 | Nenhum dado pessoal (telefone, nascimento, cidade do atleta, notas) é publicado; nome de exibição da dupla pode substituir os nomes completos | Deve | Implementado |
| RFP-16 | Pré-visualização no painel do organizador usa a mesma visão (tema claro), montada com o estado atual do aparelho e as seções escolhidas | Deve | Implementado |
| RFP-17 | Página mostra "Atualizado às HH:MM" e há quanto tempo foi conferida | Deve | Implementado |
| RFP-18 | Metadados de compartilhamento (descrição, cor do tema, Open Graph) e título da aba com nome e cidade | Deveria | Implementado (genérico) |
| RFP-19 | Funcionar sem JavaScript de terceiros, sem fontes externas e sem cookies | Deve | Implementado |
| RFP-20 | Uso offline: reabrir a página sem rede mostrando o último estado | Poderia | Fase 2 |
| RFP-21 | Árvore visual da chave | Poderia | Fase 2 |
| RFP-22 | Prévia de link por torneio | Poderia | Fase 2 |
| RFP-23 | O seletor de categorias oferece **Todas**, com link `#todas` | Deveria | Implementado |
| RFP-24 | “Há X” e “hoje” usam a hora do servidor, não a do aparelho | Deveria | Implementado |

## 7. Requisitos não funcionais

| ID | Requisito | Alvo |
|---|---|---|
| RNP-01 | Desempenho | Bundle da página ≤ 80 kB (JS + CSS, gzip); medido: ~73 kB |
| RNP-02 | Primeira dobra | Em 375×667 o jogo ao vivo aparece sem rolar (medido: a 449 px do topo) |
| RNP-03 | Rede ruim | Consulta com revalidação (304 barato); não redesenha se nada mudou; intervalo dobra após falha, até 60 s |
| RNP-04 | Acessibilidade | WCAG 2.2 AA: contraste de texto ≥ 4,5:1 e de componentes ≥ 3:1, alvos ≥ 44 px, foco visível, reflow em 320 px, `prefers-reduced-motion` |
| RNP-05 | Privacidade | Sem rastreadores, sem cookies, sem envio de dados do visitante; favoritos só em `localStorage` |
| RNP-06 | Compatibilidade | Navegadores atuais de celular (Safari iOS e Chrome Android) e desktop; funciona com `localStorage` bloqueado |
| RNP-07 | Segurança | CSP restritiva (`script-src 'self'`, sem scripts inline, sem terceiros), página somente leitura, sem autenticação |
| RNP-08 | Localização | Português do Brasil; horários em `America/Sao_Paulo`; datas por extenso |
| RNP-09 | Disponibilidade | Depende do servidor; a página guarda o último estado carregado enquanto a aba estiver aberta |

## 8. Regras de negócio

1. Só existe página para torneio **publicado**; ao despublicar, o link passa a responder 404 imediatamente.
2. O que o público vê é a **última versão publicada**; alterações feitas offline pelo organizador só aparecem depois de sincronizar (PRD RF-16).
3. Se "atualizar automaticamente a cada sincronização" estiver ligado, cada lote de operações aplicado (inclusive pontos lançados pelo juiz) gera nova versão; senão, só o botão **Publicar** atualiza.
4. Seção desligada pelo organizador **não é enviada** (não apenas escondida).
5. Jogo ao vivo mostra o set atual e os sets fechados; jogo encerrado mostra o placar final; W.O. e abandono aparecem como tais.
6. "Próximos jogos" só lista partidas com as duas duplas já definidas.
7. Nomes de dupla seguem a configuração de publicação (nome de exibição ou nomes completos); duplas anonimizadas aparecem como "Atleta anonimizado".

## 9. Dependências e integrações

- Publicação e snapshot: `docs/SPEC_PAGINA_PUBLICA.md` §3 (quando o snapshot é gerado) e §4 (contrato de dados); privacidade: DEC-12 e DEC-21.
- Placar ao vivo: vem do juiz por link (DEC-29) ou do organizador; a página mostra o que está no snapshot.
- Identidade visual: tema derivado das cores do torneio (RF-18); cores semânticas (ao vivo, ok, aviso, erro) são fixas.
- Hospedagem: mesma origem do painel (DEC-28, DEC-31); rota pública `/api/public/:slug` sem autenticação.

## 10. Riscos e mitigação

| Risco | Impacto | Mitigação |
|---|---|---|
| Placar público atrasado por cache | Visitante vê jogo "parado" | Cliente e servidor usam `no-cache` (revalida por ETag a cada consulta) |
| Cada ponto do juiz regenera o snapshot | Carga no banco com muitas quadras | Medir no ensaio; compactar ou limitar a frequência se pesar |
| Rede ruim no local | Página sem dados | Mantém último estado + aviso; offline completo na Fase 2 |
| Nome de exibição da dupla muda | Favorito deixa de casar | Página avisa e permite remover o favorito |
| Dados pessoais vazarem por novo campo | Violação da LGPD | Allowlist campo a campo + teste de varredura em todo commit |
| Região dos dados fora do Brasil | Revisão jurídica (DEC-26) | Ver `docs/DEPLOY_RAILWAY.md` |
| Rastreador de link (WhatsApp) não executa JS | Prévia genérica | Fase 2: HTML por torneio |

## 11. Plano de validação

1. **Ensaio (Fase B):** abrir a página em 3 celulares (um iPhone), seguir uma dupla, acompanhar jogo ao vivo lançado pelo juiz, derrubar e restaurar o wi-fi.
2. **Teste de usabilidade rápido:** 5 pessoas, tarefa "ache a hora do jogo de X" com cronômetro.
3. **Piloto:** contagem de interrupções ao organizador, tempo de atualização percebido, dúvidas recorrentes.
4. **Revisão de acessibilidade manual:** leitor de tela (VoiceOver e TalkBack) na busca, nos cartões e no anúncio ao vivo.

## 12. Decisões já tomadas (29/10/2026)

| Tema | Decisão |
|---|---|
| Tema | Segue o aparelho (escuro ou claro); **Modo sol** troca e é lembrado |
| Intervalo de atualização | 15 s |
| Fonte | Fonte do sistema (sem arquivos de fonte extras) |
| Seguir dupla | Sim, guardado só no aparelho, até 6 por torneio |

## 13. Perguntas em aberto

1. A cor primária do torneio deve aparecer no cabeçalho da página (com contraste garantido)?
2. Quando o torneio estiver encerrado, a página deve permanecer publicada por quanto tempo (hoje: até o organizador despublicar)?
3. Mostrar a classificação completa de cada grupo ou só a posição e vitórias (hoje: posição, jogos e vitórias)?
4. Há interesse em um telão público (TV) com a mesma visão da página, em tela cheia e rolagem automática?
