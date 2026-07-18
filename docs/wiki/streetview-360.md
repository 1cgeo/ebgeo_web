# Módulo StreetView 360 (sv360)

Módulo `/api/v1/sv360` de panoramas 360: projetos, metadado congelado da foto (câmera plana + grafo `targets`), imagem WebP imutável, tiles MVT (`fotos`/`fotos_linha`) e thumbnails, com leitura de auth opcional (projeto `enabled` público, `disabled` só admin/OM dona).

## O que é (e o que não é)

O sv360 é um módulo REST autônomo montado em `/api/v1/sv360` (`src/modules/streetview360/sv360.routes.js:310`). Ele serve o viewer Three.js do frontend (`src/js/street_view_tool/`) e o estúdio de calibração/ingestão. Está **fora** do sistema de sync do atlas: nenhuma escrita 360 vira operação, nenhum peer recebe broadcast pelo [[canal-collab-websocket]]. Depois de um `PUT .../calibration` você recarrega `GET /sv360/photos/:uuid`, não espera evento. Ver [[sintese-modulos-fora-do-sync]].

> Atenção: o estado 360 **por mapa do atlas** (marcadores/orientações salvos pelo usuário) é outra coisa, esse sim trafega pelo sync como entidade `streetview360` e é persistido no side-store do cliente. O módulo `sv360` descrito aqui é o repositório de panoramas do servidor.

## Envelope: o módulo é a exceção do backend

Enquanto o resto da API responde `{ "data": ... }` e erros `{ "error": { "code", "message" } }` (ver [[erros-api]] e [[sintese-contrato-erros-http]]), o sv360 responde **objeto/array nu** e erro no envelope **plano** `{ "error": "mensagem" }`. Isso é imposto por um error handler de router montado como último middleware (`sv360-error.js:15`), que intercepta antes do handler global.

Armadilha real: o cliente REST genérico desembrulha `data` quando ela existe (`src/js/store/sync/api-client.js:261` só desembrulha se a resposta for objeto não-array com a chave `data`), então arrays nus do sv360 passam intactos, mas um objeto de projeto que por acaso tivesse `data` seria mutilado. Trate o sv360 como cliente à parte, como fazem `listSv360Projects`/`setSv360ProjectStatus`/`deleteSv360Project` (`api-client.js:515-535`).

Mapeamentos do handler de erro que valem lembrar:
- Erro Joi → **422** (`sv360-error.js:19-21`), exceto os params de tile, que viram **400** via `validateTileParams` (`sv360.routes.js:37-44`).
- SQLSTATE `23505` (unique violation) → **409**; `23503` (FK) → **409** (`sv360-error.js:26-33`). Sem essa branch um target duplicado sairia como 500.
- 5xx nunca vaza mensagem interna fora de dev (`sv360-error.js:35`).

## Política de acesso (leitura)

Todo o router aplica `flexibleAuth` (`sv360.routes.js:94`), o mesmo mecanismo de [[auth-flexivel]]: sem `Authorization` a leitura funciona anônima. A regra é:

```
projeto enabled  -> público
projeto disabled -> só role === 'admin' global OU membro da organization_id dona
```

A regra está **embutida no SQL** das leituras (defesa em profundidade), e um projeto oculto responde **404**, indistinguível de inexistente, para não vazar existência. Fotos com tombstone somem de toda leitura. Ver [[organizacoes-om]] e [[permissao-vs-papel]].

## Metadado da foto (contrato congelado)

`GET /sv360/photos/:uuid` (UUID v5 determinístico gerado pelo cliente) e `GET /sv360/photos/by-name/:nome` retornam o mesmo shape, montado por `buildPhotoMetadata` (`sv360.service.js:283-326`), fonte única do formato. Pontos que **não podem** mudar:

