# Módulo StreetView 360 (sv360)

Repositório de panoramas em `/api/v1/sv360`: é a exceção do backend em envelope, em cache e em sync, e quase toda armadilha do módulo nasce de uma dessas três exceções.

## Duas coisas chamadas "360" (a confusão mais cara)

- O módulo `sv360` (backend, `src/modules/streetview360/`) é o acervo de panoramas do servidor: projetos, fotos, grafo de navegação, imagem WebP.
- A entidade de sync `streetview360` é outra coisa: marcadores e orientações que o usuário salva **por mapa do atlas**, que trafegam pelo [[canal-collab-websocket]] e vivem no side-store do cliente.

O módulo `sv360` está **fora** do sync: nenhuma escrita 360 vira operação, nenhum peer recebe broadcast. Depois de um `PUT .../calibration` o cliente **recarrega** `GET /sv360/photos/:uuid`; quem esperar evento espera para sempre. Ver [[sintese-modulos-fora-do-sync]]. Consequência de esquema: `sv360.photos` tem `updated_at` mas nenhuma coluna `version`, e `sv360.targets` não tem nenhuma das duas (`backend/src/modules/streetview360/sv360.write.service.js:13-15`); não há como enxertar LWW aqui sem migração.

## Envelope: por que o módulo destoa do resto da API

O envelope nu e o erro plano são contrato congelado herdado do viewer legado, declarado em [[sintese-contratos-congelados]] (dono canônico do fato). O que importa aqui é quem o impõe: um error handler de **router**, montado por último, que intercepta antes do global (`backend/src/modules/streetview360/sv360-error.js:15`). É por isso que corrigir o envelope do módulo pelo handler global não tem efeito nenhum ([[erros-api]], [[sintese-contrato-erros-http]]).

Armadilha de cliente: o REST genérico desembrulha `data` sempre que a resposta é objeto não-array contendo essa chave (`frontend/src/js/store/sync/api-client.js:350`). Hoje nenhum shape do sv360 tem `data`, então tudo passa intacto, mas **acrescentar um campo `data` a qualquer resposta do sv360 mutila o corpo silenciosamente no cliente**, sem erro. Por isso as chamadas sv360 vivem apartadas (`frontend/src/js/store/sync/api-client.js:612-634`).

Do handler, o que não é óbvio: erro Joi vira **422**, mas os params de tile viram **400** por caminho próprio (`backend/src/modules/streetview360/sv360.routes.js:37-44`), porque o contrato MVT quer 400 em coordenada malformada. E `23505`/`23503` são mapeados para **409** ali dentro (`backend/src/modules/streetview360/sv360-error.js:27-33`); o handler global já fazia isso, mas o de router intercepta primeiro, e sem essa branch um target duplicado voltava 500.

## Cache: o único ponto onde o "immutable" tem escopo variável

Toda imagem/thumbnail é imutável, mas o **escopo** depende do status do projeto (`backend/src/modules/streetview360/sv360.controller.js:52-63`): `enabled` recebe `public`, `disabled` recebe `private` + `Vary: Authorization, Cookie`. Um cache compartilhado só pode guardar resposta que todo mundo pode ver; sem essa distinção um proxy replicaria para anônimos uma resposta autorizada de projeto oculto.

Não existe um `public, max-age=31536000, immutable` uniforme para todo o 360, apesar de a documentação de origem tabelar assim. O TTL longo vale só para imagem e thumbnail; o tile MVT e o feed GeoJSON usam 60 s, porque a camada de pontos muda a cada ingestão, tombstone ou toggle. E os dois seguem a mesma regra de escopo das imagens, por motivo diferente: o corpo do tile **varia com o chamador** (a query embute `isAdmin`/`orgId` e inclui projeto `disabled` para quem pode vê-lo), então chamada credenciada sai `private` + `Vary`, e só a anônima sai `public` (`mvtTile` e `tilesGeojson`, `backend/src/modules/streetview360/sv360.controller.js`). Marcar o tile de um membro como `public` autorizaria um cache compartilhado a servi-lo a anônimos pelos 60 s seguintes, sem a aplicação ser consultada.

Armadilha deliberada no protocolo de Range: `Content-Length`/`Content-Range` derivam do **buffer realmente lido**, não do `size_bytes` do Postgres (`backend/src/modules/streetview360/sv360.controller.js:150-155,174`). Em regime normal coincidem; na janela swap-do-arquivo↔commit da ingestão podem divergir, e confiar no buffer mantém toda resposta protocolarmente correta. Não "otimize" isso lendo o tamanho do Postgres. Mesma família de [[assets3d-distribuicao]] e [[sintese-cache-http-imutavel]].

