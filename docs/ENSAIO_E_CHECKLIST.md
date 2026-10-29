# Ensaio, validação do servidor e checklist de evento

Use na ordem. Pare no primeiro passo que falhar e anote o comando, o que apareceu na tela e `docker compose logs api`.

## 1. Ensaio com 3 celulares (juiz por link)

Objetivo: provar o fluxo da quadra com aparelhos reais, no wi-fi do local, antes de qualquer torneio.

Preparação (10 min):
1. Servidor no ar (ver `docs/TUTORIAL_MAQUINA_LOCAL.md`) com `ALLOW_SIGNUP=true` só para o ensaio.
2. `docker compose --profile seed run --rm seed --reset --only=copa` (nunca em produção: cria conta com senha conhecida).
3. No computador do organizador, entre com a conta de teste. A Copa tem agenda em 3 quadras.
4. Em **Juízes (placar)**, gere um link por quadra, com o nome de cada juiz de teste, e leia o QR com cada celular.

Roteiro (marque cada item):

| # | Passo | Esperado |
| --- | --- | --- |
| 1 | Cada juiz abre o link | Vê só a própria quadra e o nome no cabeçalho |
| 2 | Abrir partida, lançar pontos nas 3 quadras ao mesmo tempo | Pontos aparecem no painel do organizador em até 15 s |
| 3 | Errar um ponto e usar **Desfazer** | Placar volta, inclusive ao reabrir o set anterior |
| 4 | Finalizar uma partida (sets) | Resultado em Resultados, com "Lançado por <nome> (juiz)" |
| 5 | Organizador corrige esse resultado com justificativa | Revisão 2 gravada; classificação recalcula |
| 6 | Organizador lança o resultado antes do juiz finalizar | Juiz vê "O organizador já registrou o resultado" |
| 7 | Desligar o wi-fi de um celular por 30 s, lançar 5 pontos, religar | Pontos enviados sozinhos; aviso de "sem conexão" aparece e some |
| 8 | Revogar o link de uma quadra | No próximo ponto ou ao atualizar a lista, o juiz vê "Link encerrado" e o placar local continua na tela |
| 9 | Abrir o telão em uma TV ou projetor (`#/telao`) | Mostra jogos em andamento e próximos por quadra, legível a 3 m |
| 10 | Imprimir súmulas (`#/imprimir`) | Uma folha por partida, legível em preto e branco |
| 11 | Tentar abrir o link do juiz em outro torneio ou outra quadra | Sem acesso |

Meça e anote: tempo do primeiro ponto até aparecer no painel; quantos toques erraram; se a tela do celular apagou (tela acesa não funciona em alguns navegadores); bateria gasta em 30 min.

Ao final, `ALLOW_SIGNUP=false` e apague os dados do seed. Se tudo passar, o DEC-29 pode ser marcado como **Aceita**.

## 2. Validação do servidor real

| # | Verificação | Como |
| --- | --- | --- |
| 1 | HTTPS e saúde | `curl -sI https://SEU-DOMINIO/api/health` retorna 200 |
| 2 | Cookie seguro | Nas ferramentas do navegador, `pt_session` com `Secure` e `HttpOnly` |
| 3 | IP real no limite de login | 30 tentativas erradas em 1 hora, de um celular e com e-mails inexistentes, bloqueiam só aquele celular (limite por IP, configurável em `LOGIN_IP_MAX_FAILURES`); outro celular entra normalmente (valida `web:8082` e `CF-Connecting-IP`). Atenção: 5 senhas erradas na mesma conta travam a conta por um tempo, então não use a conta real neste teste |
| 4 | Portas fechadas | De fora da rede, `80`, `443`, `5432` e `22` não respondem (o acesso é só pelo túnel) |
| 5 | Reinício | Desligar e religar a máquina: tudo volta sozinho e o app abre |
| 6 | Cadastro fechado | Tentar criar conta nova: recusado |
| 7 | Monitor externo | Serviço gratuito apontando para `/api/health`, com alerta por e-mail ou celular |
| 8 | Instalação do PWA | Instalar no Android (Chrome) e no iPhone (Safari: Compartilhar, Adicionar à Tela de Início) e abrir sem internet |
| 9 | Safari/iOS | Rodar o ensaio da seção 1 com ao menos um iPhone |

### Backup e restauração (obrigatório antes do primeiro torneio)

```bash
scripts/backup.sh                         # grava ~/backups/playtorneios-AAAA-MM-DD-HHMM.sql.gz e valida o arquivo
scripts/restore-test.sh                   # restaura o mais recente num banco temporário e mostra a contagem de linhas
USE_TUNNEL=1 scripts/backup.sh            # se a stack sobe com o overlay do túnel
```

Agende o backup (`crontab -e`: `30 3 * * * /caminho/playTorneios/scripts/backup.sh >> ~/backups/backup.log 2>&1`) e rode o `restore-test.sh` uma vez agora e depois uma vez por mês. Copie a pasta `~/backups` para um disco externo ou nuvem; backup só no mesmo disco não protege contra falha do disco.

## 3. Checklist do dia do evento

Na véspera:
- [ ] Servidor ligado, `docker compose ps` tudo saudável, monitor externo verde.
- [ ] Backup feito hoje e copiado para fora da máquina.
- [ ] Torneio configurado, duplas aprovadas, chave gerada, agenda sem conflitos.
- [ ] Página pública publicada e conferida no celular.
- [ ] Links dos juízes gerados, um por juiz, e QR impresso ou enviado só a cada juiz.
- [ ] Súmulas impressas (reserva) para cada quadra.
- [ ] Aparelho do organizador com o app aberto, instalado, com bateria e carregador; PIN de bloqueio definido.
- [ ] Backup local do app exportado (Backup e preparação).

No local, antes do primeiro jogo:
- [ ] wi-fi testado em cada quadra com o celular do juiz.
- [ ] Telão conectado e legível.
- [ ] Cada juiz abriu o link e viu a própria quadra.

Durante:
- [ ] Olhar o chip de sincronização do organizador (pendências devem voltar a zero).
- [ ] Em queda de internet: o organizador segue normalmente; juízes usam a fila curta ou a súmula em papel e o organizador lança depois.
- [ ] Qualquer link vazado: revogar na tela Juízes e gerar outro.

Depois:
- [ ] Encerrar o torneio (Encerramento), exportar relatórios, fazer backup final.
- [ ] Revogar os links dos juízes.
- [ ] Preencher a seção 4.

## 4. Relatório do piloto (preencher após o primeiro torneio real)

| Pergunta | Resposta |
| --- | --- |
| Quantas duplas, categorias e quadras? | |
| Houve queda de internet? Quanto durou? O que aconteceu? | |
| Algum placar divergiu, sumiu ou foi lançado duas vezes? | |
| Os juízes entenderam o placar sem treinamento? Onde erraram? | |
| Tempo médio para lançar um resultado (juiz e organizador) | |
| O telão e as súmulas foram usados? Serviram? | |
| O que o organizador ainda fez fora do sistema (planilha, papel, mensagem)? | |
| Queixas do público na página pública (atraso, dados que faltaram) | |
| Pedidos: contas de juiz, tempo real, inscrição pública, outros | |

Com isso, priorizar a Fase D (ver `docs/AUDITORIA_2026-10-29.md`).
