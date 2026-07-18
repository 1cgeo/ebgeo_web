# Síntese: o que fica fora do sync/CRDT do atlas

Gazetteer, catálogo 3D, assets e sv360 são módulos REST fora do sync colaborativo, sem `version`, snapshot ou broadcast WebSocket, o que obriga o frontend a refazer consultas manualmente após escritas ou mudanças de permissão.

## A fronteira: o que define "dentro" e "fora" do sync

O sync do atlas (ver [[modelo-conflito-lww]], [[envelope-operacao]], [[tipos-entidade-sync]]) tem quatro propriedades que os módulos deste documento **não** têm:

| Propriedade do sync | Gazetteer / catálogo 3D / assets / sv360 |
|---|---|
| Escrita como operação enfileirada ([[fila-operacoes-outbound]]) | Escrita é `PUT`/`POST` REST direto, ou não existe (gazetteer é read-only) |
| `version` + LWW por ordem de chegada ([[modelo-conflito-lww]]) | Sem versionamento, sem resolução de conflito; sv360 é "último upload manda" por `(organização, slug)` |
| Snapshot no `connect` ([[snapshot-e-pull-incremental]]) | Nada entra no snapshot do atlas |
| Broadcast no canal collab ([[canal-collab-websocket]], [[aplicacao-operacoes-remotas]]) | Nenhum broadcast; nenhum peer é notificado |

Consequência prática única e mais importante: **não existe push de invalidação**. Toda mudança de estado desses módulos (calibração 360, ingestão de bundle, toggle de zona, alteração de permissão) só chega ao cliente na próxima consulta HTTP que o cliente decidir fazer. Isso é o oposto do modelo assumido em [[presenca-colaborativa]] e [[canal-collab-websocket]].

## Os quatro módulos

### 1. Gazetteer (`/api/v1/nomes/*`)

Read-only, sem rotas de escrita, carga por job externo (FME). Três rotas: `/busca` (topônimos, [[ranking-busca-toponimos]]), `/feicoes` (identify de edificação 3D por clique) e `/catalogo3d` (lista paginada de modelos). Detalhe em [[gazetteer-nomes-geograficos]] e [[catalogo-3d]].

Envelopes **não** seguem o padrão da API ([[erros-api]], [[sintese-contratos-congelados]]):
- `/busca` responde **array nu** (sem `{ data }`), no máximo 5 itens já ordenados.
- `/catalogo3d` responde envelope próprio `{ total, page, nr_records, data }`, com `page` **1-based**.
- `/feicoes` responde **200** com `{ message }` quando não acha nada (não `404`, não array). Sempre cheque `id` vs `message`.

`/busca` é anônima (auth flexível, ver [[auth-flexivel]]); `/feicoes` e `/catalogo3d` exigem token ([[autenticacao-jwt]]).

### 2. Acesso geográfico por zonas (`/api/v1/zones`)

O filtro de visibilidade está **embutido no SQL** das três rotas do gazetteer (defesa em profundidade): `public` OR admin global OR permissão direta de modelo OR `ST_Contains(zona-do-usuário, feição)`. Ver [[zonas-acesso-geografico]] e [[hardening-borda-api]].

Isto é um eixo de permissão **independente** do papel no atlas ([[permissoes-atlas]], [[sintese-eixos-de-permissao]]): um `owner` de atlas não enxerga um topônimo privado se não tiver a zona. O CRUD de zonas é `admin`-only ([[permissoes-atlas]]).

Armadilhas:
- `PUT /zones/:id/permissions` é **replace-set**: `[]` remove todos. Faça read-modify-write.
- O `total` do `/catalogo3d` conta só o visível, então nunca o use para inferir a existência de itens ocultos.
- Alterar o polígono de uma zona redefine o recorte **na hora** (calculado por consulta), sem cache a invalidar no servidor. Mas o cliente que já buscou continua com o resultado velho.

### 3. sv360 (`/api/v1/sv360`)

Panoramas 360: projetos, metadado da foto (câmera plana + grafo `targets`), imagem WebP, tiles MVT, thumbnails, calibração e ingestão. Ver [[streetview-360]], [[calibracao-e-grafo-360]], [[ingestao-projetos-360]].

Caso à parte no cliente HTTP: sucesso é **objeto/array nu** e erro é o envelope **plano** `{ "error": "mensagem" }`, não `{ error: { code, message } }`. A imagem é imutável (`ETag`, `Cache-Control: immutable`, 304/206/416, ver [[sintese-cache-http-imutavel]]); já os tiles MVT usam `max-age=60` porque mudam a cada ingestão/toggle/tombstone.

Escrita de calibração é REST direta e **não emite broadcast**: depois de calibrar, recarregue `GET /sv360/photos/:uuid`. Dois usuários calibrando a mesma foto não convergem, o último `PUT` vence sem detecção de conflito.

### 4. Assets 3D e config

Distribuição de tilesets/b3dm/glb ([[assets3d-distribuicao]]) e o bloco `streetView360` do `/api/config` ([[config-runtime-urls-relativas]], [[config-dinamico]]) também são REST puros. O `previewThumbnail` do metadado é **relativo e sem o prefixo `/api/v1`**: concatene com `serviceUrl`.

## Como o frontend consome hoje, e onde isso morde

Busca de topônimos: `gazetteerSearchUrl()` deriva a rota da mesma base da API (`src/js/search/gazetteer-url.js:25`), consumida por `searchAPI` (`src/js/search/search-bar.search-providers.js:279`) e pelo controle legado (`src/js/search/feature-search.control.js:185`). Ambos tratam corretamente o array nu (`if (!Array.isArray(data)) return []`, `search-bar.search-providers.js:287`) e normalizam a longitude antes de enviar, porque `map.getCenter()` devolve longitude não-embrulhada e o gazetteer rejeita fora de ±180 com `422`.

