#!/usr/bin/env bash
# CASO 2 DOS QUATRO: o 360 servido PELO SERVICO (/api/v1/sv360/*).
#
# POR QUE ESTE CASO SE MEDE PORTA A PORTA, e o 3D nao precisou. No 3D existe UM gate
# montado numa rota so, entao provar o gate prova a rota. Aqui nao: cada rota de
# leitura carrega o seu (liftOptionalAtlasId + requireAtlasScopeWhenPresent) e o
# recorte por recurso vive DENTRO DO SQL DE CADA CONSULTA. Ou seja, treze portas de
# leitura com dado nesta maquina, treze predicados, e um predicado esquecido numa
# delas nao aparece nas outras. E exatamente o achado que originou o censo de
# superficies: o MVT do 360 ja passou verde ao ter o predicado revertido, porque a
# suite media privacidade na LISTAGEM e nunca no tile.
#
# O PREDICADO E DE CONTEUDO, NAO DE STATUS, e a diferenca e o coracao desta
# conferencia. A recusa aqui quase nunca e 401 ou 404: flexibleAuth nao bloqueia, e o
# SQL simplesmente devolve o SUBCONJUNTO que o chamador alcanca. Uma listagem vazada e
# uma listagem vazia sao as duas 200. Entao cada caso procura o MARCADOR do dado (o
# slug do projeto, o uuid da foto) DENTRO do corpo, e o que se afirma e presenca no
# publico e ausencia no privado.
#
# O CONTROLE NEGATIVO e o mesmo conjunto de portas com o projeto PUBLICO, percorrido
# pela MESMA funcao. Sem ele, uma porta que devolve vazio porque o acervo desta maquina
# nao tem os bytes seria lida como porta bem guardada. Duas portas estao nessa situacao
# e saem DECLARADAS, fora da contagem.
set -uo pipefail
cd "$(dirname "$0")/.."

BASE="${BASE:-http://localhost}"
S="/api/v1/sv360"
SLUG="multicaptura"
FOTO="08125cc0-4721-5a4c-b5ad-eba0079e1b2c"
NOME_FOTO="MULTICAPTURA_5820_000021.jpg"
# z/x/y sobre as fotos do acervo (-50,206 / -29,982).
TILE="12/1476/2405"
CHAVE_CREDENCIADO="aaaaaaaa-0000-4000-8000-000000000002"
CHAVE_COMUM="aaaaaaaa-0000-4000-8000-000000000001"
falhas=0

sql() { docker compose exec -T db psql -q -U ebgeo -d ebgeo_zero -v ON_ERROR_STOP=1 -c "$1" > /dev/null; }

entrar() {
    curl -s -X POST "$BASE/api/v1/auth/login" -H 'Content-Type: application/json' \
        -d "{\"username\":\"$1\",\"password\":\"${SENHA:-tassofragoso}\"}" \
        | python -c "import sys,json;print(json.load(sys.stdin)['data']['accessToken'])" 2>/dev/null
}

# porta <rotulo> <ve|nao-ve> <marcador> <curl args...>
#
# `ve` afirma que o marcador ESTA no corpo; `nao-ve` afirma que nao esta. Os dois sao
# afirmacoes, e e por isso que o bloco publico existe: sem ele, `nao-ve` passaria verde
# sobre qualquer porta quebrada. O corpo do MVT e binario, e o grep -a le binario como
# texto, que e o suficiente para achar o slug que o proprio tile carrega como
# propriedade.
porta() {
    local rotulo="$1" espera="$2" marcador="$3"
    shift 3
    local achou
    if curl -s "$@" | grep -qaF "$marcador"; then achou="ve"; else achou="nao-ve"; fi
    if [ "$achou" = "$espera" ]; then
        printf '  ok      %-42s %s\n' "$rotulo" "$achou"
    else
        printf '  FALHOU  %-42s esperado %s, obtido %s\n' "$rotulo" "$espera" "$achou"
        falhas=$((falhas + 1))
    fi
}

# Para a porta binaria: o que se afirma e VOLUME, porque um JPEG nao carrega marcador.
bytes() {
    local rotulo="$1" espera="$2"
    shift 2
    local n achou
    n=$(curl -s -o /dev/null -w '%{size_download}' "$@")
    if [ "$n" -gt 100000 ]; then achou="cheio"; else achou="vazio"; fi
    if [ "$achou" = "$espera" ]; then
        printf '  ok      %-42s %s (%s bytes)\n' "$rotulo" "$achou" "$n"
    else
        printf '  FALHOU  %-42s esperado %s, obtido %s (%s bytes)\n' "$rotulo" "$espera" "$achou" "$n"
        falhas=$((falhas + 1))
    fi
}

