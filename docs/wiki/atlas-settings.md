# Configurações do Atlas (settings)

Bloco de configuração por atlas que habilita features (3D, 360, terreno) e restringe basemaps, limites de navegação/zoom e as listas de camadas de análise/dados, modelos 3D e vistas 360 disponíveis, lido com `read` e alterado com `manage` via PATCH parcial.

## O que é

`atlas.settings` é uma coluna `jsonb` da tabela `atlas`, criada com um objeto default no `POST /api/v1/atlas`. Ela não viaja pelo log de operações do sync: é lida e escrita por REST (ver [[api-rest-atlas]]) e propagada aos pares conectados por um frame WebSocket dedicado. Ou seja, settings é metadado do [[atlas-modelo-de-dados]], não entidade sincronizada como feature/map/layer (ver [[tipos-entidade-sync]]).

Forma completa (do default de criação, guia *02-atlas-basico* (absorvido) §2):

```json
{
  "features": { "map_3d": true, "panoramic_images": true, "terrain_3d": true },
  "basemaps": [],
  "default_basemap": null,
  "bounds_2d": null,
  "min_zoom": null,
  "max_zoom": null,
  "available_analysis_layers": [],
  "available_data_layers": [],
  "available_3d_models": [],
  "available_360_views": []
}
```

O schema Joi aceita ainda `features.data_layers` e `features.analysis_layers` (liga/desliga a categoria inteira), que não aparecem no default nem no guia (`ebgeo_backend/src/modules/atlas/atlas.schemas.js:19-34`).

## Endpoints e permissão

- `GET /api/v1/atlas/:atlasId/settings` exige `read` (`ebgeo_backend/src/modules/atlas/atlas.routes.js:34`). Devolve o objeto `settings` cru em `{ data: ... }`.
- `PATCH /api/v1/atlas/:atlasId/settings` exige `manage` (`ebgeo_backend/src/modules/atlas/atlas.routes.js:35`), valida contra `atlasSettingsSchema` e, ao gravar, faz `broadcastToRoom(atlasId, { type: 'atlas_settings_updated', settings })` (`ebgeo_backend/src/modules/atlas/atlas.controller.js:48-51`).

`manage` está acima de `write` na hierarquia; um gate escrito como `permission === 'write' || 'owner'` exclui o co-Gestor. Detalhes em [[permissoes-atlas]] e [[sintese-eixos-de-permissao]].

No cliente, os dois verbos são `apiClient.getAtlasSettings` / `apiClient.updateAtlasSettings` (`src/js/store/sync/api-client.js:639,648`). O gate de UI está em `src/js/account/account.control.js:480-493`, mas quem realmente decide é o backend no PATCH.

> **Nota histórica.** guia *02-atlas-basico* (absorvido) §8 mostra `setSettingsVisible(isOwner)` no exemplo de frontend, sugerindo que configurar é exclusivo do owner. A rota real exige apenas `manage` (`ebgeo_backend/src/modules/atlas/atlas.routes.js:35`), e a própria matriz do mesmo documento lista "Alterar configurações do atlas" como ✅ para `manage`. Trate como `manage`.

## Armadilha nº 1: o merge é raso

O guia diz "PATCH permite atualização parcial, apenas os campos enviados serão alterados". Isso é verdade no primeiro nível apenas. O SQL é `SET settings = settings || $2::jsonb` (`ebgeo_backend/src/modules/atlas/atlas.queries.js:69-76`), e `||` em `jsonb` faz merge **raso**.

Consequência prática: enviar `{"features": {"map_3d": false}}` **substitui o objeto `features` inteiro**, apagando `panoramic_images`, `terrain_3d`, etc. Como o overlay do cliente trata ausente como "ligado" (`!== false`), o efeito não é perda visível imediata, mas qualquer flag previamente desligada volta silenciosamente a ligada.

> **Nota histórica.** guia *02-atlas-basico* (absorvido) §6 apresenta `{"features": {"map_3d": false}, "max_zoom": 15}` como patch parcial seguro; o `||` em `ebgeo_backend/src/modules/atlas/atlas.queries.js:71` é merge raso e descarta as demais chaves de `features`.

