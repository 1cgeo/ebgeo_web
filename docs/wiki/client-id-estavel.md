# clientId estável

Identificador de instalação do navegador persistido em `localStorage['ebgeo_client_id']` (`src/js/store/sync/operation-factory.js:41-51`): não é credencial, não é identidade de usuário, mas é o que faz presença e filtro de auto-eco sobreviverem a uma reconexão.

## O contrato

Ele **não autoriza nada**. Quem autoriza é o JWT ([[autenticacao-jwt]]) e a permissão por atlas resolvida no handshake ([[permissoes-atlas]]). Forjar o `clientId` alheio não dá acesso a nada, só bagunça presença e de-duplicação. Consequência prática: **não derive nada de segurança dele** e não assuma que ele chega, porque é opcional na query do [[canal-collab-websocket]] e o servidor gera um quando falta.

O que não pode mudar: o valor precisa casar o regex do servidor `^[a-zA-Z0-9_-]{8,64}$`. Hoje isso é acidental, não garantido: `generateUUID()` produz 36 caracteres com hífen, que passa por sorte da classe de caracteres. Trocar o gerador por algo com ponto, dois-pontos ou base64 padrão quebra o handshake sem aviso no cliente.

O `clientId` sobrevive a login, logout e troca de usuário no mesmo navegador **por design**: nenhum caminho do app o limpa. `resetClientId()` existe só para teste; chamá-lo em produção equivale a trocar de máquina. Ver [[sessao-boot-e-ciclo-de-vida]].

## Por que ele é crítico: o auto-eco

O push por REST (`POST /sync`) faz broadcast para a sala inteira, e o emissor HTTP não tem socket para ser excluído do broadcast pelo servidor. **Quem descarta o próprio eco é o cliente**, comparando `op.clientId === this._clientId` (`src/js/store/sync/ws-client.js:397-403`, span `ws.self-echo` no [[syncledger]]). Por isso o singleton nasce com o id estável (`src/js/store/sync/ws-client.js:573`): já houve regressão em que `_clientId` ficava `null`, a de-dup desligava e o autor reaplicava todas as próprias operações.

Presença ([[presenca-colaborativa]]) é chaveada por ele, com queda para `userId` e depois `id` (`src/js/presence/presence-store.js:43-60`). E na queda de rede: um close abnormal (1006) marca `away` e agenda remoção após `WS_AWAY_GRACE_MS` (120 s). Reconectar com o **mesmo** id cancela o timer e emite `user_back`; com um id diferente o servidor vê cliente novo e o antigo cai como `user_left` ao fim da graça. Saída intencional não depende disso: `disconnect()` manda `{type:'leave'}` antes do close 1000 (`src/js/store/sync/ws-client.js:131-132`), removendo na hora.

## Armadilhas

- **Sem localStorage o id ainda é gerado, só que em memória** (`src/js/store/sync/operation-factory.js:44-49`): iframe sandbox, modo privado, runner Node. Cada F5 vira um cliente novo: presença duplica, a graça `away` não é cancelada e o auto-eco para de reconhecer as próprias ops. O sync não quebra; as garantias somem **silenciosamente**.
- **Duas abas compartilham o localStorage, logo compartilham o `clientId`.** Além de colapsarem numa entrada de presença, o filtro de auto-eco faz a aba B **descartar as operações da aba A**; elas não convergem entre si. O JSDoc de `src/js/presence/presence-store.js:11-12` fala em "várias abas" chaveadas por `clientId`, mas nada no código deriva id por aba. Multi-aba no mesmo atlas é cenário **não suportado**.
- **O `sessionId` do frame `connected` nunca é reconciliado de volta.** O servidor ecoa o id efetivo ali (gerando um próprio se o recebido for malformado), e o cliente guarda a mensagem inteira em `this.session` mas jamais atualiza `this._clientId` (`src/js/store/sync/ws-client.js:416-418`). Enquanto mandarmos UUID válido é inofensivo; no dia em que divergir, o auto-eco morre sem nenhum sinal. É o mesmo risco do regex, por outra porta.
- **Não confunda com identidade de usuário.** `sessionContext.getUserId()` cai para `clientId` quando offline (`src/js/store/sync/session-context.js:185-190`). Serve para autoria local, mas o mesmo `clientId` atende usuários diferentes que logarem no mesmo navegador. Ver [[dominio-local-vs-remoto]] e [[modos-operacao]].

## Idempotência: o resumo padrão está errado

Dizem que "a idempotência sobrevive à reconexão graças ao `clientId`". A chave de idempotência do servidor é o **`op.id`**, não o `clientId`; `idempotent: true` no ack significa "já apliquei antes" e deve contar como sucesso no dequeue ([[ack-idempotencia]], [[idempotencia-e-convergence-guard]]). O papel do `clientId` é indireto: manter a [[fila-operacoes-outbound]] reenviada reconhecível como do mesmo cliente e fazer o eco dessas ops ser descartado localmente. Conflito de fato continua sendo LWW por ordem de chegada ([[modelo-conflito-lww]], [[sintese-nao-e-crdt]]).

O `clientId` é carimbado em toda operação, portanto faz parte do [[envelope-operacao]].
