# Controle de acesso geográfico por zonas

Autorização espacial embutida no próprio SQL: uma feição `private` só aparece para admin global, por permissão direta de modelo (catálogo 3D) ou quando cai dentro (`ST_Contains`) de uma zona-polígono do usuário, administrada pelo CRUD admin `/api/v1/zones` com permissões em replace-set.

## O modelo em uma frase

Não existe cadastro de acesso feição a feição para o gazetteer. O admin desenha um polígono (uma "zona"), concede a zona a usuários e/ou grupos, e **toda** feição privada cuja geometria caia dentro dela passa a ser visível para esses usuários, inclusive as que forem carregadas depois. O acesso é geométrico, não uma flag booleana de "tem alguma zona".

Três eixos de direito, avaliados como disjunção dentro do `WHERE`:

1. **`access_level = 'public'`** — visível para todos, inclusive anônimo. É o default da coluna (`NOT NULL DEFAULT 'public'`, `004_ng.sql:40`, `:64`, `:97`), então dados carregados sem tratamento não regridem para invisíveis.
2. **Admin global** — `EXISTS (SELECT 1 FROM users WHERE id = $5 AND role = 'admin')`, re-lido da tabela `users` dentro da query (`src/modules/nomes/nomes.queries.js:24`), **não** da claim do JWT.
3. **Zona espacial** (nomes e edificações) ou **permissão direta/por grupo de modelo** (catálogo 3D).

## Onde o filtro mora (e por que isso importa)

O predicado está dentro do SQL de leitura, não numa camada de aplicação depois do `SELECT`. Linha privada não autorizada nunca chega ao processo Node, logo não vaza nem com bug no controller, no serializador ou no cliente. Consequência direta para quem integra: **o frontend não deve filtrar nada** e não deve assumir que recebe registros ocultos para escondê-los. Detalhes das três rotas em [[gazetteer-nomes-geograficos]].

| Rota | Predicado aplicado | Arquivo |
|---|---|---|
| `GET /nomes/busca` | público OR admin OR `ST_Contains(zona, n.geom)` | `nomes.queries.js:22-26` (dentro da CTE `candidatos`) |
| `GET /nomes/feicoes` | público OR admin OR `ST_Contains(ST_Transform(zona,4326), e.geom)` | `nomes.queries.js:67-72` |
| `GET /nomes/catalogo3d` | público OR admin OR permissão direta/por grupo **de modelo** | `nomes.queries.js:112-113` e `:138-139` |

Dois pontos não óbvios:

- **No `/busca` o filtro entra ANTES do corte.** Está na CTE `candidatos`, que já tem `LIMIT 500` e alimenta a dedup e o ranking (`nomes.queries.js:21-28`). Um nome privado fora das zonas não aparece nem em posição baixa, e não consome vaga do top-500. O bloco de score, com pesos fixos somando 1.00, é congelado, e o filtro de acesso é a única extensão autorizada nele (ver [[ranking-busca-toponimos]]).
- **O `total` do `/catalogo3d` não mente.** `CATALOGO_SELECT` e `CATALOGO_COUNT` rodam em paralelo (`nomes.service.js:20-23`) com o predicado de acesso duplicado **verbatim**, mudando só o placeholder do userId (`$4` no SELECT, `$2` no COUNT). O próprio código avisa: nunca foi extraído para uma função SQL, então editar um sem o outro faz a paginação divergir da listagem (`nomes.queries.js:83-87`).

### Armadilha: zona NÃO se aplica ao catálogo 3D

O predicado do catálogo tem apenas os ramos `public`, `is_admin` e `ump.model_id IS NOT NULL` (permissão direta ou via `ng.user_groups`). Não há `ST_Contains` ali. O comentário no código descreve o ramo espacial como trabalho futuro ("fase-6 only ADDS the spatial zone branch", `nomes.queries.js:79-81`). Conceder uma zona que cobre o `lon/lat` de um modelo **não** libera o modelo. Ver [[catalogo-3d]] e [[assets3d-distribuicao]].

