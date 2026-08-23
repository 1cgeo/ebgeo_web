# Relatório de UX: o usuário comum logado

Perfil avaliado: conta com papel GLOBAL `user`, o mais numeroso do sistema. Avaliação feita contra o
código do branch `integracao_backend`, tendo `CONSTITUICAO.md` como especificação de referência.

Método: leitura do código, nunca da prosa, em `frontend/src/js/`, conferida contra as rotas e os
gates de `backend/src/`. Toda citação é por arquivo e por SÍMBOLO. Onde este relatório afirma
ausência (por exemplo, "zero `checkPermission` em `briefing/`"), a afirmação vem de varredura sobre a
pasta inteira, não de amostragem.

Contagem de achados: 3 CRÍTICOS, 8 ALTOS, 14 MÉDIOS, 6 BAIXOS.

---

## 1. O que o usuário comum É nos dois eixos

### 1.1 Eixo GLOBAL, segundo o estatuto

`CONSTITUICAO.md` §1.1: quatro papéis que NÃO formam escada (`user`, `producer`, `credenciado`,
`admin`). O `user` não lê acervo privado por papel e não administra nada do sistema. Recebe recurso
privado por concessão (§3.3) ou por empréstimo do atlas (§6.1). §4.1 lhe dá o direito de criar grupo
de acesso e §4.2 o faz dono do que criou. §1.5 diz que a conta nasce sempre como `user` e marca o
cadastro aberto como **[pendente]**, esperando o relay de e-mail.

### 1.2 Eixo GLOBAL, segundo o código

O vocabulário está em `GlobalRole` (`frontend/src/js/store/sync/session-context.js`), com os quatro
valores e um `fileoverview` que diz por extenso que não é escada. Os rótulos e a frase que explica
cada papel vivem em `frontend/src/js/ui/role-labels.js` (`GLOBAL_ROLE_LABELS`,
`GLOBAL_ROLE_DESCRIPTIONS`), módulo folha de zero imports, e o selo é desenhado por
`AccountControl._updateRoleBadge` (`frontend/src/js/account/account.control.js`).

A porta de administração é recortada por `adminAudience` (`frontend/src/js/admin/admin-audience.js`),
função pura de zero imports. Para o `user` autenticado ela devolve `{ label: 'Grupos', tabIds:
['groups'] }`. O rótulo nomeia o que a pessoa recebe, não a página, e as abas que bateriam em
`requireAdmin` no servidor nem chegam a ser montadas.

A varredura por listas fechadas de papel GLOBAL (`role !== 'user'`, `role === 'admin' || role ===
'producer'` e variantes) sobre `frontend/src/js/` devolve **apenas ocorrências dentro de comentários
que proíbem o padrão**. Os gates reais são métodos de `sessionContext` (`isAdmin`, `isProducer`,
`hasGlobalDataAccess`) e `adminAudience`, que testa `isAdmin` PRIMEIRO justamente para um
administrador que também produza não cair no ramo do produtor e perder três abas. Papel desconhecido
aparece cru, com aviso, em vez de rebaixar para "Usuário" (`globalRoleBadge`).

**Convergência: total.** Inclusive no cadastro: `resolveAllowSelfRegistration`
(`backend/src/config.js`) devolve `env !== 'production'`, e `AccountControl._handleLogin` só passa
`onRegister` quando `config.features.self_registration === true`. Ou seja, em produção o botão "Criar
conta" não aparece, e o estatuto §1.5 é respeitado pelos dois lados.

### 1.3 Eixo POR ATLAS, segundo o estatuto

`CONSTITUICAO.md` §5.2: cinco níveis em escada, `read < comment < write < manage < owner`, e lista
fechada é proibida. §5.7 dá a todo participante a visão de quem mais participa e com que nível. §5.8
dá ao convidado o direito de sair sozinho. §7.1 a §7.5 cobrem atlas local, envio ao servidor, salvar
como local, duplicar, clonar e apagar.

### 1.4 Eixo POR ATLAS, segundo o código

A escada canônica é `PERMISSION_ORDER` / `permissionRank` / `hasAtLeast` / `atlasRoleHasAtLeast` /
`serverTreatsAsAtlasOwner` / `GRANTABLE_PERMISSIONS` em
`frontend/src/js/projects/permission-levels.js`, com zero imports por contrato. A varredura por
listas fechadas (`=== 'write'`, `=== 'owner'`, `=== 'manage'`, arrays de `UserRole.X`) sobre
`frontend/src/js/` inteiro devolve **nenhuma lista fechada em gate de produção**: o que existe são
comentários explicando por que a lista fechada é proibida, mais dois filtros legítimos de LISTAGEM
(`AtlasDrive._visible`, que separa a aba "Meus" da aba "Compartilhados" por `user_permission ===
'owner'`) e um rótulo de autoria.

Este é o resultado mais forte da auditoria e merece ser dito em voz alta: **o bug que já custou duas
correções está fechado hoje no eixo por atlas do cliente.**

**A divergência não está no VOCABULÁRIO, está na COBERTURA.** O cliente traduz corretamente os dois
vocabulários (`ROLE_TO_PERMISSION`, `toAtlasPermission`), mas a gatagem PROATIVA de tela cobre pouco:

| superfície | gate proativo de tela | efeito para quem não alcança o degrau |
|---|---|---|
| barras de desenho, militar e análise | `getViewModeController` (`frontend/src/js/ui/view-mode.controller.js`) + `body.is-view-only` (`frontend/src/css/view-mode.css`) | somem, correto |
| comentário espacial | `CommentOverlay._canComment`, `CommentsPanel._canComment` | botão some, e a recusa nomeia TRÊS motivos distintos |
| renomear atlas | `MapsTab._canRenameAtlas` | campo vira somente-leitura, com `title` explicativo |
| configurações do atlas | `MapsTab._handleOpenSettings`, com `atlasRoleHasAtLeast(..., 'manage')` | modal abre só com a aba de aparência |
| menu do cartão em `atlas.html` | `cardMenuActions` (`frontend/src/js/projects/atlas-drive.js`) | ações somem por posto, correto |
| "Compartilhar" no menu da conta | `AccountControl._updateShareVisibility` | some abaixo de `manage`, correto |
| travar mapa | `mapLockController.canToggleLock` | botão desabilitado com `title` |
| **menu de contexto do mapa** | **nenhum** | oferece Renomear, Puxar outros mapas e Deletar a Leitor E a Editor |
| **"Novo mapa" (+)** | **nenhum** | pede o nome e só então recusa |
| **"Compartilhar" na aba Mapas** | **nenhum** (deliberado) | Leitor abre e recebe erro genérico sem saída |
| **"Importar" na aba Mapas** | **nenhum** | Leitor escolhe arquivo e a importação é recusada |
| **briefing, 3D, 360, camadas, aba de feições** | **nenhum** (`grep` por `checkPermission` nessas pastas devolve zero) | oferece tudo e falha no store |

Onde há gate de tela, ele é por hierarquia e está certo. O problema é que a maior parte da tela não
tem gate nenhum e delega ao guarda do store, que responde com uma frase única e às vezes falsa
(achado 3.4).

### 1.5 Onde estatuto e código divergem, para este perfil

1. **§5.7 (todo participante vê quem mais participa e com que nível).** Cumprida no cartão de
   `atlas.html` (`AtlasDrive._sharingFooter` + `describeCardAccess`, uma linha por nível). NÃO
   cumprida dentro do mapa: a rota `GET /atlas/:atlasId/sharing` continua exigindo `manage`
   (`backend/src/modules/sharing/sharing.routes.js`), e é ela que o botão "Compartilhar" da aba Mapas
   chama, produzindo 403 e beco sem saída (achado 3.6). Divergência de superfície, não de decisão.
2. **§10.7 (a chave de API é o usuário inteiro).** Cumprida na tela, e bem: a seção de chave em
   `frontend/src/js/modals/account-settings.modal.js` escreve o limite com as mesmas palavras do
   estatuto. Não é divergência, é registro de que a única cláusula de limite conhecido que toca este
   perfil chegou à interface.
3. **§1.5 (cadastro pendente).** Sem divergência: o gate `self_registration` fecha o botão em
   produção. O que falta é a jornada de quem se cadastrou onde ele está ligado (achados 3.9, 3.10).

