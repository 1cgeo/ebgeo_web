# Relatório de UX: o usuário comum logado

Perfil avaliado: conta com papel GLOBAL `user`, o mais numeroso do sistema. `CONSTITUICAO.md` é a
especificação de referência.

**Auditoria original: 2026-08-23, 19h24.** 31 achados numerados, mais um inventário de ações, uma
lista do que não deve ser mexido e sete perguntas ao dono.

**Revisão: 2026-08-23, à noite.** As sete perguntas foram respondidas e viraram trabalho. Um lote
grande atacou parte dos achados, e este documento foi reescrito para separar o que saiu do que fica.

## Como esta revisão foi feita

Cada um dos 31 achados foi reaberto **contra o código da árvore de trabalho**, não contra a lista de
commits. Isso importa por dois motivos medidos aqui:

1. **Três dos quatro commits citados como "o lote" precedem a auditoria** (367d8bb5 às 14h03,
   d3dcdcf2 às 18h21, 8b3762e8 às 18h49, contra 19h24 da auditoria). O trabalho que de fato
   resolveu achados é majoritariamente o **não commitado** na árvore.
2. Ler a lista de commits e concluir "feito" é chancelar a saída de quem fez. Onde este documento diz
   RESOLVIDO, o arquivo foi aberto e o símbolo, procurado.

A conferência achou as três categorias esperadas, e a terceira foi a mais produtiva: achados
resolvidos por um caminho **diferente** do proposto, achados cuja metade resolvida escondia a outra
metade aberta, e um achado que estava **errado na origem**.

## Placar

| | |
|---|---|
| achados conferidos | 31 |
| saíram (resolvidos, ou retirados por estarem errados) | 8 |
| ficam | 23, dos quais 2 são parciais |
| achados NOVOS, nascidos do próprio lote | 4 |

Gravidade dos que ficam, **reordenada por gravidade real** e não pela numeração antiga: 7 altos,
10 médios, 6 baixos. Os três CRÍTICOS originais saíram, e não sobrou nenhum: **não há mais perda
irreversível de trabalho neste perfil.**

---

## 1. As decisões do dono, e como ficaram no código

Isto não é achado, é conhecimento. Existe para que a próxima sessão não reabra a discussão.

**1.1 Sair da conta com fila pendente: não perguntar.** O dono recusou o diálogo, com o argumento que
decide o desenho: *"não vejo necessidade de pergunta para salvar pois o sincronismo ocorre sempre"*.
A fila só tem conteúdo quando algo **não conseguiu** subir, nunca porque alguém escolheu não subir,
então não há intenção a respeitar e oferecer a escolha apresentaria como decisão um estado que
ninguém decidiu.

Implementado em `frontend/src/js/session/unsynced-work-exit.js` (novo) e
`frontend/src/js/session/unsynced-work-phrases.js`. O clique liga em
`AccountControl._handleLogoutGesture`, que conta a fila, chama `shouldPreserveLocalWork` com
`involuntary: true` **de propósito** (para a saída voluntária usar a mesma regra da involuntária),
resgata e informa por toast. As páginas sem mapa chamam `preserveUnsyncedWorkOnLostSession` e o
desfecho viaja na URL (`ExitOutcome`, mais a contagem), remontado no mapa por
`explainEndedSessionFromUrl` a partir de `exitOutcomeNotice`: só o código viaja, nunca a frase.

**Divergência frente à pergunta:** o diálogo de três saídas chegou a ser construído e foi **podado**,
não deixado sem referência. Saíram oito símbolos (o guarda de saída, o enum de escolha, as quatro
frases do diálogo, o predicado que decidia perguntar e o valor "descartado" do enum de desfecho) e,
com eles, o import do modal de confirmação, que é o que mantém o módulo carregável nas duas páginas
que não bootam sistema de modal nenhum.

**1.2 O Leitor vê os participantes dentro do mapa: sim.** Implementado pela leitura (b) da pergunta,
a mais fiel ao texto da cláusula 5.7, e por uma porta **própria**, não pelo botão de compartilhar:
ação `participants` em `frontend/src/js/sidebar/tabs/atlas-actions.js`, aberta por
`MapsTab._handleParticipants` como `showSharingModal(atlasId, { readOnly: true })`.

**Divergência que importa:** a fonte **não** é a rota de sharing, e não podia ser. `GET
/atlas/:atlasId/sharing` exige `manage` nos quatro verbos, então um modo de leitura que a chamasse
tomaria 403 de exatamente quem ele serve. `SharingModal._loadParticipants` chama
`apiClient.getAtlasOverview` e `participantsFromOverview`; do outro lado, `LIST_USER_ATLAS_MEMBERS`
devolve nome, posto e nível por membro. O modo somente leitura é real e não o modo cheio com botões
apagados: `_renderReadOnlyBody` sai antes de instalar os ouvintes de edição e desenha o nível como
selo de texto, nunca um `<select>` desabilitado.

**1.3 O botão "Compartilhar" some para quem não gere: sim.** `visibleAtlasActions` filtra por
`atlasRoleHasAtLeast(role, SHARING_RUNG)`, com `SHARING_RUNG` valendo `manage`. Hierarquia, nunca
lista fechada, e posto desconhecido falha FECHADO. "Compartilhar" e "Participantes" nunca aparecem
juntos, e a despromoção ao vivo troca um pelo outro no mesmo repintar, porque a visibilidade está
assinada em `SESSION_CHANGED` e `CONNECTION_STATE_CHANGED`.

**1.4 Recuperação de senha: por administrador E por e-mail.** As duas existem.
`backend/src/modules/auth/auth.routes.js` ganhou `POST /auth/forgot-password` e `POST
/auth/reset-password`, montadas sob `canDeliverAccountMail()`. O caminho do administrador está
escrito na tela: `LoginModal._createForm` tem botão incondicional "Esqueci minha senha", e o painel
sempre mostra `ADMIN_RECOVERY_TEXT`, acrescentando o formulário de e-mail só quando
`emailRecoveryEnabled` lê a bandeira que o servidor publica pelo MESMO predicado.

