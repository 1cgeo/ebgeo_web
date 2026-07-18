# Autenticação JWT (access + refresh)

Mecanismo de autenticação do EBGeo: par access token JWT HS256 de 15 minutos e refresh token opaco de 7 dias, emitidos por POST /auth/login e renovados em POST /auth/refresh.

## Os dois tokens são coisas diferentes

| | Access token | Refresh token |
|---|---|---|
| Formato | JWT assinado HS256 | string opaca, `crypto.randomUUID() + '-' + 32 bytes hex` (`auth.service.js:58`) |
| Validade | `JWT_ACCESS_EXPIRY`, default `15m` (`src/config.js:42`) | `JWT_REFRESH_EXPIRY`, default `7d` (`src/config.js:43`) |
| Estado no servidor | nenhum (stateless, só verificação de assinatura) | linha em `refresh_tokens`, gravada como **SHA-256 do token** (`auth.service.js:59`, `105`) |
| Revogável | **não** (vale até `exp`) | sim (`revoked_at`) |
| Uso | header `Authorization: Bearer` e query `token` do WebSocket | só `POST /auth/refresh` e `POST /auth/logout` |

A consequência prática mais importante: **não existe revogação imediata de access token**. Desativar um usuário não invalida o JWT que ele já tem. Por isso o backend reconcilia o token contra o banco a cada requisição na rota estrita (ver "O JWT não é a última palavra").

O access token é emitido por `issueAccessToken()` (`auth.service.js:24-42`), com claims de identidade, `role` global, `organization_id`/`org_role` e os aliases congelados `org`/`login`. O payload completo e a razão dos aliases estão em [[jwt-emissor-unico]]; os dois eixos de papel, em [[permissoes-atlas]] e [[sintese-eixos-de-permissao]].

## Login

`POST /api/v1/auth/login` com `{ username, password }`. Resposta `200` com `{ data: { accessToken, refreshToken, user } }` (`auth.controller.js:5-9`, `auth.service.js:107-120`).

O `login` roda **cinco** portas, nesta ordem (`auth.service.js:66-105`):

1. bcrypt **sempre** executa, contra o hash real ou contra `DUMMY_HASH` quando o username não existe (`auth.service.js:19`, `73-74`). Isso remove o oráculo de timing e a enumeração de usuários. Usuário inexistente e senha errada devolvem `401` com a **mesma** mensagem.
2. `is_active = false` → `401` (`auth.service.js:81-83`).
3. **Conta com e-mail não confirmado** → `401` com code próprio `EMAIL_NOT_VERIFIED` (`auth.service.js:87-89`). Contas **sem** e-mail (criadas por admin, legadas, máquina) pulam essa porta inteira.
4. Organização desativada → `403` `Organização inativa` (`auth.service.js:92-94`). Ver [[organizacoes-om]].
5. Só então grava `last_login`, emite o par e persiste o hash do refresh.

Armadilha de validação: `loginSchema` exige `password` com **mínimo 6 caracteres** (`auth.schemas.js:6`). Uma senha de 5 caracteres devolve `422 VALIDATION_ERROR`, não `401`. Se a UI trata "erro no login" como "credenciais inválidas", a mensagem sai errada. Ver [[erros-api]] e [[sintese-contrato-erros-http]].

> [!CONTRADICAO 2026-07-18] guia *11-seguranca-hardening* (absorvido) §2 documenta as mensagens em inglês (`Invalid credentials`, `Account is deactivated`) e §3.2 (`Invalid refresh token`, `Refresh token expired`); o código emite mensagens em português: `Usuário ou senha inválidos` (`auth.service.js:78`), `Conta desativada` (`auth.service.js:82`), `Sessão inválida. Entre novamente.` (`auth.service.js:135` e `146`), `Sessão expirada. Entre novamente.` (`auth.service.js:150`). Não faça matching por string de mensagem; use o `code` do envelope. As mensagens **em inglês** que existem de fato são as do middleware de JWT: `Token expired` / `Invalid token` (`middleware/auth.js:43,45`) e `Account is inactive` / `Organization is inactive` (`middleware/auth.js:95,98`).

> [!CONTRADICAO 2026-07-18] guia *01-autenticacao* (absorvido) §9 mostra o corpo de `POST /auth/register` com `posto_graduacao` e `organizacao_militar` como texto livre; o schema real aceita `rank_id` e `organization_id` como **UUIDs** (FKs para `ranks` e `organizations`) e um `email` opcional (`auth.schemas.js:26-29`). Enviar o formato do doc faz o Joi rejeitar os campos desconhecidos.

