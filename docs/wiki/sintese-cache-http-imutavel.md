# Síntese: contrato de cache HTTP para binários imutáveis

Assets 3D, imagens 360 e thumbnails compartilham o mesmo protocolo, ETag O(1), `Cache-Control: immutable` por um ano, 304 antes de qualquer leitura pesada, Range 206 e 416, enquanto os tiles MVT ficam deliberadamente fora dele com cache curto.

## Por que existe um contrato único

Três rotas diferentes servem bytes grandes e imutáveis: `/api/v1/assets3d/*` (tilesets, `.b3dm`, `.glb`, `.pnts`, `.terrain`), `/api/v1/sv360/photos/:uuid/image` (panorama WebP) e `/api/v1/sv360/thumbnails/:slug.webp`. Todas foram escritas contra o mesmo molde, a ponto de o parser de Range ser copiado literalmente entre os módulos (`sv360.controller.js:36` diz "Copiado verbatim de assets3d.controller.js"). A consequência prática: quem entende uma entende as três, e um bug de protocolo em uma provavelmente existe nas outras.

O invariante que sustenta tudo é **o byte nunca muda para um mesmo identificador**. Assets 3D são publicados por caminho; o panorama é imutável depois da ingestão ([[ingestao-projetos-360]]); a thumbnail é um arquivo no disco. Isso é o que autoriza `max-age=31536000, immutable`, que instrui o navegador a **nem revalidar** dentro do ano.

## As quatro peças do protocolo

### 1. ETag O(1), nunca derivado do corpo em request time

Nenhuma das rotas lê o binário para calcular o ETag. As três derivações:

| Rota | ETag | Origem |
|------|------|--------|
| `assets3d` via filesystem | `"{size}-{floor(mtimeMs)}"` | `fs.stat` (`assets3d.service.js:42`) |
| `assets3d` via store SQLite | `"{sha1 do conteudo}"` | coluna `etag`, calculada na carga (`assets3d.store.js:69`) |
| Imagem 360 | `"{uuid}-{quality}-{sizeBytes}"` | coluna `*_size_bytes` no Postgres (`sv360.service.js:140`) |
| Thumbnail 360 | `"{slug}-{size}-{floor(mtimeMs)}"` | `fs.stat` (`sv360.controller.js:121`) |

O caso da imagem 360 é o mais interessante: o tamanho vive no **Postgres** e o BLOB vive num SQLite por projeto (`{slug}.db`). O ETag sai do Postgres, então o 304 responde sem sequer abrir o arquivo SQLite.

**Armadilha:** o ETag do `assets3d` muda quando a mesma raiz migra de filesystem para store SQLite (size+mtime vira sha1). Não é um bug, mas invalida o cache de todos os clientes na migração. E a ordem de tentativa é store SQLite primeiro, filesystem só como fallback (`assets3d.controller.js:44` e `:85`), então um caminho presente no SQLite **sombreia** a cópia em disco silenciosamente.

### 2. Ordem obrigatória: headers, depois 304, depois Range, depois leitura

O padrão em todas as rotas é o mesmo:

1. `setImmutableHeaders(...)` (`Accept-Ranges`, `Cache-Control`, `ETag`, `Content-Type`),
2. `if (If-None-Match === etag) return 304` sem corpo,
3. `parseRange`; se inválido, 416 com `Content-Range: bytes */<size>`,
4. só então adquire o semáforo e lê o BLOB.

Isso importa por dois motivos. Primeiro, o 304 sai **com** os headers de cache (é o que o RFC pede, um 304 precisa reafirmar `ETag` e `Cache-Control`). Segundo, na imagem 360 o 304 acontece **antes do `sem.acquire()`** (`sv360.controller.js:156` vem antes de `:158`), então uma tempestade de revalidações não consome a cota de concorrência. Inverter essas duas linhas transformaria cache hit em pressão de heap.

### 3. Semáforo só onde o BLOB materializa no heap

O caminho SQLite materializa o `Buffer` inteiro em memória, então é limitado por semáforo (`ASSETS_3D_MAX_INFLIGHT` e `SV360_MAX_INFLIGHT`, ambos default 8, `config.js:66` e `:74`). O caminho filesystem faz `createReadStream(...).pipe(res)` e **não** usa semáforo, porque o stream nunca materializa o arquivo (`assets3d.controller.js:84`, `sv360.controller.js:112`).

