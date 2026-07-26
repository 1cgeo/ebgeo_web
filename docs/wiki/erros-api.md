# Contrato de Erros da API

Onde o envelope `{ error: { code, message } }` não vale, o que o cliente descarta dele em silêncio, e por que ramificar por `status` e nunca por `code` ou `message`.

**Divisão com [[sintese-contrato-erros-http]]:** lá está a semântica de quem *emite* (qual rota devolve qual status e por quê); aqui está o comportamento de quem *consome*, isto é, o que o cliente faz, descarta ou já resolveu por você antes do seu `catch`.

## O cliente descarta `details` antes de você vê-lo

O backend produz `details: [{ field, message }]` com **todos** os campos inválidos de uma vez (`backend/src/middleware/error-handler.js:33-36`, `abortEarly: false` em `backend/src/middleware/validate.js:3-6`). O cliente joga fora: `ApiError` guarda apenas `message`, `status` e `code` (`frontend/src/js/store/sync/api-client.js:33-38`). Um `grep` por `error.details` em `frontend/src/js/` não retorna nenhum consumidor.

Portanto **marcação campo a campo de formulário não é possível hoje**, apesar de o servidor mandar o material para isso. Custa uma linha em `ApiError`, e ninguém pagou porque nenhum formulário pediu. Não escreva UI contando com o array antes de estender a classe.

## Os dois caminhos de imagem não têm refresh automático

`uploadImage` (`frontend/src/js/store/sync/api-client.js:963-985`) e `fetchImageBlob` (`frontend/src/js/store/sync/api-client.js:1027-1040`) montam o `fetch` à mão porque um é multipart e o outro é binário, e por isso **não passam por `_request`**. Consequências que o código não anuncia:

- não há refresh transparente. Um upload longo que atravessa a expiração do access token falha com 401 puro e definitivo.
- `fetchImageBlob` não parseia o corpo: lança `ApiError('HTTP <status>')` **sem `code`**. Qualquer lógica baseada em `error.code` no caminho de imagens é um `undefined` silencioso. Use `error.status`.

Ver [[imagens-atlas]] e [[upload-imagens-seguranca]].

## O 401 já foi tratado pelo transporte

Não escreva `if (401) refresh()` na sua camada: `_request` já refresca e repete uma vez (`frontend/src/js/store/sync/api-client.js:305-307`), e o `ApiError` só sobe se o retry também falhar. Três guardas sustentam isso e quebram se alguém "simplificar":

- `refresh()` compartilha uma promessa em voo (`frontend/src/js/store/sync/api-client.js:363-385`), senão uma rajada de requisições vira uma rajada de POSTs `/auth/refresh`, que tem limiter próprio e chaveado por endereço, grosso demais atrás de NAT (ver [[refresh-token-rotacao]] e [[sintese-contrato-erros-http]]).
- a própria chamada de refresh vai com `_retry: false` (`frontend/src/js/store/sync/api-client.js:369-373`), senão um 401 nela recursa.
- o handler de auth-lost é ligado **depois** do boot de propósito (`frontend/src/js/store/sync/api-client.js:123-126`): token expirado no boot deve cair em anônimo em silêncio, não abrir modal de login por cima da tela de carregamento.

## `atlasId` malformado não é 404

Rota de atlas sem schema Joi nos params manda o id direto ao Postgres; um não-UUID estoura SQLSTATE `22P02` e sai como **400 BAD_REQUEST** genérico (`backend/src/middleware/error-handler.js:65`), não 404. Um cliente que só trata 403/404 mostra "erro inesperado" para um link quebrado, que é o caso mais comum de todos. Ver o tratamento correto em `frontend/src/js/index.js:186-194` (403 / 404 / genérico, e limpa a URL do atlas para que um F5 não repita a falha).

Distinga 403 de 404 na UI: o 403 confirma que o atlas existe, e isso é deliberado ([[sintese-contrato-erros-http]], [[permissoes-atlas]]).

## O WebSocket não usa este contrato, e ninguém escuta os erros dele

Erros do canal de colaboração são mensagens `{ type: 'error', code, message }` (`backend/src/modules/collab/collab.handlers.js:19, 117, 155, 168, 202, 279`), com códigos que não existem no REST (`OPERATION_FAILED`, `SYNC_FAILED`). Duas armadilhas empilhadas:

1. **Ninguém consome.** `frontend/src/js/store/sync/ws-client.js:363-364` emite o canal `'error'`, e nenhum módulo se inscreve nele (`frontend/src/js/store/sync/sync-engine.js` e `frontend/src/js/presence/presence-bridge.js` assinam `operation`, `presence`, `cursor`, etc., nunca `error`). Uma operação recusada pelo servidor via WS desaparece sem toast, sem log de nível, sem retry.
2. **~~Vaza mensagem crua em produção.~~ CORRIGIDO.** Os três catches (`handleOperation`, `handleOperations`, `handleSyncRequest`) encaminhavam `err.message` sem gate nenhum, então o texto do driver — nome de tabela, de constraint, de coluna — saía inteiro pelo socket enquanto a MESMA falha voltava mascarada pelo REST. Hoje passam por `safeErrorMessage` (`backend/src/utils/safe-error-message.js`), que devolve os mesmos textos do `PG_ERROR_MAP` do REST e manda o erro cru para o `logger.error` que já estava ali. Ver [[hardening-borda-api]] e [[canal-collab-websocket]].

Não reutilize o parser de erro REST no WS, e não presuma que um erro de WS chegou a alguém.

**A mensagem de um `AppError` continua atravessando, e isso é o gate, não uma brecha.** `safeErrorMessage` libera `err.message` quando `err.isOperational` é `true`, porque esse texto foi escrito para o usuário (o 503 de push ocupado, o 403 de política); só o que vem do driver vira texto fixo. Mascarar tudo é a outra maneira de errar, e o erro de validação Joi fica igualmente fora do gate: ele descreve o payload do próprio cliente contra um schema público, exatamente como os `details` que o REST devolve.

O mesmo utilitário fecha os outros dois canais que escapavam do `errorHandler` por não serem erro de Express: o `failed[]` do upload em lote de imagens (dentro de um 201) e o do lote de calibração 360 (dentro de um 200). Os dois vazavam nome de constraint, e o de imagens vazava também o caminho absoluto do disco do servidor.

> **Nota histórica.** O guia *02-atlas-basico* (absorvido, §8-9) apresenta uma tabela de 5 códigos como "Códigos Comuns". O handler emite ainda `CONFLICT` 409, `BAD_REQUEST` 400, `PAYLOAD_TOO_LARGE` 413, `UNSUPPORTED_MEDIA_TYPE` 415 e `TOO_MANY_REQUESTS` 429 (`backend/src/middleware/error-handler.js:86-107`), mais `SERVICE_UNAVAILABLE` 503, que sai pelo ramo de `AppError` (`backend/src/middleware/error-handler.js:42-55`) quando o push de sync estoura o `lock_timeout` do advisory lock. Tratar a lista de 5 como conjunto fechado gera `switch` incompleto no cliente, e esta enumeração já cometeu o erro que denuncia: ela mesma omitia o 503. Ver [[sintese-contrato-erros-http]].
>
> Um detalhe do 429 aqui era falso e vale desfazer: ele vem direto do limitador (`backend/src/middleware/rate-limit.js:5-12`) e **não** passa pelo `errorHandler`, então perde o log enriquecido (`{err, userId}`) e o `details`, mas o log de request comum sai normalmente. `requestLogger` é montado antes de todos os routers e escuta `res.on('finish')`, que dispara para toda resposta, tenha ela vindo de onde vier (`backend/src/middleware/request-logger.js:11-25`, `backend/src/app.js:111`). A formulação correta sempre esteve em [[hardening-borda-api]]; esta era a das duas páginas que estava errada.

## Regra de ouro

Ramifique por `status`. Use `code` só para desambiguar dentro de um mesmo status (padrão em `frontend/src/js/admin/users-tab.js:447`, que aceita `status === 409 || code === 'CONFLICT'`). Nunca ramifique por `message`: ela muda entre dev e produção pelo mesmo ramo do handler (`backend/src/middleware/error-handler.js:98`) e é genérica em tudo que vem do mapa SQLSTATE.

Relacionados: [[api-rest-atlas]], [[auth-flexivel]], [[autenticacao-jwt]], [[gestao-usuarios]], [[api-keys]], [[sintese-rest-vs-sync]].
