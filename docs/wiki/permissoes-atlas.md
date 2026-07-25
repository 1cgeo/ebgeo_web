# Permissões e Papéis por Atlas

Dois vocabulários ortogonais convivem: o tier `permission` por atlas (backend, `read < comment < write < manage < owner`), que é quem realmente autoriza, e o `role` de identidade (frontend, `owner/admin/manager/editor/commenter/viewer`), que só rotula e alimenta flags de UI. Um terceiro eixo, o papel global da conta, corta os dois.

Tabelas de níveis e capacidades: `backend/src/middleware/permissions.js:12-18` e `frontend/src/js/store/sync/session-context.js:60-85`. Consolidadas em [[sintese-capacidades-por-papel]] e [[sintese-eixos-de-permissao]].

## Por que dois vocabulários

**`permission` decide, `role` rotula.** O eixo `role` existe porque a UI precisa de rótulos que misturam duas dimensões que o backend guarda separadas: a permissão naquele atlas e o papel global do usuário. Um admin global não tem linha em `atlas_shares`, mas precisa ver "Admin do sistema" e ganhar acesso total. `owner` também nunca aparece em `atlas_shares`, é sintetizado de `atlas.owner_id`.

Não invente um terceiro vocabulário nem traduza um no outro fora de `toFrontendRole` (`backend/src/utils/roles.js:12-19`), que é a única fonte da derivação e é entregue no payload `connected` do WebSocket.

**O frontend não guarda `connected.permission`.** Lê só `payload.role` (`frontend/src/js/store/sync/sync-engine.js:192-198`) e deriva as flags booleanas dali. Um guia anterior mandava gatear o cliente por `permission !== 'read'`; o cliente real ignora `permission` por completo. Os dois caminhos concordam no caso comum, e o gate por `role` é até mais fino (distingue `commenter`, separa `editor` de `manager`), mas para qualquer cliente novo o campo congelado e canônico é `permission`; `role` é aditivo e diverge se alguém mexer em `toFrontendRole` sem atualizar as duas pontas.

`toFrontendRole` é fail-closed: entrada não reconhecida vira `viewer`. Bom padrão, mas um tier novo degrada silenciosamente em vez de estourar.

## Onde cada gate acontece

Quatro camadas independentes, nenhuma substitui a outra:

1. **Rota / handshake** (`backend/src/middleware/permissions.js:57-132`, `backend/src/modules/collab/collab.gateway.js:52-107`). Cascata dono → share → público → **404** (nada resolveu, ou seja, nenhuma relação com o atlas). O **403** fica um degrau adiante, para quem resolveu algum nível e ele é insuficiente. Detalhe da escada em [[sintese-contrato-erros-http]].
2. **Handler grosso** (`backend/src/modules/collab/collab.handlers.js:83-85`, `:115-121`). `read` não escreve; `read` **e** `comment` não emitem seleção.
3. **Checagem fina por op** (`assertOperationAllowed` e `operationDenialReason`, `backend/src/modules/sync/sync.service.js`), dentro do loop de push, valendo igual para WS e REST. As duas não falham igual, e a separação é deliberada: violação de tier lança e derruba o lote (o principal inteiro é suspeito), enquanto negativa de política devolve motivo e deixa o lote seguir, porque lançar ali rolava a transação inteira e um único delete recusado congelava o sync daquele cliente para sempre.
4. **Guard de papel no cliente** (`frontend/src/js/store/sync/permission-guard.js`). Puramente UX.

**O ponto não-óbvio:** a rota de push exige apenas `comment`, não `write`, para que Comentaristas cheguem lá. Ela é permissiva de propósito, e quem impede o vazamento de escrita é a camada 3. Mexer no gate de rota para "endurecer" não adiciona segurança e quebra comentário; mexer em `assertOperationAllowed` sim é mudança de segurança. Ver [[envelope-operacao]] e [[tabela-operations]].

Na saída o eixo também vale: `broadcastOperations` nunca entrega ops de `comment` a conexões `read`, e **divide um lote misto** para que o cliente `read` ainda receba as ops não-comentário (`backend/src/modules/collab/collab.rooms.js:83-115`). Um lote 100% comentário resulta em nada enviado, o que é correto mas parece um drop silencioso quando se lê o log.

## Revalidação em socket vivo

`permission` é resolvido no handshake, mas um socket vive horas. `reconcileAuthorization` roda a cada heartbeat (`backend/src/modules/collab/collab.gateway.js:115-140`): revogação, despublicação ou org desativada fecham com `4003` (close limpo, o peer some na hora em vez de ficar `away`); um rebaixamento apenas atualiza `ws.permission`, e a próxima escrita é recusada.

**Não existe frame de "sua permissão mudou" no eixo `permission`.** Quem avisa a UI é `sharing_updated`, no eixo `role`. No cliente, aplique-o com `updateRole()` (`frontend/src/js/store/sync/session-context.js:297-302`), nunca `setSession`, que zeraria `userId`/`username` e apagaria o avatar. Ver [[canal-collab-websocket]].

## O guard do cliente só vale para atlas remoto conectado