## Refresh: rotação e uso único

`POST /api/v1/auth/refresh` com `{ refreshToken }`, devolve `{ accessToken, refreshToken }` (sem objeto `user`). O token apresentado é **sempre revogado** e um novo é emitido (`auth.service.js:154`, `171-175`). O cliente é obrigado a substituir o token armazenado, o antigo não funciona mais.

O lookup usa `FIND_REFRESH_TOKEN_ANY`, que inclui tokens revogados, justamente para distinguir "nunca existiu" de "reapresentado depois de usado" (`auth.service.js:132`). Reapresentar um token já revogado é lido como cadeia de rotação comprometida e **revoga a família inteira** do usuário (`auth.service.js:142-146`), derrubando todas as sessões.

Daí a armadilha operacional mais cara do módulo: **refresh concorrente derruba a sessão**. Duas requisições disparando refresh com o mesmo token fazem a segunda cair na detecção de reuso. O `ApiClient` do frontend resolve isso com um único refresh em voo compartilhado, via a promessa `_refreshing` (`src/js/store/sync/api-client.js:289-312`). Qualquer código novo que fale com a API deve passar por esse cliente, nunca fazer `fetch` direto com o refresh token. Detalhe completo do ciclo em [[refresh-token-rotacao]].

O refresh também revalida a organização (`auth.service.js:165-167`): uma OM desativada no meio da sessão corta a renovação com `403`, e a sessão morre quando o access token expirar.

## Renovação transparente no cliente

O `_request` do `ApiClient` detecta `401`, chama `refresh()` uma única vez e repete a requisição com `_retry: false` (`src/js/store/sync/api-client.js:229-234`). Se o refresh falhar terminalmente, ele limpa os tokens e dispara o handler `auth-lost` (`api-client.js:301-306`), que é conectado **depois do boot** para que um token expirado na inicialização caia silenciosamente no caminho anônimo em vez de abrir modal de sessão perdida.

No boot, `restoreSessionFromStorage()` carrega os tokens do storage, valida com `GET /auth/me` (que já aciona o refresh transparente se preciso) e espelha a identidade no `sessionContext`; qualquer falha limpa os tokens (`src/js/index.js:250-263`). Ver [[sessao-boot-e-ciclo-de-vida]].

> [!CONTRADICAO 2026-07-18] guia *01-autenticacao* (absorvido) §3 recomenda access token em memória/`sessionStorage` e apenas o refresh em `localStorage`; o cliente real persiste **os dois** em `localStorage` sob a chave `ebgeo_auth` (`src/js/store/sync/api-client.js:41-42` e `144-153`), degradando para memória apenas quando `localStorage` não existe. É uma escolha deliberada (a sessão precisa sobreviver ao F5), mas quem for auditar segurança deve saber que o access token está no disco do navegador.

## Rate limit em /auth: o detalhe da chave

`login`, `refresh`, `register`, `verify-email` e `resend-verification` passam pelo `authLimiter` (`auth.routes.js:15-21`), com janela de 15 min e 10 tentativas (defaults), respondendo `429 TOO_MANY_REQUESTS`.

A chave é `` `${req.ip}:${req.body?.username}` `` (`middleware/rate-limit.js:32`). Isso funciona bem para `login`, mas **o corpo do `/auth/refresh` não tem `username`**: a chave degrada para `ip:` e todos os refreshes vindos daquele IP compartilham o mesmo balde de 10 por 15 minutos. Atrás de NAT ou proxy corporativo, muitos usuários podem estrangular o refresh uns dos outros. Trate `429` como backoff, **nunca** como gatilho de logout ou de novo refresh. Mais em [[hardening-borda-api]].

## O JWT não é a última palavra

Toda verificação usa allowlist de algoritmo `['HS256']` (`src/config.js:45`), aplicada nos três pontos de verificação: REST estrito (`middleware/auth.js:30`), auth flexível global (`middleware/flexible-auth.js:61`) e handshake do WebSocket (`modules/collab/collab.gateway.js:241`). Token com `alg: none` ou assimétrico é rejeitado.

Como o access token pode estar até 15 minutos desatualizado, o middleware estrito **reconcilia contra o banco** a cada requisição (`middleware/auth.js:84-112`):

- usuário inativo → `401 Account is inactive` (para o cliente derrubar a sessão; o refresh também já foi revogado);
- organização inativa → `403 Organization is inactive`;
- o `role` **global** é sobrescrito pelo valor vivo do banco, para que um admin rebaixado não continue admin durante a janela do token.

