# Controle de acesso geográfico por zonas

Autorização espacial embutida no próprio SQL de leitura: uma feição `private` só aparece se for pública, se o leitor for admin global, ou se cair dentro (`ST_Contains`) de um polígono concedido ao usuário.

## A decisão de fundo: o acesso é geométrico, não cadastral

Não existe cadastro de acesso feição a feição no gazetteer. O admin desenha um polígono, concede a usuários e/ou grupos, e **toda** feição privada cuja geometria caia dentro dele passa a ser visível, inclusive as carregadas depois. Isso é o que torna a carga de dados independente da administração de acesso: ninguém precisa reprocessar permissões após ingerir dados novos.

O preço é o simétrico: **não há como negar uma feição específica dentro de uma zona concedida**. A única granularidade é a geometria. Recorte fino exige recortar o polígono.

E o predicado vive **dentro do `SELECT`**, não numa camada de aplicação depois dele (`backend/src/modules/nomes/nomes.queries.js`). Linha privada não autorizada nunca chega ao processo Node, logo não vaza nem com bug no controller, no serializador ou no cliente. Consequência para quem integra: **o frontend não deve filtrar nada** e não deve supor que recebe registros ocultos para escondê-los. Ver [[gazetteer-nomes-geograficos]].

O papel de admin é **relido da tabela `users` dentro da query** (`backend/src/modules/nomes/nomes.queries.js`), não tirado da claim do JWT. Rebaixar um admin tem efeito na consulta seguinte, sem esperar o token expirar. O CRUD de zonas chega ao mesmo resultado por outro caminho (o middleware `auth` sobrescreve o papel antes do `requireAdmin`, ver abaixo), então os dois eixos concordam: papel global nunca vem da claim.

## Armadilhas do filtro de leitura

- **No `/busca` o filtro entra ANTES do corte.** Está na CTE `candidatos`, que já tem o `LIMIT` e alimenta dedup e ranking. Um nome privado fora das zonas não consome vaga do orçamento. O bloco de score tem pesos fixos somando 1.00 e é congelado; o filtro de acesso é a única extensão autorizada nele ([[ranking-busca-toponimos]]).
- **Zona NÃO se aplica ao catálogo 3D.** O predicado do catálogo tem só `public`, `is_admin` e permissão direta/por grupo de modelo. Não há `ST_Contains` ali: o ramo espacial é trabalho futuro anunciado em comentário. Conceder uma zona que cobre o `lon/lat` de um modelo **não** libera o modelo. Ver [[catalogo-3d]] e [[assets3d-distribuicao]].
- **`CATALOGO_SELECT` e `CATALOGO_COUNT` duplicam o predicado verbatim**, mudando só o placeholder do userId, e rodam em paralelo. Nunca foi extraído para função SQL: editar um sem o outro faz a paginação divergir da listagem em silêncio (aviso no próprio código).
- **`ST_Contains` exclui a borda.** Ponto exatamente sobre o anel não está contido. Ao desenhar zonas colando em limites administrativos, use folga. Não existe variante `ST_Intersects`/`ST_Covers` no predicado.
- **Anônimo funciona de verdade.** `ng.fn_user_zone_geoms` (`backend/src/database/migrations/004_ng.sql`) começa por `p_user IS NOT NULL` e devolve conjunto vazio para anônimo, e `/busca` aceita o caminho sem credencial (`backend/src/modules/nomes/nomes.routes.js`, apenas o `flexibleAuth` global de [[auth-flexivel]]). Esse ramo é alcançado em produção, não é defesa em profundidade teórica.

### Custo escondido: SRID 4674 nas zonas, 4326 nas edificações

Zonas são `GEOMETRY(POLYGON, 4674)` para casar com `nomes_geograficos` (tabela `ng.geographic_access_zones`, `backend/src/database/migrations/004_ng.sql`), então o `ST_Contains` do `/busca` compara SRIDs iguais e usa o índice. Já `ng.edificacoes` é 4326, e o `/feicoes` transforma a zona em tempo de consulta: nesse ramo o GIST `idx_zones_geom` não é aproveitado. Tolerável só porque o `ST_DWithin` de 3 m já reduziu o candidato a pouquíssimas linhas. Quem alargar esse raio paga o scan.

O tipo é `POLYGON`, não `MULTIPOLYGON`: área descontínua exige várias zonas.

## CRUD `/api/v1/zones`: o que o nome das rotas não entrega

