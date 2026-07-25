# Resources (catálogo global de camadas e assets)

Registro global versionado por categoria, legível por qualquer autenticado e escrito só por admin, que alimenta o `GET /api/v1/config` de todo cliente.

## A distinção que mais confunde

O catálogo diz **o que existe no servidor**; o [[atlas-settings]] diz **o que aquele atlas pode usar** (subconjunto). Remover do catálogo some para todos; tirar de `available_data_layers` some só naquele atlas. São eixos independentes: nunca "conserte" visibilidade de um mexendo no outro.

O papel que destrava a escrita é `role = admin` **global de usuário**, não permissão de atlas: um `owner` de atlas não edita catálogo ([[permissoes-atlas]], [[gestao-usuarios]]).

## Cinco tabelas dedicadas, não uma `resources` genérica

O DDL (`backend/src/database/migrations/003_sync.sql:95-115`) rejeita explicitamente a tabela única com coluna `category`, em favor de cinco tabelas de forma idêntica (`LIKE basemaps INCLUDING ALL`) para permitir evolução independente por tipo. O router é fábrica por tabela (`backend/src/modules/catalog/catalog.routes.js:14`).

**Armadilha de segurança:** o nome da tabela é **interpolado em SQL** (o driver `pg` não faz bind de identificador), e `assertTable()` (`backend/src/modules/catalog/catalog.tables.js:13`) é a única barreira. Hoje o `table` vem fixo do mount em `backend/src/app.js:102-106`. Passar um `table` derivado de request é injeção direta. Ver [[hardening-borda-api]].

## Contratos congelados

- **`id` é slug textual escolhido pelo admin, imutável.** É a chave que o frontend indexa e que `atlas.settings.available_*` referencia. Colisão dá 409 (`backend/src/modules/catalog/catalog.service.js:43`); **não existe rota de rename**. Renomear é criar novo e reapontar todos os settings.
- **`config.style` de basemap é servido verbatim** em `config.basemapStyles` para todo cliente, inclusive anônimo. Um style malformado gravado brica o mapa base de todo mundo no próximo boot; daí a validação no create e no update. O validador do backend (`backend/src/utils/maplibre-style-validate.js`) **espelha** o do cliente (`frontend/src/js/utilities/maplibre-style-validate.js`); mudou um, mude o outro. Ver [[sintese-contratos-congelados]].
- **`analysis_layer` sem `bounds` de 4 elementos é filtrado fora do `/config`** (`backend/src/modules/config/config.service.js:86-96`). Uma camada seedada incompleta já quebrou o boot da aplicação. Consequência que parece bug e não é: você cria pela API, recebe 201, ela aparece em `GET /analysis-layers` e **não aparece no `/config`**. Confira o `bounds` antes de abrir chamado.

## Soft delete: o caminho sem volta

`DELETE` faz `active = false` e responde 204; a linha fica. O filtro `active = true` precisa existir em **três** lugares (list, get por id, e o `WHERE` do update) e a ausência em cada um já foi bug: item soft-deletado seguia legível por id direto e editável de volta à visibilidade (`backend/src/modules/catalog/catalog.service.js:33-35, 56-57`).

**Não há rota de reativar.** Ressuscitar é operação de banco. Se você precisa disso, é rota nova, não um `PUT`.

**Armadilha do `UPDATE`:** todo campo usa `COALESCE($n, coluna)`, então `null` significa "não mexa", não "limpe". Para `description`, `''` limpa; NULL literal é inalcançável pela API. Assimetria deliberada, pinada pelo teste `res-02` em `backend/tests/integration/images-gaps.test.js`. Não troque o COALESCE sem alterar o teste.

## O que não existe (e parece que existe)