- `camera` é **plana**: `id, img, display_name, lon, lat, ele, heading, height, mesh_rotation_y/x/z, distance_scale, marker_scale, floor_level, calibration_reviewed`. Nada de aninhar em `position`/`orientation`. Note o mapeamento de coluna: `height` vem de `camera_height` (`sv360.service.js:293`).
- `targets[]` expõe `distance`/`bearing`, mapeados dos internos `distance_m`/`bearing_deg` (`sv360.service.js:320-321`). Os nomes internos **nunca** aparecem na leitura, mas são exatamente os usados na *criação* de link (§ escrita). `icon` é a constante literal `'next'`.
- `previewThumbnail` é **relativo e sem `/api/v1`** (`/thumbnails/{slug}.webp`, `sv360.service.js:309`). O cliente concatena com `streetView360.serviceUrl`. Ver [[config-runtime-urls-relativas]].

Ordenação e filtro de `targets` vêm do SQL, não do JS: `WHERE hidden = false AND NOT EXISTS (tombstone) ORDER BY is_next DESC, distance_m ASC` (`sv360.queries.js:99-110`). Ou seja, alvo oculto e alvo apontando para foto deletada simplesmente não existem para o viewer.

O modelo geométrico é **chão plano** com ordem de rotação Euler **ZXY**: `ele` é informativo e não entra na projeção; os `override_*` projetam no plano do chão. Detalhe do grafo e da calibração em [[calibracao-e-grafo-360]].

## Imagem WebP: ETag O(1), 304/206/416

`GET /sv360/photos/:uuid/image?quality=full|preview` (default `full`). A imagem é imutável após ingestão; os metadados vivem no PostgreSQL e o BLOB num SQLite por projeto (`{orgId}__{slug}.db`).

Sequência exata (`sv360.controller.js:142-191`):
1. `getPhotoImageMeta` lê só `full_size_bytes`/`preview_size_bytes` no Postgres e monta o ETag `"{uuid}-{quality}-{sizeBytes}"` (`sv360.service.js:135-142`), sem tocar no BLOB.
2. Headers imutáveis + `Accept-Ranges: bytes`.
3. `If-None-Match` batendo → **304 antes** de abrir o SQLite e **antes** de adquirir o semáforo de concorrência. É esse curto-circuito que torna a revalidação barata.
4. `Range` inválido → **416** + `Content-Range: bytes */<len>`; `Range` válido → **206**; sem Range → **200** + `Content-Length`.

Armadilha deliberada: `Content-Length`/`Content-Range` derivam do **tamanho real do buffer lido**, não do `size_bytes` do Postgres (`sv360.controller.js:150-155,174`). Em regime normal coincidem, mas durante a janela swap-do-arquivo↔commit da ingestão podem divergir, e confiar no buffer mantém toda resposta protocolarmente correta. Mesma família de contrato dos [[assets3d-distribuicao]] e de [[sintese-cache-http-imutavel]].

> [!CONTRADICAO 2026-07-18] `docs/guias/16-streetview-360.md` §5/§7 tabela `Cache-Control: public, max-age=31536000, immutable` para toda imagem/thumbnail; o código em `src/modules/streetview360/sv360.controller.js:52-63` escolhe o escopo pelo status do projeto: `enabled` recebe `public, max-age=31536000, immutable`, e `disabled` recebe `private, max-age=31536000, immutable` + `Vary: Authorization, Cookie`. Sem isso um proxy compartilhado poderia replicar para anônimos uma resposta autorizada de projeto oculto.

## Thumbnail do projeto

`GET /sv360/thumbnails/:slug.webp` serve do filesystem com o mesmo protocolo (ETag/304/206/416), mas o ETag vem de `fs.stat`: `"{slug}-{size}-{mtimeMs}"` (`sv360.controller.js:121`), pois não há `size_bytes` em Postgres para thumbnail. Arquivo pequeno, streamado sem semáforo.

