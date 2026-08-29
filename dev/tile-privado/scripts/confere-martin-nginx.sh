#!/usr/bin/env bash
# CASO 4 DOS QUATRO: o que o MARTIN serve (camada de dados, de analise e basemap),
# gateado no NGINX e nao no servico.
#
# ESTE CASO E DE OUTRA NATUREZA, e confundi-lo com os tres primeiros e o erro que este
# cabecalho existe para impedir. Nos casos 1 a 3 o Node esta no caminho dos bytes e o
# predicado sabe QUAL recurso foi pedido: a resposta e sobre a pessoa E sobre a camada.
# Aqui o Node nao ve o tile passar. O `location` do nginx pergunta a este backend uma
# unica coisa, por `auth_request`: esta credencial esta viva? Ele nao manda o caminho,
# nao resolve camada nenhuma, e `fn_can_see_resource` nao entra na historia (cláusula
# 10.7 e o `fileoverview` de backend/src/modules/auth/tile-access.js).
#
# ENTAO A PROTECAO AQUI TEM DUAS METADES QUE PRECISAM SER MEDIDAS SEPARADAS:
#
#   METADE 1, o CATALOGO, que funciona por recurso. A URL do tile de uma camada privada
#   nao sai para quem nao pode ve-la. Sao DUAS portas, e a pendencia nomeia as duas:
#   `/api/config` (memoizado, NAO varia por chamador, entao a linha privada some dele
#   para todo mundo) e `/api/v1/resource-access/visible` (autenticado, aditivo, e onde
#   quem tem direito recebe a URL). Isto e medido abaixo, ramo por ramo de papel.
#
#   METADE 2, os BYTES, que NAO funciona por recurso. Quem porta uma chave de API viva
#   alcanca o tile de QUALQUER camada, inclusive de uma que o catalogo lhe esconde. Isso
#   nao e defeito de implementacao: e a limitacao DECLARADA da decisao do dono de
#   2026-08-24 pelo sim/nao simples. Este script a mede em voz alta, marcada DEFEITO, em
#   vez de deixa-la implicita num paragrafo.
#
# O QUE ELE COMPRA MESMO ASSIM, e e real: os bytes saem de "abertos para a internet
# inteira" para "exigem uma chave viva". O tamanho do publico muda; quem, dentro dele,
# ve o que, nao muda.
#
# A ARMADILHA QUE ESTE SCRIPT PEGOU NA PRIMEIRA RODADA: quatro FALHOU dizendo que a
# camada privada continuava saindo no `/api/config`, para o administrador inclusive. Nao
# era vazamento, era o memo daquele endpoint (30 s) servindo o payload de antes da
# escrita. Toda escrita de catalogo aqui passa por `sql_catalogo`, que invalida.
#
# NAO MEDIDO AQUI, declarado: a SEGUNDA porta de saida da URL na reidratacao do
# snapshot de sync (`GET_VISIBLE_CATALOG_DEFINITIONS`), porque ela exige um atlas
# montado e o banco copiado tem zero atlas.
set -uo pipefail
cd "$(dirname "$0")/.."

BASE="${BASE:-http://localhost}"
CHAVE_CREDENCIADO="aaaaaaaa-0000-4000-8000-000000000002"   # diniz, ve todo privado
CHAVE_COMUM="aaaaaaaa-0000-4000-8000-000000000001"         # pedro, nao ve nada privado
CAMADA="rodovias-federais"
URL_TILE="tiles/rodovias"
# O MARCADOR DO BASEMAP E UMA URL CUNHADA, e nao o id da linha, porque o id NAO
# discrimina: `basemapStyles` comeca dos construtores ESTATICOS de variavel de ambiente
# e so entao recebe o override de `config.style` de cada linha
# (`listBasemapStyles`, backend/src/modules/config/config.service.js). O estilo estatico
# do BDGEx e homonimo da linha de catalogo e e PUBLICO por desenho declarado (a
# pendencia poe `BDGEX_WMS_URL` entre os enderecos de env, globais e fora de escopo).
# Procurar "bdgex" no payload acusa aquele, nao este, e foi o que deu o unico FALHOU da
# primeira rodada: um alarme sobre um vazamento que nao existia.
#
# Esta URL so pode ter vindo do `config.style` da linha, entao ela mede o que o
# enunciado da pendencia previa: "o basemap privado tem o mesmo defeito, com agravante,
# o estilo viaja inteiro no payload". Medido: nao viaja.
URL_BASEMAP="tiles/basemap-secreto"
# PELA MESMA RAZAO do basemap, a analise tem marcador CUNHADO e nao o id: desde que o
# cenario de teste existe ha uma segunda linha de analise com a palavra "declividade" no
# id, e ela e PUBLICA. Procurar o id acusava aquela, e o FALHOU resultante parecia
# vazamento da linha privada. Marcador que casa mais de uma linha nao mede nenhuma.
URL_ANALISE="tiles/analise-secreta"
falhas=0
defeitos=0

