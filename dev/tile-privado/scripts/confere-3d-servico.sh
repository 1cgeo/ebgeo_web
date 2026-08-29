#!/usr/bin/env bash
# CASO 1 DOS QUATRO: o 3D servido PELO SERVIÇO (`/api/v1/assets3d/*`).
#
# O QUE ESTA CONFERÊNCIA MEDE, e por que cada eixo está aqui.
#
# EIXO A, as PORTAS. Um recurso 3D é endereçado por mais de um campo do catálogo, e
# `assets3d-regime.js` os trata por listas nomeadas: `url` é a RAIZ DE UMA ÁRVORE
# (tudo sob a pasta dela pertence à linha), `basePath` é a pasta declarada, e
# `previewVideo`, `previewThumbnail` e `thumbnail` endereçam UM ARQUIVO, porque na
# prática eles moram FORA da pasta do modelo. O acervo desta máquina prova o ponto:
# o preview do `PCL` está em `videos/preview.webm`, um vizinho de ninguém. Fechar a
# árvore e deixar o preview aberto é o defeito que a lista de campos existe para
# impedir, e é o que este script mede porta a porta.
#
# EIXO B, os PRINCIPAIS. Os quatro papéis globais não se contêm, então cada um é uma
# pergunta diferente ao mesmo predicado: o produtor alcança o privado da OM que
# PRODUZ (`fn_can_produce_resource`), o credenciado alcança todo privado, o
# administrador atravessa, e o usuário comum não alcança nada sem concessão. Medir só
# "anônimo contra admin" mediria dois extremos e nenhum dos ramos do meio.
#
# EIXO C, o que NÃO é do catálogo. Um caminho que nenhuma linha reivindica é PÚBLICO
# por desenho declarado, e isso é o que mantém o modelo público funcionando. Se um dia
# ele fechar, a regressão aparece aqui.
#
# EIXO D, o REGIME DE CACHE. É a metade que não se vê pelo status: um privado servido
# com `public, immutable` fica na borda e no cache do navegador, e o gate passa a
# valer só para o primeiro pedido.
#
# O CONTROLE NEGATIVO é o mesmo caminho com a linha PÚBLICA. Sem ele, um 404 vindo de
# ausência de bytes (que este acervo tem: nem toda linha do catálogo foi carregada
# nesta máquina) seria lido como recusa do gate, e a conferência diria fechado sobre
# uma porta que ninguém guarda.
set -uo pipefail
cd "$(dirname "$0")/.."
# `sql`, `sql_catalogo`, `reiniciar` e `entrar` vivem em comum.sh, e a razao de estarem
# la esta escrita no cabecalho daquele arquivo: escrever catalogo por psql e medir em
# seguida mede o CACHE, nao o gate, e a licao so parou de recorrer quando virou verbo.
. "$(dirname "$0")/comum.sh"

BASE="${BASE:-http://localhost}"
A="/api/v1/assets3d"
CHAVE_CREDENCIADO="aaaaaaaa-0000-4000-8000-000000000002"   # diniz
CHAVE_COMUM="aaaaaaaa-0000-4000-8000-000000000001"         # pedro, escopo tiles
OM_DO_PRODUTOR="c8e2cfe7-1f9e-4246-b952-2c6f75a83991"      # marcel
falhas=0

# O memo de decisão dura 30 s e só é limpo por escrita de catálogo PELA ROTA; o índice
# de regime idem. Como esta conferência escreve direto no banco, o reinício é o que
# torna cada bloco uma medição do gate e não do cache.

checar() {
    local rotulo="$1" esperado="$2"; shift 2
    local status
    status=$(curl -s -o /dev/null -w '%{http_code}' "$@")
    if [ "$status" = "$esperado" ]; then
        printf '  ok      %-44s %s\n' "$rotulo" "$status"
    else
        printf '  FALHOU  %-44s esperado %s, obtido %s\n' "$rotulo" "$esperado" "$status"
        falhas=$((falhas + 1))
    fi
}
cache() {
    local rotulo="$1" esperado="$2"; shift 2
    local valor
    valor=$(curl -s -D - -o /dev/null "$@" | grep -i '^cache-control:' | tr -d '\r' | cut -d' ' -f2-)
    case "$valor" in
        *"$esperado"*) printf '  ok      %-44s %s\n' "$rotulo" "$valor" ;;
        *) printf '  FALHOU  %-44s esperado conter "%s", obtido "%s"\n' "$rotulo" "$esperado" "$valor"
           falhas=$((falhas + 1)) ;;
    esac
}

TA=$(entrar admin); TP=$(entrar pedro); TM=$(entrar marcel); TD=$(entrar diniz)
[ -n "$TA" ] || { echo "ERRO: login falhou; o ambiente está de pé?"; exit 1; }

