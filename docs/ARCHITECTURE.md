# Arquitetura do Sistema de Gerenciamento de Torneios de Futevôlei

## 1. Visão geral

Esta arquitetura foi definida a partir do PRD e foi estruturada para atender ao MVP do sistema de organização de torneios de futevôlei, priorizando operação administrativa local e resiliente, com sincronização posterior quando a conexão estiver disponível.

O produto é composto por:

- uma interface administrativa web responsiva, instalada como PWA para uso em um único dispositivo durante o evento;
- persistência local no navegador, para permitir continuidade offline;
- uma API backend para autenticação, gestão de torneios e sincronização;
- um banco de dados remoto para armazenar o estado autorizado e publicado;
- uma página pública somente leitura, alimentada por dados já sincronizados no servidor.

A arquitetura busca separar claramente:

- interface de usuário;
- regras de negócio;
- persistência local;
- sincronização;
- publicação pública;
- exportações e relatórios.


## 2. Objetivos arquiteturais

### 2.1 Objetivos principais

- permitir que o organizador execute as operações críticas sem internet em um único dispositivo;
- preservar alterações locais até que a sincronização seja confirmada;
- manter consistência de resultados, classificação e avanço de chaves;
- manter a área pública somente leitura e sem expor dados administrativos;
- minimizar risco de perda de dados em desconexões e falhas de rede;
- facilitar manutenção e testes das regras esportivas e de sincronização.

### 2.2 Restrições do MVP

- operação offline em um único dispositivo;
- não há múltiplos administradores trabalhando simultaneamente no mesmo torneio;
- a página pública não reflete alterações que existam apenas no cliente offline;
- o sistema não cobre pagamentos, inscrições públicas autônomas nem ranking global entre torneios.


## 3. Principais princípios da arquitetura

1. Local-first para a administração
   - O processo principal ocorre no cliente local.
   - A aplicação deve funcionar sem internet após a primeira preparação.

2. Estado de sincronização explícito
   - O sistema deve informar claramente se está online, offline, sincronizando ou com pendências.
   - Alterações locais não podem ser descartadas sem confirmação do servidor.

3. Integridade antes de conveniência
   - Resultados e classificação devem ser recalculados de forma consistente.
   - Alterações em chaves, resultados e regras precisam gerar avisos e registrar histórico quando relevantes.

4. Separação de responsabilidades
   - UI não decide regras de negócio e nem manipula diretamente o armazenamento crítico.
   - Regras de pontuação, classificação, avanço de chave, validações e sincronização ficam em camadas específicas.

5. Privacidade por padrão
   - Dados pessoais sensíveis devem ser minimizados e ocultados na página pública.
   - A exposição pública deve ser controlada por configuração do torneio.


## 4. Visão de alto nível

A proposta inicial de arquitetura é a seguinte:

```text
┌──────────────────────────────────────────────────────────────────────┐
│                     Interface administrativa (PWA)                    │
│  - Login e sessão                                                    │
│  - Torneios, atletas, duplas, categorias                            │
│  - Chaves, agenda, partidas, resultados                              │
│  - Relatórios, exportação, publicação                                 │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
                                │ local-first access
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    Camada de persistência local                      │
│  - IndexedDB / armazenamento estruturado local                      │
│  - Estado do torneio, filas de sincronização, caches                  │
│  - Registro de alterações pendentes                                  │
│  - Exportação e restauração local                                     │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
                                │ sincronização por fila e conflitos
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│                        Camada de sincronização                         │
│  - fila de operações pendentes                                       │
│  - idempotência por ID estável                                       │
│  - retry e tratamento de erros                                       │
│  - merge e detecção de conflitos                                     │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│                         Backend / API do sistema                     │
│  - autenticação e autorização                                         │
│  - gestão de torneios, categorias, inscrições                        │
│  - regras de negócio e validações                                    │
│  - publicação e dados públicos                                        │
│  - endpoints de sincronização e exportação                            │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    Banco de dados remoto / servidor                   │
│  - torneios, atletas, duplas, partidas, resultados                   │
│  - logs de sincronização, conflitos e auditoria                      │
│  - snapshot dos dados públicos                                        │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     Página pública de consulta                        │
│  - leitura apenas                                                    │
│  - dados publicados e sincronizados                                  │
│  - categorias, chaves, programação e resultados                      │
└──────────────────────────────────────────────────────────────────────┘
```


