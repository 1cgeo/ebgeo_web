# Síntese: contrato de erros HTTP da API

Mapa consolidado do envelope `{ error: { code, message } }` e de quando cada status aparece, 401 vs 429 vs 404 de rota não montada, 409 de conflito, 422 de validação Joi e 503 de banco indisponível, com a reação esperada do cliente.

## O envelope, e onde ele NÃO vale

Toda resposta de erro que passa pelo `errorHandler` sai como:

```json
{ "error": { "code": "UNAUTHORIZED", "message": "Invalid token" } }
```

`details[]` só aparece em erro de validação (Joi ou `ValidationError` com `details`), e `stack` só em dev (`error-handler.js:119-121`). O cliente materializa isso em `ApiError { message, status, code }` (`api-client.js:26-39`), montado a partir de `parsed.error` em `api-client.js:235-239`.

Três lugares fogem do envelope e são armadilha clássica:

- **Handshake do WebSocket.** Falha de token/permissão no upgrade escreve uma linha HTTP crua e destrói o socket, sem corpo JSON (`collab.gateway.js:243`, `:253`, `:261`). Ver [[canal-collab-websocket]] e [[canal-collab-websocket]].
- **Sucesso 204.** `POST /auth/logout` devolve 204 sem corpo, e `_request` retorna `null` antes de tentar parsear (`api-client.js:225`).
- **Contratos "nus" congelados.** `GET /api/config` e `GET /nomes/busca` não têm chave `data`, e portanto também não têm o envelope habitual no caminho feliz (ver [[sintese-contratos-congelados]], [[config-runtime-urls-relativas]]).

## Origem de cada status

O handler é uma cascata de cinco ramos, nesta ordem (`error-handler.js:11-124`):

| Ramo | Gatilho | Saída |
|---|---|---|
| 1 | `err.isJoi` | `422 VALIDATION_ERROR` + `details[{field,message}]` |
| 2 | `instanceof AppError` | o `statusCode`/`code` da própria classe |
| 3 | SQLSTATE do Postgres no mapa | `409`/`400` com mensagem genérica |
| 4 | `err.statusCode` 4xx sem ser `AppError` | código derivado do status |
| 5 | resto | `500 INTERNAL_ERROR` |

As classes de erro (`utils/errors.js:12-47`) fixam o par status/código: `NotFoundError` 404 `NOT_FOUND`, `ForbiddenError` 403 `FORBIDDEN`, `UnauthorizedError` 401 `UNAUTHORIZED`, `ConflictError` 409 `CONFLICT`, `ValidationError` 422 `VALIDATION_ERROR`, `BadRequestError` 400 `BAD_REQUEST`. Não existe outro caminho legítimo para inventar um par novo. Catálogo detalhado por rota em [[erros-api]].

## 401: três origens, uma reação diferente para cada

Todas devolvem `401 UNAUTHORIZED`, o que muda é a `message`:

- `Missing or invalid authorization header` (`auth.js:61`), sem Bearer na rota estrita.
- `Token expired` vs `Invalid token` (`auth.js:42-46`), a verificação usa allowlist de algoritmo (`config.jwt.algorithms`, HS256), então `alg: none` cai em `Invalid token`. Ver [[autenticacao-jwt]] e [[jwt-emissor-unico]].
- `Account is inactive` (`auth.js:95`), conta desativada revalidada contra o banco a cada requisição, porque o JWT pode estar até 15 min desatualizado. Note que **org inativa é 403, não 401** (`auth.js:98`).
- `Invalid credentials` no login, mensagem idêntica para usuário inexistente e senha errada (anti-enumeração), e o bcrypt roda sempre para não vazar timing.

Do lado do cliente, `_request` trata **qualquer** 401 numa rota autenticada como "access token expirou": faz um refresh transparente e repete uma vez (`api-client.js:231-233`). Ou seja, um 401 por conta desativada também dispara um refresh, que falha (a desativação revoga os refresh tokens), e aí o cliente cai em `clearTokens()` + `_notifyAuthLost()` (`api-client.js:300-307`). O resultado final está certo, mas o caminho passa por uma ida extra ao servidor. Não escreva lógica de UI em cima da `message`, ela varia entre dev e produção (ramo 4 do handler, `error-handler.js:98`).

