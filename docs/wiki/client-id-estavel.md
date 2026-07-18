# clientId estável

Identificador de cliente persistido no localStorage (regex `^[a-zA-Z0-9_-]{8,64}$`) que não é credencial, mas é a chave que faz idempotência e presença sobreviverem a uma reconexão da mesma aba.

## O que é (e o que não é)

O `clientId` é uma identidade **de instalação do navegador**, não de usuário e não de sessão. Ele viaja em dois lugares:

- na query do handshake do [[canal-collab-websocket]]: `…/api/v1/collab?atlasId=&token=&clientId=` (montado em `src/js/store/sync/api-client.js:935-938`, chamado por `ws-client.js:244`);
- carimbado em **toda** operação de sync, no campo `op.clientId` (`src/js/store/sync/operation-factory.js:161` e `:187` para lotes), ou seja, faz parte do [[envelope-operacao]].

Ele **não autoriza nada**. Quem autoriza é o JWT ([[autenticacao-jwt]]) e a permissão por atlas resolvida no handshake ([[permissoes-atlas]]). Forjar o `clientId` de outro cliente não dá acesso a nada, só bagunça presença e de-duplicação.

## Como o cliente gera e persiste

`getClientId()` (`src/js/store/sync/operation-factory.js:41-51`) faz memo em módulo, lê `localStorage['ebgeo_client_id']` e, se vazio, gera com `generateUUID()` (`src/js/utilities/uuid.js`) e grava. O valor é um UUID v4 de 36 caracteres, que satisfaz o regex do servidor (`[a-zA-Z0-9_-]`, 8 a 64) porque hífen está na classe.

O acesso ao storage passa por `safeLocalStorage()` (`operation-factory.js:26-33`), que engole exceções: em iframe sandbox, modo privado ou runner Node o storage vira `null`.

> Armadilha: sem localStorage o id **ainda é gerado**, mas só em memória (`operation-factory.js:44-49`). Nesse cenário cada F5 é um cliente novo: a presença duplica, a janela de graça `away` não é cancelada e o filtro de auto-eco deixa de reconhecer as próprias ops. O sync não quebra, mas as garantias de continuidade descritas abaixo somem silenciosamente.

`resetClientId()` (`operation-factory.js:56-60`) existe **para teste** e está reexportado pelo barrel (`src/js/store/sync/index.js:72`). Chamá-lo em produção é equivalente a trocar de máquina: nenhum caminho do app o invoca, e nada no logout o limpa. O `clientId` sobrevive a login, logout e troca de usuário no mesmo navegador, por design (ver [[sessao-boot-e-ciclo-de-vida]]).

## Por que ele importa: os três usos reais

**1. Filtro de auto-eco (o mais crítico do lado do cliente).** O push por REST (`POST /sync`) faz broadcast das ops para a sala inteira, e o emissor HTTP não tem socket para ser excluído do broadcast. Quem descarta o próprio eco é o cliente, comparando `op.clientId === this._clientId` em `ws-client.js:397-403` (registrando o span `ws.self-echo` no [[syncledger]]). Por isso o singleton é construído já com o id estável, `new WsClient({ clientId: getClientId() })` (`ws-client.js:573`), com um comentário no código documentando a regressão em que `_clientId` ficava `null` e o autor reaplicava todas as próprias ops.

**2. Presença.** O `presenceStore` é chaveado por `clientId`, caindo para `userId` e depois `id` quando a mensagem não traz um (`src/js/presence/presence-store.js:43-60`). O filtro de "não me mostre a mim mesmo" também compara contra `clientId` ou `userId` (`presence-store.js:411-420`), usando `sessionContext.clientId`. Detalhes em [[presenca-colaborativa]] e [[presenca-colaborativa]].

**3. Continuidade na queda de rede.** Um socket que morre com close abnormal (1006) marca o usuário como `away` e agenda a remoção após `WS_AWAY_GRACE_MS` (default 120 000 ms). Reconectar com o **mesmo** `clientId` dentro da janela cancela o timer, reusa a linha de sessão e emite `user_back`; com um id diferente o servidor vê um cliente novo e o antigo cai como `user_left` ao fim da graça. Ver [[presenca-colaborativa]].

