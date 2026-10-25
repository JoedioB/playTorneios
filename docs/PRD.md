# PRD --- Sistema de Gerenciamento de Torneios de Futevôlei

**Versão:** 1.0 --- proposta inicial para o MVP\
**Status:** Pronto para orientar a implementação, com decisões padrão
explicitadas\
**Idioma:** Português brasileiro\
**Público-alvo inicial:** Organização de torneios locais de futevôlei\
**Plataforma:** Aplicação web responsiva, com operação administrativa
offline em um dispositivo

------------------------------------------------------------------------

## 1. Resumo do produto

O sistema permitirá que um organizador configure e gerencie torneios
locais de futevôlei, desde o cadastro das categorias e duplas até o
sorteio das chaves, programação das partidas, registro de resultados,
classificação final e publicação das informações para consulta pública.

O sistema será inicialmente utilizado pela própria organização, mas
deverá ser estruturado para permitir que outras organizações possam
utilizá-lo futuramente. A primeira versão não terá cadastro público de
duplas nem processamento de pagamentos.

Um requisito central é a operação administrativa offline em um único
dispositivo. Os dados deverão ser gravados localmente durante a falta de
internet e sincronizados automaticamente quando a conexão voltar. A
página pública não será atualizada em tempo real enquanto o dispositivo
estiver offline.

## 2. Problema e objetivos

### 2.1 Problema

A organização de torneios envolve controlar inscrições, categorias,
quadras, confrontos, horários, resultados e classificação. Quando esses
controles ficam dispersos em planilhas ou anotações, aumentam os riscos
de conflitos de horários, erros de classificação e divulgação de
informações desatualizadas.

### 2.2 Objetivos do MVP

1.  Centralizar o gerenciamento de um torneio em uma única aplicação.
2.  Cadastrar atletas e duplas e administrar as inscrições por
    categoria.
3.  Gerar e ajustar chaves de competição.
4.  Programar partidas em múltiplas quadras.
5.  Registrar, corrigir e consultar resultados.
6.  Calcular a classificação e o pódio conforme as regras configuradas.
7.  Disponibilizar uma página pública de consulta.
8.  Permitir que todas as operações administrativas essenciais continuem
    funcionando sem internet em um dispositivo.
9.  Exportar relatórios em PDF e CSV compatível com Excel.
10. Manter o produto simples de operar e de manter, com custo inicial
    baixo.

### 2.3 Indicadores de sucesso

-   Um organizador consegue configurar e conduzir um torneio sem
    depender de planilhas externas para as funções centrais.
-   O sistema impede a programação simultânea de uma mesma dupla em
    partidas diferentes.
-   A classificação é recalculada após a alteração de resultados
    relevantes.
-   Alterações feitas offline são preservadas e sincronizadas quando a
    conexão retorna.
-   É possível exportar resultados e classificação por categoria.
-   A página pública apresenta os dados publicados mais recentemente
    disponíveis no servidor.

## 3. Público e perfis de acesso

### 3.1 Organizador/administrador

No MVP haverá um único perfil administrativo, protegido por login. Esse
perfil poderá realizar todas as operações: configurar torneios,
gerenciar atletas e duplas, criar categorias, gerar chaves, programar
partidas, registrar resultados, exportar relatórios e encerrar ou
reabrir torneios.

### 3.2 Público

Qualquer pessoa poderá consultar a página pública do torneio sem criar
conta. O público não poderá editar dados, inscrever duplas nem registrar
resultados.

### 3.3 Evolução futura

O modelo de dados deverá evitar dependência desnecessária de uma única
organização, para permitir suporte futuro a múltiplos organizadores.
Controle avançado de permissões, contas de atletas, inscrição pública e
pagamentos não fazem parte do MVP.

## 4. Escopo

### 4.1 Incluído no MVP