Por isso o modal do cliente sempre monta e envia o objeto `features` completo, junto com todas as listas de allowlist, em vez de mandar deltas (`src/js/modals/atlas-settings.modal.js:348-350`). Siga o mesmo padrão: leia com GET, mute o objeto local, mande o bloco inteiro.

Cada PATCH também incrementa `version` do atlas e atualiza `updated_at`.

## Semântica: settings só RESTRINGE

O ponto mais importante do modelo. O cliente aplica settings como um **overlay restritivo** sobre a config de deploy (ver [[config-dinamico]]), nunca como fonte de habilitação:

```
disponivel = capacidade_do_deploy ∩ permissao_do_atlas
```

Implementado em `intersectAvailability` (`src/js/store/sync/atlas-settings.service.js:73-93`). Cada flag é `baseline.x !== false && settings.features.x !== false`. Nenhum setting de atlas religa o que o deploy desligou (no build do GitHub Pages, por exemplo, 3D está removido e nenhum atlas o traz de volta).

Convenções que quebram a intuição:

- **Lista vazia significa "sem restrição"**, não "nada permitido". `basemaps: []`, `available_data_layers: []`, etc., mantêm o conjunto completo do deploy (`atlas-settings.service.js:57-62,79`).
- O modal colapsa "seleção total" de volta para `[]` antes de salvar, para que a lista não congele um snapshot do catálogo daquele dia (`src/js/modals/atlas-settings.modal.js:333-345`).
- Basemaps são um mapa `{id: {enabled}}`; camadas de dados/análise e tilesets são **arrays planos**, filtrados por id. O baseline guarda os arrays completos e a interseção filtra (`atlas-settings.service.js:44-52`).
- A substituição dos arrays é feita **in place** (`replaceArrayInPlace`, `atlas-settings.service.js:134-138`) para preservar a referência capturada por módulos como o catálogo. Nunca troque por reatribuição.

Mapeamento de nomes entre backend e frontend: `features.panoramic_images` vira `config.features.imagens_panoramicas` (`atlas-settings.service.js:83`). Não é o mesmo identificador dos dois lados.

## Ciclo de vida do overlay

1. **Conectar.** `syncEngine.connect` e `connectPublic` chamam `_applyAtlasSettingsOverlay` (`src/js/store/sync/sync-engine.js:201,235,247-255`). Ele prefere `snapshot.atlas.settings` já vindo do pull (ver [[snapshot-e-pull-incremental]]) e só cai para `GET .../settings` se o snapshot não trouxer. Falha é best-effort: mantém a config de deploy intacta.
2. **Primeira aplicação captura o baseline** de deploy (`captureBaseline`, `atlas-settings.service.js:32-54`). `applyAtlasSettings` é idempotente: recalcula sempre a partir do baseline, nunca compõe restrição sobre restrição.
3. **Atualização em tempo real.** O frame `atlas_settings_updated` chega pelo canal collab (ver [[canal-collab-websocket]]), é despachado em `src/js/store/sync/ws-client.js:349-351` e reaplicado em `sync-engine.js:474-487`.
4. **Desconectar.** `disconnect()` chama `revertAtlasSettings()`, restaurando o baseline e limpando `_baseline` (`sync-engine.js:353-362`, `atlas-settings.service.js:144-167`). Coerente com a separação de [[dominio-local-vs-remoto]] e [[dominio-local-vs-remoto]]: no store local não existe overlay.

### Armadilha nº 2: frame tardio após desconexão

Um `atlas_settings_updated` que chega na janela entre `disconnect` e o revert re-capturaria a config **já restaurada** como novo baseline, restringindo o app local permanentemente até um F5. Por isso há o guard `if (!connectionState.isOnline()) return;` antes de reaplicar (`sync-engine.js:477-481`). Qualquer novo consumidor de settings precisa do mesmo guard.

## Quem consome o overlay

Após aplicar (ou reverter), o cliente emite `EventTypes.ATLAS_SETTINGS_CHANGED` (`sync:atlasSettingsChanged`, `src/js/events/event_types.js:216`), com `{ settings: null }` no revert. Assinantes que re-gateiam a UI:

- `src/js/bottom-controls/bottom-controls.control.js:226` (botões 3D/360/terreno).
- `src/js/base-layer-selector/base-layer-selector.control.js:271` (seletor de mapa base).
- `src/js/catalog/catalog.modal.js:62` (catálogo de camadas).