A liberação do semáforo é registrada em `res.on('finish')` **e** `res.on('close')`, com guarda `released` para não liberar duas vezes (`assets3d.controller.js:56-63`). Cliente que aborta no meio (o Cesium faz isso o tempo todo ao cancelar tiles fora de tela) dispara `close`, não `finish`; sem esse par o pool vazaria até travar a rota. Qualquer nova rota que sirva BLOB deve copiar esse bloco inteiro.

### 4. Range: um único intervalo, e o tamanho autoritativo varia

`parseRange` aceita `bytes=start-end`, sufixo (`bytes=-500`) e aberto à direita (`bytes=1024-`). O regex é `^bytes=(\d*)-(\d*)$` (`assets3d.controller.js:19`), logo:

- **multi-range** (`bytes=0-100,200-300`) é rejeitado como `'invalid'` e vira **416**, não 200. Proxy ou cliente que tente multipart byteranges quebra.
- `end` maior que o tamanho é **clampado** para `size-1` (não é erro); só `start` fora dos limites ou `start > end` gera 416.

Detalhe que diverge entre as rotas: na imagem 360 o `size` usado para Range/`Content-Length` é `buf.length`, o tamanho **real do buffer lido**, não o `size_bytes` do Postgres (`sv360.controller.js:174`). O comentário explica o porquê: o BLOB vive no `{slug}.db` e o tamanho no Postgres, e durante a janela swap/commit da ingestão os dois podem divergir. Confiar no buffer garante `Content-Length == corpo` sempre. Consequência aceita: nessa janela o ETag (Postgres) pode não bater com os bytes (SQLite), e o cliente cacheia um ETag antigo para um conteúdo novo.

## O eixo que a documentação esquece: public vs private

Este é o ponto onde o código é mais rico que a prosa. O `assets3d` é rota **pública** e sempre emite `public, max-age=31536000, immutable` (`assets3d.controller.js:14`). O sv360 decide por projeto:

- projeto `enabled` (público) → `public, ...immutable`,
- projeto `disabled` (visível só para admin global ou membro da OM dona) → `private, ...immutable` **mais** `Vary: Authorization, Cookie` (`sv360.controller.js:52-63`).

O raciocínio está no comentário do código: um cache compartilhado só pode guardar resposta que qualquer chamador poderia ver. Se um panorama de projeto `disabled` saísse como `public`, um proxy poderia replicar para anônimo a resposta autorizada de um admin. O `Vary` é cinto e suspensório para proxies que ignoram `private`. Ver [[auth-flexivel]] e [[organizacoes-om]] para quem enxerga o quê, e [[hardening-borda-api]] para o resto da postura de borda.

> [!CONTRADICAO 2026-07-18] guia *16-streetview-360* (absorvido) §5 documenta `Cache-Control: public, max-age=31536000, immutable` como valor fixo da imagem 360; o código em `sv360.controller.js:52-63` emite `private, max-age=31536000, immutable` + `Vary: Authorization, Cookie` quando o projeto está `disabled`. A doc descreve apenas o caso `enabled`.

## O que fica de fora, e por quê

Os **tiles MVT** (`GET /sv360/tiles/:z/:x/:y.pbf`) usam `public, max-age=60`, sem ETag, sem Range, sem `immutable` (`sv360.controller.js:98`). É deliberado: o conteúdo do tile muda a cada ingestão, tombstone ou toggle de status de projeto, então `immutable` congelaria pontos apagados na tela do usuário por um ano. Tile sem feições na bbox responde **200 com Buffer vazio** (MVT vazio é válido), nunca 404. Detalhes das camadas `fotos`/`fotos_linha` em [[streetview-360]].

As **imagens de atlas** ([[imagens-atlas]]) participam do espírito mas não da implementação: `images.controller.js:20-30` seta `private, max-age=31536000, immutable` na mão e delega ETag, 304, Range e `Last-Modified` ao `res.sendFile` do Express. Ou seja, ganham `Last-Modified` e ETag fraco do Express, que as rotas artesanais **não** emitem. Também vão como `Content-Disposition: attachment` para eliminar XSS por conteúdo renderizado.

E, como lembrete de escopo: nada disso passa pelo sync de operações. Ver [[sintese-modulos-fora-do-sync]]; escrita 360 não gera broadcast, depois de calibrar recarregue o metadado ([[calibracao-e-grafo-360]]).

## Armadilhas de integração