-   Login administrativo e gerenciamento de sessão.
-   Cadastro e edição de torneios.
-   Configuração de categorias e regras esportivas.
-   Cadastro de atletas e duplas pelo organizador.
-   Aprovação, cancelamento e lista de espera para inscrições.
-   Cadastro e identificação de múltiplas quadras.
-   Sorteio aleatório e ajuste manual das chaves.
-   Formatos de eliminação simples e grupos seguidos de eliminatórias.
-   Programação automática ajustável de partidas.
-   Check-in de atletas e duplas.
-   Registro de resultados, W.O. e abandono.
-   Cálculo de classificação e pódio.
-   Página pública de consulta.
-   Operação administrativa offline em um dispositivo e sincronização
    automática.
-   Exportação de relatórios em PDF e CSV.
-   Configuração de nome, logotipo e cores da organização ou torneio.
-   Tratamento básico de privacidade conforme a LGPD.

### 4.2 Fora do MVP

-   Aplicativo nativo para iOS ou Android.
-   Operação offline simultânea em vários dispositivos.
-   Sincronização entre múltiplos dispositivos durante o evento.
-   Inscrição pública autônoma.
-   Pagamento online, conciliação financeira ou controle de caixa.
-   Módulo de arbitragem separado.
-   Notificações por SMS, WhatsApp ou e-mail.
-   Circuitos, temporadas e ranking acumulado entre torneios.
-   Integrações com federações ou plataformas externas.
-   Estatísticas avançadas de desempenho de atletas.
-   Eliminação dupla como formato nativo inicial.
-   Automação de regras excepcionais específicas de cada regulamento.

## 5. Fluxo principal

1.  O administrador entra no sistema.
2.  Cria um torneio em estado de rascunho.
3.  Configura identidade visual, datas, local, quadras e informações
    públicas.
4.  Cria categorias e define limites, formato, pontuação e critérios de
    desempate.
5.  Cadastra atletas e forma duplas.
6.  Inscreve as duplas nas categorias, aprova as inscrições e administra
    a lista de espera.
7.  Confirma as duplas participantes e realiza o check-in quando
    aplicável.
8.  Gera as chaves e faz ajustes manuais, se necessário.
9.  Gera uma proposta de programação e ajusta quadras e horários.
10. Registra os resultados das partidas, W.O. ou abandono.
11. Consulta a classificação recalculada e exporta relatórios.
12. Confere partidas pendentes e encerra o torneio.
13. Publica/sincroniza as informações para a página pública quando
    houver internet.

## 6. Requisitos funcionais

### RF-01 --- Autenticação

O sistema deve exigir login para acesso às funções administrativas. A
sessão deve expirar de forma segura após um período de inatividade
configurável ou definido pela implementação. A página pública de
consulta não deve exigir login.

### RF-02 --- Cadastro de torneio

O administrador deve poder criar, editar e consultar torneios. Cada
torneio deve conter, no mínimo:

-   Nome.
-   Organização responsável.
-   Data ou período.
-   Cidade e local.
-   Descrição e informações públicas opcionais.
-   Logotipo e cores configuráveis.
-   Estado do torneio.
-   Configurações de publicação.

O sistema deve suportar torneios independentes, sem exigir criação de
temporada ou circuito.

### RF-03 --- Ciclo de vida

O torneio deve ter três estados principais:

-   **Rascunho:** em configuração; não é considerado em andamento.
-   **Aberto/em andamento:** pronto para inscrições e/ou execução,
    conforme a etapa do evento.
-   **Encerrado:** resultados finais confirmados e torneio finalizado.

A implementação poderá manter indicadores internos de etapa --- por
exemplo, inscrições abertas, inscrições encerradas e partidas em
andamento --- sem exigir estados principais adicionais na interface do
MVP.

O encerramento deve exigir confirmação explícita e apresentar alerta se
houver partidas pendentes. O sistema não deve encerrar silenciosamente
um torneio com partidas não resolvidas. O administrador poderá reabrir
um torneio encerrado, mediante confirmação, para correções justificadas.

### RF-04 --- Cadastro de atletas

O administrador deve poder cadastrar e editar atletas com os seguintes
dados:

-   Nome completo (obrigatório).
-   Telefone (obrigatório ou conforme configuração mínima definida na
    implementação).
-   Data de nascimento (quando necessária para elegibilidade por idade).
-   Cidade.

