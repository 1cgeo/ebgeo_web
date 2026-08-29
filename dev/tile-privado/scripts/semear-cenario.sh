#!/usr/bin/env bash
# APLICA O CENARIO DE TESTE do gate por recurso: as fontes no Martin e as linhas de
# catalogo que as enderecam.
#
# IDEMPOTENTE de proposito: ele roda a qualquer momento, sobre um ambiente ja de pe, e
# nao so na primeira subida. Um cenario que so existisse no `initdb` obrigaria a destruir
# o volume para reaplica-lo, e um cenario caro de reaplicar e um cenario que se deixa
# envelhecer.
#
# O QUE ELE MONTA, e o porque de cada peca esta nos dois arquivos SQL:
#   seed/cenario-fontes.sql   -> 51 fontes no Martin, incluindo uma ORFA (publicada e
#                                nao cadastrada) e 40 de escala.
#   seed/cenario-catalogo.sql -> 53 camadas de dados, 5 analises e 7 basemaps, cobrindo
#                                as sete situacoes que o gate precisa distinguir.
#
# O MARTIN PRECISA SER REINICIADO, e isso nao e detalhe: ele descobre as fontes na
# subida. Tabela nova num banco ja montado nao aparece no catalogo dele ate reiniciar, e
# o sintoma e um 404 que se le como "o gate recusou".
set -euo pipefail
cd "$(dirname "$0")/.."
. "$(dirname "$0")/comum.sh"

# `MSYS_NO_PATHCONV=1` porque o Git Bash converte `/seed/...` para um caminho do Windows
# antes de o docker ver, e o psql do container recebe algo como
# `C:/Program Files/Git/seed/...`, que nao existe la dentro.
psql_arquivo() {
    MSYS_NO_PATHCONV=1 docker compose exec -T db \
        psql -q -U ebgeo -d "$1" -v ON_ERROR_STOP=1 -f "/seed/$2"
}

echo "[cenario] fontes no banco de DADOS..."
psql_arquivo ebgeo_dados cenario-fontes.sql

echo "[cenario] reiniciando o Martin para que ele descubra as fontes novas..."
docker compose restart martin > /dev/null 2>&1
sleep 5

echo "[cenario] catalogo no banco de CONFIGURACAO..."
psql_arquivo ebgeo_zero cenario-catalogo.sql

echo "[cenario] invalidando os caches derivados do catalogo..."
reiniciar

echo "[cenario] pronto. Confira com scripts/confere-gate-por-recurso.sh"
