# clientId estável

Identificador composto, `<instalação>_<aba>`, montado por `frontend/src/js/store/sync/operation-factory.js`: não é credencial, não é identidade de usuário, mas é o que faz presença e filtro de auto-eco sobreviverem a uma reconexão.

## As duas metades respondem perguntas diferentes

Esta página descreveu o id como um valor único de `localStorage` até 2026-08-15, e a metade que faltava é a que resolve o caso de duas abas:

- **Instalação** (`localStorage`, uma por perfil de navegador, nunca rotacionada). É o que faz presença, a graça de 120 s de `away` no servidor e a de-duplicação de auto-eco sobreviverem a um F5 e a uma reconexão.
- **Aba** (`sessionStorage`, uma por aba, preservada no F5 daquela aba). É o que impede duas abas de colapsarem numa entrada de presença e num único slot de `away` no servidor.

**O sufixo de aba não pode ser simplesmente herdado**, e é aí que mora o não óbvio: `sessionStorage` é copiado por inteiro em quatro situações (duplicar aba, `window.open` com opener, reabrir aba fechada, restaurar sessão), então a cópia nasceria com o sufixo de uma aba que ainda está viva. Por isso existe um registro de reivindicações em `localStorage` com heartbeat: um sufixo herdado cuja reivindicação ainda está sendo renovada é descartado e um novo é cunhado. A janela é generosa (`TAB_CLAIM_FRESH_MS`, 5 min) e a assimetria é deliberada: ler uma reivindicação viva como morta é exatamente a falha que o mecanismo existe para impedir, enquanto ler uma morta como viva custa só um sufixo novo, ou seja, uma entrada de presença a mais que o filtro de auto-eco nem percebe. Aba em segundo plano tem timer estrangulado para cerca de um por minuto, então a janela tem que folgar bem acima disso.

## O contrato

Ele **não autoriza nada**. Quem autoriza é o JWT ([[autenticacao-jwt]]) e a permissão por atlas resolvida no handshake ([[permissoes-atlas]]). Forjar o `clientId` alheio não dá acesso a nada, só bagunça presença e de-duplicação. Consequência prática: **não derive nada de segurança dele** e não assuma que ele chega, porque é opcional na query do [[canal-collab-websocket]] e o servidor gera um quando falta.

O que não pode mudar: o valor precisa casar o regex do servidor `^[a-zA-Z0-9_-]{8,64}$`. Isso já foi acidental (um UUID de 36 caracteres passava por sorte da classe de caracteres) e hoje é verificado: `isValidClientId` é um ESPELHO do `CLIENT_ID_PATTERN` do servidor e é aplicado ao id COMPOSTO antes de ele ser entregue, e um id de instalação que não caiba é recunhado. O teto de 64 é o que aperta agora, porque o composto é UUID mais separador mais 12 caracteres. Um id malformado não é recusado no servidor: o gateway cunha silenciosamente um próprio, e a aba fica carimbando operações com um id que a sala não conhece, o que mata o filtro de auto-eco sem um único erro em lugar nenhum.

A metade de instalação sobrevive a login, logout e troca de usuário no mesmo navegador **por design**: nenhum caminho do app a limpa. `resetClientId()` existe só para teste; chamá-lo em produção equivale a trocar de máquina. Ver [[sessao-boot-e-ciclo-de-vida]].

## Por que ele é crítico: o auto-eco

O push por REST (`POST /sync`) faz broadcast para a sala inteira, e o emissor HTTP não tem socket para ser excluído do broadcast pelo servidor. **Quem descarta o próprio eco é o cliente**, comparando `op.clientId === this._clientId` (`frontend/src/js/store/sync/ws-client.js`, span `ws.self-echo` no [[syncledger]]). Por isso o singleton nasce com o id estável (`frontend/src/js/store/sync/ws-client.js`): já houve regressão em que `_clientId` ficava `null`, a de-dup desligava e o autor reaplicava todas as próprias operações.

Presença ([[presenca-colaborativa]]) é chaveada por ele, com queda para `userId` e depois `id` (`resolveKey`, `frontend/src/js/presence/presence-store.js`). A queda **não é exceção**: os frames de `cursor`, `selection` e `temporal` não carregam `clientId`, só os de roster, então a mesma pessoa acaba com uma entrada por chave. Detalhe e consequências em [[presenca-colaborativa]]. E na queda de rede: um close abnormal (1006) marca `away` e agenda remoção após `WS_AWAY_GRACE_MS` (120 s). Reconectar com o **mesmo** id cancela o timer e emite `user_back`; com um id diferente o servidor vê cliente novo e o antigo cai como `user_left` ao fim da graça. Saída intencional não depende disso: `disconnect()` manda `{type:'leave'}` antes do close 1000 (`frontend/src/js/store/sync/ws-client.js`), removendo na hora.

## Armadilhas

- **Sem localStorage o id ainda é gerado, só que em memória** (`frontend/src/js/store/sync/operation-factory.js`): iframe sandbox, modo privado, runner Node. Cada F5 vira um cliente novo: presença duplica, a graça `away` não é cancelada e o auto-eco para de reconhecer as próprias ops. O sync não quebra; as garantias somem **silenciosamente**.
- **O filtro de auto-eco compara INSTALAÇÕES, não o id inteiro** (`clientIdInstallation`, chamado em `frontend/src/js/store/sync/ws-client.js`), e isso é carga estrutural em dois pontos: uma operação enfileirada antes de um F5 carrega o sufixo da aba ANTERIOR, e uma escrita por um build mais antigo não carrega sufixo nenhum. Filtrar por id exato faria a aba reaplicar o próprio trabalho nos dois casos. **A contrapartida é que duas abas do mesmo navegador descartam o eco uma da outra e não convergem entre si**, e isso só é são porque um navegador nunca tem duas abas no MESMO atlas: quem proíbe é o tab lock ([[coordenacao-entre-abas]]), e uma operação só alcança uma aba pela sala do seu atlas. Esta linha afirmou o contrário até 2026-08-15, dizendo que "nada no código deriva id por aba" e tratando multi-aba como cenário simplesmente não suportado.
- **O `sessionId` do frame `connected` nunca é reconciliado de volta.** O servidor ecoa o id efetivo ali (gerando um próprio se o recebido for malformado), e o cliente guarda a mensagem inteira em `this.session` mas jamais atualiza `this._clientId` (`frontend/src/js/store/sync/ws-client.js`). Enquanto mandarmos UUID válido é inofensivo; no dia em que divergir, o auto-eco morre sem nenhum sinal. É o mesmo risco do regex, por outra porta.
- **Não confunda com identidade de usuário.** `sessionContext.getUserId()` cai para `clientId` quando offline (`frontend/src/js/store/sync/session-context.js`). Serve para autoria local, mas o mesmo `clientId` atende usuários diferentes que logarem no mesmo navegador. Ver [[dominio-local-vs-remoto]] e [[modos-operacao]].

## Idempotência: o resumo padrão está errado

Dizem que "a idempotência sobrevive à reconexão graças ao `clientId`". A chave de idempotência do servidor é o **`op.id`**, não o `clientId`; `idempotent: true` no ack significa "já apliquei antes" e deve contar como sucesso no dequeue ([[ack-idempotencia]], [[idempotencia-e-convergence-guard]]). O papel do `clientId` é indireto: manter a [[fila-operacoes-outbound]] reenviada reconhecível como do mesmo cliente e fazer o eco dessas ops ser descartado localmente. Conflito de fato continua sendo LWW por ordem de chegada ([[modelo-conflito-lww]]).

O `clientId` é carimbado em toda operação, portanto faz parte do [[envelope-operacao]].
