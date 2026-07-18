# Configurações do Atlas (settings)

Overlay **apenas restritivo** por atlas sobre a config de deploy, trafegado por REST + frame WebSocket dedicado, fora do log de operações.

O objeto e seus campos estão declarados em `ebgeo_backend/src/modules/atlas/atlas.schemas.js:19-40`; a semântica de interseção está no JSDoc de `src/js/store/sync/atlas-settings.service.js`. Esta página cobre só o que esses arquivos não contam.

## Por que settings fica fora do sync

É metadado do [[atlas-modelo-de-dados]], não entidade sincronizada ([[tipos-entidade-sync]]). Consequência que morde: não há resolução LWW aqui (comparar com [[modelo-conflito-lww]]), o último PATCH simplesmente vence e a `version` do atlas é incrementada. Dois Gestores editando settings ao mesmo tempo perdem trabalho sem qualquer sinal. Ver [[sintese-rest-vs-sync]] e [[sintese-modulos-fora-do-sync]].

## Armadilha nº 1: o merge é raso, e o PATCH parece parcial

`SET settings = settings || $2::jsonb` (`ebgeo_backend/src/modules/atlas/atlas.queries.js:69-76`). O `||` em `jsonb` faz merge de **primeiro nível apenas**.

Enviar `{"features": {"map_3d": false}}` **substitui o objeto `features` inteiro** e apaga `panoramic_images`, `terrain_3d`, `data_layers`, `analysis_layers`. O sintoma é traiçoeiro: como o cliente trata flag ausente como ligada (`x !== false`), nada some da tela; o que estava desligado volta a ligado, em silêncio.

> **Nota histórica.** guia *02-atlas-basico* (absorvido) §6 apresenta `{"features": {"map_3d": false}, "max_zoom": 15}` como patch parcial seguro. É merge raso (`backend/src/modules/atlas/atlas.queries.js:71`) e descarta as demais chaves de `features`.

**Não mande deltas.** GET, mute o objeto local, mande o bloco inteiro, que é o que o modal faz (`src/js/modals/atlas-settings.modal.js:347-350`). Uma correção "óbvia" no backend (trocar `||` por merge profundo) muda o contrato de quem já manda bloco completo apenas na aparência, mas passa a impedir a remoção de chave: avalie antes de mexer.

## Armadilha nº 2: `manage` no backend é `manager` no cliente

O gate REST é `requireAtlasPermission('manage')` (`backend/src/modules/atlas/atlas.routes.js:35`), mas o papel que chega ao cliente é `'manager'`, traduzido em `ebgeo_backend/src/utils/roles.js:15`. São dois vocabulários para o mesmo nível. Um gate de UI escrito com o termo do outro lado passa no lint e falha silenciosamente; e um gate escrito como `permission === 'write' || 'owner'` exclui o co-Gestor, que legitimamente configura. O código atual acerta (`src/js/account/account.control.js:415,451`). Ver [[permissoes-atlas]] e [[sintese-eixos-de-permissao]].

> **Nota histórica.** guia *02-atlas-basico* (absorvido) §8 mostra `setSettingsVisible(isOwner)`, sugerindo configuração exclusiva do owner. A rota exige `manage`, e a matriz do próprio documento lista "Alterar configurações do atlas" como ✅ para `manage`. Trate como `manage`.

## Contratos congelados do overlay

Três invariantes que não estão em nenhum arquivo isolado e quebram de formas difíceis de diagnosticar:

- **Lista vazia significa "sem restrição"**, nunca "nada permitido". Inverter isso trancaria todo atlas existente, cujo default é `[]`. Por isso o modal colapsa "seleção total" de volta para `[]` antes de salvar (`src/js/modals/atlas-settings.modal.js:333-345`): gravar a lista cheia congelaria um snapshot do catálogo daquele dia, e itens novos do deploy nunca apareceriam.
- **Os arrays são substituídos in place** (`replaceArrayInPlace`). Módulos como o catálogo capturam a referência no boot; trocar por reatribuição os deixa apontando para a lista pré-overlay, sem erro algum.
- **Reaplicar exige estar conectado.** Um frame `atlas_settings_updated` chegando na janela entre `disconnect` e o revert re-capturaria a config **já restaurada** como novo baseline, restringindo o app local até um F5. Daí o guard `if (!connectionState.isOnline()) return;` (`src/js/store/sync/sync-engine.js:477-481`). Qualquer novo consumidor de settings precisa do mesmo guard. Ver [[canal-collab-websocket]].

O overlay nunca existe no store local ([[dominio-local-vs-remoto]]): `disconnect()` reverte ao baseline de deploy.

## Armadilha nº 3: UI de configuração não pode ler `config`

Se o modal lesse `config.dataLayers.layers`, leria a lista **já filtrada pelo overlay ativo**, e um Gestor jamais religaria uma camada que ele mesmo restringiu, porque o item some da tela. Por isso existem `getDeployDataLayers` / `getDeployAnalysisLayers` / `getDeployTilesets`.

**Regra geral: UI de consumo lê `config`; UI de configuração lê o baseline.** Vale para qualquer tela futura de configuração.

Corolário na direção oposta: o modal só oferece basemaps habilitados no deploy (`src/js/modals/atlas-settings.modal.js:86-93`), porque um basemap desabilitado seria marcável sem jamais aparecer no seletor. As vistas 360 vivem **fora** de `config` (cache de preflight do sv360), então a allowlist é lida à parte via `getAtlas360Allowlist()`. Ver [[streetview-360]], [[catalogo-3d]] e [[config-dinamico]].

## Campos aceitos mas não consumidos

`bounds_2d`, `min_zoom`, `max_zoom` e `default_basemap` são validados, persistidos e devolvidos no GET, mas **nenhum módulo do frontend os lê**: `grep` por esses identificadores em `src/` não retorna ocorrência alguma, o modal nem os envia e `intersectAvailability` não os considera. São contrato reservado, não comportamento. Um relato de "limite de zoom não funciona" não é bug: é feature ausente.

> **Nota histórica.** guia *02-atlas-basico* (absorvido) §6 documenta esses quatro campos como se afetassem navegação e mapa base inicial. Hoje o cliente os ignora.

## Pontos de contato

- **Clone** copia as settings para o novo atlas (`backend/src/modules/atlas/atlas.service.js:283-291`); compartilhamentos e link público não. Ver [[clone-atlas]].
- **Link público**: o visitante anônimo recebe o mesmo overlay, porque `connectPublic` também o aplica. Restrições de 3D/360/basemap valem para ele. Ver [[link-publico]].
- Settings vem embutido no snapshot do pull quando disponível, evitando um round-trip; o GET é só fallback. Ver [[snapshot-e-pull-incremental]] e [[api-rest-atlas]].
- Erros seguem [[erros-api]]: 422 `VALIDATION_ERROR`, 403 `FORBIDDEN` sem `manage`.

## Fontes
- guia *02-atlas-basico* (absorvido): forma do objeto, endpoints, matriz de permissões (três contradições registradas acima).
- `ebgeo_backend/src/modules/atlas/{atlas.routes,atlas.schemas,atlas.controller,atlas.queries,atlas.service}.js` e `src/utils/roles.js`: gates, merge raso, broadcast, cópia no clone, tradução `manage`→`manager`.
- `src/js/store/sync/{atlas-settings.service,sync-engine,ws-client}.js` e `src/js/modals/atlas-settings.modal.js`: interseção, baseline, guard de frame tardio, envio de bloco completo.