`frontend/src/js/store/sync/permission-guard.js:71-73` retorna `allowed` quando `isOffline() || !isRemoteStoreSync()`. É a linha mais importante do arquivo: o papel **não** gateia o store local, mesmo logado. Sem ela, um usuário autenticado com `org_role` `viewer` não conseguiria desenhar no próprio espaço local. O discriminante é o marcador de origem do store, não namespacing por atlas. Ver [[dominio-local-vs-remoto]] e [[modos-operacao]].

O guard falha **suave**: as store ops chamam `checkPermission`, emitem `STORE_OPERATION_BLOCKED` e retornam. `assertPermission` existe mas não tem call site fora do barrel `frontend/src/js/store/sync/index.js:131`. Antes de usá-la, saiba que ela lança onde o resto do sistema apenas bloqueia.

## Armadilhas

- **`manage` está ACIMA de `write`, mas `manage` não é `owner`.** Um gate escrito como `permission === 'write' || permission === 'owner'` exclui o co-Gestor silenciosamente. Sempre compare por nível numérico. O Co-Gestor compartilha, configura ([[atlas-settings]]) e apaga mapa, mas **não trava** mapa: apagar é ação de gestão, travar é override de coordenação e continua `owner` estrito. É para `manage` que o ex-dono é rebaixado numa transferência de posse.
- **O gate numérico é fail-OPEN, e é o único do conjunto que é.** `requireAtlasPermission` compara `PERMISSION_LEVELS[resolvedPermission] < PERMISSION_LEVELS[requiredLevel]` (`backend/src/middleware/permissions.js:128-131`). Tier ausente do mapa vira `undefined`, e `undefined < 5` é `false`, então o middleware chama `next()` e **libera**, inclusive em `requireAtlasPermission('owner')`, que gateia o `DELETE` do atlas e a transferência de posse (`backend/src/modules/atlas/atlas.routes.js:28,38`). A simetria é dupla e pior: um erro de digitação no argumento (`requireAtlasPermission('writes')`) torna `requiredLevelNum` `undefined`, e `3 < undefined` também é `false`, desligando o gate da rota inteira em silêncio. A mesma aritmética governa `operationDenialReason` (`backend/src/modules/sync/sync.service.js:974`), e o gate de tier ao lado dela é uma lista fechada sobre `read`/`comment` (`backend/src/modules/sync/sync.service.js:940-949`), que também deixa passar um tier que não conhece. É a mesma família do bug logo acima: comparação que silencia um nível. Nenhum teste cobre a comparação numérica: `backend/tests/unit/middleware-permissions.test.js` só exercita `resolvePermission`, que é função pura, e `backend/tests/integration/permissions.test.js` só percorre tiers conhecidos.
- **Três respostas divergentes para "quem trava mapa".** O backend exige estritamente `owner` (`operationDenialReason`, `backend/src/modules/sync/sync.service.js`); `ROLE_PERMISSIONS` dá `canLockMaps` a owner, manager e admin; e a UI (`LOCK_CAPABLE_ROLES`, `frontend/src/js/locking/map-lock.controller.js:39`) só libera owner e admin. Um `manager` passa no guard do cliente, é barrado pela UI, e seria barrado pelo servidor de qualquer forma. Alinhe as três ao mexer em qualquer uma.
- **Admin global nunca chega com permissão baixa.** Tanto o gateway WS (`backend/src/modules/collab/collab.gateway.js:83-85`) quanto o middleware REST (`backend/src/middleware/permissions.js:82-87`) curto-circuitam admin para `owner` antes de consultar shares. Não escreva código que dependa de ver `permission: "read"` junto com `role: "admin"`.
- **`sharing_updated` deriva role sem o papel global.** `backend/src/modules/sharing/sharing.controller.js:38,57` chama `toFrontendRole(permission)` **sem o segundo argumento**; um admin global com share explícito de `read` se auto-rebaixaria ao aplicar esse `role`. A proteção é inteiramente do lado do cliente (ignora o frame se `isAdmin()`, e filtra por `userId` próprio, `frontend/src/js/store/sync/sync-engine.js:466-471`). Qualquer novo consumidor precisa repetir as duas guardas.
- **Dois "admin" diferentes.** `sessionContext.isAdmin()` lê `_globalRole`; `frontend/src/js/account/account.control.js` e `frontend/src/js/locking/map-lock.controller.js` comparam `sessionContext.role === 'admin'`, que é o papel por atlas. Podem discordar.
- **`sessionContext.role` logo após o login é o `org_role`**, não o papel do atlas; só vira o papel real depois do `connected`. `globalRole` é preservado quando `setSession` roda sem ele (`frontend/src/js/store/sync/session-context.js:247-249`) justamente para o `connect` não apagar o bit de admin. Ver [[organizacoes-om]] e [[gestao-usuarios]].
- **Visitante de link público é ONLINE mas `isAuthenticated()` é `false`**, então nunca comenta (`frontend/src/js/store/comment.operations.js:33-37`). `connectPublic` também chama `disableOperationLogging()`: sem isso as ops ficariam órfãs na fila e seriam empurradas para o atlas errado num login posterior. Ver [[link-publico]] e [[fila-operacoes-outbound]].
- **Visualizador não recebe comentários**, é filtro de transmissão no snapshot e no broadcast, não esconde-UI. Ver [[comentario-espacial]].
- **Offline = permissões plenas.** `clearSession()` volta a OFFLINE com `FULL_PERMISSIONS`. Não confunda "sem papel" com "sem acesso".
- **A permissão padrão abaixa, nunca eleva.** Convite entra em `read`, e valor não reconhecido cai para `read` em vez de escalar.
- **Clonar exige só `read`**, mas o clone torna quem clonou o `owner` da cópia ([[clone-atlas]]).