# `sql`, `sql_catalogo`, `reiniciar` e `entrar` vivem em comum.sh. `sql_catalogo` e o que
# impede a medicao do CACHE em vez do gate; o motivo esta escrito la.
. "$(dirname "$0")/comum.sh"

# ve <rotulo> <ve|nao-ve> <marcador> <curl args...>
ve() {
    local rotulo="$1" espera="$2" marcador="$3"
    shift 3
    local achou
    if curl -s "$@" | grep -qaF "$marcador"; then achou="ve"; else achou="nao-ve"; fi
    if [ "$achou" = "$espera" ]; then
        printf '  ok      %-46s %s\n' "$rotulo" "$achou"
    else
        printf '  FALHOU  %-46s esperado %s, obtido %s\n' "$rotulo" "$espera" "$achou"
        falhas=$((falhas + 1))
    fi
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

# defeito <rotulo> <status previsto> <curl args...>
# O desfecho esperado E o comportamento ruim, e ele sai marcado como tal para que o
# relatorio nao chame de `ok` uma limitacao. Se o recorte por recurso for feito um dia,
# esta linha fica vermelha, que e o aviso que se quer.
defeito() {
    local rotulo="$1" esperado="$2"
    shift 2
    local obtido
    obtido=$(curl -s -o /dev/null -w '%{http_code}' "$@")
    if [ "$obtido" = "$esperado" ]; then
        printf '  DEFEITO %-46s %s (limitacao declarada da 10.7)\n' "$rotulo" "$obtido"
        defeitos=$((defeitos + 1))
    else
        printf '  MUDOU   %-46s previa %s, obtido %s -- reveja a conclusao\n' "$rotulo" "$esperado" "$obtido"
        falhas=$((falhas + 1))
    fi
}

TA=$(entrar admin); TP=$(entrar pedro); TM=$(entrar marcel); TD=$(entrar diniz)
[ -n "$TA" ] || { echo "ERRO: login falhou; o ambiente esta de pe?"; exit 1; }

echo
echo "=== CONTROLE NEGATIVO: camada PUBLICA, a URL sai no config para o anonimo ==="
sql_catalogo "UPDATE data_layers SET access_level='public', owner_org_id=NULL WHERE id='$CAMADA';"
sql_catalogo "UPDATE basemaps SET access_level='public' WHERE id='bdgex';"
sql_catalogo "UPDATE analysis_layers SET access_level='public', config = jsonb_set(config,'{source,url}', to_jsonb('http://localhost/'||'$URL_ANALISE'||'/{z}/{x}/{y}.png')) WHERE id='declividade';"
ve "URL do tile em /api/config"            "ve" "$URL_TILE" "$BASE/api/config"
ve "estilo do basemap em /api/config"      "ve" "$URL_BASEMAP" "$BASE/api/config"
ve "endereco da analise em /api/config"    "ve" "$URL_ANALISE" "$BASE/api/config"

echo
echo "=== METADE 1: as tres viram privadas e SOMEM do /api/config ==="
# O `/api/config` e memoizado e NAO varia por chamador, e isso e deliberado: e o
# documento cujo fracasso impede o boot. Entao a linha privada some dele para TODO
# mundo, administrador inclusive, e o que ele perde volta pelo segundo endpoint.
sql_catalogo "UPDATE data_layers SET access_level='private' WHERE id='$CAMADA';"
sql_catalogo "UPDATE basemaps SET access_level='private' WHERE id='bdgex';"
sql_catalogo "UPDATE analysis_layers SET access_level='private' WHERE id='declividade';"
ve "URL do tile, anonimo"                  "nao-ve" "$URL_TILE" "$BASE/api/config"
ve "URL do tile, ADMINISTRADOR"            "nao-ve" "$URL_TILE" -H "Authorization: Bearer $TA" "$BASE/api/config"
ve "estilo do basemap privado, anonimo"    "nao-ve" "$URL_BASEMAP" "$BASE/api/config"
ve "estilo do basemap, credenciado"        "ve"     "$URL_BASEMAP" -H "Authorization: Bearer $TD" "$BASE/api/v1/resource-access/visible"
ve "endereco da analise privada, anonimo"  "nao-ve" "$URL_ANALISE" "$BASE/api/config"
ve "endereco da analise, credenciado"      "ve"     "$URL_ANALISE" -H "Authorization: Bearer $TD" "$BASE/api/v1/resource-access/visible"

echo
echo "=== METADE 1, segunda porta: /resource-access/visible, ramo por ramo ==="
checar "anonimo (rota tem auth ESTRITO)"   401 "$BASE/api/v1/resource-access/visible"
ve "usuario comum (pedro)"                 "nao-ve" "$URL_TILE" -H "Authorization: Bearer $TP" "$BASE/api/v1/resource-access/visible"
ve "produtor de outra OM (marcel)"         "nao-ve" "$URL_TILE" -H "Authorization: Bearer $TM" "$BASE/api/v1/resource-access/visible"
ve "credenciado (diniz)"                   "ve"     "$URL_TILE" -H "Authorization: Bearer $TD" "$BASE/api/v1/resource-access/visible"
ve "administrador"                         "ve"     "$URL_TILE" -H "Authorization: Bearer $TA" "$BASE/api/v1/resource-access/visible"

echo
echo "=== METADE 1, o ramo da PRODUCAO ==="
sql_catalogo "UPDATE data_layers SET owner_org_id=(SELECT producer_org_id FROM users WHERE username='marcel') WHERE id='$CAMADA';"
ve "produtor da OM DONA (marcel)"          "ve"     "$URL_TILE" -H "Authorization: Bearer $TM" "$BASE/api/v1/resource-access/visible"
ve "usuario comum, mesma linha"            "nao-ve" "$URL_TILE" -H "Authorization: Bearer $TP" "$BASE/api/v1/resource-access/visible"
sql_catalogo "UPDATE data_layers SET owner_org_id=NULL WHERE id='$CAMADA';"

echo
echo "=== METADE 1, o campo IRMAO: labelSource sai junto ==="
# `config.labelSource` e uma SEGUNDA fonte de tile, independente de `config.source`, e a
# pendencia a nomeia como a armadilha de quem escrever "reescreve source.url". Aqui ela
# nao e um risco separado, porque o que o catalogo esconde e a LINHA INTEIRA; medir isso
# e o que autoriza a afirmar que os dois campos somem juntos, em vez de supor.
sql_catalogo "UPDATE data_layers SET config = jsonb_set(config, '{labelSource}', '{\"url\": \"http://localhost/tiles/rotulos-secretos\", \"type\": \"vector\"}'::jsonb) WHERE id='$CAMADA';"
ve "labelSource privado, anonimo"          "nao-ve" "rotulos-secretos" "$BASE/api/config"
ve "labelSource, credenciado (sai junto)"  "ve"     "rotulos-secretos" -H "Authorization: Bearer $TD" "$BASE/api/v1/resource-access/visible"
sql_catalogo "UPDATE data_layers SET config = config - 'labelSource' WHERE id='$CAMADA';"

echo
echo "=== METADE 2: OS BYTES. O nginx pergunta pela CREDENCIAL, nunca pela CAMADA ==="
checar "sem chave nenhuma"                 401 "$BASE/$URL_TILE"
checar "chave viva do credenciado"         200 "$BASE/$URL_TILE?api_key=$CHAVE_CREDENCIADO"
# A LINHA QUE RESUMIA O CASO 4, E QUE MUDOU DE LADO EM 2026-08-29. `pedro` e usuario
# comum e nao ve esta camada em nenhuma das duas portas do catalogo (medido acima, duas
# vezes). Ate esta data ele baixava os bytes dela mesmo assim, porque o `auth_request`
# perguntava so pela credencial; os dois casos abaixo estavam marcados DEFEITO, com a
# limitacao declarada da clausula 10.7 escrita ao lado.
#
# O GATE PASSOU A DECIDIR POR RECURSO, e foi este script que avisou: os dois casos
# viraram `MUDOU` na primeira rodada depois da implementacao, que e exatamente o que a
# funcao `defeito` existe para fazer -- um desfecho previsto que deixa de se reproduzir
# pede que a conclusao seja revista, em vez de passar despercebido como verde.
checar "chave de quem NAO ve a camada"     401 "$BASE/$URL_TILE?api_key=$CHAVE_COMUM"
checar "e os tiles, nao so o TileJSON"     401 "$BASE/$URL_TILE/10/385/577?api_key=$CHAVE_COMUM"
# E o par positivo, que impede a leitura "agora recusa tudo": a mesma camada, para quem a
# alcanca, continua abrindo.
checar "e o credenciado continua alcancando" 200 "$BASE/$URL_TILE?api_key=$CHAVE_CREDENCIADO"

echo
echo "=== O EMPRESTIMO POR ATLAS NAO ALCANCA O TILE (clausula 6.7) ==="
# DEFEITO MEDIDO em 2026-08-29, e ele nao foi achado por estas conferencias: elas mediam
# `?atlasId=` INVENTADO, que tem de dar 401, e nunca um emprestimo REAL passando. Um par
# negativo sem o positivo do mesmo eixo passa verde sobre um ramo que nao funciona.
#
# A causa: o ramo de emprestimo do predicado depende do atlas em foco, que chega por
# `?atlasId=`, e a subrequisicao do `auth_request` chega SEM QUERY. O gate do tile decide
# sempre com atlas nulo.
API="$BASE/api/v1"
PID=$(curl -s -H "Authorization: Bearer $TP" "$API/auth/me" | python -c "import sys,json;print(json.load(sys.stdin)['data']['id'])" 2>/dev/null)
AT=$(curl -s -H "Authorization: Bearer $TA" -X POST "$API/atlas" -H 'Content-Type: application/json'      -d '{"name":"sonda-emprestimo-tile"}' | python -c "import sys,json;print(json.load(sys.stdin)['data']['id'])" 2>/dev/null)
curl -s -o /dev/null -H "Authorization: Bearer $TA" -X POST "$API/atlas/$AT/resources"      -H 'Content-Type: application/json' -d '{"resourceType":"data_layer","resourceId":"'"$CAMADA"'"}'
curl -s -o /dev/null -H "Authorization: Bearer $TA" -X POST "$API/atlas/$AT/sharing/users"      -H 'Content-Type: application/json' -d '{"userId":"'"$PID"'","permission":"read"}'
sql_catalogo "UPDATE data_layers SET access_level='private' WHERE id='$CAMADA';"

# O par POSITIVO, no catalogo: sem ele, o 401 do tile poderia vir de o emprestimo nao
# existir, e nao de o gate nao ve-lo.
ve "o emprestimo VALE no catalogo aditivo"  "ve" "$URL_TILE" -H "Authorization: Bearer $TP" "$API/resource-access/visible?atlasId=$AT"
defeito "e o TILE da mesma camada recusa"   401 -H "Authorization: Bearer $TP" "$BASE/$URL_TILE"
defeito "e recusa ate com ?atlasId= na URL" 401 -H "Authorization: Bearer $TP" "$BASE/$URL_TILE?atlasId=$AT"

sql "DELETE FROM atlas_resources WHERE atlas_id='$AT';"
sql "DELETE FROM atlas_shares WHERE atlas_id='$AT';"
sql "DELETE FROM atlas WHERE id='$AT';"

echo
echo "--- devolvendo as tres linhas ao estado original ---"
sql_catalogo "UPDATE data_layers SET access_level='public' WHERE id='$CAMADA';"
sql_catalogo "UPDATE basemaps SET access_level='public' WHERE id='bdgex';"
sql_catalogo "UPDATE analysis_layers SET access_level='public', config = jsonb_set(config,'{source,url}', to_jsonb('http://localhost/'||'$URL_ANALISE'||'/{z}/{x}/{y}.png')) WHERE id='declividade';"
ve "URL do tile de volta no config"        "ve" "$URL_TILE" "$BASE/api/config"

echo
echo "Metade 1 (catalogo, por recurso): $(( 21 - falhas ))/21 corretas."
echo "Metade 2 (bytes, por credencial): $defeitos porta(s) alcancada(s) por quem nao ve a camada."
if [ "$falhas" -eq 0 ]; then
    echo "CASO 4 (Martin via nginx) CONFERIDO -- $(date '+%Y-%m-%d %H:%M'). Ver as linhas DEFEITO."
else
    echo "CASO 4 COM $falhas DESVIO(S) INESPERADO(S)."
fi
exit "$falhas"