echo
echo "=== CONTROLE NEGATIVO: com a linha PÚBLICA, tudo abre para o anônimo ==="
sql_catalogo "UPDATE tilesets SET access_level='public', owner_org_id=NULL WHERE id='PCL';"
checar "raiz da árvore (campo url)"        200 "$BASE$A/PCL/tileset.json"
checar "filho dentro da árvore"            200 "$BASE$A/PCL/Data/a.b3dm"
checar "preview FORA da pasta (previewVideo)" 200 "$BASE$A/videos/preview.webm"
cache  "regime de cache do público"        "public" "$BASE$A/PCL/tileset.json"

echo
echo "=== A LINHA VIRA PRIVADA: as três portas fecham para o anônimo ==="
sql_catalogo "UPDATE tilesets SET access_level='private' WHERE id='PCL';"
checar "raiz da árvore"                    404 "$BASE$A/PCL/tileset.json"
checar "filho dentro da árvore"            404 "$BASE$A/PCL/Data/a.b3dm"
# A PORTA QUE UMA IMPLEMENTAÇÃO DESATENTA DEIXA ABERTA: ela não está sob a pasta do
# modelo, e só entra no índice porque `CAMPOS_DE_ARQUIVO` a nomeia.
checar "preview FORA da pasta"             404 "$BASE$A/videos/preview.webm"

echo
echo "=== EIXO C: o que o catálogo não reivindica continua público ==="
checar "arquivo na raiz do acervo"         200 "$BASE$A/LEIA-ME.txt"
checar "modelo de outra linha"             200 "$BASE$A/models/TGL.glb"

echo
echo "=== EIXO B: um ramo do predicado por principal, sobre a MESMA linha privada ==="
checar "usuário comum (pedro)"             404 -H "Authorization: Bearer $TP" "$BASE$A/PCL/tileset.json"
checar "produtor de OUTRA OM (marcel)"     404 -H "Authorization: Bearer $TM" "$BASE$A/PCL/tileset.json"
checar "credenciado (diniz)"               200 -H "Authorization: Bearer $TD" "$BASE$A/PCL/tileset.json"
checar "administrador"                     200 -H "Authorization: Bearer $TA" "$BASE$A/PCL/tileset.json"
checar "chave de API do credenciado"       200 "$BASE$A/PCL/tileset.json?api_key=$CHAVE_CREDENCIADO"
checar "chave de API do usuário comum"     404 "$BASE$A/PCL/tileset.json?api_key=$CHAVE_COMUM"
cache  "regime de cache do privado"        "private" -H "Authorization: Bearer $TA" "$BASE$A/PCL/tileset.json"

echo
echo "=== EIXO B, o ramo da PRODUÇÃO: a linha passa a ser da OM do produtor ==="
# O produtor alcança o privado que a OM dele PRODUZ, sem concessão nenhuma, e é o
# ramo que separa `producer` de `user`. Sem este bloco o papel de produtor sairia
# desta conferência indistinguível de um usuário comum.
sql_catalogo "UPDATE tilesets SET owner_org_id='$OM_DO_PRODUTOR' WHERE id='PCL';"
checar "produtor da OM DONA (marcel)"      200 -H "Authorization: Bearer $TM" "$BASE$A/PCL/tileset.json"
checar "usuário comum, mesma linha"        404 -H "Authorization: Bearer $TP" "$BASE$A/PCL/tileset.json"
checar "anônimo, mesma linha"              404 "$BASE$A/PCL/tileset.json"

echo
echo "=== EIXO E: o empréstimo por atlas. O UUID NÃO É SENHA ==="
# `?atlasId=` diz apenas QUAL empréstimo o chamador quer usar; quem diz se ele pode
# usá-lo é `requireAtlasPermission('read')`, invocado como FUNÇÃO e não montado como
# middleware, para não custar uma consulta no caminho público. Um UUID inventado tem
# de bater na mesma porta que a ausência dele.
checar "sem atlasId"                       404 -H "Authorization: Bearer $TP" "$BASE$A/PCL/tileset.json"
checar "atlasId inexistente"               404 -H "Authorization: Bearer $TP" "$BASE$A/PCL/tileset.json?atlasId=00000000-0000-4000-8000-000000000000"
checar "atlasId que nem é UUID"            404 -H "Authorization: Bearer $TP" "$BASE$A/PCL/tileset.json?atlasId=qualquer-coisa"
checar "anônimo com atlasId"               404 "$BASE$A/PCL/tileset.json?atlasId=00000000-0000-4000-8000-000000000000"

echo
echo "=== EIXO F: RANGE. O gate vale para o pedido parcial também ==="
# O Cesium busca tile por faixa de bytes. Um gate que só olhasse o GET inteiro deixaria
# a porta do `Range` aberta, e a resposta dela é 206, não 200: quem checasse só por
# 200 leria a fuga como recusa.
checar "anônimo com Range"                 404 -H "Range: bytes=0-99" "$BASE$A/PCL/Data/a.b3dm"
checar "administrador com Range"           206 -H "Range: bytes=0-99" -H "Authorization: Bearer $TA" "$BASE$A/PCL/Data/a.b3dm"

