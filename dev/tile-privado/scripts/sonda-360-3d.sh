#!/usr/bin/env bash
# A SONDA DO OUTRO EIXO: 360 e 3D, que NÃO passam pelo nginx.
#
# POR QUE ELA EXISTE SEPARADA DA `sonda.sh`. As duas medem coisas de naturezas
# diferentes, e juntá-las faria uma passar por prova da outra. `sonda.sh` mede um
# gate de CREDENCIAL no nginx, que responde sim/não e não sabe qual camada foi
# pedida. Esta mede o gate por RECURSO dentro do serviço, que sabe exatamente qual
# recurso é e quem pergunta. É a distinção que o `fileoverview` de
# `backend/src/modules/auth/tile-access.js` faz por extenso.
#
# ELA MUTA O BANCO E DESFAZ NO FIM: torna privados o tileset `PCL` e o projeto 360,
# mede, e devolve os dois a `public`. Se ela for interrompida no meio, o banco fica
# com os dois privados; rodá-la de novo conserta.
#
# O REINÍCIO DO BACKEND NO MEIO NÃO É SUPERSTIÇÃO. O índice de
# `assets3d-regime.js` é memoizado e reconstruído na ESCRITA DE CATÁLOGO pela rota;
# uma escrita direta no banco, como esta faz, só é vista depois do TTL de 60 s.
# Medir sem isso mostra o tileset privado ainda aberto e leva a concluir que o gate
# do 3D falha ABERTO, o que é falso. Foi o primeiro resultado desta sonda.
set -uo pipefail
cd "$(dirname "$0")/.."

BASE="${BASE:-http://localhost}"
CHAVE_CREDENCIADO="aaaaaaaa-0000-4000-8000-000000000002"   # diniz, papel credenciado
# As fotos do acervo copiado estão em -50.206 / -29.982; este z/x/y cai sobre elas.
TILE360="12/1476/2405"
falhas=0

entrar() {
    curl -s -X POST "$BASE/api/v1/auth/login" -H 'Content-Type: application/json' \
        -d "{\"username\":\"$1\",\"password\":\"${SENHA:-tassofragoso}\"}" \
        | python -c "import sys,json;print(json.load(sys.stdin)['data']['accessToken'])" 2>/dev/null
}

# checar <rótulo> <status> <volume: 'cheio' | 'vazio' | 'qualquer'> <curl args...>
#
# TRÊS ESTADOS DE VOLUME, e o terceiro não é preguiça. `vazio` é uma AFIRMAÇÃO forte
# e é o coração da medição do 360: o corpo tem zero byte, ou seja o subconjunto que
# a pessoa alcança é nada. Um 404 do backend NÃO é vazio — ele traz o envelope de
# erro em JSON, 61 bytes — e exigir zero ali reprovaria a recusa CERTA.
checar() {
    local rotulo="$1" esperado="$2" volume="$3"; shift 3
    local saida status bytes
    saida=$(curl -s -o /dev/null -w '%{http_code} %{size_download}' "$@")
    status="${saida%% *}"; bytes="${saida##* }"
    local ok=1
    [ "$status" = "$esperado" ] || ok=0
    if [ "$volume" = "cheio" ] && [ "$bytes" -le 0 ]; then ok=0; fi
    if [ "$volume" = "vazio" ] && [ "$bytes" -gt 0 ]; then ok=0; fi
    # 'qualquer' não olha o tamanho: usado onde o corpo é o envelope de erro.
    if [ "$ok" = "1" ]; then
        printf '  ok      %-38s %s, %s bytes\n' "$rotulo" "$status" "$bytes"
    else
        printf '  FALHOU  %-38s esperado %s/%s, obtido %s/%s bytes\n' "$rotulo" "$esperado" "$volume" "$status" "$bytes"
        falhas=$((falhas + 1))
    fi
}

sql() { docker compose exec -T db psql -q -U ebgeo -d ebgeo_zero -v ON_ERROR_STOP=1 -c "$1" > /dev/null; }

TA=$(entrar admin); TP=$(entrar pedro)
[ -n "$TA" ] && [ -n "$TP" ] || { echo "ERRO: login falhou; o ambiente está de pé?"; exit 1; }

