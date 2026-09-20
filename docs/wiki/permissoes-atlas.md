# Permissões e Papéis por Atlas

Dois vocabulários ortogonais convivem: o tier `permission` por atlas (backend, `read < comment < write < manage < owner`), que é quem realmente autoriza, e o `role` de identidade (frontend, `owner/admin/manager/editor/commenter/viewer`), que só rotula e alimenta flags de UI. Um terceiro eixo, o papel global da conta, corta os dois.

Tabelas de níveis e capacidades: `PERMISSION_LEVELS` (`backend/src/middleware/permissions.js`) e `ROLE_PERMISSIONS` (`frontend/src/js/store/sync/session-context.js`). Consolidadas em [[sintese-capacidades-por-papel]] e [[sintese-eixos-de-permissao]].

## Por que dois vocabulários

**`permission` decide, `role` rotula.** O eixo `role` existe porque a UI precisa de rótulos que misturam duas dimensões que o backend guarda separadas: a permissão naquele atlas e o papel global do usuário. Um admin global não tem linha em `atlas_shares`, mas precisa ver "Admin do sistema" e ganhar acesso total. `owner` também nunca aparece em `atlas_shares`, é sintetizado de `atlas.owner_id`.

**Desde 2026-08-21 uma pessoa pode alcançar o atlas por DOIS caminhos**, o share direto e o share de um grupo de que ela participa, e o nível efetivo é o **máximo** dos dois (`fn_user_atlas_shares`). Nada aqui muda de forma: a escada continua a mesma e o gate continua sendo por hierarquia. O que muda é onde a resposta nasce: quem resolver "qual o meu nível" lendo `atlas_shares` direto lê metade do eixo, sem erro nenhum. Ver [[compartilhamento-atlas]].

Não invente um terceiro vocabulário nem traduza um no outro fora de `toFrontendRole` (`backend/src/utils/roles.js`), que é a única fonte da derivação e é entregue no payload `connected` do WebSocket.

**O frontend não guarda `connected.permission`.** Lê só `payload.role` (`frontend/src/js/store/sync/sync-engine.js`) e deriva as flags booleanas dali. Um guia anterior mandava gatear o cliente por `permission !== 'read'`; o cliente real ignora `permission` por completo. Os dois caminhos concordam no caso comum, e o gate por `role` é até mais fino (distingue `commenter`, separa `editor` de `manager`), mas para qualquer cliente novo o campo congelado e canônico é `permission`; `role` é aditivo e diverge se alguém mexer em `toFrontendRole` sem atualizar as duas pontas.

`toFrontendRole` é fail-closed: entrada não reconhecida vira `viewer`. Bom padrão, mas um tier novo degrada silenciosamente em vez de estourar.

## Onde cada gate acontece

Quatro camadas independentes, nenhuma substitui a outra:

1. **Rota / handshake** (`requireAtlasPermission`, `backend/src/middleware/permissions.js`; `resolvePermission`, `backend/src/modules/collab/collab.gateway.js`). Cascata dono → share → público → **404** (nada resolveu, ou seja, nenhuma relação com o atlas). O **403** fica um degrau adiante, para quem resolveu algum nível e ele é insuficiente. Detalhe da escada em [[sintese-contrato-erros-http]].
2. **Handler grosso** (`backend/src/modules/collab/collab.handlers.js`). `read` não escreve; `read` **e** `comment` não emitem seleção.
3. **Checagem fina por op** (`assertOperationAllowed` e `operationDenialReason`, `backend/src/modules/sync/sync.service.js`), dentro do loop de push, valendo igual para WS e REST. As duas não falham igual, e a separação é deliberada: violação de tier lança e derruba o lote (o principal inteiro é suspeito), enquanto negativa de política devolve motivo e deixa o lote seguir, porque lançar ali rolava a transação inteira e um único delete recusado congelava o sync daquele cliente para sempre.
4. **Guard de papel no cliente** (`frontend/src/js/store/sync/permission-guard.js`). Puramente UX.

**O ponto não-óbvio:** a rota de push exige apenas `comment`, não `write`, para que Comentaristas cheguem lá. Ela é permissiva de propósito, e quem impede o vazamento de escrita é a camada 3. Mexer no gate de rota para "endurecer" não adiciona segurança e quebra comentário; mexer em `assertOperationAllowed` sim é mudança de segurança. Ver [[envelope-operacao]] e [[tabela-operations]].

