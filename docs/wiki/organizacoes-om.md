# Organizações (OMs) como Tenant

A OM é um tenant de alcance estreito: particiona usuários e projetos 360, nunca atlas. Desativá-la não esconde, expulsa: derruba login, refresh e sockets abertos dos membros em segundos.

CRUD em `src/modules/organizations/*` (5 rotas, `auth` para ler, `requireAdmin` para escrever), DDL em `backend/src/database/migrations/001_core.sql:15-23`. Envelope de erro padrão de [[erros-api]] / [[sintese-contrato-erros-http]].

## O que a org NÃO escopa (a expectativa errada)

O nome "dona dos dados" sugere que atlas pertence a OM. Não pertence: `atlas` tem só `owner_id` e nenhum `organization_id` (`backend/src/database/migrations/002_atlas.sql:10-17`); o acesso vem de `atlas_shares`. Ver [[atlas-modelo-de-dados]] e [[permissoes-atlas]]. Nomes geográficos também não: são gated por concessão de zona por usuário/grupo (`backend/src/modules/users/users.schemas.js:9-10`), ver [[zonas-acesso-geografico]] e [[gazetteer-nomes-geograficos]].

O único lugar onde a org de fato particiona dados é `sv360.projects.organization_id` com `UNIQUE (organization_id, slug)` (`backend/src/database/migrations/005_sv360.sql:16-30`). O único lugar onde `org_role` decide alguma coisa no backend é a escrita no 360 (`backend/src/modules/streetview360/sv360.write.service.js:32-37`). Ver [[streetview-360]] e [[ingestao-projetos-360]].

**Consequência prática:** nunca use `org_role` para decidir escrita em atlas. No frontend ele vira o papel de sessão no login e no restore de boot (`frontend/src/js/store/sync/sync-engine.js:126`), mas o papel **por atlas** do payload do WS o sobrescreve ao conectar (`frontend/src/js/store/sync/sync-engine.js:189-197`). `org_role` é só o default de UI enquanto não há atlas conectado. Ver [[sessao-boot-e-ciclo-de-vida]] e [[sintese-eixos-de-permissao]].

> [!CONTRADICAO] A documentação de origem (guia *12-multiorg-identidade-auditoria*, absorvido) afirmava que "uma organização representa a OM dona dos dados". O schema contradiz: nem atlas, nem mapas, nem camadas, nem feições são escopados por org. Trate a afirmação como intenção de projeto, não como comportamento.

## Por que o gate roda contra o banco, e não contra o JWT

A claim de org no access token fica até `JWT_ACCESS_EXPIRY`=15min desatualizada. Confiar nela faria um membro de OM desativada continuar trabalhando pela janela inteira e, com a renovação deslizante de [[auth-flexivel]], indefinidamente. Por isso toda checagem consulta o banco ao vivo (`backend/src/utils/org-status.js`), e o custo foi mantido em **uma** leitura: `getLiveAuthState` faz `LEFT JOIN organizations` e devolve usuário e org juntos, substituindo a consulta org-only anterior.

Duas escolhas contraintuitivas, ambas deliberadas em `backend/src/utils/org-status.js:7-9`:

- **Linha de org ausente conta como ativa** (`COALESCE(o.is_active, true)`). Ausência é anomalia, não desativação; trancar todo mundo para fora por causa de uma FK órfã seria pior.
- **Linha de usuário ausente também não revoga** (`backend/src/middleware/auth.js:88-93`). O sistema só faz soft-delete, então sumiço de linha é anomalia. A revogação real vem de `is_active = false`.

Pontos onde o gate roda: middleware `auth` (`backend/src/middleware/auth.js:84-109`), login (`backend/src/modules/auth/auth.service.js:92`), refresh (`backend/src/modules/auth/auth.service.js:165`, que mata também a rotação de [[refresh-token-rotacao]]), sessão deslizante (`backend/src/middleware/flexible-auth.js:78-82`), e o WebSocket de [[canal-collab-websocket]] (403 no upgrade em `backend/src/modules/collab/collab.gateway.js:252-255`; socket já aberto fecha com código `4003` na reconciliação periódica, `backend/src/modules/collab/collab.gateway.js:120-122`).

**Fura o gate por design:** principais de [[link-publico]]. O `auth` estrito faz early-return para qualquer `sub` que não seja UUID (`backend/src/middleware/auth.js:78-80`), porque o token público sintético não tem linha em `users`. A autoridade dele vem do token assinado mais a flag `is_public` do atlas.

**Não fura, mas escapa:** o mesmo middleware adota o `role` **global** ao vivo (para que um admin rebaixado não passe em `requireAdmin`), mas deliberadamente **não** sobrescreve `org_role`/`organization_id` (`backend/src/middleware/auth.js:100-105`). Mover um usuário de OM só vale de fato após o próximo refresh.