## 5. Componentes arquiteturais

### 5.1 Frontend administrativo (PWA)

A interface administrativa deve ser responsiva e orientada a uso rápido durante o evento. Ela deve funcionar como:

- SPA ou app web progressivo;
- instalada em navegador local;
- preparada para cache, armazenamento local e uso offline;
- acessível em português brasileiro, com foco em ações frequentes como consultar programação, registrar placar e localizar duplas.

Objetivos da camada:

- autenticar o administrador;
- carregar e editar torneios, categorias, quadras e inscrições;
- permitir geração e ajuste de chaves;
- programar partidas;
- registrar resultados e correções;
- consultar classificação e pódio;
- exportar relatórios em PDF e CSV;
- indicar os estados de conexão e sincronização.

Em termos de organização interna, a UI deve separar módulos por domínio:

- torneios;
- categorias;
- atletas e duplas;
- inscrições;
- quadras;
- chaveamento;
- agenda;
- resultados;
- classificação;
- publicação;
- sincronização;
- relatórios.

### 5.2 Persistência local

A persistência local deve funcionar como o sistema de verdade primária enquanto a aplicação estiver offline. O armazenamento estruturado deve guardar:

- dados do torneio em andamento;
- atletas, duplas e categorias;
- inscrições e listas de espera;
- chaves, partidas, horários e resultados;
- configurações de regras esportivas e identidade visual;
- fila de operações pendentes de sincronização;
- histórico de correções e auditoria;
- snapshots locais de exportação e restauração.

A recomendação inicial do PRD é IndexedDB, por ser adequado para dados estruturados e operar bem em navegador. Esta camada deve ser tratada como persistência confiável do cliente, não como armazenamento temporário descartável.

### 5.3 Backend e API

O backend deve expor serviços para:

- autenticação do organizador;
- criação e edição de torneios;
- cadastro e revisão de atletas, duplas, categorias e quadras;
- inscrição, aprovação e lista de espera;
- criação e ajuste de chaves;
- programação de partidas;
- registro de resultados e correções;
- cálculo de classificação e pódio;
- publicação pública;
- exportação de relatórios;
- sincronização de operações locais pendentes;
- consulta de versão pública e metadados de sincronização.

No nível de API, o sistema deve tratar as operações como transações de negócio e não como simples writes diretos no banco. Isso garante que regras como sobreposição de partidas, validação de participantes, status de torneio e cálculos de classificação sejam aplicados de forma consistente.

### 5.4 Banco de dados remoto

O PRD indica que existe um banco de dados hospedado para autenticação, sincronização e publicação pública. O modelo recomendado é manter um banco relacional robusto, como PostgreSQL, e um backend que orquestre leitura, escrita e sincronização.

A base remota deve armazenar:

- entidades principais do domínio;
- histórico e auditoria de mudanças;
- filas e resultados de sincronização;
- estado de publicação e snapshots públicos;
- metadados de conflito, retriadas e backups.

A escolha exata do banco e do provedor pode ser confirmada durante a implementação, mas a arquitetura deve assumir um banco persistente com validações no servidor.

### 5.5 Página pública

A página pública é uma visualização somente leitura do torneio, alimentada por dados já sincronizados com o servidor. Ela deve expor:

- nome, local, datas e descrição;
- categorias;
- duplas participantes;
- chaves, confrontos e programação por quadra/horário;
- resultados e classificação;
- pódio;
- identidade visual do torneio.

A camada pública deve:

- receber dados do backend de forma controlada;
- ocultar ou filtrar dados pessoais sensíveis;
- nunca aceitar entradas administrativas;
- nunca refletir alterações que existem apenas no dispositivo offline.


## 6. Modelo de domínio

A arquitetura deve seguir um modelo estruturado de domínio, com entidades claramente separadas por responsabilidade.

### 6.1 Torneio

Representa o evento principal. Possui:

- identificador único;
- nome e organização responsável;
- período, local e cidade;
- descrição e dados públicos;
- logotipo e identidade visual;
- estado do torneio (rascunho, aberto, encerrado);
- configurações de publicação e sincronização.

