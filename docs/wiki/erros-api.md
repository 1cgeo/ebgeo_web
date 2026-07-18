# Contrato de Erros da API

Todos os erros trafegam no envelope `{ error: { code, message } }` com códigos padronizados (VALIDATION_ERROR 422, UNAUTHORIZED 401, FORBIDDEN 403, NOT_FOUND 404, INTERNAL_ERROR 500, mais um conjunto de 4xx derivados) cujo tratamento no cliente é dirigido pelo status, notadamente 401 aciona refresh de token e 403/404 distinguem falta de permissão de atlas inexistente.

## O envelope

Sucesso e erro usam envelopes distintos e mutuamente exclusivos:

- sucesso: `{ "data": ... }` (o cliente desembrulha em `_unwrap`, `api-client.js:260-265`; contratos "nus" como o objeto de config e arrays passam direto por não terem a chave `data`)
- erro: `{ "error": { "code", "message" } }`, opcionalmente com `details`

Nenhuma rota inventa formato próprio: tudo passa pelo `errorHandler` registrado por último na cadeia (`ebgeo_backend/src/middleware/error-handler.js:11`). Um erro só chega ao cliente fora desse envelope se escapar do Express (ex.: proxy/nginx respondendo 502 em HTML). O cliente tolera isso: `_parseBody` (`api-client.js:246-254`) devolve o texto cru quando o corpo não é JSON, e o `ApiError` cai no fallback `HTTP <status>`.

## Origem dos códigos

As classes de erro em `ebgeo_backend/src/utils/errors.js` fixam o par (status, code):

| Classe | HTTP | `code` |
|---|---|---|
| `ValidationError` (`errors.js:36`) | 422 | `VALIDATION_ERROR` |
| `UnauthorizedError` (`errors.js:24`) | 401 | `UNAUTHORIZED` |
| `ForbiddenError` (`errors.js:18`) | 403 | `FORBIDDEN` |
| `NotFoundError` (`errors.js:12`) | 404 | `NOT_FOUND` |
| `ConflictError` (`errors.js:30`) | 409 | `CONFLICT` |
| `BadRequestError` (`errors.js:43`) | 400 | `BAD_REQUEST` |

`AppError` marca `isOperational = true` (`errors.js:8`) para separar erro esperado de bug de programação.

O conjunto de códigos que o cliente pode receber é **maior** que a tabela de 5 do guia, porque o handler também sintetiza códigos a partir do status para erros que não são `AppError` (`error-handler.js:86-107`): `BAD_REQUEST` 400, `PAYLOAD_TOO_LARGE` 413, `UNSUPPORTED_MEDIA_TYPE` 415, `TOO_MANY_REQUESTS` 429 (também emitido direto pelo rate limiter, `middleware/rate-limit.js:6-8`), além de `CONFLICT` 409.

> [!CONTRADICAO 2026-07-18] `docs/guias/02-atlas-basico.md:446-454` apresenta uma tabela de 5 códigos como "Códigos Comuns"; o código em `ebgeo_backend/src/middleware/error-handler.js:87-97` e `src/utils/errors.js:30-47` emite ainda `CONFLICT` (409), `BAD_REQUEST` (400), `PAYLOAD_TOO_LARGE` (413), `UNSUPPORTED_MEDIA_TYPE` (415) e `TOO_MANY_REQUESTS` (429). Tratar a lista de 5 como conjunto fechado leva a `switch` incompleto no cliente.

## Erros de validação (422) e o campo `details`

Schemas Joi validados por `middleware/validate.js:15-29` usam `abortEarly: false` e `stripUnknown: true`, então um payload ruim volta com **todos** os campos inválidos de uma vez, e campos desconhecidos são silenciosamente removidos em vez de rejeitados. O handler converte o erro Joi em 422 com `details: [{ field, message }]` (`error-handler.js:28-39`), onde `field` é o caminho com pontos (`settings.max_zoom`). `ValidationError` lançada manualmente também propaga `details` se fornecido (`error-handler.js:50-52`).

Armadilha: o `ApiError` do cliente guarda apenas `message`, `status` e `code` (`src/js/store/sync/api-client.js:33-38`). O array `details` é descartado no `throw` em `api-client.js:236-239`. Quem quiser destacar campo a campo em formulário precisa alterar o `ApiError`, não adianta procurar `error.details` no frontend hoje.

