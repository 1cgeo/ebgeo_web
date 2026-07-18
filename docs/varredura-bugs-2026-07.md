# Varredura de Bugs do Backend — 2026-07-18

Varredura sistemática do backend (`ebgeo_backend`) por bugs de correção e
segurança, cobrindo todos os módulos em 5 frentes paralelas: auth/middleware,
sync/collab/WS, atlas/sharing/images, sv360/nomes/zones/catálogo, e
utils/db/config/audit. Cada achado foi verificado lendo o caminho de código de
ponta a ponta e cruzando com os testes existentes.

- **Baseline:** 1188 casos, 1 falha (teste dependente de plataforma).
- **Após correções:** 1213 casos, 0 falhas · `npm run lint` limpo.

Legenda de status:
- ✅ **Corrigido** neste branch (`claude/backend-bug-scan-h7wsuy`), com teste de regressão.
- ⏳ **Pendente** — real, porém exige decisão de produto/design ou mudança de maior escopo/risco; não alterado.

---

## Corrigidos

### 1. ✅ sv360 servia a imagem de foto com tombstone — ALTO (segurança / vazamento)

- **Arquivo:** `src/modules/streetview360/sv360.queries.js` (`GET_PHOTO_SIZES`), consumido por `sv360.service.js:getPhotoImageMeta`.
- **Bug:** `GET_PHOTO_SIZES` era a única read do sv360 sem excluir `sv360.deleted_photos`, então a imagem em resolução cheia de uma foto soft-deletada continuava a ser servida.
- **Cenário:** owner faz `DELETE /sv360/photos/:uuid` (204, tombstone; metadado passa a 404). Qualquer um — inclusive anônimo, pois o projeto está `enabled` — chama `GET /sv360/photos/:uuid/image?quality=full` e recebe a imagem 200. Contradiz o cabeçalho do próprio arquivo e a doc `16-streetview-360.md`.
- **Correção:** adicionado `AND NOT EXISTS (SELECT 1 FROM sv360.deleted_photos d WHERE d.photo_id = p.id)`.
- **Teste:** `tests/integration/sv360-write.test.js` — após o 204, `/image` (full/preview, owner e anônimo) deve 404.

### 2. ✅ Escalonamento de tenant via `PUT /users/me` — MÉDIO (segurança / IDOR de org)

- **Arquivo:** `src/modules/users/users.schemas.js` (`updateProfileSchema`).
- **Bug:** o schema self-service aceitava `organization_id`; o serviço gravava sem checagem de associação, permitindo um usuário comum se auto-mover para outra org.
- **Cenário:** usuário da org A envia `PUT /users/me {"organization_id":"<org-B>"}` → 200. No próximo `/auth/refresh`, o token carrega `organization_id = org B`; filtros SQL org-scoped (nomes, sv360, catálogo 3D) passam a retornar dados privados da org B.
- **Correção:** `organization_id` removido do schema (troca de tenant é admin-only, via `updateUserAdminSchema`). O serviço deixa a coluna inalterada quando o campo é ausente.
- **Teste:** `tests/integration/org-identity-gaps.test.js` — enviar `organization_id` no self-update não altera o tenant no banco.

### 3. ✅ `/nomes/busca` e `/feicoes` retornavam 500 com lat/lon fora de faixa — MÉDIO

- **Arquivo:** `src/modules/nomes/nomes.schemas.js` (`buscaSchema`, `feicoesSchema`).
- **Bug:** `lat`/`lon` validados só como `Joi.number()`; ambas as queries constroem um ponto `::geography`, que o PostGIS rejeita para `|lat|>90` / `|lon|>180` → 500 (no endpoint público anônimo `/busca`).
- **Cenário:** `GET /nomes/busca?q=rio&lat=999&lon=0` → 500 não tratado.
- **Correção:** `lat.min(-90).max(90)`, `lon.min(-180).max(180)` → 422 na borda.
- **Teste:** `tests/integration/nomes.test.js` — lat/lon fora de faixa em `/busca` e `/feicoes` retornam 422.

### 4. ✅ Seleção de usuário `manage` era descartada — MÉDIO

- **Arquivo:** `src/modules/collab/collab.handlers.js` (`handleSelection`).
- **Bug:** o gate `permission !== 'owner' && permission !== 'write'` silenciava a presença de seleção de um `manage` (co-Gestor), embora `manage` esteja **acima** de `write` na hierarquia e possa editar features.
- **Cenário:** atlas compartilhado em `manage`; o usuário conecta via WS e emite `selection` → peers nunca veem seu highlight, enquanto suas ops de edição passam normalmente.
- **Correção:** gate invertido para bloquear apenas `read`/`comment` (libera owner/manage/write).
- **Teste:** `tests/ws/collab-manage-selection.test.js` (novo) — seleção de `manage` é broadcast; de `read` não é.

