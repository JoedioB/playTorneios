#!/usr/bin/env bash
# Baixa os logs da execução mais recente do CI para ./logs_github_actions (precisa do GitHub CLI: gh auth login).
# Uso: scripts/baixar-logs.sh [branch]     (padrão: branch atual)
set -euo pipefail
cd "$(dirname "$0")/.."
command -v gh >/dev/null || { echo "Instale o GitHub CLI (brew install gh) e rode: gh auth login" >&2; exit 1; }
BRANCH="${1:-$(git rev-parse --abbrev-ref HEAD)}"
RUN_ID="$(gh run list --branch "$BRANCH" --workflow ci --limit 1 --json databaseId --jq '.[0].databaseId')"
[ -n "$RUN_ID" ] || { echo "Nenhuma execução encontrada em $BRANCH" >&2; exit 1; }
gh run watch "$RUN_ID" --exit-status >/dev/null 2>&1 || true   # espera terminar (falha do CI não interrompe o download)
rm -rf logs_github_actions && mkdir -p logs_github_actions
gh run view "$RUN_ID" --log > logs_github_actions/run-"$RUN_ID".txt || true
gh run view "$RUN_ID" --json jobs --jq '.jobs[] | "\(.name): \(.conclusion)"' | tee logs_github_actions/resumo.txt
echo "Logs em logs_github_actions/ (execução $RUN_ID, branch $BRANCH)"
