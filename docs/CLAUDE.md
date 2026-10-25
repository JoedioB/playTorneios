# CLAUDE.md

## Visão geral do projeto

Este repositório implementa um sistema de gerenciamento de torneios de futevôlei para organização local, com foco em operação administrativa em um único dispositivo durante o evento, priorizando trabalho offline, consistência de dados e sincronização segura quando a conexão voltar.

O produto foi definido com base no PRD, na arquitetura e nas decisões de implementação. O escopo atual é o MVP e deve seguir as prioridades e limites documentados nesses arquivos.

## Objetivo do produto

O sistema deve permitir que um organizador:

- cadastre e gerencie torneios;
- configure categorias, regras esportivas e quadras;
- gerencie atletas, duplas e inscrições;
- gere chaves e agenda de partidas;
- registre resultados, W.O. e abandonos;
- calcule classificação e pódio;
- publique uma página pública somente leitura;
- exporte relatórios em PDF e CSV;
- continue operando sem internet em um dispositivo durante o evento.

## Escopo do MVP

### Incluído

- login administrativo e sessão segura;
- criação e edição de torneios;
- cadastro de atletas, duplas e inscrições;
- categorias com regras e limites configuráveis;
- geração e ajuste manual de chaves;
- formatos suportados: eliminação simples e grupos + eliminatórias;
- programação de partidas por quadra e horário;
- check-in de atletas e duplas;
- registro de resultados e correções;
- cálculo de classificação e pódio;
- página pública de consulta;
- operação offline em um único dispositivo;
- sincronização de alterações pendentes quando voltar a conexão;
- exportação em PDF e CSV;
- identidade visual do torneio;
- proteção mínima de dados e privacidade.

### Fora do escopo do MVP

- aplicativo nativo para iOS/Android;
- operação offline em vários dispositivos simultaneamente;
- sincronização multi-dispositivo em tempo real;
- inscrição pública autônoma;
- pagamentos e conciliação financeira;
- módulo de arbitragem separado;
- notificações por SMS, WhatsApp ou e-mail;
- ranking acumulado entre torneios;
- integrações com federações ou plataformas externas;
- estatísticas avançadas de desempenho;
- eliminação dupla como formato nativo inicial;
- regras excepcionais específicas de regulamentos externos.

## Regras centrais do negócio

1. Uma inscrição pertence a um torneio, uma categoria e uma dupla.
2. O organizador é responsável por cadastrar e aprovar inscrições.
3. Uma categoria pode ter limite de vagas definido ou não.
4. A lista de espera é opcional e não promove duplas automaticamente sem regra explícita.
5. Uma dupla não pode estar programada em duas partidas sobrepostas.
6. Uma partida só pode avançar quando seu resultado estiver definido.
7. W.O. e abandono são tipos de resultado distintos, não placares indistinguíveis.
8. Correções de resultado exigem justificativa e preservação do histórico anterior.
9. Alterações de chave que afetam resultados existentes devem ser explicadas antes da confirmação.
10. A classificação é derivada das partidas e regras configuradas; não deve ser editada manualmente.
11. Encerramento exige confirmação e alerta de partidas pendentes.
12. Dados locais não sincronizados não devem ser descartados por falha de conexão.
13. A página pública não oferece operações de escrita.
14. O sistema não trata pagamentos no MVP.
15. Configurações padrão de regras esportivas devem ser explicitamente identificadas como padrão do sistema.

## Requisitos funcionais e não funcionais que devem guiar a implementação

### Principais requisitos funcionais

- autenticação para área administrativa;
- cadastro e gerenciamento de torneios;
- cadastro de atletas, duplas e inscrições;
- aprovação/cancelamento e lista de espera;
- cadastro de quadras;
- geração e ajuste manual de chaves;
- formatos de competição definidos por categoria;
- programação automática com ajuste manual;
- check-in;
- registro de resultados, W.O., abandono e pendência;
- classificação recalculada automaticamente;
- página pública de consulta;
- exportação em PDF e CSV;
- identidade visual do torneio;
- operação offline e sincronização.

### Requisitos não funcionais

- interface responsiva e rápida em português brasileiro;
- datas em DD/MM/AAAA e fuso `America/Sao_Paulo`;
- integridade de resultados, classificação e chaveamentos;
- segurança de login, sessão e dados sensíveis;
- operação administrativa funcional sem internet após preparação inicial;
- manutenção e testabilidade das regras de negócio;
- desempenho adequado para dezenas ou centenas de duplas;
- acessibilidade com foco, contraste e mensagens claras.

## Arquitetura principal

### Visão arquitetural

A solução será organizada em camadas:

1. Frontend administrativo (PWA)
   - interface responsiva para uso em um único dispositivo;
   - foco em ações frequentes do torneio;
   - operação local-first.

2. Persistência local
   - armazenamento estruturado em IndexedDB;
   - dados do torneio, inscrições, chaves, partidas, resultados e fila de sincronização;
   - preservação de itens pendentes até confirmação do servidor.

