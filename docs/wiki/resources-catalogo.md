# Resources (catálogo global de camadas e assets)

Registro global versionado por categoria, filtrado na leitura pelo eixo de acesso a recurso e escrito por administrador ou pela OM produtora, que alimenta o `GET /api/v1/config` de todo cliente.

## A taxonomia de tipo é mais pobre do que o acervo

`tilesets` distingue só DUAS formas de 3D, por `config.type === 'glb'` presente ou ausente,
e o acervo tem pelo menos três: tileset 3D, modelo isolado e nuvem de pontos. Quando o
acervo do segundo catálogo (que vivia no schema `ng` e saiu em 2026-08-19) foi convertido,
a NUVEM DE PONTOS foi mapeada para tileset. Isso é correto de carregamento, porque o
formato dela é parte do 3D Tiles, e não quebra nada.

O que se perde é poder DIZER na tela que aquele item é uma nuvem, e filtrar por isso.
Declarar a taxonomia por extenso (tiles3d, glb, pointcloud, indoor) é trabalho próprio;
inventá-la durante a conversão criaria um valor que nenhum leitor do código conhece.

## A distinção que mais confunde

O catálogo diz **o que existe no servidor**; o [[atlas-settings]] diz **o que aquele atlas pode usar** (subconjunto). Remover do catálogo some para todos; tirar de `available_data_layers` some só naquele atlas. São eixos independentes: nunca "conserte" visibilidade de um mexendo no outro.

## O gate de escrita são DUAS camadas, e nenhuma duplica a outra

Escrever no catálogo deixou de ser só-admin: passa também o **produtor**, dentro do escopo de `users.producer_org_id` ([[acesso-a-recurso-privado]]). Nenhuma permissão de atlas destrava nada aqui, e um `owner` de atlas continua sem editar catálogo ([[permissoes-atlas]], [[gestao-usuarios]]).

A divisão do trabalho é o que importa, porque as duas camadas parecem redundantes e não são. `requireCatalogProducer` (`backend/src/middleware/resource-access.js`) só pergunta "esta pessoa produz **alguma** coisa?" e recusa cedo, com 403, quem não produz nada. **Qual linha** é dela é decidido dentro do `WHERE` da própria escrita (`backend/src/modules/catalog/catalog.service.js`), na mesma consulta que muta: é isso que fecha a janela entre ler o dono e escrever, e é por isso que a linha de outra OM devolve **404**, não 403, pela mesma escada de "o que você não vê não existe".

Duas consequências que o código não anuncia: o tipo de produção vem da **tabela com que o router foi fabricado**, nunca do request (é o mesmo cuidado de `assertTable`); e `owner_org_id` **nunca é lido do corpo** na criação, senão o produtor escolheria de quem é o que ele acabou de criar.

## Quatro tabelas dedicadas, não uma `resources` genérica

O DDL (`backend/src/database/migrations/005_catalogo.sql`) rejeita explicitamente a tabela única com coluna `category`, em favor de tabelas de forma idêntica, para permitir evolução independente por tipo. As quatro são escritas por extenso; até a consolidação de 2026-08-19 três nasciam clonadas da primeira, e a clonagem NÃO copiava chave estrangeira (nenhuma opção dela copia), o que fazia toda coluna com FK precisar de um passo próprio por tabela. Quem mantém a paridade das quatro é `backend/tests/integration/catalog-tabelas-paridade.test.js`. O router é fábrica por tabela (`makeCatalogRouter`).

Nasceram CINCO e são QUATRO desde 2026-08-17: `streetview_markers` foi apagada por nunca ter tido consumidor nenhum (ver a seção seguinte). O nome dela colidia com o de um arquivo VIVO do frontend, `frontend/src/js/street_view_tool/streetview_markers.js`, que é a camada de marcadores do 360 no mapa 2D e lê de `sv360.projects`: uma busca por nome atinge os dois, e eles eram opostos.

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
- **As escritas de catálogo passaram a ser auditadas** (`CATALOG_CREATE`/`UPDATE`/`DELETE`, [[auditoria]]), e a razão é o produtor: enquanto o autor era sempre o admin, a trilha era quase adivinhável; com N autores por OM deixou de ser. O detalhe que morde ao acrescentar tabela: o `target_type` da trilha é um **terceiro** vocabulário, nem o das tabelas nem o do `CHECK` de `resource_grants`, e os três mapas moram juntos em `backend/src/modules/catalog/catalog.tables.js` de propósito. Valor fora do `CHECK` levanta 23514 no INSERT da trilha, e como a auditoria é transacional isso derruba a escrita inteira.
- **`streetview_markers` NÃO EXISTE MAIS.** Ela ficou órfã desde que nasceu, clonada da irmã num `LIKE ... INCLUDING ALL`: `backend/src/modules/config/config.service.js` nunca a incluiu, nenhum código de frontend chamou a rota dela, nenhum seed a populou, e o 360 real usa o schema próprio `sv360.*`. A tabela foi apagada, o mount e a categoria, sem depreciação — não havia o que depreciar. O que sobrevive é o valor `STREETVIEW_MARKER` no `CHECK` de `audit_trail.target_type`, hoje sem escritor e censado como buraco conhecido em `backend/tests/unit/auditoria-censo.test.js`. Os marcadores 360 do mapa continuam vindo do módulo de verdade ([[streetview-360]], [[ingestao-projetos-360]]).
- **`basemap` é o quinto tipo de recurso privado desde 2026-08-17.** Antes disso a camada de base já tinha `access_level` e já era filtrada (marcar privado a escondia de todo mundo), mas não existia `basemap` no `CHECK` de `resource_grants.resource_type`, então não havia como devolvê-la a quem tem direito. Era meia regra: fechava e não abria. A superfície é o SELETOR DE CAMADA BASE, e o item concedido chega pelo payload aditivo, somado em `config.basemaps` (e o estilo em `config.basemapStyles`) por `mergeGrantedIntoBaseline`. Duas consequências que a leitura do catálogo não entrega: o botão **Compartilhar** de um basemap mora no SELETOR (`frontend/src/js/base-layer-selector/base-layer-selector.control.js`), e não nesta aba de administração, porque `admin.html` boota sem a store e o modal de concessão arrasta o motor de sync; e o estilo de um basemap criado pelo painel só desenha porque o controle resolve `config.basemapStyles` quando não tem estilo embutido para o id (`frontend/src/js/baselayers/basemap-style.js`) — antes disso ele aparecia na lista e o clique caía noutra camada.
- **Metadata, não bytes.** Criar um `tileset` com `config.url` para caminho inexistente produz item que aparece na UI e falha ao abrir. Publique o asset primeiro ([[assets3d-distribuicao]], [[resources-catalogo]]).
- **`sort_order` empata por nome** (`ORDER BY sort_order, name`). Deixar tudo em 0 vira ordem alfabética.