O 304 acontece **antes** de abrir o SQLite e **antes** do semáforo de concorrência: é isso que torna revalidação barata, e é a razão de o ETag vir só de colunas de tamanho no Postgres. Mover o cálculo do ETag para o BLOB destruiria a propriedade.

## Ocultação: 404 é ambíguo por decisão

Projeto `enabled` é público; `disabled` só admin global ou membro da OM dona ([[auth-flexivel]], [[organizacoes-om]], [[permissoes-atlas]]), e projeto oculto responde **404**, indistinguível de inexistente. Nas escritas a escada é **404 → 403** (`backend/src/modules/streetview360/sv360.write.service.js:49-52`): quem não lê nem sabe que existe; quem lê mas não escreve (um `viewer` da própria OM) recebe 403. Portanto **não trate 404 do sv360 como "não existe"**: pode ser "existe e não é seu".

**Onde a regra mora, exatamente.** Esta seção dizia sem ressalva que ela está "embutida no SQL das leituras, não só no service", ecoando a promessa de `backend/CLAUDE.md`. Vale para as leituras de **projeto** e para o feed de tiles (`backend/src/modules/streetview360/sv360.queries.js:14`, `:29`, `:155`). As leituras de **foto** fazem o oposto por desenho: projetam `organization_id` e `project_status` e deixam a decisão para o service (`isProjectReadable` / `enforceProjectReadable`, `backend/src/modules/streetview360/sv360.service.js:34`, `:48-50`). É o que permite a escada 404 → 403 acima, que um `WHERE` cego não sabe distinguir. O preço, e é o que interessa aqui, é que **no caminho de foto a garantia vale só enquanto cada call site lembrar de chamar o gate**: uma query nova que devolva linha de foto sem passar por lá vaza projeto oculto, e não existe teste de SQL que pegue isso, porque não há nada no SQL para testar.

## Contrato congelado do metadado

`buildPhotoMetadata` (`backend/src/modules/streetview360/sv360.service.js:283-326`) é o **único** lugar que define o shape; toda escrita que devolve foto re-lê por ali em vez de montar à mão. Ver [[sintese-contratos-congelados]]. O que quebra o viewer se mudar:

- `camera` é **plana**. Aninhar em `position`/`orientation` quebra. Note `height` ← coluna `camera_height`.
- Leitura expõe `distance`/`bearing`; a **criação** de link pede `distance_m`/`bearing_deg` (`backend/src/modules/streetview360/sv360.write.schemas.js:112-115`). Assimetria intencional: escrita fala a linguagem do banco, leitura a do contrato. Os três `override_*` são número **ou `null`**, nunca ausentes.
- `previewThumbnail` é relativo e **sem `/api/v1`** (`backend/src/modules/streetview360/sv360.service.js:309`); o cliente concatena com `streetView360.serviceUrl`. Ver [[config-runtime-urls-relativas]].
- Modelo geométrico: **chão plano**, Euler **ZXY**, `ele` informativo e fora da projeção. Detalhe em [[calibracao-e-grafo-360]].

Filtro e ordenação de `targets` vêm do SQL, não do JS (`backend/src/modules/streetview360/sv360.queries.js:99-110`): alvo oculto ou apontando para foto com tombstone simplesmente **não existe** para o viewer. Não replique essa filtragem no cliente.

Em `/projects` o campo é `center_long`, não `center_lng`.

## Validação de calibração não tem faixas (de propósito)

Todo numérico é `Joi.number()` finito, sem `min`/`max`, e as colunas são DOUBLE/INTEGER sem CHECK (`backend/src/modules/streetview360/sv360.write.schemas.js:6-17`). `heading: 400` e `distance_scale: 0` são **aceitos**. Não adivinhe faixas: as reais vivem no fonte não portado `1cgeo/ebgeo_360`, e apertar aqui rejeitaria valores que o cliente legítimo já envia. Corpo vazio ou campo desconhecido → 422 (todos os schemas são `.min(1)` + `.unknown(false)`).

## Tiles e o quirk do cliente

`fotos_linha` é **trajetória por `sequence_number`**, não o grafo dirigido de navegação; o grafo está por-foto em `targets`. Tile sem features é **200 com Buffer vazio** (MVT vazio é válido): não trate corpo vazio como erro. O `Cache-Control` é curto e **não** imutável, porque tiles mudam a cada ingestão, tombstone ou toggle de status (`backend/src/modules/streetview360/sv360.controller.js:97-98`).