3. Camada de sincronização
   - fila de operações pendentes;
   - idempotência;
   - retry e tratamento de conflitos;
   - estado explícito de online/offline/sincronizando/pendente.

4. Backend/API
   - autenticação e autorização;
   - gestão dos dados do torneio;
   - regras de negócio, validações e publicação pública;
   - endpoints de sincronização e exportação.

5. Banco de dados remoto
   - modelo relacional para dados administrativos e públicos;
   - auditoria e conflitos;
   - armazenamento de snapshots públicos e metadados de sincronização.

6. Página pública
   - somente leitura;
   - dados publicados e sincronizados;
   - sem acesso administrativo ou ações de escrita.

## Decisões de arquitetura que devem ser respeitadas

- operação administrativa offline em um único dispositivo é obrigatório;
- o frontend administrativo será PWA;
- IndexedDB é a persistência local recomendada;
- o backend remoto será responsável por autenticação, validação e sincronização;
- o banco remoto deve ser relacional e robusto;
- sincronização deve ser explícita, idempotente e segura;
- dados públicos devem ser separados dos dados administrativos;
- regras esportivas devem estar em módulos de domínio e ter testes;
- alteração de resultado exige histórico e justificativa;
- privacidade deve ser por padrão;
- exportação local e remota devem funcionar no MVP.

## Roadmap do MVP

### Fase 0 — Fundação

- definir stack e convenções;
- modelar entidades e estados fundamentais;
- confirmar persistência local e backend.

### Fase 1 — Domínio e persistência

- criar modelo de torneios, categorias, atletas, duplas, inscrições e partidas;
- definir schema local e remoto;
- preparar auditoria e registro de conflitos.

### Fase 2 — Administração básica

- login e sessão;
- criar/editar torneios;
- cadastrar categorias, atletas, duplas e quadras;
- inscrições com aprovação e lista de espera.

### Fase 3 — Chaves e agenda

- suportar formatos de competição definidos;
- geração de chaves e ajustes manuais;
- agenda de partidas e validação de conflitos;
- check-in.

### Fase 4 — Resultados e classificação

- registrar resultados, W.O., abandono e pendência;
- recalcular classificação e pódio;
- manter histórico de correções.

### Fase 5 — Sincronização e resiliência

- fila de operações pendentes;
- retries, conflitos e estados de sincronização;
- preservação de dados locais até confirmação do servidor.

### Fase 6 — Publicação e relatórios

- página pública de consulta;
- exportação em PDF e CSV;
- dados publicados e visibilidade controlada.

### Fase 7 — Validação e hardening

- testes automatizados para regras esportivas e sincronização;
- validação offline;
- revisão final de privacidade, segurança e estabilidade.

### Fase 8 — Release do MVP

- versão estável;
- documentação operacional mínima;
- preparação para evento real;
- exportação e restauração de dados.

## Diretrizes para implementação e manutenção

- manter a lógica de negócio separada da interface; não deixar regras de competição espalhadas na UI;
- tratar o estado local como fonte primária enquanto o cliente estiver offline;
- nunca descartar dados locais pendentes sem confirmação do servidor;
- evitar sobrescrever dados locais por versões remotas sem sinalizar conflito;
- recalcule classificação e avanço de chave sempre que houver mudança relevante;
- exigir justificativa e histórico em correções de resultados;
- nunca expor dados administrativos na página pública;
- priorizar qualidade de UX e rapidez para ações durante o evento;
- manter testes automatizados para as regras críticas: pontuação, classificação, avanço de chave e sincronização.

## Critérios de aceitação do MVP

O sistema deve atender aos seguintes critérios antes de ser considerado entregue:

1. administrador consegue autenticar e criar um torneio;
2. é possível cadastrar quadras, categorias, atletas, duplas e inscrições;
3. limite de vagas e lista de espera podem ser configurados;
4. chaveamento é gerado e pode ser ajustado manualmente;
5. programação respeita quadras e sobreposição de duplas;
6. resultados e W.O./abandono podem ser registrados;
7. correção de placar exige justificativa e preserva o histórico anterior;
8. classificação e pódio são recalculados corretamente;
9. encerramento do torneio exige confirmação e alerta de partidas pendentes;
10. página pública expõe apenas dados autorizados;
11. administração continua funcionando offline após preparação inicial;
12. dados locais permanecem disponíveis após recarga;
13. sincronização não cria duplicidades e não apaga dados locais;
14. exportação em PDF e CSV funciona conforme necessário;
15. estado da conexão e da sincronização é claro para o usuário;
16. fluxos críticos possuem testes automatizados.

## Observações finais

Este projeto deve ser entregue com foco em confiabilidade e simplicidade. O MVP não busca resolver todos os cenários de torneios do mercado, mas sim cumprir com precisão o que o PRD exige para operação local, competitiva e segura em um evento real.

Ao implementar, sempre priorizar:

- consistência sobre velocidade improvisada;
- confiabilidade offline sobre conveniência online;
- dados seguros e minimizados sobre exposição ampla;
- evolução incremental sem expansão indevida do escopo.