Nuance importante: a **URL** é por slug, mas o **arquivo em disco é org-keyed**, derivado do `db_filename` já resolvido no servidor (`{orgId}__{slug}.webp`, `sv360.service.js:256-258`). Duas OMs que usem o mesmo slug não colidem em disco nem vazam entre si. O `:slug` é restrito a `^[a-z0-9-]+$` e passa por `path.basename` (anti-traversal), ver [[hardening-borda-api]].

## Fontes para o mapa: MVT com duas camadas

`GET /sv360/tiles/:z/:x/:y.pbf` renderiza o tile no servidor via PostGIS `ST_AsMVT`, com `z` em `0..24` e `x`/`y` dentro de `2^z`; fora disso é **400** limpo antes da query (`sv360.routes.js:37-44,108`).

| Camada | Geometria | Conteúdo |
|---|---|---|
| `fotos` | Point | pontos das fotos legíveis (`id`, `projectSlug`, `img`, `sequence_number`, ...) |
| `fotos_linha` | LineString | trajetória por projeto, fotos ligadas por `sequence_number` |

`fotos_linha` é **trajetória**, não o grafo dirigido de navegação; o grafo está por-foto em `targets`. Tile sem features na bbox é **200 com Buffer vazio** (MVT vazio é válido), então não trate corpo vazio como erro. `Cache-Control: public, max-age=60`, curto e **não** imutável, porque os tiles mudam a cada ingestão, tombstone ou toggle de status (`sv360.controller.js:97-98`).

`GET /sv360/tiles/fotos.geojson` continua existindo por compatibilidade, mas a config aponta para o MVT.

### Como o frontend liga isso

`GET /api/config` publica o bloco `streetView360` com `serviceUrl`, `pointsSource`/`linesSource` (ambos apontando para o **mesmo** template de tiles) e `pointsSourceLayer: 'fotos'` / `linesSourceLayer: 'fotos_linha'` (`ebgeo_backend/src/modules/config/config.service.js:187-193`). Ver [[config-dinamico]].

Quirk do cliente que confunde na leitura: a camada de pontos usa o source id literal `'streetViewPointsSource'`, mas as camadas de linha usam como **source id** o próprio `config.streetView360.linesSourceLayer` (`ebgeo_web/src/js/street_view_tool/add_street_view_control.js:55,69-70`), e o `addSource` é feito com a mesma chave (`:234`), então o id da source acaba sendo a string `fotos_linha`. Funciona, mas não confunda source id com `source-layer` ao mexer ali.

## Escrita e calibração

Rotas de escrita adicionam o middleware `auth` **estrito** (401 sem token, ver [[autenticacao-jwt]]). A posse é resolvida no service com a escada **404 → 403** (`sv360.write.service.js:49-52`): quem não consegue nem ler recebe 404 (sem vazar); quem lê mas não escreve recebe 403.

`canWriteProject` (`sv360.write.service.js:32-37`): admin global em qualquer OM, ou mesma `organization_id` com `org_role ∈ {owner, admin, editor}`. Um `viewer` da própria OM lê e não escreve.

Superfície: `PUT /photos/:uuid/calibration` (subconjunto qualquer, mínimo 1 campo), aliases de campo único (`height`, `rotation-x`, `rotation-z`, `distance-scale`, `marker-scale`, `reviewed`, sem alias para `rotation-y`), `POST /photos/batch-calibration` (máx. 500 itens, falha parcial por item), CRUD do grafo `targets` e soft-delete da foto. Detalhe operacional em [[calibracao-e-grafo-360]].

Duas decisões que costumam surpreender:
- **Validação é só de tipo/finitude, sem faixas.** Todo numérico é `Joi.number()` finito, `floor_level` é inteiro, `calibration_reviewed` é booleano estrito, e todos os schemas são `.unknown(false)` com `.min(1)` (`sv360.write.schemas.js:25-55`). `heading: 400` ou `distance_scale: 0` são **aceitos**: as colunas são DOUBLE/INTEGER sem CHECK e o contrato congelado não documenta faixas. Corpo vazio ou campo desconhecido → 422.
- **Criação de link usa os nomes internos** `distance_m`/`bearing_deg` (`sv360.write.schemas.js:112-115`), enquanto a leitura devolve `distance`/`bearing`. Não é inconsistência acidental: escrita fala a linguagem do banco, leitura fala a do contrato congelado.

