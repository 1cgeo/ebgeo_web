# CLAUDE.md: EBGeo Backend

API REST + WebSocket (Node 20, ES Modules) do app de mapeamento geoespacial militar EBGeo:
auth JWT, persistência PostgreSQL/PostGIS, colaboração em tempo real e sync offline-first.

**Constraint fundamental:** o backend é **aditivo**, e a app deve funcionar idêntica para usuário
**não autenticado**. Nenhuma mudança pode quebrar o caminho anônimo nem os contratos congelados do
frontend. Isso vale para o LOGIN, não para a disponibilidade: o boot do frontend é **fail-fast** em
`GET /api/config` (fonte única de config/catálogo), então derrubar ou quebrar esse endpoint impede o
app de subir, e não existe fallback estático no cliente.

> Referência completa (rotas, env, migrações, permissões, protocolo WS, convenções detalhadas) está
> no **[README.md](README.md)**. Páginas por entidade e conceito em
> **[../docs/wiki/index.md](../docs/wiki/index.md)**, que não tem índice numérico: procure pelo nome
> da página. Deploy em **[../docs/wiki/deploy-backend.md](../docs/wiki/deploy-backend.md)**. Este
> arquivo é o contrato de comportamento; mantenha-o curto.

## Stack & layout

`Express 4` · `pg-promise` (SQL direto, sem ORM) · `ws` · `jsonwebtoken`+`bcrypt` · `joi` · `pino` ·
`better-sqlite3` (BLOBs 3D/360).

- `src/index.js` boot (HTTP + WS + `validateEnvVariables()` fail-fast) · `src/app.js` factory `createApp()` (testável)
- `src/config.js` env · `src/database/` (`query`/`tx`, `migrate.js`, `migrations/`) · `src/middleware/` · `src/utils/`
- `src/modules/<nome>/`: um `ls src/modules/` é a lista autoritativa, e não reponha aqui a enumeração que já morou nesta linha, porque ela envelheceu errada nos dois sentidos (listava módulo inexistente e omitia um inteiro). O único que não se adivinha: `debug` é o endpoint do SyncLedger e só é montado com o tracer ligado (test/dev).

## Comandos

```bash
npm run dev            # node --watch
npm run db:migrate     # aplica migrações | npm run db:seed
npm test               # cria DB ebgeo_test → migra → roda → dropa (unit+integration+ws). Sem
                       #   argumento auto-eleva para c8 e verifica o PISO de cobertura; com
                       #   argumento não, e o runner usa só o PRIMEIRO pattern que receber.
npm run test:unit | test:integration | test:ws   # subconjuntos
npm run test:keep-db   # mantém o DB p/ debug
npm run test:fast -- tests/integration/x.test.js  # laço apertado: reaproveita o banco
npm run lint           # probe das regras próprias + eslint (rode antes de finalizar) | npm run format
```

- `npm test` é hermético (cria/dropa `ebgeo_test`). **PostGIS** é extensão *untrusted*: o runner
  pré-cria as extensões via `SUPERUSER_DATABASE_URL` (default `postgres:postgres@localhost`); sem um
  superusuário acessível os testes que usam `ng`/`sv360` falham.
- `test:fast` (`--reuse-db`) **exige um alvo** e recusa rodar a suíte inteira, de propósito: ele
  troca a hermeticidade por tempo, e a rodada que vale antes do commit não pode fazer esse
  câmbio. O banco reaproveitado carrega dado das rodadas anteriores, então **vermelho ali se
  confirma sem a bandeira antes de virar diagnóstico**. Ele ainda aplica migração pendente, que é o
  que impede o atalho de virar "rápido contra o schema velho". Números medidos em 2026-08-16 estão
  no comentário de `scripts/run-tests.js`, e o principal é negativo: o ciclo de banco custa ~1,2 s,
  não os 40 s que a intuição atribuía a ele. Laço lento não se otimiza por palpite.
- Testes batem no `app` exportado via **supertest** (não sobem servidor); WS em `tests/ws/`.

## Decisões de arquitetura: NÃO violar (e o porquê)

