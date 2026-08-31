# Configurações do Atlas (settings)

Overlay **apenas restritivo** por atlas sobre a config de deploy, trafegado por REST + frame WebSocket dedicado, fora do log de operações.

O objeto e seus campos estão declarados em `backend/src/modules/atlas/atlas.schemas.js`; a semântica de interseção está no JSDoc de `frontend/src/js/store/sync/atlas-settings.service.js`. Esta página cobre só o que esses arquivos não contam.

## Duas chaves de `settings` NÃO passam por aqui

`terrainExaggeration` e `globeProjection` moram no mesmo `atlas.settings`, e chegam lá por outra porta: **operação de sync**, pela whitelist de `backend/src/modules/sync/sync.service.js`. Quem lê o schema Joi do PATCH e conclui que a lista dele é o conteúdo do objeto se engana, e o engano é caro, porque um cliente que mandasse as duas pelo PATCH receberia 422 sem entender por quê.

O motivo é o que elas são: as duas dizem como o mapa 2D deste projeto se PARECE, não o que ele oferece. Daí decorrem as três diferenças que importam:

- **Gate `write`, não `manage`.** Quem pode desenhar pode escolher o exagero; escolher exagero não redistribui recurso nenhum.
- **Funcionam em atlas LOCAL**, que não tem rota REST alguma. Era o motivo estrutural: a mesma tela precisa salvar nos dois casos, e só o caminho de sync existe nos dois.
- **Só `false` tira o globo.** `globeProjection` tem dois estados e o padrão é globo: ausência, `null` ou lixo de um `settings` antigo resolvem para globo (`frontend/src/js/store/atlas-appearance.service.js`). Houve um terceiro estado, "padrão do sistema", herdando `config.map2d.globe_projection` do painel do administrador; foi cortado em 2026-08-16 por decisão do dono, e a config de deploy deixou de decidir a projeção.

Uma armadilha de fila herdada: as duas dividem a chave de compactação `<escopo>:setting:<atlas>` com `customIcons`, `mapOrder`, `colorUsage` e `mapBadgeColors`, e a compactação **substitui** o payload em vez de fundir. Por isso o modal grava as duas num patch só. Ver [[tipos-entidade-sync]].

## Por que settings fica fora do sync

É metadado do [[atlas-modelo-de-dados]], não entidade sincronizada ([[tipos-entidade-sync]]). Consequência que morde: não há resolução LWW aqui (comparar com [[modelo-conflito-lww]]), o último PATCH simplesmente vence e a `version` do atlas é incrementada. Dois Gestores editando settings ao mesmo tempo perdem trabalho sem qualquer sinal. Ver [[sintese-rest-vs-sync]] e [[sintese-modulos-fora-do-sync]].

## Armadilha nº 1: o merge é raso, e o PATCH parece parcial

`SET settings = settings || $2::jsonb` (`backend/src/modules/atlas/atlas.queries.js`). O `||` em `jsonb` faz merge de **primeiro nível apenas**.

Enviar `{"features": {"map_3d": false}}` **substitui o objeto `features` inteiro** e apaga `panoramic_images`, `terrain_3d`, `data_layers`, `analysis_layers`. O sintoma é traiçoeiro: como o cliente trata flag ausente como ligada (`x !== false`), nada some da tela; o que estava desligado volta a ligado, em silêncio.

**Não mande deltas.** GET, mute o objeto local, mande o bloco inteiro, que é o que o modal faz (`frontend/src/js/modals/atlas-settings.modal.js`). Uma correção "óbvia" no backend (trocar `||` por merge profundo) muda o contrato de quem já manda bloco completo apenas na aparência, mas passa a impedir a remoção de chave: avalie antes de mexer.

## Armadilha nº 2: `manage` no backend é `manager` no cliente

O gate REST é `requireAtlasPermission('manage')` (`backend/src/modules/atlas/atlas.routes.js`), mas o papel que chega ao cliente é `'manager'`, traduzido em `backend/src/utils/roles.js`. São dois vocabulários para o mesmo nível. Um gate de UI escrito com o termo do outro lado passa no lint e falha silenciosamente; e um gate escrito como `permission === 'write' || 'owner'` exclui o co-Gestor, que legitimamente configura. O código atual acerta (`frontend/src/js/account/account.control.js`). Ver [[permissoes-atlas]] e [[sintese-eixos-de-permissao]].

## Contratos congelados do overlay

Três invariantes que não estão em nenhum arquivo isolado e quebram de formas difíceis de diagnosticar:

