# Ingestão de bundles 360 (admin)

Upload multipart que substitui o **estado completo** de um projeto por `(organização, slug)`, último upload manda, com o commit do Postgres como único ponto atômico.

O código deste módulo é densamente comentado: `backend/src/modules/streetview360/sv360.ingest.js` e `backend/src/modules/streetview360/sv360.merge.js` já explicam o protocolo de swap, o advisory lock de sessão, o collision guard e a janela de crash residual. Esta página não repete nada disso. Ela cobre o que **não** está em nenhum arquivo isolado, e onde os comentários do código **mentem**.

## O que a reingestão destrói

Consequência que não aparece em nenhum arquivo sozinho: o merge é purge+reinsert do estado completo (`backend/src/modules/streetview360/sv360.merge.js:166-219`), mas as rotas de calibração escrevem direto em `sv360.photos` e `sv360.targets` (`backend/src/modules/streetview360/sv360.write.queries.js:50-68`). Logo, **toda calibração feita via API depois do último export do estúdio é apagada silenciosamente pelo próximo upload** ([[calibracao-e-grafo-360]]). Não há aviso, diff ou trilha: quem calibra pela API precisa reexportar do estúdio antes de reingerir, ou perde o trabalho. Se algum dia o estúdio deixar de ser a fonte única, este é o ponto que quebra primeiro.

Consequência irmã, mais barata: o UPSERT preserva `status` e `created_at` (`backend/src/modules/streetview360/sv360.admin.queries.js:82-101`), então **reenviar um bundle não reabilita um projeto `disabled`**. Quem tenta "ressuscitar" um projeto reingerindo fica olhando para um 201 de sucesso e um projeto que continua invisível ao público.

## Contratos congelados

O envelope diverge do resto da API **de propósito**: sucesso é objeto nu (não `{data}`) e erro é plano `{ "error": "..." }` (`backend/src/modules/streetview360/sv360-error.js:15-36`). Isso contradiz [[erros-api]] / [[sintese-contrato-erros-http]] e não é um descuido a ser "corrigido": é o contrato que o viewer 360 consome ([[sintese-contratos-congelados]]). Uniformizar quebra o cliente.

O `manifest.project.db_filename` é **aceito e ignorado** (`backend/src/modules/streetview360/sv360.merge.js:150-153`). O nome real é derivado no servidor como `${orgId}__${slug}.db`. Não relaxe isso por conveniência: sem o prefixo de org, um manifest malicioso aponta o store para o arquivo de outra OM e sobrescreve BLOBs alheios, e duas OMs com o mesmo slug (slug é único **por org**, não global) colidem no disco. Ver [[organizacoes-om]] e [[permissoes-atlas]].

O módulo está fora do sync/CRDT do atlas ([[sintese-modulos-fora-do-sync]], [[streetview-360]]): uma ingestão **não** gera broadcast WebSocket. O cliente só vê o projeto novo quando recarrega por REST. Não espere convergência automática entre usuários aqui.

## Armadilhas

> [!CONTRADICAO 2026-07-18 — RESOLVIDO 2026-07-24] `sv360.admin.service.js` e `scripts/sv360-import.js` descreviam o caminho online como "Postgres primeiro, swap depois". É o inverso: o swap do arquivo é o PASSO 1 e a transação do Postgres é o PASSO 2 (`backend/src/modules/streetview360/sv360.ingest.js:394`), e é exatamente por isso que o lock de ingestão é advisory e não transaction-scoped — um lock de transação seria tomado tarde demais para proteger o arquivo. Os dois comentários foram corrigidos.

> [!CONTRADICAO 2026-07-18 — RESOLVIDO 2026-07-24] A doc dizia que o arquivo escrito na ingestão é `{slug}.webp`; o disco guarda `{orgId}__{slug}.webp`, derivado de `db_filename`. A **URL** é slug-only (`/thumbnails/{slug}.webp`, contrato congelado) e o **arquivo** é org-keyed; a rota resolve um para o outro. Os comentários de `sv360.service.js` passaram a separar as duas coisas.