- **Escrita INCREMENTAL de entidade colaborativa é só via sync** (`POST /atlas/:id/sync` ou WS
  `operation`). **Não crie rotas REST de escrita** para feature/group/layer/map/briefing/slide/
  cesium3d/streetview360: elas viajam como operações. `briefings` é de fato GET-only; `maps`
  **não é**, e QUATRO exceções estruturais são deliberadas.
  - `POST /maps/:mapId/merge` (`backend/src/modules/maps/maps.routes.js`, `manage`): re-parenteia
    seis tabelas filhas.
  - `POST /atlas/import` (`backend/src/modules/atlas/atlas.routes.js`): cria atlas inteiro a partir
    de um `.ebgeo`.
  - `POST /atlas/:atlasId/maps/:mapId/duplicate` (`backend/src/modules/atlas/atlas.routes.js`, `write`).
  - `POST /atlas/:atlasId/clone` (`backend/src/modules/atlas/atlas.routes.js`, `read` na ORIGEM):
    `cloneAtlas` copia imagens, mapas, sub-entidades, briefings e slides para um atlas NOVO, do
    chamador. Gate de leitura porque o efeito não toca a origem; o destino nasce do requisitante.

  Esta lista disse "três" e omitiu o `clone` por tempo suficiente para a contagem virar premissa,
  enquanto o `clone` tem método no cliente (`apiClient.cloneAtlas`) e cinco arquivos de teste. E as
  três primeiras eram citadas por `arquivo:linha` sem o caminho, forma que o guarda de doc **não
  consegue** verificar: sua regex de caminho exige ao menos uma barra, então `atlas.routes.js:44`
  escapava da checagem e seguiu apontando para linha em branco depois que a rota andou. Cite o
  caminho inteiro, sem número de linha.

  O que as quatro têm em comum, e é o critério real: são operações de ENTIDADE INTEIRA, cujo efeito
  não é representável como uma sequência de ops incrementais. Duas armadilhas conhecidas: escrita
  por REST não avança `atlas.current_version`, então o peer offline não recebe nada no replay (o
  merge resolve isso emitindo uma op MARCADORA na mesma transação); e o gate do merge protege uma
  rota que **este** cliente não chama, porque ele combina localmente e sincroniza como ops comuns, com o
  gate real em `map.manager.combineSelectedMapsIntoTarget`. Os dois precisam continuar alinhados.
- **Conflito = LWW por ordem de chegada** (NÃO por timestamp); idempotência por `op_id`
  (`ON CONFLICT DO NOTHING`). O módulo `src/crdt` (LWW-por-timestamp) foi **removido**; não religar
  sem requisito de produto.
- **Geometria do atlas é JSONB** (schema `public`, mesmo formato do IndexedDB). **PostGIS vive só nos
  schemas `ng`** (nomes/edificações/catálogo 3D) **e `sv360`**. **Nunca** adicione PostGIS ao schema
  do atlas (decisão: filtro espacial do atlas seria bbox em JS, não `ST_Intersects`).
- **Controle de acesso embutido na query SQL** (`ng`/`sv360`): o dado privado não vaza nem com bug de
  app. Toda query com filtro de acesso **exige um teste negativo** (usuário sem permissão não vê).
- **Permissão por atlas tem CINCO níveis**: `read < comment < write < manage < owner`
  (`PERMISSION_LEVELS` em `middleware/permissions.js`; `owner` é sintetizado de `atlas.owner_id`, o
  CHECK da coluna é `read|comment|write|manage`). Sempre gate pela **hierarquia** ou por
  `requireAtlasPermission`. **Nunca** escreva uma lista fechada tipo
  `permission === 'write' || permission === 'owner'`: isso exclui o `manage` (co-Gestor), que está
  *acima* de `write`, e foi exatamente assim que a presença de seleção do co-Gestor foi silenciada.
- **Soft-delete sempre** (`deleted_at`, ou `is_active` p/ usuários; tombstone p/ fotos 360). **Nunca**
  faça hard-DELETE de entidade principal. `atlas.owner_id`/`images.uploaded_by`/`atlas_shares.added_by`
  são FK **sem `ON DELETE`** → reatribua (`?transferTo`) antes de qualquer hard-delete de usuário.
- **Contratos congelados do frontend**: mudar o *shape* exige teste de contrato e alinhamento:
  `GET /api/config` (config.js), `GET /nomes/busca` (array nu), metadado de foto `sv360` (câmera plana,
  `previewThumbnail` relativo), envelope de operação de sync, e o snapshot (estrutura idêntica ao IndexedDB).
- **Identidade = JWT de emissor único**: `sub`, `role ∈ {user,admin}` (global), `organization_id`,
  `org_role ∈ {owner,editor,viewer,admin}` + aliases `org`/`login`. Tokens legados degradam
  (`org_role→viewer`, `organization_id→null`). `flexibleAuth` é global e **não-bloqueante** (Bearer/cookie/
  `x-api-key`, preserva anônimo); rotas de escrita usam o middleware `auth` **estrito** (401 sem token).
  `flexibleAuth` faz **sliding session**: renova o cookie `token` quando faltam <5 min p/ expirar.
- **Lifecycle de socket de colaboração é CLIENT-DRIVEN** (contrato p/ o frontend): `auth.logout` só revoga o
  refresh token, e **não** fecha sockets de `collab` nem limpa presença. Um socket só cai (a) quando o cliente
  fecha a conexão / envia `leave`, ou (b) quando o sweep de heartbeat (~30s, `reconcileAuthorization`)
  reconcilia **autorização** (share revogado / atlas despublicado / org desativada), e ele **não** reage à
  revogação do refresh token. Há **um socket por `atlasId`** (sem mensagem de "switch"): trocar de atlas =
  abrir nova conexão e fechar a anterior pelo cliente.