O shape de cada `config` não tem validação: o Joi só exige objeto (`backend/src/modules/catalog/catalog.schemas.js`). A referência canônica de shape é o seed em `backend/src/database/migrations/005_catalogo.sql`, que o comentário do próprio DDL declara estar "já no shape de `GET /api/v1/config`". Quem consome é `backend/src/modules/config/config.service.js`.

## O seed do catálogo é dado de PRODUÇÃO, e o tileset de demonstração foi removido por isso

O `INSERT` do seed mora numa **migração** (`backend/src/database/migrations/005_catalogo.sql`), não no `backend/src/database/seed.js`. Isso não é detalhe de organização, é o que decide o alcance: `seed.js` é opcional e de dev, migração roda em todo ambiente, e o compose encadeia a migração antes do servidor ([[deploy-backend]]). **Todo banco migrado nasce com o seed em produção**, e não existe flag de ambiente nesse caminho. Quem lê "seed" e conclui "só em dev" erra o diagnóstico inteiro.

Foi essa combinação que matou o tileset de demonstração. Ele referenciava `/3d/PCL/tileset.json` mais um vídeo e uma miniatura sob `/3d/videos/`, e `frontend/public/3d/` é ignorado pelo git: o histórico inteiro não tem um único arquivo versionado ali além de dois `.gitkeep`. **Numa instalação limpa o modelo de demonstração sempre esteve listado, clicável e quebrado**, com o 404 engolido pelo visualizador, e isso é condição de origem e não regressão. Hoje **`tilesets` nasce vazia**, por decisão do dono do produto: tileset é configurado, não semeado, e semear conteúdo numa migração faz o dado nascer errado em toda instalação nova. Os placeholders `rodovias-federais`, `limites-municipais` e as camadas de análise em `http://localhost/tiles/...` CONTINUAM no seed com o mesmo status, e o próprio DDL avisa que são placeholders.

O cliente **não** falha em silêncio, ao contrário do que o sintoma sugere: `loadSingleTileset` deixa a rejeição de `Cesium3DTileset.fromUrl` subir, `openViewerWithTileset` mostra o toast "Erro ao carregar modelo 3D" e relança (`frontend/src/js/3d_models_viewer_tool/map_3d.js`), e só então `openViewer` devolve a tela para o 2D (`frontend/src/js/3d_models_viewer_tool/add_3d_models_viewer_control.js`). O que falta é especificidade, não mensagem: o texto é o mesmo para asset ausente e para modelo corrompido, e não diz que aquele item é demonstração. Já o popup do mapa 2D degrada de vídeo para miniatura e de miniatura para nada, então mídia ausente ali é tolerada por construção e não sinaliza problema algum.

**Para tirar do ar, não emita migração.** `DELETE /api/v1/tilesets/PCL` faz `active = false`, e `listCatalog` filtra por `active = true` (`backend/src/modules/catalog/catalog.service.js`), então o item some do `/config` no próximo boot, sem deploy e sem DDL. Uma migração que apagasse a linha rodaria em **toda** instalação, inclusive naquela em que um admin reapontou esse `id` para um modelo real, e um `DELETE` ainda contrariaria o soft-delete da casa. O preço do caminho por admin é o descrito acima: não há rota de reativar.

**Para publicar de verdade**, o destino é `/api/v1/assets3d`, alimentado por `scripts/assets3d-import.js` ([[assets3d-distribuicao]]). É esse o mecanismo desenhado para binário pesado, e ele mantém os arquivos fora do git **e** fora do `dist/`, ao contrário de `frontend/public/3d/`, que o Vite copia para o build a cada publicação (a origem do custo que motivou a retirada). Atenção ao ligar os dois: `config.tilesets` é servido verbatim e o cliente não aplica `assets3dBaseUrl` ([[resources-catalogo]]), então a `url` gravada no catálogo precisa ser o caminho final já resolvido, e não um relativo à espera de prefixo.

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
- [[resources-catalogo]], [[assets3d-distribuicao]], [[streetview-360]]: consumidores de `tileset` e 360.
- [[acesso-a-recurso-privado]]: a marca público/privado, quem a destrava na leitura e o escopo de produção que destrava a escrita.
- [[gestao-usuarios]], [[permissoes-atlas]], [[organizacoes-om]]: os papéis globais e quem os escreve.
- [[api-rest-atlas]], [[erros-api]], [[autenticacao-jwt]]: convenções REST, erro e auth.