### 5. ✅ `images` vazava `storage_path` na API — MÉDIO (segurança / info-disclosure)

- **Arquivo:** `src/modules/images/images.service.js` (`uploadImage`, `listImages`).
- **Bug:** as respostas retornavam a linha crua (`SELECT *`), expondo o caminho absoluto do FS (`storage_path`) a qualquer cliente com acesso `read`/público.
- **Cenário:** `GET /atlas/:id/images` (leitor) retornava `storage_path: "/var/app/uploads/images/<atlasId>/<uuid>.png"`.
- **Correção:** helper `toPublicImage` remove `storage_path` do payload; a coluna segue persistida no banco.
- **Teste:** `tests/integration/images.test.js` — upload/list não contêm `storage_path`, mas o banco sim.

### 6. ✅ `api_key` gravado em texto plano nos logs — MÉDIO (segurança)

- **Arquivo:** `src/middleware/request-logger.js`, `src/middleware/error-handler.js`.
- **Bug:** ambos logavam `req.url` cru, incluindo a query string; `?api_key=<uuid>` é um transporte de credencial suportado (`flexibleAuth`), então chaves M2M permanentes iam em claro para o pino a cada request.
- **Cenário:** `GET /api/v1/nomes/busca?api_key=<uuid>` → log com a chave em claro; qualquer 4xx/5xx repetia via error-handler.
- **Correção:** novo util `src/utils/redact-url.js` mascara `api_key`/`token`/`access_token`/`refresh_token`; aplicado nos dois middlewares.
- **Teste:** `tests/unit/redact-url.test.js` (novo).

### 7. ✅ Erros de cliente rotulados como `INTERNAL_ERROR` — BAIXO

- **Arquivo:** `src/middleware/error-handler.js`.
- **Bug:** erros não-`AppError` com `statusCode` 4xx (body-parser: `entity.parse.failed` 400, `entity.too.large` 413) recebiam o status certo mas `code: 'INTERNAL_ERROR'` e eram logados em nível `error` como falha de servidor.
- **Cenário:** POST com JSON malformado → `400 { error: { code: 'INTERNAL_ERROR' } }`.
- **Correção:** ramo dedicado mapeia 4xx não-AppError para código de cliente (`BAD_REQUEST`/`PAYLOAD_TOO_LARGE`); logging passa a `warn` para `<500`.
- **Teste:** `tests/unit/middleware-error-handler.test.js` — body-parser 400/413 mapeados corretamente.

### 8. ✅ Teste de path-traversal dependente de plataforma — (correção de teste)

