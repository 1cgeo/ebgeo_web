#!/bin/sh
# O CENARIO do gate por recurso, aplicado na subida limpa.
#
# Ele existe TAMBEM como script avulso (scripts/semear-cenario.sh), e a duplicacao e
# deliberada: aqui ele garante que um `docker compose down -v` seguido de `up` devolva o
# ambiente completo; la ele permite reaplicar sem destruir o volume. Os dois chamam os
# MESMOS dois arquivos SQL, entao nao ha duas versoes do cenario.
set -e
echo "[initdb] cenario: fontes no banco de dados..."
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d ebgeo_dados -f /seed/cenario-fontes.sql > /dev/null
echo "[initdb] cenario: catalogo no banco de configuracao..."
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d ebgeo_zero -f /seed/cenario-catalogo.sql