- **`tmpDir` em volume diferente de `dbDir` quebra a atomicidade do rename silenciosamente.** O código documenta a exigência (`backend/src/modules/streetview360/sv360.routes.js:47-48`) mas **não a valida**: em volumes distintos o rename vira cópia cross-device e deixa de ser atômico, sem erro algum. É checagem de deploy, não de código ([[deploy-backend]]).
- **Novo middleware de rejeição nessa rota precisa drenar o corpo.** `authDraining` e `requireUploadCapability` passam por `drainThen` (`backend/src/modules/streetview360/sv360.routes.js:241-257`) porque rejeitar sem ler o stream multipart fecha a conexão e o cliente vê `ECONNRESET` em vez do 4xx. Um middleware novo que faça `next(err)` direto reintroduz o bug para quem tomar 4xx.
- **O gate pré-multer é grosseiro, não é a checagem de posse.** `requireUploadCapability` (`backend/src/modules/streetview360/sv360.routes.js:265-272`) existe só para fechar o DoS de disk-fill autenticado (um viewer empurrando 2 GiB ao tmp antes de qualquer checagem, ver [[hardening-borda-api]] e [[upload-imagens-seguranca]]). A posse por organização continua em `resolveUploadOrgId` (`backend/src/modules/streetview360/sv360.admin.service.js:67-88`). Não confunda os dois nem remova um achando que o outro cobre.
- **O `fileFilter` aceita qualquer mimetype para `imagesDb`** (`backend/src/modules/streetview360/sv360.routes.js:81`). A defesa não é o mimetype, é o size-check estrutural posterior (`validateImagesDb`) mais o limite de bytes. Endurecer o mimetype aqui dá falsa sensação de segurança e quebra clientes que mandam `octet-stream`.
- **O size-check não é paranoia:** o ETag da imagem deriva do tamanho gravado no Postgres, sem ler o BLOB (O(1), [[sintese-cache-http-imutavel]]). Manifest e BLOB divergentes deixam o cache do cliente **permanentemente** errado, por isso divergência é 400 e não um warning.
- **Custo escondido no Windows:** se `blobPool.evict` não existir, o código degrada para `closeAll()` (`backend/src/modules/streetview360/sv360.ingest.js:146-154`), que derruba **todas** as conexões, inclusive as de assets 3D ([[assets3d-distribuicao]]). Correto, mas caro e com dano colateral fora do módulo.
- **Nada em cascade alcança `sv360.deleted_photos`.** A tabela é PK global **sem FK**, por decisão (`backend/src/database/migrations/005_sv360.sql:94-99`): o tombstone precisa sobreviver à foto. O preço atravessa o módulo inteiro: **toda** rota que remove fotos tem de purgar tombstone explicitamente, e como os ids são UUID v5 determinísticos (item abaixo) o bundle seguinte reinsere exatamente os mesmos ids. Esquecer a purga não gera erro nenhum: as linhas voltam ao Postgres e ficam **invisíveis em toda leitura**, porque todas filtram por `NOT EXISTS (deleted_photos)`. Já mordeu uma vez e está fechado em dois pontos independentes, o hard-delete de projeto (`backend/src/modules/streetview360/sv360.admin.service.js:209`, na mesma transação e **antes** do CASCADE, que de outro modo apagaria as fotos das quais a purga seleciona) e o merge, que purga a união dos ids atuais com os do manifest para curar também tombstone órfão (`backend/src/modules/streetview360/sv360.merge.js:176-183`). Rota de remoção nova reintroduz o defeito em silêncio. Consequência inversa, essa deliberada, em [[calibracao-e-grafo-360]]: uma foto apagada por REST volta a existir se o bundle seguinte não a trouxer em `deleted_photos[]`.
- Ids de foto são UUID **v5** e o backend só valida o formato, nunca recalcula (`backend/src/modules/streetview360/sv360.admin.schemas.js:31-33`). O determinismo é responsabilidade do estúdio, e é ele que torna a reingestão idempotente. Um estúdio que gere ids não determinísticos transforma cada reupload num 409 de collision guard.
- Não há trilha de auditoria de ingestão: `source` é só tag informativa (`backend/src/modules/streetview360/sv360.merge.js:134`). Ver [[auditoria]] para o que de fato é registrado.
- A URL base do módulo chega ao frontend pelo `/api/config` (`streetView360.serviceUrl`), ver [[config-runtime-urls-relativas]] e [[config-dinamico]].

## O ETL offline não é modelo para o caminho online

`scripts/sv360-import.js:324` reusa o mesmo `mergeProject`, mas mantém a cópia do arquivo **dentro** da transação, porque no import a frio não há leitores vivos. **Não replique essa ordem no caminho online**: lá o arquivo já está sendo servido, e é exatamente por isso que existe o protocolo evict/`.bak`/rename com rollback externo.

## Fontes
- `backend/src/modules/streetview360/`: `backend/src/modules/streetview360/sv360.routes.js` (multer, gates, drain), `backend/src/modules/streetview360/sv360.ingest.js` (validação, swap, lock), `backend/src/modules/streetview360/sv360.merge.js` (merge compartilhado), `backend/src/modules/streetview360/sv360.admin.service.js` (posse, thumbnail, status, hard-delete), `backend/src/modules/streetview360/sv360.admin.schemas.js` / `backend/src/modules/streetview360/sv360.admin.queries.js` (schema do manifest e SQL).
- `backend/src/config.js:69-81`: `SV360_DB_DIR`, `SV360_TMP_DIR`, `SV360_MAX_UPLOAD_BYTES`.
- `backend/scripts/sv360-import.js`: ETL offline, ordem de cópia deliberadamente diferente.
- guia *16-streetview-360* (absorvido): contrato público das rotas admin (§9).