### 6.2 Categoria

Cada categoria deve estar vinculada a um torneio e conter:

- nome e descrição;
- regras esportivas;
- formato de competição;
- número máximo de duplas, quando houver;
- critérios de classificação e desempate;
- lista de espera e opções de publicação.

### 6.3 Atleta e dupla

- atleta: nome principal, dados opcionais e perfil mínimo necessário;
- dupla: associação de dois atletas, vínculo com categoria e torneio;
- status de check-in, inscrição e aprovação.

### 6.4 Inscrição

Cada inscrição deve manter a relação entre:

- torneio;
- categoria;
- dupla;
- status (pendente, aprovada, cancelada, lista de espera);
- metadados de criação, alteração e aprovação.

### 6.5 Quadra e agenda

- quadra: identificação física, nome e capacidade de uso;
- partida: dois participantes, horário, quadra, fase, round, status e resultado;
- agenda: distribuição automática e manual de partidas por quadra e horário.

### 6.6 Chave e formato

O sistema deve suportar:

- eliminação simples;
- fase de grupos seguida de eliminatórias.

Cada chave deve manter:

- participantes;
- fase atual;
- estrutura de partidas;
- histórico de alterações relevantes;
- regras para avanço de participantes.

### 6.7 Resultados e classificação

Representam o estado competitivo da categoria. Devem estar associados a:

- partida;
- tipo de resultado (normal, W.O., abandono, pendente);
- placar ou conjunto de pontos;
- justificativa para correção;
- eventos de alteração com auditoria.

A classificação deve ser calculada, não editada manualmente, a partir das regras e dos resultados.

### 6.8 Sincronização e auditoria

A arquitetura precisa de entidades específicas para:

- operações pendentes;
- registros de sincronização;
- conflitos detectados;
- identificação estável de entidades e operações;
- histórico de alterações críticas.

Essas estruturas são essenciais para garantir idempotência e recuperação em caso de falha.


## 7. Fluxos de negócio principais

### 7.1 Configuração do torneio

1. Administrador acessa o sistema e realiza login.
2. Cria ou edita o torneio.
3. Define identidade visual, local, datas, categoria e regras.
4. Cadastra quadras e configura regras de publicação.
5. Salva em estado de rascunho ou em andamento.

### 7.2 Cadastro e inscrição

1. Administrador cadastra atletas e monta duplas.
2. Registra inscrições por categoria.
3. Aprova ou rejeita as duplas.
4. Administração da lista de espera ocorre conforme regra explícita.

### 7.3 Geração de chave e programação

1. Sistema gera chave com base em formato selecionado.
2. Administrador revisa e ajusta participantes.
3. Sistema valida conflitos e excesso de partidas simultâneas.
4. A agenda é proposta automaticamente e pode ser reprogramada manualmente.

### 7.4 Registro de resultados

1. Administrador registra placar, W.O. ou abandono.
2. Sistema valida a partida e os participantes.
3. Regras de pontuação, classificação e avanço de chave são recalculadas.
4. Corrigindo resultados, o sistema registra justificativa e preserva o histórico anterior.

### 7.5 Publicação pública

1. O administrador publica ou atualiza os dados do torneio.
2. O servidor sincroniza os dados públicos.
3. A página pública exibe somente dados liberados para divulgação.
4. Alterações locais não sincronizadas não aparecem na página pública do cliente.

### 7.6 Sincronização offline/online

1. Quando a internet cai, a UI continua funcionando com os dados locais.
2. Alterações são persistidas localmente antes de confirmar sucesso ao usuário.
3. Ao voltar a conexão, a fila de sincronização é enviada em ordem controlada.
4. O backend valida, aplica e responde com status de confirmação ou conflito.
5. O sistema mantém a cópia local em estado seguro até que o servidor confirme.


## 8. Arquitetura de sincronização

A camada de sincronização é crítica para o MVP. A recomendação é seguir um modelo local-first com fila de operações.

### 8.1 Modelo de funcionamento

- Cada mudança relevante recebe um identificador estável.
- As operações são registradas em uma fila local antes da confirmação visual.
- As operações são enviadas ao backend quando houver conexão.
- O backend valida e aplica as operações com idempotência.
- Se a operação falhar por motivo recuperável, ela permanece pendente e é tentada novamente.
- Se houver conflito, o sistema preserva a versão local e a versão remota e sinaliza a intervenção necessária.

