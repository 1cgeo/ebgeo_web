# Gestão de Usuários (ciclo de vida administrativo)

Família de endpoints `/api/v1/users` que cobre criação, atualização, reset de senha, desativação com transferência obrigatória de atlas e reativação, além do auto-cadastro gateado por `ALLOW_SELF_REGISTRATION`.

## Superfície de rotas

Tudo em `src/modules/users/users.routes.js`. Duas famílias no mesmo router, separadas pelo middleware:

| Rota | Guarda | Observação |
|---|---|---|
| `GET/PUT /users/me` | `auth` | perfil próprio |
| `PUT /users/me/password` | `auth` | troca de senha com senha atual |
| `POST /users/me/api-key/rotate` | `auth` | ver [[api-keys]] |
| `GET /users/search?q=` | `auth` | usada pelo [[compartilhamento-atlas]] |
| `GET /users` (`?includeInactive`) | `auth` + `requireAdmin` | |
| `POST /users` | `auth` + `requireAdmin` | cria com senha |
| `GET/PUT /users/:userId` | `auth` + `requireAdmin` | |
| `POST /users/:userId/reset-password` | `auth` + `requireAdmin` | |
| `DELETE /users/:userId` (`?transferTo`) | `auth` + `requireAdmin` | desativação (soft) |
| `POST /users/:userId/reactivate` | `auth` + `requireAdmin` | |
| `POST /users/:userId/api-key/rotate` | `auth` + `requireAdmin` | |

`requireAdmin` (`src/middleware/require-admin.js:8-19`) devolve **401** quando não há `req.user` e **403 FORBIDDEN** quando `req.user.role !== 'admin'`. O papel testado aqui é o papel **global** (`user`/`admin`), não o papel por atlas nem o `org_role`, ver [[permissao-vs-papel]] e [[sintese-eixos-de-permissao]].

**A ordem das rotas importa.** `/me` e `/search` são declarados antes de `/:userId` (`users.routes.js:12-16` vs `:21`); inverter isso faria `/users/me` cair no handler admin e falhar a validação de UUID (`userIdParamsSchema`). Não reordene.

## O modelo de dados real: FK, não string

Este é o ponto onde a documentação está mais defasada. `users.rank_id` (FK `ranks`) e `users.organization_id` (FK `organizations`) são o que se **grava**; `posto_graduacao` e `organizacao_militar` são nomes **derivados** por `LEFT JOIN` apenas na leitura (`users.queries.js:3-6, 9-13`). A API continua devolvendo as strings, mas os corpos de escrita exigem UUID.

> [!CONTRADICAO 2026-07-18] `docs/guias/09-admin.md:104-112` e `:141-150` mostram `POST/PUT /users` recebendo `"posto_graduacao": "Sgt"` e `"organizacao_militar": "CIGEx"`; o código em `src/modules/users/users.schemas.js:41-42` e `:49-50` aceita apenas `rank_id` e `organization_id` (`Joi.string().uuid()`). Enviar as strings resulta em erro de validação, os campos não são reconhecidos.

Corolário: a UI de admin precisa das listas controladas de postos e OMs (ver [[organizacoes-om]] e [[resources-catalogo]]) para resolver nome para UUID antes de submeter.

### Limpar um campo nulável

`rank_id` e `organization_id` usam o padrão "valor + flag de presença": o service passa `data.x === '' ? null : (data.x ?? null)` mais `data.x !== undefined`, e o SQL faz `CASE WHEN $flag THEN $valor ELSE coluna_atual END` (`users.service.js:29-36`, `users.queries.js:23-30`). Ou seja, **omitir** o campo preserva, **enviar `null` ou `""`** apaga. `COALESCE` sozinho nunca conseguiria apagar, é por isso que a flag existe. Já `nome`, `username`, `role`, `is_active` e `email_verified` usam `COALESCE` puro (`users.queries.js:126-132`) e portanto **não podem ser apagados**, só substituídos.

### O perfil próprio não pode trocar de organização