**"Token de propósito discriminado" é concreto e é uma coluna.** `email_verification_tokens` ganhou
`purpose` com CHECK de três valores e `new_email` amarrado bicondicionalmente ao propósito de troca.
A imposição é no resgate: a consulta de claim casa `purpose = ANY(...)` e cada rota passa só a lista
que lhe cabe (`TokenPurpose`, `CONFIRMABLE_PURPOSES`). Um link de confirmação não é resgatável na
rota que troca senha, e vice-versa, com controle negativo nas duas direções em
`backend/tests/integration/senha-redefinicao-por-email.test.js`.

Sem relay em produção as rotas não são montadas, a bandeira é falsa e a tela mostra só o caminho do
administrador. Isso é o desenho, não uma falha.

**1.5 Notificação de convite: badge.** `frontend/src/js/projects/shared-atlas-badge.js` (novo, zero
imports) com `sharedAtlasIds`, `resolveSharedBadge` e `badgeScopeNotice`; o Drive o consome em
`AtlasDrive._updateSharedBadge`, dentro de toda construção de grade. A marca é `localStorage` por
conta (`seenMarkStorageKey`), e o custo está escrito no código e é honesto: não cruza navegadores,
morre com a limpeza de dados do site, e a **primeira visita adota a lista em silêncio**, então um
convite recebido antes de o navegador ter marca nunca é contado. O vazio da aba carrega a nota que
diz que a contagem é deste navegador. Só cliente: nada mudou no servidor.

**1.6 Correção de e-mail: ok fazer.** `FIND_USER_BY_ID` passou a projetar `email` e `email_verified`,
e o modal mostra os dois por `emailPresentation`. A troca existe em `PUT /users/me/email`, com
`changeEmailSchema` exigindo a senha atual, conferida por bcrypt antes de qualquer ramo.

**A propriedade que mantém isso compatível com a cláusula 10.6:** o endereço pretendido mora no
token, nunca na conta, então enquanto o convite está de pé o endereço segue livre para outra pessoa,
e a unicidade é conferida no pedido e **de novo** no resgate. Errar a digitação não derruba a conta:
ela segue com o endereço antigo confirmado. Do lado do administrador, `updateUserAdminSchema` passou
a aceitar `email`, e `resolveAdminEmail` faz a troca derrubar a confirmação, salvo se o mesmo pedido
disser o contrário, de modo que corrigir um cadastro não é o mesmo que declará-lo provado. (O que
falta desta decisão está no achado A6, abaixo.)

**1.7 Tile privado: mensagem de camada inacessível, sem afirmar causa.** Implementado inteiro.
`frontend/src/js/terrain/data-layer-phrases.js` (novo, zero imports, node-testável) e um painel
dentro do container do mapa, montado por `DataLayersManager._ensureNotice`. A falha chega por
`DataLayersManager._watchMapErrors`, que assina o evento de erro do MapLibre (a falha assíncrona de
tile, que nenhum `try/catch` daquele arquivo pegava) e retira a acusação quando a camada volta a
desenhar; a rajada é coalescida e agregada **por camada**, não por requisição.

A frase não afirma causa: `layerLoadFailureCauseNotice` diz que o motivo não é conhecido daqui e
enumera rede, servidor e restrição de acesso, com o acesso deliberadamente por ÚLTIMO;
`layerLoadFailureStatusDetail` imprime o código HTTP observado sem interpretá-lo. O teste
`frontend/tests/unit/data-layer-phrases.test.js` prende exatamente isso, inclusive o caso de um 403
não virar "sem acesso".

**Alcance, para não superdeclarar:** vale para as camadas de dado do catálogo geridas por
`DataLayersManager`. Não há fiação equivalente para tileset 3D, 360 ou basemap, e a cobertura é de
frases puras: o desenho do painel e a agregação por camada não têm teste.

---

## 2. Onde há gate proativo de tela, e onde não há

Este é o mapa que organiza quase todos os achados que sobraram, atualizado nesta revisão. **A
divergência com o estatuto nunca esteve no VOCABULÁRIO, e sim na COBERTURA:** onde há gate de tela ele
é por hierarquia e está certo; o problema é a metade da tela que não tem gate nenhum e delega ao
guarda do store, que responde com uma frase única e às vezes falsa.

| superfície | gate proativo | efeito para quem não alcança o degrau |
|---|---|---|
| barras de desenho, militar e análise | `getViewModeController` mais `is-view-only` | somem, correto |
| comentário espacial | `CommentOverlay._canComment`, `CommentsPanel._canComment` | botão some, e a recusa nomeia TRÊS motivos distintos |
| renomear atlas | `MapsTab._canRenameAtlas` | campo vira somente-leitura, com explicação |
| configurações do atlas | `MapsTab._handleOpenSettings` | modal abre só com a aba de aparência |
| menu do cartão em `atlas.html` | `cardMenuActions` | ações somem por posto, correto |
| grade de ações da aba Mapas | `visibleAtlasActions` **(novo)** | "Compartilhar" some e vira "Participantes" |
| "Compartilhar" no menu da conta | `AccountControl._updateShareVisibility` | some abaixo de `manage`, correto |
| travar mapa | `mapLockController.canToggleLock` | botão desabilitado, com explicação |
| **menu de contexto do mapa** | **nenhum** | oferece Renomear, Puxar outros mapas e Deletar a Leitor E a Editor (A1) |
| **"Novo mapa"** | **nenhum** | pede o nome e só então recusa (M1) |
| **"Importar" na aba Mapas** | **nenhum** | Leitor escolhe arquivo e a importação é recusada (M1) |
| **briefing, 3D, 360, camadas, aba de feições** | **nenhum** | oferece tudo e falha no store (M1) |

O lote fechou a linha da grade de ações e não tocou nas quatro últimas.

---

