# Revisão de lançamento: permissão de atlas e papel global

Data: 2026-09-13. Branch: `plano/b13perm`. Escopo pedido pelo dono como fundamental para o lançamento.

Esta revisão cobre os **dois eixos de autorização** nos dois pacotes: o eixo **por atlas**
(`read < comment < write < manage < owner`, que é escada) e o **papel global**
(`user`, `producer`, `credenciado`, `admin`, que não é escada). Uma revisão parcial feita mais cedo no
mesmo dia já cobriu sync, as quatro exceções REST, uploads, recibos e sockets (achados A1..A15, commits
`31be8d26`, `eb6b84fc`, `e192e10e`); aquilo **não** foi refeito aqui.

## O que foi conferido

| frente | alcance | como |
|---|---|---|
| `CONSTITUICAO.md`, cláusula a cláusula | as 80 citações de teste; leitura dirigida das seções 1, 4, 5, 7 e 8.5 | citação conferida mecanicamente; proof conferido por leitura do teste citado |
| servidor, porta por porta | as **179 rotas** dos 22 `*.routes.js`, com a cadeia de middleware de cada uma | inventário completo, mais varredura por cheiro (rota sem gate, lista fechada, `role !== 'user'`, visitante de link alcançando escrita) |
| cliente, gate por gate | `permission-guard.js` (28 `GuardAction`), `ROLE_PERMISSIONS`, `permission-levels.js`, `denialNotice`, as duas tabelas de ação, o modal de compartilhamento | inventário, mais a varredura de **todo produtor de op de sync** (`tx.recordOperation`, 38 sítios em 14 arquivos, mais 2 caminhos diretos de fila) |
| a ponte entre os eixos | `toFrontendRole` e os seus quatro chamadores; a ordem dos gates de `middleware/auth.js` | leitura, mais teste novo |
| hidratação do papel | `isAtlasRoleResolved`, `forgetAtlasRole`, a semente VIEWER, a despromoção ao vivo | leitura; já havia guarda para a maior parte |

**Correção de método que vale registrar.** A varredura de "quem enfileira op sem consultar o guard" **não**
se faz por `grep` de `log*Operation`: desde a migração write-ahead a intenção nasce em
`tx.recordOperation` dentro de `runTransaction`, e resta **um único** chamador externo vivo da família
antiga. Uma varredura pelo nome antigo teria reportado zero sítios ungated e estaria errada; foi pelo
produtor novo que os três achados P2/P3 apareceram.

## A matriz posto x ação

Medida contra o servidor REAL nos cinco degraus (não amostrada), e conferida contra o cliente no mesmo
processo. Ela é hoje `frontend/tests/e2e/matriz-posto-por-acao.e2e.test.js`.

| ação | servidor exige | cliente (capacidade) | concordam? |
|---|---|---|---|
| ler o snapshot (`pullSync`) | `read` | não gateia por posto (é decisão de rota) | n/a |
| escrever comentário espacial | `comment` | `canComment` | sim |
| escrever feição | `write` | `canEdit` | sim |
| ler o compartilhamento (`GET /sharing`) | `manage` | `canManageUsers` | sim |
| configurar o atlas (`PATCH /settings`) | `manage` | não gateia por posto | n/a |
| excluir o atlas | `owner` | não gateia por posto | n/a |
| excluir mapa (op `map` delete) | `manage` | `canDeleteMap` | sim |
| travar mapa (op `map` update `{locked}`) | `owner` estrito | `canLockMaps` | sim |

As duas últimas linhas viajam por sync e não por rota, então ficam fora do arquivo de matriz (que mede
por porta); elas estão presas por `backend/tests/integration/permission-hierarchy-matrix.test.js` e pelo
censo, e a assimetria `manage` pode excluir mapa mas **não** travar é deliberada e está declarada nos dois
pacotes.

O que a matriz afirma, e é mais que "o gate existe": que o corte está onde a constituição declara, que a
escada é **monotônica** em cada ação (asserido à parte, porque é essa propriedade que distingue uma escada
de uma lista fechada que por acaso acerta na amostra), e que o cliente responde o mesmo degrau a degrau.
A cobertura de contrato anterior media DOIS degraus (`read` e `write`), isto é, não distinguia os dois
casos; faltavam justamente `comment` e `manage`, que são os que a lista fechada historicamente excluiu.