### 8.2 Regras importantes

- não duplicar operações ao reenviar;
- manter IDs estáveis de torneios, categorias, atletas, duplas e partidas;
- registrar resultado de cada tentativa de sincronização;
- não sobrescrever silenciosamente dados locais por dados remotos;
- garantir que conflitos sejam visíveis para o administrador;
- permitir recuperação de versões anteriores ou snapshot local.

### 8.3 Estados da sincronização

A aplicação deve expor e tratar estados como:

- online;
- offline;
- sincronizando;
- sincronização pendente;
- conflito;
- falha recuperável;
- sincronização concluída.

Essa visibilidade é importante para aumentar a confiança do organizador durante o evento.


## 9. Segurança e privacidade

### 9.1 Autenticação

- login para a área administrativa;
- sessão com expiração segura após inatividade;
- proteção da área administrativa por autenticação e autorização;
- senha armazenada em hash adequado, nunca em texto puro.

### 9.2 Proteções de rede

- uso de HTTPS quando hospedado;
- comunicação protegida entre browser e backend;
- validação de entrada no servidor e no cliente.

### 9.3 Privacidade

- dados sensíveis como telefone e data de nascimento devem permanecer fora da publicação pública por padrão;
- a página pública deve expor apenas informações necessárias para consulta;
- configurações de visibilidade devem ser explícitas e auditáveis;
- a implementação deve prever correção, exclusão ou anonimização em casos cabíveis.

### 9.4 Dados administrativos

A página pública não deve receber nenhum dado de gestão interna ou dados administrativos que não sejam oficialmente autorizados para divulgação.


## 10. Não funcionais e qualidade

### 10.1 Usabilidade

- interface em português brasileiro;
- foco em ações rápidas e frequentes;
- uso em navegadores e dispositivos responsivos;
- informações relevantes visíveis sem depender exclusivamente de cores.

### 10.2 Localização

- idioma em português do Brasil;
- datas em DD/MM/AAAA;
- fuso horário `America/Sao_Paulo`;
- filtros e números compatíveis com padrão brasileiro.

### 10.3 Integridade e consistência

- regras de pontuação e classificação devem ter automação de testes;
- avanço de chaves e resultados precisam ser validados em cenários de recálculo;
- restauração de dados e importação devem ser testadas em ambiente de falha.

### 10.4 Manutenibilidade

- camada de UI separada da lógica de negócio;
- regras esportivas em serviços ou módulos específicos;
- persistência local separada da API remota;
- sincronização isolada de outros fluxos de negócio.

### 10.5 Desempenho

- o sistema deve continuar responsivo para torneios com dezenas ou centenas de duplas;
- a lógica de classificação e agendamento deve ser eficiente e testada;
- a aplicação deve evitar sobrecarregar a interface com dados desnecessários.


## 11. Recomendação de implementação inicial

A arquitetura recomendada para o MVP é:

- frontend web responsivo em PWA;
- persistência local em IndexedDB;
- backend API com autenticação e sincronização;
- banco de dados remoto relacional;
- camada de sincronização com fila de operações;
- página pública servida a partir do banco remoto sincronizado;
- exportação local e em servidor em PDF/CSV.

A tecnologia exata de frontend e backend pode ser confirmada durante a implementação, mas a estrutura arquitetural acima deve ser mantida como base para evitar que a solução se torne incompatível com os requisitos do PRD.


## 12. Pontos de atenção e riscos

- escolha final do framework e banco remoto;
- necessidade de tratar conflitos de sincronização com clareza;
- impacto de alterações em chave após partidas existentes;
- volume de dados e performance em torneios maiores;
- necessidade de revisão legal e de privacidade antes do uso em produção;
- necessidade de testar a operação offline de forma realista em navegador.


## 13. Conclusão

A arquitetura proposta mantém o foco no que o PRD exige: um sistema administrativo local-first, confiável durante o evento, com sincronização segura, regras esportivas robustas e página pública somente leitura. A estrutura separa UI, persistência local, lógica de negócio, sincronização e publicação pública, o que reduz riscos de inconsistência e facilita manutenção e evolução futura.
