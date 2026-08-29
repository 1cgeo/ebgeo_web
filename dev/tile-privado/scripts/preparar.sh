#!/usr/bin/env bash
# Gera a CÓPIA do banco de configuração a partir do cluster nativo desta máquina.
# Rode antes do primeiro `docker compose up`; o dump não é versionado.
set -euo pipefail

AQUI="$(cd "$(dirname "$0")/.." && pwd)"
PGDUMP="${PGDUMP:-/c/Program Files/PostgreSQL/16/bin/pg_dump}"
PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-ebgeo}"
export PGPASSWORD="${PGPASSWORD:-ebgeo_secret}"
BANCO="${BANCO:-ebgeo_zero}"

[ -x "$PGDUMP" ] || { echo "ERRO: pg_dump não encontrado em '$PGDUMP'. Passe PGDUMP=<caminho>." >&2; exit 1; }

echo "[preparar] dump de $BANCO ($PGHOST:$PGPORT) -> seed/ebgeo_zero.sql"
"$PGDUMP" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$BANCO" \
    --no-owner --no-privileges --no-comments \
    -f "$AQUI/seed/ebgeo_zero.sql"

echo "[preparar] $(wc -l < "$AQUI/seed/ebgeo_zero.sql") linhas."
echo "[preparar] falta o cliente: npm run build --prefix frontend (na raiz do repositório)."