Projetos 360: `fetchProjects` mantém um cache de módulo `_projectsCache` (`src/js/street_view_tool/streetview-api.service.js:145`) populado uma única vez pelo `preflightCheck` no boot (`src/js/map_sig.js:555`), que também é o gate de `config.features.imagens_panoramicas`. Catálogo ([[resources-catalogo]]) e configurações de atlas leem esse cache sem rede (`src/js/catalog/catalog.service.js:184`, `src/js/modals/atlas-settings.modal.js:199`).

Erros das rotas sv360 admin: `_request` extrai `parsed.error?.message` (`src/js/store/sync/api-client.js:234`). Como o sv360 responde `{ "error": "mensagem" }` (string), `err?.message` é `undefined` e o `ApiError` cai no fallback `HTTP <status>`, perdendo a mensagem do backend. Vale para `listSv360Projects`/`setSv360ProjectStatus`/`deleteSv360Project` (`api-client.js:516,526,535`).

## Divergências entre a documentação e o código

> [!CONTRADICAO 2026-07-18] guia *13-nomes-geograficos* (absorvido) manda enviar `Authorization: Bearer` e (idealmente) `zoom` em `/nomes/busca`; o código em src/js/search/search-bar.search-providers.js:279 e src/js/search/feature-search.control.js:185 envia apenas `q`, `lat` e `lon`, sem header de autorização. Efeito real: a barra de busca é sempre anônima (só topônimos `public`, mesmo com usuário logado que tenha zona) e o raio de decaimento fica fixo em 50 km, com o ajuste por tipo desligado.

> [!CONTRADICAO 2026-07-18] guia *13-nomes-geograficos* (absorvido) descreve `/nomes/catalogo3d` e `/nomes/feicoes` como as fontes do painel 3D e do identify; nenhuma das duas rotas é chamada em `src/js` (grep sem ocorrências). O catálogo 3D do app vem de `config.tilesets`, servido pelo `/api/config` e lido em src/js/store/sync/atlas-settings.service.js:188.

> [!CONTRADICAO 2026-07-18] guia *15-acesso-geografico* (absorvido) instrui "refaça as consultas ao trocar de usuário ou após mudança de permissão"; o código não refaz nada: `_projectsCache` (src/js/street_view_tool/streetview-api.service.js:145) só é invalidado por `fetchProjects(true)`, chamado exclusivamente pelo `preflightCheck` do boot (src/js/map_sig.js:555), e nenhum módulo desses escuta `SESSION_CHANGED`.

## Regras para não errar

1. **Depois de escrever, releia.** Não espere evento. Escrita de calibração 360, ingestão de bundle e toggle de zona não produzem operação, não entram na [[fila-operacoes-outbound]] e não passam por [[ack-idempotencia]].
2. **Depois de login/logout, invalide.** A visão do gazetteer e do sv360 depende de quem está autenticado. Hoje o app não invalida; se você adicionar um consumidor novo, prenda-o a `SESSION_CHANGED` ([[sessao-boot-e-ciclo-de-vida]]).
3. **Trate cada módulo como um cliente HTTP separado.** Três envelopes distintos coexistem: `{ data }` padrão, array/objeto nu (busca e sv360) e `{ total, page, nr_records, data }`. Erro plano do sv360 quebra o parser de erro padrão.
4. **Não filtre no cliente.** O que o usuário não pode ver simplesmente não chega. Renderize o que vier.
5. **Não confunda os eixos de permissão.** Papel no atlas ([[permissoes-atlas]]), papel na OM ([[organizacoes-om]], escrita sv360 exige `org_role ∈ {owner, admin, editor}`) e zona geográfica são independentes.
6. **Nada disso entra no `.ebgeo`.** O que o formato leva é o conteúdo do atlas ([[formato-ebgeo-roundtrip]], [[atlas-modelo-de-dados]]); estes módulos são referências externas resolvidas por URL em tempo de execução, e por isso não fazem parte de [[dominio-local-vs-remoto]] nem de [[dominio-local-vs-remoto]].

Ver também [[sintese-rest-vs-sync]], [[sintese-rest-vs-websocket]] e [[sintese-limites-collab]] para o traçado geral da fronteira REST/sync.

## Fontes
- guia *13-nomes-geograficos* (absorvido): rotas do gazetteer, contratos congelados (array nu, `{message}` no 200, envelope `{total,page,nr_records,data}`), ausência de escrita/CRDT/WebSocket, carga FME e `ng.refresh_busca()`.
- guia *15-acesso-geografico* (absorvido): predicado de acesso embutido no SQL, zonas-polígono admin-only, replace-set de permissões, ausência de push de invalidação, `total` só do visível.
- guia *16-streetview-360* (absorvido): envelope nu + erro plano, política de acesso por projeto `enabled`/`disabled`, contrato congelado do metadado, cache imutável da imagem vs MVT de 60s, escrita/calibração sem broadcast, ingestão "estado completo".
- src/js/search/gazetteer-url.js, search-bar.search-providers.js, feature-search.control.js: consumo real da busca (sem token, sem `zoom`, wrap de longitude).
- src/js/street_view_tool/streetview-api.service.js, src/js/map_sig.js: cache de projetos 360 sem invalidação, preflight único no boot.
- src/js/store/sync/api-client.js, atlas-settings.service.js: parser de erro incompatível com o envelope plano do sv360; catálogo 3D vindo de `config.tilesets`.