- **Lista vazia significa "sem restrição"**, nunca "nada permitido". Inverter isso trancaria todo atlas existente, cujo default é `[]`. Por isso o modal colapsa "seleção total" de volta para `[]` antes de salvar (`frontend/src/js/modals/atlas-settings.modal.js`): gravar a lista cheia congelaria um snapshot do catálogo daquele dia, e itens novos do deploy nunca apareceriam.
- **Os arrays são substituídos in place** (`replaceArrayInPlace`). Módulos como o catálogo capturam a referência no boot; trocar por reatribuição os deixa apontando para a lista pré-overlay, sem erro algum.
- **Reaplicar exige estar conectado.** Um frame `atlas_settings_updated` chegando na janela entre `disconnect` e o revert re-capturaria a config **já restaurada** como novo baseline, restringindo o app local até um F5. Daí o guard `if (!connectionState.isOnline()) return;` (`frontend/src/js/store/sync/sync-engine.js`). Qualquer novo consumidor de settings precisa do mesmo guard. Ver [[canal-collab-websocket]].

O overlay nunca existe no store local ([[dominio-local-vs-remoto]]): `disconnect()` reverte ao baseline de deploy.

## Armadilha nº 3: UI de configuração não pode ler `config`

Se o modal lesse `config.dataLayers.layers`, leria a lista **já filtrada pelo overlay ativo**, e um Gestor jamais religaria uma camada que ele mesmo restringiu, porque o item some da tela. Por isso existem `getDeployDataLayers` / `getDeployAnalysisLayers` / `getDeployTilesets`.

**Regra geral: UI de consumo lê `config`; UI de configuração lê o baseline.** Vale para qualquer tela futura de configuração.

Corolário na direção oposta: o modal só oferece basemaps habilitados no deploy (`frontend/src/js/modals/atlas-settings.modal.js`), porque um basemap desabilitado seria marcável sem jamais aparecer no seletor. As vistas 360 vivem **fora** de `config` (cache de preflight do sv360), então a allowlist é lida à parte via `getAtlas360Allowlist()`. Ver [[streetview-360]], [[resources-catalogo]] e [[config-dinamico]].

## O zoom saiu daqui em 2026-08-31

`min_zoom` e `max_zoom` **não existem mais** em `settings`, por decisão do dono. Eram o caso mais puro de contrato reservado: validados, persistidos, clonados, cobertos por teste, e lidos por nenhum consumidor de comportamento. O que se ganhava mantendo-os era um relato futuro de "o limite de zoom do atlas não funciona" que não seria bug.

A faixa de zoom passou a ter dois níveis, e só um é configurável. A **aplicação** é fixa em `[2, 21]` (`MAP2D_BASE`, em `backend/src/modules/config/config.static.js`), e o override do administrador recusa as duas chaves com 422 nomeado. O **mapa base** aperta dentro dela por `config.minzoom`/`config.maxzoom` da linha de catálogo, editável por administrador ou pelo produtor da OM dona. Ver [[resources-catalogo]] e [[config-dinamico]].

A remoção foi feita reescrevendo a baseline (`003_atlas.sql`), o que é honesto enquanto nenhum banco fora do branch a aplicou. Banco de desenvolvimento migrado antes disso não é alcançável por upgrade: recrie com `node scripts/dev-db.js recreate`.

## Campos aceitos mas não consumidos

`bounds_2d` e `default_basemap` são validados, persistidos e devolvidos no GET, mas **nenhum consumidor de comportamento do frontend os lê**: o modal nem os envia e `intersectAvailability` não os considera. São contrato reservado, não comportamento.

A conferência disso **não** é um `grep` pelos identificadores, e a diferença já enganou esta página duas vezes. A primeira foi o zoom, que ficou aqui listado como reservado por meses até virar remoção. A segunda: `default_basemap` tem ocorrência viva em `frontend/src/js/catalog/resource-reference.registry.js`, na entrada `settings.default_basemap`, que é o inventário de onde um id de catálogo mora dentro de um atlas ([[sair-do-servidor]]). Aparecer num inventário de referência não é ter leitor de comportamento, e é exatamente por isso que a receita por ausência de ocorrência falha: o que se procura é quem MUDA a tela a partir do valor, não quem cita o nome.

## Pontos de contato

- **Clone** copia as settings para o novo atlas (`backend/src/modules/atlas/atlas.service.js`); compartilhamentos e link público não. Ver [[clone-atlas]].
- **Seis chaves daqui são referência de recurso de catálogo** (`basemaps`, `default_basemap` e os quatro `available_*`), e por isso o clone e o import as PODAM por destinatário: o que o novo dono não enxerga sai da lista. A armadilha é o sentido da poda, e ela é específica desta página: lista vazia significa **sem restrição**, então podar uma allowlist até zero e escrever a lista vazia ALARGA a cópia. Quando ela esvazia, o que se desliga é a categoria correspondente em `features`. `basemaps` é a exceção declarada, porque não tem categoria e um mapa sem camada de base não desenha. Ver [[sair-do-servidor]].
- **Link público**: o visitante anônimo recebe o mesmo overlay, porque `connectPublic` também o aplica. Restrições de 3D/360/basemap valem para ele. Ver [[link-publico]].
- Settings vem embutido no snapshot do pull quando disponível, evitando um round-trip; o GET é só fallback. Ver [[snapshot-e-pull-incremental]] e [[api-rest-atlas]].
- Erros seguem [[erros-api]]: 422 `VALIDATION_ERROR`, 403 `FORBIDDEN` sem `manage`.