`updateProfileSchema` aceita apenas `nome` e `rank_id` (`users.schemas.js:12-15`). A ausência de `organization_id` é deliberada e está documentada no próprio código: se o usuário pudesse se mover de tenant, o próximo refresh emitiria um token com a claim de org alvo e ele passaria os portões org-scoped (projetos privados de sv360, login, WS). Movimentação de tenant é ação de admin. Ver [[jwt-emissor-unico]].

> [!CONTRADICAO 2026-07-18] `docs/guias/09-admin.md:664-665` descreve `PUT /users/me` como "Atualizar perfil" sem restrição; o schema em `src/modules/users/users.schemas.js:12-15` rejeita `organization_id` por design de isolamento de tenant.

## Criar usuário (admin) vs auto-cadastro

Os dois caminhos criam linhas em `users`, mas com defaults diferentes:

- **Admin** (`INSERT_USER_ADMIN`, `users.queries.js:108-119`): `organization_id` entra **como veio**, sem default. Se o admin omitir, o usuário fica **sem organização**. Não há e-mail, portanto o portão de verificação de e-mail nunca dispara e o usuário loga imediatamente.
- **Auto-cadastro** (`INSERT_USER`, `auth.queries.js:71-83`): `organization_id` recebe `COALESCE(..., '00000000-0000-0000-0000-000000000001')`, a organização default, e `role` é sempre `'user'` (`auth.service.js:236`). Um usuário nunca se auto-promove a admin.

Colisão de `username` no caminho admin devolve **409 CONFLICT** com mensagem específica (`users.service.js:112-115`). No auto-cadastro, colisão de username **ou** de e-mail devolve a **mesma** mensagem genérica ("Usuário ou e-mail já cadastrado"), justamente para o endpoint público não virar oráculo de existência (`auth.service.js:210-224`).

### Verificação de e-mail

No auto-cadastro, `email` é opcional. Com e-mail, a conta nasce `email_verified = false` e o login é bloqueado com `401 EMAIL_NOT_VERIFIED` (`auth.service.js:86-88`). Sem e-mail, a conta já está ativa. O envio do e-mail é **best-effort**: se o token/SMTP falhar, a requisição não vira 500, porque a linha já foi commitada e um 500 deixaria uma conta órfã que o usuário não consegue nem recriar nem usar (`auth.service.js:243-252`). O caminho de recuperação é o `resend` ou o admin.

O admin desbloqueia manualmente via `PUT /users/:userId` com `email_verified: true` (`users.schemas.js:53-55`). Esse é o fallback oficial quando não há SMTP configurado, e não aparece na documentação de admin.

## Gate do auto-cadastro

`POST /auth/register` **só é montada** quando `config.security.allowSelfRegistration` é verdadeiro (`auth.routes.js:14-16`). A resolução é pura e testável (`src/config.js:23-27`): `ALLOW_SELF_REGISTRATION='true'` liga, `'false'` desliga, e sem override o default é `NODE_ENV !== 'production'` (ligado em dev/test, desligado em produção, rede militar interna).

Como a rota não é montada, a chamada cai no handler 404 e devolve `404 NOT_FOUND`, **não 403**, para não vazar a existência do endpoint. O cliente não deve sondar o endpoint: o flag é servido em `GET /api/config` como `features.self_registration` (`src/modules/config/config.service.js:143-144`), que é a fonte correta para mostrar ou esconder o botão "Criar conta". Ver [[config-dinamico]].

`/auth/register`, `/auth/login` e `/auth/refresh` passam pelo `authLimiter`, chaveado por IP + username, ver [[hardening-borda-api]].

## Desativação: soft-delete com transferência obrigatória

`DELETE /users/:userId` nunca apaga linha, apenas faz `is_active = false` (`users.queries.js:152-157`). A sequência inteira roda numa transação única (`users.service.js:219-248`):

1. Recusa auto-desativação: `userId === adminId` gera **403 FORBIDDEN** (`users.service.js:210-212`).
2. Conta os atlas do usuário (`deleted_at IS NULL`).
3. Se `count > 0` e não veio `transferTo`, **409 CONFLICT** com a contagem na mensagem. A razão é explícita: sem destinatário os atlas ficariam órfãos.
4. Se veio `transferTo`, valida o destino: inexistente é **404**, inativo é **403**. Só então reatribui `atlas.owner_id`.
5. Soft-delete do usuário.
6. Revoga **todos** os refresh tokens (`REVOKE_ALL_USER_TOKENS`).
7. Grava a auditoria `USER_DELETE` **dentro da mesma transação** (`createAudit(..., t)`), de modo que ela reverte junto se algo falhar.