Na saída o eixo também vale: `broadcastOperations` nunca entrega ops de `comment` a conexões `read`, e **divide um lote misto** para que o cliente `read` ainda receba as ops não-comentário (`backend/src/modules/collab/collab.rooms.js`). Um lote 100% comentário resulta em nada enviado, o que é correto mas parece um drop silencioso quando se lê o log.

## Revalidação em socket vivo

`permission` é resolvido no handshake, mas um socket vive horas. `reconcileAuthorization` roda a cada heartbeat (`backend/src/modules/collab/collab.gateway.js`): revogação, despublicação ou org desativada fecham com `4003` (close limpo, o peer some na hora em vez de ficar `away`); um rebaixamento apenas atualiza `ws.permission`, e a próxima escrita é recusada.

**Não existe frame de "sua permissão mudou" no eixo `permission`.** Quem avisa a UI é `sharing_updated`, no eixo `role`. No cliente, aplique-o com `updateRole()` (`frontend/src/js/store/sync/session-context.js`), nunca `setSession`, que zeraria `userId`/`username` e apagaria o avatar. Ver [[canal-collab-websocket]].

## O guard do cliente só vale para atlas remoto conectado

`checkPermission` (`frontend/src/js/store/sync/permission-guard.js`) retorna `allowed` quando `isOffline() || !isRemoteStoreSync()`. É a linha mais importante do arquivo: o papel **não** gateia o store local, mesmo logado. Sem ela, um usuário autenticado cuja sessão ainda está em Leitor (que é onde toda hidratação começa) não conseguiria desenhar no próprio espaço local. O discriminante é o marcador de origem do store, não namespacing por atlas. Ver [[dominio-local-vs-remoto]] e [[modos-operacao]].

O guard falha **suave**: as store ops chamam `checkPermission`, emitem `STORE_OPERATION_BLOCKED` e retornam. `assertPermission` existe mas não tem call site fora do barrel `frontend/src/js/store/sync/index.js`. Antes de usá-la, saiba que ela lança onde o resto do sistema apenas bloqueia.

## Armadilhas

- **`manage` está ACIMA de `write`, mas `manage` não é `owner`.** Um gate escrito como `permission === 'write' || permission === 'owner'` exclui o co-Gestor silenciosamente. Sempre compare por nível numérico. O Co-Gestor compartilha, configura ([[atlas-settings]]) e apaga mapa, mas **não trava** mapa: apagar é ação de gestão, travar é override de coordenação e continua `owner` estrito. É para `manage` que o ex-dono é rebaixado numa transferência de posse.
- **O gate numérico ERA fail-OPEN, e o conserto foi mover a falha para o mount.** A comparação `PERMISSION_LEVELS[resolvido] < PERMISSION_LEVELS[exigido]` devolve `false` quando qualquer um dos lados é `undefined`, então um tier desconhecido **ou um erro de digitação no argumento** (`requireAtlasPermission('writes')`) fazia o middleware chamar `next()` e liberar, inclusive no gate `'owner'` que protege o `DELETE` do atlas e a transferência de posse. Desde 2026-07-25 `requireAtlasPermission` **lança `TypeError` em tempo de MONTAGEM** para nível desconhecido (`backend/src/middleware/permissions.js`), que é onde um erro estático ainda é de graça: os routers são construídos no import, então a digitação errada vira falha de boot em vez de rota aberta. Há o simétrico em runtime para `resolvedLevel === undefined`, e teste em `backend/tests/integration/permissions-fail-open.test.js` (reverter derruba 17 casos).

  Sobra a mesma **forma** aritmética em `operationDenialReason` (`backend/src/modules/sync/sync.service.js`), e ali ela é inalcançável hoje por outro motivo: o lado exigido é uma propriedade literal (`PERMISSION_LEVELS.manage`, sem risco de digitação) e o lado resolvido é garantido pelo middleware, que agora só deixa passar tier conhecido. É garantia do middleware, não daquele arquivo. O gate de tier vizinho, `assertOperationAllowed`, comparava por **igualdade** a `'read'` e `'comment'`, e era a última lista fechada de verdade deste eixo: um tier novo entre os dois passava por ela sem ser visto, com escrita plena. Desde 2026-09-13 ele compara por posto, e a forma escrita é a **positiva** (`!(nivel >= piso)`), que é o que transforma o desconhecido em recusa em vez de passagem. Preso por `backend/tests/integration/gate-de-sync-falha-fechado.repro.test.js`.
