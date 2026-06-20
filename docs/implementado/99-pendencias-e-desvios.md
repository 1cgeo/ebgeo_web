# 99 - Pendências e Desvios de Implementação

Este documento consolida, **por criticidade**, todas as pendências, follow-ups, decisões
conscientes (by-design) e divergências de contrato do backend EBGeo. É a referência única para
quem integra com a API saber o que **não** confiar que existe, o que é **advisory** (precisa ser
respeitado no frontend) e o que está **deferido** por decisão.

> **Nada aqui é bloqueante.** A suíte de testes está verde (`npm test`, ~745 casos cobrindo as
> Fases 0–9). Todos os fluxos documentados nos guias 01–10 funcionam como descrito. Os itens abaixo
> são limitações conhecidas, otimizações sob demanda, follow-ups intencionais ou contratos que o
> frontend já sabe acomodar — nenhum impede a integração nem quebra o caminho anônimo.

---

## Como ler este documento

Cada item tem quatro colunas:

- **Item** — o que falta / o que diverge.
- **Área / Subsistema** — onde vive (sync, WebSocket, gazetteer, sv360, identidade, etc.).
- **Natureza** — `aberto` (lacuna real sob demanda), `follow-up` (planejado, infra pronta),
  `by-design` (decisão consciente, não é defeito), `frontend` (responsabilidade do cliente).
- **Recomendação** — o que o integrador (ou um futuro maintainer) deve fazer.

Os buckets de criticidade refletem o impacto **para quem integra com o backend hoje**:

| Bucket | Significado |
|--------|-------------|
| 🔴 Alta / Bloqueante | Impediria a integração ou comprometeria segurança/consistência. **(Vazio — nada se enquadra.)** |
| 🟠 Média | Pode surpreender o integrador; exige tratamento explícito no frontend ou no deploy. |
| 🟡 Baixa | Otimização, cleanup ou lacuna de cobertura sem impacto funcional. |
| ⚪ By-design / decisão consciente | Comportamento intencional documentado; não mude esperando que vire defeito. |
| 🔵 Frontend (fora do backend) | A lógica vive no cliente (`ebgeo_web`); o backend já oferece o contrato. |

---

## Auditoria de consistência doc↔código — 2026-06-20

Revisão documento-a-documento dos guias `00`–`16` contra o código-fonte. Além das correções de
texto nos guias, os achados de **código** verificados foram tratados assim:

### Corrigido nesta auditoria

| Correção | Área | Antes → Depois |
|----------|------|----------------|
| **IDOR cross-atlas via sync** — `slide` (create/update/delete) e `group_feature` (create/delete) não escopavam pelo atlas da rota. Agora o filtro de atlas vive na própria query (slide via `briefings.atlas_id`; group_feature via `groups.map_id`→`maps.atlas_id`). Teste negativo em `tests/integration/sync-cross-atlas-access.test.js`. | Sync / segurança | escrita cross-atlas possível → **bloqueada na SQL** |
| Upload single acima do limite: `MulterError(LIMIT_FILE_SIZE)` agora mapeado por wrapper (`uploadSingleImage`) | Imagens / hardening | **500** → **400** |
| `POST /images/bulk` com limite de corpo dedicado `MAX_BULK_UPLOAD_MB` (default 50 MB) | Imagens | limite por-imagem inalcançável (413) → **alcançável** |
| `requireAdmin` sem credencial | Middleware | **403** → **401** (alinha `require-org-role`) |
| `GET /atlas/:id/sync/admin/stats` para atlas inexistente | Sync admin | **200 `data:null`** → **404** |
| `updateProfile`/`updateUser`: `null`/`''` em `posto_graduacao`/`organizacao_militar` | Users | `COALESCE` ignorava (no-op) → **limpa a coluna** |
| Upgrade WebSocket valida o `pathname` | Collab | qualquer path aceito → **só `/api/v1/collab`** |
| Log do gazetteer (Pino) | Nomes | logava `q`/coords crus → **só `queryKeys`** (valores sensíveis fora do log) |
| `images.mime_type` CHECK (migração **019**) | Schema | aceitava `svg+xml` → **alinhado à allowlist** (png/jpeg/webp) |
| Comentário do `orgScopeQuerySchema` | sv360 | dizia 400 → **422** (comportamento real) |

### Desvios mantidos (by-design / decisão consciente — **não** alterados)