# NORMALIZAÇÃO, e ela não é higiene opcional. Esta sonda MUTA o banco, então uma
# rodada interrompida no meio deixa os dois recursos privados, e a rodada seguinte
# mediria o piso "todo mundo lê" contra um acervo fechado. O primeiro resultado
# desta sonda foi exatamente isso: dois FALHOU no bloco de piso, por estado herdado
# e não por defeito.
echo
echo "--- normalizando: os dois recursos a público ---"
sql "UPDATE tilesets SET access_level='public' WHERE id='PCL';"
sql "UPDATE sv360.projects SET access_level='public';"
docker compose restart backend > /dev/null 2>&1
sleep 8
TA=$(entrar admin); TP=$(entrar pedro)

echo
echo "=== ANTES: os dois recursos públicos, todo mundo lê ==="
checar "3D PCL, anônimo"              200 cheio "$BASE/api/v1/assets3d/PCL/tileset.json"
checar "360 MVT, anônimo"             200 cheio "$BASE/api/v1/sv360/tiles/$TILE360.pbf"

echo
echo "--- tornando os dois privados (e reconstruindo o índice do 3D) ---"
sql "UPDATE tilesets SET access_level='private' WHERE id='PCL';"
sql "UPDATE sv360.projects SET access_level='private';"
docker compose restart backend > /dev/null 2>&1
sleep 8
TA=$(entrar admin); TP=$(entrar pedro)

echo
echo "=== 3D privado: o gate é POR RECURSO, e ele fecha ==="
checar "anônimo"                      404 qualquer "$BASE/api/v1/assets3d/PCL/tileset.json"
checar "um filho .b3dm, anônimo"      404 qualquer "$BASE/api/v1/assets3d/PCL/0/0.b3dm"
checar "usuário comum (pedro)"        404 qualquer -H "Authorization: Bearer $TP" "$BASE/api/v1/assets3d/PCL/tileset.json"
checar "administrador"                200 cheio -H "Authorization: Bearer $TA" "$BASE/api/v1/assets3d/PCL/tileset.json"
# O ACHADO QUE MUDA O PLANO: a chave de API já É credencial aceita aqui, porque
# `flexibleAuth` roda globalmente e lê `?api_key=`. Nada de nginx no caminho.
checar "chave de API de um credenciado" 200 cheio "$BASE/api/v1/assets3d/PCL/tileset.json?api_key=$CHAVE_CREDENCIADO"

echo
echo "=== 360 privado: a recusa é SUBCONJUNTO VAZIO, nunca 401 ==="
# `flexibleAuth` mais `sv360AccessPredicate`: sem principal a rota responde 200 com
# o subconjunto PÚBLICO, que aqui é nada. Quem lê status para decidir se deu certo
# lê 200 nos dois casos; o que separa é o TAMANHO.
checar "anônimo"                      200 vazio "$BASE/api/v1/sv360/tiles/$TILE360.pbf"
checar "usuário comum (pedro)"        200 vazio -H "Authorization: Bearer $TP" "$BASE/api/v1/sv360/tiles/$TILE360.pbf"
checar "administrador"                200 cheio -H "Authorization: Bearer $TA" "$BASE/api/v1/sv360/tiles/$TILE360.pbf"
checar "chave de API de um credenciado" 200 cheio "$BASE/api/v1/sv360/tiles/$TILE360.pbf?api_key=$CHAVE_CREDENCIADO"

echo
echo "--- devolvendo os dois a público ---"
sql "UPDATE tilesets SET access_level='public' WHERE id='PCL';"
sql "UPDATE sv360.projects SET access_level='public';"
docker compose restart backend > /dev/null 2>&1
sleep 8
checar "3D PCL, anônimo, de volta"    200 cheio "$BASE/api/v1/assets3d/PCL/tileset.json"

echo
if [ "$falhas" -eq 0 ]; then
    echo "SONDA VERDE — $(date '+%Y-%m-%d %H:%M')."
else
    echo "SONDA VERMELHA — $falhas caso(s) falharam."
fi
exit "$falhas"
