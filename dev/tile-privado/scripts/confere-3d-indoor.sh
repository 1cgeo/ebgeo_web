#!/usr/bin/env bash
# CASO 3 DOS QUATRO: a CENA INDOOR de primeira pessoa (Gaussian splatting).
#
# ELA E SERVIDA PELO SERVICO, e essa e a primeira coisa a dizer porque contraria o
# enunciado com que este caso costuma ser descrito. No acervo real a linha `museu-1cgeo`
# declara `basePath: /api/v1/assets3d/primeira-pessoa/museu-1cgeo`, os 29 MB da cena
# moram no FILESYSTEM (nao no SQLite, ao contrario dos tilesets), e o mesmo
# `gateDeAsset3d` do caso 1 esta no caminho. Ou seja, o SERVIDOR ja sabe recusar.
#
# O QUE FAZ DELE UM CASO SEPARADO E O CLIENTE. Uma cena tem SETE enderecos derivados do
# `basePath` (`SCENE_LAYOUT` em frontend/src/js/first_person_3d_tool/scene-config.service.js)
# mais a foto de cada marcador, e eles se dividem em DOIS regimes de credencial:
#
#   COM CABECALHO (fetch nosso, carimbado por `cabecalhosDeAsset`):
#     marcadores.json, voxel/voxel-meta.json, voxel/voxel.bin
#     e, desde 2026-08-29, cena.sog -- os 20 MB do modelo. Ele estava DE FORA por
#     omissao e nao por limitacao: `loadSplat`
#     (frontend/src/js/first_person_3d_tool/first_person_viewer.js) fazia
#     `fetch(splatUrl)` cru, le o `arrayBuffer()` e SO ENTAO entrega os bytes ao parser
#     do motor, ou seja o carregador de terceiro nunca tocou a rede. Foi esta
#     conferencia que o achou: numa cena privada, os tres primeiros carregavam para o
#     administrador e o modelo levava 404, o que na tela se le como visualizador
#     quebrado e nao como negacao. O carimbo agora esta la, preso por
#     `frontend/tests/unit/cena-indoor-carimba-credencial.test.js`.
#   SEM CABECALHO E SEM COMO TER UM (o navegador busca sozinho):
#     itens/*.jpg e a foto do marcador -> viram `img.src`
#     preview/* -> viram `<video src>` e `img.src`
#
# A DISTINCAO ENTRE OMISSAO E LIMITACAO FOI O ACHADO DESTE CASO, e ela contrariava o
# comentario que morava em `resolveSceneAssets`, que contava o splat entre os enderecos
# "nao buscados pelo nosso codigo". Aquele comentario foi corrigido no mesmo commit do
# carimbo: estar do lado errado daquela lista era o que mantinha a omissao invisivel.
#
# `img.src` e `<video src>` NAO CARREGAM CABECALHO. Para elas a unica autorizacao que
# atravessa e o `?atlasId=` carimbado na URL por `escoparUrlDeAsset`, que e o
# EMPRESTIMO do atlas em foco. Quem enxerga a cena privada por PAPEL GLOBAL ou por
# CONCESSAO PESSOAL, sem atlas em foco, tem credencial que nao viaja.
#
# ENTAO ESTE SCRIPT MEDE AS DUAS PONTAS DO MESMO DEFEITO:
#   1. a cena privada FECHA para quem nao tem direito (todas as portas), e
#   2. ela tambem fecha, nas portas sem cabecalho, para quem TEM direito.
# O item 2 nao e uma falha do script: e o defeito gemeo da pendencia, vivo, medido, e a
# razao de o indoor ser um caso proprio. Ele sai marcado como DEFEITO no relatorio, e
# nao como `ok`, porque um numero previsto nao deixa de ser um numero ruim.
set -uo pipefail
cd "$(dirname "$0")/.."

