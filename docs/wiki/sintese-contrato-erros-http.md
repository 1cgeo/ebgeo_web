# Síntese: contrato de erros HTTP da API

O que o catálogo de status não conta: onde o envelope `{ error: { code, message } }` não vale, onde o mesmo input rende dois status diferentes, e por que um push de sync rejeitado nunca sai da fila.

O envelope e a cascata de cinco ramos estão inteiros em `backend/src/middleware/error-handler.js:11-124`; os pares status/código em `backend/src/utils/errors.js` (o arquivo inteiro é essa lista). Não recorte o intervalo ao ler: a citação `:12-47` que esta linha carregou até 2026-07-25 parava em `BadRequestError` e excluía `ServiceUnavailableError`, acrescentado no fim do arquivo, que é justamente o par que a matriz de status mais erra.

**Divisão com [[erros-api]]:** aqui está a semântica de quem *emite* (qual rota devolve qual status e por quê); lá está o comportamento de quem *consome*, o que o cliente descarta e o que ele já resolveu antes do seu `catch`.

## Três lugares onde o envelope não existe

- **Handshake do WebSocket.** Falha de token ou permissão no upgrade escreve uma linha HTTP crua e destrói o socket, sem corpo (`backend/src/modules/collab/collab.gateway.js:243`, `:253`, `:261`). Não tente parsear JSON ali, leia o status da linha de upgrade. Ver [[canal-collab-websocket]].
- **204 do logout.** `_request` retorna `null` antes de tentar parsear (`frontend/src/js/store/sync/api-client.js:225`), então "resposta vazia" não é erro.
- **Contratos nus.** `GET /api/config` e `GET /nomes/busca` não têm chave `data` e passam intactos por `_unwrap`. Ver [[sintese-contratos-congelados]], [[config-runtime-urls-relativas]].

## O 401 que vira um round-trip inútil

O cliente trata **qualquer** 401 em rota autenticada como "access token expirou": refresh transparente e uma repetição (`frontend/src/js/store/sync/api-client.js:231-233`). Mas 401 tem outras origens, e uma delas é `Account is inactive` (`backend/src/middleware/auth.js:95`), revalidada contra o banco a cada requisição porque o JWT fica até 15 min desatualizado. Nesse caso o refresh também falha (a desativação revoga os refresh tokens), o cliente cai em `clearTokens()` + `_notifyAuthLost()` (`frontend/src/js/store/sync/api-client.js:300-307`) e o resultado final está certo, ao custo de uma ida extra ao servidor.

Cuidado com a fronteira: **organização inativa é 403, não 401** (`backend/src/middleware/auth.js:98`), justamente para não disparar esse refresh. Se um dia alguém mudar esse 403 para 401, cria-se um loop de refresh inútil por requisição.

Nunca ramifique pela `message`: no ramo 4 do handler ela só é repassada quando `err.expose` é verdadeiro ou em dev (`backend/src/middleware/error-handler.js:98`), ou seja, o texto muda entre dev e produção.

## 429 não é logout, e o balde é por rota (não mais um só)

429 é backoff, nunca refresh nem logout. O `_request` só ramifica em 401, então um 429 vira `ApiError` comum, o que está correto.

**Um limiter por rota, não uma instância compartilhada.** `authLimiter` chaveia por `` `${ip}:${username}` `` e por isso só guarda as duas rotas cujo schema declara `username`, `/login` e `/register` (`keyGenerator`, `backend/src/middleware/rate-limit.js`). `/auth/refresh`, `/auth/verify-email` e `/auth/resend-verification` não têm `username` no corpo (`backend/src/modules/auth/auth.schemas.js:9-11`), então cada uma ganhou seu próprio store via `credentialIpLimiter` (`backend/src/middleware/rate-limit.js:83-123`). O refresh ainda soma `skipSuccessfulRequests: true`, porque o endereço é chave grossa atrás de NAT e o orçamento inteiro precisa apontar para falhas repetidas.

O que isso corrige, e é a armadilha que sobrevive na cabeça de quem leu a doc antiga: as três rotas **degeneravam** para a chave `ip:` e drenavam um balde único. Numa rede atrás de NAT o 11º refresh honesto da janela virava 429, e o cliente transforma qualquer erro de refresh em logout definitivo. Não escreva código novo assumindo o balde compartilhado, e não "otimize" reunindo os limiters: a separação é o conserto.

O agravante do lado do cliente continua de pé: `refresh()` trata qualquer falha como sessão perdida, então um 429 no refresh cai no mesmo `catch` do token expirado e derruba a sessão (`frontend/src/js/store/sync/api-client.js:300-307`). Refresh concorrente já é serializado por `this._refreshing` (`frontend/src/js/store/sync/api-client.js:290`), o que também evita disparar a detecção de reuso de [[refresh-token-rotacao]]. Bordas em [[hardening-borda-api]].

## 404 pode significar "funcionalidade desligada"

