#!/usr/bin/env bash
# O ALVO DA FASE 4: o token de sessao viaja em COOKIE, e o cookie NAO autoriza escrita.
#
# ELE FALHA HOJE, e isso e o ponto -- mesma disciplina de confere-gate-por-recurso.sh.
#
# POR QUE COOKIE. A chave de API e portadora e permanente ate a rotacao: ela aparece no
# log de acesso do nginx, no `Referer` de todo recurso que a pagina carregue depois e em
# todo cache compartilhado que guarde a URL com query. A decisao 3 (# docs/wiki/tile-privado.md) tira a chave do caminho do NAVEGADOR e poe no lugar o mesmo
# JWT de sessao, num cookie. Nao ha credencial nova: o token e um so, e o que muda e a
# porta por onde ele entra.
#
# O COOKIE E O UNICO TRANSPORTE QUE ALCANCA AS TRES SUPERFICIES:
#   - o tile do MapLibre (que tambem aceitaria cabecalho por `transformRequest`),
#   - o `img.src` da cena indoor e o `<video src>` da previa, que NAO aceitam cabecalho e
#     nao tem API que os carimbe -- e o unico defeito que sobrou no caso 3,
#   - o visitante de link publico, que carrega um JWT proprio e nao tem chave nenhuma.
#
# A PONTA SOLTA QUE ELE ABRE, e e ela que a metade de baixo deste script mede: o `auth`
# ESTRITO reusa o `req.user` que o `flexibleAuth` global ja populou, e o `flexibleAuth` le
# o cookie. Logo, um cookie permanente passaria a autorizar ESCRITA, e CSRF deixaria de ser
# hipotese. A correcao nao e um tipo novo de credencial: e DISTINGUIR A ORIGEM
# (`authVia` hoje carimba o mesmo valor para cookie e cabecalho) e fazer o estrito recusar
# a de cookie. Um script que so medisse a metade de cima chancelaria a troca de um buraco
# por outro.
set -uo pipefail
cd "$(dirname "$0")/.."
. "$(dirname "$0")/comum.sh"

T="http://localhost/tiles"
API="http://localhost/api/v1"
BISCOITO="/tmp/ebgeo-cookie-$$.txt"
pendentes=0
falhas=0

trap 'rm -f "$BISCOITO"' EXIT

# alvo <rotulo> <esperado> <curl args...>
alvo() {
    local rotulo="$1" esperado="$2"
    shift 2
    local obtido
    obtido=$(curl -s -o /dev/null -w '%{http_code}' "$@")
    if [ "$obtido" = "$esperado" ]; then
        printf '  ok       %-50s %s\n' "$rotulo" "$obtido"
    else
        printf '  PENDENTE %-50s alvo %s, hoje %s\n' "$rotulo" "$esperado" "$obtido"
        pendentes=$((pendentes + 1))
    fi
}

# firme <rotulo> <esperado> <curl args...>  -- o que ja vale e nao pode regredir.
firme() {
    local rotulo="$1" esperado="$2"
    shift 2
    local obtido
    obtido=$(curl -s -o /dev/null -w '%{http_code}' "$@")
    if [ "$obtido" = "$esperado" ]; then
        printf '  ok       %-50s %s\n' "$rotulo" "$obtido"
    else
        printf '  REGREDIU %-50s esperado %s, obtido %s\n' "$rotulo" "$esperado" "$obtido"
        falhas=$((falhas + 1))
    fi
}

echo
echo "=== 1. O LOGIN passa a emitir o cookie ==="
rm -f "$BISCOITO"
# `admin` alcanca todo recurso privado; e o principal mais simples para medir transporte.
cabecalhos=$(curl -s -D - -o /dev/null -c "$BISCOITO" -X POST "$API/auth/login" \
    -H 'Content-Type: application/json' \
    -d '{"username":"admin","password":"tassofragoso"}')

if printf '%s' "$cabecalhos" | grep -qi '^set-cookie:.*token='; then
    printf '  ok       %-50s presente\n' "Set-Cookie: token no login"
else
    printf '  PENDENTE %-50s ausente\n' "Set-Cookie: token no login"
    pendentes=$((pendentes + 1))
fi
# As flags que tornam o cookie seguro. `httpOnly` impede o script da pagina de le-lo, e
# `SameSite` e a primeira das duas camadas contra CSRF (a segunda e a recusa do estrito).
for flag in HttpOnly SameSite; do
    if printf '%s' "$cabecalhos" | grep -i '^set-cookie:.*token=' | grep -qi "$flag"; then
        printf '  ok       %-50s presente\n' "flag $flag no cookie"
    else
        printf '  PENDENTE %-50s ausente\n' "flag $flag no cookie"
        pendentes=$((pendentes + 1))
    fi
done