| Desvio | Natureza | Por quê |
|--------|----------|---------|
| `POST /maps/:id/duplicate` e `POST /atlas/import` criam entidades colaborativas via REST **fora** do log CRDT (sem `op_id`) | by-design | São operações server-side de clonagem/import (análogas ao clone de atlas); não fazem parte do fluxo de edição colaborativa. Documentadas nos guias 02/08/09. |
| Hard-DELETE de `images` (com `unlink`) e de `atlas_shares` | by-design | Entidade binária secundária / tabela de associação (FK `ON DELETE CASCADE`); o princípio de soft-delete vale para a **entidade principal**. |
| `addUserShare` faz upsert e retorna **201** mesmo em re-compartilhamento | by-design | Idempotente; o status é mantido para não quebrar o contrato do frontend. |
| `truncateCoords` exportada/testada sem uso em `src/` | by-design | Utilitário transport-only reservado (coberto por teste unitário); **não** é dead code removível. |
| Ramo 403 anti-traversal em `assets3d` praticamente inalcançável | by-design | `path.posix.normalize` colapsa `..` para dentro da raiz → na prática **404**; o 403 fica como defesa em profundidade. Ver [14-catalogo3d-assets.md](./14-catalogo3d-assets.md). |

### Reconciliação de autorização: estado vivo vs. claims do JWT — 2026-06-20

A autorização derivava de estado **cacheado** (o payload do JWT, válido por `JWT_ACCESS_EXPIRY=15min`, ou
a permissão resolvida uma única vez no handshake WS) sem reconciliar com o banco. Tratamento por eixo:

| Item | Decisão | Comportamento as-built |
|------|---------|------------------------|
| **Desativação de organização** (`organizations.is_active=false`) | **corrigido (O1)** | Barra os membros **imediatamente**. `orgIsActive()` ([src/utils/org-status.js](../../src/utils/org-status.js)) é checado no `auth` **estrito** (rota protegida → 403), no `login` e no `refresh` (→ 403), e no handshake/heartbeat do WS. O caminho anônimo/`flexibleAuth` **não** é afetado. Custo: +1 lookup de PK por request de membro com `organization_id`. Teste: `organizations.test.js`. |
| **Permissão WS cacheada no handshake** | **corrigido (W1)** | `reconcileAuthorization()` ([collab.gateway.js](../../src/modules/collab/collab.gateway.js)) roda a cada tick de heartbeat (~30s): rebaixamento de share (write→read) atualiza `ws.permission` (a próxima escrita é recusada); revogação de share / atlas despublicado / org desativada **fecham** o socket (código `4003`). Janela limitada a ≤1 intervalo de heartbeat. Teste: `tests/ws/collab-reauthz.test.js`. |
| **Token de acesso vivo após desativação de usuário / rebaixamento de admin** | **aceito (by-design)** | Janela de **≤15 min** (TTL do access token). `login`/`refresh` já barram usuário inativo (`is_active`) e o `refresh` **relê o usuário do banco** → um admin rebaixado recebe o papel atual na próxima rotação. Optou-se por **não** rechecar `is_active`/`role` por request (custo de DB + caminho anônimo). Se precisar de corte sub-minuto para uma conta individual, encurte `JWT_ACCESS_EXPIRY` ou adicione a checagem de `is_active` no `auth` estrito (mesmo padrão do O1). |

---

## 🔴 Alta / Bloqueante

Nenhum item.

> Não há defeito de implementação aberto, nem lacuna que impeça a integração. As rotas estão
> montadas, as queries embutem o controle de acesso (defesa em profundidade), o swap de ingestão do
> 360 é atômico-no-commit, e os contratos congelados estão intactos. Se você encontrou algo que
> parece bloqueante, provavelmente é um dos itens "by-design" abaixo — verifique antes de tratar
> como bug.

---

## 🟠 Média

Itens que o frontend ou o operador de deploy precisa tratar explicitamente. **Nada aqui é defeito**,
mas ignorá-los leva a comportamento inesperado em produção.