Todas as rotas são `auth` mais `requireAdmin` (`backend/src/modules/zones/zones.routes.js`). E aqui **também** vale o papel vivo, não a claim: `requireAdmin` lê o papel de `req.user`, mas `auth` roda antes dele e já sobrescreveu esse campo com o valor lido em `users` (`getLiveAuthState`). Um admin global rebaixado perde as rotas de zona na hora, não ao fim da validade do token. Vale para toda rota com `requireAdmin` do backend, porque nenhuma monta o gate sem `auth` na frente.

O que de fato **não** é reconciliado é outro par, e é aí que mora o contraste com o filtro de leitura: `org_role` e `organization_id` seguem vindo do token de propósito. Ver [[permissoes-atlas]], [[autenticacao-jwt]] e [[sintese-eixos-de-permissao]].

- **Zona é a exceção declarada ao "soft-delete sempre".** `DELETE_ZONE` é um `DELETE FROM ng.geographic_access_zones` de verdade (`backend/src/modules/zones/zones.queries.js`), a tabela não tem coluna `deleted_at`, e a regra de `backend/CLAUDE.md` proíbe hard-delete de entidade principal sem qualificar. Os dois textos ficaram de pé ao mesmo tempo, o que faz um leitor que confia na constituição supor soft-delete aqui e um leitor que confia nesta página não perceber que está diante de uma exceção. Ela é exceção porque o schema `ng` é dado de referência carregado por FME, não entidade de usuário: não há sincronização, `version` nem tombstone a preservar. É por isso que "não tem undo" abaixo é literal, e não figura de linguagem.
- **`PUT /zones/:id` é replace de registro inteiro**, não merge: o schema de update é literalmente o de create, e omitir `name` num PUT **apaga** o nome. Sempre envie o estado completo. Pelo mesmo motivo, o `geom` que só volta em `GET /zones/:id` (a listagem e o 201 do POST o omitem) precisa ser relido antes de qualquer edição.
- **Geometria é validada em duas camadas, e nenhuma das duas checa faixa de coordenada.** Joi checa só a forma; quem decide é o PostGIS via `ST_IsValid`, e os dois 422 resultantes são distintos (o de topologia **não** traz `details` por campo, então a UI não consegue apontar o vértice errado).
- **O primeiro 422 é decidido por SQLSTATE, e isso não é detalhe de implementação.** Até 2026-07-25 o `catch` era nu e qualquer exceção da consulta virava `Invalid GeoJSON geometry`: PostGIS fora do `search_path`, EXECUTE revogado no schema `ng`, `statement_timeout` ou conexão caída diziam ao administrador que o polígono correto que ele acabou de desenhar estava malformado, e o incidente real não passava de um 422 no log. Hoje só a classe `22` e o `XX000` (que é, medido, o código de **toda** falha de parse do PostGIS) viram 422; o resto é repropagado como 5xx e logado. Teste: `backend/tests/integration/zones-geom-sqlstate.test.js`, que sombreia `ST_GeomFromGeoJSON` num schema à frente de `public` no `search_path` para induzir o SQLSTATE escolhido.
  - O vão: nem o Joi nem o `ST_IsValid` avaliam o domínio do SRID. Longitude 500 passa nas duas camadas, e como a geometria da zona nunca é castada para `::geography` no filtro de leitura, não há nem o 500 do PostGIS que serviria de alarme: o `ST_Contains` simplesmente nunca casa. O resultado é uma zona que não concede nada e não acusa erro. O módulo vizinho faz o oposto e é o que torna isso não-óbvio: `backend/src/modules/nomes/nomes.schemas.js` limita lat/lon com comentário explícito sobre exatamente esse risco. Quem lê só `zones.schemas.js` supõe que o PostGIS pega.
- **Mudar o polígono redefine o acesso na hora**, sem reprocessamento nem cache: o `ST_Contains` é avaliado por consulta. Pelo mesmo motivo **não existe push de invalidação**: ao trocar de conta ou ganhar/perder zona, refaça as consultas, ninguém avisa o frontend.

### Permissões são replace-set, e o array enviado é a verdade absoluta

`PUT /zones/:id/permissions` lê o `before`, apaga tudo, reinsere o conjunto novo e grava a auditoria do diff numa transação só (`setZonePermissions`, `backend/src/modules/zones/zones.service.js`). Para acrescentar um usuário: `GET`, empurre no array, `PUT` do conjunto inteiro. **Nunca mande delta.** `PUT { users: [] }` revoga todos, e é intencional; o `default([])` do Joi faz `PUT {}` significar revogação, não no-op. Cada `PUT` gera `PERMISSION_GRANT` com `before`/`after`, consultável em [[auditoria]].

