# Contrato de Erros da API

Onde o envelope `{ error: { code, message } }` não vale, o que o cliente descarta dele em silêncio, e por que ramificar por `status` e nunca por `code` ou `message`.

O mapa completo de status por origem está em [[sintese-contrato-erros-http]]. Esta página cobre só as armadilhas que sobram depois de ler o código.

## O cliente descarta `details` antes de você vê-lo

O backend produz `details: [{ field, message }]` com **todos** os campos inválidos de uma vez (`backend/src/middleware/error-handler.js:33-36`, `abortEarly: false` em `backend/src/middleware/validate.js:3-6`). O cliente joga fora: `ApiError` guarda apenas `message`, `status` e `code` (`src/js/store/sync/api-client.js:33-38`) e o `throw` em `src/js/store/sync/api-client.js:236-239` lê só `err.code` e `err.message`. Um `grep` por `error.details` em `src/js` não retorna nenhum consumidor.

> [!CONTRADICAO] O checklist de [[sintese-contrato-erros-http]] diz "422 traz `details[]` para marcar campos no formulário". Não hoje: o array morre no transporte. Marcação campo a campo exige antes estender o `ApiError`, e é uma mudança de uma linha que ninguém fez porque nenhum formulário pediu.

Efeito colateral de `stripUnknown: true`: campo desconhecido é **removido em silêncio**, não rejeitado. Cliente novo contra servidor antigo recebe 2xx com o campo apagado. Não existe sinal de que isso aconteceu.

## Os dois caminhos de imagem não têm refresh automático

`uploadImage` (`src/js/store/sync/api-client.js:857-873`) e `fetchImageBlob` (`src/js/store/sync/api-client.js:916-923`) montam o `fetch` à mão porque um é multipart e o outro é binário, e por isso **não passam por `_request`**. Consequências que o código não anuncia:

- não há refresh transparente. Um upload longo que atravessa a expiração do access token falha com 401 puro e definitivo.
- `fetchImageBlob` não parseia o corpo: lança `ApiError('HTTP <status>')` **sem `code`**. Qualquer lógica baseada em `error.code` no caminho de imagens é um `undefined` silencioso. Use `error.status`.

Ver [[imagens-atlas]] e [[upload-imagens-seguranca]].

## O 401 já foi tratado pelo transporte

Não escreva `if (401) refresh()` na sua camada: `_request` já refresca e repete uma vez (`src/js/store/sync/api-client.js:231-233`), e o `ApiError` só sobe se o retry também falhar. Três guardas sustentam isso e quebram se alguém "simplificar":

- `refresh()` compartilha uma promessa em voo (`src/js/store/sync/api-client.js:289-311`), senão uma rajada de requisições vira uma rajada de POSTs `/auth/refresh` — que estão sob rate limit compartilhado (ver [[refresh-token-rotacao]]).
- a própria chamada de refresh vai com `_retry: false` (`src/js/store/sync/api-client.js:295-299`), senão um 401 nela recursa.
- o handler de auth-lost é ligado **depois** do boot de propósito (`src/js/store/sync/api-client.js:78-81`): token expirado no boot deve cair em anônimo em silêncio, não abrir modal de login por cima da tela de carregamento.

## `atlasId` malformado não é 404

Rota de atlas sem schema Joi nos params manda o id direto ao Postgres; um não-UUID estoura SQLSTATE `22P02` e sai como **400 BAD_REQUEST** genérico (`backend/src/middleware/error-handler.js:65`), não 404. Um cliente que só trata 403/404 mostra "erro inesperado" para um link quebrado, que é o caso mais comum de todos. Ver o tratamento correto em `src/js/index.js:186-194` (403 / 404 / genérico, e limpa a URL do atlas para que um F5 não repita a falha).

E o 403 **vaza a existência** do atlas de propósito (`backend/src/middleware/permissions.js:111-113`), para a UI poder dizer "você não tem acesso" em vez de "não existe". É decisão de usabilidade; se o requisito virar não-enumerabilidade, o ponto único de mudança é `backend/src/middleware/permissions.js:111`. Ver [[permissoes-atlas]] e [[compartilhamento-atlas]].

## O WebSocket não usa este contrato, e ninguém escuta os erros dele

Erros do canal de colaboração são mensagens `{ type: 'error', code, message }` (`collab.handlers.js:19, 117, 155, 168, 202, 279`), com códigos que não existem no REST (`OPERATION_FAILED`, `SYNC_FAILED`). Duas armadilhas empilhadas:

1. **Ninguém consome.** `src/js/store/sync/ws-client.js:363-364` emite o canal `'error'`, e nenhum módulo se inscreve nele (`src/js/store/sync/sync-engine.js` e `src/js/presence/presence-bridge.js` assinam `operation`, `presence`, `cursor`, etc., nunca `error`). Uma operação recusada pelo servidor via WS desaparece sem toast, sem log de nível, sem retry.
2. **Vaza mensagem crua em produção.** `message: err.message` sem gate de `isDev` (`backend/src/modules/collab/collab.handlers.js:157`, `:204`, `:281`), enquanto o REST substitui por texto genérico fora de dev (`error-handler.js:98-100, 114`). A política de não vazar texto de driver e nome de constraint vale só metade do sistema. Ver [[hardening-borda-api]] e [[canal-collab-websocket]].

Não reutilize o parser de erro REST no WS, e não presuma que um erro de WS chegou a alguém.

> **Nota histórica.** O guia *02-atlas-basico* (absorvido, §8-9) apresenta uma tabela de 5 códigos como "Códigos Comuns". O handler emite ainda `CONFLICT` 409, `BAD_REQUEST` 400, `PAYLOAD_TOO_LARGE` 413, `UNSUPPORTED_MEDIA_TYPE` 415 e `TOO_MANY_REQUESTS` 429 (`backend/src/middleware/error-handler.js:86-107`; o 429 vem direto do limitador, `backend/src/middleware/rate-limit.js:6-8`, sem passar pelo `errorHandler` e portanto sem virar log de request). Tratar a lista de 5 como conjunto fechado gera `switch` incompleto no cliente.

## Regra de ouro

Ramifique por `status`. Use `code` só para desambiguar dentro de um mesmo status (padrão em `src/js/admin/users-tab.js:447`, que aceita `status === 409 || code === 'CONFLICT'`). Nunca ramifique por `message`: ela muda entre dev e produção pelo mesmo ramo do handler (`backend/src/middleware/error-handler.js:98`) e é genérica em tudo que vem do mapa SQLSTATE.

Relacionados: [[api-rest-atlas]], [[auth-flexivel]], [[autenticacao-jwt]], [[gestao-usuarios]], [[api-keys]], [[sintese-rest-vs-sync]].
