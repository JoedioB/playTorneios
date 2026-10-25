# Roadmap do MVP

## Visão geral

Este roadmap traduz o PRD, a arquitetura e as decisões de produto em uma sequência de entrega para o MVP do sistema de gerenciamento de torneios de futevôlei.

O objetivo principal é entregar uma solução funcional, confiável e simples de operar, com foco em:

- operação administrativa local-first;
- sincronização segura quando a conexão voltar;
- regras esportivas consistentes;
- publicação pública somente leitura;
- exportação de relatórios e dados.

O escopo está alinhado ao MVP e evita itens fora do objetivo inicial, como inscrição pública autônoma, múltiplos dispositivos sincronizando ao mesmo tempo, pagamentos e rankings globais.

## Fases da implementação

### Fase 0 — Fundação e alinhamento técnico

Objetivo: preparar a base do projeto e confirmar o desenho técnico.

Entregas:

- definição do stack front-end e back-end;
- estrutura do repositório e convenções de código;
- definição da arquitetura local-first e do fluxo de sincronização;
- seleção da persistência local e do banco remoto;
- definição do modelo de autenticação, sessão e autorização;
- criação do backlog técnico do MVP.

Critérios de conclusão:

- a arquitetura está documentada e consistente com o PRD;
- existe um modelo inicial de entidades e fluxos críticos;
- o time tem definição clara sobre persistência local, API e publicação pública.

---

### Fase 1 — Modelagem do domínio e persistência

Objetivo: estabelecer as entidades centrais do sistema e a base de dados.

Entregas:

- entidades: torneio, categoria, atleta, dupla, inscrição, quadra, chave, partida, resultado, classificação;
- estados do torneio e status de inscrição;
- regras para lista de espera, aprovações e cancelamentos;
- modelo de persistência local em IndexedDB;
- schema do banco remoto para dados administrativos e públicos;
- estrutura de auditoria para alterações de resultados e chaves.

Critérios de conclusão:

- os dados principais existem em ambiente local e remoto;
- os relacionamentos entre entidades estão definidos;
- há suporte inicial para histórico de correções e conflitos.

---

### Fase 2 — Autenticação, gestão de torneios e administração básica

Objetivo: entregar o núcleo administrativo do sistema.

Entregas:

- login administrativo e gestão de sessão;
- criação, edição e consulta de torneios;
- configuração de identidade visual, local e dados públicos;
- cadastro e edição de categorias;
- cadastro de atletas e montagem de duplas;
- inscrições por categoria com aprovação e lista de espera;
- cadastro de quadras.

Critérios de conclusão:

- o organizador consegue autenticar e operar o torneio em um único fluxo principal;
- as categorias e inscrições podem ser geridas sem internet;
- os dados sensíveis e públicos ficam separados conforme a política de visibilidade.

---

### Fase 3 — Chaves, agenda e regras esportivas

Objetivo: implementar os principais motores de competição.

Entregas:

- suporte a eliminação simples;
- suporte a fase de grupos seguida de eliminatórias;
- geração de chaves por sorteio aleatório;
- ajustes manuais de chaveamento;
- validação de quantidade de duplas e viabilidade do formato;
- programação automática com ajuste manual de horário e quadra;
- prevenção de sobreposição de partidas da mesma dupla;
- check-in de atletas e da dupla.

Critérios de conclusão:

- o sistema gera uma chave válida para os formatos suportados;
- a agenda considera conflitos e reservas mínimas;
- o administrador consegue ajustar manualmente chaves e horários sem quebrar a consistência do torneio.

---

### Fase 4 — Resultados, classificação e pódio

Objetivo: transformar o torneio em um ambiente competitivo funcional e consistente.

Entregas:

- registro de resultado normal, W.O., abandono e pendente;
- validação de partida e participantes antes do registro;
- mecanismo de correção com justificativa;
- auditoria do valor anterior e do novo valor;
- cálculo automático de classificação e pódio;
- alerta e bloqueio de inconsistências em chaves ou resultados dependentes;
- suporte a desempates e critérios configuráveis por categoria.

Critérios de conclusão:

- resultados e classificação recalculam corretamente;
- alterações no placar deixam histórico explícito;
- a classificação final é derivada das partidas e não editada manualmente.

---

### Fase 5 — Sincronização offline/online e robustez

Objetivo: garantir confiabilidade em operação real durante o evento.

Entregas:

- fila de operações pendentes;
- identificadores estáveis para entidades e operações;
- sincronização idempotente com retry;
- tratamento de conflitos e sinalização para intervenção manual;
- estados visíveis de conexão, sync e pendências;
- preservação de dados locais até confirmação do servidor;
- mecanismo de recuperação e restauração local.

Critérios de conclusão:

- alterações feitas offline continuam disponíveis após recarga da aplicação;
- sincronização com reconexão não duplica operações;
- falhas de rede não borram dados locais nem marcam operação como concluída sem confirmação.

---

### Fase 6 — Publicação pública, relatórios e exportação

Objetivo: entregar a camada de consulta pública e os relatórios do torneio.

Entregas:

- página pública somente leitura por torneio;
- filtros de visibilidade para dados pessoais e administrativos;
- listagem de categorias, duplas, chaves, partidas e resultados;
- publicação de classificação e pódio;
- geração de PDF e CSV para inscritos, programação e resultados;
- exportação local funcional sem internet quando dados estiverem disponíveis localmente.

Critérios de conclusão:

- a página pública expõe apenas dados autorizados;
- o administrador consegue exportar os relatórios principais;
- a versão pública reflete apenas dados sincronizados e confirmados.

---

### Fase 7 — Testes, validação e hardening

Objetivo: garantir estabilidade do MVP antes da utilização em torneios reais.

Entregas:

- testes automatizados para regras esportivas, classificação e chaveamento;
- testes de sincronização offline/online e idempotência;
- testes de persistência local e recarga da aplicação;
- validação de estados do torneio e transições críticas;
- testes de UX para ações frequentes do organizador;
- revisão de privacidade e tratamento de dados sensíveis.

Critérios de conclusão:

- os fluxos críticos possuem testes automatizados;
- o sistema consegue operar em cenários de falha de rede e recarga;
- a aplicação está pronta para uso em evento real em condições controladas.

---

### Fase 8 — Release do MVP

Objetivo: disponibilizar a entrega inicial em ambiente controlado.

Entregas:

- versão estável do sistema para uso do organizador;
- documentação operacional mínima;
- checklist de preparação para evento;
- procedimento para exportação e restauração de dados;
- acompanhamento inicial de uso e ajustes com base em feedback real.

Critérios de conclusão:

- o organizador consegue executar as operações centrais de um torneio sem depender de planilhas externas;
- a solução foi validada conforme critérios de aceitação do PRD;
- a arquitetura e a operação permanecem alinhadas ao escopo do MVP.

## Marcos principais

### Marco 1 — Núcleo administrativo funcional

Entrega mínima com:

- login;
- cadastro de torneio, categorias, atletas e duplas;
- inscrições e listas de espera;
- geração de chaves e agenda básica.

### Marco 2 — Competição operacional

Entrega com:

- resultados;
- classificação;
- pódio;
- correções com histórico;
- operação local estável.

### Marco 3 — MVP completo

Entrega com:

- sincronização;
- página pública;
- exportação;
- testes e validação para uso real.

## Itens fora do roadmap do MVP

Os seguintes itens ficam fora do escopo inicial e podem ser considerados como evoluções futuras:

- aplicativo nativo para iOS/Android;
- operação simultânea offline em vários dispositivos;
- sincronização multi-dispositivo em tempo real;
- inscrição pública autônoma;
- pagamentos e conciliação financeira;
- arbitragens e módulos de audiência;
- circuitos, temporadas e rankings acumulados;
- integração com federações externas.

## Conclusão

O roadmap foi estruturado para entregar primeiro o que é crítico para o evento: administração local, integridade das regras esportivas, sincronização segura e publicação pública controlada. A sequência prioriza estabilidade, confiabilidade e reduzir risco antes de expandir o sistema para futuras evoluções.
