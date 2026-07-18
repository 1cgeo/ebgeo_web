# Ingestão de bundles 360 (admin)

Upload multipart (`manifest` + `images.db` + thumbnail) que substitui o estado completo de um projeto por `(organização, slug)`, último upload manda, com gate de capacidade de escrita antes do multer, `{slug}.db` derivado no servidor e toggle de status/hard-delete do projeto.

## Onde isso vive

Rotas sob `/api/v1/sv360/admin`, montadas em `sv360.routes.js:274-305`. O módulo inteiro está fora do sync/CRDT do atlas (ver [[sintese-modulos-fora-do-sync]] e [[streetview-360]]): uma ingestão não gera broadcast WebSocket, o cliente recarrega por REST.

O envelope também é o do módulo 360, não o do resto da API: sucesso é **objeto nu** (não `{data}`) e erro é **plano** `{ "error": "mensagem" }` (`sv360-error.js:15-36`). Isso diverge de [[erros-api]] / [[sintese-contrato-erros-http]] de propósito, é contrato congelado do viewer ([[sintese-contratos-congelados]]).

| Rota | Efeito |
|------|--------|
| `POST /admin/projects/upload` | Ingere um bundle (multipart). **201** com `{projectId, slug, dbFilename, photoCount}` |
| `GET /admin/projects` | Lista projetos da OM **incluindo `disabled`**; admin global vê tudo, filtrável por `?orgId` |
| `PATCH /admin/projects/:slug/status` | `{status:'enabled'\|'disabled'}`, **200** com o projeto |
| `DELETE /admin/projects/:slug` | **Hard-delete** (CASCADE fotos → targets) + remove o `{slug}.db`, **204** |

## Campos do multipart

Os nomes dos campos são `manifest`, `imagesDb`, `thumbnail` (`sv360.routes.js:84-88`). Armadilha comum: o arquivo é `images.db`, mas o **campo** chama `imagesDb` (camelCase). Campo desconhecido → 400 (`sv360.routes.js:77`).

- `manifest`: JSON com o **estado completo** do projeto (`project` + `photos[]` + `targets[]` + `deleted_photos[]`), não um delta.
- `imagesDb`: SQLite com tabela `images(photo_id, full_webp, preview_webp)`.
- `thumbnail`: opcional, `.webp`.

O multer usa `diskStorage` no `config.sv360.tmpDir`, que **precisa estar no mesmo volume** de `SV360_DB_DIR`, senão o rename final deixa de ser atômico e vira cópia cross-device (`sv360.routes.js:46-70`, `config.js:69-81`). Limite: `files: 3` e `fileSize = SV360_MAX_UPLOAD_BYTES` (default 2 GiB). O controller sempre limpa os três tmp num `finally` (`sv360.admin.controller.js:51-57`).

Para `imagesDb` o `fileFilter` aceita **qualquer** mimetype (`sv360.routes.js:81`): a validação real é estrutural, feita depois por `validateImagesDb`. Não confie no mimetype como defesa aqui, a defesa é o size-check.

## Gate de capacidade antes do multer

`requireUploadCapability` (`sv360.routes.js:265-272`) roda **antes** de `uploadBundle` (o multer). Quem não é `role === 'admin'` nem tem `org_role ∈ {owner, admin, editor}` recebe **403 sem que um byte chegue ao disco**. Isso fecha um DoS de disk-fill autenticado: um `viewer` autenticado poderia empurrar 2 GiB para o tmp antes de qualquer checagem de posse. Ver [[hardening-borda-api]] e o paralelo em [[upload-imagens-seguranca]].

Esse gate é um **pré-filtro grosseiro**, não a checagem de posse. A posse por organização continua no service (`resolveUploadOrgId`, `sv360.admin.service.js:67-88`): admin global pode mirar qualquer OM via `manifest.project.orgSlug`; um admin de dados de OM é **forçado** à própria org e leva 403 se o manifest apontar para outra. Ver [[organizacoes-om]] e [[permissoes-atlas]].

Tanto o 401 (`authDraining`) quanto o 403 passam por `drainThen` (`sv360.routes.js:241-257`), que **drena o corpo multipart** antes de responder. Sem isso, rejeitar cedo fecha a conexão e o cliente vê `ECONNRESET` em vez do 4xx limpo. Se você adicionar um novo middleware de rejeição nessa rota, ele também precisa drenar.

## Validação em duas etapas (PASSO 0)

Nada é tocado antes de o bundle passar por duas validações (`sv360.ingest.js:368-385`).

**1. `validateManifest`** contra `manifestSchema` (`sv360.admin.schemas.js:128-157`). Rejeita:
- `NaN`/`Infinity` em qualquer numérico (Joi.number já rejeita não finitos);
- `lat ∉ [-90,90]`, `lon ∉ [-180,180]`;
- campos NOT NULL ausentes (`id`, `original_name`, `sequence_number`, `lat`, `lon`, `full_size_bytes`, `preview_size_bytes`);
- `sequence_number` duplicado dentro de `photos[]`;
- `target` cujo `source_id`/`target_id` não está em `photos[]` (integridade referencial **dentro** do bundle);
- `slug` fora de `^[a-z0-9-]+$`.

