# Decisões de Arquitetura e Produto

## Status

Proposta inicial para o MVP, baseada no PRD e na arquitetura definida para o sistema de gerenciamento de torneios de futevôlei. Atualizado em 29/10/2026: incorpora as DEC-29 e DEC-30 (operação na quadra) e as revisões das DEC-10, DEC-15 e DEC-27.

## 1. Contexto

O objetivo do produto é permitir que uma organização de torneios locais gerencie inscrições, categorias, chaveamentos, programação, resultados, classificação e publicação pública de forma confiável, mesmo com a operação administrativa acontecendo parcialmente offline em um único dispositivo.

O MVP precisa equilibrar simplicidade, confiabilidade e facilidade de manutenção. A arquitetura deve priorizar o uso durante o evento, reduzir risco de perda de dados e manter a experiência do organizador clara mesmo em condições de internet instável.

## 2. Decisões principais

### DEC-01 — Operação administrativa offline em um único dispositivo

- Decisão: A aplicação administrativa será local-first e deve continuar funcionando sem internet após a preparação inicial do dispositivo.
- Justificativa:
  - o PRD exige operação offline para funções essenciais;
  - o uso previsto é em um único computador/tablet durante o evento;
  - a organização não pode depender de conectividade estável para conduzir partidas e registrar resultados.
- Consequências:
  - a persistência local é crítica e deve ser confiável;
  - eventos de rede não devem impedir o fluxo principal de cadastro e resultados;
  - o sistema precisa apresentar claramente o estado da conexão e da sincronização;
  - o backend remoto atua como sincronização e publicação, não como componente obrigatório para todas as tarefas do evento.

### DEC-02 — Interface administrativa como PWA

- Decisão: o frontend administrativo será uma aplicação web responsiva em formato PWA.
- Justificativa:
  - reduz custo inicial e facilita acesso em dispositivos de evento;
  - permite uso em navegador com cache e instalação local;
  - atende ao requisito de operação offline em um dispositivo usado durante o torneio.
- Consequências:
  - a aplicação deve tratar corretamente cache, persistência local e atualização de serviço;
  - o organizador deve poder abrir e usar a aplicação mesmo sem internet após a carga inicial;
  - o ciclo de atualização da interface deve ser previsível e não incompatível com o armazenamento local.

### DEC-03 — Persistência local em IndexedDB

- Decisão: o armazenamento local será estruturado em IndexedDB, com dados de torneio, inscrições, resultados e fila de sincronização.
- Justificativa:
  - o PRD indica IndexedDB como preferência inicial;
  - o modelo é adequado para dados estruturados e uso do navegador;
  - permite persistência local robusta para entidades complexas do torneio.
- Consequências:
  - a camada local deve ser tratada como fonte primária enquanto estiver offline;
  - os dados locais precisam ser salvos antes de comunicar sucesso ao usuário;
  - a sincronização precisa preservar alterações pendentes até confirmação do servidor;
  - são necessários testes reais de recarga da página e recuperação do estado offline.

### DEC-04 — Backend remoto com autenticação e sincronização

- Decisão: haverá um backend remoto com autenticação, APIs de gestão, sincronização e dados públicos.
- Justificativa:
  - o PRD exige login administrativo, publicação pública e sincronização depois da reconexão;
  - um backend remoto garante centralização do estado autorizado e controle de acesso.
- Consequências:
  - a arquitetura precisa separar claramente cliente local e servidor remoto;
  - autenticação e autorização devem ser implementadas no servidor;
  - a API precisa validar regras de negócio relevantes e não depender apenas do cliente.

### DEC-05 — Banco relacional remoto como base de dados principal

- Decisão: o banco remoto será relacional, com a implementação inicial sugerida em PostgreSQL ou equivalente robusto.
- Justificativa:
  - o domínio exige integridade de dados, histórico de mudanças e relações entre torneios, categorias, atletas, duplas, partidas e resultados;
  - o PRD também exige auditoria, registro de conflitos e consistência de classificação.
- Consequências:
  - o sistema precisará de modelos bem definidos para entidades e status;
  - a sincronização deve respeitar atomicidade e consistência de transações;
  - o backend deve tratar conflitos de maneira explícita, preservando versões locais e remotas.

### DEC-06 — Arquitetura local-first com sincronização explícita