## 3. Os achados que ficam

Reordenados por gravidade real. O número original é mantido entre parênteses, para rastreio.

### ALTO

#### A1 (3.4) O menu de contexto do mapa oferece a Leitor e a Editor o que o servidor recusa

**As duas metades continuam abertas.** `MapsTab._showMapContextMenu`
(`frontend/src/js/sidebar/tabs/maps.tab.js`) monta o menu a partir de duas leituras apenas,
`isMapLocked` e a lista de mapas, e `isMapLocked` (`frontend/src/js/store/map.operations.js`) lê uma
configuração de aplicação, não papel. Nenhum `checkPermission`, nenhum `GuardAction`, nenhum
`mapLockController.isReadOnly`. Leitor e Comentarista recebem Salvar posição, Duplicar, Renomear,
Puxar outros mapas e Deletar; Editor recebe Deletar e Puxar outros mapas, que exigem o degrau
`manage` por `GuardAction.DELETE_MAP` e `GuardAction.COMBINE_MAPS`
(`frontend/src/js/store/sync/permission-guard.js`).

O gate certo existe **no mesmo arquivo**, em `MapsTab._updateCurrentMapCard`, que lê
`mapLockController.isReadOnly` e desabilita o cadeado com explicação. Duas superfícies irmãs, no
mesmo arquivo, com regras diferentes.

**A mensagem também não mudou.** `registerStoreErrorListeners`
(`frontend/src/js/store/store-error-listener.js`) mantém a frase única do ramo `denied`, que afirma
acesso somente leitura e proíbe editar o projeto. Para um Editor tentando deletar um mapa, isso é
**falso**: ele edita, só não gere. E `MapManager.deleteMap` (`frontend/src/js/map/map.manager.js`)
converte o `false` do store num genérico sem distinguir a recusa por permissão, empilhando um segundo
toast. Dois avisos, um genérico e um mentiroso.

**Por que continua sendo o maior dos que sobram.** É a classe "a UI promete o que o servidor recusa",
a que já congelou a fila de saída neste repositório, e o modelo de como fazer certo está a poucas
linhas de distância (`cardMenuActions`, `visibleAtlasActions`). O lote atacou a grade de ações do
atlas e passou ao largo do menu por mapa.

**Correção.** Gatear item a item pela capacidade que o store vai exigir (não desenhar o que não
passa, como já faz `cardMenuActions`); derivar a frase do ramo `denied` da capacidade negada, que o
`reason` já carrega por extenso; e fazer `MapManager.deleteMap` distinguir recusa de erro técnico.

#### A2 (3.23) Teclar Enter para dispensar o aviso pós-cadastro REENVIA o e-mail

**Promovido de MÉDIO.** É uma ação de rede disparada pela tecla que todo mundo usa para dispensar um
diálogo, e o conserto é de uma linha.

`AccountControl._handleRegister` chama `showConfirm` com um parágrafo de três frases no lugar do
título e com `confirmText` valendo "Reenviar e-mail" e `cancelText` valendo "Entendi". Em
`ConfirmModal._render` o primeiro argumento vira o `<h3>`, então o parágrafo é renderizado como
cabeçalho; e `Enter` continua ligado ao ramo afirmativo, que é o reenvio.

A segunda metade também está intacta: `SignupModal._handleSubmit` faz `await this._onSubmit(...)` e
só então fecha, de modo que o formulário de cadastro, **com a senha digitada**, permanece montado
atrás do diálogo, e ao dispensá-lo a pessoa fica olhando o mapa anônimo sem próximo passo.

**Correção.** Fechar o cadastro antes de anunciar, inverter os dois botões (afirmativo = "Entendi"),
ou usar `showChoice`, que não tem botão afirmativo e cujo `Enter` é inerte de propósito.

#### A3 (3.10) O reenvio de confirmação é um botão de uso único, e o e-mail do sistema aponta para uma opção inexistente

Nenhuma das três pontas mudou. `apiClient.resendVerification` continua com **um único chamador** em
todo `frontend/src/`, dentro do diálogo pós-cadastro de `AccountControl._handleRegister`: fechou,
acabou. O código `EMAIL_NOT_VERIFIED` que o servidor devolve no login não é lido pelo cliente
(`LoginModal._handleSubmit` só olha a mensagem), então não há botão de reenvio ao lado do erro. E
`sendAccountExistsEmail` (`backend/src/utils/mailer.js`) continua instruindo a usar a opção de
reenviar a confirmação na tela de cadastro, que `SignupModal._createForm` não tem.

**O que a revisão acrescenta, e agrava:** a recuperação de senha por e-mail entregue na decisão 1.4
**não cobre este caso**. A consulta que alimenta o reset só encontra usuário com endereço
**confirmado**, de propósito. Quem não confirmou continua sem saída nenhuma: não loga, não redefine,
e o único botão de reenvio some ao primeiro clique.

**Correção.** Ler `error.code` no `LoginModal` e oferecer o reenvio ao lado do erro (a rota é anônima
e não vaza existência), mais um link permanente no cadastro, para casar com o texto do mailer.

#### A4 (3.7) Falha de rede na primeira carga de `atlas.html` é indistinguível de "você não tem atlas"

Intacto. Em `initProjectsPage` (`frontend/src/js/projects/projects-page.js`) a lista chega por uma
chamada cujo `catch` devolve `null`, e o `null` morre no chamador: o Drive recebe `[]` e
`AtlasDrive._renderGrid` escreve que não há atlas nesta categoria. Passado o toast, a tela afirma um
fato falso e permanente, sem botão de nova tentativa. O irmão `AtlasDrive._refresh` faz o certo
(mantém a lista anterior), o que mostra que a assimetria é acidental.

**O que a revisão acrescenta:** o mesmo lote **corrigiu esta exata classe em outra tela**, no modal
de recurso, onde a falha de rede deixou de ter a aparência de lista vazia. O Drive ficou de fora.

