#!/bin/sh
# Depende do 00: as chaves apontam para contas que vieram no dump.
set -e
echo "[initdb] semeando as chaves da sonda..."
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d ebgeo_zero -f /seed/chaves-de-sonda.sql