### Armadilha: `ST_Contains` exclui a borda

`ST_Contains` é estrito: um ponto exatamente sobre o anel da zona não está contido. Ao desenhar zonas colando em limites administrativos, use folga. Não existe variante `ST_Intersects`/`ST_Covers` no predicado.

### SRID: 4674 nas zonas, 4326 nas edificações

`ng.geographic_access_zones.geom` é `GEOMETRY(POLYGON, 4674)` (`004_ng.sql:219-226`), igual a `nomes_geograficos`, então o `ST_Contains` do `/busca` compara SRIDs iguais. `ng.edificacoes` é 4326, e por isso o `/feicoes` transforma a zona em tempo de consulta (`ST_Transform(uz.geom, 4326)`, `nomes.queries.js:71`). Efeito prático: nesse ramo o índice GIST `idx_zones_geom` não é aproveitado para a comparação, mas o `ST_DWithin` de 3 m já reduz o candidato a pouquíssimas linhas antes disso.

O tipo da coluna é `POLYGON`, não `MULTIPOLYGON`: uma área descontínua exige várias zonas, não um `MultiPolygon`.

### O predicado único: `ng.fn_user_zone_geoms`

Uma função SQL `STABLE` que devolve as zonas visíveis a um usuário, unindo grant direto (`ng.zone_permissions`) e grant por grupo (`ng.zone_group_permissions` JOIN `ng.user_groups`), `004_ng.sql:246-259`. O primeiro predicado da função é `p_user IS NOT NULL`, então **anônimo devolve conjunto vazio** e sobram apenas as linhas `public`. Como `/busca` aceita o caminho anônimo (`nomes.routes.js:15`, sem `auth` estrito, apenas o `flexibleAuth` global de [[auth-flexivel]]), esse ramo é alcançado de verdade em produção, não é só defesa em profundidade teórica.

## CRUD de zonas (`/api/v1/zones`)

Todas as sete rotas são `auth` + `requireAdmin` (`src/modules/zones/zones.routes.js:11-17`). Aqui, ao contrário das leituras do gazetteer, o papel vem da **claim do JWT** (`req.user.role !== 'admin'`, `src/middleware/require-admin.js:14`), não de releitura na tabela. Sem credencial é 401, autenticado sem papel é 403 (`require-admin.js:10-16`). Ver [[permissao-vs-papel]] e [[autenticacao-jwt]].

| Verbo | Efeito | Observação de contrato |
|---|---|---|
| `GET /zones` | lista metadados | **sem `geom`** (campo pesado), `zones.queries.js:3-5` |
| `GET /zones/:id` | zona com geometria | `ST_AsGeoJSON(geom)::jsonb`, chega como objeto já parseado |
| `POST /zones` | cria | resposta 201 **não ecoa** a geometria (`INSERT ... RETURNING id, name, description, created_at`) |
| `PUT /zones/:id` | substitui tudo | replace, não merge |
| `DELETE /zones/:id` | 204 | apaga permissões em cascata; feições intocadas |
| `GET /zones/:id/permissions` | `{ users: [uuid], groups: [uuid] }` | |
| `PUT /zones/:id/permissions` | replace-set transacional | `[]` remove todos |

**`PUT /zones/:id` é replace de registro inteiro.** O schema de update é literalmente o de create (`zones.schemas.js:16`), e o serviço grava `data.name || null` / `data.description || null` (`zones.service.js:46-51`). Omitir `name` num PUT **apaga** o nome. Sempre envie o estado completo.