**Correção.** Um terceiro estado de grade (erro, com frase própria e botão de tentar de novo),
propagando o `null` até o Drive em vez de colapsá-lo em `[]` no chamador.

#### A5 (3.12) "Minha conta" só é alcançável a partir do mapa

**Promovido de MÉDIO, porque o lote o agravou.** A tela ganhou conteúdo (perfil, troca de senha,
chave de API e, agora, leitura e troca do e-mail), e continua com **uma porta só**:
`showAccountSettingsModal` tem um único chamador em `frontend/src/js/`,
`AccountControl._handleOpenAccountSettings`, que é o mapa. `createAppBar`
(`frontend/src/js/ui/app-bar.js`), a barra compartilhada de `atlas.html` e `admin.html`, oferece as
ações da página, o selo de papel, "Calibração 360" e "Sair", e não oferece a conta.

Como o roteamento de boot manda o visitante com sessão direto para `atlas.html`, trocar a senha ou
corrigir o e-mail exige abrir um atlas e esperar o bundle do mapa. O comentário falso continua nos
CSS das três páginas, afirmando que a tela é aberta de todas.

**Correção.** Uma ação em `createAppBar`, gateada por `sessionContext.isAuthenticated()`, com o mesmo
`import()` dinâmico. O CSS já está carregado nas três.

#### A6 (3.11, PARCIAL) O e-mail da conta: resolvido para o titular, incompleto para o administrador

O núcleo saiu (ver decisão 1.6). **O que falta:**

1. **O Painel do Administrador não tem campo de e-mail.** `frontend/src/js/admin/users-tab.js` monta
   nome, usuário, senha, posto, OM, papel, OM produtora e, na edição, apenas a caixa de e-mail
   confirmado. O payload inclui `email_verified` e **nunca** `email`. Ou seja, a capacidade existe na
   API e não existe na tela: o administrador continua só APROVANDO o endereço errado, que é
   literalmente o que o achado apontava. É um campo de texto e uma linha no payload.
2. **Não há botão de reenvio de confirmação** no modal da conta, que era metade da correção proposta.
   `EMAIL_UNVERIFIED_HINT` manda pedir um novo link ao administrador, embora a rota de reenvio seja
   anônima e esteja disponível.
3. **`PUT /users/me/email` é montada incondicionalmente**, sem o gate de entregabilidade que as rotas
   de recuperação receberam. Numa produção sem relay o pedido responde 200, o envio só é registrado
   em log, e a tela mostra `EMAIL_CHANGE_SENT_TEXT` prometendo um link que ninguém mandou. É a
   assimetria exata que a decisão 1.4 tomou o cuidado de evitar do outro lado.

#### A7 (3.8) `showUnavailableScreen` é usado como catch-all de erro de aplicação

Intacto. O `catch` de topo de `initProjectsPage` termina em `showUnavailableScreen()`, o mesmo que
atende à falha de configuração algumas linhas acima, então qualquer exceção de JS anuncia que não foi
possível conectar ao servidor e manda conferir a conexão. O módulo
`frontend/src/js/ui/unavailable-screen.js` exporta **um** símbolo, sem parâmetro de causa. Os outros
três chamadores têm o mesmo problema.

**Correção.** Um segundo estado para erro de aplicação, mantendo o de indisponibilidade só para a
falha de configuração.

### MÉDIO

#### M1 (3.16) Quatro superfícies de criação pedem dados antes de descobrir que não podem

Varredura refeita: `checkPermission`, `GuardAction` e o guarda de permissão devolvem **zero** em
`frontend/src/js/briefing/`, `frontend/src/js/layers/`, `frontend/src/js/3d_models_viewer_tool/` e
`frontend/src/js/street_view_tool/`. Ampliada para o contexto de sessão e a escada, os dois únicos
acertos leem identidade para excluir a PRÓPRIA seleção do desenho de presença, o que é identidade e
não autorização.

`MapsTab._handleNewMap` continua gerando o nome sugerido e abrindo o prompt antes de qualquer
checagem; a recusa vem de `addMap`. `MapsTab._handleImportAdditive` continua abrindo o seletor de
arquivos, e a ação de importar está em todas as linhas da grade, inclusive a remota, porque
`visibleAtlasActions` só filtra as duas portas de acesso. Briefing, 3D e 360 abrem inteiros; a recusa
vem de `createBriefing`, `updateBriefing` e `guardCesium3dWrite`.

O único gate proativo por papel continua sendo `getViewModeController`, que decide por uma única
capacidade de edição de feição e alcança as três barras e as afordâncias da árvore de camadas. Ele
não cobre nenhuma das quatro superfícies acima, e por depender daquela capacidade não fecha nada para
um Editor.

**Correção.** O padrão já existe e está em uso: `CommentOverlay.togglePlacement` recusa a ENTRADA no
modo e nomeia o motivo real entre três possíveis. Replicá-lo.

#### M2 (3.13) Token de confirmação expirado e inválido dão a MESMA mensagem, e ela chuta

Intacto, e o lote o agravou. `handleEmailVerificationFromUrl` (`frontend/src/js/index.js`) continua
com um `catch` sem parâmetro e uma frase única que chuta a expiração. O servidor distingue em
`verifyEmail`, e agora com MAIS casos que antes (inválido, expirado, endereço já em uso, conta
inativa): os quatro chegam na mensagem do erro e os quatro são jogados fora.

**O agravante novo:** `verifyEmail` passou a devolver o propósito, que pode ser a troca de e-mail. O
cliente ignora o retorno e emite sempre a frase que manda fazer login, o que é errado justamente para
quem está logado e acabou de trocar o próprio endereço. O sucesso também continua sem abrir o modal
de login.

#### M3 (3.14) Servidor fora do ar no login vira "HTTP 502" ou "Failed to fetch"

Intacto no caminho do login: `buildApiErrorMessage` continua caindo no código HTTP cru, o erro de
rede do navegador escapa inteiro em inglês, e `LoginModal._handleSubmit` mostra a mensagem sem olhar
o status. As outras quatro categorias (senha inválida, conta desativada, e-mail não confirmado, OM
inativa) continuam distinguíveis, o que está bom.