Resposta: `{ success: true, atlasTransferred: <n> }`.

Armadilhas:

- A transferência é **tudo ou nada por usuário**: `TRANSFER_ATLAS_OWNERSHIP` faz `UPDATE atlas SET owner_id = $2 WHERE owner_id = $1` (`users.queries.js:170-175`). Não existe transferência atlas a atlas por esse endpoint.
- Só atlas **de propriedade** são transferidos. Compartilhamentos onde o usuário era apenas editor/visualizador não são tocados e continuam apontando para uma conta inativa, ver [[permissoes-atlas]].
- `USER_DELETE` é a **única** operação de ciclo de vida auditada. Criação, atualização, reset de senha e reativação não geram registro (a busca por `createAudit` em `users.service.js` só acha `USER_DELETE:243` e `API_KEY_ROTATE:261`). Ver [[auditoria]].

## Efeito imediato da desativação e da demoção

Desativar revoga os refresh tokens, mas um access token já emitido vale até 15 minutos. Isso **não** cria janela de uso, porque o middleware `auth` reconcilia o token com o banco a cada requisição (`src/middleware/auth.js:84-108`):

- `!live.userIsActive` gera **401 "Account is inactive"** (401 e não 403, para o cliente derrubar a sessão, e o retry via refresh também falha porque os tokens foram revogados).
- `!live.orgIsActive` gera **403 "Organization is inactive"**.
- `req.user.role` é **sobrescrito pelo papel vivo do banco**, então `requireAdmin` nunca honra uma claim `role: admin` de um admin já rebaixado.

Sutilezas que valem lembrar: `org_role` e `organization_id` **não** são reconciliados (a mudança de tenant continua limitada à janela de ≤15 min do token); linha ausente **não** é revogação (o sistema só faz soft-delete, linha sumida é anomalia); e principais de link público (`sub` no formato `public-<uuid>`) saem antes da reconciliação porque não têm linha em `users` (`auth.js:80-82`). Ver [[link-publico]] e [[autenticacao-jwt]].

## Reset e troca de senha

Ambos usam bcrypt com `SALT_ROUNDS = 12` (`users.service.js:8`) e ambos revogam todos os refresh tokens do usuário depois de gravar o hash (`users.service.js:66-67` e `:196-197`).

Diferença: `PUT /users/me/password` exige `currentPassword` e devolve **401** se não conferir (`users.service.js:57-60`); `POST /users/:userId/reset-password` não exige nada além do papel admin. Consequência prática para a UI: após qualquer um dos dois, as outras abas e dispositivos perdem a sessão no próximo refresh. Trate esse 401 como "faça login de novo", não como erro inesperado. Ver [[refresh-token-rotacao]].

## Auto-guarda em `PUT /users/:userId`

O controller passa `req.user.id` como `actingUserId` (`users.controller.js:52`) e o service bloqueia dois auto-tiros no pé (`users.service.js:140-149`), ambos com **409 CONFLICT**:

- `is_active: false` na própria conta.
- rebaixar o próprio `role` quando já se é `admin`.

É defesa em profundidade contra o cenário de "último admin se tranca para fora", complementando o botão desabilitado na UI. Note a assimetria de status: auto-desativação via `PUT` é **409**, via `DELETE` é **403** (`users.service.js:211`). Não é bug, são caminhos distintos, mas o cliente precisa tratar os dois.

> [!CONTRADICAO 2026-07-18] `docs/guias/09-admin.md:152` diz que na atualização "todos os campos são opcionais" e lista apenas a checagem de `username` duplicado; o código em `src/modules/users/users.service.js:140-149` adiciona duas rejeições 409 para auto-desativação e auto-rebaixamento, e `users.schemas.js:55` aceita também `email_verified`.

## Listagem e busca