Não achei nenhum ponto em que o código CONTRARIE uma cláusula vigente. Achei vários em que ele a
cumpre em um lugar só.

---

## 2. Inventário de ações, com veredito

Legenda: OK (alcançável, rótulo verdadeiro, recusa explicada), ATRITO (funciona mas confunde), FALHA
(não faz o que promete, ou promete o que o servidor recusa).

### 2.1 Conta e sessão

| ação | onde | veredito |
|---|---|---|
| Cadastrar-se | `showSignupModal` (`frontend/src/js/modals/signup.modal.js`), aberto por `AccountControl._handleLogin` -> `_handleRegister` | OK em produção (o gate fecha o botão); ATRITO onde o gate está ligado: só alcançável do mapa (achado 3.16) |
| Confirmar e-mail | `handleEmailVerificationFromUrl` (`frontend/src/js/index.js`), `?verify=` | ATRITO: expirado e inválido dão a MESMA frase, e ela chuta (achado 3.13) |
| Reenviar confirmação | `apiClient.resendVerification`, chamado de UM lugar só | **FALHA: botão de uso único, e o e-mail do servidor aponta para uma opção inexistente** (achado 3.10) |
| Recuperar senha esquecida | não existe | **FALHA: nem rota nem tela; o login não diz o passo seguinte** (achado 3.9) |
| Entrar | `showLoginModal` (`frontend/src/js/modals/login.modal.js`) | OK para senha errada, conta desativada, e-mail não confirmado e OM inativa; FALHA para "servidor fora" (achado 3.14) |
| Manter sessão após F5 | `restoreSessionFromStorage` (`frontend/src/js/index.js`) | OK, com `isCredentialFailure` distinguindo falha transitória de credencial morta |
| Manter sessão após F5 em `atlas.html` / `admin.html` | `restoreSession` (`projects-page.js`, `admin-page.js`) | **FALHA CRÍTICA: apaga os tokens em QUALQUER falha** (achado 3.2) |
| Expirar por inatividade no mapa | `frontend/src/js/session/idle-timer.js`, `idle-watch.js`, `idle-timeout.controller.js` -> `AccountControl.handleSessionLost` | OK: avisa 60 s antes e o trabalho é resgatado |
| Expirar por inatividade fora do mapa | `startIdleWatch` -> `endSession` (`projects-page.js`, `admin-page.js`) | **FALHA CRÍTICA: nenhum resgate** (achado 3.3) |
| Perder sessão sem gesto (401) no mapa | `handleSessionLost` -> `_handleLogout({involuntary:true})` -> `preserveUnsyncedWorkAsLocal` | OK, e é o melhor pedaço do produto (ver §4) |
| **Sair (voluntário)** | `AccountControl._handleLogout` sem argumento | **FALHA CRÍTICA: não pergunta, não conta a fila, não descarrega e apaga o não enviado** (achado 3.1) |
| Ver e editar dados da conta | `frontend/src/js/modals/account-settings.modal.js` | ATRITO: não mostra o e-mail (achado 3.11) e só é alcançável do mapa (achado 3.12) |
| Trocar senha | mesmo modal, `PASSWORD_SESSION_WARNING` + `showConfirm` | OK: nomeia a consequência antes e relata depois |
| Gerar chave de API | mesmo modal, `apiKeySectionState`, `hasUncopiedKey` | OK, exemplar |

### 2.2 Escolher e criar atlas

| ação | onde | veredito |
|---|---|---|
| Ver a lista de atlas | `AtlasDrive` (`frontend/src/js/projects/atlas-drive.js`) | ATRITO: falha de rede na PRIMEIRA carga vira lista vazia (achado 3.7) |
| Filtrar por Meus / Compartilhados / Públicos / Recentes / Lixeira | `AtlasDrive._visible`, `_switchFilter` | OK |
| Criar atlas de servidor | "Novo atlas" -> `showCreateAtlasModal` (`frontend/src/js/modals/create-atlas.modal.js`) | OK, com convite de pessoas e link público já na criação |
| Criar atlas local | ladrilho "+ Novo atlas local" -> `askAtlasName` (`frontend/src/js/projects/projects-page.js`) | OK: a separação em duas seções deixa claro onde o trabalho mora |
| Limite de 10 atlas locais | `MAX_LOCAL_ATLASES`, `refuse(LocalAtlasError.LIMIT_REACHED)` (`frontend/src/js/store/local-atlas.api.js`) | ATRITO: só reage no 11º; a mensagem é boa, mas não há contador antes (achado 3.24) |
| Abrir atlas de servidor | `openRemoteAtlas` (`frontend/src/js/account/open-atlas.service.js`) | OK: ordem contratual, e 403 e 404 têm frases distintas em `openAtlasFromUrl` |
| Abrir atlas local | `openLocalAtlas`, `pointAtLocalAtlasAndGo` | OK |
| Abrir arquivo `.ebgeo` como atlas novo | `projects-page.js`, `savePendingImport` | OK, com frase própria quando não há slot (`SEM_SLOT_PARA_O_ARQUIVO`) |
| Enviar atlas local ao servidor | ação `'save-server'` -> `AccountControl.saveLocalToServer` | OK; o rótulo "Enviar", e não "Salvar", é decisão consciente e certa |
| Salvar remoto como local | ação `'save-local'` -> `showConfirm` + aviso de poda | OK |
| Exportar `.ebgeo` | ação `'save'` -> aviso de poda | OK: conta por superfície, nomeia no máximo três, e "Cancelar" aborta antes do irreversível |
| Importar `.ebgeo` no atlas atual | ação `'import'` -> `MapsTab._handleImportAdditive` | FALHA para Leitor: está na grade do estado REMOTE sem gate (achado 3.17) |
| Duplicar atlas local | `copyAtlasDatabases` + `duplicateLocalAtlas` | OK |
| Clonar atlas de servidor | menu do cartão, id `'duplicate'`, rótulo "Fazer uma cópia" | ATRITO: não diz que a cópia nasce em posse de quem clonou nem que pode ter perdido recursos (achado 3.22) |
| Mover para lixeira | `cardMenuActions` id `'trash'`, gateado por `hasAtLeast(permission,'owner')` | OK |
| Restaurar da lixeira | aba Lixeira, `apiClient.listTrashedAtlas` | OK |
| Excluir atlas local | `projects-page.js`, com confirmação | OK |
| Sair de um atlas compartilhado (§5.8) | `cardMenuActions` id `'leave'` -> `apiClient.leaveAtlas` -> `describeLeaveOutcome` | OK, exemplar: quatro desfechos distintos |
| Receber convite | não existe anúncio nenhum | ATRITO: só se descobre navegando (achado 3.19) |

### 2.3 Trabalhar no atlas

| ação | onde | veredito |
|---|---|---|
| Saber em que atlas está | `MapsTab._refreshAtlasHeader` (chip "Local"/"Servidor" + `document.title`) | OK, muito bem feito |
| Saber o próprio nível no atlas | `AccountControl._applyAtlasName` | ATRITO: fica atrás do clique no avatar (achado 3.21) |
| **Saber se o trabalho está salvo** | `SyncStatusControl` (`frontend/src/js/account/sync-status.control.js`) | **FALHA: mostra CONEXÃO, não gravação; e acende vermelho para quem trabalha em atlas local** (achado 3.5) |
| Criar mapa | botão `+` -> `MapsTab._handleNewMap` | FALHA para Leitor e Comentarista: pede o nome e só então recusa |
| Renomear, deletar, combinar mapa | `MapsTab._showMapContextMenu` | **FALHA: o menu não consulta papel nenhum** (achado 3.4) |
| Travar mapa | `MapsTab._handleToggleLock`, `mapLockController.canToggleLock` | OK |
| Desenhar feições | barras gateadas por `is-view-only` | OK |
| Camadas e grupos | `frontend/src/js/layers/`, sem gate de tela | ATRITO: parte das afordâncias some por CSS, o resto falha no store |
| Briefing | `frontend/src/js/briefing/`, zero `checkPermission` | ATRITO: editor abre para quem não pode salvar (achado 3.17) |
| 3D e 360 | `3d_models_viewer_tool/`, `street_view_tool/`, zero `checkPermission` | ATRITO: idem |
| Comentário espacial | `comment-overlay.js`, `comments-panel.js` | OK, referência de como se faz |
| Presença e cursores | `frontend/src/js/presence/` | OK |
| Conflito de edição simultânea | `applyRemoteOperation` (`remote-operation-handler.js`), LWW por ordem de chegada | ATRITO: a sobrescrita é SILENCIOSA (achado 3.20) |
| Compartilhar | ação `'share'` (todos) e menu da conta (só `manage`) | **FALHA: dois gates divergentes, e o de baixo é beco sem saída** (achado 3.6) |
| Duas abas no mesmo atlas | `frontend/src/js/utilities/tab-lock.js` | OK, exemplar |