## 429: nunca trate como 401

Rate limit responde `429 TOO_MANY_REQUESTS` com mensagem em português fixa (`rate-limit.js:5-12`) e headers `RateLimit-Limit/Remaining/Reset`. Limitador estrito (default 10 por 15 min) em `/auth/login`, `/auth/refresh`, `/auth/register`, `/auth/verify-email`, `/auth/resend-verification` (`auth.routes.js:15-21`), e limitador frouxo por IP (30 por minuto) em `GET /atlas/public/:link` (ver [[link-publico]]). Detalhes de borda em [[hardening-borda-api]].

Regra dura: **429 não é logout e não é refresh**. É backoff. O `_request` do cliente só ramifica em 401, então um 429 vira `ApiError` normal, o que está correto.

> **Nota histórica.** guia *11-seguranca-hardening* (absorvido) §1.1 diz que o limitador de credenciais é chaveado por "IP + username", de modo que "um IP barulhento não bloqueie todo mundo". O código em `src/middleware/rate-limit.js:32` monta a chave como `` `${req.ip}:${(req.body?.username || '').toLowerCase()}` ``, e o corpo de `/auth/refresh` só tem `refreshToken` (`auth.schemas.js:9-11`). Logo, para refresh (e para verify-email/resend-verification) a chave degenera para `ip:`, um balde único por IP compartilhado entre todas essas rotas. Consequência prática: atrás de NAT ou proxy sem `trust proxy`, 10 refreshes em 15 minutos esgotam o balde de toda a rede.

Isso importa porque `refresh()` do cliente trata **qualquer** falha como sessão perdida: 429 no refresh cai no mesmo `catch` que token expirado e derruba a sessão (`api-client.js:300-307`). Refresh concorrente já é serializado por `this._refreshing` (`api-client.js:290`), o que também protege contra a detecção de reuso descrita em [[refresh-token-rotacao]].

## 404 de rota não montada vs 404 de recurso

O `code` é o mesmo (`NOT_FOUND`), a `message` é o que distingue:

- **Rota inexistente ou não montada**: `Route not found`, do catch-all em `app.js:122-124` (`new NotFoundError('Route')` gera `"${resource} not found"`, `errors.js:14`).
- **Recurso inexistente**: `Atlas not found`, `User not found`, etc.

O caso emblemático é `POST /auth/register`: quando `ALLOW_SELF_REGISTRATION` está desligado (default em produção) a rota **não é registrada** (`auth.routes.js:14`), então cai no catch-all e retorna 404, não 403, para não confirmar a existência do endpoint.

> **Nota histórica.** guia *11-seguranca-hardening* (absorvido) §8 sugere "tentar o endpoint e, ao receber 404, ocultar a opção". O código já expõe o flag diretamente: `src/modules/config/config.service.js:144` publica `features.self_registration` em `GET /api/config`. Sondar a rota é pior por dois motivos: ela está sob o `authLimiter` (`auth.routes.js:15`) e a sonda não tem `username` no corpo, então consome o balde `ip:` compartilhado com `/auth/refresh`. Use o `features` do config ([[config-dinamico]]).

## 403 vs 404 em atlas: a existência vaza de propósito

`requireAtlasPermission` devolve **404** quando o atlas não existe ou está soft-deleted (`permissions.js:73-75`), e **403** quando existe mas o principal não alcança o nível exigido (`permissions.js:111-119`, `Access denied` para permissão nula, `Insufficient permissions` para nível insuficiente). Portanto um 403 confirma que aquele UUID de atlas existe. Admin global recebe nível `owner` em qualquer atlas (`permissions.js:82-87`). Hierarquia e mapeamento de papéis em [[permissoes-atlas]], [[permissoes-atlas]] e [[sintese-eixos-de-permissao]].

Requisições sem credencial não são barradas globalmente: `flexibleAuth` popula `req.user` quando há Bearer, cookie ou api key e segue anônimo caso contrário (`app.js:70`), quem barra é a rota. Ver [[auth-flexivel]] e [[api-keys]].