O sistema deve evitar duplicidades óbvias, permitindo localizar atletas
existentes antes de criar novos cadastros. Dados pessoais não
necessários à operação não devem ser coletados.

### RF-05 --- Cadastro de duplas

O administrador deve formar uma dupla selecionando dois atletas
cadastrados. A interface deverá identificar a dupla pelos nomes dos
atletas e, opcionalmente, permitir um nome de exibição para a dupla.

O MVP deve permitir editar a composição da dupla antes do início da
participação na categoria. Se houver partidas iniciadas, a troca de
atleta deverá gerar um aviso e exigir confirmação do administrador. A
substituição não deve alterar silenciosamente resultados já registrados.

### RF-06 --- Categorias

O administrador deve poder criar categorias por torneio. A categoria
deve permitir combinar critérios como:

-   Nível técnico: iniciante, intermediário, avançado ou livre.
-   Gênero/modalidade: masculino, feminino ou misto.
-   Faixa etária, quando aplicável.
-   Nome personalizado para a categoria.

Os critérios devem ser configuráveis, sem exigir que todas as categorias
usem todos os atributos. O sistema deve permitir informar a idade de
referência quando uma categoria tiver restrição etária. As regras
específicas de elegibilidade devem ser exibidas ao administrador e
aplicadas de forma consistente.

### RF-07 --- Inscrições

O cadastro de inscrições será administrativo. O sistema não oferecerá
formulário público de inscrição no MVP.

O administrador deve poder: - Inscrever uma dupla em uma categoria. -
Aprovar ou cancelar uma inscrição. - Definir um limite de vagas por
categoria. - Ativar uma lista de espera opcional. - Promover manualmente
uma dupla da lista de espera para uma vaga disponível. - Consultar
inscrições por categoria e estado.

Não haverá limite máximo fixo imposto pelo produto; o organizador poderá
configurar um limite por categoria ou deixar as vagas sem limite
definido. Pagamentos não serão gerenciados pelo sistema.

### RF-08 --- Quadras

O administrador deve cadastrar e identificar múltiplas quadras por
torneio. Cada partida programada deverá referenciar uma quadra, salvo
enquanto ainda estiver sem programação.

### RF-09 --- Formatos de competição

O MVP deve oferecer: 1. **Eliminação simples.** 2. **Fase de grupos
seguida de eliminatórias.**

O formato deve ser selecionável por categoria. O sistema deve validar se
a quantidade de duplas é suficiente para o formato escolhido e informar
ao organizador quando houver uma configuração inviável. Regras para
quantidade de grupos, classificação por grupo e número de classificados
devem ser configuráveis dentro das opções suportadas pela implementação.

Eliminação dupla e todos-contra-todos como formato independente poderão
ser adicionados após validação do MVP.

### RF-10 --- Sorteio e chaves

O sistema deve gerar chaves automaticamente por sorteio aleatório e
permitir ajustes manuais antes do início das partidas. A implementação
deverá permitir, como opção, definir cabeças de chave ou posições
protegidas.

O sistema deve representar partidas, participantes, avanço de fase e
resultados. Quando uma chave for alterada depois de existirem partidas
ou resultados, deverá apresentar um resumo do impacto antes de aplicar a
mudança.

O recálculo deve preservar resultados válidos quando isso for
logicamente seguro. Se uma alteração tornar um resultado inconsistente,
o sistema deve bloquear a aplicação automática ou pedir confirmação
explícita, explicar quais resultados serão invalidados e manter
histórico suficiente para recuperação. Não deve apagar resultados
silenciosamente.

### RF-11 --- Pontuação e regras esportivas

As regras deverão ser configuráveis por torneio ou categoria. O MVP deve
suportar:

-   Partida decidida por pontuação-alvo.
-   Partida por sets, com quantidade e pontuação configuráveis.
-   Registro do placar por set ou do placar final, conforme o modelo
    selecionado.
-   Critérios de desempate configuráveis e ordenados.
-   Registro manual de W.O. e abandono.

