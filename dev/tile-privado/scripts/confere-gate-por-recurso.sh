#!/usr/bin/env bash
# O ALVO DO GATE POR RECURSO, escrito ANTES da implementacao.
#
# ELE FALHOU AO NASCER, E ISSO ERA O PONTO. Este arquivo e o enunciado executavel de
# docs/wiki/tile-privado.md: cada caso afirma o desfecho DEPOIS do gate, medido
# contra o produto de hoje. O retrato de 2026-08-29, antes de uma linha de codigo:
#
#     camada PUBLICA, anonimo ................ 401   deveria ser 200 (o produto quebrado)
#     camada PRIVADA, chave de quem nao ve ... 200   deveria ser 401 (o buraco)
#     fonte ORFA, com chave .................. 200   deveria ser 401 (decisao 4)
#     raster PRIVADO, chave de quem nao ve ... 200   deveria ser 401
#     raster PUBLICO, anonimo ................ 401   deveria ser 200
#     basemap PRIVADO, chave de quem nao ve .. 200   deveria ser 401
#
# POR QUE ESCREVER O ALVO PRIMEIRO. A constituicao pede controle negativo: reverter o
# conserto e confirmar que o teste falha. Um teste escrito DEPOIS da implementacao ja
# nasce verde e o controle negativo vira um passo que alguem lembra de fazer. Escrito
# antes, ele e vermelho por construcao, e o dia em que ficar verde e a medicao de que o
# gate existe. O risco simetrico tambem esta coberto: se ele ficar verde por outro
# motivo (o ambiente caiu, o location sumiu), os casos que afirmam 200 caem junto.
#
# CADA CASO CARREGA A DECISAO QUE O ORIGINOU, para que a conferencia continue legivel
# quando as decisoes forem cinco linhas num arquivo de 400.
set -uo pipefail
cd "$(dirname "$0")/.."
. "$(dirname "$0")/comum.sh"

K_COMUM="aaaaaaaa-0000-4000-8000-000000000001"        # pedro, usuario comum
K_CREDENCIADO="aaaaaaaa-0000-4000-8000-000000000002"  # diniz, le todo privado
T="http://localhost/tiles"
falhas=0
pendentes=0

# alvo <rotulo> <esperado depois do gate> <curl args...>
alvo() {
    local rotulo="$1" esperado="$2"
    shift 2
    local obtido
    obtido=$(curl -s -o /dev/null -w '%{http_code}' "$@")
    if [ "$obtido" = "$esperado" ]; then
        printf '  ok       %-48s %s\n' "$rotulo" "$obtido"
    else
        printf '  PENDENTE %-48s alvo %s, hoje %s\n' "$rotulo" "$esperado" "$obtido"
        pendentes=$((pendentes + 1))
    fi
}

# firme <rotulo> <esperado> <curl args...>
# O que JA vale hoje e nao pode regredir com a implementacao.
firme() {
    local rotulo="$1" esperado="$2"
    shift 2
    local obtido
    obtido=$(curl -s -o /dev/null -w '%{http_code}' "$@")
    if [ "$obtido" = "$esperado" ]; then
        printf '  ok       %-48s %s\n' "$rotulo" "$obtido"
    else
        printf '  REGREDIU %-48s esperado %s, obtido %s\n' "$rotulo" "$esperado" "$obtido"
        falhas=$((falhas + 1))
    fi
}

TA=$(entrar admin); TD=$(entrar diniz); TM=$(entrar marcel)
[ -n "$TA" ] || { echo "ERRO: login falhou; o ambiente esta de pe?"; exit 1; }

echo
echo "=== DECISAO 5: o publico volta a sair sem credencial nenhuma ==="
alvo "camada publica, anonimo"                200 "$T/hidrografia"
alvo "tile da camada publica, anonimo"        200 "$T/hidrografia/10/385/577"
alvo "raster publico, anonimo"                200 "$T/dem/10/385/577.png"
alvo "basemap publico, anonimo"               200 "$T/municipios"