- **Comparação de `If-None-Match` é `===` estrito.** Não há normalização de ETag fraco (`W/"..."`) nem suporte a lista de ETags. Um proxy ou CDN que reescreva o ETag para a forma fraca destrói o 304, e todo cache hit vira 200 completo. Não existe tratamento de `If-Modified-Since` nessas rotas (só nas imagens de atlas, via `sendFile`).
- **Não desabilite `Accept-Ranges` em proxy intermediário.** O Cesium fatia tilesets grandes com Range; sem isso, cada tile vira download inteiro.
- **416 tem corpo vazio e `Content-Range: bytes */<size>`.** Cliente que recebe 416 deve refazer sem `Range`, não tentar reinterpretar o Range.
- **Traversal em `assets3d` normalmente responde 404, não 403.** `path.posix.normalize` colapsa os `..` contra a raiz antes da checagem de prefixo (`assets3d.service.js:28-31`), então `/assets3d/../../etc/passwd` vira um caminho inexistente dentro da raiz. O 403 (`ForbiddenError`) só dispara se o alvo resolvido ainda escapar de `ROOT`, o que é quase inalcançável pela via HTTP. Não use 403 como sinal de ataque; use 404 como "asset ausente" mesmo. Na thumbnail a defesa é o charset `^[a-z0-9-]+$` do slug mais `path.basename`.
- **`assets3d` é rota pública sem auth** (`app.js:95`, montada antes das rotas autenticadas). Ela nunca retorna 401/403 por falta de token. A proteção real é a descoberta: só o catálogo autenticado ([[catalogo-3d]]) revela os caminhos. Se um caminho vazar, o binário é baixável. Isso é uma decisão consciente, não um descuido, mas trate assets 3D como "não secretos" ao decidir o que publicar. Nada disso substitui [[zonas-acesso-geografico]] na camada de descoberta.
- **Republicar no mesmo caminho funciona**, porque o ETag muda (mtime no FS, sha1 no SQLite) e o cliente revalida. Mas com `immutable` o navegador pode nem revalidar dentro do ano; para garantir troca imediata, publique em outro caminho.
- **Erros do sv360 usam o envelope plano `{ "error": "msg" }`**, diferente do resto da API. Ver [[sintese-contrato-erros-http]] e [[erros-api]].

## Resolução de URL

Os caminhos guardados no catálogo 3D (`url`, `thumbnail`) são **relativos**, e o `previewThumbnail` do metadado 360 também é relativo e sem o prefixo `/api/v1`. A ideia é resolver contra `assets3dBaseUrl` e `streetView360.serviceUrl` do `/api/config`, o que torna os dados portáveis entre ambientes sem rebuild ([[config-runtime-urls-relativas]], [[assets3d-distribuicao]]).

> [!CONTRADICAO 2026-07-18] O checklist de guia *14-catalogo3d-assets* (absorvido) afirma que o cliente lê `assets3dBaseUrl` do `/api/config` e concatena com `m.url`. No `ebgeo_web` as-built não existe nenhuma referência a `assets3dBaseUrl`; `3d_models_viewer_tool/map_3d.js:259` passa `tilesetConfig.url` direto ao `Cesium3DTileset.fromUrl`, com a URL já completa vinda do catálogo de `tilesets` da config. A concatenação com base é o contrato oferecido pelo backend, não o caminho exercido pelo frontend hoje.

O lado 360 do frontend segue o contrato: `street_view_tool/streetview-api.service.js:76` monta `${getServiceUrl()}/photos/${photoId}/image?quality=${quality}`, ou seja, base da config mais rota relativa.

## Fontes

- guia *14-catalogo3d-assets* (absorvido): contrato `/assets3d/*` (ETag O(1), 304, Range 206/416, `immutable`), Content-Type por extensão, anti-traversal, dual-mode SQLite+filesystem, resolução relativa contra `assets3dBaseUrl`.
- guia *16-streetview-360* (absorvido): imagem 360 WebP imutável com o mesmo protocolo, formato do ETag `"{uuid}-{quality}-{size}"`, thumbnail por slug, e o contraste explícito dos tiles MVT com `max-age=60`.
- `src/modules/nomes/assets3d.controller.js` e `assets3d.service.js` (repo `ebgeo_backend`): implementação de referência (parseRange, ordem 304 antes da leitura, semáforo, ETag por `fs.stat`).
- `src/modules/streetview360/sv360.controller.js`: variação `public`/`private` + `Vary` por status do projeto, `size` autoritativo pelo buffer, cache curto do MVT.
- `src/modules/images/images.controller.js`: variante que delega ETag/304/Range ao `res.sendFile`.
- `src/config.js`, `src/app.js` (backend): defaults de `maxInflight` (8) e montagem pública de `/api/v1/assets3d`.
- `src/js/3d_models_viewer_tool/map_3d.js`, `src/js/street_view_tool/streetview-api.service.js` (ebgeo_web): consumo real das URLs no cliente.
