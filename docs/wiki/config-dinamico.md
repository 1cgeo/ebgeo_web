# Config dinâmico (GET /api/config)

Endpoint público que substitui o `frontend/src/js/config.js` estático. O que ele monta se lê em `backend/src/modules/config/config.service.js`; esta página cobre só o que o código não conta: por que o boot morre sem ele, onde a precedência das camadas surpreende, e o que está congelado.

## Por que o boot é fail-fast (e por que isso não fere o offline-first)

`frontend/src/js/config.js` não é config: é um shell de shape com catálogo vazio e um piso estrutural mínimo em `map2d`/`map3d`, só as chaves que `frontend/src/js/map_sig.js`/`frontend/src/js/3d_models_viewer_tool/map_3d.js` leem sem guarda (o spread de `sourceTileLodParams` e de `viewer` lança em `undefined`). Não existe config estático de reserva, por decisão: um fallback local significaria a app subir com catálogo velho ou vazio sem ninguém perceber, e foi julgado pior que não subir.

Consequência aceita: o servidor é pré-requisito para o app *subir*, não para *operar*. Essa é a exceção única e deliberada ao offline-first (ver [[dominio-local-vs-remoto]] e [[sessao-boot-e-ciclo-de-vida]]).

**Armadilha central.** `applyRuntimeConfig` é fail-safe: devolve `{ applied: false, error }` e nunca lança (`frontend/src/js/store/sync/runtime-config.js:62-73`). Quem transforma falha em morte do boot é o laço de 3 tentativas em `frontend/src/js/index.js:73-86`. Se você chamar `applyRuntimeConfig` de qualquer outro lugar e ignorar `applied`, a app segue com o shell vazio (nenhum basemap, catálogo vazio) e sem erro visível. O código convida ao erro aqui.

**Contrato de mutação.** O merge é *in place* dentro do objeto importado: o binding `config` é importado em toda a app e nunca é substituído, só mutado. Por isso os overlays posteriores (atlas) também mutam o mesmo objeto, e por isso ler `config` antes do merge de boot devolve o shell.

## Precedência das quatro camadas

Estáticos de UI (`backend/src/modules/config/config.static.js`) < env (`backend/src/config.js:139-178`) < tabelas de catálogo < **overrides de admin** (`config_settings`, `deepMerge` final em `backend/src/modules/config/config.service.js:267`).

Duas leituras superadas que ainda circulam, vindas do guia *10-config* (absorvido): que as fontes são **três** (o guia omite os overrides de admin, que vencem todas as outras), e que o catálogo vem de uma **única tabela `resources`** editada por `/api/v1/resources`. É uma tabela e uma rota CRUD **por tipo** (`backend/src/modules/catalog/catalog.tables.js:5-11`, `backend/src/app.js:102-106`); rota `/api/v1/resources` não existe. Ver [[resources-catalogo]].

**Armadilha operacional.** O override de admin é deep-merge server-side e vence env. Uma URL errada gravada no override **não se corrige** trocando a variável de ambiente; só `DELETE /config/admin` (a válvula de reversão) ou um novo `PUT` com o valor certo. E não há rastro para reconstituir quem gravou o quê: `PUT`/`DELETE /config/admin` **não geram evento em `audit_trail`** (nunca geraram; não existe nenhuma chamada a `createAudit` em `backend/src/modules/config/`). O único rastro é a coluna `updated_by` de `config_settings` (`backend/src/modules/config/config.queries.js:8-12`), que guarda só o último autor. Mesma lacuna do catálogo, ver [[resources-catalogo]]; o que a [[auditoria]] de fato cobre está lá.

**Armadilha que junta as duas seções desta página: o override entra por ÚLTIMO, depois das derivações.** O `deepMerge` final (`backend/src/modules/config/config.service.js:267`) recebe o payload já montado, então sobrescrever uma fonte **não recomputa nada que dela derive**. Dois casos alcançáveis pela UI, e o editor "Avançado (JSON)" nomeia justamente essas seções:

- `map3d.providers.terrain.enabled` é `Boolean(C.map3dTerrainUrl)`, calculado em `:239`. Sobrescrever `map3d.providers.terrain.url` deixa `enabled: false` e o terreno 3D simplesmente não liga.
- os templates MVT de `streetView360` são montados de `C.sv360ServiceUrl` em `:258` e `:260`. Sobrescrever `streetView360.serviceUrl` deixa os tiles apontando para a base **antiga**.

Ao sobrescrever uma fonte pelo override, escreva **também** o campo derivado. Nada prende isso: `backend/tests/integration/config-admin.test.js` faz exatamente esse override de `serviceUrl` e afirma só o próprio `serviceUrl`, nunca os tiles.

