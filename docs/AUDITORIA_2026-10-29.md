# Auditoria do projeto — 29/10/2026

Escopo: estado do código, da verificação (CI), da documentação, da operação e dos riscos, com as próximas fases.
Base: repositório local do organizador (branch `ci/primeira-execucao`, último commit `17ad9ad`), cópia de trabalho na nuvem, logs de CI baixados em `logs_github_actions` e os documentos do Project.

## 1. Resumo

O MVP está funcionalmente completo e foi além do escopo original do PRD: além do fluxo do organizador (inscrições, chaves, agenda, resultados, pódio, sincronização offline, página pública, relatórios), agora há **operação na quadra** (placar, juiz por link, telão, súmulas). O que falta não é mais funcionalidade de MVP, e sim **verificar o que foi feito, documentar as decisões e colocar em produção com segurança**.

Três pontos pedem atenção imediata:

1. **O CI não foi observado nos últimos 5 commits.** Os logs mais recentes na pasta são de 26/10 às 16:11, com 14 rotas no teste de acessibilidade. Eles são anteriores ao tunnel, ao botão Sair, ao placar/juiz/telão e ao nome do juiz. Esses commits estão no `origin`, mas ninguém viu o resultado.
2. **O teste de integração do juiz nunca foi executado.** Ele só roda no job `database` (Postgres), e localmente fica pulado.
3. **A documentação está atrás do código.** O PRD ainda diz que arbitragem está fora do MVP, o ROADMAP não registra status de nenhuma fase, e o DEC-29 (juiz por link) existe só na SPEC_JUIZ.

## 2. O que está sólido (com evidência)

| Área | Situação | Evidência |
| --- | --- | --- |
| Domínio e regras esportivas | Completo e testado | 41 testes do domínio passam, incluindo placar (sets, desempate) |
| Sincronização | Idempotente por (aparelho, operação), com detecção de conflito por campo | Testes de sync e integração com Postgres (CI de 26/10: 30/30) |
| Segurança de contêiner | Duas imagens sem vulnerabilidades conhecidas | Trivy: 0 vulnerabilidades (CI de 26/10) |
| Acessibilidade automática | Sem violação séria ou crítica em 14 rotas × 2 temas | axe-core no CI de 26/10 |
| Navegador (fluxo completo) | Passa, incluindo placar de quadra, telão e súmulas | Smoke test executado na nuvem em 26/10 (16 rotas) |
| Privacidade | Snapshot público por lista de permissão; juiz sem PII | Testes de varredura de campos pessoais |
| Implantação | Compose, TLS (Caddy) e Cloudflare Tunnel; tutorial Ubuntu | `nginx -t` e validação do compose passam no CI de 26/10 (sem o tunnel) |

Tamanho: cerca de 12 mil linhas de TypeScript, 22 arquivos de teste, 3 migrações.

## 3. O que está construído mas ainda não verificado

- **Placar, juiz, telão, súmulas e nome do juiz:** os testes de unidade e o smoke passam na nuvem. Faltam o CI real, o teste de integração com Postgres e o ensaio em celulares de verdade.
- **Página do juiz (`/juiz.html`):** só foi verificada por build; não há teste de navegador contra a API.
- **Cloudflare Tunnel e a porta 8082 do nginx:** nunca rodaram num ambiente real. O IP real do visitante (`CF-Connecting-IP`) é a base do limite de tentativas de login.
- **Tipagem do front-end:** a nuvem não tem os tipos do React, então o `tsc` do web só é confiável no CI.
- **Qualidade de linha (lint):** o eslint não roda na nuvem; só o CI valida.

## 4. Riscos e dívidas

