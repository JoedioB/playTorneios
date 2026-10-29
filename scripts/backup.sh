#!/usr/bin/env bash
# Backup diário do banco (pg_dump comprimido) com rotação. Uso: scripts/backup.sh [pasta_destino] [dias_de_retenção]
# Com BACKUP_DATABASE_URL definida, copia um banco remoto em vez do Compose local.
# Cron sugerido:  30 3 * * *  /caminho/playTorneios/scripts/backup.sh >> ~/backups/backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."
DEST="${1:-$HOME/backups}"
KEEP_DAYS="${2:-14}"
COMPOSE=(docker compose)
[ -f docker-compose.tunnel.yml ] && [ -n "${USE_TUNNEL:-}" ] && COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.tunnel.yml)
[ -f ./.env ] && { set -a; . ./.env; set +a; }
mkdir -p "$DEST"
OUT="$DEST/playtorneios-$(date +%F-%H%M).sql.gz"
if [ -n "${BACKUP_DATABASE_URL:-}" ]; then
  # Banco remoto (ex.: Railway, pela URL pública do banco): precisa de pg_dump 16 instalado nesta máquina.
  pg_dump --no-owner "$BACKUP_DATABASE_URL" | gzip > "$OUT.tmp"
else
  "${COMPOSE[@]}" exec -T db pg_dump -U "${POSTGRES_USER:-playtorneios}" "${POSTGRES_DB:-playtorneios}" | gzip > "$OUT.tmp"
fi
# um dump vazio ou truncado não é backup
if ! gzip -t "$OUT.tmp" || [ "$(gunzip -c "$OUT.tmp" | grep -c 'CREATE TABLE')" -lt 3 ]; then
  rm -f "$OUT.tmp"; echo "ERRO: dump inválido, nada foi gravado" >&2; exit 1
fi
mv "$OUT.tmp" "$OUT"
find "$DEST" -name 'playtorneios-*.sql.gz' -mtime +"$KEEP_DAYS" -delete
echo "OK: $OUT ($(du -h "$OUT" | cut -f1))"