Também por isso `PUT /config/admin` mescla um parcial no documento armazenado: salvar uma seção nunca pode apagar as outras, porque o editor "Avançado (JSON)" envia recortes. O schema rejeita **chaves de topo desconhecidas** de propósito (`backend/src/modules/config/config.admin.schemas.js`) — e só passou a rejeitar de fato em 2026-07-25: o `validate` roda todo schema com `stripUnknown: true`, então até então a seção com nome errado era **descartada em silêncio** e o admin recebia 200 com metade do que digitou jogada fora. O comentário do schema já afirmava a rejeição, e essa frase aqui a repetia; o que faltava era o `.prefs({ stripUnknown: false })` que a torna verdadeira. (As seções conhecidas seguem `.unknown(true)`, que vence o `stripUnknown`, então as chaves avançadas dentro delas continuam passando intactas.) Ainda assim o que ele bloqueia é menos do que o comentário do próprio schema sugere: só `basemaps` e `tilesets` ficam de fora. **`analysisLayers` e `dataLayers` são chaves de topo aceitas e abertas** (`:45-46`), e como o `deepMerge` **substitui arrays inteiros** (`config.service.js:22-31`), um `PUT /config/admin {"analysisLayers":{"layers":[…]}}` troca o array vindo do catálogo por completo. Ele contorna o CRUD que a frase original dizia proteger e também o filtro de `bounds` descrito abaixo, o que faz do override o **único caminho pelo qual `/api/config` volta a emitir camada sem `bounds`**.

**Mesclar um parcial é um read-modify-write, e desde 2026-07-25 ele é atômico.** Até então eram três `await` soltos (ler o documento, mesclar, gravar), o que é a forma canônica de perda de atualização: dois admins salvando **seções diferentes** na mesma janela liam a mesma base, cada um mesclava a sua seção nela, e a segunda gravação substituía o documento inteiro da primeira. Nada lançava e nada logava: os dois viam `200` com o eco do próprio merge, e uma seção revertia sozinha algum tempo depois. Hoje os três passos vivem numa transação que abre travando a linha única `key = 'app_config'`, e a invalidação do memo de `/api/config` roda **depois do commit**: invalidá-lo dentro da transação reabriria a mesma janela na forma de cache, porque um `GET` concorrente reconstruiria a partir da linha antiga e a memoizaria. Regressão em `backend/tests/integration/config-admin-lost-update.repro.test.js`, que afirma a exclusão mútua no SQL e no serviço, nunca por duas requisições HTTP, que o supertest serializa.

## O contrato congelado

Ver [[sintese-contratos-congelados]]. O que quebra o frontend se mudar:

- **`basemaps` é OBJETO chaveado por id**, porque o cliente faz `config.basemaps[id]`. Virar array quebra tudo silenciosamente.
- **`tilesets`, `analysisLayers.layers`, `dataLayers.layers` são ARRAYS.**
- **`search` permanece como chave, vazia.** O `apiUrl` foi removido: o gazetteer **é este backend** e o cliente deriva a rota da própria base da API. O antigo `SEARCH_API_URL` tinha default apontando para um `:3001` inexistente, o fetch dava connection-refused e a busca falhava em silêncio. Liga/desliga continua em `features.apisearch`. Ver [[gazetteer-nomes-geograficos]].
- **`postos` e `organizacoesMilitares` são públicos de propósito**, apesar de serem dados de pessoal: o formulário anônimo de cadastro precisa popular os selects **antes** do login. Ver [[gestao-usuarios]] e [[organizacoes-om]].

**Vazio é sinal, não ausência de configuração.** `tileServerUrl` default `''` significa "não configurado" e o guarda do contrato afirma só `typeof === 'string'` (`frontend/tests/e2e/config-contract.e2e.test.js`). Exigir comprimento maior que zero ali transformaria o teste de contrato em teste de deployment: passaria só onde houvesse servidor de tiles, que é o oposto do que ele guarda.

## Regras de montagem que causam bug se ignoradas

**Camada de análise sem `bounds` de 4 posições é descartada em silêncio** (`backend/src/modules/config/config.service.js:120-126`). O motivo está no código: uma camada semeada com `config: {}` quebrava o boot no zoom-to-layer, e a defesa ficou no servidor para que `/api/config` não consiga emitir payload fora do contrato. Se uma camada "sumiu" do catálogo, o suspeito número um é `bounds` incompleto, não `active = false`.

**`terrainSource`/`hillshadeSource` têm duas formas incompatíveis.** A presença de `{z}` na URL decide entre TileJSON (`{ url }`) e template (`{ tiles: [...] }`); o frontend repassa o objeto **verbatim** para `map.addSource()` e o MapLibre não intercambia as duas. `TERRAIN_MINZOOM`/`MAXZOOM` e `HILLSHADE_*` só têm efeito na forma template (numa TileJSON o manifesto declara os zooms). Sem URL a fonte sai `undefined`.