- **Arquivo:** `tests/integration/nomes-catalogo3d-gaps.test.js` (assets3d-11).
- **Bug:** a asserção fixava 403, semântica de `path.resolve` do **Windows** (`\` como separador). No **Linux** `\` é caractere comum de nome de arquivo → o alvo fica dentro do ROOT e simplesmente não existe → 404. Era a única falha do baseline.
- **Segurança:** intacta em ambas as plataformas — o arquivo fora do ROOT nunca é servido (403 no Windows, 404 no POSIX).
- **Correção:** asserção tornada portável (nega acesso: 403 ou 404; nunca 200). A rota (`assets3d.service.js`) não foi alterada.

### 9. ✅ Sessão deslizava indefinidamente para usuário desativado/rebaixado — ALTO (segurança)

- **Arquivo:** `src/middleware/flexible-auth.js` (sliding renewal) + `src/middleware/auth.js` (path estrito).
- **Bug:** o sliding-session re-emitia um token de 15 min só a partir dos claims antigos, sem checagem no banco. Um usuário desativado (`is_active=false`, refresh revogado) que mantivesse requests em voo renovava a sessão **para sempre**; o `auth` estrito só checava `orgIsActive`, nunca `users.is_active`, e `requireAdmin` confiava no `role` do token → admin rebaixado mantinha `admin`.
- **Cenário:** admin desativa a conta do usuário X. X continua com o cookie e segue trabalhando; a cada request perto do vencimento o servidor re-assina o token → acesso indefinido.
- **Correção:** novo `getLiveAuthState()` (`src/utils/org-status.js`) reconcilia por request no `auth` estrito — `is_active=false` → 401, org inativa → 403, `role` global adotado do banco. O renewal consulta o mesmo estado e **limpa o cookie** numa sessão morta em vez de re-emitir. Custo: o lookup de PK que já existia (a query org-only virou um join), sem request extra.
- **Escopo deliberado:** `org_role`/`organization_id` continuam vindo do mapeamento do token (token legado sem claims de org ainda degrada para viewer/null — contrato pinado em `auth-gaps` auth-05), então **troca de tenant** segue limitada à janela de ≤15 min. Princípio público (`public-<uuid>`, sem linha em `users`) é isento — mesma convenção de id não-UUID já usada em `permissions.js`. Linha ausente em `users` **não** é revogação: o sistema só faz soft-delete, então (como em `orgIsActive` para org desconhecida) isso é anomalia, não desativação.
- **Teste:** `tests/integration/auth-live-reconciliation.test.js` (5 casos, incluindo o guarda de não-regressão "renewal continua funcionando para usuário saudável").

### 10. ✅ Ordem de versão em pushes de sync concorrentes — ALTO (perda de dados)

- **Arquivo:** `src/modules/sync/sync.service.js` (`pushOperations`).
- **Bug:** `server_version` vem de `nextval('atlas_version_seq')` no INSERT, mas a visibilidade é decidida no COMMIT, e a `tx()` não serializava por atlas. Com pushes concorrentes a ordem de versão podia divergir da ordem de commit e um puller incremental **perdia permanentemente** uma op comitada.
- **Cenário:** tx A insere (v100) e demora; tx B insere (v101) e comita; um puller vê v101 e grava `lastVersion=101`; A comita — sua op v100 está abaixo do cursor e o pull incremental (`WHERE server_version > $lastVersion`) nunca mais a retorna.
- **Correção:** `pg_advisory_xact_lock(SYNC_PUSH_LOCK_NAMESPACE, hashtext(atlasId))` no topo da transação, antes do primeiro INSERT. Escopo de transação (liberado no COMMIT/ROLLBACK, sem vazamento em erro) e por atlas, então pushes a atlas distintos seguem paralelos.
- **Teste:** `tests/integration/sync-push-serialization.test.js` — o push **bloqueia** enquanto outra transação segura o lock do atlas, **não** bloqueia para outro atlas, e nenhuma op é pulada pelo cursor incremental. *(O caso de bloqueio é o guarda real; o de "nenhuma op pulada" documenta a invariante mas não reproduz a corrida de forma determinística.)*

---

## Pendentes (reais, não alterados)

*(P1 e P2 foram corrigidos após a redação original — ver a seção "Corrigidos" acima, itens 9 e 10.)*

### P3. ⏳ Concorrência de ingestão sv360 (swap-then-commit) — MÉDIO

- **Arquivo:** `src/modules/streetview360/sv360.ingest.js:363-411` (`ingestBundle`).
- **Bug:** duas ingestões concorrentes do mesmo `(orgId, slug)` não são serializadas; o swap de arquivo (PASSO 1) roda antes da tx Postgres, então uploads interleaved podem deixar o `{slug}.db` em disco e o metadado Postgres apontando para bundles diferentes; um `rollbackSwap` pode ainda restaurar o `.bak` errado.
- **Correção sugerida:** `pg_advisory_xact_lock(hash(orgId||slug))` antes do PASSO 1, ou mutex por-chave em processo.

### P4. ⏳ Shutdown gracioso não fecha o servidor WS — MÉDIO

- **Arquivo:** `src/index.js:23-30`.
- **Bug:** o shutdown não fecha o `WebSocketServer` nem os clientes; com um socket collab aberto (longa duração por design), o callback de `server.close()` nunca dispara → `blobPool.closeAll()`, `pgp.end()` e `process.exit(0)` são pulados; o processo trava até SIGKILL (risco de handles SQLite abertos em restart no Windows).
- **Correção sugerida:** exportar `shutdown()` que fecha os clientes `wss`, com timer de force-exit.

### P5. ⏳ Worker morto no pool de BLOB SQLite nunca é reposto — MÉDIO

- **Arquivo:** `src/utils/sqlite-blob-pool.js:43-47,62`.
- **Bug:** quando um worker emite `'error'` (é terminado pelo Node), ele não é removido de `this.workers` nem respawnado; o round-robin segue mandando ~1/N das leituras para um worker morto (postMessage vira no-op) → promises que nunca resolvem, requests pendurados sem timeout. Além disso, o handler rejeita os pendings de **todos** os workers, não só do que caiu.
- **Correção sugerida:** dropar/respawnar o worker e rejeitar só os ids pendentes dele.

### P6. ⏳ `Cache-Control: public, immutable` em respostas sv360 dependentes de auth — MÉDIO

- **Arquivo:** `src/modules/streetview360/sv360.controller.js:26,46-51`.
- **Bug:** imagem/thumbnail são emitidos com `public, max-age=31536000, immutable` sem `Vary`; um cache compartilhado (CDN/proxy) pode cachear a resposta de um usuário autorizado e reentregar a um anônimo/não-autorizado (projeto `disabled`), ou envenenar o thumbnail de um slug com colisão cross-org.
- **Correção sugerida:** `private` (ou `Vary: Authorization, Cookie`) para respostas de projeto `disabled`; manter `public, immutable` só para `enabled`.

### P7. ⏳ `validateEnvVariables()` não valida a maioria das envs — MÉDIO

- **Arquivo:** `src/config.js:160-199`.
- **Bug:** só DATABASE_URL/JWT_SECRET/PORT/CORS_ORIGIN são validados; demais `parseInt` viram `NaN` silencioso com efeitos ruins: `MAX_BULK_UPLOAD_MB=abc` → `express.json({limit:'NaNmb'})` (sem limite de corpo); `WS_HEARTBEAT_INTERVAL_MS=abc` → `setInterval(NaN)` ≈ 1 ms (tempestade de queries); `JWT_REFRESH_EXPIRY=1w` → `parseDuration`=0 → todo refresh expira imediatamente.
- **Correção sugerida:** estender a validação fail-fast e garantir `parseDuration` > 0.

### P8. ⏳ `user_left` transmitido sem checar outros sockets do mesmo usuário — MÉDIO

- **Arquivo:** `src/modules/collab/collab.gateway.js:400-406`.
- **Bug:** `removeConnection` transmite `user_left` só por `userId`, sem verificar se o usuário ainda tem outro socket vivo na sala (reconexão com clientId novo, ou duas abas). Peers removem um usuário que continua online. `user_away`/`user_back` carregam `clientId`, mas `user_left` não.
- **Correção sugerida:** só emitir `user_left` quando for o último socket do usuário na sala, ou carregar `clientId`.

---

## Achados de baixo impacto (registro)

| # | Arquivo | Bug | Sev |
|---|---------|-----|-----|
| L1 | `sync.schemas.js:24-28` | `timestamp`/`clientId` opcionais no Joi, mas colunas `NOT NULL` → 500 em vez de 422 | baixo |
| L2 | `collab.gateway.js:165` | `WebSocketServer` sem `maxPayload` → aceita frames de até 100 MiB (10× o limite HTTP) antes de qualquer validação | baixo |
| L3 | `sync.service.js:645` vs `:253` | `entityId` sentinela (`'atlas'`) reescrito para o UUID do atlas no log, mas o broadcast carrega o sentinel → mesma op com `entityId` diferente por caminho | baixo |
| L4 | `auth.service.js:297-309` | `verifyEmail` faz mark + consume em duas `query()` (não `tx`) → token de verificação não é single-use sob concorrência | baixo |
| L5 | `environment.js:25` | `cookieOptions().maxAge` fixo em 15 min, mas `JWT_ACCESS_EXPIRY` é configurável → sessão de cookie quebra se a expiry for maior | baixo |
| L6 | `migrate.js:26-59` | runner de migração sem `pg_advisory_lock` → duas execuções concorrentes correm para aplicar a mesma migração | baixo |
| L7 | `optional-auth.js:10-24` | `optionalAuth` sobrescreve `req.user` (dead code hoje) → clobber da identidade de `flexibleAuth` se adotado | baixo |
| L8 | `sv360.write.service.js:117-122` | calibração PUT numa foto com tombstone persiste o UPDATE e depois responde 404 (inconsistente com o batch, que faz rollback) | baixo |
| L9 | `sv360.admin.schemas.js:169` | `orgId` validado como `uuidv4`, mas o org default `...0001` não é v4 → 422 ao escopar a lista admin para a org default | baixo |
| L10 | `sv360.queries.js:57-73` | `GET_PHOTO_BY_NAME` desempata só por `status='enabled'` (não pela org do chamador) → colisão de nome entre projetos disabled pode 404 para membro que tem a foto | baixo |
| L11 | `sv360-error.js:15-25` | handler sv360 não mapeia `23505` → 409 (vira 500), apesar do comentário na query afirmar o contrário | baixo |
| L12 | `catalog.service.js:31-71` | `GET /:id` retorna item soft-deletado (`active=false`); `COALESCE($n,col)` impede limpar `description` | baixo |
| L13 | `atlas.service.js:498-544` | rota de transferência de posse e sua query com filtro de acesso sem nenhum teste (positivo ou negativo) | cobertura |

> Nota: L1 (sync `timestamp`/`clientId` obrigatórios na borda) toca o envelope
> congelado de sync — vale um teste de contrato antes de alterar.