- **`sv360` está FORA do sync/CRDT/WS** do atlas: BLOBs WebP em SQLite por projeto (`{slug}.db`, worker
  pool + ETag O(1) + semáforo), erros em envelope **plano** `{ error }` (não `{error:{code,message}}`),
  `db_filename` **derivado no servidor** (`${orgId}__{slug}.db`), ingestão swap-then-commit. Detalhes em
  [[streetview-360]] e [[ingestao-projetos-360]], ambas em [`../docs/wiki/`](../docs/wiki/index.md).
  Ao citar doc, use wikilink ou caminho entre crases: caminho nu em prosa é ponto cego dos DOIS
  guardas de integridade ao mesmo tempo, e foi assim que um ponteiro para uma pasta inexistente
  sobreviveu aqui.

## Convenções de código

- **Um arquivo por responsabilidade** no módulo (referência: `src/modules/atlas/`):
  `.routes.js` (só rotas, ordem `[auth, requireAtlasPermission, validate, ctrl]`) · `.controller.js`
  (HTTP, sempre `asyncHandler`, lê `req`, escreve `res.json({ data })`/`201`/`204`) · `.service.js`
  (toda a lógica) · `.queries.js` (SQL `UPPER_SNAKE`, `$1..$n`) · `.schemas.js` (Joi) · `index.js` (re-export).
- **Validação Joi na borda** (`validate({ body })` na rota), nunca no controller. Toda rota de escrita valida.
- **Erros**: lance subclasses de `AppError` (`NotFoundError`404 · `ForbiddenError`403 ·
  `UnauthorizedError`401 · `ConflictError`409 · `ValidationError`422 · `BadRequestError`400); o
  `errorHandler` (último em `app.js`) mapeia e mascara stack em prod. Sem try/catch por rota (`asyncHandler`).
- **DB**: `query()` retorna `{ rows }`; `one/any/none` e os `t.*` retornam **direto**. Multi-query
  atômica via `tx(async t => …)`, e **passe o `t`** às chamadas internas (inclusive `createAudit(req, p, t)`).
- **SQL 100% parametrizado**; `SET` dinâmico só a partir de **whitelist de colunas**, nunca de input.
- **Mutação colaborativa faz broadcast WS** após a escrita e antes do `res` (`atlas_updated`,
  `operations`, etc.).

## Migrações

`src/database/migrations/NNN_*.sql`, ordem alfabética, tracking em `_migrations`, **forward-only**,
**aditivas** (`ADD COLUMN DEFAULT`/`CREATE TABLE/INDEX`). Use o **próximo número livre**, e descubra
qual é com `ls src/database/migrations/`, nunca por esta linha: ela já afirmou um head duas vezes, e
das duas estava desatualizada, porque número fixo em prosa envelhece a cada migração.
`gen_random_uuid()` para PKs (não `uuid_generate_v4`). Migração que mexe em PostGIS precisa de superusuário.

## Segurança (baseline)

SQL parametrizado · rate limit nas rotas sensíveis de `/auth` (um limiter POR ROTA, nunca uma
instância compartilhada: a chave de `authLimiter` inclui o `username`, que só existe no schema de
duas delas) e em `/atlas/public/:link` · bcrypt
custo 12 + login timing-safe + rotação/detecção-de-reuso de refresh · `jwt.verify` **só HS256** · upload
allowlist `png/jpeg/webp` + magic-bytes (**sem SVG**), download como `attachment` · helmet CSP/HSTS ·
self-registration gateada por `ALLOW_SELF_REGISTRATION` (off em prod).

## SyncLedger (observabilidade de sync, test/dev)

Camada de tracing **aditiva e gated**, com três invariantes que o código sozinho não anuncia:

- **Nunca em produção**, e a garantia é uma **conjunção** no ponto de montagem (`isTraceEnabled() && !config.isProd`, `src/app.js`). O segundo termo existe para o caso de `EBGEO_TRACE=1` vazar para um ambiente de prod: o tracer liga e as rotas continuam desmontadas.
- **`GET/DELETE /api/v1/debug/trace` é gateado POR ATLAS**, não só por `auth`: o anel é por atlas, e `liftAtlasIdToParams` sobe o `atlasId` do query (400 se faltar) antes de `requireAtlasPermission`. Tratar o anel como recurso global já foi um wipe cross-atlas por qualquer portador de token.
- **O `traceId` sobrevive por duas condições no `sync.schemas`** (Joi `.unknown(true)` **e** campo explícito). Perder qualquer uma degrada o ledger em silêncio: nenhum teste fica vermelho, só a correlação por gesto some.

`utils/sync-trace.js` é o espelho do contrato de estágios do frontend e os dois lados andam em lockstep. Armadilhas de leitura e as fontes: [`../docs/wiki/syncledger.md`](../docs/wiki/syncledger.md).

## Antes de finalizar

`npm run lint` limpo e `npm test` verde (unit+integration+ws). Toda mudança de schema/sync precisa de
teste de regressão; todo filtro de acesso precisa de teste com usuário **sem** permissão. Atualize o
`README.md`/doc as-built relevante se o comportamento documentado mudou.