- Decisão: o sistema adotará uma fila de operações pendentes e uma camada de sincronização separada, com idempotência e retry.
- Justificativa:
  - o PRD exige que alterações locais permaneçam preservadas até confirmação do servidor;
  - a arquitetura precisa evitar duplicação de operações e perda de dados ao reprocessar falhas de rede.
- Consequências:
  - cada operação relevante deve ter identificador estável;
  - as tentativas de sincronização devem ser registradas e reexecutadas conforme necessidade;
  - conflitos devem ser detectados e exibidos para intervenção do administrador;
  - operações pendentes não podem ser descartadas silenciosamente.

### DEC-07 — Base única de verdade para o administrador, base pública separada

- Decisão: a área administrativa e a página pública devem ser tratadas como domínios diferentes, com dados públicos filtrados e servidos apenas após sincronização.
- Justificativa:
  - o PRD exige que a página pública seja somente leitura;
  - a publicação pública deve ocultar dados privados e sensíveis;
  - o público não deve assumir que as alterações locais a qualquer momento já estejam visíveis.
- Consequências:
  - a arquitetura precisa de um modelo de publicação explícito;
  - o backend deve manter um conjunto de dados públicos separado do administrativo;
  - a UI pública deve refletir uma versão confirmada e consistentemente sincronizada.

### DEC-08 — Regras esportivas centralizadas e testáveis

- Decisão: regras de pontuação, classificação, avanço de chave, desempates e formatos de competição devem ser implementadas em módulos de domínio dedicados, com testes automatizados.
- Justificativa:
  - o PRD exige que regras de competição sejam configuráveis e precisas;
  - o sistema precisa recalcular classificação e avanço de chave sem depender de cálculos manuais ou inconsistentes;
  - mudanças em regras ou chaveamentos podem afetar resultados anteriores e exigem cautela.
- Consequências:
  - o código de regras não pode ficar espalhado na UI;
  - as regras devem ser versionadas ou pelo menos protegidas por validações e avisos de impacto;
  - mudanças que afetam resultados existentes devem exigir explicação e registro de histórico.

### DEC-09 — Estado do torneio e validações de transição

- Decisão: o torneio terá estados principais de rascunho, aberto/em andamento e encerrado, com validações de transição explícitas.
- Justificativa:
  - o PRD define claramente esses estados e a necessidade de confirmação antes do encerramento;
  - evitar encerramento silencioso com partidas pendentes é essencial.
- Consequências:
  - a operação de encerramento deve verificar partidas não resolvidas;
  - a reabertura precisa ser intencional e segura;
  - a UI deve mostrar claramente o status atual e impedir ações incompatíveis com o ciclo de vida.

### DEC-10 — Check-in, permissões e papel do administrador

- Decisão: haverá um único perfil administrativo autenticado, responsável por todas as ações de gestão do torneio.
- Justificativa:
  - o MVP não inclui múltiplos perfis e nem inscrições públicas;
  - a organização local precisa de um fluxo simples e direto para conduzir o evento.
- Consequências:
  - a segurança deve priorizar sessão e proteção de acesso;
  - o sistema precisa manter a área administrativa acessível apenas para o organizador autenticado;
  - check-in e presença devem ser visíveis, mas não bloquearem automaticamente a participação sem decisão do administrador.
- Revisão (29/10/2026): revisada parcialmente pela DEC-29. Continua um único perfil autenticado; o juiz de quadra acessa por link, sem conta, com permissões mínimas.

### DEC-11 — Resultados com histórico de correção

- Decisão: qualquer alteração em resultado deve solicitar justificativa, registrar a correção anterior e recalcular dependências afetadas.
- Justificativa:
  - o PRD exige preservação do registro antigo e justificativa de correção;
  - resultados e classificação dependem de integridade histórica.
- Consequências:
  - a arquitetura precisa de auditoria estruturada para alterações de placar;
  - a UI deve exigir confirmação explícita antes de persistir a correção;
  - as mudanças devem refletir imediatamente na classificação e em partidas dependentes.

### DEC-12 — Privacidade e minimização de dados

- Decisão: a aplicação adotará política de privacidade por padrão, minimizando dados pessoais e ocultando informações sensíveis da página pública.
- Justificativa:
  - o PRD inclui requisitos de LGPD, privacidade e proteção de dados;
  - o público não deve visualizar dados administrativos ou pessoais desnecessários.