**O que a revisão acrescenta, e barateia o conserto:** a classificação foi construída no lote, em
`frontend/src/js/utilities/request-failure.js`, com exatamente o mapeamento que o achado pede
(`classifyRequestFailure`, `RequestFailure`, `requestStatus`). Os consumidores são o boot e as
páginas sem mapa; o modal de login não a importa. Fechar isto é um import.

#### M4 (3.20) A edição sobrescrita por um colega continua silenciosa

**Atenção: a metade grave deste achado foi resolvida, e não era a que o achado descrevia.**

O que o achado pedia, um sinal nomeando o autor, **não foi feito**: não há toast nem menção de autoria
em `frontend/src/js/store/sync/remote-operation-handler.js`, e nada novo é emitido para a UI.

O que foi encontrado e consertado é o defeito **inverso**, mais grave e ausente de todos os
relatórios: o autor que **vence** no servidor continuava exibindo o valor do perdedor, para sempre.
Medido com três navegadores reais editando a mesma feição, o banco gravava a cor de um cliente e esse
cliente exibia a de outro pelos trinta segundos do poll, sem órfã e sem op perdida. A causa é falta de
atomicidade em três pontos, e o conserto foi fazer o ack carregar a OP (`recordLocalAppliedVersion`
entregando a op a `resolveLocalEdit`), guardar a evidência de atropelo num mapa separado
(`lastRemoteAppliedVersion`) e serializar o caminho guardado (`serializeGuardedApply`), tudo preso por
`frontend/tests/integration/convergencia-autor-vencedor.repro.test.js` com controle negativo.

**Fica, portanto, só o sinal.** Quando a operação remota tocar entidade que o usuário editou nos
últimos segundos, mostrar um toast nomeando o autor, que a presença já conhece (`presenceStore`). O
modelo de conflito não muda: está registrado como decisão.

#### M5 (3.21) O nível do usuário no atlas fica escondido atrás do avatar

Intacto. `getPermissionLabel` não é sequer importado em `frontend/src/js/sidebar/tabs/maps.tab.js`;
`MapsTab._refreshAtlasHeader` pinta o nome editável e o chip de origem, e usa o posto apenas para
decidir se o campo é somente-leitura, sem exibi-lo. O chip de nível continua dentro do menu suspenso
do avatar, escrito por `AccountControl._applyAtlasName`, e o crachá permanente da barra
(`AtlasNameControl`) mostra ícone e nome, sem nível.

O nível é a explicação de metade do que a tela faz ou deixa de fazer. Se estivesse ao lado do nome do
atlas, o achado A1 seria menos grave mesmo sem correção.

#### M6 (3.22) "Fazer uma cópia" não diz que a cópia é sua nem o que ela perdeu

Intacto, e o rótulo colide de fato: `cardMenuActions` usa a mesma string para o atlas de servidor, e
`LocalAtlasSection._openMenu` usa a MESMA para o local. `AtlasDrive._duplicate` clona e diz apenas que
a cópia foi criada, sem informar que ela nasce em posse de quem clonou nem o que a poda por
destinatário deixou de fora.

**O que agrava:** o servidor **já mede e já devolve** o relatório de poda. `cloneAtlas`
(`backend/src/modules/atlas/atlas.service.js`) monta o podador sobre `classifyResourceRefs` e
documenta a contagem por superfície no retorno. O cliente descarta a resposta inteira.

**Correção.** Rótulo por origem, e um relato pós-clone alimentado pelo que já volta do servidor, no
mesmo formato de contagem por superfície que o aviso de poda de saída usa.

#### M7 (3.24, PARCIAL) Restauração adiada por falha transitória boota anônimo em silêncio

A frase existe e é boa: `frontend/src/js/session/session-restore-phrases.js` (novo) exporta
`sessionRestoreNotice`, com cinco desfechos distintos sobre o vocabulário de falha, dizendo em três
deles a coisa que mais importa, que a conta continua ativa e nada foi apagado.

**O alvo nominal do achado é o único que continua mudo.** `restoreSessionFromStorage`
(`frontend/src/js/index.js`), no mapa, mantém o `console.warn` e segue o boot: a tela resultante é
indistinguível de "eu nunca entrei". O único consumidor da frase é `atlas.html`. Em `admin.html` a
falha transitória cai na tela de indisponibilidade, que ao menos não se confunde com "nunca entrei",
mas cujo texto genérico não diz que os tokens continuam no disco.

#### M8 (3.25) "Sair agora" do aviso de inatividade reabre o modal de login

Intacto, e conferido por leitura direta: em `startIdleWatch`
(`frontend/src/js/session/idle-watch.js`), `showIdleWarning` recebe **o mesmo corpo de callback** para
`onLogout` e para o esgotamento do contador. Quem clicou "Sair agora" é tratado como quem deixou o
prazo vencer: no mapa, `IdleTimeoutController._expire` chama `AccountControl.handleSessionLost` com a
frase de expiração, que termina em pedir login de volta; fora do mapa, a navegação carrega o mesmo
motivo e o mapa repete a frase. Nada expirou: a pessoa saiu de propósito.

**Correção.** Um segundo callback distinto no watch, e um desfecho de saída deliberada que não reabra
o login nem use a frase de expiração.

#### M9 (3.17) "Criar conta" só existe no modal de login do mapa

Intacto. `AccountControl._handleLogin` calcula a bandeira de auto-cadastro e só então passa o
`onRegister`, o que é correto. Mas `openLoginDialog`
(`frontend/src/js/projects/projects-page.js`) chama `showLoginModal` **sem** `onRegister` e sem
consultar a bandeira, e é ele que `createServerInvite` aciona. `showSignupModal` tem um chamador só
em todo `frontend/src/js/`, e é o mapa. Onde o auto-cadastro está ligado, quem chega a "Seus atlas"
(destino canônico de quem tem sessão, e um endereço compartilhável) vê "Entrar" e nenhuma porta para
criar conta.

