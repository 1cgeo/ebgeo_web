# Módulo StreetView 360 (sv360)

Repositório de panoramas em `/api/v1/sv360`: é a exceção do backend em envelope, em cache e em sync, e quase toda armadilha do módulo nasce de uma dessas três exceções.

## Duas coisas chamadas "360" (a confusão mais cara)

- O módulo `sv360` (backend, `src/modules/streetview360/`) é o acervo de panoramas do servidor: projetos, fotos, grafo de navegação, imagem WebP.
- A entidade de sync `streetview360` é outra coisa: marcadores e orientações que o usuário salva **por mapa do atlas**, que trafegam pelo [[canal-collab-websocket]] e vivem no side-store do cliente.

O módulo `sv360` está **fora** do sync: nenhuma escrita 360 vira operação, nenhum peer recebe broadcast. Depois de um `PUT .../calibration` o cliente **recarrega** `GET /sv360/photos/:uuid`; quem esperar evento espera para sempre. Ver [[sintese-modulos-fora-do-sync]]. Consequência de esquema: `sv360.photos` tem `updated_at` mas nenhuma coluna `version`, e `sv360.targets` não tem nenhuma das duas (`backend/src/modules/streetview360/sv360.write.service.js:13-15`); não há como enxertar LWW aqui sem migração.

## Envelope: por que o módulo destoa do resto da API

O backend responde `{ data }` e erro `{ error: { code, message } }` ([[erros-api]], [[sintese-contrato-erros-http]]). O sv360 responde **objeto/array nu** e erro **plano** `{ "error": "mensagem" }`, imposto por um error handler de router montado por último (`backend/src/modules/streetview360/sv360-error.js:15`), que intercepta antes do global. Isso é contrato congelado herdado do viewer legado, não descuido.

Armadilha de cliente: o REST genérico desembrulha `data` sempre que a resposta é objeto não-array contendo essa chave (`frontend/src/js/store/sync/api-client.js:261`). Hoje nenhum shape do sv360 tem `data`, então tudo passa intacto, mas **acrescentar um campo `data` a qualquer resposta do sv360 mutila o corpo silenciosamente no cliente**, sem erro. Por isso as chamadas sv360 vivem apartadas (`frontend/src/js/store/sync/api-client.js:515-535`).

Do handler, o que não é óbvio: erro Joi vira **422**, mas os params de tile viram **400** por caminho próprio (`backend/src/modules/streetview360/sv360.routes.js:37-44`), porque o contrato MVT quer 400 em coordenada malformada. E `23505`/`23503` são mapeados para **409** ali dentro (`backend/src/modules/streetview360/sv360-error.js:27-33`); o handler global já fazia isso, mas o de router intercepta primeiro, e sem essa branch um target duplicado voltava 500.

## Cache: o único ponto onde o "immutable" tem escopo variável

Toda imagem/thumbnail é imutável, mas o **escopo** depende do status do projeto (`backend/src/modules/streetview360/sv360.controller.js:52-63`): `enabled` recebe `public`, `disabled` recebe `private` + `Vary: Authorization, Cookie`. Um cache compartilhado só pode guardar resposta que todo mundo pode ver; sem essa distinção um proxy replicaria para anônimos uma resposta autorizada de projeto oculto.

> [!CONTRADICAO] O guia absorvido *16-streetview-360* §5/§7 tabela `public, max-age=31536000, immutable` para toda imagem e thumbnail. O código diverge de propósito, como acima. Vale o código.

Armadilha deliberada no protocolo de Range: `Content-Length`/`Content-Range` derivam do **buffer realmente lido**, não do `size_bytes` do Postgres (`backend/src/modules/streetview360/sv360.controller.js:150-155,174`). Em regime normal coincidem; na janela swap-do-arquivo↔commit da ingestão podem divergir, e confiar no buffer mantém toda resposta protocolarmente correta. Não "otimize" isso lendo o tamanho do Postgres. Mesma família de [[assets3d-distribuicao]] e [[sintese-cache-http-imutavel]].