- Consequências:
  - o modelo de dados deve distinguir dados públicos e privados;
  - a publicação pública deve ser configurável por torneio e categoria;
  - o sistema deve permitir correção, exclusão ou anonimização, conforme a necessidade do serviço.

### DEC-13 — Exportação local e em servidor

- Decisão: o MVP deve fornecer exportações em PDF e CSV, com suporte para uso offline quando os dados estiverem disponíveis localmente.
- Justificativa:
  - o PRD exige exportação de inscritos, programação, resultados e classificação;
  - relatórios costumam ser necessários durante o evento mesmo quando não há internet.
- Consequências:
  - a camada local deve permitir gerar relatórios sem depender do servidor;
  - os arquivos devem incluir metadados do torneio, categoria e data de geração;
  - o sistema precisa manter a exportação compatível com uso em Excel e impressão.

### DEC-14 — Localização conforme padrão brasileiro

- Decisão: a interface, regras de apresentação e comportamento da aplicação seguirão o padrão brasileiro, com idioma em português e fuso horário `America/Sao_Paulo`.
- Justificativa:
  - o PRD define idioma, datas e região de operação;
  - a experiência do organizador fica mais natural e evitam erros de entendimento.
- Consequências:
  - a UI deve usar datas em `DD/MM/AAAA`;
  - a aplicação precisa ser consistente em formatação numérica e de horário;
  - a lógica de calendário e programação deve respeitar o fuso local.

### DEC-15 — Escopo inicial deliberadamente simples

- Decisão: o MVP não inclui aplicativo nativo, inscrição pública autônoma, múltiplos dispositivos sincronizando ao mesmo tempo, pagamentos nem rankings globais.
- Justificativa:
  - o PRD separa explicitamente o que entra e sai do MVP;
  - a arquitetura precisa reduzir risco e acelerar a entrega inicial.
- Consequências:
  - a implementação deve seguir em um caminho que permita extensão futura;
  - o modelo de dados deve evitar acoplamento excessivo a uma única organização;
  - a arquitetura deve ser preparada para evoluir para múltiplos organizadores, mas sem exigir isso no MVP.
- Revisão (29/10/2026): revisada pela DEC-29. Arbitragem por link e uso de vários aparelhos na quadra (juízes, online) entram no escopo. Seguem fora: aplicativo nativo, inscrição pública, pagamentos, rankings globais, operação offline simultânea e sincronização em tempo real entre aparelhos de organizador.

### DEC-16 — Stack tecnológica do MVP

- Status: **Aceita** (confirmada em 25/10/2026).
- Decisão: frontend em React + Vite + TypeScript (PWA); estado local em IndexedDB via Dexie; backend em Node + Fastify; ORM Drizzle; banco PostgreSQL; monorepo com pnpm workspaces; testes com Vitest, fast-check, Playwright e axe-core.
- Justificativa:
  - TypeScript em todo o repositório permite compartilhar o domínio e os contratos entre cliente e servidor (RNF-03: validar nos dois lados);
  - Dexie oferece transações e consultas reativas sobre IndexedDB (DEC-03);
  - o PRD deixava framework e banco em aberto (PRD §11).
- Consequências:
  - os pacotes `packages/domain` e `packages/contracts` passam a ser a fonte única das regras e dos schemas;
  - o detalhamento está em `docs/SPECS.md`, seções 2 e 3.

### DEC-17 — Sessão offline com bloqueio por inatividade e PIN local

- Status: **Proposta**, a confirmar.
- Decisão: offline, a expiração por inatividade é aplicada no cliente, com tela de bloqueio e desbloqueio por PIN local definido durante um login online. Ao voltar a conexão, a sessão do servidor é revalidada.
- Justificativa:
  - o PRD exige expiração de sessão por inatividade (RF-01) e operação offline (RF-19), e o servidor não pode validar a sessão sem rede;
  - expirar a sessão e apagar dados locais violaria a regra 12 (dados pendentes não podem ser descartados).
- Consequências:
  - guardar apenas um verificador derivado do PIN, nunca o PIN;
  - se a sessão do servidor tiver expirado ao reconectar, exigir login completo sem apagar dados locais nem a fila de sincronização;
  - risco assumido: quem tem o dispositivo desbloqueado acessa os dados locais, que não são criptografados pelo app.

