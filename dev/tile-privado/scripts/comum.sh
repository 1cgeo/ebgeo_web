#!/usr/bin/env bash
# O QUE OS QUATRO SCRIPTS DE CONFERENCIA COMPARTILHAM.
#
# ELE EXISTE POR UMA RECORRENCIA, e nao por elegancia. Escrever `access_level` direto no
# banco e medir em seguida NAO mede o gate: mede o CACHE. Sao tres estruturas derivadas
# das mesmas linhas de catalogo, todas em memoria do processo e todas invalidadas pela
# ESCRITA PELA ROTA, que uma sonda com psql nao aciona:
#
#   - o memo de `/api/config` (30 s por `CONFIG_CACHE_TTL_MS`),
#   - o indice de regime de `assets3d-regime.js` (60 s de teto),
#   - o memo de decisao de `assets3d-acesso.js` (30 s).
#
# O DESFECHO DA MEDICAO ERRADA E SEMPRE O ALARMANTE, que e o que a torna cara: o recurso
# recem-marcado privado continua saindo, e a leitura obvia e "o gate nao existe". Isso
# aconteceu DUAS VEZES em 2026-08-29, primeiro com o indice do 3D e depois com o memo do
# `/api/config`, com quatro FALHOU que pareciam vazamento e eram cache quente. Anotar a
# licao nao segurou a segunda; por isso ela virou VERBO: quem escreve catalogo chama
# `sql_catalogo`, que ja invalida, em vez de lembrar de reiniciar.
#
# Uso: `. "$(dirname "$0")/comum.sh"` no topo do script, depois do `cd`.

BASE="${BASE:-http://localhost}"

# psql cru. Para tabela que NAO alimenta cache de catalogo (users, api_keys,
# resource_grants). Se a tabela for de catalogo, use `sql_catalogo`.
sql() {
    docker compose exec -T db psql -q -U ebgeo -d ebgeo_zero -v ON_ERROR_STOP=1 -c "$1" > /dev/null
}

# Reinicia o backend e espera ficar de pe. Zera as tres estruturas de uma vez, que e o
# que a escrita pela rota faria por `invalidateAppConfigCache()`.
reiniciar() {
    docker compose restart backend > /dev/null 2>&1
    local i=0
    until [ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/v1/health")" = "200" ]; do
        i=$((i + 1))
        [ "$i" -gt 30 ] && { echo "  ERRO: o backend nao voltou em 60 s"; return 1; }
        sleep 2
    done
}

# ESCRITA DE CATALOGO. Aceita varios comandos e invalida UMA vez no fim, porque o
# reinicio custa ~10 s e um por UPDATE tornaria a conferencia lenta o bastante para
# alguem querer tira-lo.
#
#   sql_catalogo "UPDATE tilesets SET ..." "UPDATE basemaps SET ..."
sql_catalogo() {
    local comando
    for comando in "$@"; do sql "$comando"; done
    reiniciar
}

# Entra e devolve o token. Senha unica do banco copiado; sobrescreva com SENHA=.
entrar() {
    curl -s -X POST "$BASE/api/v1/auth/login" -H 'Content-Type: application/json' \
        -d "{\"username\":\"$1\",\"password\":\"${SENHA:-tassofragoso}\"}" \
        | python -c "import sys,json;print(json.load(sys.stdin)['data']['accessToken'])" 2>/dev/null
}