Com `ALLOW_SELF_REGISTRATION` desligado (default em produção) a rota `POST /auth/register` **não é registrada** (`backend/src/modules/auth/auth.routes.js:14`), cai no catch-all de `backend/src/app.js:122-124` e retorna 404, não 403, para não confirmar a existência do endpoint. Distinga pela `message`: `Route not found` é rota ausente, `Atlas not found` é recurso ausente.

**Não sonde o 404 para descobrir se o cadastro está ligado.** O flag já é publicado como `features.self_registration` em `GET /api/config` (`backend/src/modules/config/config.service.js`, no objeto `features` do payload; ancorado por símbolo porque a citação por linha que morava aqui já apontava para o lugar errado), que o boot já busca de qualquer forma. A sonda é pior que redundante: quando a rota está desligada ela nem chega ao limiter (o router não a monta), e quando está ligada ela gasta o balde de `/register` sem `username`, o pior caso da chave. Ver [[config-dinamico]].

## Em atlas, a existência vaza só para quem já tem relação com ele

A escada de `requireAtlasPermission` tem **três degraus**, e confundir os dois primeiros é o erro fácil:

- **Sem relação nenhuma** (não é dono, sem linha em `atlas_shares`, atlas não público) → **404**, byte a byte igual ao 404 de atlas inexistente ou soft-deletado. Idem para token de link público apontando para outro atlas.
- **Com share, nível insuficiente** para a rota → **403**. Aqui a existência vaza, e **de propósito**: quem tem share está com o atlas aberto na tela, então dizer "não existe" seria mentira e apagaria o sinal de "peça NÍVEL, não peça o link".
- **Anônimo** → **401** do `auth` estrito, antes da escada, igual para atlas existente e inexistente.

Ou seja, **um 403 confirma que aquele UUID existe, mas só chega a ele quem já sabia**. Até 2026-07-25 o primeiro degrau também era 403, e aí a confirmação era gratuita para qualquer autenticado que tivesse o UUID (colaborador com share revogado, link público despublicado). O argumento que decidiu não foi preferência: `enforceProjectReadable` do sv360 já fazia exatamente isso, com o porquê no JSDoc, e a assimetria entre dois módulos do mesmo backend custava mais que o vazamento, porque é ela que faz o próximo módulo copiar o padrão errado.

Contrato prendido em `backend/tests/integration/atlas-404-vs-403-escada.test.js`, onde cada caso de 404 tem o seu par 403: colapsar tudo em 404 é a leitura preguiçosa da decisão. Admin global recebe nível `owner` em qualquer atlas. Ver [[permissoes-atlas]], [[sintese-eixos-de-permissao]].

Não existe barreira global de credencial: `flexibleAuth` segue anônimo quando não há Bearer, cookie ou api key (`backend/src/app.js:70`); quem barra é a rota. Ver [[auth-flexivel]], [[api-keys]].

## A mesma intenção, dois status, duas rotas

Desativar ou rebaixar a própria conta via `PUT /users/:id` é **409** (`backend/src/modules/users/users.service.js:144`, `:147`); o mesmo ato via `DELETE /users/:userId` é **403** (`backend/src/modules/users/users.service.js:211`). Não unifique o tratamento pela intenção do usuário, trate por rota. Ver [[gestao-usuarios]]; o padrão de ramificação no cliente está em [[erros-api]].

## Validação: 422 ou 400 conforme a rota, não conforme o erro

Se a rota tem schema Joi, input ruim é 422 com `details[]`. Se não tem, o valor ruim chega ao banco e o mapa SQLSTATE o converte em 400. `GET /atlas/:atlasId` não valida params (`backend/src/modules/atlas/atlas.routes.js:26`) e um `atlasId` não-UUID sai como `400 BAD_REQUEST`; `POST /atlas/:atlasId/restore` valida (`backend/src/modules/atlas/atlas.routes.js:31`) e devolve 422 para o mesmo input. Só o 422 traz `details[]`, e essa ausência no 400 é intencional (as mensagens do driver expõem nomes de coluna e constraint, por isso são genéricas em `backend/src/middleware/error-handler.js:60-67`). Cuidado ao planejar UI em cima disso: o `details[]` sai do servidor mas **não sobrevive ao cliente**, ver [[erros-api]].

**Armadilha de compatibilidade:** `validate()` roda com `stripUnknown: true` (`backend/src/middleware/validate.js:3-6`), então campo desconhecido é silenciosamente **removido**, não rejeitado. Um cliente novo contra um servidor antigo recebe 200 com o campo apagado. Nenhum status sinaliza isso.

Outra ausência de sinal: no lote base64 de imagens a falha é **por item**, dentro de `failed[]`, com HTTP 200 (`backend/src/modules/images/images.service.js:126`, `:143`). Um 200 ali não significa que tudo entrou. Ver [[upload-imagens-seguranca]], [[imagens-atlas]].

## 503 é para o orquestrador, não para o boot