## Armadilhas do CRUD

- **`slug` é imutável por contrato**: ausente do `updateOrganizationSchema` de propósito, porque é chave de resolução em outros módulos (`backend/src/modules/streetview360/sv360.admin.queries.js:36` resolve `orgSlug -> id`). A UI reforça: deriva o slug de `slugify(nome)` só na criação e nunca o reenvia no update (`frontend/src/js/admin/personnel-tab.js:44-45`). Renomear a OM não muda o slug. Escolha bem.
- **Não dá para limpar a `sigla` mandando `null`.** O update usa `COALESCE($3, sigla)` e o service passa `data.sigla ?? null` (`backend/src/modules/organizations/organizations.service.js:28`): `null ?? null` é `null`, o `COALESCE` preserva o valor antigo. Para esvaziar, envie `""`. Note a incoerência com `users`, que resolveu o mesmo problema com uma flag "provided" (`organization_id = CASE WHEN $6 THEN ... END`, `backend/src/modules/users/users.queries.js:30`) e por isso **aceita** `null` explícito como "limpar". Dois padrões no mesmo backend. Ver [[gestao-usuarios]].
- **`GET /organizations` devolve inativas.** O painel admin lista sem filtro (`frontend/src/js/admin/personnel-tab.js:42`), então uma OM "excluída" continua aparecendo viva na tabela; filtre `is_active` no cliente. O dropdown público do signup usa outra query, essa sim filtrada (`backend/src/modules/config/config.service.js:119-124`). Ver [[config-dinamico]].
- **Conflito de slug é check-then-insert**, não atômico (`backend/src/modules/organizations/organizations.service.js:18-19`). Sob concorrência, o perdedor bate na `UNIQUE` do banco e vira erro genérico em vez de 409 limpo.
- **Reativar é `PUT` com `is_active: true`**: não existe rota de "undelete".

## Contratos congelados

- **O UUID da org default `00000000-0000-0000-0000-000000000001`** está escrito literalmente em três lugares independentes: o seed (`backend/src/database/migrations/001_core.sql:26-28`), o `COALESCE` do autocadastro (`backend/src/modules/auth/auth.queries.js:74`) e o backfill do ETL 360 (`backend/src/modules/streetview360/sv360.merge.js:25`). Mudar o id quebra os três em silêncio. Ver [[sintese-contratos-congelados]].
- **Trocar de OM é ação de admin, nunca self-service.** `updateProfileSchema` omite `organization_id` de propósito (`backend/src/modules/users/users.schemas.js:4-11`): permitir daria ao usuário leitura dos projetos 360 privados da OM alvo e o faria passar nos gates org-scoped.
- **Aliases `org` e `login`** no access token são consumidos as-is pelo módulo 360 (`backend/src/modules/auth/auth.service.js:32-36`). Ver [[jwt-emissor-unico]], [[autenticacao-jwt]] e [[api-keys]].
- `organization_id` é **nullable** e o fallback de token legado é `?? null` (`backend/src/middleware/auth.js:38-39`). Só o autocadastro garante org; contas por outros caminhos podem ficar sem OM. Não presuma a default.
- OMs são **lista plana**: não há coluna de hierarquia. Subordinação militar não é representável.

## Auditoria fora da transação

`ORG_CREATE`/`ORG_UPDATE`/`ORG_DELETE` chamam `createAudit` **sem** o terceiro argumento de transação (`backend/src/modules/organizations/organizations.controller.js:16-34`), e `createAudit` só entra em `t.none` quando esse argumento existe (`backend/src/utils/audit.js:27`). Se o insert de auditoria falhar, a org já foi criada ou desativada e a trilha não registra. No `ORG_DELETE` o `targetName` nem é preenchido, então a trilha guarda só o UUID. Ver [[auditoria]].

## Fontes
- `backend/src/modules/organizations/*.js`, `backend/src/utils/org-status.js`, `src/middleware/{auth,flexible-auth}.js`, `backend/src/modules/auth/auth.service.js`, `backend/src/modules/collab/collab.gateway.js`.
- `backend/src/database/migrations/{001_core,002_atlas,005_sv360}.sql`.
- `backend/src/modules/users/{users.schemas,users.queries}.js`, `backend/src/modules/config/config.service.js`, `src/modules/streetview360/{sv360.write.service,sv360.merge}.js`.
- `frontend/src/js/admin/personnel-tab.js`, `src/js/store/sync/{api-client,sync-engine}.js`. Ver [[api-rest-atlas]] para o padrão do cliente REST.
- guia *12-multiorg-identidade-auditoria* (absorvido): origem da contradição "dona dos dados".
