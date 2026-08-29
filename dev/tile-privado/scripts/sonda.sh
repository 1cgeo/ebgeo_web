#!/usr/bin/env bash
# A SONDA DO `location`: o que o ambiente prova, medido, com controle negativo.
#
# Ela NÃO é teste automatizado do repositório e não pretende ser: a validação no
# nginx não tem teste em nenhum dos dois pacotes, pela mesma razão que a cláusula
# 10.1 já registra. Isto é a sonda com data, rodada à mão, com o resultado anotado.
#
# SAI COM CÓDIGO != 0 SE QUALQUER CASO FALHAR. Sonda que só imprime é sonda que se
# lê na diagonal.
set -uo pipefail

BASE="${BASE:-http://localhost}"
CHAVE_VIVA="aaaaaaaa-0000-4000-8000-000000000001"
CHAVE_FULL="aaaaaaaa-0000-4000-8000-000000000002"
CHAVE_VENCIDA="aaaaaaaa-0000-4000-8000-000000000003"
CHAVE_REVOGADA="aaaaaaaa-0000-4000-8000-000000000004"
CHAVE_INATIVA="aaaaaaaa-0000-4000-8000-000000000005"
CHAVE_CORTADA="aaaaaaaa-0000-4000-8000-000000000006"
CHAVE_INEXISTENTE="99999999-9999-4999-8999-999999999999"
# z/x/y que cai sobre a área dos dados sintéticos (-45..-44, -23..-22).
TILE="10/385/577"

falhas=0

psql_local() {
    docker compose exec -T db psql -q -U ebgeo -d ebgeo_zero -v ON_ERROR_STOP=1 -c "$1" > /dev/null
}

# checar <rótulo> <status esperado> <url> [motivo esperado no cabeçalho]
checar() {
    local rotulo="$1" esperado="$2" url="$3" motivo_esperado="${4:-}"
    local resposta status motivo
    resposta=$(curl -s -o /dev/null -D - -w '%{http_code}' "$url" 2>/dev/null)
    status="${resposta##*$'\n'}"
    motivo=$(printf '%s' "$resposta" | grep -i '^X-EBGeo-Tile-Denial:' | tr -d '\r' | awk '{print $2}')

    if [ "$status" != "$esperado" ]; then
        printf '  FALHOU  %-42s esperado %s, obtido %s\n' "$rotulo" "$esperado" "$status"
        falhas=$((falhas + 1))
        return
    fi
    if [ -n "$motivo_esperado" ] && [ "$motivo" != "$motivo_esperado" ]; then
        printf '  FALHOU  %-42s status %s ok, motivo esperado "%s", obtido "%s"\n' \
            "$rotulo" "$status" "$motivo_esperado" "$motivo"
        falhas=$((falhas + 1))
        return
    fi
    printf '  ok      %-42s %s%s\n' "$rotulo" "$status" "${motivo:+ ($motivo)}"
}

echo
echo "=== 1. O app continua bootando sem chave nenhuma ==="
# O gate vale sobre o prefixo de tile e mais nada. Se este caso falhar, o location
# vazou para a API e o anônimo perdeu o produto inteiro, não só a camada.
checar "GET /api/config (anônimo)"            200 "$BASE/api/config"
checar "GET / (o app)"                        200 "$BASE/"

echo
echo "=== 2. Sem credencial que resolva, o tile fecha ==="
checar "sem api_key"                          401 "$BASE/tiles/rodovias" "sem-chave-viva"
checar "api_key que não é UUID"               401 "$BASE/tiles/rodovias?api_key=nao-e-uuid" "sem-chave-viva"
checar "UUID que não existe"                  401 "$BASE/tiles/rodovias?api_key=$CHAVE_INEXISTENTE" "sem-chave-viva"

echo
echo "=== 3. Chave viva abre, nos dois escopos do vocabulário ==="
checar "viva, escopo tiles (TileJSON)"        200 "$BASE/tiles/rodovias?api_key=$CHAVE_VIVA"
checar "viva, escopo tiles (bytes do tile)"   200 "$BASE/tiles/rodovias/$TILE?api_key=$CHAVE_VIVA"
checar "viva, escopo full"                    200 "$BASE/tiles/rodovias?api_key=$CHAVE_FULL"
checar "viva, a outra camada"                 200 "$BASE/tiles/municipios?api_key=$CHAVE_VIVA"

echo
echo "=== 4. Cada amarra recusa, com o par positivo do mesmo dono acima ==="
checar "vencida"                              401 "$BASE/tiles/rodovias?api_key=$CHAVE_VENCIDA" "sem-chave-viva"
checar "revogada individualmente"             401 "$BASE/tiles/rodovias?api_key=$CHAVE_REVOGADA" "sem-chave-viva"
checar "conta desativada"                     401 "$BASE/tiles/rodovias?api_key=$CHAVE_INATIVA" "sem-chave-viva"
checar "sessão cortada em massa"              401 "$BASE/tiles/rodovias?api_key=$CHAVE_CORTADA" "sem-chave-viva"

echo
echo "=== 5. CONTROLE NEGATIVO na MESMA linha ==="
# Sem isto, os 401 acima poderiam todos vir de "não achou a linha" e a sonda diria
# verde. Aqui a linha é a mesma, e só o termo acusado muda.
checar "antes de revogar"                     200 "$BASE/tiles/rodovias?api_key=$CHAVE_VIVA"
psql_local "UPDATE api_keys SET revoked_at = NOW() WHERE api_key = '$CHAVE_VIVA';"
checar "depois de revogar (mesma linha)"      401 "$BASE/tiles/rodovias?api_key=$CHAVE_VIVA" "sem-chave-viva"
psql_local "UPDATE api_keys SET revoked_at = NULL WHERE api_key = '$CHAVE_VIVA';"
checar "revogação desfeita (mesma linha)"     200 "$BASE/tiles/rodovias?api_key=$CHAVE_VIVA"

psql_local "UPDATE api_keys SET expires_at = created_at + INTERVAL '1 minute' WHERE api_key = '$CHAVE_VIVA';"
checar "depois de vencer (mesma linha)"       401 "$BASE/tiles/rodovias?api_key=$CHAVE_VIVA" "sem-chave-viva"
psql_local "UPDATE api_keys SET expires_at = NOW() + INTERVAL '80 days' WHERE api_key = '$CHAVE_VIVA';"
checar "prazo devolvido (mesma linha)"        200 "$BASE/tiles/rodovias?api_key=$CHAVE_VIVA"

echo
echo "=== 6. O CUSTO, medido e não estimado ==="
# 20 tiles em série, com e sem o gate. O que se compara é a diferença; o número
# absoluto é desta máquina e não viaja.
medir() {
    local rotulo="$1" url="$2" i inicio fim
    inicio=$(date +%s%N)
    for i in $(seq 1 20); do curl -s -o /dev/null "$url" ; done
    fim=$(date +%s%N)
    printf '  %-42s %s ms / 20 pedidos\n' "$rotulo" "$(( (fim - inicio) / 1000000 ))"
}
medir "tile com chave (passa pelo auth_request)" "$BASE/tiles/rodovias/$TILE?api_key=$CHAVE_VIVA"
medir "recusa sem chave (curto-circuito)"        "$BASE/tiles/rodovias/$TILE"

echo
if [ "$falhas" -eq 0 ]; then
    echo "SONDA VERDE — $(date '+%Y-%m-%d %H:%M'). Anote a data no relatório."
else
    echo "SONDA VERMELHA — $falhas caso(s) falharam."
fi
exit "$falhas"
