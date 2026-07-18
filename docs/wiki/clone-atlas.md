# Clone de Atlas

Operação que duplica todo o conteúdo de um atlas (mapas, features, layers, groups, dados 3D/360, briefings com remapeamento de map_id e settings) sob nova posse, deliberadamente deixando de fora compartilhamentos, link público, histórico de operações e os arquivos de imagem.

## Contrato

`POST /api/v1/atlas/:atlasId/clone`, corpo opcional `{ name }` (Joi `Joi.string().max(255)`, `backend/src/modules/atlas/atlas.schemas.js:50`). Resposta `201 { data: <atlas com maps> }` (`atlas.controller.js:54`), porque o service retorna `getAtlasById(newAtlasId)` fora da transação (`atlas.service.js:394`).

Permissão mínima: **`read`** (`atlas.routes.js:41`). Isso é intencional e é a decisão mais importante da operação: **qualquer um que consegue ler um atlas pode forkar o conteúdo inteiro para um atlas próprio do qual ele vira `owner`**. Inclui quem chegou por [[link-publico]] com permissão sintetizada `read`. Não trate clone como operação privilegiada; ver [[permissoes-atlas]] para a hierarquia `read < comment < write < manage < owner`.

O novo dono é `req.user.id` (o chamador), não o dono original (`atlas.controller.js:55`).

Nome padrão quando o corpo vem vazio: `` `${source.name} (cópia)` `` (`atlas.service.js:281`). Na prática o frontend nunca usa esse default, ele já manda o nome montado (`src/js/modals/project-picker.modal.js:446`).

## O que é copiado

Tudo dentro de uma única transação `tx()` (`atlas.service.js:273`).

**Atlas** — `name`, `description`, `settings` (JSONB inteiro, ver [[atlas-settings]]) e `owner_id = chamador` (`atlas.service.js:282-292`). Todas as demais colunas caem no default do schema: `is_public = FALSE`, `public_link = NULL`, `version = 1`.

**Mapas** — viewport (`center_lat`, `center_long`, `zoom`, `bearing`, `pitch`), `base_layer`, `notes_title`/`notes_description`, `analysis_layers`, `catalog_layers`, `locked` (`atlas.service.js:305-324`). O `map_order` do clone é reescrito depois com os IDs novos (`atlas.service.js:332-335`).

**Sub-entidades de cada mapa** — em `cloneMapSubEntities()` (`atlas.service.js:166`), na ordem obrigatória layers → groups → features → group_features → cesium3d → streetview360, porque cada passo depende do mapeamento de IDs do anterior:

- `layers` primeiro, produzindo `layerIdMapping` (features referenciam `layer_id`).
- `groups` em **duas passadas**: insere todos com `parent_id = NULL` e só depois faz `UPDATE` religando a hierarquia com os IDs novos (`atlas.service.js:189-202`). Sem isso um grupo filho inserido antes do pai violaria a FK.
- `features` com `layer_id` remapeado. Atenção: `feature.layer_id ? (layerIdMapping[...] || null) : null` (`atlas.service.js:216`) — feature cujo `layer_id` aponta para uma layer que não veio no lote (layer soft-deletada, ou ID órfão) sai do clone **sem layer**, silenciosamente.
- `group_features` só é reinserido quando **ambos** os lados existem no mapeamento (`atlas.service.js:232`), com `ON CONFLICT DO NOTHING`.
- `cesium3d_data` e `streetview360_data` do mapa (`atlas.service.js:240-262`).

**Briefings e slides** — briefing com `settings`, slides com `title`, `content`, `mode`, `model_id`, `photo_id`, `position`, `orientation` e o **`map_id` remapeado** via `mapIdMapping` (`atlas.service.js:373`). Slide cujo `map_id` não esteja no mapeamento vira `NULL` em vez de quebrar a FK. O `slide_order` é reescrito com os IDs novos (`atlas.service.js:384-389`).

Todas as leituras filtram `deleted_at IS NULL`, então o clone é também uma **compactação**: tombstones do soft-delete não atravessam. Ver [[atlas-modelo-de-dados]].

## O que NÃO é copiado (e por quê)

| Não vem | Onde se vê | Consequência |
|---|---|---|
| `atlas_shares` | INSERT sem shares (`atlas.service.js:282`) | Clone nasce sem membros. Ver [[compartilhamento-atlas]] |
| `is_public` / `public_link` | colunas não setadas, default `FALSE`/`NULL` | Clone de atlas público nasce privado. Ver [[link-publico]] |
| Histórico da tabela `operations` | nenhuma query em `operations` | Clone começa com log vazio. Ver [[tabela-operations]] |
| Linhas de `images` e os arquivos | nenhuma query em `images` | Referências mortas, ver abaixo. [[imagens-atlas]] |
| `comments` (comentário espacial) | nenhuma query em `comments` | Threads não atravessam. Ver [[comentario-espacial]] |
| Metadados de sync (`version`, `created_at`, `updated_at`) | INSERTs não listam essas colunas | Tudo reinicia em `version = 1` e `NOW()` |

O ponto de fundo: o clone copia **estado**, não **história**. Idempotência por `op_id` e ordem de chegada ([[modelo-conflito-lww]], [[idempotencia-e-convergence-guard]]) são propriedades do atlas de origem e não fazem sentido transplantadas. O clone é um novo atlas para efeito de sync, o primeiro peer que conectar recebe um [[snapshot-e-pull-incremental]] limpo.

