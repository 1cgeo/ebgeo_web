# Organizações (OMs) como Tenant

Organização Militar de primeira classe (id, nome, slug, sigla, is_active) sob `/api/v1/organizations`, dona dos dados e referenciada por `organization_id` em todo usuário, com org default fixa e soft-delete auditado.

## O que é uma organização no código

A tabela `organizations` (`src/database/migrations/001_core.sql:15-23`) tem `id UUID PK`, `nome VARCHAR(255) NOT NULL`, `slug VARCHAR(100) UNIQUE NOT NULL`, `sigla VARCHAR(50)`, `is_active BOOLEAN NOT NULL DEFAULT TRUE`, `created_at`/`updated_at`. Não há coluna de hierarquia: OMs são uma lista plana, não uma árvore de subordinação.

O baseline semeia uma **org default determinística** (`00000000-0000-0000-0000-000000000001`, slug `default`, sigla `DEFAULT`, `001_core.sql:26-28`) e sete OMs reais (DSG, CIGEx, 1º a 5º CGEO, `001_core.sql:32-40`), todas com `ON CONFLICT (slug) DO NOTHING`, de modo que rodar a migração de novo é idempotente. O id fixo da default existe justamente para backfill e testes, e é usado literalmente como constante SQL no cadastro (ver abaixo) e no ETL do 360 (`src/modules/streetview360/sv360.merge.js:25`).

`users.organization_id UUID REFERENCES organizations(id)` é **nullable** (`001_core.sql:96`), com índice `idx_users_organization` (`001_core.sql:120`). Ao lado dele mora `org_role VARCHAR(20) NOT NULL DEFAULT 'viewer' CHECK (org_role IN ('owner','admin','editor','viewer'))` (`001_core.sql:97-98`), o papel org-scoped, ortogonal ao `role` global (`user`/`admin`) e à permissão por atlas. Ver [[permissao-vs-papel]] e [[sintese-eixos-de-permissao]].

## API `/api/v1/organizations`

Montada em `src/app.js:108`. Rotas em `src/modules/organizations/organizations.routes.js:11-15`:

| Método | Rota | Guarda | Observação |
|---|---|---|---|
| GET | `/organizations` | `auth` | qualquer autenticado; `ORDER BY nome`, **inclui inativas** |
| GET | `/organizations/:id` | `auth` + `validate(params)` | 404 se não existe, 422 se `:id` não é UUID |
| POST | `/organizations` | `auth` + `requireAdmin` | 201, audita `ORG_CREATE` |
| PUT | `/organizations/:id` | `auth` + `requireAdmin` | audita `ORG_UPDATE` |
| DELETE | `/organizations/:id` | `auth` + `requireAdmin` | 204, soft-delete, audita `ORG_DELETE` |

Todas usam o envelope `{ data: ... }` (`organizations.controller.js:6-36`) e o envelope de erro padrão de [[erros-api]] / [[sintese-contrato-erros-http]]: 401 `UNAUTHORIZED`, 403 `FORBIDDEN`, 404 `NOT_FOUND`, 409 `CONFLICT`, 422 `VALIDATION_ERROR`.

Validação (Joi, `organizations.schemas.js:4-20`): no create, `nome` obrigatório (máx. 255), `slug` obrigatório (máx. 100, `^[a-z0-9-]+$`, mensagem literal `"slug can only contain lowercase letters, numbers and hyphens"`), `sigla` opcional aceitando `null`/`""`. No update, os três campos são opcionais e `is_active` é booleano. **O `slug` não aparece no `updateOrganizationSchema`**: uma vez criado, o identificador é imutável por esta API, o que é intencional porque o slug é chave de resolução em outros módulos (ex.: `sv360.admin.queries.js:36` resolve `orgSlug -> organizations.id`).

Conflito de slug é checado em leitura separada antes do insert (`organizations.service.js:18-19`), com mensagem em português (`"Já existe uma organização com este identificador (slug)."`). Isso é um check-then-insert, não atômico; sob concorrência quem perde bate na `UNIQUE` do banco e vira erro genérico em vez de 409 limpo.

## Armadilhas do UPDATE