### 2.4 Grupos de acesso

| ação | onde | veredito |
|---|---|---|
| Chegar à tela | `adminAudience` -> entrada "Grupos" em `admin.html` | OK |
| Criar, renomear, apagar grupo próprio | `frontend/src/js/admin/groups-tab.js` | OK |
| Ver grupos de que participa (§4.5) | mesma aba | OK |
| Sair de um grupo (§4.7) | `leaveGroupAvailability`, `leaveGroupWarning`, `leaveGroupSummary` (`frontend/src/js/admin/group-phrases.js`) | OK: a recusa ao dono nomeia os dois caminhos e o aviso diz o que se perde |

---

## 3. Achados, por gravidade

### CRÍTICO

#### 3.1 "Sair" descarta trabalho não enviado, sem perguntar e sem dizer

**O que acontece hoje.** `AccountControl._handleLogout` (`frontend/src/js/account/account.control.js`)
é chamado direto do clique no item "Sair", sem argumento, logo `involuntary === false`. A contagem da
fila só acontece no caminho involuntário (`const pendingOps = involuntary ? await
countPendingOperations() : 0`), e `shouldPreserveLocalWork` abre com `if (!involuntary) return
false`. O ramo `else` roda `announceRemoteNamespaceTeardown()`, `clearAllDataStore()` e
`discardRemoteAtlasNamespaces()`; o comentário do ramo irmão diz por extenso que `clearAllDataStore`
derruba dado E fila. Antes disso, `stopAutoFlush()` já foi chamado, e
`syncEngine.logoutAndDisconnect()` (`frontend/src/js/store/sync/sync-engine.js`) não faz descarga
nenhuma. Não há `showConfirm` em lugar algum desse caminho.

O mesmo desfecho chega por dois outros caminhos: `endSession` em
`frontend/src/js/projects/projects-page.js` e o homônimo em `frontend/src/js/admin/admin-page.js` só
revogam o token e navegam; a destruição acontece depois, em `enforceLocalStoreWhenLoggedOut`
(`frontend/src/js/store/store.js`), no boot seguinte do mapa.

**Por que é ruim.** É a única perda irreversível de trabalho que sobrou no produto, e ela mora no
botão mais banal da interface. Basta uma reconexão em curso, um `flush` que ainda não venceu o
intervalo de 1,5 s, ou uma janela offline. O comentário do próprio `_handleLogout` justifica a
escolha dizendo que o logout clicado é uma decisão do usuário; mas a decisão foi tomada sem a
informação, porque o único indicador de sincronismo mostra CONEXÃO e não gravação (achado 3.5). Todo
o aparato de resgate existe exatamente para essa perda, e o caminho voluntário passa ao largo dele
por causa de uma linha.

**Arquivo e símbolo.** `frontend/src/js/account/account.control.js`, `AccountControl._handleLogout` e
`shouldPreserveLocalWork`; `frontend/src/js/projects/projects-page.js`, `endSession`;
`frontend/src/js/admin/admin-page.js`, `endSession`.

**Correção proposta.** Contar a fila também no caminho voluntário, antes do teardown, e quando for
maior que zero (ou desconhecida) levantar um `showChoice` (já existe em
`frontend/src/js/modals/confirm.modal.js`) com três saídas honestas: enviar agora e sair; sair
guardando como atlas local (reusando `preserveUnsyncedWorkAsLocal`); sair e descartar. Fila vazia
continua saindo em silêncio. Um repro em `frontend/tests/unit/` que ponha N ops na fila, dispare o
logout voluntário e exija que a fila sobreviva é o controle negativo.

#### 3.2 `atlas.html` e `admin.html` apagam os tokens em QUALQUER falha de restauração

**O que acontece hoje.** `restoreSession` em `frontend/src/js/projects/projects-page.js` e a homônima
em `frontend/src/js/admin/admin-page.js` são idênticas: carregam os tokens, chamam `getMe()`, e no
`catch` executam `apiClient.clearTokens()`. Isso contradiz frontalmente `isCredentialFailure` +
`restoreSessionFromStorage` (`frontend/src/js/index.js`), que existe justamente para NÃO fazer isso e
cujo comentário registra o defeito por extenso. O `getMe()` roda com o prazo de boot do cliente: um
backend lento alguns segundos basta.

**Agravante:** `shouldRouteToProjects` (`frontend/src/js/deep-link/route-decision.js`) manda TODO
visitante logado que abre a URL nua para `atlas.html`. O caminho que preserva os tokens é o menos
percorrido; o que os apaga é o padrão.

**Por que é ruim.** Um 502 do proxy, um pico de latência ou um 429 desloga o usuário em definitivo, e
ele precisa digitar a senha de novo. Como não há recuperação de senha (achado 3.9), quem não a
souber de cabeça perdeu o acesso.

**Arquivo e símbolo.** `frontend/src/js/projects/projects-page.js`, `restoreSession`;
`frontend/src/js/admin/admin-page.js`, `restoreSession`; comparar com
`frontend/src/js/index.js`, `isCredentialFailure` e `restoreSessionFromStorage`.

**Correção proposta.** Extrair `isCredentialFailure` para um módulo folha e usar a mesma
classificação nas três páginas. Falha transitória mantém os tokens e renderiza a metade anônima com
um aviso; só falha de credencial chama `clearTokens()`.

#### 3.3 Expiração por inatividade fora do mapa não resgata trabalho nenhum

**O que acontece hoje.** `projects-page.js` e `admin-page.js` montam `startIdleWatch({ onExpire: ()
=> endSession('inatividade') })`, e `admin-page.js` também `apiClient.setAuthLostHandler(() =>
endSession('encerrada'))`. `endSession` não chama `preserveUnsyncedWorkAsLocal`, não chama
`retainRemoteAtlasForRescue` e não conta fila: revoga o token e navega para o mapa, onde
`enforceLocalStoreWhenLoggedOut` roda `purgeAllRemoteAtlases`.

**Cenário concreto.** O usuário edita um atlas de servidor com a rede oscilando (a fila enche), clica
em "Seus atlas", atende o telefone por meia hora, o watch de `atlas.html` expira, ele volta ao mapa
anônimo, e a varredura destrói o namespace com a fila. Nenhuma das mensagens que
`account.control.js` escreveu para exatamente esse momento aparece, porque nenhuma delas é alcançada.

**Por que é ruim.** É o mesmo dado, o mesmo usuário e a mesma causa que o caminho do mapa trata com
cuidado cirúrgico. A proteção acabou sendo acidental à página em que a aba estava parada.

**Arquivo e símbolo.** `frontend/src/js/projects/projects-page.js`, `endSession` e a chamada de
`startIdleWatch`; `frontend/src/js/admin/admin-page.js`, os mesmos;
`frontend/src/js/account/account.control.js`, `preserveUnsyncedWorkAsLocal`;
`frontend/src/js/store/remote-atlas.api.js`, `retainRemoteAtlasForRescue`.

**Correção proposta.** No mínimo, as duas páginas chamarem `retainRemoteAtlasForRescue` para cada
entrada do registro remoto antes de navegar (o veto vive fora do IndexedDB e não exige a store
montada). Melhor: extrair de `_handleLogout` o teardown involuntário para um módulo compartilhado e
as três páginas passarem por ele.

### ALTO

#### 3.4 O menu de contexto do mapa oferece a Leitor e a Editor o que o servidor recusa