## 403 versus 404: o que cada um significa

A distinção é deliberada e resolvida em `ebgeo_backend/src/middleware/permissions.js`:

1. atlas inexistente **ou** com `deleted_at` preenchido, o SELECT filtra `deleted_at IS NULL` e retorna zero linhas, `NotFoundError` 404 (`permissions.js:69-75`)
2. atlas existe mas `resolvePermission` devolve `null` (não é dono, não há share, não é público), `ForbiddenError('Access denied')` 403 (`permissions.js:111-113`)
3. atlas existe e há permissão, mas abaixo do nível exigido, `ForbiddenError('Insufficient permissions')` 403 (`permissions.js:118-120`)

Ou seja, 403 **vaza a existência** do atlas de propósito, para que a UI possa dizer "você não tem acesso" em vez de "não existe". Isso é uma escolha de usabilidade, não um descuido; se algum dia o requisito virar não-enumerabilidade, o ponto único de mudança é `permissions.js:111`. Detalhes da hierarquia em [[permissoes-atlas]] e [[compartilhamento-atlas]].

Armadilha: `atlasId` malformado (não-UUID) **não** dá 404. A query vai ao Postgres, estoura SQLSTATE `22P02` e o mapa de erros do PG devolve **400 BAD_REQUEST** com mensagem genérica (`error-handler.js:65`). Um cliente que só trata 403/404 mostra "erro inesperado" para um link quebrado. O mesmo mapa converte `23505` em 409 `CONFLICT` e `23503`/`23502`/`23514`/`22003` em 409/400 (`error-handler.js:60-73`), sempre com mensagem genérica, porque o texto do driver expõe nomes de coluna e constraint.

Admin global tem atalho: `req.user.role === 'admin'` recebe `owner` em qualquer atlas antes de qualquer checagem de share (`permissions.js:82-87`), logo nunca vê 403 em rota de atlas. Ver [[gestao-usuarios]].

## 401 e o refresh transparente

O guia mostra um `switch` no cliente que, no 401, chama `refreshTokens()` manualmente. **O cliente real não faz isso na camada de chamada**: o retry está dentro do transporte. Em `api-client.js:229-240`, um 401 com `_retry` ativo, requisição autenticada e refresh token presente dispara `await this.refresh()` e **repete a requisição uma vez** com `_retry: false`. Só se o retry também falhar o `ApiError` sobe.

Pontos que evitam laço infinito e tempestade de refresh:

- `refresh()` compartilha uma única promessa em voo (`_refreshing`, `api-client.js:289-311`), então uma rajada de requisições concorrentes gera um só POST `/auth/refresh`
- a própria chamada de refresh vai com `auth: false, _retry: false` (`api-client.js:295-299`), logo um 401 nela não se auto-retenta
- falha terminal limpa os tokens e dispara `_notifyAuthLost()` no máximo uma vez por sessão (`api-client.js:301-306`, guarda `_authLostFired` em `api-client.js:73-74, 88-89`)
- o handler de auth-lost é ligado **depois** do boot, de propósito: token expirado no boot cai em anônimo silenciosamente em vez de abrir modal de login (`api-client.js:78-81`)

Ver [[refresh-token-rotacao]] e [[autenticacao-jwt]].

Armadilha: dois métodos não passam por `_request` e portanto **não têm refresh automático**, `uploadImage` (`api-client.js:857-873`, multipart) e `fetchImageBlob` (`api-client.js:916-923`, resposta binária). Um upload longo que atravessa a expiração do access token falha com 401 puro. Pior: `fetchImageBlob` lança `ApiError('HTTP <status>')` **sem `code`**, porque não parseia o corpo. Não escreva lógica que dependa de `error.code` no caminho de imagens, use `error.status`. Ver [[imagens-atlas]].

## Tratamento no cliente é por status, não por code

O consumo real é por `error.status` (ou `error.statusCode`), como em `src/js/index.js:186-194`, no deep-link de atlas:

- 403, "Você não tem acesso a este projeto."
- 404, "Projeto não encontrado."
- qualquer outro, mensagem genérica, e a URL do atlas é limpa para que um F5 não repita a falha