Toda escrita que retorna foto re-lê e devolve o shape congelado do metadado, ou seja, `buildPhotoMetadata` é o único lugar que define o formato. Ver [[sintese-contratos-congelados]].

## Ingestão e administração

Sob `/sv360/admin`, com `auth` estrito e posse por organização. O upload de bundle (`POST /admin/projects/upload`, multipart `manifest` + `imagesDb` + `thumbnail` opcional) tem duas defesas antes de qualquer byte tocar o disco (`sv360.routes.js:241-280`):

- `authDraining` e `requireUploadCapability` rejeitam **antes do multer**, e **drenam** o corpo multipart antes de responder. Sem o dreno, rejeitar cedo derruba a conexão (ECONNRESET) e o cliente nunca vê o 4xx limpo. Quem não tem capacidade de escrita alguma leva 403 com zero bytes gravados, fechando um DoS de enchimento de disco autenticado (relacionado a [[upload-imagens-seguranca]]).
- `multer.diskStorage` grava no mesmo volume de `SV360_DB_DIR` para que o rename final seja atômico e não cross-device.

Restante do admin: `GET /admin/projects` (inclui `disabled`; admin global filtra por `?orgId`), `PATCH /admin/projects/:slug/status` (toggle `enabled`/`disabled`, o "soft delete" de verdade) e `DELETE /admin/projects/:slug` (hard delete com CASCADE + remoção do `{slug}.db`). Fluxo completo do bundle em [[ingestao-projetos-360]]; a aba de administração no cliente vive em `ebgeo_web/src/js/admin/catalog-tab.js:39`, ao lado do [[catalogo-3d]] e do [[resources-catalogo]].

## Rotas que não existem

Não programe contra elas: `nearby` existe como função de service e query (`sv360.service.js:158`, `sv360.queries.js:115`) mas **sem rota montada** em `sv360.routes.js`; `metadata` e `position` do 360 legado não foram portados.

## Fontes
- `docs/guias/16-streetview-360.md`: superfície de rotas, contrato congelado do metadado, protocolo de imagem/thumbnail, política de acesso, escada 404→403, ingestão e checklist de integração.
- `ebgeo_backend/src/modules/streetview360/sv360.routes.js`: ordem de rotas, flexibleAuth global + auth estrito local, validação 400 de tile, gate de upload com dreno do multipart.
- `ebgeo_backend/src/modules/streetview360/sv360.controller.js`: escopo de cache público/privado por status (divergência com o doc), ETag O(1), 304/206/416, semáforo, MVT.
- `ebgeo_backend/src/modules/streetview360/sv360.service.js`: `buildPhotoMetadata` (shape congelado), ETag da imagem, thumbnail org-keyed, `nearby` sem rota.
- `ebgeo_backend/src/modules/streetview360/sv360.queries.js`: filtro e ordenação de `targets`.
- `ebgeo_backend/src/modules/streetview360/sv360.write.schemas.js` e `sv360.write.service.js`: validação sem faixas, nomes internos na criação de link, `canWriteProject`/escada 404→403.
- `ebgeo_backend/src/modules/streetview360/sv360-error.js`: envelope plano, Joi→422, 23505/23503→409.
- `ebgeo_backend/src/modules/config/config.service.js`: bloco `streetView360` do `/api/config`.
- `ebgeo_web/src/js/street_view_tool/add_street_view_control.js` e `src/js/store/sync/api-client.js`: consumo das fontes vetoriais e das rotas admin no cliente.