## 409: conflito de estado, não de validação

Aparece em quatro famílias:

- **Unicidade explícita**: username/e-mail já cadastrado (`auth.service.js:215`, `users.service.js:114`), slug de organização duplicado (`organizations.service.js:19`), id de item de catálogo já existente (`catalog.service.js:44`). Ver [[gestao-usuarios]], [[organizacoes-om]], [[resources-catalogo]].
- **Unicidade implícita do banco**: SQLSTATE `23505` vira `409 CONFLICT` com `Resource already exists`, e `23503` (FK) vira `409` com `Referenced resource not found or still in use` (`error-handler.js:61-62`). A mensagem é genérica de propósito, o texto do driver expõe nomes de coluna e constraint.
- **Guardas de auto-sabotagem**: desativar ou rebaixar a própria conta via `PUT /users/:id` é `409` (`users.service.js:144`, `:147`), mas o mesmo ato via `DELETE /users/:userId` é `403` (`users.service.js:211`). São rotas diferentes com status diferentes para a mesma intenção; não unifique o tratamento pela intenção, trate por rota. Desativar um usuário com atlas sem informar `transferTo` é `409` (`users.service.js:225`).
- **Mapa travado no sync**: `ConflictError('Map is locked')` ao escrever numa entidade filha de um mapa bloqueado (`sync.service.js:1295`).

O único lugar do frontend que ramifica por conflito hoje é `admin/users-tab.js:447`, que aceita tanto `status === 409` quanto `code === 'CONFLICT'`. Esse é o padrão a copiar: cheque o par, não só a `message`.

## 422 (Joi) vs 400 (Postgres e body-parser)

Erro de forma tem **dois** status possíveis, e a diferença é onde a checagem acontece:

- **422** quando existe schema Joi na rota. `validate()` roda com `abortEarly: false` e `stripUnknown: true` (`validate.js:3-6`), então `details[]` traz **todos** os campos ruins de uma vez, cada um como `{ field, message }` com `field` já achatado por `path.join('.')` (`error-handler.js:33-36`). Campos desconhecidos são silenciosamente removidos, não rejeitados: se o cliente manda uma propriedade nova e o servidor é antigo, a requisição passa com o campo apagado.
- **400** quando não existe schema e o valor ruim chega ao banco. `GET /atlas/:atlasId` não valida params (`atlas.routes.js:26`), então um `atlasId` não-UUID vira SQLSTATE `22P02` e sai como `400 BAD_REQUEST` com `Malformed value (invalid id or type)` (`error-handler.js:65`). Já `POST /atlas/:atlasId/restore` valida params (`atlas.routes.js:31`) e devolve 422 para o mesmo input. Mesma classe de erro, dois status, dependendo da rota.

Também caem em 400 via mapa SQLSTATE: `23502` campo obrigatório ausente, `23514` violação de CHECK, `22003` numérico fora de faixa.

Uploads de imagem são 400 em todas as rejeições: tipo fora da allowlist png/jpeg/webp (`images.routes.js:43`), conteúdo que não bate com o MIME declarado por magic bytes (`images.service.js:48`), e arquivo grande demais, onde o `MulterError(LIMIT_FILE_SIZE)` é convertido a mão em `BadRequestError` para não virar 500 (`images.routes.js:53-57`). No lote base64 a falha é **por item**, dentro de `failed[]`, com HTTP 200. Ver [[upload-imagens-seguranca]] e [[imagens-atlas]].

**413 `PAYLOAD_TOO_LARGE`** vem do body-parser, não de `AppError`: o limite global de JSON é 10 MB e o de `/images/bulk` é `MAX_BULK_UPLOAD_MB` (default 50 MB), selecionado por um parser dedicado antes do global (`app.js:59-66`). O ramo 4 do handler deriva o `code` do status para não rotular um 413 como `BAD_REQUEST` (`error-handler.js:86-107`).

## 503: só o health check

`GET /api/v1/health` é o único ponto que emite `503 SERVICE_UNAVAILABLE` com `Database unavailable`, e ele o faz inline, sem passar pelo `errorHandler` (`app.js:78-87`). Uma falha de banco em qualquer outra rota vira `500 INTERNAL_ERROR`.