Isso é o padrão a seguir: o `code` serve para desambiguar dentro de um mesmo status (por exemplo 409 `CONFLICT` em `src/js/admin/users-tab.js:447` checa `err?.status === 409 || err?.code === 'CONFLICT'`), e o status decide o fluxo. Só o transporte trata 401.

## INTERNAL_ERROR e vazamento de informação

Erro não reconhecido vira 500 `INTERNAL_ERROR` (`error-handler.js:109-123`). A `message` é a real **apenas em dev** (`config.isDev`); em produção é `'Something went wrong'`, e o `stack` só é anexado em dev (`error-handler.js:114-121`). O mesmo critério vale para 4xx genéricos: a mensagem original só é repassada se `err.expose === true` (convenção do `http-errors`, seguida pelo body-parser) ou em dev, senão vira `'Bad request'` (`error-handler.js:98-100`).

Consequência prática: nunca escreva a mensagem do backend direto na UI de produção esperando algo útil em 500. Use texto próprio por status. Ver [[hardening-borda-api]].

Log: 4xx (Joi, `AppError` 4xx, body-parser) vai em `warn`, 5xx em `error`, e a URL passa por `redactUrl` para que uma credencial em `?api_key=` não caia no log (`error-handler.js:16-25`). Ver [[api-keys]].

## WebSocket usa outro formato

O canal de colaboração **não** usa este envelope. Erros lá são mensagens `{ type: 'error', code, ... }` (`ebgeo_backend/src/modules/collab/collab.handlers.js:19-20, 117-118, 155-156, 168-169, 202-203, 279-280`), com códigos que não existem no REST, notadamente `OPERATION_FAILED` e `SYNC_FAILED`, além de `VALIDATION_ERROR` e `FORBIDDEN` reaproveitados. Não compartilhe o parser de erro entre REST e WS. Ver [[websocket-collab]], [[canal-collab-websocket]] e [[sintese-rest-vs-sync]].

## Checklist para não errar

- desembrulhe `data` no sucesso, `error` no fracasso, e aceite corpo vazio (204 no logout e no delete de imagem retorna `null`, `api-client.js:225`)
- ramifique por `status`; use `code` só para desambiguar dentro do status
- não trate 401 na sua camada, o `_request` já retentou uma vez
- separe 403 (existe, sem acesso) de 404 (não existe ou deletado) e de 400 (id malformado)
- não conte com `details` chegando ao frontend hoje
- não reutilize o parser REST no WebSocket

Relacionados: [[api-rest-atlas]], [[atlas]], [[atlas-settings]], [[clone-atlas]], [[auth-flexivel]], [[sintese-contrato-erros-http]].

## Fontes

- `docs/guias/02-atlas-basico.md`: formato do envelope de erro, tabela de códigos comuns, resolução de permissão 403 vs 404, exemplo de tratamento no frontend (§8 e §9)
- `ebgeo_backend/src/utils/errors.js`: classes de erro e o par (statusCode, code) canônico, incluindo `ConflictError` e `BadRequestError` ausentes do guia
- `ebgeo_backend/src/middleware/error-handler.js`: envelope único, conversão de erro Joi com `details`, mapa SQLSTATE do Postgres, códigos derivados de status 4xx, política de mensagem/stack em dev vs prod, níveis de log e redação de URL
- `ebgeo_backend/src/middleware/validate.js`: `abortEarly: false` e `stripUnknown: true` nos schemas Joi
- `ebgeo_backend/src/middleware/permissions.js`: 404 para atlas ausente ou soft-deleted, 403 para acesso negado e permissão insuficiente, atalho de admin global
- `ebgeo_backend/src/middleware/rate-limit.js`: 429 `TOO_MANY_REQUESTS`
- `ebgeo_backend/src/modules/collab/collab.handlers.js`: formato de erro distinto no WebSocket (`OPERATION_FAILED`, `SYNC_FAILED`)
- `src/js/store/sync/api-client.js`: `ApiError` (perde `details`), desembrulho de `data`, refresh transparente com guarda de recursão e promessa compartilhada, auth-lost único, caminhos de imagem sem refresh automático
- `src/js/index.js`: consumo real por status no deep-link de atlas (403/404/genérico)