echo
echo "=== EIXO G: a RAIZ da árvore não derruba a rota inteira ==="
# Uma linha privada cujo endereço mora na raiz do acervo teria prefixo VAZIO e casaria
# TODO pedido. `assets3d-regime.js` descarta essa entrada nos dois sentidos, e o efeito
# (não o comentário) é o que se mede aqui.
sql "INSERT INTO tilesets (id, name, config, access_level) VALUES ('sonda-raiz','Sonda: url na raiz','{\"url\": \"/api/v1/assets3d/tileset.json\"}'::jsonb,'private') ON CONFLICT (id) DO UPDATE SET config=EXCLUDED.config, access_level='private';"
reiniciar
checar "arquivo na raiz segue público"     200 "$BASE$A/LEIA-ME.txt"
checar "modelo de outra linha segue"       200 "$BASE$A/models/TGL.glb"
checar "e o PCL privado segue fechado"     404 "$BASE$A/PCL/tileset.json"
sql "DELETE FROM tilesets WHERE id='sonda-raiz';"

echo
echo "=== EIXO H: TRAVESSIA DE CAMINHO, medida DIRETO NO BACKEND ==="
# MEDIR ISTO PELO NGINX DÁ ALARME FALSO. O nginx normaliza `../` antes do proxy, e o
# caminho resultante cai no `try_files` do app: a resposta é 200 com o `index.html`
# dentro. Quem olhasse só o status concluiria vazamento onde não há. A medição honesta
# fala com o backend por dentro da rede, onde `assets3d.service.js` recusa.
for caminho in "../../../etc/passwd" "../../package.json" "..%2f..%2fpackage.json" "....//....//package.json"; do
    linha=$(docker compose exec -T nginx wget -S -qO- "http://backend:8080/api/v1/assets3d/$caminho" 2>&1 | grep -m1 "HTTP/")
    case "$linha" in
        *"404"*|*"403"*) printf '  ok      %-44s %s
' "travessia recusada" "$(echo "$linha" | tr -d ' ')" ;;
        *) printf '  FALHOU  %-44s %s
' "travessia com $caminho" "$linha"; falhas=$((falhas + 1)) ;;
    esac
done

echo
echo "--- devolvendo a linha ao estado original ---"
sql_catalogo "UPDATE tilesets SET access_level='public', owner_org_id=NULL WHERE id='PCL';"
checar "público de volta, anônimo"         200 "$BASE$A/PCL/tileset.json"

if [ "${MEDIR_MEMO:-0}" = "1" ]; then
    echo
    echo "=== EIXO I: o ATRASO DA REVOGAÇÃO (opt-in, custa ~40 s) ==="
    # O limite declarado no cabeçalho de `assets3d-acesso.js`: a decisão é memoizada por
    # 30 s. Medido em 2026-08-29: virou 404 em 31 s, ou seja o comentário diz a verdade.
    #
    # E O ATRASO NÃO É O DA INTERFACE: revogar pela ROTA chama
    # `invalidateAppConfigCache()` depois do commit, que limpa este memo na hora. Os 30 s
    # são o teto de quem escreve FORA da rota, como esta sonda escreve de propósito.
    sql "UPDATE tilesets SET access_level='private' WHERE id='PCL';"
    sql "INSERT INTO resource_grants (resource_type, resource_id, grantee_id, grant_level, granted_by) SELECT 'tileset','PCL', u.id, 'view', a.id FROM users u, users a WHERE u.username='pedro' AND a.username='admin';"
    reiniciar
    checar "com concessão (memo frio)"     200 -H "Authorization: Bearer $TP" "$BASE$A/PCL/tileset.json"
    sql "UPDATE resource_grants SET revoked_at=NOW() WHERE resource_id='PCL' AND revoked_at IS NULL;"
    checar "logo após revogar POR SQL"     200 -H "Authorization: Bearer $TP" "$BASE$A/PCL/tileset.json"
    inicio=$(date +%s)
    until [ "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TP" "$BASE$A/PCL/tileset.json")" = "404" ]; do
        [ $(( $(date +%s) - inicio )) -gt 75 ] && { echo "  FALHOU  memo não expirou em 75 s"; falhas=$((falhas + 1)); break; }
        sleep 2
    done
    echo "  medido  fechou $(( $(date +%s) - inicio )) s após a revogação (TTL declarado: 30 s)"
    sql "DELETE FROM resource_grants WHERE resource_id='PCL';"
    sql_catalogo "UPDATE tilesets SET access_level='public' WHERE id='PCL';"
fi

echo
if [ "$falhas" -eq 0 ]; then
    echo "CASO 1 (3D via serviço) CONFERIDO — $(date '+%Y-%m-%d %H:%M')."
else
    echo "CASO 1 COM $falhas DESVIO(S)."
fi
exit "$falhas"