- **Três respostas divergentes para "quem trava mapa".** O backend exige estritamente `owner` (`operationDenialReason`, `backend/src/modules/sync/sync.service.js`); `ROLE_PERMISSIONS` dá `canLockMaps` a owner, manager e admin; e a UI (`canToggleLock`, `frontend/src/js/locking/map-lock.controller.js`) só libera quem o servidor trata como dono. Um `manager` passa no guard do cliente, é barrado pela UI, e seria barrado pelo servidor de qualquer forma. Alinhe as três ao mexer em qualquer uma. Até 2026-08-23 a UI dizia isso com um array `[UserRole.OWNER, UserRole.ADMIN]`, que lia como lista fechada de dois papéis e convidava a "completar" com `manager`; hoje o predicado é `serverTreatsAsAtlasOwner` (`frontend/src/js/projects/permission-levels.js`), e os dois valores daquele array são a MESMA resposta do servidor chegando sob dois nomes de cliente.
- **Admin global nunca chega com permissão baixa.** Tanto o gateway WS (`resolvePermission`) quanto o middleware REST (`requireAtlasPermission`) curto-circuitam admin para `owner` antes de consultar shares. Não escreva código que dependa de ver `permission: "read"` junto com `role: "admin"`.
- **`sharing_updated` deriva role sem o papel global.** `backend/src/modules/sharing/sharing.controller.js` chama `toFrontendRole(permission)` **sem o segundo argumento**; um admin global com share explícito de `read` se auto-rebaixaria ao aplicar esse `role`. A proteção é inteiramente do lado do cliente (ignora o frame se `isAdmin()`, e filtra por `userId` próprio, `frontend/src/js/store/sync/sync-engine.js`). Qualquer novo consumidor precisa repetir as duas guardas.
- **Dois "admin" diferentes.** `sessionContext.isAdmin()` lê `_globalRole`; o `'admin'` de `sessionContext.role` é o papel POR ATLAS, para o qual `toFrontendRole` dobra o administrador global. Podem discordar, e a origem da confusão é a palavra compartilhada. Desde 2026-08-23 nenhuma tela compara `sessionContext.role === 'admin'` à mão: as que precisavam disso passaram a chamar `serverTreatsAsAtlasOwner` ou `atlasRoleHasAtLeast`, em `frontend/src/js/projects/permission-levels.js`, que é onde a dobra está escrita uma vez só. Quem cobra é `frontend/tests/unit/permissao-de-atlas-censo.test.js`.
- **`sessionContext.role` logo após o login é LEITOR**, não o papel do atlas; só vira o papel real depois do `connected` (ou do `ownerId` do snapshot, que antecipa o Dono). Até 2026-08-20 ele nascia do `org_role` do usuário, e um crachá `admin` dentro da OM abria a interface de Administrador de atlas para quem não tinha permissão nenhuma. `globalRole` é preservado quando `setSession` roda sem ele (`frontend/src/js/store/sync/session-context.js`) justamente para o `connect` não apagar o bit de admin. Ver [[organizacoes-om]] e [[gestao-usuarios]].
- **Visitante de link público é ONLINE mas `isAuthenticated()` é `false`**, então nunca comenta (`frontend/src/js/store/comment.operations.js`). `connectPublic` também chama `disableOperationLogging()`: sem isso as ops ficariam órfãs na fila e seriam empurradas para o atlas errado num login posterior. Ver [[link-publico]] e [[fila-operacoes-outbound]].
- **Visualizador não recebe comentários**, é filtro de transmissão no snapshot e no broadcast, não esconde-UI. Ver [[comentario-espacial]].
- **Offline = permissões plenas.** `clearSession()` volta a OFFLINE com `FULL_PERMISSIONS`. Não confunda "sem papel" com "sem acesso".
- **A permissão padrão abaixa, nunca eleva.** Convite entra em `read`, e valor não reconhecido cai para `read` em vez de escalar.
- **Clonar exige só `read`**, mas o clone torna quem clonou o `owner` da cópia ([[clone-atlas]]).

O cadeado do mapa segue o mesmo princípio P1: `canToggleLock` (`frontend/src/js/locking/map-lock.controller.js`) gateia pelo **store**, não pela sessão. Store local (`!isRemoteStoreSync()`) é sempre destravável, esteja o usuário logado ou não; só o atlas remoto conectado restringe a OWNER/ADMIN, e o backend também exige OWNER ali.