**O que acontece hoje.** `MapsTab._showMapContextMenu` (`frontend/src/js/sidebar/tabs/maps.tab.js`)
calcula `isMapLocked(mapName)` e monta o menu inteiro a partir disso. Não consulta
`mapLockController.isReadOnly()`, não consulta `checkPermission`, não consulta o papel. Resultado:

- **Leitor e Comentarista** num mapa não travado recebem "Salvar posição", "Duplicar", "Renomear",
  "Puxar outros mapas" e "Deletar". Todas as cinco são recusadas pelo store.
- **Editor** recebe "Deletar" e "Puxar outros mapas", que exigem `canDeleteMap` (o degrau `manage`),
  conforme `GuardAction.DELETE_MAP` e `GuardAction.COMBINE_MAPS` em
  `frontend/src/js/store/sync/permission-guard.js`.

O mesmo arquivo faz a coisa certa oito centenas de linhas antes: o cartão do mapa corrente lê
`mapLockController.isReadOnly()` e desabilita o cadeado com `title` explicativo. Duas superfícies
irmãs, no mesmo arquivo, com regras diferentes.

**O agravante é a mensagem.** `registerStoreErrorListeners`
(`frontend/src/js/store/store-error-listener.js`) classifica o bloqueio em três tipos (`explicit`,
`lock`, `denied`) e, para tudo que não seja `map_locked` / `target_map_locked` e não traga mensagem
própria, mostra "Acesso somente leitura, você não pode editar este projeto." Para um Editor tentando
deletar um mapa, essa frase é **falsa**: o Editor edita, ele só não gere. Além dela, o usuário recebe
um segundo toast, `showWarning('Erro ao deletar mapa')`, porque `MapManager.deleteMap`
(`frontend/src/js/map/map.manager.js`) traduz o `false` do store num genérico que lê como defeito do
sistema. Dois toasts, um genérico e um mentiroso.

**Por que é ruim.** Ensina o usuário a desconfiar do menu, e no caso do Editor diz a ele que perdeu
um acesso que não perdeu. É a classe "a UI promete o que o servidor recusa", a mesma que já congelou
a fila de saída neste repositório.

**Arquivo e símbolo.** `frontend/src/js/sidebar/tabs/maps.tab.js`, `MapsTab._showMapContextMenu`;
`frontend/src/js/store/store-error-listener.js`, `registerStoreErrorListeners`;
`frontend/src/js/map/map.manager.js`, `MapManager.deleteMap`.

**Correção proposta.** Duas, separadas. (i) Gatear cada item do menu pela capacidade que o store vai
exigir: `UPDATE_MAP` para Renomear e Salvar posição, `CREATE_MAP` para Duplicar, `COMBINE_MAPS` para
"Puxar outros mapas", `DELETE_MAP` para Deletar. Item que não passa não é desenhado, como já faz
`cardMenuActions`. (ii) Em `registerStoreErrorListeners`, derivar a frase do ramo `denied` da
capacidade negada: o `reason` já carrega o nome (`Permissão insuficiente: DELETE_MAP requer
canDeleteMap (role atual: editor)`), então há material para dizer "Só quem gere este atlas pode
excluir mapas". E fazer `MapManager.deleteMap` distinguir recusa por permissão de erro técnico, para
não empilhar dois toasts.

#### 3.5 Nada na tela responde "meu trabalho está salvo?"

**O que acontece hoje.** O único indicador é `SyncStatusControl`
(`frontend/src/js/account/sync-status.control.js`), e `describeState` mapeia apenas estados de
CONEXÃO: `ONLINE` para "Conectado", `CONNECTING`/`RECONNECTING` para "Sincronizando…", `OFFLINE`
para "Desconectado". Ele não lê a fila em momento algum: `operationQueue.count()` só é chamada em
`countPendingOperations` (`account.control.js`), e só no logout involuntário. O rótulo, além disso,
só existe no `title`, ou seja, sob o ponteiro.

Há um segundo defeito no mesmo controle: `_renderVisibility` mostra a luz sempre que
`sessionContext.isAuthenticated()`. Um usuário logado trabalhando num atlas LOCAL nunca conecta, logo
`connectionState` fica `OFFLINE`, e ele vê **luz vermelha "Desconectado" permanentemente**, num
estado perfeitamente normal.

**Por que é ruim.** São dois enganos de sinal opostos. Verde com fila cheia diz "salvo" quando não
está, e é o que precede a perda do achado 3.1. Vermelho em atlas local diz "há um problema" quando
não há, e treina o usuário a ignorar o vermelho, que é o custo real.

**Arquivo e símbolo.** `frontend/src/js/account/sync-status.control.js`, `describeState` e
`SyncStatusControl._renderVisibility`.