As regras selecionadas devem ser definidas antes do início da categoria
e exibidas ao administrador. Alterar regras após o início deve gerar
aviso de impacto e exigir confirmação.

O sistema não deve presumir que um único regulamento é universal para
todos os torneios. Os valores iniciais e regras padrão devem ser
configurados e documentados na implementação.

### RF-12 --- Agenda automática

O sistema deve propor horários e distribuição das partidas pelas quadras
cadastradas. O administrador deve poder ajustar manualmente horários,
ordem e quadra.

O agendador deve: - Impedir sobreposição de partidas da mesma dupla. -
Avisar sobre conflitos ao mover uma partida. - Considerar um intervalo
mínimo de descanso configurável entre partidas da mesma dupla. -
Permitir partidas ainda sem horário definido. - Permitir reprogramação
manual de partidas atrasadas.

A duração estimada de uma partida poderá ser configurada para auxiliar a
montagem da programação; o sistema não deve apresentar a estimativa como
garantia de horário real.

### RF-13 --- Check-in

O sistema deve permitir marcar presença de cada atleta e da dupla. A
ausência no check-in não deverá bloquear automaticamente a participação;
o administrador decidirá como proceder. O estado do check-in deve ser
visível na lista de inscritos e na operação do torneio.

### RF-14 --- Resultados

Somente o administrador autenticado poderá registrar resultados. O
sistema deve validar que a partida e os participantes estejam em estados
compatíveis com o registro.

O registro deve aceitar: - Resultado normal. - W.O. - Abandono, com
indicação do vencedor quando aplicável. - Partida pendente ou não
realizada.

Ao alterar um resultado já registrado, o sistema deve exigir
justificativa e confirmação. Deve preservar o valor anterior, o novo
valor, a justificativa e a data/hora da correção. A classificação e as
partidas dependentes devem ser recalculadas quando necessário.

### RF-15 --- Classificação e pódio

O sistema deve calcular automaticamente os resultados e a classificação
a partir das partidas registradas, de acordo com o formato e os
critérios de desempate configurados.

A saída final do MVP deve incluir: - Pódio por categoria. -
Classificação final completa quando o formato permitir defini-la. -
Resultados das partidas. - Indicação de W.O. ou abandono quando
aplicável.

Se o formato não permitir determinar uma posição exata para todas as
duplas, o sistema deverá apresentar apenas as posições justificadas
pelos resultados e indicar empates ou posições não determinadas, em vez
de inventar uma ordem.

### RF-16 --- Página pública

O sistema deve disponibilizar uma página pública de consulta para cada
torneio publicado, com: - Nome, data, local e descrição do torneio. -
Categorias. - Duplas participantes, conforme a configuração de
publicação. - Chaves e confrontos. - Programação por horário e quadra. -
Resultados. - Classificação e pódio.

A página pública deve ser somente leitura. O administrador deve poder
ocultar informações pessoais desnecessárias, especialmente telefone e
data de nascimento. O público não deve ter acesso a dados
administrativos privados.

A página pública exibirá a versão mais recente sincronizada com o
servidor. Não haverá atualização pública em tempo real quando o
administrador estiver offline.

### RF-17 --- Relatórios e exportação

O administrador deve poder exportar: - Lista de inscritos por
categoria. - Lista de atletas e duplas. - Chaves e confrontos. -
Programação por quadra e horário. - Resultados e classificação final. -
Pódio por categoria.

O MVP deve gerar PDF e CSV, sendo o CSV compatível com Excel. A
exportação deve indicar o torneio, categoria e data/hora da geração. A
exportação deve funcionar offline quando os dados necessários estiverem
disponíveis localmente.

### RF-18 --- Identidade visual

O administrador deve poder configurar nome, logotipo e cores usados na
página pública e nos relatórios, dentro de limites de apresentação
definidos pelo sistema.

### RF-19 --- Operação offline

Todas as operações administrativas essenciais devem funcionar sem
internet em um único dispositivo, incluindo: - Consultar e editar
torneios e categorias. - Cadastrar atletas, duplas e inscrições. - Gerar
e ajustar chaves. - Programar partidas. - Registrar e corrigir
resultados. - Consultar classificação. - Exportar relatórios.