**Terreno 3D só liga se houver URL** (`backend/src/modules/config/config.service.js:239`), e `MAP3D_TERRAIN_URL` tem default **vazio**. Sem terreno o Cesium usa o elipsoide plano, em vez de tentar e falhar contra um provider inexistente.

> **Nota histórica.** O antigo docs/deploy.md (removido) (absorvido em [[deploy-backend]]) documentava defaults `http://localhost/terrain/tilesets/terrain` para `MAP3D_TERRAIN_URL` e `http://localhost:3000/api/v1/sv360` para `SV360_SERVICE_URL`; `backend/src/config.js:157` usa default **vazio** (e publica `enabled: false`) e `backend/src/config.js:171` usa o relativo `/api/v1/sv360`.

O default absoluto do sv360 só funcionava por acidente: `:3000` é o Vite, que faz proxy de `/api` para o backend. Num deploy real ou era configurado à mão ou o browser chamava o próprio host. Ver [[config-runtime-urls-relativas]].

**Um `config.style` salvo no catálogo congela aquele basemap contra a env.** `listBasemapStyles` parte dos 5 styles injetados por ambiente e só substitui um id quando o recurso tem style próprio. Trocar `OSM_TILE_URL` deixa de afetar quem tem style editado no admin. Somado ao override de admin, são duas maneiras distintas de uma variável de ambiente parecer ignorada.

**`SV360_SERVICE_URL` alimenta duas coisas ao mesmo tempo:** a base do serviço e o template `${serviceUrl}/tiles/{z}/{x}/{y}.pbf`. Não existe env separada para os tiles, e `{z}/{x}/{y}` são literais do MapLibre, não interpolação. GeoJSON-como-fonte e PMTiles foram descontinuados. Ver [[streetview-360]].

**Defaults de env são DEV-only** (OSM, Google Satellite, demotiles, BDGEx público) e o boot **não avisa**. Em rede militar isolada nada disso resolve, e a app sobe parecendo saudável. Ver [[deploy-backend]].

Contexto que explica por que os styles moram no backend: no `frontend/src/js/config.js` antigo as URLs reais de tiles não estavam no config, moravam em módulos separados de `baselayers/*.js`. O endpoint as absorveu em `basemapStyles` para servir 100% da config num lugar só.

## Overlay por atlas: restringe, nunca habilita

`applyAtlasSettings` (`frontend/src/js/store/sync/atlas-settings.service.js:100-125`) sobrepõe `atlas.settings` no mesmo objeto `config`. A regra é **interseção**: capacidade do deploy ∩ permissão do atlas. Nenhuma configuração de atlas consegue ligar o que o deploy desligou (3D removido do build não volta por setting). Detalhe do modelo em [[atlas-settings]]; quem configura, em [[permissoes-atlas]].

Armadilhas:

- **O modal de configuração do atlas não pode ler `config.dataLayers.layers`** (já filtrado pelo overlay). Tem que usar `getDeployDataLayers()`/`getDeployAnalysisLayers()`/`getDeployTilesets()`, senão o Gestor não consegue reabilitar uma camada que ele mesmo restringiu.
- **Allowlist vazia ou ausente significa "sem restrição"**, não "nada permitido" (`filterLayers`, linha 57). Inverter essa leitura zera o catálogo do atlas.
- Arrays são substituídos **in place** (`replaceArrayInPlace`, linha 134) para preservar a referência que o catálogo já capturou. Reatribuir o array em vez de mutá-lo desconecta o catálogo do overlay.
- O 360 vive **fora** do `config` (cache de preflight do sv360), então a allowlist é lida direto por `getAtlas360Allowlist()`.
- Nome que não bate entre as pontas: backend `features.panoramic_images` → frontend `config.features.imagens_panoramicas` (linha 83).
- O baseline do nível-deploy é capturado no primeiro apply e restaurado por `revertAtlasSettings()` ao desconectar; o apply recomputa do baseline, então é idempotente e nunca acumula restrição.

## Checklist

- Mudou o *shape* do payload? Alinhe frontend e teste de contrato **antes**. O teste é `frontend/tests/e2e/config-contract.e2e.test.js`, e este item dizia até 2026-07-25 que ele estava desatualizado em `search`/`services`: não está. Ele afirma hoje exatamente o contrato vigente, `services.tileServerUrl` como string possivelmente VAZIA (`:61`, vazio é o sinal de "não configurado") e `search` no shape sem `apiUrl` (`:70`, prendendo a remoção do campo, cujo default apontava para um `:3001` que nunca existiu).
- Dado novo editável em runtime vai para a tabela de catálogo do tipo, não para `backend/src/modules/config/config.static.js` (que exige redeploy do backend).
- URL de deploy muda por env, não por código nem por override de admin (o override mascara a env).
- Camada de análise nova precisa de `bounds` de 4 posições ou é descartada sem aviso.
- Nunca leia `config` antes do merge de boot.