**Correção proposta.** Fazer o controle refletir GRAVAÇÃO e não transporte: assinar os eventos de
fila e mostrar três estados nomeados ("Tudo enviado", "Enviando N alterações…", "N alterações
pendentes, sem conexão"), com texto visível e não só no `title`. E esconder a luz quando
`isRemoteStoreSync()` for falso, porque num atlas local não há para onde sincronizar e o chip "Local"
do cabeçalho já diz o que precisa ser dito.

#### 3.6 "Compartilhar" tem dois gates divergentes, e o de baixo é um beco sem saída

**O que acontece hoje.** Três superfícies oferecem o compartilhamento, com três regras:

1. `cardMenuActions` (`frontend/src/js/projects/atlas-drive.js`) só inclui `'access'` quando
   `hasAtLeast(permission, 'manage')`. Correto.
2. `AccountControl._updateShareVisibility` esconde o item abaixo de `manage`. Correto.
3. `ACTIONS_BY_STATE` (`frontend/src/js/sidebar/tabs/maps.tab.js`) inclui `'share'` no estado
   `REMOTE` para **qualquer papel**, e o comentário justifica: não esconder por papel evita que um
   Gestor rebaixado no meio da sessão veja o botão sumir sem explicação.

A decisão em si é defensável; o problema é o que vem depois do clique. `MapsTab._handleShare` abre
`showSharingModal`, cujo `_load` chama `GET /atlas/:atlasId/sharing`, gateada por
`requireAtlasPermission('manage')` (`backend/src/modules/sharing/sharing.routes.js`). O 403 cai no
`catch` genérico e produz `SharingModal._renderError`, que escreve "Não foi possível carregar o
compartilhamento." com um botão "Tentar novamente" que vai falhar identicamente para sempre.

**Por que é ruim.** Trocou-se "sumir sem explicação" por "falhar sem explicação, com um botão que
convida a insistir". Um Leitor conclui que o sistema está quebrado. E o `title` do botão na grade
ainda promete "Escolher quem pode ver e editar este atlas".

**Arquivo e símbolo.** `frontend/src/js/sidebar/tabs/maps.tab.js`, `ACTIONS_BY_STATE` e
`MapsTab._handleShare`; `frontend/src/js/modals/sharing.modal.core.js`, `SharingModal._load` e
`SharingModal._renderError`.

**Correção proposta.** Manter o botão visível e consertar a chegada: `_renderError` deve distinguir o
403 (o `ApiError` carrega o status e `sharingErrorMessage` já sabe extrair a frase do servidor) e,
nesse caso, escrever "Só quem gere este atlas pode alterar o compartilhamento", **sem** botão de
tentar de novo. Melhor ainda: mostrar ao Leitor a LEITURA da lista de participantes, que §5.7 já lhe
garante. Ver a pergunta em aberto §5.2.

#### 3.7 Falha de rede na primeira carga de `atlas.html` é indistinguível de "você não tem atlas"

**O que acontece hoje.** Em `initProjectsPage` (`frontend/src/js/projects/projects-page.js`), a lista
chega por `apiClient.listAtlas().catch(...)`, que mostra um toast e devolve `null`; logo abaixo, `if
(Array.isArray(list)) projects = list;` deixa `projects` como `[]`. O Drive cai em
`AtlasDrive._renderGrid`, cujo ramo `list.length === 0` escreve "Nenhum atlas nesta categoria."
Passados os poucos segundos do toast, a tela afirma um fato falso e permanente, sem botão de tentar
de novo. O irmão `AtlasDrive._refresh` faz a coisa certa (mantém a lista anterior quando o pedido
falha), o que mostra que a assimetria é acidental.

**Por que é ruim.** É a pergunta que o dono mandou verificar explicitamente, e a resposta hoje é
"não, lista vazia e falha de rede têm a mesma aparência". O usuário conclui que perdeu os atlas.

**Arquivo e símbolo.** `frontend/src/js/projects/projects-page.js`, `initProjectsPage`;
`frontend/src/js/projects/atlas-drive.js`, `AtlasDrive._renderGrid` e `AtlasDrive._refresh`.

**Correção proposta.** Dar ao Drive um terceiro estado de grade, além de "com itens" e "vazio": um
estado de ERRO com frase própria ("Não foi possível carregar seus atlas do servidor") e botão
"Tentar novamente", exatamente como `SharingModal._renderError` já faz. Propagar o `null` do `catch`
até o Drive em vez de colapsá-lo em `[]` no chamador.

#### 3.8 `showUnavailableScreen` é usado como catch-all de erro de aplicação

**O que acontece hoje.** `initProjectsPage().catch(...)` termina em `showUnavailableScreen()`
(`frontend/src/js/ui/unavailable-screen.js`). Qualquer exceção de JS, um bug de render, um `import()`
que falhou, anuncia "Não foi possível conectar ao servidor. Verifique sua conexão".

**Por que é ruim.** O usuário vai conferir o cabo de rede por um defeito de cliente. A tela em si é
boa e distingue-se muito bem de "sem dados" (é de marca, tem `role="alert"` e botão de nova
tentativa); o problema é usá-la onde o diagnóstico é outro.

**Arquivo e símbolo.** `frontend/src/js/projects/projects-page.js`, o `catch` de `initProjectsPage`;
`frontend/src/js/ui/unavailable-screen.js`, `showUnavailableScreen`.

**Correção proposta.** Um segundo estado ("Não foi possível iniciar o EBGeo") para o catch de erro de
aplicação, mantendo o de indisponibilidade só para a falha de `bootConfig()`.

#### 3.9 Não existe recuperação de senha em lugar nenhum, e o login não diz o que fazer

**O que acontece hoje.** `LoginModal._createForm` (`frontend/src/js/modals/login.modal.js`) tem
usuário, senha, erro inline, Cancelar, Entrar e, condicionalmente, "Criar conta". Nada mais. No
servidor, `backend/src/modules/auth/auth.routes.js` monta `register`, `verify-email`,
`resend-verification`, `login`, `refresh`, `logout` e `me`: **não há rota de redefinição**. A única
redefinição é `POST /users/:userId/reset-password`, com `requireAdmin`.

**Por que é ruim.** O usuário que esqueceu a senha lê "Usuário ou senha inválidos" e não tem passo
seguinte nenhum. Ironicamente, o servidor sabe o passo certo e o escreve em `sendAccountExistsEmail`
(`backend/src/utils/mailer.js`): "Se esqueceu a senha, peça a redefinição ao administrador do EBGeo.
Não há redefinição automática por e-mail." Essa frase só chega a quem tenta se recadastrar com o
mesmo e-mail. Combinado com o achado 3.2, que desloga por falha transitória, isso vira perda de
acesso.

**Arquivo e símbolo.** `frontend/src/js/modals/login.modal.js`, `LoginModal._createForm`;
`backend/src/utils/mailer.js`, `sendAccountExistsEmail`.

**Correção proposta.** Uma linha estática no `LoginModal` com a mesma redação do mailer. Custo perto
de zero, e remove um beco sem saída.

#### 3.10 O reenvio de confirmação é um botão de uso único, e o e-mail do sistema aponta para uma opção inexistente

**O que acontece hoje.** `apiClient.resendVerification` tem **um único chamador em todo
`frontend/src/`**: `AccountControl._handleRegister`, dentro do `showConfirm` que aparece logo após o
cadastro. Fechou com "Entendi", acabou. Enquanto isso, `login`
(`backend/src/modules/auth/auth.service.js`) recusa com o código `EMAIL_NOT_VERIFIED`, e essa frase
chega ao `LoginModal._showError` sem botão de reenvio ao lado. E `sendAccountExistsEmail` instrui a
"usar a opção de reenviar a confirmação na tela de cadastro", que **não existe**:
`SignupModal._createForm` não tem nada disso.

**Por que é ruim.** O e-mail que não chega é o modo de falha esperado de um deploy sem relay (§1.5), e
a única saída oferecida some ao primeiro clique. O usuário fica com uma conta que existe, não loga e
não tem botão. Um texto do sistema que aponta para uma afordância inexistente é pior que silêncio.

**Arquivo e símbolo.** `frontend/src/js/account/account.control.js`, `AccountControl._handleRegister`;
`frontend/src/js/modals/login.modal.js`, `LoginModal._showError`;
`frontend/src/js/modals/signup.modal.js`, `SignupModal._createForm`;
`backend/src/utils/mailer.js`, `sendAccountExistsEmail`.

**Correção proposta.** (i) No `LoginModal`, quando `error.code === 'EMAIL_NOT_VERIFIED'`, trocar o
erro seco por erro mais botão "Reenviar e-mail de confirmação" (a rota é anônima e não vaza
existência). (ii) Um link permanente "Já se cadastrou e o e-mail não chegou?" no `SignupModal`, para
casar com o texto do mailer.

#### 3.11 O usuário não vê nem corrige o próprio e-mail, e ninguém corrige

**O que acontece hoje.** `FIND_USER_BY_ID` (`backend/src/modules/users/users.queries.js`) seleciona
id, username, nome, rank_id, posto, organization_id, OM, created_at e last_login_at. **Não seleciona
`email` nem `email_verified`**; quem os seleciona é `FIND_USER_BY_ID_ADMIN`. `updateProfileSchema`
(`backend/src/modules/users/users.schemas.js`) aceita `{ nome, rank_id }`, e `updateUserAdminSchema`
aceita `email_verified` mas **não `email`**. E `AccountSettingsModal._renderProfileSection` desenha
Usuário, Papel, Lotação, OM de produção, Nome e Posto, com e-mail em lugar nenhum.

**Por que é ruim.** O e-mail é obrigatório no cadastro, é o que trava o login e é o único canal de
recuperação, e é o único dado da conta que o dono não pode ver, conferir ou corrigir. Quem digitou o
endereço errado fica com uma conta permanentemente inacessível: não confirma, não loga, não corrige,
e o administrador tampouco corrige (só pode marcar `email_verified` na mão, o que é contorno e não
conserto). O usuário também não tem como saber se a conta dele está pendente ou confirmada. Isso se
soma ao §10.6 do estatuto, que já registra que uma conta pendente cativa o par usuário/e-mail para
sempre.

**Arquivo e símbolo.** `backend/src/modules/users/users.queries.js`, `FIND_USER_BY_ID`;
`backend/src/modules/users/users.schemas.js`, `updateProfileSchema` e `updateUserAdminSchema`;
`frontend/src/js/modals/account-settings.modal.js`, `AccountSettingsModal._renderProfileSection`.

**Correção proposta.** Acrescentar `email` e `email_verified` ao `FIND_USER_BY_ID` e exibi-los como
linha somente-leitura com o estado (confirmado ou pendente) e botão de reenvio. Troca de e-mail é
trabalho maior, porque exige re-verificação; a LEITURA é uma coluna e uma linha.

### MÉDIO

#### 3.12 "Minha conta" só é alcançável a partir do mapa

O único chamador de `showAccountSettingsModal` em todo `frontend/src/` é
`AccountControl._handleOpenAccountSettings`. `createAppBar` (`frontend/src/js/ui/app-bar.js`), a
barra compartilhada de `atlas.html` e `admin.html`, oferece ações da página, o selo de papel,
"Calibração 360" e "Sair", e não oferece "Minha conta". Mesmo assim, `style.css`,
`projects-page.css` e `admin-page.css` importam `account-settings.css` com um comentário dizendo que
a tela "é aberta a partir das três páginas que têm barra superior", o que é falso em duas delas. Como
`shouldRouteToProjects` leva o usuário logado direto para `atlas.html`, trocar a senha exige abrir um
atlas, esperar o bundle do mapa, clicar no avatar e só então chegar lá. Correção: acrescentar a ação
"Minha conta" em `createAppBar`, gateada por `sessionContext.isAuthenticated()`, com o mesmo
`import()` dinâmico. O CSS já está carregado.

#### 3.13 Token de confirmação expirado e inválido dão a MESMA mensagem, e ela chuta

`handleEmailVerificationFromUrl` (`frontend/src/js/index.js`) tem um `catch {}` sem parâmetro e emite
sempre "Não foi possível confirmar o e-mail. O link pode ter expirado." O servidor distingue com
precisão em `verifyEmail` (`backend/src/modules/auth/auth.service.js`): "Token de verificação
inválido." (desconhecido ou já consumido) contra "Token de verificação expirado." (com rollback
deliberado do claim, para o usuário poder pedir outro). O TTL é de 48 h. Além disso, o sucesso emite
"E-mail confirmado! Faça login para entrar." e **não abre o modal de login**. Correção: usar
`error?.message` do servidor (já vem no `ApiError` por `buildApiErrorMessage`); no caso expirado,
oferecer campo de e-mail e reenvio; no sucesso, chamar `getControl('account')?.requestLogin?.()`.

