# Síntese: contrato de cache HTTP para binários imutáveis

Três rotas de binário grande compartilham o mesmo molde (ETag O(1), 304 antes de qualquer leitura pesada, Range 206/416, `immutable` por um ano), e o que importa aqui é o que o molde esconde: onde ele foi copiado, onde diverge, e o que quebra ao integrar.

## O invariante que autoriza `immutable`

**O byte nunca muda para um mesmo identificador.** Assets 3D são publicados por caminho, o panorama é imutável depois da ingestão ([[ingestao-projetos-360]]), a thumbnail é arquivo em disco. Só isso justifica `max-age=31536000, immutable`, que instrui o navegador a **nem revalidar** dentro do ano.

**Imagem de atlas emite o mesmo header e não satisfaz o invariante.** Ela já aparece abaixo como "fora do molde" por outro motivo (delega ETag e Range ao `res.sendFile`), mas a divergência que importa é esta: a PK é escolhida pelo cliente no lote e o `DELETE` é físico, então um mesmo id pode servir bytes diferentes, e o `immutable` congela os antigos por até um ano ([[imagens-atlas]]). Ao copiar este molde para uma rota nova, a pergunta a fazer não é "o conteúdo é grande?" e sim **"o identificador é irrepetível?"**.

O `parseRange` foi **copiado verbatim** entre os módulos (`backend/src/modules/streetview360/sv360.controller.js:36` admite isso). Consequência operacional: um bug de protocolo em uma rota provavelmente existe nas três, e a correção precisa ser aplicada três vezes.

## Armadilhas do ETag

- **Migrar a mesma raiz de filesystem para o store SQLite troca a família do ETag** (`"{size}-{mtime}"` em `backend/src/modules/nomes/assets3d.service.js:42` vira `"{sha1}"` em `backend/src/modules/nomes/assets3d.store.js:69`). Não é bug, mas invalida o cache de todos os clientes no dia da migração.
- **O SQLite sombreia o disco silenciosamente.** A ordem é store primeiro, filesystem só como fallback (`backend/src/modules/nomes/assets3d.controller.js:44` e `:85`). Um caminho presente nos dois serve a versão do SQLite sem nenhum sinal.
- **Comparação de `If-None-Match` é `===` estrito** (`backend/src/modules/nomes/assets3d.controller.js:47`, `backend/src/modules/streetview360/sv360.controller.js:156`). Sem normalização de ETag fraco (`W/"..."`) e sem lista de ETags. Um CDN ou proxy que reescreva o ETag para a forma fraca **destrói todo 304**, e cada cache hit vira 200 completo. `If-Modified-Since` não é tratado nessas rotas.
- **Republicar no mesmo caminho funciona em teoria** (o ETag muda), mas com `immutable` o navegador pode não revalidar dentro do ano. Para garantir troca imediata, publique em outro caminho.

## O que não pode ser reordenado

- **O 304 sai antes do `sem.acquire()`** (`backend/src/modules/streetview360/sv360.controller.js:156` antes de `:158`). Inverter essas duas linhas transforma tempestade de revalidação (barata) em pressão de heap e esgotamento da cota de concorrência (`ASSETS_3D_MAX_INFLIGHT` / `SV360_MAX_INFLIGHT`, ambos default 8, `backend/src/config.js`). Esses dois são o número a baixar em container apertado, e são por processo, não por host.
- **A liberação do semáforo é registrada em `finish` E em `close`, com guarda `released`** (`backend/src/modules/nomes/assets3d.controller.js:56-63`). O Cesium cancela tiles fora de tela o tempo todo: aborto dispara `close`, nunca `finish`. Sem o par, o pool vaza até travar a rota. Qualquer rota nova que sirva BLOB precisa copiar o bloco inteiro.
- **Semáforo só onde o BLOB materializa no heap.** O caminho filesystem faz `createReadStream(...).pipe(res)` e deliberadamente não usa semáforo. Adicionar um ali só reduziria vazão sem proteger memória.

## Range: onde ele mente

- **Multi-range (`bytes=0-100,200-300`) vira 416, não 200.** O regex aceita um único intervalo (`backend/src/modules/nomes/assets3d.controller.js:19`), então qualquer cliente ou proxy que tente multipart byteranges quebra. `end` além do tamanho é clampado, não é erro; só `start` fora dos limites gera 416.
- **416 tem corpo vazio e `Content-Range: bytes */<size>`.** O cliente deve refazer sem `Range`, não reinterpretar.
- **Não desabilite `Accept-Ranges` em proxy intermediário**: o Cesium fatia tilesets grandes, e sem isso cada tile vira download inteiro.
- **Na imagem 360 o tamanho autoritativo é `buf.length`, não o `size_bytes` do Postgres** (`backend/src/modules/streetview360/sv360.controller.js:174`). O motivo é que o BLOB vive no `{slug}.db` e o tamanho no Postgres, e na janela swap/commit da ingestão os dois divergem. Isso garante `Content-Length == corpo` sempre, mas **o custo aceito não está no código**: nessa janela o ETag (Postgres) pode não corresponder aos bytes (SQLite), e o cliente cacheia um ETag antigo para conteúdo novo.

