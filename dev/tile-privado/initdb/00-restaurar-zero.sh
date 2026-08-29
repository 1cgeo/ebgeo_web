#!/bin/sh
# A cópia do banco de CONFIGURAÇÃO. O dump é gerado por scripts/preparar.sh a
# partir do cluster nativo desta máquina e NÃO é versionado: ele carrega conta,
# e-mail e hash de senha reais.
set -e
echo "[initdb] restaurando ebgeo_zero..."
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d ebgeo_zero -f /seed/ebgeo_zero.sql > /dev/null
echo "[initdb] ebgeo_zero restaurado."