Trap operacional: 503 aqui é para orquestrador (readiness), **não** para o boot do frontend. O app decide disponibilidade por `GET /api/config` com fail-fast, e o frontend não chama `/health` em lugar nenhum. Ver [[sessao-boot-e-ciclo-de-vida]] e [[deploy-backend]].

## Erros do push de operações: o batch é atômico

`POST /atlas/:atlasId/sync` roda o lote inteiro dentro de uma transação (`sync.controller.js:7-13` chamando `sync.service.js:pushOperations`), e as guardas por operação lançam para fora dela:

- `403` `Read-only users cannot send operations`, `Comentaristas só podem criar ou editar comentários`, `Only the atlas owner can delete a map`, `Only the atlas owner can lock or unlock a map` (`sync.service.js:603-617`).
- `409` `Map is locked` (`sync.service.js:1295`).

Uma única operação recusada **desfaz o lote inteiro**. E o cliente, por desenho, não descarta lote rejeitado: em erro de push ele registra o span `flush.push` como `FAILED` e relança sem dequeue, de modo que os mesmos `opIds` são reofertados no próximo ciclo (`sync-engine.js:271-283`). Como o auto-flush roda a cada 1,5 s e engole a exceção com um `console.warn` (`sync-flush.js:82-83`), uma operação permanentemente proibida vira **poison batch**: fila travada, retry infinito, nenhuma sinalização na UI. A intenção do desenho é não perder trabalho local diante de erro transitório; o custo é que erro permanente precisa ser detectado por fora (o `traceId` do span nomeia os `opIds` presos, ver [[syncledger]]). Contexto em [[fila-operacoes-outbound]], [[ack-idempotencia]] e [[sintese-rest-vs-sync]].

Note também que as rotas de sync **não** têm rate limit, então 429 nunca aparece no caminho de colaboração.

## Checklist para não errar

- Ramifique por `{ status, code }`, nunca pela `message`, ela muda entre dev e produção e entre versões.
- 401 dispara refresh (uma vez). 429 dispara backoff. 403 nunca dispara nenhum dos dois, é decisão final, mostre a mensagem e pare.
- 404 com `Route not found` significa recurso do servidor ausente ou funcionalidade desligada, não "id inexistente".
- 422 traz `details[]` para marcar campos no formulário; 400 do mapa SQLSTATE não traz, e é intencional.
- No handshake do WS não espere JSON, leia o status da linha de upgrade.
- Um push de sync rejeitado por 403/409 não é retryable, e mesmo assim será retentado para sempre. Trate a causa (permissão, mapa destravado), não o sintoma.

## Fontes

- guia *11-seguranca-hardening* (absorvido): rate limiting (janelas, headers `RateLimit-*`), login timing-safe e mensagem genérica, allowlist HS256, hardening de upload/download de imagens, health check 503, gate de self-registration e a tabela resumo de status.
- guia *12-multiorg-identidade-auditoria* (absorvido): tabela canônica 401/403/404/409/422 do módulo multi-org, comportamento não-bloqueante do `flexibleAuth` e erros das rotas de organização e de API key.
- guia *09-admin* (absorvido): matriz de erros de desativação de usuário (403 auto-desativação, 404 usuário ou destinatário, 409 usuário com atlas sem `transferTo`).
- guia *01-autenticacao* (absorvido): fluxo login/refresh/logout, padrão de retry em 401, rotação obrigatória do refresh token e 409 de username duplicado no registro.
- Código do backend (`src/utils/errors.js`, `src/middleware/{error-handler,validate,rate-limit,auth,permissions}.js`, `src/app.js`, `src/modules/{auth,users,sync,images,collab,config}/`): pares status/código reais, ordem dos ramos do handler, mapa SQLSTATE, chave real do rate limiter e atomicidade do push.
- Código do frontend (`src/js/store/sync/{api-client,sync-engine,sync-flush}.js`, `src/js/admin/users-tab.js`): construção do `ApiError`, refresh transparente em 401, perda de sessão em refresh falho e o comportamento de poison batch da fila.