#### 3.14 Servidor fora do ar no login vira "HTTP 502" ou "Failed to fetch"

`LoginModal._handleSubmit` mostra `error?.message || 'Falha ao entrar. Tente novamente.'`. Quando o
corpo do erro não é o envelope da API (proxy devolvendo HTML), `buildApiErrorMessage`
(`frontend/src/js/store/sync/api-client.js`) produz literalmente `HTTP 502`; quando o `fetch`
rejeita, o `TypeError` do navegador escapa inteiro e o usuário lê `Failed to fetch`, em inglês, na
mesma caixa vermelha em que leria "senha errada". As outras quatro categorias (senha inválida, conta
desativada, e-mail não confirmado, OM inativa) **são distinguíveis e a tela diz qual**, o que está
bom. Correção: classificar por `error.status` no `onSubmit` de `_handleLogin`: sem status para "Sem
conexão com o servidor"; 5xx para "O servidor está indisponível"; 429 para "Muitas tentativas".

#### 3.15 "Sair" não pergunta e não diz que o atlas remoto sai do computador

`_handleLogout` roda direto do clique. Compare com `_handleDeleteAtlas`, no mesmo arquivo, que pede
DUAS confirmações. Depois de `announceRemoteNamespaceTeardown`, `clearAllDataStore` e
`discardRemoteAtlasNamespaces`, o atlas de servidor deixa de existir neste navegador, o que é
correto, mas nunca é dito. Correção: um `showConfirm` único nomeando o efeito ("o atlas X deixa de
ficar disponível neste computador; ele continua no servidor"), suprimido quando não há atlas remoto
montado. É também o lugar natural para o aviso de fila pendente do achado 3.1.

#### 3.16 Quatro superfícies de criação pedem dados antes de descobrir que não podem

`MapsTab._handleNewMap` gera um nome sugerido e abre o prompt; a recusa só vem em `addMap`.
`MapsTab._handleImportAdditive` abre o seletor de arquivos; a recusa só vem em `IMPORT_DATA`. O
editor de briefing (`frontend/src/js/briefing/`) abre inteiro; a recusa vem em `createBriefing` /
`updateBriefing` (`frontend/src/js/store/briefing.operations.js`). Marcadores 3D e 360 são
colocáveis; a recusa vem em `guardCesium3dWrite` (`frontend/src/js/store/cesium3d.operations.js`). O
`grep` por `checkPermission` ou `GuardAction` nessas quatro pastas devolve zero. Cada caso custa ao
usuário um investimento antes de dizer não, e o "não" é a frase falsa do achado 3.4. Correção: o
padrão já está pronto e usado, em `CommentOverlay.togglePlacement`, que recusa a ENTRADA no modo e
nomeia o motivo real entre três possíveis. Replicá-lo.

#### 3.17 "Criar conta" só existe no modal de login do mapa

`AccountControl._handleLogin` calcula `config?.features?.self_registration === true` e só então passa
`onRegister`, o que é correto. Mas `openLoginDialog` (`frontend/src/js/projects/projects-page.js`)
chama `showLoginModal({ onSubmit })` **sem `onRegister`**, e é ele que `createServerInvite` aciona.
Onde o self-registration está ligado, o visitante que chega a "Seus atlas" (destino canônico de quem
tem sessão, e um endereço perfeitamente compartilhável) vê "Entrar" e nenhuma porta para criar conta.
A regra de gate está certa; a aplicação dela está em um lugar só. Correção: passar `onRegister`
também em `openLoginDialog`, atrás do mesmo gate.

#### 3.18 O toast do resgate FALHADO não diz o prazo de que ele mesmo depende

Na branch de falha de `_handleLogout`, com veto gravado, a mensagem diz que as alterações "continuam
neste computador por tempo limitado: entre novamente o quanto antes". O prazo é
`RESCUE_VETO_GRACE_MS` em `frontend/src/js/store/remote-atlas.api.js`, 24 horas. "Quanto antes" não é
acionável: quem lê na sexta à noite volta na segunda e perdeu. Note que o toast **diz a verdade
quando o resgate falha**, com duas redações distintas conforme `remoteAtlasRescueVetoSince`, e
`duration: 0` para não sumir. Só falta o número. Correção: dizer "nas próximas 24 horas", derivando
de `RESCUE_VETO_GRACE_MS` em vez de escrever a constante na frase.

#### 3.19 O convite recebido não é anunciado em lugar nenhum

Não há mecanismo de notificação no cliente: o `grep` por `notification`, `convite`, `invite`,
`unread` sobre `frontend/src/js/` só devolve o texto de "sair do atlas" e o modal de concessão de
recurso. A única forma de descobrir que alguém compartilhou um atlas é abrir `atlas.html` e reparar
num cartão novo. O compartilhamento é o motivo de o produto ter servidor; um convite que só existe se
o convidado for procurá-lo desperdiça o ato de quem convidou. Correção barata que não inventa
infraestrutura: marcar no cartão os atlas cujo `atlas_shares.created_at` seja posterior ao último
acesso daquela pessoa àquele atlas, e contar esses no rótulo da aba "Compartilhados". Ponto de escrita
`addUserShare` (`backend/src/modules/sharing/sharing.controller.js`), ponto de leitura
`AtlasDrive.setOverview`.

#### 3.20 A edição sobrescrita por um colega é silenciosa

O modelo é LWW por ordem de chegada no servidor (`applyRemoteOperation` e a guarda de convergência em
`frontend/src/js/store/sync/remote-operation-handler.js`). Quando a operação de um colega vence a
sua, o dado local é substituído e o único sinal é o redesenho. Nenhum arquivo em
`frontend/src/js/presence/` emite toast. O usuário vê o próprio texto ou a própria geometria mudar
sozinha e não sabe se foi ele, um colega ou um defeito. Não se propõe mudar o modelo, que está
registrado como decisão; propõe-se dar sinal: quando a operação remota tocar entidade que o usuário
editou nos últimos segundos, mostrar um toast nomeando o autor, que a presença já conhece
(`presenceStore`).

#### 3.21 O nível do usuário no atlas fica escondido atrás do avatar

`AccountControl._applyAtlasName` desenha o chip do nível (`getPermissionLabel(permission)`, com
`title` "Seu nível neste atlas: X"), mas ele vive dentro do menu suspenso que só abre ao clicar no
avatar. O cabeçalho da aba Mapas (`MapsTab._refreshAtlasHeader`) mostra o nome e o chip
"Local"/"Servidor", e não o nível. O nível é a explicação de metade do que a tela faz ou deixa de
fazer; escondê-lo faz cada recusa parecer arbitrária. Se ele estivesse ao lado do nome do atlas, o
achado 3.4 seria menos grave mesmo sem correção. Correção: levar o chip para o cabeçalho da aba
Mapas quando `isRemoteStoreSync()`, com fonte única em `getPermissionLabel`.

#### 3.22 "Fazer uma cópia" não diz que a cópia é sua nem o que ela perdeu

`cardMenuActions` usa o rótulo "Fazer uma cópia" tanto para o atlas local (duplicação de bancos)
quanto para o de servidor (clone, que nasce em posse de quem clonou, §7.4). E §8.2 acrescenta uma
consequência que o usuário não tem como adivinhar: a cópia perde o que o clonador não pode ver, e um
recurso privado a que ele tenha concessão PRÓPRIA sobrevive ao clone e NÃO sobrevive ao `.ebgeo`. O
usuário que clona o atlas de um colega não sabe que virou dono, nem que a cópia pode ter perdido
camadas; descobre depois, quando uma camada não desenha. Correção: diferenciar o rótulo por origem
("Duplicar" no local, "Clonar para mim" no de servidor) e relatar depois o que ficou de fora, com o
mesmo formato de contagem por superfície que o aviso de poda de saída já usa (texto verificado em
`frontend/tests/unit/aviso-de-perda-de-recursos.test.js`). O servidor já sabe o que podou.

#### 3.23 Depois do cadastro, o formulário fica aberto atrás do diálogo, e o diálogo está montado ao contrário

Dois problemas no mesmo ponto. (i) `SignupModal._handleSubmit` faz `await this._onSubmit(...)` e só
então `this._close()`; como o `onSubmit` de `_handleRegister` faz `await showConfirm(...)`, o
formulário de cadastro, com a senha digitada, permanece atrás do diálogo, e ao dispensá-lo o usuário
fica olhando o mapa anônimo sem próximo passo. (ii) `_handleRegister` chama
`showConfirm(textoLongoDeTrêsFrases, { confirmText: 'Reenviar e-mail', cancelText: 'Entendi' })`; em
`ConfirmModal._render` o primeiro argumento vira o `<h3>` do título, então um parágrafo inteiro é
renderizado como cabeçalho, e o botão AFIRMATIVO é "Reenviar e-mail", com `Enter` ligado a
`_confirm()`: teclar Enter para dispensar o aviso **reenvia o e-mail**. Correção: fechar o modal
antes de anunciar, reabrir o `LoginModal` ao dispensar, e trocar por `showConfirm('Confira sua caixa
de entrada', { message: <o parágrafo>, confirmText: 'Entendi', cancelText: 'Reenviar e-mail' })`, ou
por um `showChoice`, que não tem botão afirmativo e cujo `Enter` é inerte de propósito.

#### 3.24 Restauração adiada por falha transitória boota anônimo em silêncio

`restoreSessionFromStorage` (`frontend/src/js/index.js`) faz a coisa certa (mantém os tokens num
timeout ou 5xx), mas cai num `console.warn` e o boot segue. A tela resultante é indistinguível de "eu
nunca entrei": botão "Entrar", mapa local. O usuário digita a senha por nada, ou conclui que foi
deslogado. Correção: nessa branch, um toast informativo dizendo que a sessão não pôde ser confirmada
agora e que ele está trabalhando localmente.

#### 3.25 "Sair agora" do aviso de inatividade reabre o modal de login

Em `startIdleWatch` (`frontend/src/js/session/idle-watch.js`), `onLogout` chama o mesmo `onExpire`
que o esgotamento do prazo, que em `IdleTimeoutController._expire` chama `handleSessionLost(...)`,
que sempre termina em `this.requestLogin()`. Quem clicou "Sair agora" pediu para ir embora e recebe
um formulário de login na cara, mais um toast dizendo que a sessão expirou por inatividade, o que não
foi o que aconteceu. Correção: separar os dois desfechos; a saída deliberada não reabre o login e usa
a mensagem de logout.

### BAIXO

#### 3.26 O limite de 10 atlas locais só aparece ao ser violado

`MAX_LOCAL_ATLASES` e a frase de recusa vivem em `frontend/src/js/store/local-atlas.api.js`
(`refuse`, `LocalAtlasError.LIMIT_REACHED`), e a mensagem é boa. Mas o ladrilho "+ Novo atlas local"
não muda de aparência ao se aproximar do teto. Proposta: escrever "7 de 10" na seção local de
`projects-page.js` e desabilitar o ladrilho no décimo, com `title` explicando.

#### 3.27 O modal de criação de atlas não oferece grupo, o de compartilhamento sim

`showCreateAtlasModal` monta convite por PESSOA e link público. O eixo de GRUPO (§5.3, vigente) só
aparece depois, em `sharing.modal.core.js`. Quem cria um atlas para uma equipe que já é grupo precisa
criar e depois abrir outra tela. Proposta: reusar a mesma seção de grupos, com `selectableGroups`.

#### 3.28 `AccountControl._openMenu` fecha a única porta para tudo quando falta o `username`

`_openMenu` sai cedo com `if (!this._menu || !this._username) return;`. Uma sessão em que o servidor
não devolva `username` nem `nome` (`sessionUserInfoFromMe`,
`frontend/src/js/store/sync/session-context.js`) renderiza o avatar, mas o menu nunca abre, e o menu
é a ÚNICA rota para "Minha conta", "Seus atlas" e "Sair". Gate melhor:
`sessionContext.isAuthenticated()`.

#### 3.29 As duas chaves de inatividade não são emitidas pelo servidor

`resolveIdleMs` e `resolveWarnMs` (`frontend/src/js/session/idle-watch.js`) leem
`config.features.idle_timeout_minutes` e `idle_warning_seconds`, mas `FEATURES` em
`backend/src/modules/config/config.static.js` não emite nenhum dos dois. Na prática o valor é sempre
o padrão do cliente (30 minutos, aviso 60 s antes), salvo override de administrador. Vale declarar os
dois no `FEATURES` para o valor ser de fato visível e ajustável.

#### 3.30 Duplicata inofensiva em `AccountControl.onAdd`

No handler de `CONNECTION_STATE_CHANGED`, `this._updateProjectsVisibility()` aparece duas vezes
seguidas, e a indentação do bloco está quebrada. Inofensivo, mas é o tipo de duplicata que esconde a
linha que falta.

#### 3.31 `showUnavailableScreen` não distingue causas nem se atualiza

Não há re-tentativa automática nem distinção entre "sua rede caiu" e "o servidor caiu", e o `_shown`
é global de módulo, então uma segunda causa depois da primeira não atualiza a mensagem.

---

## 4. O que está BOM e não deve ser mexido

Esta seção não é cortesia. Cada item abaixo é uma decisão que custou caro e que uma "simplificação"
futura desfaria.

1. **A escada por atlas está fechada no cliente.** `frontend/src/js/projects/permission-levels.js` é
   fonte única, tem zero imports por contrato, e a varredura em `frontend/src/js/` não achou nenhuma
   lista fechada em gate. `serverTreatsAsAtlasOwner` e `atlasRoleHasAtLeast` existem exatamente
   porque a lista fechada havia divergido entre `sharing.modal.js` e `account.control.js`, e o
   conserto foi feito com um NOME em vez de com um comentário. Não reintroduza comparação por
   igualdade em lugar nenhum.

2. **Nenhuma lista fechada de papel GLOBAL, tampouco.** Os gates são métodos de `sessionContext` e
   `adminAudience`, com `isAdmin` testado primeiro. `globalRoleBadge` trata papel desconhecido em voz
   alta em vez de rebaixar para "Usuário". Nada promove nem rebaixa em silêncio.

3. **O resgate de trabalho no caminho involuntário.** `shouldPreserveLocalWork` (pura, com `NaN`
   significando preservar), `preserveUnsyncedWorkAsLocal` com **read-back do disco** antes de
   declarar sucesso, `failedRescueKeepsNamespace` como saída única das duas falhas, e o par de
   mensagens que muda conforme o veto foi ou não gravado. É a melhor peça de engenharia de UX do
   produto, e é o oposto exato do achado 3.1: prova que o time sabe fazer isso.

4. **`refreshVisibleResources` está nos DOIS caminhos de sessão**, `syncEngine.login` e
   `restoreSessionFromStorage`, este último com um comentário explicando o sumiço que a ausência
   causava. F5 mantém a sessão e o catálogo privado sobrevive.

5. **O tab-lock e seus textos.** `frontend/src/js/utilities/tab-lock.js`: `OVERLAY_TEXT`,
   `TEARDOWN_OVERLAY`, `TEARDOWN_OVERLAY_LOCAL_DELETED`, `DEGRADED_NOTICE`, `BLOCKED_OVERLAY`. Cinco
   estados com cinco frases diferentes, e a distinção entre "recarregar descarta seu trabalho" e
   "recarregue para continuar" é exatamente a que uma frase única erraria em um dos dois casos. O
   estado degradado ser um banner e não um overlay é a decisão certa: um recurso ausente do navegador
   não deve virar apagão.

6. **A recusa de comentar nomeia o motivo real.** `CommentOverlay.togglePlacement` distingue "atlas
   local", "não está logado" e "sem permissão", e o comentário do código diz por que: mandar fazer
   login quem está num atlas local não resolve nada. É o modelo que os achados 3.4 e 3.16 devem
   seguir.

7. **A saída de atlas e a saída de grupo.** `describeLeaveOutcome` e o trio
   `leaveGroupAvailability` / `leaveGroupWarning` / `leaveGroupSummary` relatam o que o servidor
   MEDIU, com quatro desfechos no primeiro caso, em vez de um "Você saiu" incondicional que a própria
   lista desmentiria um segundo depois. As cláusulas 4.7 e 5.8 têm superfície de cliente completa.

8. **`adminAudience` e `role-labels.js`.** A porta se chama "Grupos" para quem só recebe Grupos, e o
   selo do papel global carrega a frase que explica o que ele permite. Zero imports nos dois, para
   poderem viver nas páginas sem store. Recortar as abas no cliente em vez de deixar o servidor
   responder 403 na montagem é a decisão correta: 403 na montagem é a pior forma de dizer não.

9. **O cabeçalho do atlas na aba Mapas.** `MapsTab._refreshAtlasHeader`: nome editável, chip
   Local/Servidor com `title` explicativo, e o nome no `document.title` para escolher entre abas. E
   `_canRenameAtlas` é deliberadamente MAIS estrito que o servidor, com o raciocínio escrito:
   oferecer menos que o servidor é seguro, o inverso congela a fila.

10. **`openAtlasFromUrl` distingue 403 de 404 com frases diferentes**
    (`frontend/src/js/index.js`), e o comentário explica que o 404 do servidor cobre dois casos de
    propósito, para não confirmar existência. Um "Atlas não encontrado" seco mandaria o usuário caçar
    erro de digitação num link correto.

11. **A seção de chave de API.** Ela escreve o limite conhecido §10.7 do estatuto na cara de quem
    gera: a chave carrega as permissões inteiras, não tem prazo e não tem escopo, e a única forma de
    invalidá-la é gerar outra. Mais o aviso de uso único antes do clique, a confirmação destrutiva, e
    o guarda em `AccountSettingsModal.hide` que impede fechar com chave não copiada (`hasUncopiedKey`,
    que só conta cópia bem-sucedida). A chave nunca vai a `console`, `title` ou `localStorage`. Isto
    não é achado, é o padrão que o resto da área deveria seguir.

12. **Troca de senha.** Exige a senha atual, e `PASSWORD_SESSION_WARNING` diz que todas as sessões
    são encerradas, **inclusive esta**, mostrado ANTES do botão e repetido na confirmação.
    `PASSWORD_RULE_TEXT` espelha `updatePasswordSchema` com teste estrutural.

13. **Campos somente-leitura com autoria explícita.** `ADMIN_ONLY_FIELDS_NOTE` diz quem muda papel,
    lotação e OM de produção, porque `updateProfileSchema` os descarta com `stripUnknown` e responde
    200 sem mudar nada. Oferecer o campo seria a promessa que o servidor recusa. E `_renderRankField`
    trata posto desativado criando uma opção "(fora de uso)" em vez de silenciosamente limpar o campo.

14. **O cadastro não vaza existência de conta.** `_handleRegister` recusa dizer "conta criada" porque
    o servidor responde 201 idêntico nos dois casos (`register`, com bcrypt antes do ramo para fechar
    o oráculo de tempo). O cliente respeita isso corretamente.

15. **`cardMenuActions`.** Ações por posto, derivadas de `hasAtLeast`, devolvendo array novo a cada
    chamada. É o gate de tela feito certo, e o contraste com `_showMapContextMenu` no mesmo produto é
    o que torna o achado 3.4 fácil de corrigir: o modelo já existe.

16. **O aviso de inatividade está no padrão bancário.** `IdleTimer` puro e testável, atividade real
    re-arma o relógio, atividade é ignorada DURANTE o aviso (escolha explícita exigida), Escape
    significa "estou aqui", contagem regressiva ao vivo, e `alertdialog` com `aria-modal`.

---

## 5. Perguntas em aberto que só o dono decide

**5.1 Sair da conta com fila pendente: perguntar ou salvar?** O achado 3.1 propõe perguntar, com três
saídas. Há uma alternativa defensável: aplicar o mesmo resgate do caminho involuntário sem perguntar
nada, e apenas informar. A primeira respeita a vontade de quem clicou em Sair; a segunda nunca perde
trabalho. É decisão de produto, não de engenharia.

**5.2 O Leitor deve VER a lista de participantes dentro do mapa?** A cláusula §5.7 é vigente e o
cartão em `atlas.html` já a cumpre. Mas `GET /atlas/:atlasId/sharing` continua exigindo `manage`.
Duas leituras: (a) o cartão já basta e o botão da aba Mapas deve só explicar a recusa; (b) a cláusula
pede uma visão de participantes DENTRO do mapa, e o modal deveria abrir em modo somente-leitura para
quem não gere. A segunda é mais trabalho e mais fiel ao texto.

**5.3 O botão "Compartilhar" deve sumir para quem não gere?** O comentário de `ACTIONS_BY_STATE`
decidiu mantê-lo visível, com um raciocínio bom (um Gestor rebaixado no meio da sessão veria o botão
sumir sem explicação). A pergunta é se esse caso raro justifica o beco sem saída no caso comum, ou se
a saída é manter o botão e consertar só a chegada, como o achado 3.6 propõe.

**5.4 Recuperação de senha: por administrador para sempre, ou por e-mail um dia?** Hoje é por
administrador e o mailer diz isso, mas a tela de login não. O achado 3.9 propõe apenas escrever a
regra existente no lugar certo, o que é barato e não decide nada. A pergunta de fundo, se um dia vai
existir redefinição por e-mail, depende do mesmo relay que trava §1.5.

**5.5 Notificação de convite.** Badge silencioso na aba "Compartilhados" (barato, resolve o caso
comum) ou e-mail de convite (caro, depende do relay)? O achado 3.19 propõe o primeiro como piso.

**5.6 Correção de e-mail digitado errado.** O achado 3.11 propõe exibir o campo em leitura, o que é
uma coluna e uma linha. A correção de fato (trocar o e-mail, com re-verificação) é decisão maior, e
interage com §10.6, que já registra como custo aceito que uma conta pendente cative o par
usuário/e-mail para sempre. Hoje o administrador também não corrige: só marca `email_verified` na
mão. Isso é o desejado?

**5.7 Tile privado (§10.1) e o que o usuário vê.** O estatuto registra que o acervo privado hoje NÃO
desenha para quem tem direito, porque o navegador pede o tile sem credencial, e §10.3 diz que uma
revogação aparece como camada quebrada em vez de camada ausente. Para este perfil, isso significa que
um usuário com concessão legítima vê uma camada que não pinta, sem nenhuma explicação na tela.
Enquanto a pendência não for resolvida, vale uma mensagem de camada inacessível? Ou isso mascararia o
defeito que se quer consertar?

---

## Nota de método

Nenhum arquivo de código foi modificado. `frontend/tests/e2e-ui/` não foi tocado. Nenhum commit foi
feito. As afirmações sobre gates do servidor foram conferidas em
`backend/src/modules/sharing/sharing.routes.js`, `backend/src/modules/auth/auth.routes.js`,
`backend/src/modules/users/users.queries.js` e `backend/src/config.js`; as afirmações sobre o cliente,
lendo os arquivos citados. Os achados levantados por varredura paralela foram reconferidos por
leitura direta do código antes de entrar neste relatório, e não aceitos por relato.
