# Catálogo 3D (descoberta de modelos)

`GET /api/v1/nomes/catalogo3d` lista modelos 3D com metadados de cena, sob envelope congelado próprio e filtro de acesso embutido no SQL. Contrato em `backend/src/modules/nomes/nomes.{routes,schemas,queries,service}.js`.

## Duas fontes de modelos 3D, e o cliente usa a outra

> **Nota histórica.** guia *14-catalogo3d-assets* (absorvido):12-15 afirma que `/nomes/catalogo3d` é "a fonte única de descoberta" dos modelos 3D. No cliente atual não há uma única referência a `catalogo3d` nem a `assets3dBaseUrl` em `src/`: o visualizador resolve por `config.tilesets.find(t => t.id === tilesetId)` (`frontend/src/js/3d_models_viewer_tool/map_3d.js:872`), lista servida pelo `/api/config` a partir da tabela `tilesets` do catálogo de resources ([[resources-catalogo]]). São dois catálogos distintos, com modelos de permissão distintos.

A divergência não é só de origem, é de vocabulário: o cliente discrimina por `type === 'glb'` (`frontend/src/js/3d_models_viewer_tool/map_3d.js:877`), enquanto `ng.catalogo_3d` tem CHECK em `'Tiles 3D' | 'Modelos 3D' | 'Nuvem de Pontos'` (`backend/src/database/migrations/004_ng.sql:91`). Quem integrar precisa decidir qual manda e mapear os dois vocabulários, não apenas trocar a URL do fetch. E `config.tilesets` não tem controle de acesso por modelo; `ng.catalogo_3d` tem. Migrar o cliente para o catálogo `ng` é um endurecimento de segurança, não uma refatoração cosmética.

## Predicado de acesso duplicado entre SELECT e COUNT

O filtro (admin global, ou permissão direta em `ng.model_permissions`, ou por grupo em `ng.model_group_permissions`) vive dentro do SQL, não na aplicação: dado privado não vaza nem com bug de controller. O custo dessa escolha é que `CATALOGO_SELECT` e `CATALOGO_COUNT` **duplicam o predicado verbatim**, mudando só o placeholder do `userId` (`$4` no SELECT, `$2` no COUNT) porque nunca foi extraído para uma função SQL (`backend/src/modules/nomes/nomes.queries.js:83-87`). **Ao editar o filtro, edite os dois**, ou `total` passa a mentir sobre o que o usuário vê e a paginação ganha páginas fantasma. Os dois rodam em `Promise.all` (`backend/src/modules/nomes/nomes.service.js:20-23`), então a divergência não aparece como erro, só como contagem errada.

Armadilha de eixo: aqui o critério é **permissão por modelo**, não zona geográfica. As zonas (`ng.fn_user_zone_geoms`) valem para `nomes_geograficos` e `edificacoes`, não para o catálogo ([[zonas-acesso-geografico]]), e nenhum dos dois se relaciona com o papel por atlas ([[permissoes-atlas]]) ou com o papel global ([[gestao-usuarios]]). O comentário em `backend/src/modules/nomes/nomes.queries.js:79-81` deixa o `WHERE` como disjunção justamente para que a branch espacial possa ser somada depois sem reescrever a query.

## Contrato congelado

- Envelope **próprio** `{ total, page, nr_records, data }`, não o `{ data }` padrão da API. O controller devolve o objeto do service sem embrulhar, e avisa disso no topo do arquivo (`backend/src/modules/nomes/nomes.controller.js:2-3,18`). Ver [[sintese-contratos-congelados]].
- `url` e `thumbnail` trafegam como as strings relativas armazenadas, **sem prefixo**, fixado por teste de contrato (`backend/tests/integration/nomes-catalogo3d-gaps.test.js:173`). A URL final é `assets3dBaseUrl + url`, com `assets3dBaseUrl` vindo do `/api/config` (`backend/src/modules/config/config.service.js:186`). Hardcodar `/api/v1/assets3d` no cliente anula o propósito do campo: apontar para um host de estáticos interno sem rebuild e sem reescrever o catálogo ([[config-runtime-urls-relativas]], [[config-dinamico]]).

> **Nota histórica.** guia *13-nomes-geograficos* (absorvido):358-359 mostra `thumbnail`/`url` como URLs absolutas, sugerindo que o campo pode ser absoluto. O contrato testado é relativo, e guia *14-catalogo3d-assets* (absorvido):134-135 o declara congelado assim. Trate como relativo.

Descoberta não é distribuição: o binário (`tileset.json`/`.b3dm`/`.glb`/`.pnts`) vem de outra rota, pública, com ETag/Range/`immutable` ([[assets3d-distribuicao]], [[sintese-cache-http-imutavel]]). Deixe o Cesium emitir as requisições `Range`: envolver o asset num fetch próprio descarta `Accept-Ranges` e destrói o streaming por LOD.

## Cuidados de consumo

- `q=''` passa no Joi (`backend/src/modules/nomes/nomes.schemas.js:21`) e vira `null` no service (`backend/src/modules/nomes/nomes.service.js:18`): string vazia **lista tudo** em vez de buscar por vazio. Campo de busca que dispara a cada tecla não precisa tratar "limpou o campo".
- Sem `q`, `rank` é a constante `0` (o `CASE` em `backend/src/modules/nomes/nomes.queries.js:106-108`) e o `ORDER BY rank DESC, data_criacao DESC` degrada para "mais recente primeiro". Não exiba `rank` como relevância quando não houve termo.
- `page` é **1-based** e `page=0` morre no Joi com `422`, não chega ao SQL ([[erros-api]]). UI 0-based precisa somar 1 antes de enviar.
- `total` já reflete o filtro de acesso do usuário; não é contagem global do catálogo.
- Rota é `auth` **estrito** (`backend/src/modules/nomes/nomes.routes.js:17`), ao contrário de `/nomes/busca`, que preserva o caminho anônimo por decisão explícita (`backend/src/modules/nomes/nomes.routes.js:11-15`). Sem token, `401` ([[autenticacao-jwt]]).
- Módulo read-only, sem rota de escrita, carga externa: fora do sync, sem `version`, sem broadcast, sem snapshot ([[sintese-modulos-fora-do-sync]], [[gazetteer-nomes-geograficos]]).
- Asset ausente com catálogo apontando para ele (`404` no binário) deve ocultar e logar o modelo, não derrubar a cena.

## Por que o log omite os valores da query

`nomesAccessLog` registra `userId`, `ip`, `path` e apenas as **chaves** da query (`backend/src/middleware/nomes-access-log.js:17`). Num gazetteer militar o termo buscado e as coordenadas clicadas são o dado sensível, e logs operacionais podem seguir para agregadores. Se um dia for preciso auditoria em nível de valor, o lugar é a `audit_trail` ([[auditoria]]), não o logger.