A aplicação deverá indicar claramente se está online, offline,
sincronizando ou com sincronização pendente. As gravações locais devem
ocorrer antes de confirmar ao usuário que a alteração foi salva.

O MVP não promete operação simultânea offline em múltiplos dispositivos.
O uso administrativo principal deverá ocorrer no mesmo dispositivo
durante o evento.

### RF-20 --- Sincronização

Quando a conexão voltar, o sistema deve sincronizar automaticamente as
alterações locais pendentes com o servidor.

A sincronização deve: - Ser idempotente, evitando duplicação quando uma
operação for reenviada. - Manter identificadores estáveis para entidades
e operações. - Registrar o estado e o resultado de cada tentativa. -
Repetir tentativas após falhas recuperáveis. - Preservar alterações
locais pendentes até haver confirmação do servidor. - Não substituir
silenciosamente dados locais por dados remotos. - Sinalizar e registrar
conflitos ou falhas que exijam intervenção.

Como o MVP terá um único dispositivo administrativo, alterações locais
pendentes terão prioridade no processo de sincronização. Ainda assim, se
o servidor contiver alterações incompatíveis, o sistema deverá preservar
ambas as versões ou uma cópia recuperável e informar o administrador;
não deverá descartar dados automaticamente.

### RF-21 --- Privacidade e proteção de dados

O sistema deve adotar princípios de minimização de dados, acesso
restrito, finalidade clara e proteção contra exposição indevida. A
página pública não deve divulgar telefone, data de nascimento ou outros
dados pessoais sem necessidade e configuração explícita.

A implementação deve prever meios para corrigir dados e excluir ou
anonimizar informações quando cabível, considerando obrigações legais e
a necessidade de preservar registros esportivos. Os textos de
privacidade e a base legal adequada deverão ser revisados pelo
responsável pelo serviço antes da publicação.

### RF-22 --- Backup e recuperação

O MVP deve permitir exportação manual dos dados em formato utilizável
para recuperação, conforme viabilidade técnica. A implementação deve
documentar o procedimento de exportação e restauração. Backup automático
agendado não faz parte do escopo inicial.

## 7. Regras de negócio

1.  Uma inscrição pertence a um torneio, uma categoria e uma dupla.
2.  O organizador é responsável por cadastrar e aprovar inscrições.
3.  Uma categoria pode ter limite de vagas definido ou não ter limite
    configurado.
4.  A lista de espera é opcional e não promove duplas automaticamente
    sem regra explícita.
5.  A mesma dupla não pode estar programada em duas partidas
    sobrepostas.
6.  Uma partida só pode avançar a chave quando seu resultado estiver
    definido conforme o formato.
7.  W.O. e abandono devem ser registrados como tipos de resultado, não
    como placares normais indistinguíveis.
8.  Correções de resultado exigem justificativa e preservação do
    registro anterior.
9.  Alterações de chave que afetem resultados existentes devem ser
    explicadas antes da confirmação.
10. A classificação é derivada das partidas e regras configuradas; não
    deve ser editada manualmente como se fosse um resultado.
11. O encerramento exige confirmação e alerta de partidas pendentes.
12. Dados locais não sincronizados não podem ser descartados por uma
    falha de conexão.
13. A página pública não oferece operações de escrita.
14. O sistema não processa pagamentos no MVP.
15. A configuração padrão das regras esportivas deve ser identificada
    como padrão do sistema, e não como regulamento oficial universal.

## 8. Requisitos não funcionais

### RNF-01 --- Usabilidade

A interface deve ser responsiva, em português brasileiro, e priorizar
uso rápido durante o evento. As ações mais frequentes --- consultar
programação, registrar placar e localizar uma dupla --- devem ser
acessíveis com poucos passos.

### RNF-02 --- Localização

-   Idioma: português brasileiro.
-   Datas: DD/MM/AAAA na interface.
-   Fuso horário: `America/Sao_Paulo`.
-   Valores e formatação: padrões brasileiros quando aplicáveis.

