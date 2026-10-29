# Adendo às decisões (outubro de 2026)

Complementa `docs/DECISIONS.md`. Reúne as decisões tomadas depois da DEC-28 e as revisões de decisões anteriores. Quando houver uma revisão do documento principal, estes itens devem ser incorporados a ele.

## Revisões de decisões anteriores

| Decisão | Revisão |
| --- | --- |
| DEC-10 (perfil único) | Revisada parcialmente pela DEC-29: continua um único perfil autenticado; o juiz acessa por link de quadra, sem conta, com permissões mínimas. |
| DEC-15 (escopo simples) | Revisada pela DEC-29: arbitragem por link e uso de vários aparelhos na quadra entram no escopo. Seguem fora: aplicativo nativo, inscrição pública, pagamentos e rankings globais. O PRD §4.2 e o bloco "Itens fora do roadmap do MVP" do ROADMAP devem refletir isso. |
| DEC-27 (hospedagem) | **Decidida em caráter provisório:** servidor próprio (Ubuntu) com Docker Compose e Cloudflare Tunnel, conforme `docs/TUTORIAL_MAQUINA_LOCAL.md`. Reavaliar após o piloto (disponibilidade de luz e internet, backup). Alternativa documentada: VPS com Caddy (`docker-compose.tls.yml`). |

### DEC-29 — Juiz da partida por link de quadra, sem conta

- Status: **Implementada; a confirmar após o ensaio com 3 celulares** (detalhes em `docs/SPEC_JUIZ.md`).
- Decisão: o organizador gera um link (e QR) por juiz e por quadra. Quem abre o link vê só as partidas daquela quadra, abre a partida, lança pontos, desfaz e finaliza. Não há conta nem senha do juiz. O nome informado ao gerar o link fica gravado na revisão do resultado e aparece em Resultados.
- Justificativa: com cerca de 3 quadras simultâneas, o aparelho único do organizador é o gargalo. Contas e papéis exigiriam recuperação de senha, convites e revisão do modelo de permissões. Com wi-fi bom nas quadras, um juiz só-online resolve o gargalo com muito menos risco.
- Consequências:
  - revisa parcialmente DEC-10 (perfil único) e DEC-15 (um aparelho e sem arbitragem): o PRD §4.2 e o bloco "Itens fora do roadmap do MVP" do ROADMAP deixam de listar arbitragem e multi-aparelho como fora do escopo;
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