**Custo escondido: o tile escala com o acervo, não com o que cabe nele.** Na `MVT_TILE` a CTE `visible` não tem filtro de bbox e é referenciada duas vezes (`backend/src/modules/streetview360/sv360.tiles.queries.js:39-49`), o que no Postgres a materializa: o `&&` contra a envelope só entra depois dela, nos dois ramos (`:60` e `:80`). Pior no ramo das linhas, que monta um `ST_MakeLine` por projeto sobre **todas** as fotos legíveis antes de descartar os projetos que não tocam o tile. O comentário `PERFORMANCE` do próprio arquivo (`:26-29`) promete o contrário, poda por índice GiST antes do `ST_AsMVTGeom`, e isso vale só depois da materialização. Trate como limite operacional: a latência do tile cresce com o tamanho do acervo, inclusive para tile vazio, e não há cache longo para amortizar (60 s). Um bbox dentro da `visible` é a correção óbvia, e a razão de ela não estar lá não está registrada em lugar nenhum.

Quirk que confunde na leitura do cliente: a camada de pontos usa o source id literal `'streetViewPointsSource'`, mas as camadas de linha usam como **source id** o próprio `config.streetView360.linesSourceLayer` (`frontend/src/js/street_view_tool/add_street_view_control.js:55,69-70,234`), ou seja o id da source acaba sendo a string `fotos_linha`, igual ao `source-layer`. Funciona; só não confunda os dois ao mexer ali. `pointsSource` e `linesSource` apontam para o **mesmo** template de tiles ([[config-dinamico]]).

## Upload de bundle: duas defesas antes do primeiro byte

`authDraining` e `requireUploadCapability` rejeitam **antes do multer** e **drenam** o corpo multipart antes de responder (`backend/src/modules/streetview360/sv360.routes.js:241-280`). Sem o dreno, rejeitar cedo derruba a conexão (ECONNRESET) e o cliente nunca vê o 4xx limpo; é a parte que se esquece ao copiar esse padrão para outro upload. Quem não tem capacidade de escrita alguma leva 403 com zero bytes em disco, fechando um DoS autenticado de enchimento de disco ([[upload-imagens-seguranca]]). O `diskStorage` grava no mesmo volume de `SV360_DB_DIR` para que o rename final seja atômico, não cross-device.

`PATCH /admin/projects/:slug/status` é o soft delete de verdade; `DELETE` é hard delete com CASCADE e remoção do `.db`. Fluxo do bundle em [[ingestao-projetos-360]]; aba cliente em `frontend/src/js/admin/catalog-tab.js:39`, ao lado de [[catalogo-3d]] e [[resources-catalogo]].

Thumbnail: a **URL** é por slug, mas o **arquivo em disco é org-keyed** (`{orgId}__{slug}.webp`, `backend/src/modules/streetview360/sv360.service.js:256-258`), então duas OMs com o mesmo slug não colidem nem vazam. O `:slug` é `^[a-z0-9-]+$` e passa por `path.basename` ([[hardening-borda-api]]).

## Não programe contra isto

`nearby` existe como service e query (`backend/src/modules/streetview360/sv360.service.js:182`, `backend/src/modules/streetview360/sv360.queries.js:115` `NEARBY_PHOTOS`) mas **não tem rota montada**, embora o schema já esteja escrito e rotulado para uma segunda etapa (`backend/src/modules/streetview360/sv360.schemas.js:92-94`). Quem for montá-la herda duas coisas que a query não avisa:

- `NEARBY_PHOTOS` é a leitura **sem nenhum predicado de acesso**; o filtro roda em JS depois (`backend/src/modules/streetview360/sv360.service.js:184-188`). Montar a rota exige embutir o predicado no SQL **antes**, com teste negativo, que é a regra de `backend/CLAUDE.md` para toda query com filtro de acesso.
- O filtro em JS roda **depois do `LIMIT 100`**, então foto de projeto oculto consome vaga do orçamento: um chamador cercado de projetos `disabled` recebe menos resultados legítimos do que deveria, sem sinal nenhum. É a mesma classe de "o corte acontece antes do filtro" documentada em [[ranking-busca-toponimos]], e some sozinha quando o predicado descer para o SQL.

`metadata` e `position` do 360 legado nunca foram portados. Não há alias `rotation-y` entre os PUTs de campo único, embora haja para os outros eixos.

Escritas exigem `auth` estrito ([[autenticacao-jwt]]); leituras são `flexibleAuth`.

## Fontes

Módulo `backend/src/modules/streetview360/` (routes, controller, service, queries, write.*, sv360-error), `backend/src/modules/config/config.service.js` (bloco `streetView360` do `/api/config`), e no cliente `frontend/src/js/street_view_tool/` + `store/sync/api-client.js`. Guia *16-streetview-360* absorvido (ver a seção de cache acima, que corrige a tabela dele).
