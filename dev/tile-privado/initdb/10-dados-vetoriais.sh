#!/bin/sh
# O banco que o Martin publica. Separado do de configuração, como no produto.
set -e
echo "[initdb] criando ebgeo_dados..."
createdb -U "$POSTGRES_USER" ebgeo_dados
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d ebgeo_dados -f /seed/dados-sinteticos.sql > /dev/null
echo "[initdb] ebgeo_dados pronto."
