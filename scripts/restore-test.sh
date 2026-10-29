#!/usr/bin/env bash
# Ensaio de restauração: carrega o backup mais recente num banco TEMPORÁRIO e confere os dados. Não toca no banco real.
# Uso: scripts/restore-test.sh [arquivo.sql.gz]   (sem argumento, usa o mais recente em ~/backups)
set -euo pipefail
cd "$(dirname "$0")/.."
FILE="${1:-$(ls -t "$HOME"/backups/playtorneios-*.sql.gz 2>/dev/null | head -1)}"
[ -n "$FILE" ] && [ -f "$FILE" ] || { echo "Nenhum backup encontrado." >&2; exit 1; }
COMPOSE=(docker compose)
[ -n "${USE_TUNNEL:-}" ] && COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.tunnel.yml)
set -a; . ./.env; set +a
U="${POSTGRES_USER:-playtorneios}"
TMPDB="restore_test_$$"
psql_() { "${COMPOSE[@]}" exec -T db psql -v ON_ERROR_STOP=1 -U "$U" "$@"; }
trap 'psql_ -d postgres -qc "drop database if exists $TMPDB" >/dev/null 2>&1 || true' EXIT
psql_ -d postgres -qc "create database $TMPDB"
gunzip -c "$FILE" | psql_ -d "$TMPDB" -q >/dev/null
for t in organizations users tournament_states applied_operations referee_links; do
  n=$(psql_ -d "$TMPDB" -Atc "select count(*) from $t")
  printf '%-22s %s linhas\n' "$t" "$n"
done
echo "OK: $FILE restaurou em banco temporário (apagado ao final)."