### DEC-18 — Escrita de domínio somente via sincronização

- Status: **Proposta**.
- Decisão: a API não expõe CRUD genérico das entidades. Toda escrita de domínio entra por `POST /sync/push`, como operações de negócio com identificador estável.
- Justificativa: um único caminho para validação, idempotência e auditoria.
- Consequências: o servidor reaplica as regras do domínio a cada operação; não há endpoints paralelos de edição que possam contornar a idempotência. O endpoint do juiz (DEC-29) segue o mesmo princípio: aceita apenas operações de negócio de uma lista de permissão e as reaplica pelo mesmo motor.

### DEC-19 — Avanço de chave e classificação derivados

- Status: **Proposta**.
- Decisão: quem avança na chave, a classificação e o pódio são calculados a partir dos resultados atuais e nunca gravados como estado independente.
- Justificativa: evita estado duplicado que fica defasado após uma correção; aplica a regra 10 (classificação não é editável).
- Consequências: corrigir um placar atualiza toda a chave de forma consistente; cálculos precisam de desempenho adequado (SPECS §16).

### DEC-20 — Resultados em revisões append-only

- Status: **Proposta**.
- Decisão: cada resultado é uma sequência de revisões. Uma correção acrescenta uma revisão com justificativa e invalida a anterior, sem apagá-la. Alterações de chave marcam resultados como invalidados em vez de excluí-los.
- Justificativa: atende RF-14, RF-10 e DEC-11 (histórico, justificativa e recuperação).
- Consequências: o resultado atual é a revisão mais alta não invalidada; a auditoria guarda valor anterior, novo valor, justificativa, data/hora e dispositivo.

### DEC-21 — Snapshot público por lista de permissão

- Status: **Proposta**.
- Decisão: o servidor monta o snapshot público campo a campo, a partir de uma lista de permissão. Seções desligadas na publicação ficam ausentes do JSON, e não apenas ocultas na tela.
- Justificativa: reforça DEC-07 e DEC-12; copiar uma entidade e remover campos arrisca vazar dados novos adicionados depois.
- Consequências: um teste automatizado varre o snapshot e falha se encontrar chave fora da lista ou valor que pareça telefone ou data de nascimento.

### DEC-22 — Design Arena Noturna

- Status: **Aceita** (escolhido em 25/10/2026).
- Decisão: o design do painel do organizador segue a direção *Arena Noturna*: central de comando com busca global, tema escuro, âmbar de refletor como primária e coral para "ao vivo". O tema do torneio (RF-18) troca apenas a primária e o acento.
- Justificativa: a busca global e os alertas na tela inicial atendem RNF-01 (poucos passos nas ações frequentes) em torneios com muitas duplas.
- Consequências:
  - cores semânticas (ok, aviso, erro, info, ao vivo) são fixas e não dependem do tema do torneio;
  - é preciso oferecer um modo claro de alto contraste como alternativa, por causa do uso ao sol;
  - os mockups são referência, não código de produção.

### DEC-23 — Expiração de sessão

- Status: **Proposta**, a confirmar.
- Decisão: 8 horas de inatividade, com renovação deslizante, e 7 dias de limite absoluto.
- Justificativa: o PRD deixa a política em aberto (PRD §11); o prazo cobre um dia de evento sem pedir login repetido.
- Consequências: os valores ficam configuráveis por variável de ambiente.

### DEC-24 — Padrões do sistema para duração, descanso e justificativa

- Status: **Proposta**, a confirmar.
- Decisão: partida de 40 minutos, descanso mínimo de 20 minutos entre jogos da mesma dupla, justificativa de correção com ao menos 10 caracteres.
- Justificativa: o PRD exige valores padrão explícitos (PRD §11; regra 15).
- Consequências: a interface identifica esses valores como padrão do sistema, e não como regulamento oficial; todos são configuráveis por torneio.

### DEC-25 — Disputa de 3º lugar

- Status: **Proposta**, a confirmar.
- Decisão: sem disputa de 3º lugar por padrão. As duas duplas derrotadas nas semifinais aparecem empatadas em 3º, e a categoria pode ativar a disputa.
- Justificativa: RF-15 manda mostrar apenas posições justificadas pelos resultados, sem inventar ordem.

### DEC-26 — Retenção de telefone e data de nascimento