#### M10 (3.18) O toast do resgate FALHADO não diz o prazo de que ele mesmo depende

Intacto. `exitPreserveFailedNotice` (`frontend/src/js/session/unsynced-work-phrases.js`) diz, no ramo
com veto gravado, que o trabalho continua neste computador por tempo limitado e manda entrar
novamente o quanto antes. O prazo é `RESCUE_VETO_GRACE_MS`
(`frontend/src/js/store/remote-atlas.api.js`), 24 horas. "Quanto antes" não é acionável: quem lê na
sexta à noite volta na segunda e perdeu.

O resto da peça está certo e não deve ser mexido: a frase muda conforme o veto foi ou não gravado,
porque uma frase única teria de mentir num dos dois casos. Falta só o número, derivado da constante e
não escrito à mão.

### BAIXO

#### B1 (3.15) "Sair" não diz que o atlas remoto sai do computador

**Rebaixado de MÉDIO**, e a justificativa é o achado 1.1: a metade "perguntar" foi recusada pelo dono,
e a metade "perda de trabalho" foi fechada. O que sobra é informação sobre dado que **continua no
servidor** e volta ao entrar de novo.

Ainda assim é silêncio: no ramo normal de `AccountControl._handleLogout` (fila vazia) a sequência
apaga o namespace remoto e o comentário do próprio bloco declara, por extenso, que ali não se anuncia
nada. Nenhuma frase de saída em `frontend/src/js/` fala do atlas remoto, e nem o botão do mapa nem o
da barra superior carregam explicação.

#### B2 (3.27) O modal de criação de atlas não oferece grupo, o de compartilhamento sim

Intacto: varredura por grupo em `frontend/src/js/modals/create-atlas.modal.js` devolve zero. O lote
tocou o arquivo, mas só para trocar o par de níveis do convite por pessoa pelos níveis concedíveis. O
eixo de grupo continua exclusivo de `frontend/src/js/modals/sharing.modal.core.js`.

#### B3 (3.28) `AccountControl._openMenu` fecha a única porta para tudo quando falta o nome de usuário

Intacto, e o lote o agravou: o menu ganhou itens (conta, calibração, administração), então a porta
trancada por falta de nome de usuário agora esconde mais coisa. O gate melhor é
`sessionContext.isAuthenticated()`.

#### B4 (3.29) As duas chaves de inatividade não são emitidas pelo servidor

Intacto. `resolveIdleMs` e `resolveWarnMs` (`frontend/src/js/session/idle-watch.js`) leem duas
chaves de configuração que `FEATURES` (`backend/src/modules/config/config.static.js`) não emite; o
serviço de configuração acrescenta duas outras e não estas. Na prática o valor é sempre o padrão do
cliente, salvo override de administrador.

#### B5 (3.30) Duplicata inofensiva em `AccountControl.onAdd`

Intacto: no assinante de mudança de estado de conexão, a atualização de visibilidade de projetos
aparece duas vezes seguidas, com a indentação do bloco quebrada.

#### B6 (3.31) `showUnavailableScreen` não distingue causas nem se atualiza

Intacto: a guarda de exibição única é estado de módulo, então a segunda causa não repinta; a mensagem
é um literal só e o botão apenas recarrega. Sem re-tentativa automática.

---

## 4. Achados NOVOS, nascidos do próprio lote

Quatro coisas que não existiam quando a auditoria foi escrita. Todas pequenas, todas da mesma
família: um fato que passou a viver em dois lugares.

**N1. O mailer escolhe a frase da senha por um predicado diferente do que monta a rota.**
`sendAccountExistsEmail` (`backend/src/utils/mailer.js`) decide por `isSmtpConfigured`, enquanto as
rotas de recuperação são montadas por `canDeliverAccountMail`, e o comentário logo acima afirma que os
dois são o mesmo. Fora de produção eles discordam: a rota existe e a mensagem diz que não há
redefinição automática.

**N2. O cabeçalho de `frontend/src/js/utilities/request-failure.js` já nasceu desatualizado.** Ele
enumera as rotas de autenticação e afirma que a única redefinição é a do administrador, o que deixou
de ser verdade no mesmo lote que o criou.

**N3. O censo que protege a credencial é uma lista escrita à mão.**
`frontend/tests/unit/falha-de-requisicao-nao-apaga-credencial.test.js` nomeia dois arquivos
explicitamente, em vez de varrer com `git ls-files` como fazem os censos maduros desta base. Página
nova (ou esquecida) passa verde. Foi por essa fresta que a quarta página escapou, ver a remissão
abaixo.

**N4. O selo de compartilhados está verificado só por leitura.** A cobertura de
`frontend/tests/unit/shared-atlas-badge.test.js` é de funções puras; a fiação entre o selo e a aba não
tem teste de DOM nem de browser.

### Remissão: a quarta página, que NÃO é deste perfil

A conferência achou `frontend/src/js/calibration/calibracao-page.js` repetindo dois defeitos que este
relatório dava como críticos: o `catch` de restauração que apaga a credencial em qualquer falha, e um
`endSession` que não conta fila, não resgata e não carimba o desfecho.

**Isso não é achado deste documento**, e a distinção é de escopo, não de cortesia: `calibracao.html`
é gateada por `isAdmin()` ou `isProducer()`, então um papel global `user` nunca a alcança. Fica
registrado aqui para não se perder, e pertence aos relatórios do produtor e do administrador. A
correção é a mesma linha que as outras duas páginas já usam, e o módulo já é importável de lá.

---

## 5. O que está BOM e não deve ser mexido

Esta seção não é cortesia. Cada item é uma decisão que custou caro e que uma "simplificação" futura
desfaria. Os 16 itens foram reconferidos contra o código nesta revisão; os 37 símbolos que eles citam
existem todos. Três mudaram de entorno e estão anotados.

