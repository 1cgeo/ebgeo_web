# 99 - Pendências e Desvios de Implementação

Este documento consolida, **por criticidade**, todas as pendências, follow-ups, decisões
conscientes (by-design) e divergências de contrato do backend EBGeo. É a referência única para
quem integra com a API saber o que **não** confiar que existe, o que é **advisory** (precisa ser
respeitado no frontend) e o que está **deferido** por decisão.

> **Nada aqui é bloqueante.** A suíte de testes está verde (`npm test`, ~1159 casos cobrindo as
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
| `requireAdmin` sem credencial | Middleware | **403** → **401** (auth ausente → 401, não 403) |
| `GET /atlas/:id/sync/admin/stats` para atlas inexistente | Sync admin | **200 `data:null`** → **404** |
| `updateProfile`/`updateUser`: `null`/`''` em `posto_graduacao`/`organizacao_militar` | Users | `COALESCE` ignorava (no-op) → **limpa a coluna** |
| Upgrade WebSocket valida o `pathname` | Collab | qualquer path aceito → **só `/api/v1/collab`** |
| Log do gazetteer (Pino) | Nomes | logava `q`/coords crus → **só `queryKeys`** (valores sensíveis fora do log) |
| `images.mime_type` CHECK (baseline `002_atlas`) | Schema | aceitava `svg+xml` → **alinhado à allowlist** (png/jpeg/webp) |
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
| **Token de acesso vivo após desativação de usuário / rebaixamento de admin** | **corrigido (P1)** — *era "aceito (by-design)"* | A premissa da aceitação era a janela **limitada** de ≤15 min, mas o **sliding renewal** do `flexibleAuth` re-assinava os claims antigos sem consultar o banco, tornando a janela **ilimitada**: um usuário desativado que mantivesse requests em voo renovava a sessão para sempre. Agora `getLiveAuthState()` ([src/utils/org-status.js](../../src/utils/org-status.js)) reconcilia por request no `auth` **estrito**: `is_active=false` → **401**, org inativa → **403**, e o **`role` global** passa a vir do banco (um admin rebaixado perde `requireAdmin` na hora). O renewal consulta o mesmo estado e, para sessão morta, **limpa o cookie** em vez de re-emitir. Custo: o lookup de PK que já existia (a query org-only foi substituída por um join), sem request extra. **Escopo deliberado:** `org_role`/`organization_id` continuam vindo do mapeamento do token (um token legado sem claims de org ainda degrada para viewer/null — `auth-gaps` auth-05), então **troca de tenant** segue limitada à janela de ≤15 min. Linha sem `users` **não** é revogação (usuários só sofrem soft-delete) — só `is_active=false` barra. Teste: `auth-live-reconciliation.test.js`. |

---

## Reconciliação do envelope de sync com o frontend ebgeo_web — 2026-06-20

Revisão multiagente do backend contra o store/sync **real** do frontend (`ebgeo_web/src/js/store/*`),
o `config.js` e `docs/acoes-interface-multiusuario.md`. Os achados de **código** do lado backend foram
tratados assim — todos **aditivos / backward-compatible** (suíte verde, +9 testes):

### Corrigido (backend)

| Correção | Área | Antes → Depois | Teste |
|----------|------|----------------|-------|
| **Envelope 3D/360 plano** — o store emite a entidade achatada em camelCase (`{ id, tilesetId\|photoName, position, … }`); o apply lia `data.data`/`tileset_id` aninhado → `tileset_id` NULL e `data` `{}`. `normalizeOperation` agora reagrupa o shape plano para `{ data_type, tileset_id\|photo_name, data }` (o aninhado continua aceito). | Sync / 3D-360 | payload perdido → **round-trip** | `sync-frontend-envelope.test.js` |
| **Update com payload em `data`** — o factory do frontend nunca produz `changes`; o apply de update lia só `op.changes` → no-op silencioso com ack falso. Fallback `changes ?? data` no `update`. | Sync | perda de dados silenciosa → **aplica** | idem |
| **Feature como GeoJSON cru** — tipo em `properties.source`, camada em `properties.layerId`. Create/update deriva `feature_type`/`layer_id` quando ausentes no topo de `data`. | Sync / feature | create falhava / tipo nulo → **persiste** | idem |
| **`lamportTimestamp`** persistido (`operations.lamport_timestamp`, baseline `003_sync.sql`) e ecoado no pull incremental (`toFrontendOperation`). O broadcast WS já ecoava a op crua. | Sync / clock | descartado → **ecoado** | idem |
| **Slide `temporal_cursor` (v2.2)** — coluna no baseline `002_atlas.sql`, gravada no create/update e devolvida no snapshot como `temporalCursor` (+ `order` + `sync` por slide). | Sync / briefing | campo descartado → **round-trip** | idem |
| **`GET /nomes/busca` anônimo** — removido o `auth` estrito; o SQL filtra acesso embutido (`userId` null → só públicos). | Gazetteer | 401 anônimo → **200 público** | `nomes-access.test.js` (negativo: privado oculto p/ anônimo) |
| Erro de doc: chave `localStorage` do `clientId` (`ebgeo.clientId` → `ebgeo_client_id`) no guia 04. | Doc | — | — |
| **Isolamento de sub-op de mapa** — um update sub-tipado (mapTemporal/gridStyle/mapNotes/baseLayer/mapPosition) agora só toca a(s) coluna(s) do seu sub-tipo (`MAP_SUBTYPE_FIELDS`); uma coluna-irmã contrabandeada (ex.: `name` junto do `temporal_config`) é **descartada**. | Sync / mapa | sibling-column smuggling → **bloqueado** | `tests/integration/sync-map-subentity-isolation.test.js` |
| **Autorização por op + lock de mapa imposto** — map-delete/lock exigem owner (403); mapa locked bloqueia escrita de entidades-filhas (409). | Sync / permissões | advisory → **imposto** | `tests/integration/sync-authz-lock.test.js` |
| **Cascata de delete de camada (§2.2)** — deletar uma camada via sync soft-deleta todas as suas feições no MESMO tx (antes só a linha da camada). | Sync / camadas | feições órfãs → **cascata atômica** | `tests/integration/sync-layer-cascade.test.js` |
| **Atomicidade do push (§29.12 reagendar / §2.19/§2.23 delete em lote / §18.6 deletar coluna)** — um push = um `tx`; lotes destrutivos enviados num único `operations[]` são all-or-nothing (um op que falha reverte o lote inteiro + o log). | Sync | — | `tests/integration/sync-batch-atomicity.test.js` |
| **Settings de atlas §24.8 (terrainExaggeration)** — a op `setting` mescla um whitelist em `atlas.settings` (nunca chaves de recurso); antes era no-op com ack falso. No frontend o modal emite a op e o `remote-operation-handler` aplica ao terreno em tempo real. | Sync / atlas | no-op falso → **persiste + aplica** | `sync-atlas-settings.test.js` (BE) · `remote-setting-op.test.js` (FE) |

### Deferido (precisa de superfície/decisão do frontend — **não** alterado)

| Item | Por quê deferido |
|------|------------------|
| **Autorização por tipo de operação** + **lock de mapa imposto no servidor** | **IMPLEMENTADO (2026-06-20).** `pushOperations` recebe a permissão resolvida (`req.atlasPermission` / `ws.permission`): `map` **delete** e flip de `locked` exigem **owner** (403 p/ write); um mapa **locked** bloqueia mutações de entidades-filhas (feature/layer/group/cesium3d/streetview360/catalog → 409). Testes negativos em `tests/integration/sync-authz-lock.test.js`. |
| **Atlas `lastActiveMapId` / `schemaVersion`** | Já existe op atlas-level: a op `setting` mescla um **whitelist** em `atlas.settings` (hoje só `terrainExaggeration` §24.8 — ver "Corrigido"). `lastActiveMapId`/`schemaVersion` seguem **local/cliente** (fora do whitelist); para sincronizá-los, adicione-os ao whitelist do handler `setting` em `sync.service.js`. |
| **`mapBadgeColors` / `color_usage`** | Sem `entityType` no store do frontend para sincronizá-los — precisa de uma op nova **no cliente** primeiro. |
| **`customIcons` (registry + blobs)** | Vivem só no IndexedDB + `.ebgeo`. Exige endpoint de upload + entidade de sync + coordenação com o frontend — escopo maior que ajuste de backend. |
| **Fotos base64 em `feature.properties` vs limite de 10 MB do corpo** | A correção real é o frontend subir a foto pelo endpoint de imagens e referenciá-la, não embutir base64. Subir o limite tem implicação de segurança. |
| **SVG/GIF no `.ebgeo` / validadores do frontend** | A allowlist do backend (`png/jpeg/webp`, sem SVG) é baseline de segurança deliberada; o ajuste é no validador do **frontend**. |

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
| **Lock de MAPA é imposto no servidor (2026-06-20)** — um mapa `locked=true` faz o sync **recusar (409)** qualquer mutação de entidade-filha (feature/layer/group/cesium3d/streetview360/catalog). Flip de `locked` e delete de mapa exigem **owner** (403 p/ write). **Pendência:** lock de camada/grupo/feição **individual** (com o mapa destravado) ainda é advisory — só o lock de MAPA é imposto. | Sync / permissões | parcial | Lock de MAPA já é garantido pelo servidor; o frontend ainda deve refletir lock de camada/grupo/feição individual localmente. Ver `tests/integration/sync-authz-lock.test.js`. |
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
| **`GET /nomes/busca` aceita anônimo** (sem `auth` estrito; o `flexibleAuth` global popula `req.user` quando há credencial). **`/feicoes` e `/catalogo3d` continuam** com `auth` estrito (401 sem token). | Gazetteer / catálogo 3D | by-design | Em `busca`, o ramo "anônimo só vê público" do SQL **é** alcançável (`userId` null → só públicos; teste negativo em `nomes-access.test.js`). Em `/feicoes` e `/catalogo3d`, use sempre um token. |
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

- **Bloqueante:** nenhum. Suíte verde (~1140 testes), contratos congelados intactos, caminho anônimo
  preservado.
- **Para o integrador frontend, lembre-se de:** (1) lock de MAPA já é imposto no servidor (409); refletir lock de camada/grupo/feição **individual** localmente (advisory);
  (2) filtrar cursores/seleção por `mapId`; (3) ignorar o eco da própria op via `clientId`;
  (4) derivar o papel a partir de `permission`/`role` do evento `connected`; (5) recarregar
  metadados do 360 após escrita (sem broadcast WS); (6) parsear `sv360` com envelope plano.
- **Para o operador de deploy, lembre-se de:** (1) sticky-session no LB enquanto não há Redis;
  (2) conferir manualmente as `*_URL` de config em produção; (3) rodar `SELECT ng.refresh_busca();`
  após cada carga de nomes.
- **Follow-ups com infra pronta (só falta a superfície):** admin de permissão de modelo 3D,
  CRUD de grupos/membresia, auditoria completa dos fluxos destrutivos, Redis pub/sub.

---

---

## Varredura de bugs do backend — 2026-07-18

Varredura sistemática por bugs de correção/segurança em 5 frentes (auth/middleware,
sync/collab/WS, atlas/sharing/images, sv360/nomes/zones/catálogo, utils/db/config/audit).

**Todas as pendências levantadas (P1–P8) foram corrigidas**, cada uma com teste de
regressão — ver o histórico git (`fix(backend): corrige bugs de segurança/correção`,
`fix(error-handler): …`, `fix(auth,sync): … (P1) + … (P2)`, `fix(backend): corrige P3–P8`).
P1 e P2 estão documentadas nas seções acima (reconciliação de autorização e sync);
P3–P8 e os achados de baixo impacto L1–L13 nas tabelas abaixo. **Nenhum item da
varredura permanece em aberto.**

### Pendências P3–P8 — **corrigidas**

Todas as seis foram corrigidas, cada uma com teste de regressão (controle negativo:
revertendo os fixes com os testes presentes, apenas os testes correspondentes falham).

| # | Área | Bug | Correção | Teste |
|---|------|-----|----------|-------|
| P3 | Ingestão sv360 | Duas ingestões concorrentes do mesmo `(orgId, slug)` não eram serializadas; o swap de arquivo roda **antes** da tx Postgres, então uploads interleaved podiam deixar disco e metadado apontando para bundles diferentes, com `rollbackSwap` restaurando o `.bak` errado. | Advisory lock de **sessão** (`pg_advisory_lock`, namespace `S360`) numa conexão dedicada via `task()`, cobrindo swap **e** tx; liberado em `finally` (e pelo Postgres se a conexão cair, então um crash não trava o slug). Lock de transação não serviria: seria tarde demais para o swap. | `sv360-ingest-serialization.test.js` |
| P4 | Shutdown | O shutdown não fechava o `WebSocketServer` nem os clientes; com um socket collab aberto (longa duração por design) o callback de `server.close()` nunca disparava → `blobPool.closeAll()`, `pgp.end()` e `process.exit(0)` pulados; processo travado até SIGKILL. | `closeAllSockets()` (collab.gateway) fecha os clientes com **1001 going-away** e o `wss`; `shutdown()` chama isso **antes** de `server.close()`, com timer de force-exit de 10s e guarda de reentrada. | `collab-shutdown-presence.test.js` |
| P5 | Pool SQLite | Worker que emitia `'error'` continuava em `this.workers`; o round-robin seguia mandando ~1/N das leituras para uma thread morta (`postMessage` vira no-op) → promises pendentes **para sempre** (não há timeout de request). O handler ainda rejeitava os pendings de todos os outros workers, saudáveis. | Cada request registra o worker dono; na morte, só os pendings dele são rejeitados, ele sai da rotação e um substituto é spawnado. Um evict em voo é contabilizado como concluído para o worker morto (senão `evict()` nunca resolveria). | `sqlite-blob-pool.test.js` |
| P6 | Cache sv360 | Imagem/thumbnail saíam com `Cache-Control: public, immutable` sem `Vary`, **incondicionalmente** — um cache compartilhado (CDN/proxy) podia guardar a resposta de um usuário autorizado de projeto `disabled` e reentregá-la a um anônimo, sem a aplicação ser consultada. | O escopo do cache passa a seguir o escopo de acesso: `enabled` (público) mantém `public, immutable`; `disabled` (controlado) vira `private` + `Vary: Authorization, Cookie`. A regra de acesso em si não mudou. | `sv360-cache-scope.test.js` |
| P7 | Config | Só DATABASE_URL/JWT_SECRET/PORT/CORS_ORIGIN eram validados; os demais `parseInt` viravam `NaN` silencioso — `MAX_BULK_UPLOAD_MB=abc` → `express.json({limit:'NaNmb'})` (**sem limite de corpo**), `WS_HEARTBEAT_INTERVAL_MS=abc` → `setInterval(NaN)` ≈ 1 ms, `JWT_REFRESH_EXPIRY=1w` → `parseDuration`=0 (todo refresh nasce expirado). | `NUMERIC_ENV_RULES` valida faixa de 17 variáveis inteiras (exigindo string totalmente numérica, pois `parseInt('12abc')`=12) e as durações JWT contra a gramática `[smhd]` com valor > 0. Só variáveis **definidas** são checadas; os defaults são conhecidos-bons. | `config.test.js` |
| P8 | Presença | `user_left` era transmitido só por `userId`, sem checar se o usuário ainda tinha outro socket vivo na sala (segunda aba, ou reconexão com clientId novo correndo com o close do socket antigo) → peers removiam um usuário ainda online. | `removeConnection` só anuncia quando o socket que saiu era o **último** daquele usuário na sala (`leaveRoom` já rodou, então a sala contém exatamente os sobreviventes). | `collab-shutdown-presence.test.js` |

### Achados de baixo impacto L1–L13 — **corrigidos**

| # | Arquivo | Correção |
|---|---------|----------|
| L1 | `sync.schemas.js` | `timestamp`/`clientId` agora `required()`, casando com as colunas NOT NULL — op malformada vira 422 em vez de 500 no INSERT. Só depois de **verificar no frontend** que `createOperation`/`createBatchOperations` (`operation-factory.js`) populam ambos incondicionalmente para todo tipo de entidade, e que nada os remove entre a fila e o push. `lamportTimestamp` segue opcional (coluna nullable). |
| L2 | `collab.gateway.js` | `maxPayload` explícito (10 MB, = limite HTTP). O default do `ws` é 100 MiB — 10× o limite HTTP, bufferizado **antes** de qualquer validação. |
| L3 | `sync.service.js` + `sync.controller.js` | O ack passa a carregar o `entityId` **como gravado**, e o controller o estampa no broadcast. Ops de nível-atlas chegam com o sentinela `'atlas'` e são logadas sob o UUID do atlas, então o peer via WS via um `entityId` diferente do que veria via pull. Verificado no frontend antes: o handler de entrada roteia por `entityType` e ignora `entityId` em ops de SETTING (que também não está em `CONVERGENCE_GUARDED`), então a mudança só faz os dois caminhos concordarem. |
| L4 | `auth.service.js` + `auth.queries.js` | `verifyEmail` vira uma transação com **claim atômico** (`UPDATE … WHERE consumed_at IS NULL RETURNING`) — a própria UPDATE é a exclusão mútua. Token expirado faz rollback do claim (não é queimado). |
| L5 | `environment.js` | `cookieOptions().maxAge` DERIVADO de `JWT_ACCESS_EXPIRY` via o novo `utils/duration.js` (extraído de `auth.service`, eliminando a duplicação). O constante de 15 min dessincronizava do expiry configurável, deslogando o usuário com token ainda válido. |
| L6 | `migrate.js` | `pg_advisory_lock` de sessão no runner: um segundo processo **espera** e então enxerga os `_migrations` já comitados, em vez de correr para aplicar o mesmo arquivo duas vezes (a UNIQUE só falha DEPOIS do DDL rodar). |
| L7 | `optional-auth.js` | **Removido** (com seus testes). Zero call sites em produção e superado pelo `flexibleAuth`; mantido, sobrescreveria `req.user` se algum dia fosse adotado. |
| L8 | `sv360.write.service.js` | `updateCalibration` numa transação: uma foto com tombstone não mantém mais o UPDATE persistido antes do 404 (o gate de escrita mantém tombstones de propósito, mas a read que monta a resposta os exclui). Agora casa com o caminho batch. |
| L9 | `sv360.admin.schemas.js` | `orgId` aceita **qualquer** versão de uuid (nos 2 schemas). A org default (`…0001`) não é v4, então a regra v4-only rejeitava com 422 justamente o valor mais provável. |
| L10 | `sv360.queries.js` | `GET_PHOTO_BY_NAME` desempata primeiro pela **org do chamador**, depois por `enabled`. Ordenar só por status tornava a escolha arbitrária entre projetos disabled, podendo 404 um membro que legitimamente tem a foto. |
| L11 | `sv360-error.js` | Mapeia `23505` → 409 e `23503` → 409. O handler de rota intercepta antes do global, então uma violação de unicidade no sv360 virava 500 — contradizendo o comentário da própria query. Mensagem do driver nunca é encaminhada. |
| L12 | `catalog.service.js` | `getCatalogItem`/`updateCatalogItem` filtram `active = true`: um item soft-deletado sumia das listagens mas seguia legível **e editável** por id. **A outra metade do achado não procedia** — `description` É limpável via `''`; só o NULL do SQL é inalcançável, e essa assimetria null-vs-vazio é comportamento deliberado, fixado por `images-gaps` res-02. O COALESCE foi mantido. |
| L13 | `atlas.service.js` | (cobertura) 10 testes para a transferência de posse, que não tinha **nenhum** — positivo, gates de autorização, não-membro, membro desativado, dono atual, uuid malformado e atomicidade. Nenhum defeito encontrado: a rota já estava correta. |

**Limitações de teste, registradas honestamente:** o caso HTTP concorrente do L4 não interleava de forma confiável (o guarda real é o teste de atomicidade do claim, com duas conexões); e o teste do L5 não distingue o fix do bug enquanto `JWT_ACCESS_EXPIRY` estiver no default de 15 min, já que derivado e hardcoded coincidem — o peso está nos testes de `parseDuration`.

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