Saída intencional não depende disso: `disconnect()` envia `{type:'leave'}` antes de fechar com código 1000 (`ws-client.js:131-132`), o que remove na hora e evita o fantasma de 2 minutos na lista dos peers.

## Idempotência: precisão necessária

O resumo padrão diz "idempotência sobrevive à reconexão graças ao clientId". A chave de idempotência do servidor é o **`op.id`**, não o `clientId`: o ack devolve `{success, operationId, idempotent, currentVersion}`, e `idempotent: true` significa "já aplicada antes, não reapliquei" e deve ser tratado como sucesso no dequeue da [[fila-operacoes-outbound]] (ver [[ack-idempotencia]] e [[idempotencia-e-convergence-guard]]).

O papel do `clientId` na idempotência é indireto e vale entender para não errar:

- ele garante que a **fila offline** reenviada após a reconexão continue sendo reconhecida como do mesmo cliente (ver [[fila-operacoes-outbound]]);
- ele garante que o **eco** das ops reenviadas seja descartado localmente em vez de reaplicado (uso 1 acima).

Conflito de fato continua sendo LWW por ordem de chegada no servidor ([[modelo-conflito-lww]], [[sintese-nao-e-crdt]]).

## Armadilhas

- **Duas abas do mesmo navegador compartilham o localStorage, logo compartilham o `clientId`.** Consequências reais: as duas colapsam numa única entrada de presença, e pior, o filtro de auto-eco de `ws-client.js:397` faz a aba B **descartar as operações da aba A** (mesmo `clientId`), então elas não convergem entre si. O JSDoc de `presence-store.js:11-12` fala em "várias abas / clientes" chaveadas por `clientId`, mas nada no código deriva um id por aba. Trate multi-aba no mesmo atlas como cenário não suportado.
- **O `sessionId` do `connected` não é reconciliado de volta.** O servidor ecoa o `clientId` efetivo em `connected.sessionId` e, se o valor recebido for ausente/malformado, gera um próprio como fallback. O cliente guarda a mensagem inteira em `this.session` (`ws-client.js:416-418`) mas **nunca** atualiza `this._clientId` a partir de `msg.sessionId`. Enquanto o app mandar um UUID válido isso é inofensivo; se algum dia mandar algo fora do regex, `_clientId` e o id efetivo do servidor divergem e o filtro de auto-eco para de funcionar sem nenhum sinal.
- **`clientId` como identidade de usuário offline.** `sessionContext.getUserId()` devolve `userId` online e cai para `clientId` offline (`src/js/store/sync/session-context.js:185-190`). É útil para autoria local, mas não confunda: o mesmo `clientId` atende usuários diferentes que fizerem login no mesmo navegador. Ver [[dominio-local-vs-remoto]] e [[modos-operacao]].
- **Não derive nada de segurança dele.** É opcional na query (ausente, o servidor gera um), portanto qualquer lógica de servidor ou cliente que assuma sua presença/estabilidade está errada por construção.

## Fontes

- guia *04-websocket-collab* (absorvido): parâmetro `?clientId=` no handshake, regex `^[a-zA-Z0-9_-]{8,64}$` e fallback do servidor, eco em `connected.sessionId`, contrato congelado, janela de graça `away`/`user_back` (§4), broadcast REST sem exclusão do emissor (§3.9), semântica de `idempotent` no ack (§3.5).
- guia *08-offline-import* (absorvido): uso do mesmo `ebgeo_client_id` do localStorage ao carimbar operações de update geradas na importação offline (§4.5).
- Código: `src/js/store/sync/operation-factory.js` (geração/persistência/reset e carimbo em `createOperation`/`createBatchOperations`), `src/js/store/sync/ws-client.js` (URL do handshake, filtro de auto-eco, `leave`, `_onConnected`), `src/js/store/sync/api-client.js` (`wsUrl`), `src/js/store/sync/session-context.js` (fallback offline), `src/js/presence/presence-store.js` (chaveamento e filtro de self), `src/js/utilities/uuid.js` (`generateUUID`).