## Achados

### P1. o gate por operação do sync falhava ABERTO (CORRIGIDO)

`assertOperationAllowed` (`backend/src/modules/sync/sync.service.js`) comparava por IGUALDADE a `'read'` e
a `'comment'`, em duas linhas separadas. Um degrau NOVO entre os dois cairia fora dos dois `if` e receberia
escrita PLENA. A cláusula 5.2 manda o contrário em voz alta, e a wiki já o nomeava como "o único que falha
ABERTO", sem que nada o cobrasse: **o censo por atlas proíbe dois degraus distintos na MESMA linha, e uma
cadeia de igualdades em linhas separadas é a mesma exclusão escrita na vertical.**

Hoje ele pergunta por posto, na forma **positiva** (`!(nivel >= piso)`). A forma importa: `PERMISSION_LEVELS`
de um valor desconhecido é `undefined`, toda comparação contra ele é falsa, e só a positiva transforma isso
em recusa. Comportamento idêntico para os cinco degraus vivos.

Preso por `backend/tests/integration/gate-de-sync-falha-fechado.repro.test.js`. O sexto degrau entra por
`pushOperations`, que recebe a permissão como parâmetro, porque o CHECK de `atlas_shares.permission` impede
que ele venha de fixture. Controle negativo: 2 dos 5 casos ficam vermelhos ao reverter.

### P2. três entradas da fachada de camada enfileiravam op sem consultar o guard (CORRIGIDO)

`setLayerVisibility`, `setLayerLocked` e `createLayerForImport` eram as únicas das nove entradas de
`frontend/src/js/store/layer.operations.js` sem `checkPermission` e sem a checagem de trava, e as três
escrevem: `_writeLayers` registra uma intenção `layer` para qualquer campo que mude.

**O caminho é o normal, não uma borda.** O olho e o cadeado da aba de feições são desenhados para TODO
papel. Um Leitor ou um Comentarista clicando neles enfileirava uma op que o servidor recusa com 403 no
**push inteiro**, e resposta não-2xx não é desenfileirada pelo cliente: a fila reenviava o mesmo lote a
cada 1,5 s para sempre. No caso do Comentarista levava junto todo comentário legítimo dele, que era a única
coisa que ele tinha para sincronizar.

**Os testes congelavam o buraco, e é por isso que ele sobreviveu a mais de uma revisão**: os três blocos
afirmavam a ausência do guard, com estas palavras, "bypasses permission AND lock checks" e "does NOT check
permission or lock (unrestricted)". Foram reescritos para medir a recusa, com o caso positivo ao lado.

Preso por `frontend/tests/store/layer-operations.test.js`. Controle negativo: 6 dos 36 casos ficam vermelhos.

### P3. `removeFeatureFromMap` enfileirava um DELETE sem guard (CORRIGIDO)

Era a única entrada de escrita de feição de `frontend/src/js/store/feature.operations.js` sem `guardWrite`,
e não por ser interna: o barril `@store` a reexporta, e os executores de DESFAZER e REFAZER de
`moveBetweenMaps` a chamam sem opções, isto é, com `logOperation` no default `true`. Um Ctrl+Z depois de o
share cair de Editor para Leitor enfileirava um `feature` DELETE recusado com 403 no lote inteiro.

Preso por `frontend/tests/store/move-features-map.test.js`. Controle negativo: 2 dos 30 casos.

### P4. `POST /atlas/:atlasId/restore` alcançado por principal sem conta (CORRIGIDO)

É a única rota de escrita de `/atlas/:atlasId` sem `requireAtlasPermission`, e essa ausência é legítima e já
estava comentada (o atlas está com `deleted_at` posto, e aquele middleware só enxerga atlas vivo). O que
faltava era o PRINCIPAL: o visitante de link público passa o `auth` estrito, não encontra gate de atlas, e
chega ao controller, que passa `req.user.id` cru; o `sub` sintético `public-<uuid>` bate num `::uuid`.