Ids de foto são UUID **v5** e o backend só valida o **formato**, não recalcula (`sv360.admin.schemas.js:31-33`). O determinismo do id é responsabilidade do estúdio, e é ele que torna a reingestão idempotente.

**2. `validateImagesDb`** (`sv360.ingest.js:95-137`): abre o SQLite readonly e exige que **toda** foto do manifest tenha linha em `images`, com `length(full_webp) == full_size_bytes` e `length(preview_webp) == preview_size_bytes`. O motivo é direto: o ETag da imagem é derivado do tamanho gravado no Postgres, sem ler o BLOB (O(1), ver [[sintese-cache-http-imutavel]]). Se manifest e BLOB divergirem, o cache do cliente fica permanentemente errado. Divergência → **400**.

`JSON` quebrado → 400; schema inválido → 422 (`sv360.admin.service.js:246-250`, `sv360.ingest.js:72-78`).

## O `{slug}.db` é derivado no servidor

`deriveDbFilename(orgId, slug)` produz `${orgId}__${sanitizeSlug(slug)}.db` (`sv360.merge.js:57-59`). O `manifest.project.db_filename` é **aceito e ignorado** (`sv360.admin.schemas.js:38-50`, `sv360.merge.js:150-153`). Sem isso, um manifest malicioso apontaria o store para o arquivo de outra OM e sobrescreveria os BLOBs alheios. O prefixo de org também garante que duas OMs com o mesmo slug nunca colidam no disco (slug é único **por org**, não global).

A thumbnail segue a mesma chave: é gravada como `{orgId}__{slug}.webp`, derivada de `result.dbFilename` (`sv360.admin.service.js:263-276`), e servida resolvendo o `db_filename` do projeto (`sv360.service.js:254-258`). Falha ao gravar a thumbnail **não** falha a ingestão, o projeto já está no ar.