1. **A escada por atlas está fechada no cliente, e agora tem rede.**
   `frontend/src/js/projects/permission-levels.js` é fonte única e tem zero imports por contrato. A
   varredura por listas fechadas sobre `frontend/src/js/` inteiro devolve onze ocorrências: sete são
   comentários que proíbem o padrão, e as quatro de produção **não são gate** (duas partições de
   listagem no Drive, um rótulo de autoria, e a identificação do ex-dono na transferência de posse,
   onde a pergunta legítima é "eu era o dono?" e não "eu alcanço tal posto"). **Mudou para melhor
   desde a auditoria:** a propriedade deixou de ser cobrada só por leitura, com o censo mecânico
   `frontend/tests/unit/permissao-de-atlas-censo.test.js` e o irmão no backend, que pegam a lista
   fechada nos DOIS sentidos.
2. **Nenhuma lista fechada de papel GLOBAL, tampouco.** A comparação proibida aparece uma única vez
   em `frontend/src/js/`, dentro de um comentário que explica por que seria errada. Os gates são
   métodos de `sessionContext` e `adminAudience`, com `isAdmin` testado primeiro. `globalRoleBadge`
   trata papel desconhecido em voz alta, montando uma frase que diz não saber descrevê-lo, em vez de
   emprestar a de outro papel.
3. **O resgate de trabalho. MUDOU DE ARQUIVO, e o mecanismo está intacto.**
   `shouldPreserveLocalWork` (pura, com o não medido significando preservar),
   `preserveUnsyncedWorkAsLocal` com **read-back do disco** antes de declarar sucesso,
   `failedRescueKeepsNamespace` como saída única das duas falhas, e o par de mensagens que muda
   conforme o veto. Os três saíram de `frontend/src/js/account/account.control.js` para
   `frontend/src/js/session/unsynced-work-exit.js`, porque a sessão também acaba em páginas que não
   podem importar um controle do MapLibre; o controle **re-exporta** os três, então nenhum call site
   mudou. *(A auditoria original chamava isto de "o oposto exato" do seu achado crítico de logout;
   aquele achado deixou de existir, justamente por este mecanismo ter sido estendido ao clique.)*
4. **`refreshVisibleResources` está nos DOIS caminhos de sessão**, no login do motor de sync e na
   restauração do boot, este último com o comentário explicando o sumiço que a ausência causava.
5. **O tab-lock e seus textos.** `frontend/src/js/utilities/tab-lock.js` está byte a byte igual ao
   estado da auditoria: `OVERLAY_TEXT`, `TEARDOWN_OVERLAY`, `TEARDOWN_OVERLAY_LOCAL_DELETED`,
   `DEGRADED_NOTICE`, `BLOCKED_OVERLAY`. Cinco estados, cinco frases, e a distinção entre "recarregar
   descarta seu trabalho" e "recarregue para continuar" é exatamente a que uma frase única erraria em
   um dos dois casos. O estado degradado ser banner e não overlay é a decisão certa.
6. **A recusa de comentar nomeia o motivo real.** `CommentOverlay.togglePlacement` distingue atlas
   local, não estar logado e não ter permissão, nessa ordem, com o comentário dizendo por quê. É o
   modelo que o achado A1 e o M1 devem seguir.
7. **A saída de atlas e a saída de grupo.** `describeLeaveOutcome` está intacto, com quatro desfechos
   sobre o produto de remoção e nível efetivo, e devolvendo o valor cru para nível desconhecido. O
   trio `leaveGroupAvailability` / `leaveGroupWarning` / `leaveGroupSummary` continua relatando o que
   o servidor MEDIU, e o aviso é qualitativo porque a consulta não traz contagem: a frase não inventa
   uma.
8. **`adminAudience` e `frontend/src/js/ui/role-labels.js`.** Zero imports nos dois, para viverem nas
   páginas sem store.
   A porta se chama "Grupos" para quem só recebe Grupos. Recortar as abas no cliente em vez de deixar
   o servidor responder 403 na montagem é a decisão correta.
9. **O cabeçalho do atlas na aba Mapas. Os símbolos intactos, o entorno mudou.**
   `MapsTab._canRenameAtlas` está idêntico, inclusive o raciocínio escrito de ser deliberadamente MAIS
   estrito que o servidor (oferecer menos é seguro, o inverso congela a fila), e
   `MapsTab._refreshAtlasHeader` também. **O que mudou:** `AtlasTabState` e `ACTIONS_BY_STATE` saíram
   deste arquivo para `frontend/src/js/sidebar/tabs/atlas-actions.js`, e a aplicação virou
   `visibleAtlasActions` sobre um contexto que junta origem, autenticação e posto.
10. **`openAtlasFromUrl` distingue 403 de 404 com frases diferentes** (`frontend/src/js/index.js`), e
    o comentário explica que o 404 do servidor cobre dois casos de propósito, para não confirmar
    existência.
11. **A seção de chave de API.** `apiKeySectionState` e `hasUncopiedKey` (só conta cópia bem
    sucedida), o guarda em `AccountSettingsModal.hide` que impede fechar com chave não copiada, e a
    escrita do limite conhecido na cara de quem gera. A chave nunca vai a console, atributo de título
    ou armazenamento local.
12. **Troca de senha.** Exige a senha atual, `PASSWORD_SESSION_WARNING` diz que todas as sessões caem,
    inclusive esta, antes do botão e de novo na confirmação, e `PASSWORD_RULE_TEXT` é derivado dos
    limites e espelhado contra `updatePasswordSchema` por teste. **Reforçado desde a auditoria:** a
    mesma frase passou a ser lida também pela recuperação de senha, e ganhou um segundo espelho,
    `frontend/tests/unit/recuperacao-e-email-espelham-servidor.test.js`.