BASE="${BASE:-http://localhost}"
A="/api/v1/assets3d"
CENA="$A/primeira-pessoa/museu-1cgeo"
CHAVE_CREDENCIADO="aaaaaaaa-0000-4000-8000-000000000002"
falhas=0
defeitos=0

sql() { docker compose exec -T db psql -q -U ebgeo -d ebgeo_zero -v ON_ERROR_STOP=1 -c "$1" > /dev/null; }
reiniciar() { docker compose restart backend > /dev/null 2>&1; sleep 8; }
entrar() {
    curl -s -X POST "$BASE/api/v1/auth/login" -H 'Content-Type: application/json' \
        -d "{\"username\":\"$1\",\"password\":\"${SENHA:-tassofragoso}\"}" \
        | python -c "import sys,json;print(json.load(sys.stdin)['data']['accessToken'])" 2>/dev/null
}

checar() {
    local rotulo="$1" esperado="$2"
    shift 2
    local obtido
    obtido=$(curl -s -o /dev/null -w '%{http_code}' "$@")
    if [ "$obtido" = "$esperado" ]; then
        printf '  ok      %-46s %s\n' "$rotulo" "$obtido"
    else
        printf '  FALHOU  %-46s esperado %s, obtido %s\n' "$rotulo" "$esperado" "$obtido"
        falhas=$((falhas + 1))
    fi
}

# defeito <rotulo> <status que o defeito produz> <curl args...>
#
# Igual a `checar`, mas o desfecho esperado E o comportamento ruim. Existe para que o
# relatorio nao chame de `ok` uma tela que nao desenha para quem tem direito. Se um dia
# o carimbo de credencial alcancar estas portas, ESTE caso fica vermelho, que e
# exatamente o aviso que se quer.
defeito() {
    local rotulo="$1" esperado="$2"
    shift 2
    local obtido
    obtido=$(curl -s -o /dev/null -w '%{http_code}' "$@")
    if [ "$obtido" = "$esperado" ]; then
        printf '  DEFEITO %-46s %s (previsto: credencial nao viaja)\n' "$rotulo" "$obtido"
        defeitos=$((defeitos + 1))
    else
        printf '  MUDOU   %-46s previa %s, obtido %s -- reveja a conclusao\n' "$rotulo" "$esperado" "$obtido"
        falhas=$((falhas + 1))
    fi
}

TA=$(entrar admin); TP=$(entrar pedro); TD=$(entrar diniz)
[ -n "$TA" ] || { echo "ERRO: login falhou; o ambiente esta de pe?"; exit 1; }

echo
echo "=== CONTROLE NEGATIVO: cena PUBLICA, tudo abre sem credencial ==="
# Sem este bloco, um 404 por arquivo ausente (a pasta preview/ desta cena esta VAZIA)
# seria lido como recusa do gate.
sql "UPDATE tilesets SET access_level='public' WHERE id='museu-1cgeo';"
reiniciar
checar "marcadores.json (fetch nosso)"        200 "$BASE$CENA/marcadores.json"
checar "voxel/voxel-meta.json (fetch nosso)"  200 "$BASE$CENA/voxel/voxel-meta.json"
checar "voxel/voxel.bin (fetch nosso)"        200 "$BASE$CENA/voxel/voxel.bin"
checar "cena.sog (fetch nosso, sem cabecalho)" 200 "$BASE$CENA/cena.sog"
checar "itens/item_001.jpg (img.src)"         200 "$BASE$CENA/itens/item_001.jpg"

echo
echo "=== A CENA VIRA PRIVADA: fecha para quem NAO tem direito ==="
sql "UPDATE tilesets SET access_level='private' WHERE id='museu-1cgeo';"
reiniciar
checar "marcadores.json, anonimo"             404 "$BASE$CENA/marcadores.json"
checar "voxel-meta.json, anonimo"             404 "$BASE$CENA/voxel/voxel-meta.json"
checar "voxel.bin, anonimo"                   404 "$BASE$CENA/voxel/voxel.bin"
checar "cena.sog, anonimo"                    404 "$BASE$CENA/cena.sog"
checar "item_001.jpg, anonimo"                404 "$BASE$CENA/itens/item_001.jpg"
checar "usuario comum (pedro), cena.sog"      404 -H "Authorization: Bearer $TP" "$BASE$CENA/cena.sog"