> [!CONTRADICAO 2026-07-18, RESOLVIDO 2026-07-24] `canToggleLock` gateava por papel assim que a sessão ficava ONLINE, sem consultar `isRemoteStoreSync()` como o `isReadOnly()` logo abaixo já fazia: um `editor` logado recebia "Apenas o dono pode bloquear o mapa" no próprio mapa **local**. Os testes que existiam congelavam esse comportamento (afirmavam `false` para editor/viewer online com o store local), então foram reescritos junto do fix. Controle negativo em `frontend/tests/integration/map-lock.test.js`: 28/28 com o fix, 3 falham sem ele.

## Adicionou um nível de permissão?

Seis lugares: `PERMISSION_LEVELS`, `assertOperationAllowed`, `applyCommentOp`, `toFrontendRole`, `UserRole`, `ROLE_PERMISSIONS`. **Eles não falham do mesmo jeito, e a diferença é a coisa mais importante desta página.**

**NENHUM DOS SEIS FALHA ABERTO desde 2026-09-13, e até aquela data um falhava: `assertOperationAllowed`** (`backend/src/modules/sync/sync.service.js`). Ele barrava por igualdade a `'read'` e a `'comment'`, então um tier novo entre os dois caía fora dos dois `if` e recebia escrita plena, sem ser visto. Hoje ele pergunta por posto, e a lição que sobra é sobre a FORMA e não sobre aquele arquivo: a escrita é a **positiva** (`!(nivel >= piso)`), nunca a negativa (`nivel < piso`), porque `PERMISSION_LEVELS` de um valor desconhecido é `undefined`, toda comparação contra ele é falsa, e só a positiva transforma isso em recusa. As duas leem igual e decidem o contrário. A outra lição é sobre o alcance do censo: a regra mecânica dele é sobre a LINHA, então uma cadeia de igualdades em linhas separadas é a mesma exclusão escrita na vertical e passa inteira. Preso por `backend/tests/integration/gate-de-sync-falha-fechado.repro.test.js`, que injeta o sexto degrau por `pushOperations` (o CHECK de `atlas_shares.permission` impede que ele venha de fixture).

Os outros cinco falham **fechados**, por motivos diferentes, e nenhum é cosmético:

- `PERMISSION_LEVELS` deixou de ser fail-open em 2026-07-25 (ver armadilha acima): nível desconhecido derruba o boot no `requireAtlasPermission`.
- `applyCommentOp` decide a moderação de comentário alheio comparando **posto** contra o piso `write` (`PERMISSION_LEVELS[permission] >= PERMISSION_LEVELS.write`), e o booleano alimenta as queries de update e delete. Um nível novo ACIMA de `write` entra no gate sozinho, que é a propriedade que a lista fechada anterior não tinha; um nível novo entre `comment` e `write` nasce sem poder moderar, o que é a direção segura. Posto desconhecido é `undefined`, e toda comparação contra ele é falsa, então o gate fecha em cima de lixo.
- `toFrontendRole`, `UserRole` e `ROLE_PERMISSIONS` são derivação de rótulo e degradam para `viewer`.

Duas versões anteriores desta seção erraram aqui, nas duas direções: até 2026-07-18 ela dizia que os cinco "degradam para `viewer` sem erro" (falso para os que decidem), e depois disso passou a dizer que "os três primeiros falham abertos", o que contradizia o parágrafo do `applyCommentOp` logo abaixo dela e já não valia para `PERMISSION_LEVELS`. Corrigido em 2026-08-14 contra o código.

## Toast de bloqueio: o set que decide a mensagem

`STORE_OPERATION_BLOCKED` carrega um `reason`, e `frontend/src/js/store/store-error-listener.js` classifica com `LOCK_REASONS = new Set(['map_locked', 'target_map_locked'])`. **Toda razão fora do set cai no ramo de "somente leitura"**. Uma razão nova de trava precisa ser adicionada ao set, senão o usuário lê "somente leitura" em um mapa que só está travado.

O debounce de 3 s é contado **por tipo** (`lock` e `denied` com timestamps separados) exatamente para que um toast de trava não engula o de somente-leitura que chegou logo depois. O mesmo texto de somente-leitura aparece no toggle voluntário de modo seguro (`frontend/src/js/ui/view-mode.controller.js`), de propósito.

