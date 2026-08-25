# Contrato de Erros da API

Onde o envelope `{ error: { code, message } }` não vale, o que o transporte já resolveu antes do seu `catch`, e por que ramificar por `status` e nunca por `code` ou `message`.

**Divisão com [[sintese-contrato-erros-http]]:** lá está a semântica de quem *emite* (qual rota devolve qual status e por quê); aqui, o comportamento de quem *consome*.

## O 422 já vem composto dentro da `message`

O backend apura **todos** os campos inválidos de uma vez (`abortEarly: false`, `backend/src/middleware/validate.js`) e os manda em `details: [{ field, message }]`. O cliente guarda o array em `ApiError` **e**, só quando o `code` é `VALIDATION_ERROR`, injeta os campos dentro de `error.message` (`buildApiErrorMessage`, `frontend/src/js/store/sync/api-client.js`).

A composição existe porque o `message` de topo de um 422 é a constante `'Falha na validação'` e **toda** tela do app mostra `error.message`: sem ela, o nome do campo que o servidor já apurou nunca chegava ao usuário. Duas consequências: não reimplemente a formatação na sua camada, e para marcação campo a campo leia `error.details`, nunca parseie a `message`.

> Até 2026-08-14 esta seção afirmava que `ApiError` descartava `details` e que "marcação campo a campo não é possível hoje". As duas coisas deixaram de ser verdade; o campo e o compositor existem.

## `fetchImageBlob` é o caminho sem `code` e sem refresh

Os dois caminhos de imagem montam o `fetch` à mão (um é multipart, o outro binário) e por isso **não passam por `_request`**. Eles divergem, e a diferença é a armadilha:

- `uploadImage` renova o token **antes** de montar o corpo (`_ensureFreshAccessToken`) e lê o envelope de erro como o `_request` faria, então tem `code` e `details`. A renovação antecipada é a única coisa entre uma sessão expirada e um upload longo perdido, já que não há retry depois.
- `fetchImageBlob` não faz nem uma coisa nem outra: lança `ApiError('HTTP <status>')` **sem `code`**. Qualquer lógica baseada em `error.code` nesse caminho lê `undefined` em silêncio. Use `error.status`.

Ver [[imagens-atlas]] e [[upload-imagens-seguranca]].

## O 401 já foi tratado pelo transporte

Não escreva `if (401) refresh()` na sua camada: `_request` refresca e repete **uma** vez, e o `ApiError` só sobe se o retry também falhar. Quatro guardas sustentam isso e quebram se alguém "simplificar":

- `refresh()` compartilha uma promessa em voo, senão uma rajada de requisições vira uma rajada de POSTs `/auth/refresh`, que tem limitador próprio e chaveado por endereço, grosso demais atrás de NAT ([[refresh-token-rotacao]], [[hardening-borda-api]]).
- a própria chamada de refresh vai com `_retry: false`, senão um 401 nela recursa.
- uma falha **transitória** de refresh entra em cooldown e é **replicada** para os chamadores seguintes em vez de virar nova tentativa (`isTerminalRefreshFailure` separa terminal de transitório). Sem isso um único 429 viraria centenas, porque `sync-flush` sozinho volta a cada 1,5 s. Só 401 e 403 derrubam a sessão; o resto, 429 inclusive, preserva os tokens.
- o handler de auth-lost é ligado **depois** do boot de propósito (`setAuthLostHandler`): token expirado no boot deve cair em anônimo em silêncio, não abrir modal de login por cima da tela de carregamento.

## `atlasId` malformado não é 404

Rota de atlas sem schema Joi nos params manda o id direto ao Postgres; um não-UUID estoura SQLSTATE `22P02` e sai como **400 BAD_REQUEST** genérico pelo `PG_ERROR_MAP` (`backend/src/middleware/error-handler.js`), não 404. Um cliente que só trata 403/404 mostra "erro inesperado" para um link quebrado, que é o caso mais comum de todos. O tratamento correto está no boot (`frontend/src/js/index.js`), que ainda limpa a URL do atlas para que um F5 não repita a falha.

