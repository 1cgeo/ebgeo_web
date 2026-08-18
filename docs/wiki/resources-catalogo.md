# Resources (catálogo global de camadas e assets)

Registro global versionado por categoria, legível por qualquer autenticado e escrito só por admin, que alimenta o `GET /api/v1/config` de todo cliente.

## A distinção que mais confunde

O catálogo diz **o que existe no servidor**; o [[atlas-settings]] diz **o que aquele atlas pode usar** (subconjunto). Remover do catálogo some para todos; tirar de `available_data_layers` some só naquele atlas. São eixos independentes: nunca "conserte" visibilidade de um mexendo no outro.

O papel que destrava a escrita é `role = admin` **global de usuário**, não permissão de atlas: um `owner` de atlas não edita catálogo ([[permissoes-atlas]], [[gestao-usuarios]]).

## Quatro tabelas dedicadas, não uma `resources` genérica

O DDL (`backend/src/database/migrations/003_sync.sql`) rejeita explicitamente a tabela única com coluna `category`, em favor de tabelas de forma idêntica (`LIKE basemaps INCLUDING ALL`) para permitir evolução independente por tipo. O router é fábrica por tabela (`makeCatalogRouter`).

Nasceram CINCO e são QUATRO desde a migração 021: `streetview_markers` foi apagada por nunca ter tido consumidor nenhum (ver a seção seguinte). O nome dela colidia com o de um arquivo VIVO do frontend, `frontend/src/js/street_view_tool/streetview_markers.js`, que é a camada de marcadores do 360 no mapa 2D e lê de `sv360.projects`: uma busca por nome atinge os dois, e eles eram opostos.

**Armadilha de segurança:** o nome da tabela é **interpolado em SQL** (o driver `pg` não faz bind de identificador), e `assertTable()` (`backend/src/modules/catalog/catalog.tables.js`) é a única barreira. Hoje o `table` vem fixo dos quatro mounts em `backend/src/app.js`. Passar um `table` derivado de request é injeção direta. Ver [[hardening-borda-api]].

## Contratos congelados

- **`id` é slug textual escolhido pelo admin, imutável.** É a chave que o frontend indexa e que `atlas.settings.available_*` referencia. Colisão dá 409; **não existe rota de rename**. Renomear é criar novo e reapontar todos os settings.
- **`config.style` de basemap é servido verbatim** em `config.basemapStyles` para todo cliente, inclusive anônimo. Um style malformado gravado brica o mapa base de todo mundo no próximo boot; daí a validação no create e no update. O validador do backend (`backend/src/utils/maplibre-style-validate.js`) **espelha** o do cliente (`frontend/src/js/utilities/maplibre-style-validate.js`); mudou um, mude o outro. Ver [[sintese-contratos-congelados]].
- **`analysis_layer` sem `bounds` de 4 elementos é filtrado fora do `/config`** (`backend/src/modules/config/config.service.js`). Uma camada seedada incompleta já quebrou o boot da aplicação. Consequência que parece bug e não é: você cria pela API, recebe 201, ela aparece em `GET /analysis-layers` e **não aparece no `/config`**. Confira o `bounds` antes de abrir chamado.

## Soft delete: o caminho sem volta

`DELETE` faz `active = false` e responde 204; a linha fica. O filtro `active = true` precisa existir em **três** lugares (list, get por id, e o `WHERE` do update) e a ausência em cada um já foi bug: item soft-deletado seguia legível por id direto e editável de volta à visibilidade (`backend/src/modules/catalog/catalog.service.js`).

**Não há rota de reativar.** Ressuscitar é operação de banco. Se você precisa disso, é rota nova, não um `PUT`.

**Armadilha do `UPDATE`:** todo campo usa `COALESCE($n, coluna)`, então `null` significa "não mexa", não "limpe". Para `description`, `''` limpa; NULL literal é inalcançável pela API. Assimetria deliberada, pinada pelo teste `res-02` em `backend/tests/integration/images-gaps.test.js`. Não troque o COALESCE sem alterar o teste.

## O que não existe (e parece que existe)