| Item | Área / Subsistema | Natureza | Recomendação |
|------|-------------------|----------|--------------|
| **Mutações REST não emitiam broadcast WS** (histórico) — hoje `atlas_updated`/`atlas_settings_updated`/`atlas_deleted`/`sharing_updated`/`maps_merged`/`map_duplicated` **são** broadcast. O que **continua sem broadcast**: escrita do módulo `sv360` (calibração, targets, soft-delete) não notifica nenhum canal WS. | WebSocket / sv360 | by-design | O 360 está **fora** do sync/CRDT/WS do atlas. Após uma escrita 360, o frontend deve recarregar os metadados da foto (`GET /sv360/photos/:uuid`) — não espere um evento de tempo real. |
| **`locked` é advisory — o sync nunca bloqueia escrita** numa entidade (mapa/camada/grupo/feição) travada. O servidor armazena `locked` mas `buildUpdateQuery`/`buildSoftDeleteQuery` não o consultam antes de aplicar. | Sync / permissões | by-design | O frontend **deve** respeitar `locked` localmente (desabilitar edição). Não confie no servidor para recusar uma op sobre uma entidade travada — ele aceitará. |
| **Divergência de papéis:** o JWT carrega `role ∈ {user, admin}` (global) + `org_role ∈ {owner,editor,viewer,admin}`; a permissão **por atlas** é `owner/write/read`. O frontend usa `{owner, admin, editor, viewer}`. | Identidade / WebSocket | by-design | Use o campo **`role`** do evento `connected` do WS — o gateway já mapeia `owner→owner`, `write→editor`, `read→viewer`, `admin→admin` (`toFrontendRole`). O REST expõe `permission` (owner/write/read); derive o papel a partir dela. Ver [04-websocket-collab.md](./04-websocket-collab.md). |
| **Endpoints de admin de permissão de modelo 3D não existem** (`GET/PUT /api/v1/catalogo3d/:id/permissions`, `PATCH .../access-level`). A concessão de acesso a um modelo privado só é possível via INSERT direto em `ng.model_permissions`/`ng.model_group_permissions`. | Catálogo 3D / acesso geográfico | follow-up | **Não chame** essas rotas — elas retornam 404. A infra (tabelas, FK, filtro de leitura embutido no SQL) está pronta; gerenciar permissão de modelo hoje é tarefa de DBA/seed. |
| **Módulo de grupos/membresia não existe** (CRUD de `ng.groups` / `ng.user_groups`). O acesso via-grupo (catálogo 3D e zonas geográficas) **funciona** se as linhas forem inseridas no banco, mas não há rota para criar grupos ou gerir membresia. | Acesso geográfico / grupos | follow-up | Popule `ng.user_groups`/`ng.groups` por seed/DBA. O filtro de leitura já honra grupos; só falta a superfície de administração. |
| **Auditoria parcial dos fluxos destrutivos.** Auditados em `audit_trail`: `ORG_*`, `USER_DELETE`, `API_KEY_ROTATE`, `PERMISSION_GRANT`. **Não** auditados (apesar de estarem no CHECK da tabela): `LOGIN`/`LOGOUT`, `USER_CREATE`/`USER_UPDATE`/`PASSWORD_RESET`/`ROLE_CHANGE`, `ATLAS_DELETE`, `SHARING_CHANGE`. | Identidade / auditoria | follow-up | Se sua integração depende da trilha de auditoria (`GET /api/v1/audit`) para compliance, saiba que esses eventos **não** aparecem hoje. A infra está pronta (basta chamar `createAudit` nos controllers). |
| **Escala single-instance.** Salas, presença e cursores vivem em memória numa **única instância** (`collab.rooms.js`). Em deploy multi-instância, um usuário na instância A **não** vê cursores/broadcasts de um usuário na instância B. | WebSocket / deploy | aberto | Em produção use **sticky-session** no load balancer (todos os clientes de um atlas na mesma instância) até o Redis pub/sub (abaixo) ser implementado. Ver [../deploy/deploy.md](../deploy/deploy.md). |
| **Validação de boot das URLs de config não é estendida.** `validateEnvVariables()` valida `DATABASE_URL`/`JWT_SECRET`/`PORT`/`CORS_ORIGIN`, mas **não** alerta se `SEARCH_API_URL`/`SV360_SERVICE_URL`/`MAP3D_TERRAIN_URL` continuarem em `localhost`/default em produção. | Config / deploy | by-design | Ao fazer deploy, **confira manualmente** as URLs de serviço expostas em `GET /api/config`. Default público é intencional para dev/offline; não há fail-fast que o proteja de esquecer em prod. |

---

## 🟡 Baixa

Otimizações, cleanups e lacunas de cobertura. **Sem impacto funcional ou de contrato** para o
integrador.

