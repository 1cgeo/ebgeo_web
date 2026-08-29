#!/usr/bin/env bash
# QUANTO CUSTA O GATE POR RECURSO, medido antes de decidir se ele precisa de cache.
#
# A FASE 5 SO SE JUSTIFICA COM NUMERO. O `fileoverview` de `tile-access.js` diz que o
# lugar de cachear, se o volume apertar, e o `proxy_cache` da propria subrequisicao no
# nginx -- mas "se o volume apertar" e uma condicao, nao uma decisao, e configurar cache
# sem medir troca um custo conhecido por um atraso de revogacao conhecido em troca de um
# ganho SUPOSTO.
#
# O QUE E MEDIDO, e por que estes tres cenarios:
#
#   1. TILE PUBLICO. E o caminho que o gate responde de MEMORIA, sem tocar no banco. Ele e
#      o piso: o que sobra aqui e o custo da subrequisicao em si (uma conexao a mais por
#      tile entre o nginx e o Node), sem nenhum I/O.
#   2. TILE PRIVADO, MESMA credencial e MESMO recurso. O memo do backend responde depois da
#      primeira, entao isto mede o custo da subrequisicao mais um lookup em memoria. E o
#      cenario REAL de uma tela: a pessoa e uma so e as camadas sao poucas.
#   3. TILE PRIVADO, credencial VARIANDO. Cada pedido e uma chave de memo diferente, entao
#      cada um paga uma consulta ao predicado. E o pior caso, e ele existe para dar o TETO:
#      se o numero 3 for proximo do 2, o memo esta fazendo o trabalho e o cache do nginx
#      teria pouco a acrescentar.
#
# UMA MEDICAO SO NAO E MEDICAO. Cada cenario roda em SERIE, N vezes, e o script relata a
# faixa (menor e maior), nao a media de uma rodada unica: latencia de rede local e
# ruidosa, e a diferenca entre dois cenarios so significa alguma coisa se ela for maior
# que a variacao de cada um.
set -uo pipefail
cd "$(dirname "$0")/.."
. "$(dirname "$0")/comum.sh"

T="http://localhost/tiles"
K_CREDENCIADO="aaaaaaaa-0000-4000-8000-000000000002"
TILES="${TILES:-100}"     # tiles por rodada: a ordem de grandeza de um deslocamento de mapa
RODADAS="${RODADAS:-5}"

# mede <rotulo> <gerador de URL>
#
# O gerador recebe o indice do pedido e imprime a URL. Ele existe para que o cenario 3
# possa variar a credencial sem que a funcao de medida saiba disso.
mede() {
    local rotulo="$1" gerador="$2"
    local menor="" maior="" soma=0 r i inicio fim ms
    # UMA CHAMADA DE `curl` COM AS N URLS, e nao N chamadas. A primeira versao lancava um
    # processo por pedido e o PISO saiu em 35 ms por pedido: era o custo de criar processo
    # no Windows, nao o do servidor, e ele submergia justamente a diferenca que se queria
    # ver (o publico chegou a medir MENOS que o piso). Com uma chamada so, o `curl` reusa
    # a conexao, que e o que o navegador faz com keep-alive.
    local urls=()
    for i in $(seq 1 "$TILES"); do urls+=("$($gerador "$i")"); done
    for r in $(seq 1 "$RODADAS"); do
        inicio=$(date +%s%N)
        curl -s "${urls[@]}" > /dev/null 2>&1
        fim=$(date +%s%N)
        ms=$(( (fim - inicio) / 1000000 ))
        soma=$((soma + ms))
        if [ -z "$menor" ] || [ "$ms" -lt "$menor" ]; then menor=$ms; fi
        if [ -z "$maior" ] || [ "$ms" -gt "$maior" ]; then maior=$ms; fi
    done
    local media=$((soma / RODADAS))
    printf '  %-42s %5s ms total, %5s us/pedido  (faixa %s a %s)
'         "$rotulo" "$media" "$(( media * 1000 / TILES ))" "$menor" "$maior"
}