echo
echo "=== 2. O cookie SOZINHO abre o tile privado de quem tem direito ==="
# Sem `api_key` na URL e sem `Authorization`: so o cookie, que e como o navegador pede um
# tile. Se isto passar, a chave portadora sai do caminho do navegador.
alvo "tile privado, so com cookie"           200 -b "$BISCOITO" "$T/areas_treinamento"
alvo "tiles dele, so com cookie"             200 -b "$BISCOITO" "$T/areas_treinamento/10/385/577"
alvo "raster privado, so com cookie"         200 -b "$BISCOITO" "$T/dem-restrito/10/385/577.png"

echo
echo "=== 3. E o cookie alcanca a cena indoor, que NENHUM cabecalho alcanca ==="
# `itens/*.jpg` vira `img.src`, que nao carrega cabecalho e nao tem API para carimbar. E o
# unico defeito que sobrou do caso 3, e o cookie e o unico transporte que o fecha.
CENA="http://localhost/api/v1/assets3d/primeira-pessoa/museu-1cgeo"
sql_catalogo "UPDATE tilesets SET access_level='private' WHERE id='museu-1cgeo';" > /dev/null 2>&1
alvo "item da cena privada, so com cookie"   200 -b "$BISCOITO" "$CENA/itens/item_001.jpg"
firme "o mesmo item, ANONIMO"                404 "$CENA/itens/item_001.jpg"
sql_catalogo "UPDATE tilesets SET access_level='public' WHERE id='museu-1cgeo';" > /dev/null 2>&1

echo
echo "=== 4. O COOKIE NAO AUTORIZA ESCRITA -- a ponta solta, fechada ==="
# O `auth` estrito reusa o `req.user` que o `flexibleAuth` populou a partir do cookie.
# Sem a distincao de origem, emitir o cookie no login abriria toda rota de escrita a CSRF.
# O alvo e 401: a porta de escrita exige cabecalho.
#
# ESTE BLOCO E VAZIO ENQUANTO O COOKIE NAO EXISTIR, e ele diz isso em voz alta em vez de
# reportar verde. Sem cookie no arquivo, "escrita so com cookie" e uma requisicao ANONIMA,
# e o 401 vem de nao haver credencial nenhuma, nao da origem dela. Contar isso como prova
# seria a cobertura vazia que a constituicao nomeia: um verde que nao estaria provando
# nada se o codigo estivesse errado.
if ! grep -q "token" "$BISCOITO" 2>/dev/null; then
    printf '  VAZIO    %-50s sem cookie, nao ha o que medir
' "POST de escrita SO com cookie"
    printf '  VAZIO    %-50s sem cookie, nao ha o que medir
' "PUT de conta SO com cookie"
    pendentes=$((pendentes + 2))
else
alvo "POST de escrita SO com cookie" 401 -b "$BISCOITO" -X POST "$API/atlas" \
    -H 'Content-Type: application/json' -d '{"name":"sonda-cookie"}'
alvo "PUT de conta SO com cookie"    401 -b "$BISCOITO" -X PUT "$API/users/me/password" \
    -H 'Content-Type: application/json' -d '{"currentPassword":"x","newPassword":"y"}'
fi

echo
echo "=== 5. O MESMO token, por CABECALHO, continua escrevendo ==="
# O par positivo, e sem ele o bloco acima passaria com um servidor que simplesmente
# recusasse toda escrita. O token e o mesmo; o que muda e a porta.
TOKEN=$(curl -s -X POST "$API/auth/login" -H 'Content-Type: application/json' \
    -d '{"username":"admin","password":"tassofragoso"}' \
    | python -c "import sys,json;print(json.load(sys.stdin)['data']['accessToken'])" 2>/dev/null)
firme "leitura de conta por cabecalho"       200 -H "Authorization: Bearer $TOKEN" "$API/auth/me"
firme "POST de escrita por cabecalho"        201 -H "Authorization: Bearer $TOKEN" \
    -X POST "$API/atlas" -H 'Content-Type: application/json' -d '{"name":"sonda-cabecalho"}'
# O par positivo CRIA um atlas a cada rodada, e uma sonda que suja o ambiente a cada
# execucao acaba desligada. A limpeza e por SQL porque a rota de exclusao e soft-delete,
# entao a linha ficaria la de qualquer jeito.
sql "DELETE FROM atlas WHERE name IN ('sonda-cabecalho', 'sonda-cookie');" > /dev/null 2>&1

echo
echo "=== 6. O que NAO pode regredir ==="
firme "tile privado, ANONIMO"                401 "$T/areas_treinamento"
firme "tile publico, ANONIMO"                200 "$T/hidrografia"
firme "o app continua bootando"              200 "http://localhost/api/config"

echo
if [ "$falhas" -gt 0 ]; then
    echo "REGRESSAO: $falhas caso(s) que ja valiam pararam de valer."
    exit 1
fi
if [ "$pendentes" -gt 0 ]; then
    echo "ALVO AINDA NAO ALCANCADO: $pendentes caso(s). Isto e o esperado ANTES da fase 4."
    exit "$pendentes"
fi
echo "COOKIE DE SESSAO: alvo alcancado -- $(date '+%Y-%m-%d %H:%M')."