`org_role` e `organization_id` **não** são sobrescritos de propósito: eles pertencem ao mapeamento do token, e um token legado sem claims de org degrada para `viewer`/`null` por desenho (`middleware/auth.js:37-39`, `104-107`). Ou seja, mudança de OM ou de papel org-scoped leva até 15 minutos para valer, mudança de role global vale na hora.

Principais de link público (`sub` no formato `public-<uuid>`, que não é UUID puro) são **isentos** dessa reconciliação, porque não existe linha em `users` para eles (`middleware/auth.js:80-82`). A autoridade deles vem do token assinado mais a flag `is_public` do atlas. Ver [[link-publico]] e [[permissoes-atlas]].

## Onde mais o token entra

- **WebSocket de colaboração**: o access token vai na **query string** do upgrade (`?atlasId&token&clientId`); falha de verificação encerra o upgrade com `HTTP/1.1 401`, e OM inativa ou ausência de permissão no atlas encerram com `403` (`collab.gateway.js:241-264`). Consequência: um socket aberto **não** revalida o token depois; a sessão do socket vive até o disconnect. Ver [[canal-collab-websocket]] e [[canal-collab-websocket]]. O `clientId` da query é chave de presença e idempotência, jamais credencial ([[client-id-estavel]]).
- **Auth flexível global**: `flexibleAuth` popula `req.user` a partir de `x-api-key`, cookie `token` ou `Bearer`, nesta ordem, e **nunca bloqueia** (`middleware/flexible-auth.js:42-108`). O cookie tem sessão deslizante, reemitida quando falta menos de 5 minutos para expirar, mas só depois de consultar o estado vivo do usuário, senão o deslize eternizaria uma sessão morta. Detalhes em [[auth-flexivel]] e [[api-keys]].

## Logout

`POST /auth/logout` exige `Authorization` válido e `{ refreshToken }` no corpo (`auth.routes.js:22`), revoga **apenas aquele** refresh token (`auth.service.js:183-186`) e devolve `204`. Não encerra o socket de colaboração e não invalida o access token: o fechamento do socket e o teardown de presença são responsabilidade do cliente ([[presenca-colaborativa]]).

Revogação em massa dos refresh tokens de um usuário acontece em: detecção de reuso, troca da própria senha, reset de senha por admin e desativação do usuário ([[gestao-usuarios]]).

## Registro e confirmação de e-mail

`POST /auth/register` só é **montada** quando `ALLOW_SELF_REGISTRATION` está ligada (`auth.routes.js:14-16`); desligada, a chamada cai no handler `404` genérico, sem vazar que o endpoint existe. Não assuma que a rota existe.

Quando o registro traz `email`, a conta nasce pendente e um token de verificação é emitido e enviado. O envio é **best-effort**: a linha do usuário já foi commitada, e uma falha de e-mail não pode gerar `500` (isso deixaria uma conta órfã, impossível de re-registrar e de logar). Em caso de falha, a conta fica pendente e o usuário reenvia por `POST /auth/resend-verification` (`auth.service.js:243-253`).

Conflitos de username e de e-mail devolvem a **mesma** mensagem genérica, de propósito, para o endpoint público não virar oráculo de existência (`auth.service.js:213-224`). `verifyEmail` consome o token dentro de uma transação, com a exclusão mútua na própria cláusula `WHERE consumed_at IS NULL`, porque a sequência ler-checar-escrever anterior permitia duas requisições concorrentes consumirem o mesmo token (`auth.service.js:284-297`).

## Regras de integração que evitam bug

- Trate `401`, `403` e `429` como coisas distintas: `401` aciona refresh (uma vez) e depois login; `403` de OM inativa **não** se resolve com refresh; `429` é só espera.
- Sempre substitua o refresh token armazenado pelo devolvido, e serialize os refreshes.
- Não leia claims de org a partir da resposta do `/auth/refresh`: ela não traz `user`. Decodifique o `accessToken` ou chame `GET /auth/me`.
- Não use `GET /health` para decidir online/offline no boot; o boot é fail-fast em `GET /api/config` ([[config-runtime-urls-relativas]]).
- Os aliases `org` e `login` no payload são contrato congelado consumido pelo módulo 360 ([[sintese-contratos-congelados]]).
- Login e logout **não** aparecem hoje na trilha de auditoria, apesar de constarem no CHECK da tabela ([[auditoria]]).


## Shape exato do objeto `user` no login / `GET /auth/me`

## Shape exato do objeto `user` no login / `GET /auth/me`