- Status: **Proposta**, depende de revisão jurídica.
- Decisão: manter telefone e data de nascimento por até 12 meses após o término do torneio, ou até pedido de remoção, o que ocorrer primeiro; depois, anonimizar o atleta preservando resultados e classificação.
- Justificativa: minimização de dados (RF-21) e preservação do registro esportivo.
- Consequências: um job diário aplica a política; o prazo e a base legal precisam de revisão do responsável pelo serviço antes da publicação.

### DEC-27 — Hospedagem e PostgreSQL

- Status: **Decidida em caráter provisório** (29/10/2026); reavaliar após o piloto.
- Decisão: servidor próprio (Ubuntu) com Docker Compose e Cloudflare Tunnel, conforme `docs/TUTORIAL_MAQUINA_LOCAL.md`. O requisito mínimo continua sendo executar contêineres Docker e oferecer PostgreSQL com backup. Alternativas documentadas: VPS com Caddy (`docker-compose.tls.yml`) e Railway (DEC-31).
- Justificativa: custo baixo, sem portas abertas no roteador e funcionamento atrás de CGNAT.
- Consequências: a disponibilidade depende de luz e internet do local; exige backup com cópia externa e restauração testada (`scripts/backup.sh`, `scripts/restore-test.sh`) e monitor externo. Reavaliar com os dados do piloto.

### DEC-28 — Docker e Docker Compose

- Status: **Aceita** (confirmada em 25/10/2026).
- Decisão: Docker e Docker Compose em desenvolvimento, CI e implantação. Serviços: `db` (PostgreSQL), `api` (Fastify), `web` (nginx com os estáticos do PWA e da página pública) e `migrate` (executa as migrações e termina). O `web` encaminha as rotas de API para o `api`, de modo que o navegador usa uma única origem.
- Justificativa:
  - ambiente idêntico entre desenvolvimento, CI e produção, e subida com um comando;
  - a mesma origem mantém `SameSite=Strict` e dispensa CORS;
  - imagens separadas deixam o front sem estado e a API sem dependências de build.
- Consequências:
  - imagens fixadas por versão e digest, executadas como usuário sem privilégios, com varredura de vulnerabilidades no CI;
  - o `nginx.conf` precisa servir `sw.js` e `index.html` com `no-cache` e os arquivos com hash como imutáveis, senão o PWA não atualiza;
  - o service worker fica desligado no servidor de desenvolvimento e ligado no build de produção;
  - migrações expansivas primeiro, para o app antigo em cache continuar compatível com a API nova;
  - o volume do banco nunca é recriado fora do ambiente local.

### DEC-29 — Juiz da partida por link de quadra, sem conta

- Status: **Implementada; a confirmar após o ensaio com 3 celulares** (detalhes em `docs/SPEC_JUIZ.md`).
- Decisão: o organizador gera um link (e QR) por juiz e por quadra. Quem abre o link vê só as partidas daquela quadra, abre a partida, lança pontos, desfaz e finaliza. Não há conta nem senha do juiz. O nome informado ao gerar o link fica gravado na revisão do resultado e aparece em Resultados.
- Justificativa: com cerca de 3 quadras simultâneas, o aparelho único do organizador é o gargalo. Contas e papéis exigiriam recuperação de senha, convites e revisão do modelo de permissões. Com wi-fi bom nas quadras, um juiz só-online resolve o gargalo com muito menos risco.
- Consequências:
  - revisa parcialmente DEC-10 (perfil único) e DEC-15 (um aparelho e sem arbitragem);
  - mantém DEC-18: o juiz escreve por operações de negócio (`match.start`, `match.live_score`, `result.record` normal) em `POST /api/referee/push`, com lista de permissão no servidor e aparelho `ref-<id do link>`;
  - mantém DEC-11 e DEC-20: o juiz grava a revisão 1; qualquer correção, W.O. ou abandono é do organizador;
  - mantém DEC-12: a visão do juiz não contém telefone, nascimento nem dados de inscrição;
  - o token tem 256 bits, só o hash (SHA-256) fica no banco, é mostrado uma vez, vai no fragmento da URL (`/juiz.html#<token>`), vale até o fim do torneio (máximo 7 dias) e pode ser revogado;
  - o juiz exige internet; uma fila curta no aparelho reenvia comandos após queda breve de sinal;
  - revisitar contas individuais se o piloto mostrar necessidade (juízes recorrentes, autoria rigorosa).