Config não tem push por WebSocket: é pull sob demanda, com `Cache-Control: no-cache`, para que edições de catálogo propaguem na requisição seguinte (contraste com [[canal-collab-websocket]]). Erros seguem [[erros-api]]; na prática falha aqui é banco fora, e derruba o boot do frontend inteiro. Ver também [[catalogo-3d]], [[assets3d-distribuicao]], [[autenticacao-jwt]].

## Memoização no servidor (desde 2026-07-25): invalidada na escrita, não por tempo

Até 2026-07-25 esta página descrevia um endpoint sem cache **nenhum**, e era verdade: montar o payload custava **oito** consultas ao banco, em toda requisição, numa rota anônima e sem teto. Isso fazia do único endpoint que impede o boot também o mais caro do conjunto anônimo (`bugs-backend.md` #64). Hoje o payload é memoizado em processo (`backend/src/modules/config/config.cache.js`) e o custo medido caiu de 8 consultas por requisição para 8 por *mudança*: requisição em cache quente custa **zero**.

O que **não** mudou é o que o `Cache-Control: no-cache` promete. A invalidação é feita **no ponto da escrita**, não por TTL, exatamente para preservar a propagação imediata: as três operações de CRUD do catálogo (nas cinco tabelas), as três de `ranks`, as três de `organizations` e os dois escritores de override (`PUT`/`DELETE /config/admin`) chamam `invalidateAppConfigCache()` depois de gravar. A requisição seguinte a qualquer uma delas reconstrói. Um TTL sozinho teria trocado essa propriedade por um atraso que ninguém sabe dimensionar.

Três coisas que decidem se isso ajuda ou atrapalha:

- **A memoização é cega a escrita que não passa pelo serviço.** `UPDATE basemaps SET active = false` direto no banco (script de manutenção, psql) **não** invalida nada. O `CONFIG_CACHE_TTL_MS` (default 30 s) existe só como rede de segurança para esse caso; se você editou o catálogo por SQL e a mudança "não apareceu", espere a janela ou reinicie o processo. Editar pela API é o caminho que tem garantia.
- **A entrada guarda a promessa em voo, não o valor resolvido.** N requisições simultâneas com o cache frio custam **uma** montagem. Sem isso a rajada — que é justamente o cenário de ataque — pagaria 8×N contra um pool de 10 conexões.
- **O cache é por processo e sem backplane**, como o rate limit e as salas de colaboração (ver [[deploy-backend]]): com réplicas, cada uma tem a sua cópia e a invalidação de uma **não** alcança as outras. Com uma réplica só, que é o deploy documentado, isso não aparece.

Em teste a memoização fica **desligada** por padrão (`CONFIG_CACHE_FORCE=1` liga), porque a suíte do backend escreve nas tabelas de catálogo por SQL cru e depois lê `/api/config` de volta — o caso do primeiro item acima. Os dois arranques de E2E (`frontend/tests/e2e/global-setup.js` e `frontend/tests/e2e-ui/backend.js`) ligam a flag: é lá que o cache roda como num deploy, com a app bootando de verdade. Cobertura em `backend/tests/integration/config-cache.test.js`.

A rota anônima ganhou também um teto por endereço (`configLimiter`, 600/min por default). O dimensionamento e a razão de ser tão folgado estão em [[hardening-borda-api]].

## Fontes

- Guias absorvidos: *10-config* (contrato congelado, mapa env → chave, semântica MVT), *visao-e-principios* (config como exceção ao offline-first), *ui-ux-ebgeo* (backend como fonte única; cadeia atlas-settings → config → catálogo). Divergências marcadas acima.
- `backend/src/config.js`: a tabela de env do `appConfig` é o próprio arquivo.
- Código (autoridade sobre a prosa): `backend/src/modules/config/`, `backend/src/modules/catalog/`, `backend/src/app.js`, `backend/src/config.js`, `frontend/src/js/index.js`, `frontend/src/js/config.js`, `frontend/src/js/store/sync/runtime-config.js`, `frontend/tests/e2e/config-contract.e2e.test.js`.

## Histórico

- 2026-07-25: a seção do contrato congelado carregava uma `[!CONTRADICAO 2026-07-18]` dizendo que o `config-contract.e2e.test.js` exigia `search.apiUrl` não-vazio e `tileServerUrl` com comprimento maior que zero. O teste já havia sido corrigido em `14f703f`; o marcador sobreviveu ao próprio conserto e ficou pendente. Supersessão temporal: marcador apagado, o invariante que sobrou virou prosa afirmativa.