echo
echo "=== AS QUATRO PORTAS QUE O NOSSO fetch BUSCA: a credencial viaja ==="
# Estas sao as unicas em que `cabecalhosDeAsset` tem onde ser posto. O `cena.sog` entrou
# nesta lista em 2026-08-29: ate entao ele estava na de baixo, por omissao.
checar "marcadores.json, administrador"       200 -H "Authorization: Bearer $TA" "$BASE$CENA/marcadores.json"
checar "voxel-meta.json, administrador"       200 -H "Authorization: Bearer $TA" "$BASE$CENA/voxel/voxel-meta.json"
checar "voxel.bin, administrador"             200 -H "Authorization: Bearer $TA" "$BASE$CENA/voxel/voxel.bin"
checar "cena.sog, administrador (carimbado)"  200 -H "Authorization: Bearer $TA" "$BASE$CENA/cena.sog"
checar "cena.sog, credenciado (carimbado)"    200 -H "Authorization: Bearer $TD" "$BASE$CENA/cena.sog"
checar "marcadores.json, credenciado"         200 -H "Authorization: Bearer $TD" "$BASE$CENA/marcadores.json"

echo
echo "=== A PORTA QUE SEGUE SEM CABECALHO: o defeito gemeo, reduzido ==="
# O pedido chega ANONIMO ao servidor mesmo com o administrador logado, porque `img.src`
# nao tem onde carimbar. Reproduzo literalmente: mesma URL, sem cabecalho, que e como o
# navegador a pede hoje. Eram DOIS casos aqui ate 2026-08-29; o outro era o `cena.sog`,
# e ele subiu para o bloco de cima quando o `fetch` passou a carimbar.
#
# UM TERCEIRO ENDERECO NAO ENTRA AQUI POR NAO TER CONSUMIDOR: `itemsBaseUrl` e derivado
# e nada em `frontend/src/js/` o le. Como `override_height` no 360, ele sobrevive como
# campo sem leitor, e medi-lo daria a impressao de cobrir uma superficie que ninguem usa.
defeito "item_001.jpg: img.src, sem API possivel" 404 "$BASE$CENA/itens/item_001.jpg"

echo
echo "=== O QUE SALVA HOJE: a chave de API na URL, que o img.src carrega ==="
# `escoparUrlDeAsset` carimba `?atlasId=` para o caso do emprestimo. A chave de API e a
# outra coisa que viaja numa URL, e ela ALCANCA estas portas, o que faz dela o unico
# transporte hoje capaz de servir as sete de uma vez. Nao e o desenho pretendido (a
# chave e portadora e vai para o log de acesso), mas e o dado que decide o conserto.
checar "cena.sog com api_key do credenciado"  200 "$BASE$CENA/cena.sog?api_key=$CHAVE_CREDENCIADO"
checar "item_001.jpg com api_key"             200 "$BASE$CENA/itens/item_001.jpg?api_key=$CHAVE_CREDENCIADO"

echo
echo "--- devolvendo a cena a publica ---"
sql "UPDATE tilesets SET access_level='public' WHERE id='museu-1cgeo';"
reiniciar
checar "publica de volta, anonimo"            200 "$BASE$CENA/cena.sog"

echo
echo "Medidas: $(( 18 - falhas ))/18 corretas, $defeitos porta(s) fechada(s) TAMBEM para quem tem direito."
if [ "$falhas" -eq 0 ]; then
    echo "CASO 3 (3D indoor) CONFERIDO -- $(date '+%Y-%m-%d %H:%M'). Ver as linhas DEFEITO."
else
    echo "CASO 3 COM $falhas DESVIO(S) INESPERADO(S)."
fi
exit "$falhas"