O 304 acontece **antes** de abrir o SQLite e **antes** do semáforo de concorrência: é isso que torna revalidação barata, e é a razão de o ETag vir só de colunas de tamanho no Postgres. Mover o cálculo do ETag para o BLOB destruiria a propriedade.

## Ocultação: 404 é ambíguo por decisão

Projeto `enabled` é público; `disabled` só admin global ou membro da OM dona ([[auth-flexivel]], [[organizacoes-om]], [[permissoes-atlas]]). A regra está **embutida no SQL** das leituras, não só no service, e projeto oculto responde **404**, indistinguível de inexistente. Nas escritas a escada é **404 → 403** (`backend/src/modules/streetview360/sv360.write.service.js:49-52`): quem não lê nem sabe que existe; quem lê mas não escreve (um `viewer` da própria OM) recebe 403. Portanto **não trate 404 do sv360 como "não existe"**: pode ser "existe e não é seu".

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

Quirk que confunde na leitura do cliente: a camada de pontos usa o source id literal `'streetViewPointsSource'`, mas as camadas de linha usam como **source id** o próprio `config.streetView360.linesSourceLayer` (`frontend/src/js/street_view_tool/add_street_view_control.js:55,69-70,234`), ou seja o id da source acaba sendo a string `fotos_linha`, igual ao `source-layer`. Funciona; só não confunda os dois ao mexer ali. `pointsSource` e `linesSource` apontam para o **mesmo** template de tiles ([[config-dinamico]]).

## Upload de bundle: duas defesas antes do primeiro byte

`authDraining` e `requireUploadCapability` rejeitam **antes do multer** e **drenam** o corpo multipart antes de responder (`backend/src/modules/streetview360/sv360.routes.js:241-280`). Sem o dreno, rejeitar cedo derruba a conexão (ECONNRESET) e o cliente nunca vê o 4xx limpo; é a parte que se esquece ao copiar esse padrão para outro upload. Quem não tem capacidade de escrita alguma leva 403 com zero bytes em disco, fechando um DoS autenticado de enchimento de disco ([[upload-imagens-seguranca]]). O `diskStorage` grava no mesmo volume de `SV360_DB_DIR` para que o rename final seja atômico, não cross-device.

`PATCH /admin/projects/:slug/status` é o soft delete de verdade; `DELETE` é hard delete com CASCADE e remoção do `.db`. Fluxo do bundle em [[ingestao-projetos-360]]; aba cliente em `frontend/src/js/admin/catalog-tab.js:39`, ao lado de [[catalogo-3d]] e [[resources-catalogo]].

Thumbnail: a **URL** é por slug, mas o **arquivo em disco é org-keyed** (`{orgId}__{slug}.webp`, `backend/src/modules/streetview360/sv360.service.js:256-258`), então duas OMs com o mesmo slug não colidem nem vazam. O `:slug` é `^[a-z0-9-]+$` e passa por `path.basename` ([[hardening-borda-api]]).

## Não programe contra isto

`nearby` existe como service e query (`backend/src/modules/streetview360/sv360.service.js:158`, `backend/src/modules/streetview360/sv360.queries.js:115` `NEARBY_PHOTOS`) mas **não tem rota montada**. `metadata` e `position` do 360 legado nunca foram portados. Não há alias `rotation-y` entre os PUTs de campo único, embora haja para os outros eixos.

Escritas exigem `auth` estrito ([[autenticacao-jwt]]); leituras são `flexibleAuth`.

## Fontes

Módulo `backend/src/modules/streetview360/` (routes, controller, service, queries, write.*, sv360-error), `backend/src/modules/config/config.service.js` (bloco `streetView360` do `/api/config`), e no cliente `frontend/src/js/street_view_tool/` + `store/sync/api-client.js`. Guia *16-streetview-360* absorvido (ver contradição de cache acima).