**Medido, e diferente do que o comentário irmão do `/clone` afirma:** a borda MAPEIA 22P02, então o que saía
era **400** "Valor mal formado", nunca 500. Nenhum privilégio era ganho, porque o predicado de posse jamais
casaria com aquela string; o defeito é a distância entre as duas frases, e é a distinção que
`requireAccountPrincipal` existe para fazer uma rota abaixo.

Preso por `backend/tests/integration/restaurar-visitante-publico.repro.test.js`, que mede também o atlas
VIVO (o cast acontece antes de qualquer linha ser comparada, então o defeito não dependia da lixeira).
Controle negativo: 2 dos 4 casos.

### P5. a prosa mandava consertar o que já estava consertado (CORRIGIDO)

`CLAUDE.md` dizia que "o servidor tem UMA lista fechada viva declarada no censo, em `handleSelection`", e a
wiki dizia que `assertOperationAllowed` era "o único que falha ABERTO" e "o primeiro lugar a mexer".
`handleSelection` virou hierarquia no dia em que o censo nasceu (a classe `LISTA_FECHADA_VIVA` está
declarada e VAZIA, com o zero asserido em caso próprio) e `assertOperationAllowed` caiu em P1. No lugar do
culpado nomeado entrou a lição sobre a FORMA, mais a ressalva que faltava sobre o ALCANCE do censo (a regra
é sobre a LINHA), que é o que deixou P1 passar.

### P6. as duas guardas de `sharing_updated` não tinham caso (CORRIGIDO (teste))

A ponte entre os eixos é `toFrontendRole`, e ela dobra o `admin` global para o topo da escada **só** quando
recebe o segundo argumento. `sharing.controller.js` a chama com UM argumento nos dois emissores de frame por
pessoa, e o comentário de lá delega a correção inteira ao cliente. O cliente faz a parte dele em duas
linhas, e nenhuma tinha caso: sem a de identidade, a frame que nomeia outra pessoa re-gateia a minha tela;
sem a de papel global, um administrador do sistema que também alcance o atlas por share se auto-rebaixa a
Visualizador. O caminho realista nem é o share nominal: é o administrador participar de um grupo de acesso
cujo vínculo com o atlas muda, porque ali o servidor emite uma frame por membro conectado.

O dublê de `sessionContext` não tinha `isAdmin`, então aquele handler morria num TypeError se alguém o
chamasse, o que é boa parte da razão de ele nunca ter sido chamado.

Preso por `frontend/tests/integration/sync-engine.test.js`. Controle negativo medido **uma linha por vez**,
porque duas remoções juntas não dizem qual linha segura qual caso.

### P7. a matriz não cobria `comment` nem `manage` (CORRIGIDO (teste))

Descrito acima. `frontend/tests/e2e/matriz-posto-por-acao.e2e.test.js`. Controle negativo medido nas DUAS
metades: subir o gate de `GET /sharing` de `manage` para `owner` no servidor reprova em `manage`; tirar
`canManageUsers` do `manager` no cliente reprova na comparação.

---

### P8. `GET /users/search` não tem recorte nenhum (ABERTO PARA O DONO)

`searchUsers` (`backend/src/modules/users/users.service.js`) recebe só o termo e não referencia o chamador
em lugar nenhum. O `WHERE` casa contra **nome de posto e nome de OM** além de username e nome, com piso de
dois caracteres e `LIMIT 20`, e a rota não tem limitador próprio. Qualquer conta `user`, e qualquer chave de
API de escopo largo, enumera o efetivo inteiro entre organizações, 20 linhas por vez, por termos como o
nome de uma OM.

**Não é defeito de implementação:** a rota existe porque compartilhar atlas é direito de qualquer um
(cláusula 4.1) e para compartilhar é preciso achar a pessoa. O que está aberto é a decisão de produto:
se o casamento por posto e por OM deve continuar (é ele que transforma busca em enumeração), e se a rota
deve ganhar limitador. Não mexi porque a constituição não fala sobre isto e a mudança estreita uma função
legítima.

O visitante de link público **já** está barrado ali por `confineVisitorPrincipal` (sem parâmetro de atlas
na URL, ele leva 403).

### P9. `GET /catalog-videos/:file` não tem gate nenhum (ABERTO PARA O DONO)