# status <rotulo> <esperado> <curl args...>
#
# NEM TODA PORTA DESTE MODULO RECUSA DEVOLVENDO SUBCONJUNTO VAZIO, e descobrir isso foi
# o achado da primeira rodada. As que endereçam UM projeto ou UMA foto pelo caminho
# recusam com 404, porque nao ha subconjunto a devolver: ou a linha alcanca o chamador
# ou ela nao existe para ele. Medi-las pelo corpo daria "nao-ve" por vacuidade (corpo de
# erro nao contem o slug), que e verde sem prova.
status() {
    local rotulo="$1" esperado="$2"
    shift 2
    local obtido
    obtido=$(curl -s -o /dev/null -w '%{http_code}' "$@")
    if [ "$obtido" = "$esperado" ]; then
        printf '  ok      %-42s %s
' "$rotulo" "$obtido"
    else
        printf '  FALHOU  %-42s esperado %s, obtido %s
' "$rotulo" "$esperado" "$obtido"
        falhas=$((falhas + 1))
    fi
}

TA=$(entrar admin); TP=$(entrar pedro); TM=$(entrar marcel); TD=$(entrar diniz)
[ -n "$TA" ] || { echo "ERRO: login falhou; o ambiente esta de pe?"; exit 1; }

# TODAS as portas numa funcao so, para que o bloco publico e o privado percorram
# exatamente a mesma lista. Duas listas separadas divergiriam, e a porta que saisse de
# uma delas seria a que ninguem mede.
#
# $1 = 've' ou 'nao-ve' (o que se afirma sobre o marcador no corpo)
# $2 = 'cheio' ou 'vazio' (o que se afirma sobre a porta binaria)
# $3.. = argumentos de credencial repassados ao curl
todas_as_portas() {
    local espera="$1" volume="$2"
    shift 2
    porta "MVT de fotos"                "$espera" "$SLUG" "$@" "$BASE$S/tiles/$TILE.pbf"
    porta "GeoJSON legado"              "$espera" "$SLUG" "$@" "$BASE$S/tiles/fotos.geojson"
    porta "listagem de projetos"        "$espera" "$SLUG" "$@" "$BASE$S/projects"
    porta "detalhe do projeto"          "$espera" "$SLUG" "$@" "$BASE$S/projects/$SLUG"
    porta "fotos do projeto"            "$espera" "$FOTO" "$@" "$BASE$S/projects/$SLUG/photos"
    porta "mapa do projeto"             "$espera" "$FOTO" "$@" "$BASE$S/projects/$SLUG/map"
    # ESTAS DUAS RESPONDEM COM OUTRA FOTO, e o marcador tem de ser do PROJETO, nao da
    # foto fixada: `nearest` devolve a mais proxima do ponto pedido e `nearby` devolve as
    # vizinhas AINDA NAO LIGADAS, ou seja, por construcao, nunca a foto do caminho. A
    # primeira versao desta conferencia usou o uuid fixo nas duas e colheu quatro FALHOU
    # no bloco POSITIVO; o defeito era do marcador, e a licao e que um `nao-ve` so vale
    # se o `ve` do mesmo par tiver passado.
    porta "foto mais proxima"           "$espera" "$SLUG" "$@" "$BASE$S/photos/nearest?lat=-29.982&lon=-50.206"
    porta "foto por nome"               "$espera" "$FOTO" "$@" "$BASE$S/photos/by-name/$NOME_FOTO"
    porta "detalhe da foto"             "$espera" "$FOTO" "$@" "$BASE$S/photos/$FOTO"
    porta "vizinhas da foto"            "$espera" "MULTICAPTURA" "$@" "$BASE$S/photos/$FOTO/nearby"
    bytes "OS BYTES DA FOTO (image)"    "$volume" "$@" "$BASE$S/photos/$FOTO/image"
}

echo
echo "=== CONTROLE NEGATIVO: projeto PUBLICO, o anonimo ve tudo ==="
sql "UPDATE sv360.projects SET access_level='public';"
todas_as_portas "ve" "cheio"

echo
echo "=== O PROJETO VIRA PRIVADO: o anonimo nao ve nada, porta por porta ==="
sql "UPDATE sv360.projects SET access_level='private';"
todas_as_portas "nao-ve" "vazio"

echo
echo "=== O MESMO conjunto, para quem TEM direito (administrador) ==="
todas_as_portas "ve" "cheio" -H "Authorization: Bearer $TA"