| Item | Área / Subsistema | Natureza | Recomendação |
|------|-------------------|----------|--------------|
| **Índice GIN parcial de FTS sobre públicos não criado** (`idx_catalogo3d_public_fts`). Existe o GIN completo `idx_cat3d_search` e o parcial de id `idx_catalogo_3d_public`, mas não a versão parcial de `search_vector`. | Catálogo 3D / PostGIS | aberto | Otimização menor; o full-text já usa o GIN completo. Criar só se o volume do catálogo público exigir. |
| **`fn_user_can_see_model` (predicado de modelo) não foi extraída** — o predicado é um CTE inline duplicado em `CATALOGO_SELECT` e `CATALOGO_COUNT` (mantidos idênticos, mesmo arquivo). | Catálogo 3D | by-design | Cosmético. Se for editar o filtro de acesso ao catálogo, lembre de manter os dois CTEs sincronizados. |
| **`EnvironmentManager` não é a fonte única de cors/helmet.** `app.js` ainda monta `helmet({...})` e `cors({...})` inline; `env.helmetOptions()` não existe; `dbPoolMax()` existe mas não é consumido na conexão. | Boot / infra | by-design | Funcionalmente equivalente (mesmos valores). Cleanup interno, sem efeito observável na API. |
| **`validateEnvVariables` não cobre `COOKIE_SECRET`/`USE_HTTPS`.** Como o cookie-parser é montado **sem segredo** (cookies não são assinados), `COOKIE_SECRET` não é usado. | Boot / segurança | by-design | Nenhuma ação. A ausência é coerente com cookies não assinados. |
| **`flexibleAuth`/`authorize` ausentes no barrel `middleware/index.js`** (importados por caminho direto). | Middleware | by-design | Cosmético; funcionam normalmente. |
| **Logging multistream por categoria (`LogCategory`) não implementado.** `request-logger` loga `warn` para `status >= 400`, mas não marca `>1000ms` como `PERFORMANCE` nem 401/403 como `SECURITY`. | Logging / observabilidade | by-design | Logs estruturados Pino existem e bastam para integração. Categorização é nicety operacional deferida. |
| **`organization_id` permanece nullable; `organizacao_militar` (texto) preservada.** Tornar `organization_id NOT NULL` e dropar a coluna texto ficam para migração futura pós-validação. | Identidade / multi-org | by-design | Tokens legados (sem o claim) ainda validam (`org_role→viewer`, `organization_id→null`). Trate `organization_id` como possivelmente nulo. |
| **Janela residual de crash entre swap e commit na ingestão sv360.** Um crash entre o swap do `{slug}.db` e o commit do Postgres deixa arquivo-novo + metadados-velhos. | sv360 / ingestão | by-design | Benigno: fotos já anunciadas continuam servíveis; as novas só não aparecem até reingerir. O commit do Postgres é o ponto atômico. |
| **`fsync` best-effort na ingestão sv360** (no Windows precisa de handle `r+`; EPERM/EINVAL/ENOTSUP são engolidos). | sv360 / ingestão | by-design | A integridade é garantida pelo size-check de `validateImagesDb`, não pelo fsync. Nenhuma ação. |
| **Auditoria do upload sv360 é só pino-log** (a ação não está no CHECK fechado de `audit_trail`). | sv360 / auditoria | by-design | O upload de bundle 360 **não** aparece em `GET /api/v1/audit`. Auditar exigiria migração; deferido. |
| **Caso 503 do `/health` não tem teste automatizado** (difícil simular sem mock do banco; o caso 200 é testado). | Health / cobertura | by-design | O comportamento existe (`SELECT 1` → 503 se o banco cair). Apenas a asserção automatizada falta. |
| **Lacunas de cobertura pontuais** — rollback conjunto do `audit` em tx, CHECK de `role` rejeitando valor inválido, caminho de permissão por GRUPO no catálogo 3D, aliases `org`/`login` do JWT. O comportamento existe no código/banco; falta a asserção dedicada. | Diversos / cobertura | by-design | Sem impacto em integração. Adicionar testes é melhoria de robustez, não correção. |

---

## ⚪ By-design / decisão consciente

Comportamentos **intencionais** que parecem desvios à primeira vista. Não os trate como bugs nem
espere que mudem.