Distinga 403 de 404 na UI, mas saiba o que cada um significa: o **404 cobre dois casos que o servidor não separa de propósito** (o atlas não existe, e o atlas existe mas o chamador não tem vínculo nenhum com ele), enquanto o **403 sobrou para o caso estreito** de haver compartilhamento com nível insuficiente. Ou seja, o 403 confirma a existência, e é deliberado ([[sintese-contrato-erros-http]], [[permissoes-atlas]]).

## O WebSocket não usa este contrato, e ninguém escuta os erros dele

Erros do canal de colaboração são mensagens `{ type: 'error', code, message }` (`backend/src/modules/collab/collab.handlers.js`), com códigos que não existem no REST (`OPERATION_FAILED`, `SYNC_FAILED`). Duas armadilhas empilhadas:

1. **Ninguém consome.** `frontend/src/js/store/sync/ws-client.js` emite o canal `'error'` em quatro pontos (socket, servidor, close, falha de conexão) e nenhum módulo se inscreve nele: `sync-engine.js` e `presence/presence-bridge.js` assinam `operation`, `presence`, `cursor`, `selection` e afins, nunca `error`. Uma operação recusada pelo servidor via WS desaparece sem toast, sem log de nível, sem retry.
2. **~~Vaza mensagem crua em produção.~~ CORRIGIDO.** Os três catches (`handleOperation`, `handleOperations`, `handleSyncRequest`) encaminhavam `err.message` sem gate nenhum, então o texto do driver (nome de tabela, de constraint, de coluna) saía inteiro pelo socket enquanto a MESMA falha voltava mascarada pelo REST. Hoje passam por `safeErrorMessage` (`backend/src/utils/safe-error-message.js`), que devolve os mesmos textos do `PG_ERROR_MAP` do REST e manda o erro cru para o `logger.error`. Ver [[hardening-borda-api]] e [[canal-collab-websocket]].

Não reutilize o parser de erro REST no WS, e não presuma que um erro de WS chegou a alguém.

**A mensagem de um `AppError` continua atravessando, e isso é o gate, não uma brecha.** `safeErrorMessage` libera `err.message` quando `err.isOperational` é `true`, porque esse texto foi escrito para o usuário (o 503 de push ocupado, o 403 de política); só o que vem do driver vira texto fixo. Mascarar tudo é a outra maneira de errar, e o erro de validação Joi fica igualmente fora do gate: ele descreve o payload do próprio cliente contra um schema público.

O mesmo utilitário fecha os outros dois canais que escapavam do `errorHandler` por não serem erro de Express: o `failed[]` do upload em lote de imagens (dentro de um 201) e o do lote de calibração 360 (dentro de um 200). Os dois vazavam nome de constraint, e o de imagens vazava também o caminho absoluto do disco do servidor.

## A lista de códigos nunca foi fechada

Tratar o conjunto de `code` como fechado gera `switch` incompleto no cliente, e esta página já cometeu o erro que denuncia: a enumeração que morava aqui omitia o `SERVICE_UNAVAILABLE` 503, que sai pelo ramo de `AppError` quando o push de sync estoura o `lock_timeout` do advisory lock ([[modelo-conflito-lww]]). A fonte é `backend/src/middleware/error-handler.js`, não uma lista em prosa.

O `429` é o único que **não passa** pelo `errorHandler`: vem direto do limitador (`backend/src/middleware/rate-limit.js`), então perde o log enriquecido e o `details`. O log de request comum sai normalmente, porque `requestLogger` é montado antes de todos os routers e escuta `res.on('finish')`, que dispara para toda resposta (`backend/src/middleware/request-logger.js`).

## Regra de ouro

Ramifique por `status`. Use `code` só para desambiguar dentro de um mesmo status (padrão em `frontend/src/js/admin/users-tab.js`, que aceita `status === 409 || code === 'CONFLICT'`). Nunca ramifique por `message`: ela muda entre dev e produção pelo mesmo ramo do handler e é genérica em tudo que vem do mapa SQLSTATE.

Relacionados: [[api-rest-atlas]], [[auth-flexivel]], [[autenticacao-jwt]], [[gestao-usuarios]], [[api-keys]], [[sintese-rest-vs-sync]].