13. **Campos somente-leitura com autoria explícita.** `ADMIN_ONLY_FIELDS_NOTE` diz quem muda papel,
    lotação e OM de produção, porque o schema de perfil os descarta e responde sucesso sem mudar nada;
    oferecer o campo seria a promessa que o servidor recusa. `_renderRankField` trata posto desativado
    criando uma opção "(fora de uso)" em vez de limpar o campo em silêncio. **Nota de escopo:** o
    e-mail deixou de ser campo inerte nessa tela (decisão 1.6), por rota própria e com senha; o item
    nunca o listou, mas a leitura de "somente-leitura" ali mudou.
14. **O cadastro não vaza existência de conta.** O registro faz o hash **antes** do ramo, para fechar
    o oráculo de tempo, devolve o mesmo 201 nos dois casos e manda o aviso à caixa postal. O cliente
    respeita isso, com uma frase de duas leituras que agora casa também com o fluxo novo de
    recuperação.
15. **`cardMenuActions`.** Ações por posto derivadas de `hasAtLeast`, array novo a cada chamada. O
    contraste com `MapsTab._showMapContextMenu` no mesmo produto é o que torna o achado A1 fácil de
    corrigir: o modelo já existe. **Mudou desde a auditoria, sem perder a propriedade:** a ação de
    acesso passou a se chamar "Compartilhar" e abre o modal por import dinâmico, e nasceu a ação de
    sair do atlas, gateada por nome e não por lista.
16. **O aviso de inatividade está no padrão bancário.** `IdleTimer` puro e testável, atividade real
    re-arma o relógio, atividade é ignorada DURANTE o aviso (escolha explícita exigida), Escape
    significa "estou aqui", contagem regressiva ao vivo, e diálogo de alerta com modalidade
    anunciada.

---

## 6. Achados que SAÍRAM

Não se apaga o registro: quem ler daqui a três meses precisa saber que aquilo já foi olhado.

- **3.1 (crítico) "Sair" descartava trabalho não enviado.** Resolvido pela decisão 1.1, por caminho
  diferente do proposto: resgate silencioso e informação, sem diálogo, nos três caminhos de saída
  (mapa, `atlas.html`, `admin.html`). Preso por
  `frontend/tests/unit/saida-voluntaria-trabalho-nao-enviado.test.js`, que cobra também que os
  símbolos do diálogo podado não voltem.
- **3.2 (crítico) `atlas.html` e `admin.html` apagavam os tokens em qualquer falha.** Resolvido: a
  classificação virou módulo folha (`frontend/src/js/utilities/request-failure.js`) e as três páginas
  que este perfil alcança usam a mesma definição. Só 401 e 403 apagam. *(Residual fora deste perfil:
  ver a remissão da quarta página.)*
- **3.3 (crítico) Expiração por inatividade fora do mapa não resgatava.** Resolvido: `endSession` nas
  duas páginas começa por `preserveUnsyncedWorkOnLostSession`, que conta a fila sem montar escopo,
  resgata, e grava o veto de retenção nos dois modos de falha. *(Mesmo residual fora do perfil.)*
- **3.5 (alto) Nada na tela respondia "meu trabalho está salvo?".** Resolvido, com divergência
  deliberada: `frontend/src/js/account/sync-phrases.js` e `describeSyncWork` cruzam origem, conexão e
  fila em nove estados, o controle lê a fila de verdade e o rótulo saiu do atributo de título. A luz
  **não** se esconde em atlas local (como o achado propunha); ela vira um estado neutro "Local", para
  a barra não ficar muda, e o vermelho permanente em situação normal acabou.
- **3.6 (alto) "Compartilhar" tinha dois gates divergentes e um beco sem saída.** Resolvido pelas
  decisões 1.2 e 1.3. *(Residual conhecido e hoje sem consequência prática: `SharingModal._renderError`
  ainda não distingue o 403 nem suprime o botão de tentar de novo, mas o botão que levava ao beco só
  aparece agora para quem tem `manage`.)*
- **3.9 (alto) Não existia recuperação de senha.** Resolvido pela decisão 1.4, nas duas vias.
- **3.19 (médio) O convite recebido não era anunciado.** Resolvido pela decisão 1.5, como badge, só no
  cliente.
- **3.26 (baixo) O limite de 10 atlas locais só aparecia ao ser violado. RETIRADO: estava errado na
  origem.** O contador "N de 10" já existia na seção local sete dias antes da auditoria
  (`LocalAtlasSection._render`, com `MAX_LOCAL_ATLASES`), então a correção proposta pedia algo que já
  estava na tela. A metade restante (desabilitar o ladrilho no teto) é **recusa deliberada**, escrita
  em comentário no próprio `LocalAtlasSection._createTile`: a recusa carrega uma mensagem que explica
  o que fazer, e um botão morto não explica nada.

---

## Nota de método

Nenhum arquivo de código foi modificado nesta revisão, nenhum commit foi feito, e o único arquivo
escrito foi este. As afirmações do servidor foram conferidas nos módulos de autenticação, usuários,
sharing, atlas e configuração de `backend/src/`; as do cliente, lendo os arquivos citados. Onde este
documento afirma ausência (por exemplo, "zero `checkPermission` em `frontend/src/js/briefing/`"), a
afirmação vem de varredura sobre a pasta inteira.

Duas ressalvas de alcance, para não superdeclarar:

- **Este arquivo não está sob nenhum guarda.** `frontend/tests/unit/docs-integridade.test.js` varre
  `docs/`, `.claude/` e uma lista de alvos escrita à mão, e a raiz do repositório não é varrida.
  Caminho, wikilink e símbolo citados aqui não são verificados por teste nenhum: que estivessem todos
  certos na conferência de hoje é resultado de leitura, não propriedade mecânica. Se o conteúdo for
  adotado, o destino é a wiki, com o recorte que ela exige.
- **A conferência é uma foto da árvore de trabalho**, que tinha 4187 inserções não commitadas quando
  esta revisão foi feita. Um achado dado como resolvido aqui volta a ser achado se aquele trabalho não
  for commitado.