- **Catálogo não passa pelo sync.** É REST puro e global, fora de [[sintese-rest-vs-sync]] e [[sync-admin-operacoes]]. Um admin trocando basemap não gera evento: quem está com o app aberto continua com o config do boot dele. O `no-cache` do `/config` só garante que o **próximo** boot vê a mudança, o oposto do regime de [[sintese-cache-http-imutavel]]. Desde 2026-07-25 o payload do `/config` é memoizado no servidor, e é por isso que **toda** escrita daqui chama `invalidateAppConfigCache()` (`backend/src/modules/catalog/catalog.service.js`): o `no-cache` continua valendo porque a invalidação é na escrita, não por TTL. Escrever nessas tabelas por SQL cru contorna isso, ver [[config-dinamico]].
- **Escritas de catálogo não são auditadas.** `createAudit` é chamado por `users`, `organizations` e `zones`, e por nenhum arquivo de `modules/catalog/`. Troca de basemap global não deixa rastro em [[auditoria]]. Trabalho a fazer, não algo existente.
- **`streetview_markers` NÃO EXISTE MAIS.** Ela ficou órfã desde que nasceu (`LIKE basemaps INCLUDING ALL`, 003): `backend/src/modules/config/config.service.js` nunca a incluiu, nenhum código de frontend chamou a rota dela, nenhum seed a populou, e o 360 real usa o schema próprio `sv360.*`. A migração 021 apagou a tabela, o mount e a categoria, sem depreciação — não havia o que depreciar. O que sobrevive é o valor `STREETVIEW_MARKER` no `CHECK` de `audit_trail.target_type`, hoje sem escritor e censado como buraco conhecido em `backend/tests/unit/auditoria-censo.test.js`. Os marcadores 360 do mapa continuam vindo do módulo de verdade ([[streetview-360]], [[ingestao-projetos-360]]).
- **`basemap` é o quinto tipo de recurso privado desde a 021.** Antes dela a camada de base já tinha `access_level` e já era filtrada (marcar privado a escondia de todo mundo), mas não existia `basemap` no `CHECK` de `resource_grants.resource_type`, então não havia como devolvê-la a quem tem direito. Era meia regra: fechava e não abria. A superfície é o SELETOR DE CAMADA BASE, e o item concedido chega pelo payload aditivo, somado em `config.basemaps` (e o estilo em `config.basemapStyles`) por `mergeGrantedIntoBaseline`. Duas consequências que a leitura do catálogo não entrega: o botão **Compartilhar** de um basemap mora no SELETOR (`frontend/src/js/base-layer-selector/base-layer-selector.control.js`), e não nesta aba de administração, porque `admin.html` boota sem a store e o modal de concessão arrasta o motor de sync; e o estilo de um basemap criado pelo painel só desenha porque o controle resolve `config.basemapStyles` quando não tem estilo embutido para o id (`frontend/src/js/baselayers/basemap-style.js`) — antes disso ele aparecia na lista e o clique caía noutra camada.
- **Metadata, não bytes.** Criar um `tileset` com `config.url` para caminho inexistente produz item que aparece na UI e falha ao abrir. Publique o asset primeiro ([[assets3d-distribuicao]], [[catalogo-3d]]).
- **`sort_order` empata por nome** (`ORDER BY sort_order, name`). Deixar tudo em 0 vira ordem alfabética.

O shape de cada `config` não tem validação: o Joi só exige objeto (`backend/src/modules/catalog/catalog.schemas.js`). A referência canônica de shape é o seed em `backend/src/database/migrations/003_sync.sql`, que o comentário do próprio DDL declara estar "já no shape de `GET /api/v1/config`". Quem consome é `backend/src/modules/config/config.service.js`.

## O catálogo de demonstração é dado de PRODUÇÃO, e aponta para asset que o repositório nunca teve

O `INSERT` do seed mora numa **migração** (`backend/src/database/migrations/003_sync.sql`), não no `backend/src/database/seed.js`. Isso não é detalhe de organização, é o que decide o alcance: `seed.js` é opcional e de dev, migração roda em todo ambiente, e o compose encadeia a migração antes do servidor ([[deploy-backend]]). **Todo banco que aplicou a 003 tem o catálogo de demonstração em produção**, e não existe flag de ambiente nesse caminho. Quem lê "seed" e conclui "só em dev" erra o diagnóstico inteiro.

O que essas linhas apontam nunca esteve versionado. O tileset `PCL` referencia `/3d/PCL/tileset.json`, mais `previewVideo` e `previewThumbnail` sob `/3d/videos/`, e `frontend/public/3d/` é ignorado pelo git (`frontend/.gitignore`, desde antes do pacote virar `frontend/`). O histórico inteiro não tem um único arquivo versionado ali além de dois `.gitkeep`, e `preview.webm`/`thumbnail.jpg` nunca foram rastreados em commit nenhum. Consequência: **numa instalação limpa o modelo de demonstração sempre esteve listado, clicável e quebrado**, sem que ninguém tenha removido nada. O sintoma parece regressão recente e é condição de origem. Os placeholders `rodovias-federais`, `limites-municipais` e as camadas de análise em `http://localhost/tiles/...` têm o mesmo status, e o próprio DDL avisa que são placeholders.