| Risco | Impacto | Sugestão |
| --- | --- | --- |
| Cada ponto do juiz grava versão e mudança no servidor | O banco cresce com 3 quadras lançando ponto a ponto; sem compactação | Medir no ensaio; se pesar, compactar o placar ao vivo ao finalizar a partida |
| Link do juiz é uma credencial ao portador | Vazamento permite lançar naquela quadra | Já mitigado (hash, validade, revogação, nome do juiz). Considerar PIN curto |
| Juiz só funciona online | Queda longa de wi-fi interrompe a quadra | Fila curta existe; súmula em papel é o plano B. Avaliar fila ampliada após o piloto |
| Último-que-grava-vence no placar ao vivo | Dois aparelhos no mesmo jogo se sobrescrevem | Aceito; um link por juiz reduz o risco |
| Arquivos sumiram da pasta local em 26–29/10 (59 arquivos, restaurados do Git) | Causa desconhecida; pode se repetir | Investigar sincronização de pasta (iCloud/Dropbox); `.gitignore` para `.DS_Store` |
| Sem recuperação de senha nem 2FA | Conta de organizador sem plano de recuperação | Decidir canal (e-mail) antes do uso real |
| Backup sem restauração testada | Backup não testado não é backup | Ensaio de restauração em banco vazio |
| Hospedagem sem monitor externo | Queda de luz ou internet passa despercebida | Monitor gratuito no `/api/health` |
| Aviso de Node 20 deprecado nas actions; exceção do zod 3 no Trivy | Quebra futura do CI | Atualizar as actions; revisar a exceção |
| `ci.yml` duplicado na raiz do repositório | Confusão e divergência | Remover a cópia da raiz |

## 5. Documentação e decisões

- **DEC-29 (juiz por link):** registrar em `docs/DECISIONS.md` como Aceita (após o ensaio).
- **DEC-10 e DEC-15:** anotar a revisão parcial (perfil único e aparelho único).
- **PRD §4.2 e ROADMAP:** mover "arbitragem" e "sincronização multi-aparelho" do bloco "fora do MVP" para o que foi entregue e o que fica para depois.
- **DEC-17, 23, 24, 25:** ainda "a confirmar".
- **DEC-26 (retenção LGPD):** depende de revisão jurídica.
- **DEC-27 (hospedagem):** na prática decidida (servidor local + Cloudflare Tunnel); formalizar.
- **ARCHITECTURE.md:** acrescentar o juiz (rotas `/api/referee/*`, tabela `referee_links`, bundle próprio).

## 6. Próximas fases

### Fase A — Fechar a verificação (1 a 2 dias)
- Baixar os logs do CI do commit `17ad9ad` e corrigir o que falhar (migração 003, teste de integração do juiz, axe com o telão e o Sair, `nginx -t` na 8082).
- Conferir se a branch já foi para `main`.
- Registrar DEC-29 e atualizar PRD, ROADMAP e ARCHITECTURE.
- `.gitignore` para `.DS_Store`; remover o `ci.yml` da raiz; investigar o sumiço de arquivos.
- **Saída:** CI verde com todo o código atual e documentação coerente.

### Fase B — Ensaio e produção mínima (1 semana)
- Ensaio com 3 celulares usando o seed: juiz por link, queda de wi-fi, revogação, correção pelo organizador.
- Subir o servidor real (Ubuntu + Tunnel) e validar HTTPS, cookie seguro, limite de login por IP e `/api/health`.
- Backup diário com cópia externa e **restauração testada**; monitor externo; cadastro fechado (`ALLOW_SIGNUP=false`).
- Teste em Safari/iOS e Android (PWA, tela acesa, instalação).
- Decidir recuperação de senha (e-mail) e, opcionalmente, 2FA.
- **Saída:** ambiente de produção validado e checklist de evento preenchido.

### Fase C — Piloto (1 torneio pequeno)
- Torneio real, de preferência com poucas duplas e 1 a 2 quadras, com o organizador presente e súmulas em papel de reserva.
- Medir: tempo por ação frequente, quedas de sinal, divergências de placar, dúvidas dos juízes.
- Revisão LGPD com o responsável (DEC-26) antes de coletar telefone e nascimento de verdade.
- **Saída:** relatório do piloto e lista priorizada de ajustes.

### Fase D — Robustez operacional (depois do piloto)
- Atualização em tempo real (SSE) para o painel e a página pública, no lugar do polling de 15 s.
- Placar público com os sets fechados; compactação do placar ao vivo; observabilidade (logs estruturados e alerta de erro).
- Auditoria manual de acessibilidade (leitor de tela) e teste de carga com público simultâneo.
- Juiz com fila offline ampliada, ou contas individuais se o piloto mostrar necessidade (ver análise anterior).

### Fase E — Evolução de produto (backlog)
- Inscrição pública autônoma, pagamentos, circuitos e ranking acumulado, notificações, papéis adicionais (co-organizador), aplicativo nativo.

## 7. Recomendação

Não ampliar funcionalidades agora. O maior ganho está em **provar o que existe** (Fases A e B) e **aprender com um torneio real** (Fase C). Só depois decidir entre tempo real, contas de juiz e inscrição pública, com dados do piloto.