As vistas 360 vivem **fora** de `config` (cache de preflight do sv360), então a allowlist `available_360_views` é guardada à parte e lida diretamente pelo catálogo via `getAtlas360Allowlist()` (`atlas-settings.service.js:103-105,194-196`; consumo em `src/js/catalog/catalog.service.js:206-207`). Ver [[streetview-360]] e [[catalogo-3d]].

## Armadilha nº 3: o modal precisa da lista NÃO filtrada

Se o modal de configuração lesse `config.dataLayers.layers`, leria a lista **já filtrada pelo overlay ativo**, e um Gestor jamais conseguiria religar uma camada que ele mesmo restringiu (o item some da tela). Por isso existem `getDeployDataLayers` / `getDeployAnalysisLayers` / `getDeployTilesets` (`atlas-settings.service.js:176-191`), que devolvem o baseline de deploy, usados em `src/js/modals/atlas-settings.modal.js:18`. Regra geral: **UI de consumo lê `config`; UI de configuração lê o baseline.**

O modal também só oferece basemaps habilitados no deploy (`_allBasemapIds`, `src/js/modals/atlas-settings.modal.js:86-93`), porque listar um basemap desabilitado permitiria marcá-lo sem que ele jamais apareça no seletor.

## Campos aceitos mas não consumidos

`bounds_2d`, `min_zoom`, `max_zoom` e `default_basemap` são validados pelo backend (`ebgeo_backend/src/modules/atlas/atlas.schemas.js:26-30`, com as regras `min_zoom <= max_zoom` e `default_basemap ∈ basemaps`), persistidos e devolvidos no GET, mas **nenhum módulo do frontend os lê**: uma busca por esses identificadores em `src/js` não retorna ocorrência alguma, e nem `intersectAvailability` nem o modal os tocam. São contrato reservado, não comportamento.

> **Nota histórica.** guia *02-atlas-basico* (absorvido) §6 documenta `bounds_2d`, `min_zoom`, `max_zoom` e `default_basemap` como se afetassem a navegação e o mapa base inicial; hoje o cliente apenas os ignora (`src/js/store/sync/atlas-settings.service.js:73-93` não os considera, e o modal em `src/js/modals/atlas-settings.modal.js:348-350` nem os envia).

## Outros pontos de contato

- **Clone**: as configurações do atlas são copiadas para o novo atlas (`ebgeo_backend/src/modules/atlas/atlas.service.js:283-291`); compartilhamentos e link público não. Ver [[clone-atlas]].
- **Link público**: o visitante anônimo recebe o mesmo overlay, pois `connectPublic` também o aplica (`sync-engine.js:235`). Um visitante respeita as mesmas restrições de 3D/360/basemap. Ver [[link-publico]].
- **Erros**: PATCH inválido retorna `VALIDATION_ERROR` 422; sem `manage`, 403 `FORBIDDEN`. Formato em [[erros-api]].
- Alterar settings não gera operação no log; não há resolução LWW aqui (comparar com [[modelo-conflito-lww]]). O último PATCH vence, e `version` do atlas só é incrementada.

## Fontes
- guia *02-atlas-basico* (absorvido): forma completa do objeto `settings`, tabela de campos, endpoints GET/PATCH e permissões mínimas, matriz de permissões e formato de erro.
- `ebgeo_backend/src/modules/atlas/{atlas.routes,atlas.schemas,atlas.controller,atlas.queries,atlas.service}.js`: gates `read`/`manage`, schema Joi real (inclui `data_layers`/`analysis_layers`), merge raso `settings || $2::jsonb`, broadcast `atlas_settings_updated`, cópia no clone.
- `src/js/store/sync/atlas-settings.service.js`: semântica de interseção, baseline, listas vazias como "sem restrição", substituição in place, allowlist 360 fora de `config`, getters de deploy.
- `src/js/store/sync/sync-engine.js` e `ws-client.js`: aplicação no connect/connectPublic, reaplicação no frame WS, guard de frame tardio, revert no disconnect.
- `src/js/modals/atlas-settings.modal.js`, `src/js/account/account.control.js`, `src/js/catalog/catalog.service.js`, `src/js/events/event_types.js`: UI de configuração, envio do bloco completo, colapso de seleção total, consumidores de `ATLAS_SETTINGS_CHANGED`.