O cliente **não** falha em silêncio, ao contrário do que o sintoma sugere: `loadSingleTileset` deixa a rejeição de `Cesium3DTileset.fromUrl` subir, `openViewerWithTileset` mostra o toast "Erro ao carregar modelo 3D" e relança (`frontend/src/js/3d_models_viewer_tool/map_3d.js`), e só então `openViewer` devolve a tela para o 2D (`frontend/src/js/3d_models_viewer_tool/add_3d_models_viewer_control.js`). O que falta é especificidade, não mensagem: o texto é o mesmo para asset ausente e para modelo corrompido, e não diz que aquele item é demonstração. Já o popup do mapa 2D degrada de vídeo para miniatura e de miniatura para nada, então mídia ausente ali é tolerada por construção e não sinaliza problema algum.

**Para tirar do ar, não emita migração.** `DELETE /api/v1/tilesets/PCL` faz `active = false`, e `listCatalog` filtra por `active = true` (`backend/src/modules/catalog/catalog.service.js`), então o item some do `/config` no próximo boot, sem deploy e sem DDL. Uma migração que apagasse a linha rodaria em **toda** instalação, inclusive naquela em que um admin reapontou esse `id` para um modelo real, e um `DELETE` ainda contrariaria o soft-delete da casa. O preço do caminho por admin é o descrito acima: não há rota de reativar.

**Para publicar de verdade**, o destino é `/api/v1/assets3d`, alimentado por `scripts/assets3d-import.js` ([[assets3d-distribuicao]]). É esse o mecanismo desenhado para binário pesado, e ele mantém os arquivos fora do git **e** fora do `dist/`, ao contrário de `frontend/public/3d/`, que o Vite copia para o build a cada publicação (a origem do custo que motivou a retirada). Atenção ao ligar os dois: `config.tilesets` é servido verbatim e o cliente não aplica `assets3dBaseUrl` ([[catalogo-3d]]), então a `url` gravada no catálogo precisa ser o caminho final já resolvido, não o relativo que o catálogo `ng` usa.

## A exceção deliberada: miniatura embutida em base64

O catálogo guarda metadado, com uma exceção: a miniatura, que o painel admin embute no próprio `config` como data URL (`frontend/src/js/admin/catalog-tab.js`). O motivo é que o backend não serve estático público e `deploy/` é protegido ([[sintese-decisoes-arquiteturais]]).

**Custo escondido:** a miniatura pesa no payload de `GET /api/config` de **todo** boot, inclusive anônimo ([[config-dinamico]]). Daí o teto de 256 KB no data URL: `compressImage` pode **silenciosamente devolver o original** quando o decode falha, e sem o teto um PNG grande entraria inteiro no `/config`. WebP é escolha consciente (preserva transparência que o JPEG achataria em preto).

A chave da miniatura **muda por categoria** (`previewThumbnail` em tileset, `thumbnail` em data/analysis, `image` em basemap; `frontend/src/js/admin/catalog-tab.js`): espelha os shapes do deploy, não é uniformizável sem migrar dados.

Ao salvar: miniatura nova vence o JSON digitado, "Remover" faz `delete`, campo intocado preserva. O **vídeo de preview é exclusivo de `tileset` e fica fora de banda** (só URL, nunca upload); esvaziar o campo faz `delete`, então remover não é no-op.

## Divergências com a documentação

> **Nota histórica.** O guia *09-admin* (absorvido) §3.2-3.7 descreve uma API genérica `GET/POST/PUT/DELETE /api/v1/resources` com filtro `?category=`, coluna `category`, listagem sem o campo `active`, DELETE sem menção a soft delete, e um `config` de basemap com chaves (`url`, `attribution`, `maxZoom`, `minZoom`, `legend`) que não existem no seed nem são lidas pelo `config.service.js`. **Nada disso existe.** O modelo mental do guia sobreviveu por um tempo dentro do código: o `@fileoverview` de `frontend/src/js/admin/catalog-tab.js` afirmava que as categorias "go through the existing `/api/v1/resources` admin CRUD", **no próprio arquivo que faz o mapeamento por tipo**, e foi corrigido em 2026-07-25. A autoridade é `_catalogEndpoint`, que traduz a categoria antiga para a rota por tabela.

## Relacionados

- [[config-dinamico]], [[config-runtime-urls-relativas]]: como o catálogo chega ao cliente.
- [[atlas-settings]]: recorte por atlas sobre o catálogo global.
- [[catalogo-3d]], [[assets3d-distribuicao]], [[streetview-360]]: consumidores de `tileset` e 360.
- [[gestao-usuarios]], [[permissoes-atlas]], [[organizacoes-om]]: o papel `admin`.
- [[api-rest-atlas]], [[erros-api]], [[autenticacao-jwt]]: convenções REST, erro e auth.
