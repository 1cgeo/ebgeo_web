# Síntese: contrato de erros HTTP da API

O que o catálogo de status não conta: onde o envelope `{ error: { code, message } }` não vale, onde o mesmo input rende dois status diferentes, e por que um push de sync rejeitado nunca sai da fila.

O envelope e a cascata de cinco ramos estão inteiros em `backend/src/middleware/error-handler.js:11-124`; os pares status/código em `utils/errors.js:12-47`. Catálogo por rota em [[erros-api]]. O que segue é só o que a leitura desses arquivos não entrega.

## Três lugares onde o envelope não existe

- **Handshake do WebSocket.** Falha de token ou permissão no upgrade escreve uma linha HTTP crua e destrói o socket, sem corpo (`backend/src/modules/collab/collab.gateway.js:243`, `:253`, `:261`). Não tente parsear JSON ali, leia o status da linha de upgrade. Ver [[canal-collab-websocket]].
- **204 do logout.** `_request` retorna `null` antes de tentar parsear (`src/js/store/sync/api-client.js:225`), então "resposta vazia" não é erro.
- **Contratos nus.** `GET /api/config` e `GET /nomes/busca` não têm chave `data` e passam intactos por `_unwrap`. Ver [[sintese-contratos-congelados]], [[config-runtime-urls-relativas]].

## O 401 que vira um round-trip inútil

O cliente trata **qualquer** 401 em rota autenticada como "access token expirou": refresh transparente e uma repetição (`src/js/store/sync/api-client.js:231-233`). Mas 401 tem outras origens, e uma delas é `Account is inactive` (`backend/src/middleware/auth.js:95`), revalidada contra o banco a cada requisição porque o JWT fica até 15 min desatualizado. Nesse caso o refresh também falha (a desativação revoga os refresh tokens), o cliente cai em `clearTokens()` + `_notifyAuthLost()` (`src/js/store/sync/api-client.js:300-307`) e o resultado final está certo, ao custo de uma ida extra ao servidor.

Cuidado com a fronteira: **organização inativa é 403, não 401** (`backend/src/middleware/auth.js:98`), justamente para não disparar esse refresh. Se um dia alguém mudar esse 403 para 401, cria-se um loop de refresh inútil por requisição.

Nunca ramifique pela `message`: no ramo 4 do handler ela só é repassada quando `err.expose` é verdadeiro ou em dev (`backend/src/middleware/error-handler.js:98`), ou seja, o texto muda entre dev e produção.

## 429 não é logout, e o balde é mais compartilhado do que parece

429 é backoff, nunca refresh nem logout. O `_request` só ramifica em 401, então um 429 vira `ApiError` comum, o que está correto.

> **[!CONTRADICAO]** O guia *11-seguranca-hardening* (absorvido) §1.1 afirma que o limitador de credenciais é chaveado por "IP + username", para que "um IP barulhento não bloqueie todo mundo". A chave real é `` `${req.ip}:${(req.body?.username || '').toLowerCase()}` `` (`backend/src/middleware/rate-limit.js:32`), e o corpo de `/auth/refresh` só tem `refreshToken` (`backend/src/modules/auth/auth.schemas.js:9-11`). Para refresh, verify-email e resend-verification a chave degenera para `ip:`, um balde único por IP compartilhado entre essas rotas. Atrás de NAT, ou de proxy sem `trust proxy`, 10 refreshes em 15 minutos esgotam o balde de toda a rede.

O agravante está no cliente: `refresh()` trata qualquer falha como sessão perdida, então um 429 no refresh cai no mesmo `catch` do token expirado e derruba a sessão (`src/js/store/sync/api-client.js:300-307`). Refresh concorrente já é serializado por `this._refreshing` (`src/js/store/sync/api-client.js:290`), o que também evita disparar a detecção de reuso de [[refresh-token-rotacao]]. Bordas em [[hardening-borda-api]].

## 404 pode significar "funcionalidade desligada"

Com `ALLOW_SELF_REGISTRATION` desligado (default em produção) a rota `POST /auth/register` **não é registrada** (`backend/src/modules/auth/auth.routes.js:14`), cai no catch-all de `backend/src/app.js:122-124` e retorna 404, não 403, para não confirmar a existência do endpoint. Distinga pela `message`: `Route not found` é rota ausente, `Atlas not found` é recurso ausente.

> **[!CONTRADICAO]** O mesmo guia §8 sugere "tentar o endpoint e, ao receber 404, ocultar a opção". Não sonde: a rota está sob o `authLimiter` (`backend/src/modules/auth/auth.routes.js:15`) e a sonda não tem `username` no corpo, logo consome o balde `ip:` compartilhado com `/auth/refresh`. O flag já é publicado como `features.self_registration` em `GET /api/config` (`backend/src/modules/config/config.service.js:144`). Ver [[config-dinamico]].

## Em atlas, a existência vaza de propósito