São **dois** os emissores de `503 SERVICE_UNAVAILABLE`, e eles chegam ao cliente por caminhos diferentes:

- `GET /api/v1/health` responde inline, sem passar pelo `errorHandler` (`backend/src/app.js:78-87`).
- O push de sync lança `ServiceUnavailableError` (`backend/src/utils/errors.js:49-58`) quando o `lock_timeout` do advisory lock dispara (`55P03`), no bloco de abertura de `pushOperations` (`backend/src/modules/sync/sync.service.js`). Este passa pelo `errorHandler` como qualquer `AppError`. Foi acrescentado junto do `lock_timeout`, para que contenção vire retry em vez de conexão de pool retida.

A distinção que importa para o cliente: 503 do push é **transitório e vale retry**; falha de banco em qualquer outra rota continua virando 500, que não vale. O frontend não chama `/health` em lugar nenhum: disponibilidade é decidida por `GET /api/config` com fail-fast. Ver [[sessao-boot-e-ciclo-de-vida]], [[deploy-backend]].

## Poison batch: erro permanente tratado como transitório

`POST /atlas/:atlasId/sync` roda o lote inteiro em uma transação, e o cliente **não descarta lote rejeitado**: registra o span `flush.push` como `FAILED` e relança sem dequeue, de modo que os mesmos `opIds` voltam no ciclo seguinte (`flush`, `frontend/src/js/store/sync/sync-engine.js`). Como o auto-flush roda a cada 1,5 s e engole a exceção com um `console.warn` (`frontend/src/js/store/sync/sync-flush.js:82-83`), qualquer erro **permanente** vira fila travada com retry infinito e nenhuma sinalização na UI.

A intenção é não perder trabalho local diante de erro transitório, e a alternativa rejeitada foi descartar o lote no erro, que perderia edição legítima durante uma queda. Isso está certo para os erros transitórios do caminho (o 503 de `lock_timeout` da seção anterior, 401, 5xx) e é exatamente o que tornava o resto perigoso.

**Por isso a superfície de poison batch encolheu de propósito, e o que sobrou dela é pequeno.** Duas famílias de recusa deixaram de lançar e viraram resposta 200 com `results[i].rejected` + `reason`, sem abortar as vizinhas: a de **política** (excluir mapa sem `manage`, travar/destravar sem ser dono, escrever em mapa bloqueado — `operationDenialReason` e `lockedMapDenialReason`, `backend/src/modules/sync/sync.service.js`) e a de **violação de dado** (SQLSTATE classe 22/23: CHECK, FK, `22P02`, NOT NULL, `22001` — `integrityRejectionReason`, mesmo arquivo, com cada op num SAVEPOINT). O `409 Map is locked` que esta seção citava não existe mais em lugar nenhum do módulo de sync, e o 400 genérico que não dizia qual op ofendeu também não. O que ainda derruba o lote é o que pode dar certo depois: violação de **nível** (principal `read` ou `comment` empurrando escrita) em `assertOperationAllowed`, que 403 o push todo por o lote ser inteiramente suspeito, mais 503/5xx e queda de conexão.

Como rede de segurança para o permanente que a classificação não cobrir, `flush` encolhe o lote para **uma** op ao receber 400/422, e só descarta a op que falha sozinha — a ofensora é identificada por construção, nunca por um id vindo do servidor, e nenhuma irmã sai da fila sem ter sido aceita. O descarte avisa o usuário por toast. Erro permanente fora dessa lista continua precisando de detecção por fora: o `traceId` do span nomeia os `opIds` presos (ver [[syncledger]]). Trate a causa (conceder permissão, corrigir a op malformada), nunca o sintoma. As rotas de sync não têm rate limit, então 429 nunca aparece no caminho de colaboração. Ver [[fila-operacoes-outbound]], [[ack-idempotencia]], [[sintese-rest-vs-sync]].

## Fontes

Guias absorvidos *11-seguranca-hardening*, *12-multiorg-identidade-auditoria*, *09-admin* e *01-autenticacao*. Código: `backend/src/utils/errors.js`, `backend/src/middleware/` (`error-handler`, `validate`, `rate-limit`, `auth`, `permissions`), `backend/src/app.js` e `backend/src/modules/` (`auth`, `users`, `sync`, `images`, `collab`, `config`) no backend; `frontend/src/js/store/sync/` (`api-client`, `sync-engine`, `sync-flush`) e `frontend/src/js/admin/users-tab.js` no frontend.

## Histórico

- 2026-07-25: a seção do 429 carregava uma `[!CONTRADICAO]` afirmando que refresh, verify-email e resend-verification dividiam um balde `ip:` único. O marcador foi escrito em 2026-07-18 e a separação por rota entrou em `aec63f8` (2026-07-24), então ele passou uma semana descrevendo um defeito já fechado. Supersessão temporal, marcador apagado, o defeito antigo preservado como armadilha porque é o modelo mental que sobrou de quem leu a versão anterior.