echo
echo "=== AS PORTAS QUE RECUSAM POR STATUS, nos dois estados ==="
# Quatro portas enderecam UM projeto ou UMA foto e recusam com 404 em vez de lista
# vazia. O par completo esta aqui: com o projeto PUBLICO o anonimo entra, com ele
# PRIVADO o anonimo leva 404 e o administrador entra. Sem as duas metades, o 404 do
# anonimo poderia ser ausencia de dado (foi o que aconteceu com a miniatura, que da 404
# para todo mundo nos dois estados e por isso segue declarada).
sql "UPDATE sv360.projects SET access_level='public';"
status "andares, publico, anonimo"      200 "$BASE$S/projects/$SLUG/floors"
status "corridas, publico, anonimo"     200 "$BASE$S/projects/$SLUG/runs"
status "detalhe do projeto, publico"    200 "$BASE$S/projects/$SLUG"
status "detalhe da foto, publico"       200 "$BASE$S/photos/$FOTO"
sql "UPDATE sv360.projects SET access_level='private';"
status "andares, privado, anonimo"      404 "$BASE$S/projects/$SLUG/floors"
status "andares, privado, admin"        200 -H "Authorization: Bearer $TA" "$BASE$S/projects/$SLUG/floors"
status "corridas, privado, anonimo"     404 "$BASE$S/projects/$SLUG/runs"
status "corridas, privado, admin"       200 -H "Authorization: Bearer $TA" "$BASE$S/projects/$SLUG/runs"
status "detalhe do projeto, privado"    404 "$BASE$S/projects/$SLUG"
status "detalhe da foto, privado"       404 "$BASE$S/photos/$FOTO"
status "detalhe da foto, admin"         200 -H "Authorization: Bearer $TA" "$BASE$S/photos/$FOTO"

echo
echo "=== Um ramo do predicado por principal, na porta mais barata ==="
porta "usuario comum (pedro)"          "nao-ve" "$SLUG" -H "Authorization: Bearer $TP" "$BASE$S/projects"
porta "produtor de outra OM (marcel)"  "nao-ve" "$SLUG" -H "Authorization: Bearer $TM" "$BASE$S/projects"
porta "credenciado (diniz)"            "ve"     "$SLUG" -H "Authorization: Bearer $TD" "$BASE$S/projects"
porta "chave de API do credenciado"    "ve"     "$SLUG" "$BASE$S/projects?api_key=$CHAVE_CREDENCIADO"
porta "chave de API do usuario comum"  "nao-ve" "$SLUG" "$BASE$S/projects?api_key=$CHAVE_COMUM"

echo
echo "=== O UUID DE ATLAS NAO E SENHA ==="
porta "atlasId inventado, anonimo"     "nao-ve" "$SLUG" "$BASE$S/projects?atlasId=00000000-0000-4000-8000-000000000000"
porta "atlasId inventado, pedro"       "nao-ve" "$SLUG" -H "Authorization: Bearer $TP" "$BASE$S/projects?atlasId=00000000-0000-4000-8000-000000000000"

echo
echo "=== PORTAS SEM BYTES NESTA MAQUINA: declaradas, FORA da contagem ==="
# sv360.photo_pyramids esta vazia no acervo copiado e este projeto nao tem miniatura,
# entao estas tres respondem igual para todo mundo. Conta-las como fechadas seria
# cobertura vazia: elas nao teriam como vazar o que nao existe. Ficam listadas com o
# status dos dois lados, para que a proxima maquina COM piramide as meca de verdade.
# `floors` e `runs` NAO estao mais aqui: o corpo delas e vazio nesta maquina (o acervo
# nao tem andar nem corrida de captura), mas o STATUS discrimina, e por isso elas foram
# para o bloco de status acima. Vazio de dado e vazio de permissao sao coisas diferentes,
# e a porta so sai da contagem quando NENHUMA das duas leituras discrimina, que e o caso
# da miniatura e da piramide: 404 para todo mundo, nos dois estados.
for p in "photos/$FOTO/tiles.json" "photos/$FOTO/tiles/0/0/0" "thumbnails/$SLUG.webp"; do
    printf '  (declarada) %-38s anonimo=%s admin=%s\n' "$p" \
        "$(curl -s -o /dev/null -w '%{http_code}' "$BASE$S/$p")" \
        "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TA" "$BASE$S/$p")"
done

echo
echo "--- devolvendo o projeto a publico ---"
sql "UPDATE sv360.projects SET access_level='public';"
porta "publico de volta, anonimo"      "ve" "$SLUG" "$BASE$S/projects"

echo
if [ "$falhas" -eq 0 ]; then
    echo "CASO 2 (360 via servico) CONFERIDO -- $(date '+%Y-%m-%d %H:%M')."
else
    echo "CASO 2 COM $falhas DESVIO(S)."
fi
exit "$falhas"
