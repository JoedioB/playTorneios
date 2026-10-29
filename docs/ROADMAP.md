# Roadmap do MVP

Atualizado em 29/10/2026. Ver também `docs/AUDITORIA_2026-10-29.md` (estado e riscos) e `docs/ENSAIO_E_CHECKLIST.md` (ensaio, produção e piloto).

## Situação atual

| Fase | Situação | Observação |
| --- | --- | --- |
| 0 — Fundação | Concluída | Stack e arquitetura em DEC-16 e DEC-28 |
| 1 — Domínio e persistência | Concluída | Domínio compartilhado, Dexie, Postgres, migrações 001 a 003 |
| 2 — Autenticação e administração | Concluída | Login, sessão, bloqueio por PIN, múltiplos torneios por aparelho |
| 3 — Chaves, agenda e regras | Concluída | Eliminação simples e grupos + mata-mata; agenda sem conflitos |
| 4 — Resultados, classificação e pódio | Concluída | Revisões append-only, correção com justificativa, desempate |
| 5 — Sincronização offline/online | Concluída | Idempotente, conflitos por campo, fila e recuperação |
| 6 — Publicação, relatórios e exportação | Concluída | Página pública por lista de permissão, PDF e CSV |
| 7 — Testes, validação e hardening | Parcial | CI verde (103 testes, 40 de integração, smoke, axe, Trivy). Faltam: Safari/iOS, carga, auditoria manual de acessibilidade, revisão jurídica LGPD |
| 8 — Release do MVP | Em andamento | Depende das fases A a C abaixo |
| Extra — Operação na quadra | Concluída (DEC-29, DEC-30) | Placar, juiz por link, telão, súmulas; falta o ensaio com aparelhos reais |

## Próximas fases

### Fase A — Fechar a verificação (concluída em 29/10/2026)
- CI verde com todo o código atual; adendo de decisões; PRD e ROADMAP atualizados; repositório limpo; actions em Node 24.

### Fase B — Ensaio e produção mínima
Objetivo: provar o sistema em aparelhos e servidor reais.

- Ensaio com 3 celulares (juiz por link, queda de wi-fi, revogação, correção), incluindo um iPhone.
- Servidor real (Ubuntu + Cloudflare Tunnel): HTTPS, cookie seguro, limite de login por IP, portas fechadas, reinício, cadastro fechado.
- Backup diário com cópia externa e restauração testada (`scripts/backup.sh`, `scripts/restore-test.sh`); monitor externo.
- Decisão sobre recuperação de senha e, opcionalmente, 2FA.

Critério de conclusão: checklist de `docs/ENSAIO_E_CHECKLIST.md` (seções 1 e 2) todo marcado.

### Fase C — Piloto
- Um torneio pequeno e real, com o organizador presente e súmulas de reserva.
- Revisão jurídica da retenção de dados (DEC-26) antes de coletar telefone e nascimento reais.
- Relatório do piloto (seção 4 do checklist) e lista priorizada de ajustes.

Critério de conclusão: torneio concluído sem planilhas externas para as funções centrais e sem perda de dados.

### Fase D — Robustez operacional (após o piloto)
- Atualização em tempo real (SSE) para o painel e a página pública.
- Placar público com os sets já fechados; compactação do placar ao vivo.
- Observabilidade (logs estruturados, alerta de erro); teste de carga; auditoria manual de acessibilidade.
- Juiz com fila offline ampliada, ou contas individuais se o piloto mostrar necessidade.

### Fase E — Evolução de produto (backlog)
- Inscrição pública autônoma, pagamentos, circuitos e ranking acumulado, notificações, papéis adicionais, aplicativo nativo.

## Marcos

- **Marco 1 — Núcleo administrativo funcional:** concluído.
- **Marco 2 — Competição operacional:** concluído.
- **Marco 3 — MVP completo:** funcionalidades concluídas; validação em condições reais (fases B e C) em andamento.

## Fora do escopo atual

- aplicativo nativo para iOS e Android;
- operação offline simultânea em vários dispositivos de organizador;
- sincronização em tempo real entre vários dispositivos de organizador (planejada na Fase D);
- contas individuais, senhas e perfis de permissão para juízes (revisar após o piloto);
- inscrição pública autônoma;
- pagamentos e conciliação financeira;
- circuitos, temporadas e rankings acumulados;
- integração com federações externas.

## Conclusão

O produto cobre o escopo do PRD e a operação na quadra. O que falta é provar o sistema em condições reais e aprender com o primeiro torneio antes de ampliar funcionalidades.