- **Catálogo não passa pelo sync.** É REST puro e global, fora de [[sintese-rest-vs-sync]] e [[sync-admin-operacoes]]. Um admin trocando basemap não gera evento: quem está com o app aberto continua com o config do boot dele. O `no-cache` do `/config` só garante que o **próximo** boot vê a mudança, o oposto do regime de [[sintese-cache-http-imutavel]]. Desde 2026-07-25 o payload do `/config` é memoizado no servidor, e é por isso que **toda** escrita daqui chama `invalidateAppConfigCache()` (`backend/src/modules/catalog/catalog.service.js`): o `no-cache` continua valendo porque a invalidação é na escrita, não por TTL. Escrever nessas tabelas por SQL cru contorna isso — ver [[config-dinamico]].
- **Escritas de catálogo não são auditadas.** `createAudit` é chamado por `users`, `organizations` e `zones`, e por nenhum arquivo de `modules/catalog/`. Troca de basemap global não deixa rastro em [[auditoria]]. Trabalho a fazer, não algo existente.
- **`streetview_markers` está órfão.** Tabela criada e rota montada, mas nenhum consumidor lê: o `backend/src/modules/config/config.service.js` não a inclui e o 360 real usa o schema próprio `sv360.*`. Escrever ali não tem efeito visível ([[streetview-360]], [[ingestao-projetos-360]]).
- **Metadata, não bytes.** Criar um `tileset` com `config.url` para caminho inexistente produz item que aparece na UI e falha ao abrir. Publique o asset primeiro ([[assets3d-distribuicao]], [[catalogo-3d]]).
- **`sort_order` empata por nome** (`ORDER BY sort_order, name`). Deixar tudo em 0 vira ordem alfabética.

O shape de cada `config` não tem validação: o Joi só exige objeto (`backend/src/modules/catalog/catalog.schemas.js:8`). A referência canônica de shape é o seed em `backend/src/database/migrations/003_sync.sql:130-175`, que o comentário do próprio DDL declara estar "já no shape de `GET /api/v1/config`". Quem consome é `backend/src/modules/config/config.service.js:61-107`.

## A exceção deliberada: miniatura embutida em base64

O catálogo guarda metadado, com uma exceção: a miniatura, que o painel admin embute no próprio `config` como data URL (`frontend/src/js/admin/catalog-tab.js:251,382-386`). O motivo é que o backend não serve estático público e `deploy/` é protegido ([[sintese-decisoes-arquiteturais]]).

**Custo escondido:** a miniatura pesa no payload de `GET /api/config` de **todo** boot, inclusive anônimo ([[config-dinamico]]). Daí o teto de 256 KB no data URL: `compressImage` pode **silenciosamente devolver o original** quando o decode falha, e sem o teto um PNG grande entraria inteiro no `/config`. WebP é escolha consciente (preserva transparência que o JPEG achataria em preto).

A chave da miniatura **muda por categoria** (`previewThumbnail` em tileset, `thumbnail` em data/analysis, `image` em basemap; `frontend/src/js/admin/catalog-tab.js:21-27`): espelha os shapes do deploy, não é uniformizável sem migrar dados.

Ao salvar: miniatura nova vence o JSON digitado, "Remover" faz `delete`, campo intocado preserva. O **vídeo de preview é exclusivo de `tileset` e fica fora de banda** (só URL, nunca upload); esvaziar o campo faz `delete`, então remover não é no-op.

## Divergências com a documentação

> **Nota histórica.** O guia *09-admin* (absorvido) §3.2-3.6 documenta uma API genérica `GET/POST/PUT/DELETE /api/v1/resources` com filtro `?category=` e coluna `category`. Essa rota **não existe**: `grep "v1/resources"` em `src/` não retorna nada e não há coluna `category` em lugar nenhum. O cliente já traduz categoria antiga para rota nova em `frontend/src/js/store/sync/api-client.js:411-427`.

O `@fileoverview` de `frontend/src/js/admin/catalog-tab.js` afirmava que as categorias "go through the existing `/api/v1/resources` admin CRUD", rota que não existe, **no próprio arquivo que faz o mapeamento por tipo**. Corrigido em 2026-07-25; a autoridade é o `_catalogEndpoint`.

> **Nota histórica.** O guia §3.2 afirma que `active` não é incluído na resposta de listagem. É incluído (`COLS` em `backend/src/modules/catalog/catalog.service.js:9`). A parte correta é que a listagem só devolve `active = true`.

> **Nota histórica.** O guia §3.6 descreve o DELETE como "204 No Content" sem dizer que é soft delete, e §3.7 exemplifica `config` de basemap com `{ url, attribution, maxZoom, minZoom }` e um array `legend` em analysis_layer. Nenhuma dessas chaves existe no seed nem é lida pelo `backend/src/modules/config/config.service.js`.

## Relacionados

- [[config-dinamico]], [[config-runtime-urls-relativas]]: como o catálogo chega ao cliente.
- [[atlas-settings]]: recorte por atlas sobre o catálogo global.
- [[catalogo-3d]], [[assets3d-distribuicao]], [[streetview-360]]: consumidores de `tileset` e 360.
- [[gestao-usuarios]], [[permissoes-atlas]], [[organizacoes-om]]: o papel `admin`.
- [[api-rest-atlas]], [[erros-api]], [[autenticacao-jwt]]: convenções REST, erro e auth.