`GET /users` alterna entre `LIST_ALL_USERS` e `LIST_ACTIVE_USERS` conforme `includeInactive` (`users.service.js:88-92`); ambas expõem `email` e `email_verified` além de `role` e `is_active` (`users.queries.js:69-88`). Sem paginação: a query traz tudo, ordenado por `created_at DESC` (todos) ou `nome` (ativos).

`GET /users/search?q=` é a rota para **usuários comuns** (só `auth`), retorna apenas ativos, **LIMIT 20** fixo e casa contra username, nome, **nome do posto** e **nome da OM** via os JOINs (`users.queries.js:48-63`). O `q` exige no mínimo 2 caracteres (`users.schemas.js:23`). É esta a rota que alimenta o seletor de destinatários do [[compartilhamento-atlas]], e o limite de 20 sem paginação é o motivo de buscas curtas parecerem "cortar" resultados.

`GET /users/me` usa `FIND_USER_BY_ID`, que filtra `is_active = true` (`users.queries.js:14`): uma conta desativada recebe **404** no próprio perfil, embora na prática o middleware já a tenha barrado com 401 antes.

## Erros

Mapeamento das classes usadas aqui (`src/utils/errors.js`): `NotFoundError` 404 `NOT_FOUND`, `ForbiddenError` 403 `FORBIDDEN`, `UnauthorizedError` 401 `UNAUTHORIZED`, `ConflictError` 409 `CONFLICT`. Envelope e convenções gerais em [[erros-api]] e [[sintese-contrato-erros-http]].

> [!CONTRADICAO 2026-07-18] `docs/guias/11-seguranca-hardening.md:94-117` documenta as mensagens de login em inglês (`Invalid credentials`, `Account is deactivated`); o código em `src/modules/auth/auth.service.js:77` e `:81` emite `Usuário ou senha inválidos` e `Conta desativada`. Os `code` (`UNAUTHORIZED`) batem, as `message` não. Nunca faça o cliente ramificar por `message`.

## Fronteiras

Gestão de usuários é **REST puro**. Nada aqui viaja como operação de sync, não há tipo de entidade de usuário no envelope colaborativo, ver [[sintese-rest-vs-sync]] e [[tipos-entidade-sync]]. O papel global `admin` decidido aqui é ortogonal ao papel por atlas, ver [[sintese-capacidades-por-papel]]. Operações administrativas sobre a tabela de operações ficam em [[sync-admin-operacoes]].

## Fontes

- `docs/guias/09-admin.md`: catálogo das rotas admin de usuários, semântica de `includeInactive`, comportamento e tabela de erros da desativação com `transferTo`, fluxo narrativo do ciclo de vida (criar, resetar, desativar, reativar).
- `docs/guias/01-autenticacao.md`: contrato do auto-cadastro (`POST /auth/register`), validações de `username`/`password`/`nome`, regra de que novos usuários sempre nascem `role: user`, e o gate `ALLOW_SELF_REGISTRATION` com 404 quando desligado.
- `docs/guias/11-seguranca-hardening.md`: revogação em massa de refresh tokens em troca/reset de senha e desativação, rate limit das rotas de credencial, e a escolha de 404 (não 403) para o registro desabilitado.
- `ebgeo_backend/src/modules/users/{routes,controller,service,schemas,queries}.js`: contrato real dos corpos (`rank_id`/`organization_id` como UUID), padrão valor+flag para limpar nuláveis, transação da desativação, auto-guarda 409 do `PUT`, `LIMIT 20` da busca.
- `ebgeo_backend/src/modules/auth/{auth.routes,auth.service,auth.queries,auth.schemas}.js` e `src/config.js`: montagem condicional do `/register`, `resolveAllowSelfRegistration`, default de organização no auto-cadastro, portões de `is_active` e `email_verified` no login.
- `ebgeo_backend/src/middleware/{auth,require-admin}.js` e `src/utils/org-status.js`: reconciliação por requisição do estado vivo do usuário (desativação e demoção com efeito imediato), isenção do principal de link público.
- `ebgeo_backend/src/modules/config/config.service.js`: exposição de `features.self_registration` no config de runtime.