`UPDATE_ORGANIZATION` usa `COALESCE($2, nome)` para cada campo (`organizations.queries.js:22-30`) e o service passa `data.nome ?? null`, `data.sigla ?? null`, `data.is_active ?? null` (`organizations.service.js:25-30`). Consequências práticas:

- Campo omitido no corpo vira `null` e o `COALESCE` preserva o valor atual. É o comportamento desejado de PATCH parcial, apesar do verbo ser PUT.
- **Não dá para limpar a `sigla` enviando `null`**: `null ?? null` é `null`, o `COALESCE` mantém a sigla antiga. Para esvaziar, envie `sigla: ""` (o schema aceita `''`, que passa pelo `??` e grava string vazia).
- Reativar uma OM é `PUT` com `is_active: true`, o mesmo caminho do update comum.

## Soft-delete com dentes: desativar uma OM barra os membros na hora

`DELETE` chama `deactivateOrganization`, que só faz `SET is_active = false` (`organizations.queries.js:32-35`). Nada é removido fisicamente, nenhum usuário é reassociado. Mas a desativação **não é cosmética**: a autorização dos membros é reconciliada ao vivo contra o banco, não contra o JWT (que pode estar até `JWT_ACCESS_EXPIRY`=15min desatualizado). O utilitário está em `src/utils/org-status.js`:

- `orgIsActive(organizationId)` (`org-status.js:16-21`): retorna `true` quando não há org (token legado / conta sem OM) e também quando a linha da org **não existe** (linha ausente é anomalia, não desativação deliberada, e não pode trancar ninguém para fora).
- `getLiveAuthState(userId)` (`org-status.js:31-64`): uma única leitura com `LEFT JOIN organizations`, devolvendo `userIsActive`, `role`, `orgRole`, `organizationId`, `orgIsActive` (com `COALESCE(o.is_active, true)`).

Pontos onde o gate roda:

- Middleware estrito `auth`: `getLiveAuthState` e, se `!live.orgIsActive`, `ForbiddenError('Organization is inactive')` (`src/middleware/auth.js:84-109`). Sem linha de usuário, cai no gate só-de-org via `orgIsActive`.
- Login: `ForbiddenError('Organização inativa')` (`src/modules/auth/auth.service.js:92`).
- Refresh: mesmo bloqueio (`auth.service.js:165`), então a rotação de [[refresh-token-rotacao]] também morre.
- [[auth-flexivel]]: `flexible-auth.js:78-82` derruba a sessão deslizante quando `!live.userIsActive || !live.orgIsActive`.
- WebSocket de colaboração ([[canal-collab-websocket]], [[websocket-collab]]): upgrade recusado com `403` em `collab.gateway.js:252-255`, e sockets já abertos são fechados com código `4003 'organization deactivated'` na reconciliação periódica (`collab.gateway.js:120-122`).

O mesmo middleware `auth` adota o `role` **global** ao vivo para impedir que um admin rebaixado use claim velha, mas **não** sobrescreve `org_role`/`organization_id` (`auth.js:100-105`): mudança de tenant continua limitada à janela de até 15 minutos do access token. Se você mover um usuário de OM, a nova OM só vale de fato após o próximo refresh.

## De quem é o `organization_id`

- **Autocadastro**: `INSERT_USER` faz `COALESCE($6::uuid, '00000000-0000-0000-0000-000000000001'::uuid)` (`src/modules/auth/auth.queries.js:74`), ou seja, quem não escolhe OM cai na org default. O service passa `data.organization_id || null` com comentário explícito (`auth.service.js:237`). Note a assimetria: no autocadastro nunca fica `null`, mas a coluna é nullable e contas criadas por outros caminhos podem ficar sem OM.
- **Edição de perfil pelo próprio usuário**: `updateProfileSchema` aceita apenas `nome` e `rank_id` (`src/modules/users/users.schemas.js:12-15`). A omissão de `organization_id` é deliberada e documentada no próprio arquivo (`users.schemas.js:4-11`): permitir a troca daria ao usuário acesso de leitura aos projetos 360 privados da OM alvo e o faria passar nos gates org-scoped de login/WS. Trocar de tenant é ação de admin.
- **Admin**: `createUserAdminSchema`/`updateUserAdminSchema` aceitam `organization_id` (`users.schemas.js:42` e `users.schemas.js:50`). O SQL usa uma flag "provided" (`organization_id = CASE WHEN $6 THEN $5::uuid ELSE organization_id END`, `users.queries.js:30` e `users.queries.js:129`) para que um `null` explícito **limpe** a OM em vez de ser ignorado. Ver [[gestao-usuarios]].