A resposta de `POST /api/v1/auth/login` (e a de `GET /api/v1/auth/me`) traz um objeto `user` que **não** é o payload do JWT: os nomes diferem dos claims e há campos derivados por `LEFT JOIN` que não existem no token.

```json
{
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "refreshToken": "550e8400-...-abc123...",
    "user": {
      "id": "uuid",
      "username": "cap.silva",
      "nome": "Capitão Silva",
      "posto_graduacao": "Cap",
      "organizacao_militar": "CIGEx",
      "organization_id": "org-uuid",
      "org_role": "editor",
      "role": "user"
    }
  }
}
```

| Campo da resposta | Claim JWT correspondente | Nota |
|---|---|---|
| `posto_graduacao` | `posto` | nome **diferente** entre claim e resposta REST |
| `organizacao_militar` | (não existe no token) | texto livre legado, derivado por `LEFT JOIN ranks/organizations` na leitura |
| `organization_id` | `organization_id` / alias `org` | FK estruturada |
| `org_role` | `org_role` | ausente em token legado → `viewer` |
| `role` | `role` | papel global |

Pontos que mordem na integração:

- **`organizacao_militar` (texto livre legado) e `organization_id` (FK) coexistem** deliberadamente durante a transição. Ler o primeiro e escrever o segundo é o padrão: a leitura devolve as strings, mas os corpos de escrita exigem UUID (ver [[gestao-usuarios]]).
- **`POST /auth/refresh` não devolve `user`** — só `{ accessToken, refreshToken }`. Para reler `organization_id`/`org_role` após um refresh, decodifique o access token ou chame `GET /auth/me`.
- O frontend monta a identidade a partir **deste objeto**, não dos claims (`session-context.js`); não há decode de JWT no cliente.


## Referência: rotas e corpos de `/api/v1/auth`

## Referência: rotas e corpos de `/api/v1/auth`

Superfície completa do router (`src/modules/auth/auth.routes.js:10-25`). Todas as rotas, **exceto `/logout` e `/me`**, são anônimas; todas, **exceto `/logout` e `/me`**, passam pelo `authLimiter` (10 tentativas / 15 min).

| Método | Caminho | Guarda | Rate limit | Corpo (schema) | Sucesso |
|---|---|---|---|---|---|
| POST | `/auth/register` | nenhuma | `authLimiter` | `registerSchema` | `201 { data: user }` |
| POST | `/auth/verify-email` | nenhuma | `authLimiter` | `verifyEmailSchema` | `200 { data: { success: true } }` |
| POST | `/auth/resend-verification` | nenhuma | `authLimiter` | `resendVerificationSchema` | `200` |
| POST | `/auth/login` | nenhuma | `authLimiter` | `loginSchema` | `200 { data: { accessToken, refreshToken, user } }` |
| POST | `/auth/refresh` | nenhuma | `authLimiter` | `refreshSchema` | `200 { data: { accessToken, refreshToken } }` |
| POST | `/auth/logout` | `auth` (Bearer) | não | `logoutSchema` | `204` sem corpo |
| GET | `/auth/me` | `auth` (Bearer) | não | — | `200 { data: user }` |

`/auth/register` **só é montada** quando `ALLOW_SELF_REGISTRATION` está ligada; desligada, a chamada cai no `404` genérico (ver [[gestao-usuarios]]).

### Limites de validação (Joi, `auth.schemas.js`)

| Campo | Rota(s) | Regra |
|---|---|---|
| `username` | login | obrigatório, **máx. 100** |
| `username` | register | obrigatório, **3–100**, `^[a-zA-Z0-9._-]+$` |
| `password` | login, register | obrigatório, **6–100** |
| `nome` | register | obrigatório, **máx. 255** |
| `email` | register | opcional, formato e-mail, **máx. 255** |
| `email` | resend-verification | **obrigatório**, formato e-mail, máx. 255 |
| `rank_id`, `organization_id` | register | opcionais, **UUID**, aceitam `null` e `""` |
| `refreshToken` | refresh, logout | obrigatório, string |
| `token` | verify-email | obrigatório, **UUID** |

Duas armadilhas que caem em `422 VALIDATION_ERROR`, não em `401`/`400`: senha de 5 caracteres no **login** (o mínimo de 6 vale também para autenticar, não só para cadastrar) e `token` de verificação fora do formato UUID. Ver [[erros-api]] e [[sintese-contrato-erros-http]].

O Joi é estrito quanto a campos desconhecidos: enviar `posto_graduacao`/`organizacao_militar` como texto no `register` é rejeitado (ver a contradição registrada acima).


## Referência: shapes de resposta

## Referência: shapes de resposta