`requireAtlasPermission` devolve 404 quando o atlas não existe ou está soft-deleted, e 403 quando existe mas o principal não alcança o nível exigido (`backend/src/middleware/permissions.js:73-75`, `:111-119`). Portanto **um 403 confirma que aquele UUID de atlas existe**. É deliberado: sem isso, um colaborador removido não conseguiria distinguir "perdi acesso" de "o projeto sumiu". Admin global recebe nível `owner` em qualquer atlas (`backend/src/middleware/permissions.js:82-87`). Ver [[permissoes-atlas]], [[sintese-eixos-de-permissao]].

Não existe barreira global de credencial: `flexibleAuth` segue anônimo quando não há Bearer, cookie ou api key (`backend/src/app.js:70`); quem barra é a rota. Ver [[auth-flexivel]], [[api-keys]].

## A mesma intenção, dois status, duas rotas

Desativar ou rebaixar a própria conta via `PUT /users/:id` é **409** (`backend/src/modules/users/users.service.js:144`, `:147`); o mesmo ato via `DELETE /users/:userId` é **403** (`backend/src/modules/users/users.service.js:211`). Não unifique o tratamento pela intenção do usuário, trate por rota. Ver [[gestao-usuarios]].

O único ponto do frontend que ramifica por conflito é `admin/users-tab.js:447`, e aceita tanto `status === 409` quanto `code === 'CONFLICT'`. Esse é o padrão a copiar: cheque o par, nunca só a `message`.

## Validação: 422 ou 400 conforme a rota, não conforme o erro

Se a rota tem schema Joi, input ruim é 422 com `details[]`. Se não tem, o valor ruim chega ao banco e o mapa SQLSTATE o converte em 400. `GET /atlas/:atlasId` não valida params (`backend/src/modules/atlas/atlas.routes.js:26`) e um `atlasId` não-UUID sai como `400 BAD_REQUEST`; `POST /atlas/:atlasId/restore` valida (`backend/src/modules/atlas/atlas.routes.js:31`) e devolve 422 para o mesmo input. Só o 422 traz `details[]` para marcar campos de formulário, e essa ausência no 400 é intencional (as mensagens do driver expõem nomes de coluna e constraint, por isso são genéricas em `backend/src/middleware/error-handler.js:60-67`).

**Armadilha de compatibilidade:** `validate()` roda com `stripUnknown: true` (`backend/src/middleware/validate.js:3-6`), então campo desconhecido é silenciosamente **removido**, não rejeitado. Um cliente novo contra um servidor antigo recebe 200 com o campo apagado. Nenhum status sinaliza isso.

Outra ausência de sinal: no lote base64 de imagens a falha é **por item**, dentro de `failed[]`, com HTTP 200 (`backend/src/modules/images/images.service.js:126`, `:143`). Um 200 ali não significa que tudo entrou. Ver [[upload-imagens-seguranca]], [[imagens-atlas]].

## 503 é para o orquestrador, não para o boot

`GET /api/v1/health` é o único emissor de `503 SERVICE_UNAVAILABLE`, e o faz inline, sem passar pelo `errorHandler` (`backend/src/app.js:78-87`). Falha de banco em qualquer outra rota vira 500. O frontend não chama `/health` em lugar nenhum: disponibilidade é decidida por `GET /api/config` com fail-fast. Ver [[sessao-boot-e-ciclo-de-vida]], [[deploy-backend]].

## Poison batch: erro permanente tratado como transitório

`POST /atlas/:atlasId/sync` roda o lote inteiro em uma transação, e as guardas por operação lançam para fora dela (`backend/src/modules/sync/sync.service.js:603-617` para 403 de papel, `:1295` para `409 Map is locked`). **Uma única operação recusada desfaz o lote inteiro.**

O cliente, por desenho, não descarta lote rejeitado: registra o span `flush.push` como `FAILED` e relança sem dequeue, de modo que os mesmos `opIds` são reofertados no ciclo seguinte (`src/js/store/sync/sync-engine.js:271-283`). Como o auto-flush roda a cada 1,5 s e engole a exceção com um `console.warn` (`src/js/store/sync/sync-flush.js:82-83`), uma operação **permanentemente** proibida vira fila travada com retry infinito e nenhuma sinalização na UI.

A intenção é não perder trabalho local diante de erro transitório, e a alternativa rejeitada foi descartar o lote no erro, que perderia edição legítima durante uma queda. O custo é que erro permanente precisa ser detectado por fora: o `traceId` do span nomeia os `opIds` presos (ver [[syncledger]]). Trate a causa (conceder permissão, destravar o mapa), nunca o sintoma. As rotas de sync não têm rate limit, então 429 nunca aparece no caminho de colaboração. Ver [[fila-operacoes-outbound]], [[ack-idempotencia]], [[sintese-rest-vs-sync]].

## Fontes

Guias absorvidos *11-seguranca-hardening*, *12-multiorg-identidade-auditoria*, *09-admin* e *01-autenticacao* (as duas contradições acima vêm do §1.1 e do §8 do primeiro). Código: `src/utils/errors.js`, `src/middleware/{error-handler,validate,rate-limit,auth,permissions}.js`, `src/app.js`, `src/modules/{auth,users,sync,images,collab,config}/` no backend; `src/js/store/sync/{api-client,sync-engine,sync-flush}.js` e `src/js/admin/users-tab.js` no frontend.