> **Nota histórica.** guia *16-streetview-360* (absorvido):333` e o comentário em `sv360.service.js:306-309` dizem que o arquivo escrito na ingestão é `{slug}.webp`; o código grava `{orgId}__{slug}.webp` (`sv360.admin.service.js:269`). O `:slug` da URL continua sendo só o slug, a tradução para o nome org-keyed acontece no servidor.

## Merge: último upload manda

`mergeProject` (`sv360.merge.js:133-223`) é o **único** lugar que escreve o estado do projeto, compartilhado entre o upload admin e o ETL offline (`scripts/sv360-import.js:324`). Ordem:

1. **collision guard antes de qualquer escrita** (`sv360.merge.js:94-101`): se algum id de foto já pertence a um projeto que não seja o alvo `(orgId, slug)`, 409. Cobre colisão cross-OM **e** same-org cross-project, porque `sv360.photos.id` é PK global, e sem o guard o INSERT estouraria como 500 opaco. Reupload do próprio projeto nunca é sinalizado.
2. **UPSERT do projeto** por `UNIQUE(organization_id, slug)`. `status` e `created_at` **não** estão no SET list, então são preservados (`sv360.admin.queries.js:82-101`). Consequência prática: reenviar um bundle **não** reabilita um projeto `disabled`.
3. **PURGE** dos filhos: targets → photos → tombstones.
4. **REINSERT** de `photos[]` (o `geom` vem do trigger `trg_sv360_photos_geom`, nunca é escrito aqui), depois `targets[]`, depois `deleted_photos[]`.

`photo_count = photos.length` (tombstones não contam). Como é purge+reinsert do estado completo, reenviar o mesmo manifest reproduz exatamente o mesmo estado, e **qualquer calibração feita via API depois do último export é perdida** ([[calibracao-e-grafo-360]]). Quem calibra pela API precisa reexportar do estúdio antes de reingerir.

## Ordem swap-first-then-commit

`ingestBundle` (`sv360.ingest.js:406-441`) instala o arquivo **primeiro** e usa o commit do Postgres como o único ponto atômico:

- **PASSO 1** `installSwap` (`sv360.ingest.js:215-268`): copia o tmp para `dest.tmp` + fsync best-effort, **evita** o handle readonly cacheado de `dest` no pool de workers, renomeia `dest → dest.bak`, evita o handle do `.tmp` e renomeia `.tmp → dest`. A flag `committed` vira `true` no instante do rename final: nada depois disso pode desfazer o arquivo novo.
- **PASSO 2** `conn.tx(mergeProject)`. Se lançar, `rollbackSwap` restaura o `.bak` (ou remove o arquivo novo quando não havia anterior) e o erro original sobe. Se commitar, `commitSwap` apaga o `.bak` e uma falha nessa limpeza é apenas logada.

O evict é obrigatório no Windows: renomear por cima de um SQLite aberto por um worker dá `EBUSY`/`EPERM`. Se `blobPool.evict` não existir, o código degrada para `closeAll()`, que derruba todas as conexões, inclusive as de assets 3D ([[assets3d-distribuicao]]).

Janela residual documentada: um crash entre PASSO 1 e o commit deixa o `{slug}.db` **novo** com os metadados **antigos** no Postgres. É benigno, porque toda foto que o Postgres ainda anuncia é servível pelo arquivo novo; fotos novas simplesmente não aparecem ainda.

Ingestões concorrentes do mesmo `(orgId, slug)` são serializadas por um **advisory lock de sessão** no namespace `0x53333630` (`sv360.ingest.js:55`, `406-439`). Tem que ser de sessão, não de transação: a transação começa depois do swap do arquivo, então um lock transacional chegaria tarde demais e dois uploads poderiam intercalar swap-swap-commit-commit, deixando os bytes de B no disco com o `.bak` de A restaurável por engano. O `finally` libera, e o Postgres solta sozinho se a conexão morrer.

## Status e hard-delete

`setStatus` e `deleteProject` passam por `loadWritableProject` (`sv360.admin.service.js:107-147`), que aplica a escada 404 → 403 e trata a ambiguidade de slug: como slug só é único **por org**, um admin global que não desambigua e acerta um slug presente em ≥2 OMs recebe **409** pedindo `?orgId` ou `?orgSlug`, em vez de o sistema chutar um `ORDER BY created_at LIMIT 1`. `?orgId` malformado é 422 pelo Joi (`sv360.admin.schemas.js:181-186`), não um 500 no cast de uuid.

`PATCH status=disabled` é o "soft delete": o projeto some das leituras públicas e continua visível para a OM dona ([[streetview-360]]). `DELETE` é hard: apaga a linha (CASCADE em fotos e targets), faz evict do handle, remove `{orgId}__{slug}.db` e, best-effort, os irmãos `.tmp`, `.bak` e `.webp` (`sv360.admin.service.js:197-219`). A remoção do arquivo é best-effort porque o metadado autoritativo já foi apagado. Não há trilha de auditoria específica de ingestão aqui (`source` é só um tag informativo, `sv360.merge.js:134`); ver [[auditoria]] para o que de fato é registrado.

## Tabela de erros da ingestão

| Status | Quando |
|--------|--------|
| `400` | `manifest`/`imagesDb` ausente, JSON quebrado, campo multipart inesperado, `images.db` não-SQLite, sem tabela `images`, linha faltando ou size mismatch |
| `401` | Sem token válido (corpo drenado antes) |
| `403` | Sem capacidade de escrita (gate pré-multer) ou manifest mirando outra OM |
| `409` | Id de foto pertencente a outro projeto; slug ambíguo entre OMs (status/delete) |
| `422` | Manifest inválido pelo schema; `?orgId` malformado |

## Armadilhas

- Comentários desatualizados no próprio código descrevem a ordem inversa (`sv360.admin.service.js:224` e `scripts/sv360-import.js:29-33` dizem "Postgres primeiro, swap depois"). O corpo de `ingestBundle` é swap-first (`sv360.ingest.js:411-428`). Vale para a leitura, não para o comportamento.
- O ETL offline é o gêmeo do upload e reusa `mergeProject`, mas mantém a cópia **dentro** da tx, porque não há leitores vivos (`scripts/sv360-import.js:29-33`). Não replique essa ordem no caminho online.
- `tmpDir` em volume diferente de `dbDir` quebra a atomicidade do rename silenciosamente. Checagem de deploy, não de código ([[deploy-backend]]).
- A URL base do módulo chega ao frontend pelo `/api/config` (`streetView360.serviceUrl`), ver [[config-runtime-urls-relativas]] e [[config-dinamico]].

## Fontes
- guia *16-streetview-360* (absorvido): contrato público das rotas admin (§9), envelope nu/plano, tabela de erros, política de acesso e posse.
- `ebgeo_backend/src/modules/streetview360/sv360.routes.js`: campos multipart, limites do multer, `drainThen`/`authDraining`/`requireUploadCapability`.
- `ebgeo_backend/src/modules/streetview360/sv360.ingest.js`: `validateManifest`, `validateImagesDb`, protocolo `installSwap`/`commitSwap`/`rollbackSwap`, advisory lock de sessão, janela de crash.
- `ebgeo_backend/src/modules/streetview360/sv360.merge.js`: `deriveDbFilename`, collision guard, UPSERT preservando status/created_at, purge+reinsert.
- `ebgeo_backend/src/modules/streetview360/sv360.admin.service.js` e `sv360.admin.controller.js`: resolução de org/posse, thumbnail org-keyed, status, hard-delete, limpeza de tmp.
- `ebgeo_backend/src/modules/streetview360/sv360.admin.schemas.js` e `sv360.admin.queries.js`: schema do manifest e SQL do merge.
- `ebgeo_backend/src/config.js`: `SV360_DB_DIR`, `SV360_TMP_DIR`, `SV360_MAX_UPLOAD_BYTES`.
- `ebgeo_backend/scripts/sv360-import.js`: ETL offline como gêmeo do upload (ordem de cópia diferente).