### RNF-03 --- Integridade

Resultados, classificação e avanço de chaves devem permanecer
consistentes após edição, recálculo, falha de rede e sincronização.
Operações críticas devem ser validadas no cliente e no servidor.

### RNF-04 --- Segurança

-   Login para a área administrativa.
-   Senhas armazenadas com algoritmo de hash apropriado, nunca em texto
    puro.
-   Comunicação protegida por HTTPS quando hospedado.
-   Proteção de sessão e expiração apropriada.
-   Validação de entradas e controle de acesso no servidor.
-   Nenhum dado administrativo sensível deve ser enviado à página
    pública.

### RNF-05 --- Disponibilidade offline

A aplicação administrativa deve continuar utilizável sem conexão depois
de ter sido carregada e preparada no dispositivo. A implementação deve
testar a abertura, leitura e gravação offline, inclusive após recarregar
a página quando suportado pelo navegador escolhido.

### RNF-06 --- Manutenibilidade

A arquitetura deve separar interface, regras de negócio, persistência
local e sincronização. As regras de pontuação, classificação e avanço de
chaves devem ter testes automatizados.

### RNF-07 --- Desempenho

O sistema deve continuar responsivo em torneios locais com dezenas ou
centenas de duplas. Limites de volume e desempenho deverão ser validados
por testes, sem impor um teto arbitrário de inscrições na regra de
negócio.

### RNF-08 --- Acessibilidade e legibilidade

A interface deve manter contraste, foco de teclado, rótulos claros e
mensagens de erro compreensíveis. Informações importantes não devem
depender exclusivamente de cores.

## 9. Arquitetura e hospedagem --- orientação inicial

A decisão tecnológica final deverá ser confirmada durante a
implementação com Claude Code. A proposta para o MVP é:

-   Aplicação web responsiva com comportamento de PWA.
-   Interface administrativa preparada para instalação e cache no
    navegador.
-   Banco local no dispositivo, preferencialmente IndexedDB, para dados
    estruturados offline.
-   Backend e banco de dados hospedados para autenticação, sincronização
    e publicação pública.
-   Camada de sincronização explícita, com fila de operações pendentes,
    identificadores estáveis, tentativas idempotentes e tratamento de
    conflitos.
-   Página pública servida a partir dos dados sincronizados no servidor.

A escolha do framework, banco remoto e provedor de hospedagem deve
considerar custo, facilidade de manutenção, exportação de dados,
autenticação e compatibilidade com operação offline. O provedor
específico não é uma decisão fechada neste PRD.

**Limitação importante:** o site público não poderá refletir alterações
que ainda existam somente no dispositivo offline. Se for necessário
divulgar atualizações durante uma queda de internet, o organizador
poderá exportar ou imprimir relatórios locais atualizados.

## 10. Critérios de aceitação do MVP

1.  O administrador consegue autenticar-se e criar um torneio.
2.  O administrador consegue cadastrar quadras, categorias, atletas,
    duplas e inscrições.
3.  O limite de inscrições pode ser configurado por categoria e a lista
    de espera pode ser ativada ou desativada.
4.  O sistema gera uma chave válida para os formatos suportados e
    permite ajustes manuais.
5.  O sistema permite programar partidas em várias quadras sem sobrepor
    uma mesma dupla.
6.  O administrador consegue registrar placares, W.O. e abandono.
7.  Alterar um resultado exige justificativa e deixa registro da
    alteração anterior.
8.  A classificação e o pódio são recalculados corretamente após
    resultados e correções.
9.  O encerramento solicita confirmação e avisa sobre partidas
    pendentes.
10. A página pública exibe apenas informações destinadas à divulgação.
11. A aplicação administrativa permite cadastrar e editar dados
    essenciais sem internet após sua preparação inicial.
12. Alterações offline permanecem disponíveis após recarregar a
    aplicação, dentro dos limites documentados do navegador.
13. Ao retornar a conexão, alterações pendentes são sincronizadas sem
    criar duplicidades.
14. Uma falha de sincronização não apaga dados locais nem apresenta a
    alteração como sincronizada.