## O eixo que a doc esquece: public vs private

`assets3d` é sempre `public`; o sv360 decide por projeto, emitindo `private` mais `Vary: Authorization, Cookie` quando o projeto está `disabled` (`backend/src/modules/streetview360/sv360.controller.js:52-63`). A razão é que um cache compartilhado só pode guardar resposta que qualquer chamador poderia ver, e o `Vary` é cinto e suspensório para proxies que ignoram `private`. Quem enxerga o quê: [[auth-flexivel]], [[organizacoes-om]], [[zonas-acesso-geografico]]; postura de borda em [[hardening-borda-api]].

> **Nota histórica.** O guia *16-streetview-360* (absorvido) documenta `public, max-age=31536000, immutable` como valor fixo da imagem 360. O código emite `private` no caso `disabled`; a doc descrevia só o caso `enabled`.

## Armadilhas de superfície

- **`assets3d` é rota pública sem auth**, montada antes das autenticadas (`assets3dRoutes`, `backend/src/app.js`). Ela nunca retorna 401/403 por falta de token. A proteção real é a **descoberta**: só o catálogo autenticado ([[catalogo-3d]]) revela os caminhos. Decisão consciente, não descuido, mas trate assets 3D como "não secretos" ao decidir o que publicar.
- **Traversal responde 404, não 403.** `path.posix.normalize` colapsa os `..` contra a raiz antes da checagem de prefixo (`backend/src/modules/nomes/assets3d.service.js:28-31`), então `/assets3d/../../etc/passwd` vira caminho inexistente dentro da raiz. O `ForbiddenError` é quase inalcançável pela via HTTP: **não use 403 como sinal de ataque**.
- **Erros do sv360 usam envelope plano `{ "error": "msg" }`**, diferente do resto da API ([[sintese-contrato-erros-http]], [[erros-api]]).
- Nada disso passa pelo sync de operações ([[sintese-modulos-fora-do-sync]]); escrita 360 não gera broadcast, e depois de calibrar é preciso recarregar o metadado ([[calibracao-e-grafo-360]]).

## Quem ficou de fora do molde, e por quê

- **Tiles MVT** usam `max-age=60` sem ETag nem Range, e o **escopo segue o chamador**: `private` + `Vary` quando há sessão, `public` só no anônimo (`mvtTile`, `backend/src/modules/streetview360/sv360.controller.js`). Os 60 s são deliberados (o tile muda a cada ingestão, tombstone ou toggle, e `immutable` congelaria pontos apagados por um ano); o escopo variável também, porque o corpo do tile inclui projeto `disabled` para quem pode vê-lo. Tile vazio é 200 com Buffer vazio, nunca 404 ([[streetview-360]]).
- **Imagens de atlas** ([[imagens-atlas]]) delegam ETag, 304, Range e `Last-Modified` ao `res.sendFile` (`backend/src/modules/images/images.controller.js:39-44`). Divergência que atravessa arquivos: elas emitem `Last-Modified` e ETag fraco do Express, que as rotas artesanais **não** emitem, então validador condicional que funciona lá falha aqui.

## Resolução de URL

Caminhos do catálogo 3D e o `previewThumbnail` do 360 são relativos, para resolver contra `assets3dBaseUrl` e `streetView360.serviceUrl` do `/api/config` e manter os dados portáveis entre ambientes ([[config-runtime-urls-relativas]], [[assets3d-distribuicao]]).

> **Nota histórica.** O guia *14-catalogo3d-assets* (absorvido) afirma que o cliente concatena `assets3dBaseUrl` com `m.url`. No cliente as-built não existe nenhuma referência a `assets3dBaseUrl`: `frontend/src/js/3d_models_viewer_tool/map_3d.js:259` passa `tilesetConfig.url` direto ao `Cesium3DTileset.fromUrl`, já completo. A concatenação é contrato oferecido pelo backend, não caminho exercido hoje. O lado 360 segue o contrato (`getServiceUrl`, `frontend/src/js/street_view_tool/streetview-api.service.js`).