Não copiar shares é o mesmo raciocínio: permissão é do container, não do conteúdo. Se shares viessem junto, um leitor poderia clonar e virar `owner` de um atlas que ainda expõe os mesmos membros.

## Armadilhas

**Imagens quebram.** As features clonadas mantêm em `properties` os IDs de imagem do atlas de origem, mas nenhuma linha de `images` é criada para o clone, e o download é escopado por atlas (`FIND_IMAGE_BY_ID` = `WHERE id = $1 AND atlas_id = $2`, `backend/src/modules/images/images.queries.js:20`; rota gateada por `requireAtlasPermission('read')` sobre o `atlasId` da URL). Logo `GET /atlas/<cloneId>/images/<imageIdOriginal>` responde **404 `Image`** (`images.service.js:68`). Não é "arquivo não duplicado", é referência morta.

> **Nota histórica.** guia *02-atlas-basico* (absorvido):368` diz que no clone "referências são mantidas mas os arquivos não são duplicados", sugerindo que a imagem continua resolvível. O código não copia sequer a linha de `images`, e `backend/src/modules/images/images.queries.js:20` filtra por `atlas_id`, então a referência mantida no `properties` da feature é irresolvível a partir do clone (404).

**Ordem de mapas e slides não é preservada.** `SELECT * FROM maps WHERE atlas_id = $1 AND deleted_at IS NULL` (`atlas.service.js:296`) e o `SELECT` de slides (`atlas.service.js:357`) não têm `ORDER BY`. O `map_order` / `slide_order` do clone é montado na ordem de retorno do Postgres, que não é garantida e ignora o `map_order`/`slide_order` da origem. Um atlas com mapas reordenados manualmente pode sair com a ordem embaralhada. Se for corrigir, ordene pela posição no array de ordem da origem antes de inserir.

**Comentários somem sem aviso.** A lista de exclusões do guia não menciona `comments`, e o código também não os copia. Quem esperava clonar um atlas de revisão junto com as threads vai encontrar os pins vazios.

**Não há broadcast.** Diferente de `duplicateMap`, que emite `map_duplicated` na sala do atlas (`atlas.controller.js:71`), o clone não notifica ninguém, porque o atlas destino não existia e não tem sala em [[canal-collab-websocket]]. Clientes só veem o clone ao recarregar a lista (`project-picker.modal.js:448` chama `_refresh()`).

**Transação longa, insert linha a linha.** Todo o clone é um loop de `INSERT` unitário dentro de uma transação única (`atlas.service.js:210-219` etc.). Em atlas grande isso segura conexão e locks por bastante tempo. Não existe modo assíncrono nem progresso; o cliente fica esperando o 201.

## Relação com `duplicateMap`

`cloneMapSubEntities()` é compartilhada com `POST /atlas/:atlasId/maps/:mapId/duplicate` (`atlas.service.js:401`), que copia **um** mapa dentro do **mesmo** atlas, exige `write` (`atlas.routes.js:44`), nomeia `` `${map.name} (cópia)` `` e faz `array_append` no `map_order`. Ou seja: mesma mecânica de remapeamento de IDs, gate de permissão diferente (duplicar dentro do atlas é escrita; clonar para fora é leitura). Qualquer correção no remapeamento afeta os dois caminhos.

## Onde isso encaixa

Clone é uma das poucas escritas de conteúdo colaborativo feitas por **REST**, e não pelo pipeline de operações ([[sintese-rest-vs-sync]]). Ela é permitida porque cria entidades num atlas que ainda não tem peers conectados, então não há conflito a resolver nem [[envelope-operacao]] a emitir. Para copiar conteúdo entre atlas já vivos, o caminho não é clone; é exportar/importar ([[atlas-import-offline]], [[formato-ebgeo-roundtrip]]).

Erros seguem o envelope padrão ([[erros-api]]): 404 se o atlas de origem não existe ou está soft-deletado (`FIND_ATLAS_BY_ID` filtra `deleted_at IS NULL`, `atlas.queries.js:9`), 403 sem permissão de leitura, 401 sem token. Ver também [[atlas-modelo-de-dados]] e [[api-rest-atlas]].

## Fontes
- guia *02-atlas-basico* (absorvido) (§7): endpoint, permissão mínima `read`, corpo `{ name }`, resposta 201, listas oficiais de "inclui" e "não inclui".
- `backend/src/modules/atlas/atlas.service.js`: `cloneAtlas()` e `cloneMapSubEntities()`, ordem de clonagem, mapeamentos de ID, duas passadas de `parent_id`, reescrita de `map_order`/`slide_order`, ausência de `ORDER BY`.
- `backend/src/modules/atlas/atlas.routes.js:41,44`: gate `requireAtlasPermission('read')` no clone vs `write` no duplicate de mapa.
- `backend/src/modules/atlas/atlas.controller.js:54-73`: novo dono = chamador, 201, ausência de broadcast no clone.
- `backend/src/modules/atlas/atlas.schemas.js:50`: `cloneAtlasSchema`.
- `backend/src/database/migrations/002_atlas.sql`: defaults de `atlas` (`is_public`, `settings`), tabelas `comments` e `images` não tocadas pelo clone.
- `backend/src/modules/images/images.queries.js:20` e `images.service.js:64-72`: escopo por `atlas_id` que torna a referência de imagem irresolvível no clone.
- `src/js/store/sync/api-client.js:589` e `src/js/modals/project-picker.modal.js:443-452`: chamada do frontend e nome enviado.