Todas as respostas de sucesso vêm embrulhadas em `{ "data": ... }` (`auth.controller.js:5-25`). Os campos abaixo são os **exatos**; `posto_graduacao` e `organizacao_militar` são nomes derivados por `LEFT JOIN` em `ranks`/`organizations` (as colunas gravadas são `rank_id`/`organization_id`, ver [[gestao-usuarios]]).

### `POST /auth/login` → `200`

O objeto `user` tem **oito** campos, e não inclui `email`, `created_at` nem `last_login_at` (`auth.service.js:107-120`):

```json
{
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "refreshToken": "550e8400-e29b-41d4-a716-446655440000-<32 bytes hex>",
    "user": {
      "id": "uuid",
      "username": "cap.silva",
      "nome": "João Silva",
      "posto_graduacao": "Cap",
      "organizacao_militar": "CIGEx",
      "organization_id": "org-uuid",
      "org_role": "viewer",
      "role": "user"
    }
  }
}
```

`organization_id` cai para `null`, `org_role` para `"viewer"` e `role` para `"user"` quando ausentes na linha.

### `GET /auth/me` → `200`

Shape **diferente** do `user` do login: traz `created_at` e `last_login_at`, e **não** traz `email`/`email_verified` (`FIND_USER_BY_ID`, `auth.queries.js:15-23`):

```json
{
  "data": {
    "id": "uuid",
    "username": "cap.silva",
    "nome": "João Silva",
    "rank_id": "rank-uuid",
    "posto_graduacao": "Cap",
    "organization_id": "org-uuid",
    "organizacao_militar": "CIGEx",
    "org_role": "viewer",
    "role": "user",
    "created_at": "2024-01-15T10:30:00.000Z",
    "last_login_at": "2024-01-15T10:30:00.000Z"
  }
}
```

A query filtra `is_active = true`: uma conta desativada recebe `401 Usuário não encontrado` aqui (`auth.service.js:191-196`), e não `404`.

### `POST /auth/refresh` → `200`

```json
{ "data": { "accessToken": "eyJ...", "refreshToken": "novo-token..." } }
```

**Sem** objeto `user` — é a diferença que mais gera bug de UI. Ver [[refresh-token-rotacao]].

### `POST /auth/register` → `201`

```json
{
  "data": {
    "id": "uuid", "username": "ten.oliveira", "nome": "Tenente Oliveira",
    "rank_id": "rank-uuid", "posto_graduacao": "Ten",
    "organization_id": "org-uuid", "organizacao_militar": "CIGEx",
    "org_role": "viewer", "role": "user",
    "created_at": "2024-01-15T10:30:00.000Z",
    "email": "ten.oliveira@eb.mil.br", "email_verified": false
  }
}
```

É o único shape de `/auth` que expõe `email`/`email_verified` (`INSERT_USER`, `auth.queries.js:71-83`). `organization_id` omitido cai no `COALESCE` para a organização default `00000000-0000-0000-0000-000000000001`, e `role` é sempre `'user'`.

### `POST /auth/logout` → `204`

Sem corpo.

## Fontes

- guia *01-autenticacao* (absorvido): endpoints de login/refresh/logout/me/register, formato do par de tokens, payload do JWT e o fluxo de renovação automática no cliente.
- guia *11-seguranca-hardening* (absorvido): rate limiting das rotas de credencial, login timing-safe, rotação e detecção de reuso do refresh token, allowlist HS256 e casos de revogação em massa.
- guia *12-multiorg-identidade-auditoria* (absorvido): claims de organização no token de emissor único, degradação graciosa de tokens legados, auth flexível (Bearer/cookie/API key) e sessão deslizante do cookie.
- `ebgeo_backend/src/modules/auth/` (`auth.service.js`, `auth.routes.js`, `auth.controller.js`, `auth.schemas.js`): comportamento real de login, refresh, logout, registro e verificação de e-mail, incluindo as mensagens de erro efetivas e as portas de e-mail e de OM inativa.
- `ebgeo_backend/src/middleware/` (`auth.js`, `flexible-auth.js`, `rate-limit.js`) e `src/config.js`: verificação HS256, reconciliação do token contra o banco, isenção do principal de link público, chave do rate limiter e defaults de expiração.
- `ebgeo_backend/src/modules/collab/collab.gateway.js`: verificação do token no upgrade do WebSocket e os códigos 400/401/403 do handshake.
- `ebgeo_web/src/js/store/sync/api-client.js` e `src/js/index.js`: persistência dos tokens em `localStorage`, refresh único em voo, retry transparente em 401 e restauração da sessão no boot.