echo
echo "=== O BURACO: a chave deixa de ser chave-mestra ==="
# Hoje qualquer chave viva alcanca qualquer camada. `pedro` nao ve nenhuma destas em
# nenhuma das duas portas do catalogo, e mesmo assim baixa os bytes.
alvo "camada privada, chave de quem NAO ve"   401 "$T/areas_treinamento?api_key=$K_COMUM"
alvo "tile dela, chave de quem NAO ve"        401 "$T/areas_treinamento/10/385/577?api_key=$K_COMUM"
alvo "raster privado, chave de quem NAO ve"   401 "$T/dem-restrito/10/385/577.png?api_key=$K_COMUM"
alvo "basemap privado, chave de quem NAO ve"  401 "$T/carta-restrita/10/385/577.png?api_key=$K_COMUM"
alvo "labelSource privado, chave de quem NAO ve" 401 "$T/pontos_cotados?api_key=$K_COMUM"

echo
echo "=== DECISAO 4: caminho que nenhuma linha reivindica e RECUSADO ==="
# `fonte_orfa` esta publicada no Martin e nao tem linha no catalogo. Com a regra do 3D
# ("nao reivindicado e publico") ela sairia; com centenas de camadas e endereco digitado
# a mao, essa regra publica em silencio a linha privada que tiver um erro de digitacao.
alvo "fonte orfa, com chave viva"             401 "$T/fonte_orfa?api_key=$K_CREDENCIADO"
alvo "fonte orfa, anonimo"                    401 "$T/fonte_orfa"
# O outro lado da mesma decisao: a camada PRIVADA cujo endereco tem erro de digitacao
# aponta para um caminho que nao existe, e ele tambem nao pode virar publico.
alvo "endereco com erro de digitacao"         401 "$T/helipotros?api_key=$K_COMUM"

echo
echo "=== Quem TEM direito continua alcancando ==="
alvo "camada privada, credenciado"            200 "$T/areas_treinamento?api_key=$K_CREDENCIADO"
alvo "raster privado, credenciado"            200 "$T/dem-restrito/10/385/577.png?api_key=$K_CREDENCIADO"
alvo "basemap privado, credenciado"           200 "$T/carta-restrita/10/385/577.png?api_key=$K_CREDENCIADO"

echo
echo "=== DECISAO 7 do catalogo: na colisao, a linha PRIVADA vence ==="
# `dutos` e endereçada por DUAS linhas, uma publica e outra privada. Se a publica
# vencesse, bastaria cadastrar uma linha publica homonima para abrir qualquer fonte.
alvo "fonte colidente, chave de quem NAO ve"  401 "$T/dutos?api_key=$K_COMUM"
alvo "fonte colidente, credenciado"           200 "$T/dutos?api_key=$K_CREDENCIADO"

echo
echo "=== O que NAO pode regredir ==="
firme "camada privada, SEM chave"             401 "$T/areas_treinamento"
firme "raster privado, SEM chave"             401 "$T/dem-restrito/10/385/577.png"
# AS TRES AMARRAS DA CHAVE, medidas contra a camada PRIVADA e nao contra a publica.
# A primeira versao deste bloco usava a publica, e ela regrediu ao alcancar o alvo: com o
# gate por recurso a linha publica passa SEM credencial, entao uma chave morta ali devolve
# 200 e o desfecho esta certo. Medir amarra de credencial onde a credencial nao e
# consultada e cobertura vazia; o par positivo do bloco acima (credenciado com chave viva
# abre a mesma camada) e o que torna estes 401 uma afirmacao.
firme "chave vencida, camada privada"         401 "$T/areas_treinamento?api_key=aaaaaaaa-0000-4000-8000-000000000003"
firme "chave revogada, camada privada"        401 "$T/areas_treinamento?api_key=aaaaaaaa-0000-4000-8000-000000000004"
firme "chave de conta desativada, privada"    401 "$T/areas_treinamento?api_key=aaaaaaaa-0000-4000-8000-000000000005"
firme "chave que nem existe, privada"         401 "$T/areas_treinamento?api_key=99999999-9999-4999-8999-999999999999"
firme "o app continua bootando"               200 "http://localhost/api/config"

echo
if [ "$falhas" -gt 0 ]; then
    echo "REGRESSAO: $falhas caso(s) que ja valiam pararam de valer."
    exit 1
fi
if [ "$pendentes" -gt 0 ]; then
    echo "ALVO AINDA NAO ALCANCADO: $pendentes de 17 casos. Isto e o esperado ANTES da implementacao."
    exit "$pendentes"
fi
echo "GATE POR RECURSO NO TILE: os 17 alvos alcancados, mais 7 de nao-regressao -- $(date '+%Y-%m-%d %H:%M')."