O modo seguro deriva "posso editar" do **mesmo** `checkPermission('UPDATE_FEATURE')` que as store ops usam (`frontend/src/js/ui/view-mode.controller.js`), então nunca há UI habilitada para uma ação que o store recusaria. O toggle voluntário é descartado ao mudar de atlas ou sessão, para não vazar para um workspace que nunca pediu por ele.

## Relação com o resto do sync

Papel decide **se** a op entra; a ordem de chegada no servidor decide **quem vence** ([[modelo-conflito-lww]]). O papel não participa da resolução de conflito. O overlay `atlas.settings` é um eixo separado, restritivo por interseção ([[atlas-settings]]). Ver também [[compartilhamento-atlas]], [[atlas-modelo-de-dados]], [[api-rest-atlas]], [[erros-api]], [[presenca-colaborativa]], [[sessao-boot-e-ciclo-de-vida]], [[autenticacao-jwt]] e [[jwt-emissor-unico]].

## Histórico

- 2026-08-23: a seção "Adicionou um nível de permissão?" descrevia `applyCommentOp` como lista fechada por igualdade (`write`/`manage`/`owner`) e a chamava "a única ocorrência viva do padrão no módulo de sync". Ele passou a gatear por posto contra o piso `write`. O gate por igualdade que restou no módulo foi o `assertOperationAllowed`, e ele caiu em 2026-09-13, na revisão de lançamento do eixo: era o último que falhava ABERTO, e a seção acima passou a descrever a forma positiva em vez de nomear um culpado.

## Cláusulas da constituição com prova parcial (revisão de 2026-09-13)

A revisão de lançamento do eixo de permissão (achados P1 a P25, todos corrigidos, decididos ou conferidos até 2026-09-14; o relatório foi absorvido por testes e decisões e apagado em 2026-09-15) deixou esta lista, que é o que impede a próxima revisão de ler o verde como cobertura completa.

**As DEZ foram fechadas em 2026-09-19, e a tabela fica aqui com o "antes" ao lado do "depois"**, porque
apagar a linha destruiria a única resposta para "isto já foi olhado?" e convidaria a próxima revisão a
reabrir cada uma do zero:

| cláusula | o que não era provado | onde passou a ser |
|---|---|---|
| 1.1 | o predicado do inventário do censo global exigia um literal `'admin'` na linha, então a forma que o próprio cabeçalho nomeia como o perigo (`if (role !== 'user')`) não entraria na varredura. Ela não existe em lugar nenhum (P18), mas o guarda não era quem garantia isso | [`backend/tests/unit/papel-global-censo.test.js`](../../backend/tests/unit/papel-global-censo.test.js): um TERCEIRO gatilho varre comparação contra os outros três papéis. Ele é por COMPARAÇÃO e não por presença do literal, e a diferença foi medida: a forma larga acusa nove DEFAULT (`role: p.role \|\| 'user'`) e a estreita acusa zero nesta árvore. O controle injeta a forma perigosa num arquivo não rastreado e exige a acusação |
| 1.2 | "deslogado não é papel, é modo" seguia sem prova: o teste citado assere o domínio do CHECK da coluna, e nada impediria alguém de representar o deslogado por um pseudo-papel fora dela | [`backend/tests/integration/permissoes-atlas-clausulas-parciais.test.js`](../../backend/tests/integration/permissoes-atlas-clausulas-parciais.test.js), em três camadas: a coluna recusa os seis nomes que alguém inventaria, `flexibleAuth` sem credencial deixa `req.user` AUSENTE em vez de sintetizar papel, e os quatro predicados de acesso leem o principal NULO como "ninguém" |
| 1.2 (adendo) | que a chave de API resolva carregando o papel global **admin** não era asserido; o teste citado mede só a precedência | o mesmo arquivo, numa rota SÓ-FLEXÍVEL (`GET /api/v1/sv360/projects`), porque o `auth` estrito adota o papel vivo do banco e mascararia o defeito. A chave do administrador recebe o campo de administração e a de um comum não. **A segunda metade daquela linha estava VENCIDA:** "o corte de sessão em massa não a alcança" descreve 2026-08-23, e a terceira amarra da cláusula 10.7 (2026-08-24) fez o corte alcançar a chave pelo NASCIMENTO dela, asserido em [`backend/tests/integration/chave-de-api-tres-amarras.test.js`](../../backend/tests/integration/chave-de-api-tres-amarras.test.js) |
| 1.3 | o controle negativo de "só o administrador promove" usava apenas o `user` comum; nenhum caso tentava um `producer` ou um `credenciado` promovendo alguém | o mesmo arquivo: os dois levam 403, o alvo não se move, e o MESMO corpo aplicado pelo administrador passa |
| 4.2 | o curinga do administrador era exercido em três das cinco rotas; as duas de MEMBRESIA, que são justamente o "adiciona e remove pessoas" da cláusula, nunca eram chamadas como administrador | [`backend/tests/integration/access-groups-crud.test.js`](../../backend/tests/integration/access-groups-crud.test.js): o administrador PÕE e TIRA pessoa do grupo alheio, com o efeito medido na tabela de composição e não só no status |
| 4.4 | "o administrador vê todos" não era asserido: nenhum caso chamava `GET /access-groups` com token de administrador (é verdade no SQL, pelo segundo ramo de `fn_can_administer_group`) | o mesmo arquivo, com caso próprio: o administrador enxerga os grupos de dois donos diferentes, e o credenciado e cada dono não enxergam o do vizinho |
| 7.2 | a porta do MAPA ("o store local É o atlas que sobe, e o wipe posterior é a troca de atlas") não era medida por nenhum dos três arquivos citados | [`frontend/tests/unit/enviar-atlas-local-ao-servidor.test.js`](../../frontend/tests/unit/enviar-atlas-local-ao-servidor.test.js), que já usava a porta do mapa como contraste em PROSA. A medição é ESTRUTURAL e prende a ORDEM (ler antes de apagar, montar o namespace antes do wipe, declarar a origem depois dele), com a porta da lista como discriminação: ela não cita `clearAllDataStore` nenhuma vez |
| 7.4 | `duplicateLocalAtlas`, a metade que dá identidade própria à cópia no registro (sem a qual a lista mostra dois cartões iguais), não tinha caso próprio | [`frontend/tests/unit/local-atlas-api.test.js`](../../frontend/tests/unit/local-atlas-api.test.js): o registro do destino sai com o id e o nome DA CÓPIA, o da origem não se move, o dado veio junto, e a lista mostra dois cartões de nomes distintos |
| 8.5 (bullet 1) | a DESATIVAÇÃO como gatilho nunca era medida na superfície de empréstimo: o arquivo que mede empréstimo não contém uma única ocorrência de `is_active`, e os gatilhos que ele mede são revogação e transferência | [`backend/tests/integration/permissoes-atlas-clausulas-parciais.test.js`](../../backend/tests/integration/permissoes-atlas-clausulas-parciais.test.js), com os QUATRO gatilhos que o predicado tem: a conta do dono, a OM de LOTAÇÃO do dono, a conta de quem CONCEDEU a ele, e a OM PRODUTORA quando o empréstimo se sustenta por produção. Cada um com o piso antes, a queda depois e a REATIVAÇÃO como controle |
| 5.8 | a recusa ao dono nomeia "transferir a posse ou mandar à lixeira", e o teste cobrava só a primeira metade | [`backend/tests/integration/sair-do-atlas.test.js`](../../backend/tests/integration/sair-do-atlas.test.js), que passou a cobrar as duas saídas: pela regra da 4.7, negativa sem saída é um muro, e com metade das saídas manda a pessoa procurar a que sobrou |

**Os controles negativos foram MEDIDOS, não afirmados.** Desligar `fn_principal_vivo` no ramo de
empréstimo, o termo de concedente vivo e a checagem de OM produtora derruba os quatro casos de 8.5;
alargar o CHECK de `users.role` derruba o de 1.2; fixar o papel em `'user'` no ramo de chave de API
derruba o de 1.2 (adendo); tirar `requireAdmin` de `PUT /users/:userId` derruba o de 1.3; apagar a
reescrita de identidade derruba o de 7.4; e trocar a ordem do wipe derruba o de 7.2.

**O que NÃO se fechou, e por quê.** A prova de 7.2 é estrutural (ela lê o código-fonte da porta), então
ela prende a ORDEM contra uma reescrita distraída e não substitui o comportamento com navegador, que
mora em [`frontend/tests/e2e-ui/browser-save-local-to-server.spec.js`](../../frontend/tests/e2e-ui/browser-save-local-to-server.spec.js)
e fica FORA do `npm test`. E a varredura de 1.1 continua textual: papel montado por concatenação sai
dela, como o cabeçalho daquele arquivo já declarava antes desta rodada.