O cadeado do mapa segue o mesmo princípio P1: `canToggleLock` (`frontend/src/js/locking/map-lock.controller.js:71-90`) gateia pelo **store**, não pela sessão. Store local (`!isRemoteStoreSync()`) é sempre destravável, esteja o usuário logado ou não; só o atlas remoto conectado restringe a OWNER/ADMIN, e o backend também exige OWNER ali.

> [!CONTRADICAO 2026-07-18 — RESOLVIDO 2026-07-24] `canToggleLock` gateava por papel assim que a sessão ficava ONLINE, sem consultar `isRemoteStoreSync()` como o `isReadOnly()` logo abaixo já fazia: um `editor` logado recebia "Apenas o dono pode bloquear o mapa" no próprio mapa **local**. Os testes que existiam congelavam esse comportamento (afirmavam `false` para editor/viewer online com o store local), então foram reescritos junto do fix. Controle negativo em `frontend/tests/integration/map-lock.test.js`: 28/28 com o fix, 3 falham sem ele.

## Adicionou um nível de permissão?

Seis lugares: `PERMISSION_LEVELS`, `assertOperationAllowed`, `applyCommentOp`, `toFrontendRole`, `UserRole`, `ROLE_PERMISSIONS`. **Eles não falham do mesmo jeito, e a diferença é a coisa mais importante desta página.**

Os três primeiros são do backend e falham **abertos**. Os três últimos são derivação de rótulo e falham fechados, degradando para `viewer`. Ou seja: esquecer o lado que só rotula é cosmético; esquecer o lado que autoriza libera.

O terceiro é o que menos se acha, porque é o padrão que a constituição proíbe, vivo dentro do sync: `applyCommentOp` decide a moderação de comentário alheio com `permission === 'write' || permission === 'manage' || permission === 'owner'` (`backend/src/modules/sync/sync.service.js`), lista fechada por igualdade, e é ela que alimenta as queries de update e delete. Hoje está completa por sorte, já que `read` nunca chega ali e `comment` cai no ramo do autor. Um nível novo acima de `comment` nasce sem poder moderar, em silêncio, que é exatamente o sintoma dos dois bugs reais já registrados. É um eixo separado do `assertOperationAllowed` documentado acima, e a armadilha logo abaixo (comparar por nível, nunca por igualdade) só tem esta ocorrência viva no módulo de sync.

Até 2026-07-18 esta seção dizia que os cinco "degradam para `viewer` sem erro". Era falso para os dois que decidem, e a frase logo acima (`toFrontendRole` é fail-closed) reforçava a leitura errada de que o conjunto se comporta igual.

## Toast de bloqueio: o set que decide a mensagem

`STORE_OPERATION_BLOCKED` carrega um `reason`, e `frontend/src/js/store/store-error-listener.js:23` classifica com `LOCK_REASONS = new Set(['map_locked', 'target_map_locked'])`. **Toda razão fora do set cai no ramo de "somente leitura"**. Uma razão nova de trava precisa ser adicionada ao set, senão o usuário lê "somente leitura" em um mapa que só está travado.

O debounce de 3 s é contado **por tipo** (`lock` e `denied` com timestamps separados) exatamente para que um toast de trava não engula o de somente-leitura que chegou logo depois. O mesmo texto de somente-leitura aparece no toggle voluntário de modo seguro (`frontend/src/js/ui/view-mode.controller.js:68`), de propósito.

O modo seguro deriva "posso editar" do **mesmo** `checkPermission('UPDATE_FEATURE')` que as store ops usam (`frontend/src/js/ui/view-mode.controller.js:44-46`), então nunca há UI habilitada para uma ação que o store recusaria. O toggle voluntário é descartado ao mudar de atlas ou sessão, para não vazar para um workspace que nunca pediu por ele.

## Relação com o resto do sync

Papel decide **se** a op entra; a ordem de chegada no servidor decide **quem vence** ([[modelo-conflito-lww]]). O papel não participa da resolução de conflito. O overlay `atlas.settings` é um eixo separado, restritivo por interseção ([[atlas-settings]]). Ver também [[compartilhamento-atlas]], [[atlas-modelo-de-dados]], [[api-rest-atlas]], [[erros-api]], [[presenca-colaborativa]], [[sessao-boot-e-ciclo-de-vida]], [[autenticacao-jwt]] e [[jwt-emissor-unico]].