15. O administrador consegue exportar PDF e CSV com programação,
    resultados e classificação.
16. O sistema exibe claramente o estado da conexão e da sincronização.
17. Os fluxos críticos de pontuação, classificação, avanço de chaves e
    sincronização possuem testes automatizados.

## 11. Questões técnicas que podem ser decididas durante a implementação

As seguintes decisões não bloqueiam a definição do produto, mas deverão
ser confirmadas antes ou durante a implementação:

-   Framework de frontend e backend.
-   Banco de dados hospedado e provedor de hospedagem.
-   Estratégia de autenticação e recuperação de acesso.
-   Política de expiração de sessão.
-   Frequência de novas tentativas de sincronização e apresentação de
    erros.
-   Método exato de exportação e restauração manual de backup.
-   Modelos iniciais de pontuação e critérios de desempate.
-   Regras detalhadas para quantidade de grupos e classificados em cada
    formato.
-   Política de retenção e exclusão de dados pessoais.
-   Duração padrão estimada das partidas e intervalo padrão de descanso.

Essas escolhas devem ser registradas no README ou em documentos
técnicos, sem alterar silenciosamente os requisitos do produto.

## 12. Plano de implementação sugerido

### Fase 1 --- Base do sistema

-   Estrutura do projeto e configuração de ambiente.
-   Autenticação administrativa.
-   Modelo de dados e persistência.
-   Cadastro de torneios, categorias, atletas, duplas e quadras.

### Fase 2 --- Competição

-   Inscrições e lista de espera.
-   Geração e edição de chaves.
-   Regras de pontuação.
-   Programação de partidas e prevenção de conflitos.
-   Registro de resultados, W.O. e abandono.
-   Classificação e pódio.

### Fase 3 --- Operação offline

-   Cache da aplicação.
-   Persistência local.
-   Indicadores de conexão.
-   Fila de sincronização, repetição idempotente e tratamento de
    conflitos.
-   Testes de interrupção e retorno de conexão.

### Fase 4 --- Divulgação e relatórios

-   Página pública.
-   Configuração de identidade visual.
-   Exportação PDF e CSV.
-   Revisão de privacidade e segurança.

### Fase 5 --- Validação

-   Testes de aceitação com um torneio simulado.
-   Testes de regras esportivas e casos extremos.
-   Testes offline e de sincronização.
-   Documentação de implantação, exportação e recuperação.

## 13. Riscos e mitigação

  -----------------------------------------------------------------------
  Risco                               Mitigação
  ----------------------------------- -----------------------------------
  Regras esportivas variam entre      Tornar regras configuráveis e
  torneios                            documentar valores padrão.

  Alteração de chaves invalida        Mostrar impacto, exigir confirmação
  resultados                          e preservar histórico.

  Perda de conexão durante o evento   Persistência local, indicador
                                      offline e fila de sincronização.

  Conflito entre dados locais e       Priorizar operações locais
  servidor                            pendentes, preservar cópias e
                                      sinalizar conflitos.

  Exposição de dados pessoais         Minimização de dados e separação
                                      entre área administrativa e página
                                      pública.

  Programação com partidas            Validações automáticas de horários
  sobrepostas                         e disponibilidade das duplas.

  Falha no dispositivo utilizado      Exportação manual de dados e
  durante o evento                    procedimento documentado de
                                      recuperação.
  -----------------------------------------------------------------------

## 14. Definição de pronto

O MVP será considerado pronto quando todos os critérios de aceitação
forem atendidos, os fluxos críticos tiverem testes automatizados, a
operação offline tiver sido validada em condições reais, a sincronização
tiver sido testada com interrupções de rede e existir documentação
suficiente para instalação, uso, exportação e recuperação de dados.

------------------------------------------------------------------------

**Nota:** este PRD consolida as decisões já informadas e adota padrões
explícitos para os pontos ainda não respondidos. Ele serve como base de
implementação, mas não substitui a revisão do regulamento esportivo
específico de cada torneio nem a revisão jurídica de privacidade
aplicável ao serviço.