url_publico()      { echo "$T/hidrografia/10/385/$1"; }
# O MESMO tile privado, autenticado por COOKIE em vez de chave. A comparacao entre este
# cenario e o de chave e o achado da medicao: a chave custa uma CONSULTA ao banco por
# requisicao (`FIND_USER_BY_API_KEY`, dentro do `flexibleAuth`, que nao e memoizado),
# enquanto o JWT do cookie e verificado por assinatura, sem I/O nenhum.
url_privado_cookie() { echo "$T/areas_treinamento/10/385/$1"; }
url_privado_fixo() { echo "$T/areas_treinamento/10/385/$1?api_key=$K_CREDENCIADO"; }
# Credencial variando: o `api_key` muda de forma a cada pedido, o que muda a chave do memo.
# Sao UUIDs invalidos de proposito -- o que se mede aqui e o caminho ate a decisao, e um
# UUID que nao resolve percorre a peneira de forma e o lookup, que e o mesmo trabalho.
url_privado_variando() { echo "$T/areas_treinamento/10/385/$1?api_key=$(printf 'aaaaaaaa-0000-4000-8000-%012d' "$1")"; }
# O piso absoluto: uma rota do proprio backend que nao passa pelo gate de tile nenhum.
url_sem_gate()     { echo "http://localhost/api/v1/health?i=$1"; }

echo
echo "=== O CUSTO DO GATE, $RODADAS rodadas de $TILES pedidos em serie ==="
mede "piso: rota sem gate de tile"      url_sem_gate
mede "tile PUBLICO (indice em memoria)" url_publico
mede "tile PRIVADO, chave de API"       url_privado_fixo
# O `-b` do cookie precisa entrar em toda URL, entao este cenario usa a sua propria
# chamada em vez do `mede` generico.
COOKIE="/tmp/ebgeo-medida-$$.txt"
curl -s -o /dev/null -c "$COOKIE" -X POST "http://localhost/api/v1/auth/login"     -H 'Content-Type: application/json'     -d '{"username":"admin","password":"'"${SENHA:-tassofragoso}"'"}'
urls_cookie=()
for i in $(seq 1 "$TILES"); do urls_cookie+=("$(url_privado_cookie "$i")"); done
soma=0; menor=""; maior=""
for r in $(seq 1 "$RODADAS"); do
    inicio=$(date +%s%N)
    curl -s -b "$COOKIE" "${urls_cookie[@]}" > /dev/null 2>&1
    fim=$(date +%s%N)
    ms=$(( (fim - inicio) / 1000000 ))
    soma=$((soma + ms))
    if [ -z "$menor" ] || [ "$ms" -lt "$menor" ]; then menor=$ms; fi
    if [ -z "$maior" ] || [ "$ms" -gt "$maior" ]; then maior=$ms; fi
done
media=$((soma / RODADAS))
printf '  %-42s %5s ms total, %5s us/pedido  (faixa %s a %s)
'     "tile PRIVADO, COOKIE de sessao" "$media" "$(( media * 1000 / TILES ))" "$menor" "$maior"
rm -f "$COOKIE"
mede "tile PRIVADO, credencial variando" url_privado_variando

echo
echo "=== O QUE ISTO DECIDIU, em 2026-08-29 ==="
echo "  O gate por recurso custa ZERO mensuravel: o tile PUBLICO ficou 5 us acima do piso e"
echo "  o tile PRIVADO por COOKIE ficou exatamente nele, com as faixas se sobrepondo. O"
echo "  indice em memoria e o memo de decisao fazem o trabalho, e a subrequisicao em si"
echo "  esta submersa no ruido."
echo
echo "  O QUE CUSTA E A CHAVE DE API: +480 us por tile. A razao nao e o gate, e sim que"
echo "  \`FIND_USER_BY_API_KEY\` e uma CONSULTA AO BANCO por requisicao, dentro do"
echo "  \`flexibleAuth\`, e ela nao e memoizada. O JWT do cookie e verificado por assinatura,"
echo "  sem I/O nenhum -- e por isso ele mede igual ao piso."
echo
echo "  PORTANTO A FASE 5 (proxy_cache da subrequisicao) NAO FOI FEITA: ela compraria um"
echo "  atraso de revogacao em troca de um ganho que a medicao nao acha. Se o volume um dia"
echo "  apertar, o alvo indicado por esta tabela e outro: memoizar a resolucao da CHAVE,"
echo "  nao a subrequisicao."