**Validação de geometria em duas camadas.** Joi checa só a forma (`type: 'Polygon'` + array aninhado de números, `zones.schemas.js:4-7`, com `.unknown(true)`), e o PostGIS decide de verdade: `ST_IsValid(ST_SetSRID(ST_GeomFromGeoJSON($1), 4674))` (`zones.queries.js:15-17`). Duas mensagens distintas, ambas 422: `Invalid GeoJSON geometry` quando o parse explode (o `catch`), e `Invalid zone geometry (ST_IsValid failed)` quando parseia mas é topologicamente inválida, tipo anel auto-interseccionante (`zones.service.js:11-20`). A orientação do anel não é exigida.

**Mudar o polígono redefine o acesso na hora.** Não há reprocessamento nem cache: o `ST_Contains` é avaliado por consulta, então a próxima busca do usuário afetado já reflete o novo recorte. Pelo mesmo motivo, não existe push de invalidação para o cliente. Se o usuário trocar de conta ou ganhar/perder zona, **refaça as consultas**, ninguém avisa o frontend.

## Permissões: replace-set, com dentes

`PUT /zones/:id/permissions` roda numa única transação que lê o `before`, apaga usuários e grupos, reinsere o conjunto novo e grava a auditoria do diff, tudo commitando junto (`zones.service.js:74-92`). O insert usa `unnest($2::uuid[]) ... ON CONFLICT DO NOTHING` (`zones.queries.js:40-47`), então repetir UUID no array é inofensivo.

O array enviado é a verdade absoluta. Para acrescentar um usuário: `GET` das permissões, empurre no array, `PUT` do conjunto inteiro. Um `PUT { users: [] }` significa "revogue todos", e é intencional (`zones-gaps.test.js:111-131`).

Cada `PUT` gera auditoria de negócio `action: PERMISSION_GRANT`, `target_type: ZONE`, com `details.before` e `details.after` (`zones.service.js:85-88`), consultável pelas rotas de [[auditoria]].

### Comportamentos reais que o contrato feliz não descreve

- **FK violation vira 409, não 422 nem 500.** Um `group_id` inexistente bate na FK de `ng.zone_group_permissions` para `ng.groups` (`004_ng.sql:236-241`); o SQLSTATE 23503 é mapeado pelo error handler global para `409 CONFLICT`. A transação inteira faz rollback e as permissões anteriores continuam intactas (`tests/integration/zones-gaps.test.js:69-84`). Ver [[erros-api]].
- **`user_id` NÃO tem FK.** `ng.zone_permissions.user_id` é UUID solto (`004_ng.sql:228-234`): um UUID de usuário inexistente é inserido em silêncio com 200 e fica pendurado na tabela (`zones-gaps.test.js:90-107`). Valide o usuário na UI, o banco não valida. Use [[gestao-usuarios]] como fonte de UUIDs válidos.
- **Os endpoints de permissão não checam existência da zona.** `GET /zones/:id/permissions` numa zona fantasma responde 200 com `{users:[],groups:[]}`, não 404. `PUT` na mesma zona fantasma com um usuário real bate na FK de `zone_id` e volta 409 CONFLICT (`zones-gaps.test.js:180-207`). Só `GET /zones/:id` e `DELETE /zones/:id` dão 404 de verdade (`zones.service.js:29`, `:52`, `:58`).
- **`:id` não-UUID é 422 antes do controller**, com `details` apontando o campo `id` (`zones.schemas.js:23-25`).

> [!CONTRADICAO 2026-07-18] `docs/guias/15-acesso-geografico.md` §4 tabela de erros lista apenas 401/403/404/422 para as rotas de zona, e §2.x anuncia `404 NOT_FOUND` para "zona inexistente (GET/PUT/DELETE)"; o código em `src/modules/zones/zones.service.js:62-92` não faz checagem de existência nas rotas de permissões, então `GET /zones/:id/permissions` numa zona inexistente responde 200 vazio e `PUT` responde **409 CONFLICT** (violação de FK mapeada), status ausente da tabela do documento. Comportamento fixado em `tests/integration/zones-gaps.test.js:180-207`.

## Follow-ups: infraestrutura no banco sem rota REST

Duas coisas existem no schema mas não têm API:

- **Permissões de modelo 3D** (`ng.model_permissions`, `ng.model_group_permissions`, `004_ng.sql:193-214`) e o toggle de `access_level` do modelo. O filtro de leitura já as respeita; a concessão é feita direto no banco.
- **Grupos e membresia** (`ng.groups` + `ng.user_groups`, `004_ng.sql:178-191`). O ramo por grupo funciona quando as linhas existem, mas não há CRUD. Note que grupo aqui é uma entidade do schema `ng`, independente de [[organizacoes-om]], e independente dos papéis de atlas de [[permissoes-atlas]].

Não existe nenhuma tela de zonas no frontend: `ebgeo_web` não referencia `/api/v1/zones` em `src/js/` (o único consumo do gazetteer é `src/js/search/gazetteer-url.js:25`, que deriva a rota de `/nomes/busca` da base da API). Quem for construir o editor de zonas começa do zero.

## Checklist para não errar

- Nunca filtrar registro privado no cliente. Renderize o que vier.
- Refazer buscas ao trocar de usuário ou após mudança de permissão. Não há invalidação por push.
- Editor de zona deve emitir GeoJSON `Polygon` puro, 4674, `[lon, lat]`, anel fechado. Nada de `Feature`, `FeatureCollection` ou `MultiPolygon`.
- Tratar 422 de geometria com mensagem específica (polígono auto-interseccionante é o caso comum).
- Permissões sempre em read-modify-write. Nunca mandar delta.
- Tratar 409 (`CONFLICT`) no `PUT` de permissões, é UUID de grupo ou de zona inexistente.
- Telas de zona restritas a admin, com tratamento de 403 mesmo assim.
- Confirmação explícita no `DELETE` de zona: a cascata remove todos os grants, e não há undo.

Nada disso passa pelo sync de atlas: o gazetteer e as zonas são REST puro, sem WebSocket, sem `version` e sem snapshot, como descrito em [[sintese-modulos-fora-do-sync]] e [[sintese-eixos-de-permissao]].

## Observabilidade

As três rotas do gazetteer passam por `nomesAccessLog` (`src/middleware/nomes-access-log.js`), que loga `userId`, `ip`, `path` e **apenas as chaves** de query, deliberadamente sem os valores: para um gazetteer militar, o termo buscado e a coordenada clicada são sensíveis e não devem cair em agregador de log (`nomes-access-log.js:7-10`). Auditoria com valores é papel do `audit_trail`. Ver [[hardening-borda-api]].

## Fontes

- `docs/guias/15-acesso-geografico.md`: modelo dos três eixos de direito, contratos do CRUD `/api/v1/zones`, semântica replace-set, follow-ups não implementados.
- `docs/guias/13-nomes-geograficos.md`: efeito do filtro nas três rotas do gazetteer, contratos congelados de resposta, caminho anônimo do `/busca`.
- `ebgeo_backend/src/modules/nomes/nomes.queries.js`: predicados de acesso reais (`BUSCA:22-26`, `FEICOES:67-72`, `CATALOGO_SELECT:112-113`, `CATALOGO_COUNT:138-139`) e a duplicação verbatim SELECT/COUNT.
- `ebgeo_backend/src/modules/zones/*.js`: rotas, schemas Joi, validação `ST_IsValid`, transação de replace-set com auditoria.
- `ebgeo_backend/src/database/migrations/004_ng.sql`: DDL das zonas/grupos/permissões, defaults de `access_level`, definição de `ng.fn_user_zone_geoms`.
- `ebgeo_backend/tests/integration/zones-gaps.test.js` e `zones-coverage.test.js`: comportamentos fixados (409 por FK, `user_id` sem FK, permissões sem checagem de existência, prova de que o filtro é geométrico).
- `ebgeo_web/src/js/search/gazetteer-url.js`: único ponto de consumo do gazetteer no frontend; ausência de UI de zonas.