Comportamentos reais que o contrato feliz não descreve, todos fixados em `backend/tests/integration/zones-gaps.test.js`:

- **FK violation vira 409, não 422 nem 500.** `group_id` inexistente bate na FK para `ng.groups`, o SQLSTATE 23503 é mapeado para `409` pelo handler global ([[erros-api]]) e a transação inteira faz rollback, preservando as permissões anteriores.
- **`user_id` NÃO tem FK** (tabela `ng.zone_permissions`, `backend/src/database/migrations/004_ng.sql`): UUID de usuário inexistente entra em silêncio com 200 e fica pendurado. Valide o usuário na UI, o banco não valida. Fonte de UUIDs válidos: [[gestao-usuarios]].
- **Os endpoints de permissão não checam existência da zona.** `GET` numa zona fantasma responde 200 vazio, não 404; `PUT` na mesma zona com usuário real bate na FK de `zone_id` e volta 409. Só `GET /zones/:id` e `DELETE /zones/:id` dão 404 de verdade.
- **`DELETE` cascateia os grants e não tem undo.** As feições ficam intocadas, mas todos os acessos somem, porque `ng.zone_permissions` e `ng.zone_group_permissions` referenciam a zona com `ON DELETE CASCADE` (`backend/src/database/migrations/004_ng.sql`). Exija confirmação explícita. Desde 2026-07-25 o gesto ao menos deixa rastro: `createZone`/`updateZone`/`deleteZone` emitem `ZONE_CREATE`/`ZONE_UPDATE`/`ZONE_DELETE` na transação da escrita, e a migração `007_audit_zone_actions.sql` abriu o CHECK para as três. Note o que a trilha guarda e o que não guarda: a ação e o id da zona, nunca o conjunto de grants que sumiu junto, ao contrário do `PUT` de permissões, que grava `before`/`after`. Ver [[auditoria]].
- **A geometria é uma fronteira de acesso, e por isso o `PUT` de zona é auditado como um `PUT` de permissões.** Redesenhar o polígono muda quem vê o quê exatamente como conceder ou revogar mudaria, e por um tempo essa metade não era registrada: a LISTA de permissões era rastreada e a FORMA a que ela se aplica não.

> **Nota histórica.** O guia *15-acesso-geografico* (absorvido) §4 lista apenas 401/403/404/422 para as rotas de zona e anuncia 404 para zona inexistente em GET/PUT/DELETE. O código não checa existência nas rotas de permissões, então o 409 acima está ausente da tabela do documento.

## O que existe no banco sem rota REST, e sem tela

- **Permissões de modelo 3D** (`ng.model_permissions`, `ng.model_group_permissions`, `backend/src/database/migrations/004_ng.sql`) e o toggle de `access_level` do modelo: o filtro de leitura já as respeita, mas a concessão é feita direto no banco.
- **Grupos e membresia** (`ng.groups` mais `ng.user_groups`, `backend/src/database/migrations/004_ng.sql`): o ramo por grupo funciona quando as linhas existem, mas não há CRUD. Grupo aqui é entidade do schema `ng`, independente de [[organizacoes-om]] e dos papéis de atlas de [[permissoes-atlas]].
- **Nenhuma tela de zonas no frontend.** `ebgeo_web` não referencia `/api/v1/zones`; o único consumo do gazetteer é `frontend/src/js/search/gazetteer-url.js`. Quem construir o editor começa do zero, e deve emitir GeoJSON `Polygon` puro em 4674, `[lon, lat]`, anel fechado: nada de `Feature`, `FeatureCollection` ou `MultiPolygon`.

Nada disso passa pelo sync de atlas: gazetteer e zonas são REST puro, sem WebSocket, sem `version`, sem snapshot ([[sintese-modulos-fora-do-sync]], [[sintese-eixos-de-permissao]]).

## Observabilidade: log de chaves, nunca de valores

`nomesAccessLog` registra **apenas as chaves** da query, deliberadamente sem os valores (`backend/src/middleware/nomes-access-log.js`): para um gazetteer militar, o termo buscado e a coordenada clicada são sensíveis e não devem cair em agregador de log. Auditoria com valores é papel do `audit_trail`. Ver [[hardening-borda-api]].