| Item | Área / Subsistema | Natureza | Recomendação |
|------|-------------------|----------|--------------|
| **CRDT real é LWW por ordem de chegada ao servidor, NÃO por timestamp.** O `applyOperation` aplica todo UPDATE incondicionalmente (`version + 1`, `updated_at = NOW()`) sem comparar `client_timestamp`. O módulo `src/crdt` (resolver por timestamp) **foi removido** — era código morto. | Sync / CRDT | by-design | O `timestamp` da op viaja e é devolvido, mas **não** decide o vencedor — quem chega por último no servidor vence. A idempotência é por `op_id`. Ver [05-sync-crdt.md](./05-sync-crdt.md). |
| **Viewport loading no atlas indisponível.** As feições do atlas são JSONB **sem PostGIS**; não há filtro espacial server-side (`ST_Intersects`). O pull traz o estado por versão, não por bounding box. | Sync / atlas | by-design / aberto (sob demanda) | O frontend carrega o snapshot completo e filtra localmente. Decisão de arquitetura "atlas é JSONB" — não se planeja introduzir PostGIS no schema do atlas. |
| **Rooms WS são por atlas, não por mapa.** Cursor/seleção/ops são broadcast para **todos** os conectados ao atlas, independente do mapa ativo. | WebSocket | by-design / aberto (P3) | O frontend deve **filtrar por `mapId`** ao exibir cursores/seleção. Sub-canais por mapa são um gap aberto P3 (otimização de tráfego). |
| **Endpoints do gazetteer/catálogo 3D exigem auth estrito** (`auth`), não `optionalAuth`. Anônimo recebe **401**, nunca chega ao SQL com `userId` null. | Gazetteer / catálogo 3D | by-design | O ramo "anônimo só vê público" existe como defesa em profundidade no SQL, mas **não é alcançável** por HTTP anônimo. Use sempre um token nessas rotas. |
| **`GET /api/v1/nomes/busca` responde array nu** (não `{ data: [...] }`). Contrato congelado. | Gazetteer | by-design (contrato congelado) | Consuma a resposta como array diretamente. Não envolva em `.data`. |
| **Rotas `sv360` respondem nuas** (objeto/array) e usam envelope de erro **plano** `{ "error": "..." }` — diferente do `{ error: { code, message } }` global. | sv360 | by-design (contrato congelado) | Trate o módulo 360 com parsing próprio: sucesso = objeto/array direto; erro = `{ error: "<msg>" }`. Ver [../../README.md](../../README.md). |
| **`previewThumbnail` no shape de `/photos/:uuid` é RELATIVO sem `/api/v1`** = `/thumbnails/{slug}.webp`. | sv360 | by-design (contrato congelado) | Concatene com `serviceUrl` (`<backend>/api/v1/sv360`) para obter a URL final. |
| **Calibração 360 valida só tipo/finitude, sem faixas numéricas** (bearing negativo/>360, escala 0, rotação negativa são aceitos). As colunas são `DOUBLE PRECISION`/`INTEGER` sem CHECK. | sv360 / calibração | by-design | Não envie `NaN`/`Infinity`/string (→ 422), mas qualquer número finito é aceito. O contrato congelado não documenta min/max; impor um limite chutado quebraria o contrato. |
| **`nearby`/`metadata`/`position` do 360 não são roteados.** Só `nearby` existe no service, sem rota; `metadata`/`position` não foram portados. | sv360 | by-design | Não dependa dessas rotas — não existem. A superfície as-built é a tabela de rotas do README/[09-admin.md](./09-admin.md). |
| **DELETE de projeto sv360 é HARD-delete** (não há tombstone de projeto). O "soft" equivalente é `PATCH .../status` com `disabled`. | sv360 / admin | by-design | Para ocultar sem destruir, use `PATCH status=disabled`. `DELETE` apaga linhas (CASCADE) e o `{slug}.db`. |
| **`db_filename` do 360 é derivado no servidor** (`${orgId}__{slug}.db`); o valor do manifest é ignorado. | sv360 / ingestão | by-design (segurança) | Isolamento cross-OM: duas orgs com o mesmo slug geram arquivos diferentes. O cliente não controla o nome do arquivo. |
| **CI no GitHub não existe** (`.github/workflows/` ausente). Descartado por opção. | DevOps | by-design | Rode `npm run lint` e `npm test` localmente / no hook de pré-commit. |
| **`docker-compose.yml` usa `postgis/postgis:16-3.4`** (não `postgres:16`). | DevOps | by-design | Necessário para PostGIS (Fases 3+). PostGIS é extensão untrusted (exige superusuário para `CREATE EXTENSION`). |
| **Bug de broadcast: o remetente HTTP não é excluído do broadcast** de ops (sem socket no contexto HTTP). | WebSocket / sync | by-design | O cliente ignora ops com `clientId` próprio. Garanta que o frontend filtra o eco da própria operação. |
| **Fase 7 (gateway 360 externo) foi superada.** Não há gateway NGREX externo, serviço `ebgeo_360`, prefixo `/api/360/` nem upstream `:8081`. O 360 é o módulo interno `sv360`. | Arquitetura / 360 | by-design | Aponte o frontend para `GET /api/config` → `streetView360.serviceUrl` (`<backend>/api/v1/sv360`). Não há serviço externo de 360. |

