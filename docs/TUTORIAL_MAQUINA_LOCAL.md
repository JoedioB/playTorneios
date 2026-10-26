# Tutorial: servidor próprio (Ubuntu) com Cloudflare Tunnel

Resultado: o playTorneios no ar em `https://torneios.SEU-DOMINIO`, rodando numa máquina Ubuntu em casa ou no clube,
**sem abrir portas no roteador** e funcionando mesmo atrás de CGNAT. A Cloudflare entrega o HTTPS; o Caddy não é usado.

Tempo estimado: 45 a 60 minutos, a maior parte esperando o DNS.

## O que você precisa

- Uma máquina com **2 vCPU, 4 GB de RAM e 40 GB de SSD** (mini PC ou notebook velho serve), ligada na tomada e no cabo de rede.
- **Ubuntu Server 24.04 LTS** (22.04 também serve).
- Um **domínio** seu (registro.br ou outro registrador; é pago).
- Uma **conta gratuita na Cloudflare**. O plano gratuito do Zero Trust pode pedir um meio de pagamento no cadastro, sem cobrança.
- Acesso ao repositório do projeto (`https://github.com/JoedioB/playTorneios.git`). Se ele for privado, gere um token de acesso no GitHub.

Limites a aceitar: se a luz ou a internet cair, o servidor cai. O app continua funcionando offline nos celulares e sincroniza
quando o servidor voltar, mas a página pública e a sincronização ficam fora do ar nesse intervalo.

## 1. Preparar o Ubuntu

```bash
sudo apt update && sudo apt full-upgrade -y
sudo timedatectl set-timezone America/Sao_Paulo
sudo apt install -y ca-certificates curl git ufw unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades      # atualizações de segurança automáticas
```

Firewall: só o SSH, e só para a rede local. **Não abra as portas 80 e 443.**

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from 192.168.0.0/16 to any port 22 proto tcp   # ajuste para a faixa da sua rede
sudo ufw enable
```

Para a máquina não dormir nem ficar parada após uma queda de energia:

```bash
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
```

- Na BIOS, ative **"Restore on AC Power Loss"** (ou "Power On after power failure") para ligar sozinha quando a luz voltar.
- No roteador, reserve um **IP fixo** para a máquina (reserva de DHCP). Ajuda no acesso por SSH.
- Um nobreak pequeno evita corrupção de disco em quedas curtas.

## 2. Instalar o Docker

Método do repositório oficial (confira se algo mudou em [docs.docker.com/engine/install/ubuntu](https://docs.docker.com/engine/install/ubuntu/)):

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER
```

Saia e entre de novo na sessão e teste:

```bash
docker run --rm hello-world
docker compose version
```

O Docker inicia sozinho com o sistema. Neste projeto nenhuma porta é publicada no host, então o firewall não é contornado.

## 3. Colocar o domínio na Cloudflare