`serveVideo` resolve o caminho a partir do nome do arquivo e transmite, com
`Cache-Control: public, max-age=31536000, immutable`. Está documentado como capability-in-URL. A consequência
que merece nome: o vídeo de prévia de um item de catálogo **privado**, ou de um projeto 360 privado ou
desabilitado, é servido a quem tiver o nome do arquivo, e **marcar o recurso como privado não revoga o
vídeo**, porque nada re-cunha aquele nome numa virada de visibilidade. Decisão do dono.

### P10. `setColorUsageCompat` enfileira uma op `setting` sem guard (CONFERIDO, LATENTE)

`frontend/src/js/store/repositories/index.js` chama `logAtlasSetting({ colorUsage })` direto do repositório,
pulando a camada de op de store, onde a pergunta de posto mora (compare com
`map.operations.recordAtlasSetting`, que tem o gate `UPDATE_ATLAS_SETTINGS` pela mesma classe de chave).

**Rastreado até a ponta, não há caminho vivo hoje:** `processMapColors` só é chamado por `addMap` (gateado);
`saveColorUsageToDB` só é alcançado por `updateColorUsage`, que só é chamado do `deferSync` de operações de
feição (gateadas); e `performInitialColorAnalysis`, que seria o caminho de LEITURA capaz de disparar isto num
Leitor abrindo um atlas, **não tem chamador nenhum** (código morto). Fica registrado porque o arranjo é o
mesmo de P2 antes de ele ficar vivo, e porque consertá-lo é decisão de camada (repositório não importa o
guard hoje), não uma linha.

### P11. `GuardAction.CLEAR_ALL_DATA` não tem consumidor (CONFERIDO, SEM DEFEITO)

Zero referências fora de `permission-guard.js`. É o estado em que `COMBINE_MAPS` esteve antes de ser ligado.
Não há função exposta hoje: a ação "Limpar" é escondida na linha do atlas remoto pela tabela de estado. Gate
inerte, não buraco.

### P12. `GET /atlas/:atlasId/settings` em `read` (CONFERIDO, SEM DEFEITO)

Um Visualizador e um visitante de link público leem as seis listas de id de catálogo do documento
`settings`. É consistente com o snapshot, que já os serve no mesmo degrau, e a escrita continua em `manage`.
É a coisa mais larga que `read` expõe, e está declarada aqui para não ser redescoberta como achado.

### P13. `POST /atlas/:atlasId/clone` em `read` (CONFERIDO, SEM DEFEITO)

Qualquer Visualizador, e o portador logado de um link público, copia o atlas inteiro para a própria conta.
Deliberado e documentado (cláusula 8.3), com a poda por destinatário no caminho
(`classifyResourceRefs`), e com `requireAccountPrincipal` barrando o anônimo. É a rota de `read` com maior
alavancagem da tabela, e por isso fica nomeada.

### P14. o `setting` por sync e o `PATCH /settings` não se cruzam (CONFERIDO, SEM DEFEITO)

O `PATCH` exige `manage` e escreve as chaves de disponibilidade de recurso; a op `setting` por sync é
alcançável em `write` e a allowlist dela é **disjunta** daquelas chaves (exagero de terreno, projeção do
globo, ícones, ordem de mapas, cores). Um Editor não reescreve o que o atlas expõe. Preso por
`backend/tests/integration/sync-atlas-settings.test.js`, que mede a chave de recurso sendo descartada.

### P15. a ordem dos gates de `middleware/auth.js` (CONFERIDO, SEM DEFEITO)

Conta inativa (401) → OM inativa (403) → corte de sessão (401) → só então a adoção do papel vivo
(`req.user.role`) e do escopo de produção. O gate precede a adoção, que é o que faz um administrador que
desativou a própria lotação não alcançar a tela que desfaria o ato (o servidor recusa esse caso com 409
desde 2026-08-24). A vivacidade também viaja no eixo por atlas, dentro do próprio `SELECT` de
`requireAtlasPermission` (`fn_principal_vivo`), e o atalho do `admin` global mora DENTRO dela, de propósito.

### P16. hidratação do papel no cliente (CONFERIDO, SEM DEFEITO)