---

## 🔵 Frontend (fora do backend)

A lógica vive no cliente (`ebgeo_web`). O backend já oferece o contrato necessário; estes itens
**não exigem mudança no backend**.

| Item | Área / Subsistema | Natureza | Recomendação |
|------|-------------------|----------|--------------|
| **Cliente WebSocket** (transição ONLINE, `RemoteRepository`, fila offline, presença/UX). | WebSocket / colaboração | frontend | O contrato de backend está pronto e testado: handshake com `clientId`, `away`/`user_back`, ack/idempotência, broadcast, bounds. Ver [04-websocket-collab.md](./04-websocket-collab.md) e [08-offline-import.md](./08-offline-import.md). |
| **Aplicação de ops fora de ordem** (aplicar por `serverVersion` crescente; disparar `sync_request` ao detectar buraco). | Sync / colaboração | frontend | O backend garante a reconciliação via `sync_request`/pull. A ordenação e detecção de gap são lógica do cliente. |
| **Undo/Redo (Ctrl+Z/Y)** — gera operações inversas e envia via sync normal. | Sync | frontend | O backend já suporta create↔delete e update com dados anteriores. A pilha é local por usuário. |
| **Dados temporais por feição** (`temporalInicio`/`temporalFim`/`trajetoria`/flags/DTG) viajam dentro de `properties` (JSONB) numa op `feature` normal. | Sync / temporal | frontend / OK | Armazenados verbatim, sem mudança no backend. Inclua os campos em `properties`. |
| **Importação de arquivos geoespaciais** (GeoJSON/Shapefile/KML/KMZ/GPX/CSV) — parsing no frontend, que envia ops sync com as feições resultantes. | Import | frontend | Ver [08-offline-import.md](./08-offline-import.md). O backend recebe ops/atlas já parseados. |
| **Replay de mensagens WS perdidas** na reconexão. | WebSocket | frontend | Não há buffer server-side de mensagens perdidas. Após reconectar, envie `sync_request` com `lastVersion` para recuperar as ops. |
| **Adaptação de boot do frontend** (`fetch('/api/config')`) e leitura do style de ortoimagem. | Config | frontend | Fronteira de frontend. O backend expõe a config dinâmica em `GET /api/config` — ver [10-config.md](./10-config.md). |

---

## Resumo executivo

- **Bloqueante:** nenhum. Suíte verde (~745 testes), contratos congelados intactos, caminho anônimo
  preservado.
- **Para o integrador frontend, lembre-se de:** (1) respeitar `locked` localmente (advisory);
  (2) filtrar cursores/seleção por `mapId`; (3) ignorar o eco da própria op via `clientId`;
  (4) derivar o papel a partir de `permission`/`role` do evento `connected`; (5) recarregar
  metadados do 360 após escrita (sem broadcast WS); (6) parsear `sv360` com envelope plano.
- **Para o operador de deploy, lembre-se de:** (1) sticky-session no LB enquanto não há Redis;
  (2) conferir manualmente as `*_URL` de config em produção; (3) rodar `SELECT ng.refresh_busca();`
  após cada carga de nomes.
- **Follow-ups com infra pronta (só falta a superfície):** admin de permissão de modelo 3D,
  CRUD de grupos/membresia, auditoria completa dos fluxos destrutivos, Redis pub/sub.

---

## Referências

- [00 - Visão Geral](./00-visao-geral.md) — arquitetura final e decisões transversais.
- [03 - Sync Inicial](./03-sync-inicial.md) e [05 - Sync CRDT](./05-sync-crdt.md) — modelo de
  sync/CRDT (LWW-por-chegada, snapshot híbrido).
- [04 - WebSocket Colaboração](./04-websocket-collab.md) — protocolo WS, `connected.role`, rooms
  por atlas, presença.
- [08 - Offline e Import](./08-offline-import.md) — reconexão, fila offline, import.
- [09 - Administração](./09-admin.md) e [10 - Configuração](./10-config.md) — superfície admin e
  config dinâmica.
- [README.md](../../README.md) — referência completa (rotas, env, migrações, "Gaps Conhecidos").
- [deploy.md](../deploy/deploy.md) — sticky-session, stores/volumes, segurança, escala.