1. Em [dash.cloudflare.com](https://dash.cloudflare.com), clique em **Add a site** e informe o domínio. Escolha o plano **Free**.
2. A Cloudflare mostra dois **nameservers**. No site do seu registrador (no registro.br: Alterar servidores DNS), troque os
   servidores atuais por esses dois.
3. Espere o status do site ficar **Active**. Pode levar de alguns minutos a algumas horas.

## 4. Criar o túnel

1. No painel da Cloudflare, abra **Zero Trust** (se pedir, crie a organização gratuita) e vá em **Networks → Tunnels**
   (os nomes dos menus mudam de tempos em tempos; procure por *Tunnels*).
2. **Create a tunnel → Cloudflared**, dê o nome `playtorneios` e salve.
3. Na tela de instalação aparece um comando com `--token eyJ...`. **Copie só o token** (a parte depois de `--token`).
   Não instale o cloudflared por esse comando: ele roda em contêiner, no passo 6.
4. Na aba **Public Hostname** do túnel, adicione:
   - Subdomain: `torneios` (ou o que preferir) e Domain: o seu domínio;
   - Service: tipo **HTTP**, URL **`web:8082`**.

A porta `8082` é obrigatória: é o listener do nginx que lê o IP real do visitante enviado pela Cloudflare. Com `8080`, todos os
visitantes pareceriam o mesmo IP e o limite de tentativas de login por IP bloquearia todo mundo junto.

O token dá controle sobre o túnel. Trate como senha e não coloque em lugar público.

## 5. Baixar e configurar o projeto

```bash
cd ~
git clone https://github.com/JoedioB/playTorneios.git
cd playTorneios
cp .env.example .env
nano .env
```

Ajuste no `.env`:

```bash
POSTGRES_PASSWORD=<uma senha longa>            # gere com: openssl rand -base64 24
COOKIE_SECRET=<segredo de 32+ caracteres>      # gere com: openssl rand -base64 48
TUNNEL_TOKEN=<o token do passo 4>
ALLOW_SIGNUP=true                              # só até criar a sua conta (passo 7)
```

Proteja o arquivo: `chmod 600 .env`. Ele não vai para o Git.

## 6. Subir

```bash
docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d --build
docker compose ps
docker compose logs cloudflared | tail -20
```

O primeiro build leva alguns minutos. Todos os serviços devem ficar `healthy`/`running`, e o log do cloudflared deve mostrar
`Registered tunnel connection`. Na tela do túnel no painel, o status muda para **Healthy**.

Não use este arquivo junto com `docker-compose.tls.yml`.

## 7. Verificar e criar a sua conta

```bash
curl -sI https://torneios.SEU-DOMINIO/api/health       # espera HTTP/2 200
```

No navegador, abra `https://torneios.SEU-DOMINIO`, crie a conta de organizador e confirme que o login funciona (o cookie de
sessão é `Secure`, visível nas ferramentas do navegador).

Depois de criar a conta, **desligue o cadastro aberto** para ninguém mais criar contas no seu servidor:

```bash
sed -i 's/^ALLOW_SIGNUP=.*/ALLOW_SIGNUP=false/' .env
docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d
```

Opcional: para testar com dados fictícios, veja a seção de seed do README.

## 8. Backup do banco (faça antes do primeiro torneio)

Crie `~/backup-playtorneios.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd ~/playTorneios
mkdir -p ~/backups
set -a; . ./.env; set +a
docker compose exec -T db pg_dump -U "${POSTGRES_USER:-playtorneios}" "${POSTGRES_DB:-playtorneios}" \
  | gzip > ~/backups/playtorneios-$(date +%F).sql.gz
find ~/backups -name 'playtorneios-*.sql.gz' -mtime +14 -delete
```

```bash
chmod +x ~/backup-playtorneios.sh
~/backup-playtorneios.sh && ls -lh ~/backups
(crontab -l 2>/dev/null; echo '30 3 * * * $HOME/backup-playtorneios.sh') | crontab -
```

Isso guarda 14 dias no próprio disco. **Copie também para fora da máquina** (disco externo ou nuvem), senão um defeito no
disco leva o banco e o backup juntos. Para restaurar:

```bash
gunzip -c ~/backups/playtorneios-AAAA-MM-DD.sql.gz | docker compose exec -T db psql -U playtorneios playtorneios
```

Teste a restauração uma vez num banco vazio.

## 9. Segurança

- Ative a **verificação em duas etapas** na conta Cloudflare e na do registrador: quem controla o DNS controla o site.
- Não exponha o Postgres nem o SSH pelo túnel.
- Mantenha o `ALLOW_SIGNUP=false` depois de criar as contas necessárias.
- As atualizações de segurança do Ubuntu estão automáticas (passo 1). Reinicie a máquina de vez em quando para aplicar as de kernel.

## 10. Operação do dia a dia

| Tarefa | Comando |
| --- | --- |
| Ver o estado | `docker compose ps` |
| Ver logs da API | `docker compose logs -f api` |
| Atualizar o sistema | `git pull && docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d --build` |
| Parar | `docker compose -f docker-compose.yml -f docker-compose.tunnel.yml down` (sem `-v`, para não apagar o banco) |
| Anonimização LGPD (simulação) | `docker compose exec api node src/retention-cli.ts --dry-run` |

Os contêineres têm `restart: unless-stopped`: sobem sozinhos após uma queda de energia, assim que o Docker iniciar.
Para saber quando o servidor caiu, use um monitor externo gratuito apontando para `https://torneios.SEU-DOMINIO/api/health`.

## Problemas comuns

| Sintoma | Causa provável | O que fazer |
| --- | --- | --- |
| Erro 502 ou 1033 na Cloudflare | Túnel desconectado ou hostname apontando para o serviço errado | `docker compose logs cloudflared`; confirme `HTTP` e `web:8082` no painel |
| Página abre mas o login não "pega" | Acesso por HTTP ou `COOKIE_SECURE` desligado | Acesse sempre por `https://`; o overlay do túnel já força `COOKIE_SECURE=true` |
| Todos são bloqueados no login ao mesmo tempo | O túnel aponta para `web:8080` e a API vê um IP só | Troque a URL do serviço para `web:8082` |
| `variable is not set` ao subir | Falta algo no `.env` | Preencha `POSTGRES_PASSWORD`, `COOKIE_SECRET` e `TUNNEL_TOKEN` |
| Depois da queda de luz nada voltou | Docker não iniciou ou BIOS não religa sozinha | `sudo systemctl status docker`; revise a opção da BIOS (passo 1) |