## Quem realmente é escopado por org

Apesar de a org ser descrita como "dona dos dados", o escopo por tenant no código atual é estreito:

- `users.organization_id` (`001_core.sql:96`), usado nos gates de sessão acima.
- `sv360.projects.organization_id UUID NOT NULL REFERENCES public.organizations(id)` com `UNIQUE (organization_id, slug)` e índice dedicado (`src/database/migrations/005_sv360.sql:16-30`). É aqui que a org de fato particiona dados. Ver [[streetview-360]] e [[ingestao-projetos-360]].
- Escrita no 360 é gated por `org_role ∈ {owner, admin, editor}` na org dona (`sv360.write.service.js:36`, `sv360.routes.js:269`), o único lugar onde `org_role` decide algo no backend.
- Listas de domínio do cadastro: `GET /api/v1/config` publica as OMs ativas (`SELECT id, nome, sigla FROM organizations WHERE is_active = true ORDER BY nome`, `src/modules/config/config.service.js:119-124`) para o dropdown anônimo do signup. Ver [[config-dinamico]].

> [!CONTRADICAO 2026-07-18] `docs/guias/12-multiorg-identidade-auditoria.md:26` diz que "uma organização representa a OM (Organização Militar) dona dos dados", mas a tabela `atlas` só tem `owner_id UUID NOT NULL REFERENCES users(id)` e nenhuma coluna `organization_id` (`ebgeo_backend/src/database/migrations/002_atlas.sql:10-17`). Atlas, mapas, camadas e feições **não** são escopados por org: o acesso a eles vem de `atlas_shares` (`002_atlas.sql:59-66`). Hoje a org particiona apenas usuários e projetos 360. Ver [[atlas]] e [[permissoes-atlas]].

`ng` (nomes geográficos) também não é escopado por org: é gated por usuário/grupo via concessões de zona (`ng.fn_user_zone_geoms`), conforme o comentário em `users.schemas.js:9-10`. Ver [[zonas-acesso-geografico]] e [[gazetteer-nomes-geograficos]].

## Claims no token

O access token carrega `organization_id` e `org_role`, mais os aliases congelados `org` e `login` consumidos as-is pelo módulo 360 (`auth.service.js:32-36`). Fallback de token legado: `organization_id ?? null` e `org_role || 'viewer'` (`src/middleware/auth.js:38-39`, `flexible-auth.js:37-38`, `auth.service.js:116-117`). Detalhes em [[jwt-emissor-unico]] e [[autenticacao-jwt]]; a mesma credencial pode chegar por Bearer, cookie ou [[api-keys]] via [[auth-flexivel]].

No frontend, `org_role` vira o papel de sessão no login e no restore de boot (`ebgeo_web/src/js/store/sync/sync-engine.js:126` e `src/js/index.js:256`, ambos `user.org_role || 'viewer'`), mas ao conectar num atlas o papel **por atlas** do payload do WS sobrescreve esse valor (`sync-engine.js:189-197`). Ou seja: `org_role` é só o default de UI antes de haver atlas conectado, e não deve ser usado para decidir permissão de escrita em atlas. Ver [[sessao-boot-e-ciclo-de-vida]] e [[permissao-vs-papel]].

## UI de administração

A aba "Pessoal" do painel admin edita as duas listas controladas, postos (`ranks`) e OMs (`organizations`), como dropdowns FK do cadastro (`ebgeo_web/src/js/admin/personnel-tab.js:1-9`). Detalhes que mordem:

- O `slug` **não** é campo do formulário: é derivado do nome via `slugify(v.nome)` só na criação (`personnel-tab.js:44`, função em `personnel-tab.js:281`), e o update envia apenas `nome` e `sigla` (`personnel-tab.js:45`). Renomear a OM **não** muda o slug, por design.
- A listagem chama `apiClient.listOrganizations()` sem filtro (`personnel-tab.js:42`), e a API devolve inativas junto (`LIST_ORGANIZATIONS`, `organizations.queries.js:3-7`). Uma OM "excluída" continua aparecendo na tabela do admin como se estivesse viva. Quem quiser distinguir precisa filtrar por `is_active` no cliente. O dropdown público do signup, esse sim, já vê só as ativas (`config.service.js:120-121`).
- Cliente REST: `listOrganizations`/`createOrganization`/`updateOrganization`/`deleteOrganization` em `ebgeo_web/src/js/store/sync/api-client.js:494-509`. Ver [[api-rest-atlas]] para o padrão geral do cliente.

## Auditoria

Criar, atualizar e desativar uma OM gravam `ORG_CREATE`, `ORG_UPDATE` e `ORG_DELETE` com `targetType: 'ORG'` (`organizations.controller.js:16-34`). Atenção: o `createAudit` aqui é chamado **sem** o terceiro argumento de transação, portanto **fora** da transação da operação (`src/utils/audit.js:13-30` só entra em `t.none` quando `t` é passado). Se o insert de auditoria falhar, a org já foi criada ou desativada. No `ORG_DELETE` o `targetName` nem é preenchido (`organizations.controller.js:33`), então a trilha guarda só o UUID da org desativada. Detalhes da trilha e do envelope aninhado de `GET /api/v1/audit` em [[auditoria]].

## Checklist para não errar

- Trate `organization_id` como possivelmente `null` (coluna nullable + fallback de token legado). Não presuma a org default fora do autocadastro.
- Não use `org_role` para decidir escrita em atlas: use a permissão por atlas. `org_role` só decide escrita no 360.
- Desativar OM é ação de alto impacto: derruba login, refresh, rotas estritas e sockets abertos dos membros. Não é "esconder da lista".
- Para limpar `sigla`, envie `""`, não `null`.
- `slug` é imutável e é chave de resolução em outros módulos; escolha bem na criação.
- Ao listar OMs para seleção, filtre `is_active` no cliente, porque `GET /organizations` devolve tudo.

## Fontes
- `docs/guias/12-multiorg-identidade-auditoria.md`: shape da organização, contrato das 5 rotas, org default fixa, política de soft-delete, claims `organization_id`/`org_role` e aliases congelados, tabela de erros consolidada.
- `ebgeo_backend/src/modules/organizations/*.js`: rotas, guardas (`auth`/`requireAdmin`), schemas Joi, SQL com `COALESCE`, check de slug duplicado, chamadas de auditoria.
- `ebgeo_backend/src/database/migrations/001_core.sql`: DDL de `organizations`, seed da org default e das OMs, FK `users.organization_id` + `org_role`.
- `ebgeo_backend/src/database/migrations/002_atlas.sql`: ausência de `organization_id` em `atlas` (base da contradição registrada).
- `ebgeo_backend/src/database/migrations/005_sv360.sql`: `sv360.projects.organization_id` como o escopo por tenant que existe de fato.
- `ebgeo_backend/src/utils/org-status.js`, `src/middleware/auth.js`, `src/middleware/flexible-auth.js`, `src/modules/auth/auth.service.js`, `src/modules/collab/collab.gateway.js`: gates ao vivo de OM inativa em login, refresh, rotas estritas, sessão deslizante e WebSocket.
- `ebgeo_backend/src/modules/users/users.schemas.js` e `users.queries.js`: quem pode mudar `organization_id` e o padrão da flag "provided".
- `ebgeo_backend/src/modules/config/config.service.js`: lista pública de OMs ativas para o signup anônimo.
- `ebgeo_web/src/js/admin/personnel-tab.js`, `src/js/store/sync/api-client.js`, `src/js/store/sync/sync-engine.js`, `src/js/index.js`: UI de CRUD de OM, slug derivado, e uso de `org_role` como papel de sessão sobrescrito pelo papel por atlas.