`isAtlasRoleResolved` separa "é Leitor" de "ainda não sei", não autoriza nada, e só concede o direito de
ACUSAR; `forgetAtlasRole` o esquece ao sair do atlas, para que o `owner` do atlas A não valha na janela de
conexão do atlas B. Preso por `frontend/tests/unit/recusa-antes-do-papel-chegar.repro.test.js`. A
despromoção ao vivo chega e é aplicada pelos dois caminhos (`atlas_owner_changed` e `sharing_updated`), o
segundo agora com caso (P6).

### P17. nenhuma lista fechada do eixo por atlas no cliente (CONFERIDO, SEM DEFEITO)

Varredura completa de `frontend/src/js/`: nenhuma linha junta dois ou mais valores distintos do vocabulário
por `||`, `&&`, literal de array ou `.includes(`. Toda comparação multi-valor passa por
`frontend/src/js/projects/permission-levels.js`, que é o único sítio autorizado. As comparações de valor
único que restam (`user_permission === 'owner'` em `atlas-drive.js` e `shared-atlas-badge.js`) particionam
"meus" contra "compartilhados", e `owner` é de fato o único degrau que significa posse.

### P18. nenhuma promoção por `role !== 'user'` (CONFERIDO, SEM DEFEITO)

A string não aparece em `backend/src/` nem em `frontend/src/js/`; o único acerto é um comentário de migração
advertindo contra ela. Toda comparação de papel global é igualdade exata contra um literal nomeado, ou
pertinência a um conjunto nomeado (`PAPEIS_DE_DADO_GLOBAL`). No cliente o eixo é lido por quatro predicados
só (`isAdmin`, `isProducer`, `hasGlobalDataAccess`, `canProduceFor`), todos por igualdade.

Duas notas que não são defeito e convém não perder: `collab.gateway.js` lê `payload.role`, mas os dois
chamadores vivos passam um objeto já reconciliado com o banco (um quinto chamador que passasse o JWT cru
reintroduziria o administrador rebaixado promovido); e `sv360.service.js` roda sob `flexibleAuth`, que não
reconcilia, então um administrador rebaixado mantém a leitura de projeto desabilitado pela vida do token
(até 15 min) se alguma consulta futura não carregar o predicado SQL.

### P19. `hasGlobalDataAccess()` tem DOIS chamadores, e o cabeçalho diz um (CONFERIDO, DOC)

`frontend/src/js/store/sync/session-context.js` declara que o predicado deixou de decidir tela em
2026-08-20 e que resta um consumidor; há dois, e o segundo (`account.control.js`) decide uma entrada de
menu. Não é promoção indevida (`admin || credenciado` é exatamente o que a cláusula 2.6 e a 3.3 dão a esse
par), mas o cabeçalho descreve um alcance menor que o real.

### P20. comentários de código citando 500 onde o medido é 400 (CONFERIDO, DOC)

`middleware/auth.js` e `atlas.routes.js` descrevem o 22P02 do `/clone` como "um 500". A borda mapeia 22P02
para 400 (`middleware/error-handler.js`). O comportamento corrigido é o mesmo; a descrição do estado
anterior é que está uma faixa acima. Medido em P4.

## Estado das cláusulas

Nenhuma cláusula mudou de estado nesta revisão: os defeitos corrigidos (P1..P4) estavam todos **abaixo** do
que a constituição declara, isto é, o texto já mandava o que o código passou a fazer. As 80 citações de
teste resolvem, e a integridade disso é mecânica (`frontend/tests/unit/docs-integridade.test.js`).
`frontend/tests/unit/constituicao-estado-das-clausulas.test.js` continua verde com a mesma lista de
não-vigentes.

## O que esta revisão NÃO alcançou

- **A superfície do 360 e do catálogo** só foi tocada pelo inventário de rotas; o eixo de RECURSO (concessão,
  empréstimo, poda) não foi reauditado, porque tem página e censos próprios.
- **Playwright não foi executado.** A revisão é de lógica e de contrato; nenhuma afirmação aqui é sobre pixel.
- **O alcance do administrador é provado rota a rota, não universalmente** (a própria cláusula 2.7 declara
  isso): uma superfície de configuração NOVA que não desse caminho ao administrador não deixaria nada
  vermelho.