### DEC-30 — Operação na quadra: telão e súmulas

- Status: **Implementada**.
- Decisão: o telão (`#/telao`) e as súmulas em papel (`#/imprimir`) rodam no próprio aparelho do organizador, a partir do estado local, sem depender do servidor.
- Justificativa: funcionam com a internet fora, que é o caso em que o papel e a TV mais importam.
- Consequências: o telão mostra os nomes das duplas como o painel mostra; usar nome de exibição quando houver preocupação com privacidade em tela pública.

### DEC-31 — Hospedagem alternativa: tudo na Railway

- Status: **Proposta**, a validar em ensaio (29/10/2026). Alternativa à DEC-27, não a substitui até o ensaio.
- Decisão: banco PostgreSQL, API e front (nginx) como três serviços de um projeto na Railway, na mesma origem. Não usar a Vercel para o front.
- Justificativa:
  - a arquitetura depende de origem única (cookie `SameSite=Strict`, checagem de CSRF, sem CORS); dividir front e API em domínios exigiria rewrites, mudar a confiança no IP do visitante e reescrever cabeçalhos e cache do PWA;
  - o plano Hobby da Vercel não permite uso comercial, o que obrigaria o plano Pro;
  - o front é pequeno e cacheável, então a CDN da Vercel traz pouco ganho.
- Consequências:
  - a imagem do `web` ganhou templates de nginx com `API_UPSTREAM`, `API_RESOLVER` e `API_RESOLVER_OPTS`, e um listener 8083 para o proxy da Railway; a `api` aceita `MIGRATE_ON_START=true`;
  - a configuração fica no painel (o *config as code* da Railway está obsoleto); roteiro em `docs/DEPLOY_RAILWAY.md`;
  - o IP do visitante vem de `X-Forwarded-For` com a regra do primeiro IP não confiável; precisa de confirmação no ensaio;
  - dados possivelmente fora do Brasil (revisar com a DEC-26) e backup próprio obrigatório (`BACKUP_DATABASE_URL` em `scripts/backup.sh`).

## 3. Decisão de adoção tecnológica inicial

A decisão tecnológica principal para o MVP é:

- frontend web responsivo em formato PWA;
- persistência local em IndexedDB;
- backend com autenticação e sincronização (Node + Fastify, ver DEC-16);
- banco remoto relacional (PostgreSQL);
- Docker e Docker Compose para desenvolvimento, CI e implantação (DEC-28);
- fila de sincronização com idempotência;
- página pública somente leitura servida a partir dos dados sincronizados;
- exportação de relatórios em PDF/CSV.

Essa combinação atende aos requisitos de offline, consistência, segurança e simplicidade sem abrir escopo excessivo para a primeira entrega.

## 4. Conflitos e trade-offs considerados

### Trade-off 1: simplicidade vs. complexidade de sincronização

- A escolha local-first exige mais mecanismos de sincronização e auditoria.
- Isso é justificável porque o PRD exige confiabilidade offline e preservação de dados.

### Trade-off 2: flexibilidade vs. foco no MVP

- O sistema poderia ser pensado para múltiplos dispositivos e vários organizadores desde o início.
- A decisão foi manter o escopo no single-device administrativo para reduzir risco e permitir entrega focada. A exceção controlada é o juiz por link (DEC-29), que escreve por um endpoint restrito e não exige sincronização offline entre aparelhos.

### Trade-off 3: visibilidade pública vs. privacidade

- A publicação pública exige segurança e minimização de dados.
- O sistema resolve isso com filtragem explícita em vez de expor tudo da base administrativa.

## 5. Riscos principais

- conflitos de sincronização quando há alteração local e remota incompatíveis;
- aumento de complexidade ao lidar com histórico de correções de resultados;
- necessidade de validação rigorosa de regras de chaveamento e classificação;
- dependência de testes reais de offline antes da entrega final;
- links de juiz funcionam como credenciais e dependem de revogação e validade curta.

## 6. Conclusão

As decisões acima refletem a estratégia do produto: manter a administração local, robusta e confiável durante o evento; sincronizar de forma segura quando houver internet; proteger dados pessoais; e preservar a consistência de regras esportivas e de publicação pública.

Essas decisões devem orientar a implementação, a validação técnica e o refinamento posterior da arquitetura durante o desenvolvimento do MVP.
