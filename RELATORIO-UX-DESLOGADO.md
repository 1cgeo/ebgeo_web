# Relatório de UX: o usuário deslogado

Avaliação de um perfil só, o **visitante anônimo** (incluindo o visitante de link público de atlas),
feita contra o código do branch `integracao_backend` em 2026-08-23. Cada afirmação foi conferida no
arquivo citado; prosa de documentação não foi aceita como evidência.

Alcance: `frontend/src/js/index.js` (roteamento do boot), `frontend/src/js/projects/` (a página
`atlas.html`), `frontend/src/js/sidebar/tabs/maps.tab.js` (a aba Mapas do mapa),
`frontend/src/js/account/`, `frontend/src/js/modals/`, `frontend/src/js/store/` (namespace, wipe,
tab-lock), `frontend/src/js/catalog/` (poda de saída) e `backend/src/modules/auth/`.

---

## 1. O que o visitante É, segundo o estatuto e segundo o código

### 1.1 O que o estatuto diz

Cláusulas de [`CONSTITUICAO.md`](CONSTITUICAO.md) que constituem este perfil, com o estado declarado
lá:

| cláusula | conteúdo | estado |
|---|---|---|
| 1.2 | o visitante deslogado **não é papel, é modo**; o visitante de link público tem token próprio, sem linha em `users`, confinado ao atlas | vigente |
| 1.5 | o deslogado cria a própria conta, sempre como `user`; a OM declarada é lotação e não autoriza nada | **pendente** (a rota em produção espera o relay de e-mail) |
| 2.2 | topônimos não têm eixo público/privado: o anônimo recebe todo nome semeado | vigente |
| 5.4 | o link público é **somente leitura, imposta no servidor e não na interface**; o visitante é anônimo e confinado; o link é revogável | vigente |
| 6.3 | o empréstimo de recurso privado alcança **inclusive o visitante do link público** | vigente |
| 7.1 | o usuário deslogado tem **vários** atlas locais (teto medido em teste: décimo aceito, décimo primeiro recusado) | vigente |
| 7.4 | locais e remotos podem ser duplicados e apagados | vigente |
| 7.5 | atlas local se compartilha **por arquivo `.ebgeo`**, nunca pelo sistema | vigente |
| 8.1 | sair do servidor apaga o privado, por keep-list, dono inclusive | vigente |
| 8.3 | o visitante anônimo **pode** exportar e salvar como local, e **não pode** clonar no servidor | vigente |
| 8.4 | quem exporta ou salva como local é avisado do que perdeu | vigente |
| 10.1 | os bytes do tile privado não passam por gate, e o gêmeo do defeito é que o acervo privado **não desenha para quem tem direito** | **pendente** por decisão do dono |
| 10.6 | conta pendente cativa nome e e-mail para sempre; o desbloqueio é ato de administrador | limite aceito |

Fora do estatuto, mas contrato declarado em [`CLAUDE.md`](CLAUDE.md) e verificado no código: **login é
opcional, servidor não é**. O boot é fail-fast em `GET /api/config` e não existe fallback estático.

### 1.2 O que o código faz

- **O mapa é o produto para quem não entrou**, e isso é literal. `shouldRouteToProjects`
  (`frontend/src/js/deep-link/route-decision.js`) devolve `false` sem token armazenado, então o
  anônimo nunca é desviado para `atlas.html`. A cadeia do boot em `initApp`
  (`frontend/src/js/index.js`) é `consumePendingEbgeoImport` → `openPublicAtlasFromUrl` →
  `openAtlasFromUrl` → `enterLocalMapOnBoot` → `openAtlasChooserOnBoot`, e as duas últimas saem
  cedo para quem não tem sessão (`openAtlasChooserOnBoot` começa em
  `if (!sessionContext.isAuthenticated()) return;`).
- **Os atlas locais existem de verdade e são plurais.** `MAX_LOCAL_ATLASES = 10` e
  `createLocalAtlas` / `deleteLocalAtlas` / `duplicateLocalAtlas` em
  `frontend/src/js/store/local-atlas.api.js`; a tela é `LocalAtlasSection`
  (`frontend/src/js/projects/atlas-drive.js`), que roda fora do `if (signedIn)` de
  `initProjectsPage` (`frontend/src/js/projects/projects-page.js`).
- **O visitante de link público é uma sessão ONLINE de papel VIEWER sem identidade.**
  `sessionContext.setVisitorSession()` (`frontend/src/js/store/sync/session-context.js`) põe
  `_isVisitor = true`, `_userId = null`, `_role = UserRole.VIEWER`; `isAuthenticated()` continua
  falso. `syncEngine.connectPublic` (`frontend/src/js/store/sync/sync-engine.js`) chama
  `disableOperationLogging()`, de modo que nenhuma op nasce nesse modo.
- **A leitura-somente do visitante público chega à tela.** `checkPermission`
  (`frontend/src/js/store/sync/permission-guard.js`) só libera tudo quando a sessão é offline **ou**
  o store não é remoto; para o visitante público as duas condições falham, e
  `ViewModeController._sync` (`frontend/src/js/ui/view-mode.controller.js`) aplica a classe
  `is-view-only` no `body`, que esconde as barras de criação por CSS.
- **O trabalho local do anônimo não é destruído por nenhum caminho de sessão.**
  `clearAllDataStore` (`frontend/src/js/store/store.js`) esvazia apenas o atlas MONTADO, e a
  varredura de namespaces remotos é chamada pelo nome (`discardRemoteAtlasNamespaces`) só nos dois
  pontos que significam "a sessão acabou". Em `openPublicAtlasFromUrl` o `activateRemoteAtlas` vem
  ANTES do wipe, então o que é esvaziado é o namespace público recém-montado, nunca o slot local.

### 1.3 Onde os dois divergem

1. **5.4 diz que a leitura-somente é imposta no servidor e não na interface. A interface, porém,
   oferece uma ação que exige conta.** Em `ACTIONS_BY_STATE[AtlasTabState.REMOTE]`
   (`frontend/src/js/sidebar/tabs/maps.tab.js`) a lista é
   `['open', 'import', 'save', 'save-local', 'share']`, e `_atlasState` coloca o visitante de link
   público exatamente nesse estado (o comentário do próprio método reconhece isso). O botão
   **Compartilhar** aparece para um anônimo. Detalhe no achado C1.
2. **1.5 está pendente, e a interface acompanha corretamente no mapa e incorretamente no seletor.**
   `AccountControl._handleLogin` lê `config.features.self_registration` antes de passar
   `onRegister`, então o mapa nunca mostra "Criar conta" onde a rota está desmontada. Já
   `openLoginDialog` (`frontend/src/js/projects/projects-page.js`) chama `showLoginModal({ onSubmit })`
   **sem** `onRegister`, então em `atlas.html` o cadastro não existe nem onde está ligado.
3. **6.3 dá ao visitante de link público o recurso privado emprestado, e 10.1 diz que ele não
   desenha.** As duas cláusulas são vigentes e pendente, respectivamente, e a soma delas é uma
   experiência de camada quebrada para o perfil que menos tem como diagnosticá-la. Achado A7.
4. **Nada no estatuto trata de recuperação de senha, e nada no código a implementa.** Não é
   divergência com o texto, é um vazio: ver a pergunta em aberto P1.

---

## 2. Inventário de ações

Estado do visitante: **A** = anônimo no mapa local; **P** = anônimo dentro de um link público;
**S** = anônimo na página `atlas.html`.

| # | Ação | Onde | Alcançável? | Rótulo diz a verdade? | Veredito |
|---|---|---|---|---|---|
| 1 | Primeiro acesso, boot no mapa | `initApp` (`index.js`) | A: sim | sim | OK |
| 2 | Ver a tela de indisponível sem backend | `showUnavailableScreen` (`ui/unavailable-screen.js`) | A, S: sim | parcial: não diz que o trabalho local está intacto | **ALTO** (A2) |
| 3 | Desenhar, editar, camadas, mapas | ferramentas do mapa | A: sim, sem gate (`checkPermission` libera store local) | sim | OK |
| 4 | Saber que o trabalho é local | chip `Local` em `MapsTab._refreshAtlasHeader` | A: só por `title` num `<span>` | tecnicamente sim, praticamente invisível | **ALTO** (A5) |
| 5 | Chegar a "Seus atlas" | `MapsTab._handleOpenProject` → `AccountControl.openProjectPicker` | A, P: sim, botão "Abrir" | **não**: o rótulo não menciona atlas nem a página | **MÉDIO** (M1) |
| 6 | Criar atlas local | `LocalAtlasSection._createTile` → `createLocalAtlas` | S: sim | sim | OK, com atrito no teto (M5) |
| 7 | Trocar de atlas local | `LocalAtlasSection._open` → `pointAtLocalAtlasAndGo` | S: sim | sim | OK |
| 8 | Renomear atlas local | `renameLocalAtlasFromPage`; também no cabeçalho (`_canRenameAtlas`) | A, S: sim | sim | OK |
| 9 | Duplicar atlas local | `duplicateLocalAtlasFromPage` | S: sim | "Fazer uma cópia", igual ao rótulo do servidor | OK |
| 10 | Excluir atlas local | `deleteLocalAtlasFromPage` → `deleteLocalAtlas` | S: sim | sim, mas encena confirmação destrutiva para uma recusa já sabida | **MÉDIO** (M4) |
| 11 | Exportar `.ebgeo` | `MapsTab._handleSaveProject` → `ExportImportService.handleExport` | A, P: sim (mapa) / S: **não existe** | o aviso de poda afirma "restritos" sem base para este perfil | **MÉDIO** (M2) |
| 12 | Importar `.ebgeo` aditivo | `MapsTab._handleImportAdditive` | A: sim; P: **oferecido e recusado op a op** | não | **MÉDIO** (M3) |
| 13 | Importar `.ebgeo` substituindo | `DragDropHandler.processFile` → `askImportMode` | A: só por arrastar | sim ("Substituir Atual") | BAIXO (B6) |
| 14 | Abrir `.ebgeo` como atlas novo | `LocalAtlasSection._fileButton` → `openEbgeoFileAsLocalAtlas` | S: sim | sim | OK |
| 15 | "Limpar tudo" | `MapsTab._handleClearAll` | A: sim | sim, e nomeia o atlas e diz que os outros não são afetados | OK |
| 16 | Abrir link público | `openPublicAtlasFromUrl` (`index.js`) | P: sim | toast único, transitório | **ALTO** (A4) |
| 17 | Link público inválido ou revogado | mesmo símbolo, ramo `catch` | P: **falha em silêncio** | nenhum rótulo | **ALTO** (A3) |
| 18 | Saber que a visita é somente leitura | `setVisitorSession` + `is-view-only` | P: só por ausência de barras | nenhum sinal persistente | **ALTO** (A4) |
| 19 | Tentar editar no link público | `checkPermission` → `store-error-listener.js` | P: bloqueado com toast honesto | sim | OK |
| 20 | "Salvar como local" no link público | `MapsTab._handleSaveAsLocal` | P: sim (cláusula 8.3) | sim | OK |
| 21 | Clonar o atlas público | rota `POST /atlas/:atlasId/clone` com `requireAccountPrincipal` | P: **não oferecido** no cliente | correto | OK |
| 22 | Compartilhar o atlas público | `ACTIONS_BY_STATE[REMOTE]` inclui `share`; `MapsTab._handleShare` | P: **oferecido e morre** | **não** | **CRÍTICO** (C1) |
| 23 | Comentar | `CommentOverlay.togglePlacement` | A, P: oferecido, recusado com frase | frase honesta, mas manda fazer o que não é oferecido | **MÉDIO** (M6) |
| 24 | Ver o catálogo público (3D, 360, dados, análise) | `CatalogService` sobre o `config` | A, P: sim | sim | OK |
| 25 | Ver recurso privado emprestado pelo atlas público | cláusula 6.3 vs 10.1 | P: aparece e **não desenha** | não | **ALTO** (A7) |
| 26 | Buscar topônimos | `GET /nomes/busca` | A: sim, todo nome | sim | OK |
| 27 | Descobrir que existe conta e colaboração | `createServerInvite` (`projects/atlas-drive.js`) | A: só depois de achar "Abrir" | o texto é bom, o lugar é escondido | **ALTO** (A6) |
| 28 | Abrir o modal de login | `AccountControl._handleLogin`; `openLoginDialog` | A, P, S: sim | sim | OK |
| 29 | Criar conta | `AccountControl._handleRegister` → `showSignupModal` | A, P: só se `features.self_registration`; **S: nunca** | sim no mapa | **MÉDIO** (M7) |
| 30 | Entender que a OM do cadastro não autoriza nada | `SignupModal._createForm` | A: campo obrigatório, sem explicação | **não** | **MÉDIO** (M8) |
| 31 | Confirmar e-mail | `handleEmailVerificationFromUrl` (`index.js`) | A: sim, `?verify=` | toda falha vira "pode ter expirado" | **MÉDIO** (M9) |
| 32 | Reenviar confirmação | `apiClient.resendVerification`, no `showConfirm` do cadastro | A: sim | sim | OK |
| 33 | Recuperar senha | **não existe** em `backend/src/modules/auth/auth.routes.js` nem no `LoginModal` | A: **não** | não há rótulo nenhum | **ALTO** (A1) |
| 34 | Entrar e ver o que acontece com o trabalho local | `syncEngine.login`; `openProjectPicker` | A: sim | nada é apagado, e nada é dito | OK, com nota em M10 |
| 35 | Duas abas no mesmo atlas local | `initTabLock` / `OVERLAY_TEXT` (`utilities/tab-lock.js`) | A: sim | sim, texto exemplar | OK (ver seção 4) |
| 36 | Sem `BroadcastChannel` / `navigator.locks` | `DEGRADED_NOTICE` (`utilities/tab-lock.js`) | A: sim | sim | OK |
| 37 | Lista local vazia por falha de leitura | `initProjectsPage` catch + `LocalAtlasSection._render` | S: sim | **não**: vazio e falha têm a mesma aparência | **MÉDIO** (M11) |
| 38 | Chegar à Administração ou à Calibração | `adminAudience`, `mayCalibrate` | A: escondido | correto | OK |
| 39 | Ver presença, status de sync, nome do atlas no topo | `presence/online-users.control.js`, `account/sync-status.control.js`, `account/atlas-name.control.js` | A, P: escondidos | correto para A, **errado para P** (o visitante público perde o nome do atlas) | ver A4 |

---

## 3. Achados, por gravidade

### CRÍTICO

#### C1. O visitante de link público recebe o botão "Compartilhar", e ele leva a um beco fechado

**O que acontece hoje.** `_atlasState` (`frontend/src/js/sidebar/tabs/maps.tab.js`) decide pelo
STORE e não pela pessoa, então o visitante anônimo de link público cai em
`AtlasTabState.REMOTE`. A linha correspondente de `ACTIONS_BY_STATE` é
`['open', 'import', 'save', 'save-local', 'share']`, e `_updateActionsVisibility` mostra os cinco.
`MapsTab._handleShare` só verifica `if (!atlasId) return;` e abre `showSharingModal`
(`frontend/src/js/modals/sharing.modal.js`), cujo núcleo, ao falhar a leitura, desenha o estado
`sharing__state--error` com a frase **"Não foi possível carregar o compartilhamento."** e um botão de
tentar de novo que vai falhar sempre, porque o token efêmero de link público não autentica rota de
compartilhamento nenhuma.

**Por que é ruim.** É exatamente o que a rubrica chama de crítico: a UI promete o que o servidor
recusa. Pior, promete a um anônimo o poder de decidir quem vê o atlas de outra pessoa, e a recusa que
ele recebe é genérica ("não foi possível carregar"), que lê como falha temporária e convida à
repetição. E colide com o texto da 5.4, que reserva a imposição ao servidor **justamente porque** a
interface não deveria oferecer o que ele nega.

**Arquivo e símbolo.** `frontend/src/js/sidebar/tabs/maps.tab.js`: `ACTIONS_BY_STATE`,
`_atlasState`, `_updateActionsVisibility`, `_handleShare`.
`frontend/src/js/modals/sharing.modal.core.js`: o estado de erro com `data-testid="sharing-error"`.

**Correção proposta.** Separar o estado REMOTE em dois. O comentário existente defende manter o botão
visível para um Gestor rebaixado no meio da sessão, e esse argumento continua bom; ele simplesmente
não alcança quem **nunca teve conta**. O predicado mínimo é
`sessionContext.isAuthenticated()` em `_updateActionsVisibility` para o id `share` (o
`AccountControl._updateShareVisibility` já faz o equivalente, por `atlasRoleHasAtLeast(..., 'manage')`,
e as duas telas divergem hoje). Vale conferir na mesma passada se `save-local` e `import` deveriam
receber o mesmo tratamento (ver M3).

---

### ALTO

#### A1. Não existe recuperação de senha em lugar nenhum, e a tela de login não diz o que fazer

**O que acontece hoje.** `backend/src/modules/auth/auth.routes.js` monta seis rotas
(`/register` condicional, `/verify-email`, `/resend-verification`, `/login`, `/refresh`, `/logout`,
`/me`) e **nenhuma** de redefinição de senha. `LoginModal._createForm`
(`frontend/src/js/modals/login.modal.js`) não tem link de "esqueci minha senha". A única orientação
escrita no produto inteiro está dentro do corpo de um e-mail: `sendAccountExistsEmail`
(`backend/src/utils/mailer.js`) diz "Se esqueceu a senha, peça a redefinição ao administrador do
EBGeo. Não há redefinição automática por e-mail." Esse e-mail só chega a quem tentar se **cadastrar
de novo** com o mesmo endereço.

**Por que é ruim.** O deslogado que esqueceu a senha não tem ação alcançável nem instrução. O caminho
que o produto de fato quer (pedir ao administrador) só é descoberto por acidente, e o acidente é uma
tentativa de cadastro duplicado, que é justamente o que a mensagem manda não fazer. É um beco sem
saída para o perfil que mais depende de texto na tela.

**Arquivo e símbolo.** `backend/src/modules/auth/auth.routes.js` (ausência);
`frontend/src/js/modals/login.modal.js`, `LoginModal._createForm`;
`backend/src/utils/mailer.js`, `sendAccountExistsEmail`.

**Correção proposta.** Enquanto a decisão de produto for "redefinição é ato de administrador"
(coerente com a 10.6), a correção é de texto e custa uma linha: um `login-modal__secondary` com
"Esqueceu a senha? Peça a redefinição ao administrador do EBGeo." ao lado de "Criar conta". Se o dono
preferir a rota, ela é trabalho de backend, e cai na pergunta P1.

#### A2. Sem backend, o trabalho puramente local fica inalcançável, e a tela não diz que ele está a salvo

**O que acontece hoje.** Nas DUAS páginas que o anônimo usa. Em `initApp`
(`frontend/src/js/index.js`), três tentativas de `applyRuntimeConfig` e, falhando,
`showUnavailableScreen()` seguido de `return` antes de `initServices()`. Em `initProjectsPage`
(`frontend/src/js/projects/projects-page.js`), a mesma coisa antes de `loadLocalAtlases`. A tela
(`frontend/src/js/ui/unavailable-screen.js`, `showUnavailableScreen`) diz "EBGeo indisponível" /
"Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente." e oferece "Tentar
novamente", que reexecuta o mesmo fetch.

**Por que é ruim.** O fail-fast é decisão declarada e não está em discussão aqui. O problema é o que a
tela **não diz**. Uma pessoa com dez atlas locais, para quem o produto anunciou "Nada aqui vai para o
servidor", lê "EBGeo indisponível" e conclui razoavelmente que perdeu tudo. A frase não distingue
"o servidor caiu" de "seus dados sumiram", e o único botão não muda nada. O docblock de
`initProjectsPage` afirma que "a metade local é o produto INTEIRO para um visitante sem conta", e
essa afirmação é falsa em toda queda de rede.

**Arquivo e símbolo.** `frontend/src/js/ui/unavailable-screen.js`, `showUnavailableScreen`;
`frontend/src/js/index.js`, `initApp`; `frontend/src/js/projects/projects-page.js`,
`initProjectsPage`.

**Correção proposta.** Acrescentar uma segunda frase à mensagem, incondicional e honesta: "Os atlas
guardados neste navegador não foram afetados e voltam quando a conexão voltar." Custa nada e remove o
pior da leitura. Se o dono quiser ir além, a pergunta P2 trata de deixar `atlas.html` listar o local
sem `config`.

#### A3. Link público inválido, expirado ou revogado falha em silêncio absoluto

**O que acontece hoje.** `openPublicAtlasFromUrl` (`frontend/src/js/index.js`) envolve tudo num
`try`, e o `catch` faz `console.warn('[boot] public atlas open failed:', error)`,
`retractAtlasClaim()` e `return false`. Nada mais. A cadeia do boot segue para `openAtlasFromUrl`
(sem link, `false`), `enterLocalMapOnBoot` (sem intenção, `false`) e `openAtlasChooserOnBoot` (sem
sessão, retorna). O visitante fica num mapa local genérico, com `?atlasPublico=` ainda na barra de
endereço (nada o remove: `clearAtlasUrl` em `frontend/src/js/deep-link/atlas-link.js` preserva o
parâmetro de propósito), e o F5 repete a falha silenciosa.

**Por que é ruim.** Alguém compartilhou um mapa; a pessoa clicou; ela vê um mapa em branco que não é
o que lhe mandaram, sem uma palavra. Não distingue link revogado, link digitado errado, atlas
excluído e servidor com problema, que são quatro conversas diferentes com quem enviou o link. É o
contraste direto com o irmão dele, `openAtlasFromUrl`, que trata 403, 404 e o resto com três toasts
distintos, e o comentário lá explica por extenso por que a distinção importa.

**Arquivo e símbolo.** `frontend/src/js/index.js`, `openPublicAtlasFromUrl` (ramo `catch`);
compare com `openAtlasFromUrl`, no mesmo arquivo.

**Correção proposta.** Espelhar o vizinho: `showToast` por faixa de status, com um texto que fale a
língua de quem recebeu um link ("Este link de visualização não é mais válido. Peça um novo a quem o
enviou." para 401/403/404; "Não foi possível abrir a visualização agora." para o resto) e
`clearAtlasUrl` estendido a `atlasPublico` **apenas** nesse ramo, para que o F5 não repita.

#### A4. A visita pública não tem nenhum sinal persistente: nem "somente leitura", nem qual atlas é

**O que acontece hoje.** O único anúncio é `showToast('Visualização pública — somente leitura', 'info')`
no fim de `openPublicAtlasFromUrl`, transitório. Depois disso, o que resta é a **ausência** das barras
de ferramentas, por `is-view-only`. `sessionContext.isVisitor()` existe
(`frontend/src/js/store/sync/session-context.js`) e **não tem um único consumidor de interface**: os
dois usos no repositório estão em `frontend/src/js/store/sync/tab-lock-sync-brake.js`. Pior, os três
controles que poderiam identificar o atlas se escondem por `isAuthenticated()`, que é falso para o
visitante: `account/atlas-name.control.js`, `account/sync-status.control.js` e
`presence/online-users.control.js`. O cabeçalho da aba Mapas mostra o nome, mas depende de a pessoa
abrir a barra lateral.

**Por que é ruim.** Cinco segundos depois do toast, o visitante não tem como saber que está vendo um
documento de outra pessoa, em modo restrito, nem qual é. A ausência de uma barra de ferramentas é
indistinguível de "o app está carregando", de "esta versão não desenha" e de um defeito. E é o perfil
que mais precisa do sinal, porque foi o único que chegou por um link e não por uma escolha.

**Arquivo e símbolo.** `frontend/src/js/index.js`, `openPublicAtlasFromUrl`;
`frontend/src/js/store/sync/session-context.js`, `setVisitorSession` e `isVisitor`;
`frontend/src/js/account/atlas-name.control.js`; `frontend/src/js/ui/view-mode.controller.js`.

**Correção proposta.** Dar a `isVisitor()` o consumidor que falta: uma faixa persistente e discreta
(a mesma família visual do `DEGRADED_NOTICE` do tab-lock, que já é banner e não overlay), com o nome
do atlas, a palavra "somente leitura" e um caminho de saída explícito ("Sair da visualização"), já
que hoje a saída existe mas se chama "Abrir". Alternativa mais barata: trocar o gate de
`atlas-name.control.js` de `isAuthenticated()` para `Boolean(syncEngine.atlasId)` e acrescentar o
selo de nível ao lado, reusando `getPermissionLabel` de
`frontend/src/js/projects/permission-levels.js`.

#### A5. O mapa não diz ao anônimo onde o trabalho dele mora

**O que acontece hoje.** No mapa, a única afirmação sobre a natureza local do trabalho é o atributo
`title` de um `<span>`: `chip.title = 'Atlas local, só neste navegador'` em
`MapsTab._refreshAtlasHeader` (`frontend/src/js/sidebar/tabs/maps.tab.js`). O texto visível é a
palavra "Local". Não há nenhuma frase sobre IndexedDB, sobre o trabalho não estar em servidor
nenhum, ou sobre limpar os dados do navegador destruí-lo. A cópia honesta existe, e é boa, mas mora
toda em `atlas.html`: "Atlas guardados neste navegador. Nada aqui vai para o servidor nem é visto por
outras pessoas.", "Fica só neste navegador" (`frontend/src/js/projects/atlas-drive.js`,
`LocalAtlasSection._build` e `LocalAtlasSection._card`).

**Por que é ruim.** `title` não existe em toque, não existe para leitor de tela em vários contextos e
não existe para quem não passa o mouse exatamente ali. O anônimo que entra pela URL nua, desenha uma
tarde inteira e fecha o navegador nunca leu que aquilo não está guardado em lugar nenhum. É a
condição para a perda de trabalho, mesmo que nenhum caminho de código a cause.

**Arquivo e símbolo.** `frontend/src/js/sidebar/tabs/maps.tab.js`, `_refreshAtlasHeader`;
`frontend/src/js/projects/atlas-drive.js`, `LocalAtlasSection._build`.

**Correção proposta.** Levar a frase que já existe para o cabeçalho da aba Mapas quando
`_atlasState()` for `LOCAL_ANON`, como texto visível abaixo do nome do atlas, com a sugestão de ação
que fecha o argumento: "Guardado só neste navegador. Use Exportar para levar uma cópia."

#### A6. O anônimo não descobre pelo mapa que existem conta, atlas de servidor e colaboração

**O que acontece hoje.** No mapa, o único sinal de que existe outro mundo é o botão **Entrar** do
`AccountControl` (`frontend/src/js/account/account.control.js`, `_loginBtn`), que diz apenas
"Entrar", sem tooltip e sem contexto. O texto que de fato explica a proposta existe e é bom, mas está
em `createServerInvite` (`frontend/src/js/projects/atlas-drive.js`): "Entre para abrir os atlas do
servidor, colaborar em tempo real e compartilhar com sua equipe. Os atlas deste computador continuam
funcionando sem conta." Para lê-lo, o visitante precisa abrir a barra lateral, achar a aba Mapas,
reconhecer o botão "Abrir" como uma navegação de página, e depois rolar abaixo da grade de cartões,
porque `initProjectsPage` monta a seção do servidor **depois** de `localSection.mount(body)`.

**Por que é ruim.** O produto tem uma metade colaborativa inteira que o perfil majoritário do primeiro
acesso nunca vê descrita. A tagline do modal de login ("Entre para colaborar nos seus atlas",
`LoginModal._createBrand`) só aparece depois de a pessoa já ter decidido entrar, o que é tarde.

**Arquivo e símbolo.** `frontend/src/js/account/account.control.js`, `_loginBtn` em `onAdd`;
`frontend/src/js/projects/atlas-drive.js`, `createServerInvite`;
`frontend/src/js/projects/projects-page.js`, `initProjectsPage` (a ordem de montagem).

**Correção proposta.** Duas mudanças pequenas e independentes: dar ao `_loginBtn` um `title` com a
promessa em uma frase (o texto de `createServerInvite`, encurtado), e subir `createServerInvite` para
antes da seção local em `initProjectsPage`, ou pelo menos colocá-la na barra superior, já que
`createAppBar` (`frontend/src/js/ui/app-bar.js`) hoje não tem ramo anônimo nenhum.

#### A7. O recurso privado emprestado ao visitante público aparece e não desenha

**O que acontece hoje.** A cláusula 6.3 é vigente: o empréstimo alcança o visitante do link público,
e o payload do atlas o entrega. A cláusula 10.1 é pendente: os bytes do tile de uma camada privada
são servidos fora do alcance do predicado, e o próprio texto do estatuto registra o gêmeo do defeito,
"o acervo privado hoje **não desenha para quem tem direito**, porque o navegador pede o tile sem
credencial". O resultado para este perfil é uma camada listada, ligável, e vazia.

**Por que é ruim.** Não é um achado novo, é um pendente conhecido, e está aqui por uma razão de UX
específica: entre todos os perfis, o visitante de link público é o **único que não tem nenhuma via de
diagnóstico**. Não tem conta, não tem suporte, não tem a quem perguntar além de quem lhe mandou o
link, e a tela não distingue "camada vazia nesta área" de "camada que você não pode carregar".

**Arquivo e símbolo.** [`CONSTITUICAO.md`](CONSTITUICAO.md) 6.3 e 10.1, com a apuração em
[`PENDENCIA-TILE-PRIVADO.md`](PENDENCIA-TILE-PRIVADO.md).

**Correção proposta.** Enquanto 10.1 estiver pendente, a mitigação de interface é detectar o erro de
tile por recurso marcado privado e trocar a camada silenciosamente vazia por um estado nomeado
("Esta camada não pôde ser carregada nesta visualização"). Isso não conserta o acesso, conserta a
mentira. A correção de fundo é a decisão P4.

---

### MÉDIO

#### M1. "Abrir" é a única porta para "Seus atlas", e o rótulo não diz isso

`MapsTab._createActionsGrid` declara `{ id: 'open', label: 'Abrir', title: 'Escolher outro atlas' }`,
e `_handleOpenProject` delega a `AccountControl.openProjectPicker`, que **não** é gateada por sessão.
A porta existe e funciona para o anônimo, o que é bom. O problema é que o rótulo "Abrir" fica
imediatamente ao lado de "Importar", que é um seletor de arquivo, e o docblock do próprio
`_handleOpenProject` registra que aquele botão **era** um seletor de `.ebgeo`. As palavras "Seus
atlas" nunca aparecem no mapa para quem não tem sessão (`_updateProjectsVisibility` esconde o item de
menu). Some-se a isso que o nome do atlas no cabeçalho é um `<input>` de renomear
(`_createAtlasHeader`), inerte ao clique, e o lugar mais natural de clicar não leva a lugar nenhum.
**Correção:** rotular `open` como "Seus atlas" (ou "Trocar de atlas") e manter o `title` atual como
explicação.

#### M2. O aviso de poda da exportação afirma "restritos" para um perfil que não tem restrição nenhuma

`ExportImportService.handleExport` (`frontend/src/js/import_export/export-import.service.js`) mostra
um `showConfirm` intitulado "Este arquivo sai sem os recursos restritos". Para o anônimo,
`isPrivateResource` (`frontend/src/js/store/sync/resource-access.service.js`) nunca devolve `true`,
porque `refreshVisibleResources` jamais rodou; o que de fato é podado é tudo que
`construirResolverDeSaida` (`frontend/src/js/catalog/resource-reference.resolver.js`) classifica como
`UNKNOWN`, e ali `views360` responde `UNKNOWN` sempre, por decisão registrada. Ou seja: o visitante
que nunca tocou em nada restrito recebe um aviso de perda por restrição, listando as orientações 360
e os slides com foto. O relatório carrega o veredito (`anotar` grava o `RefVerdict`, e o próprio
docblock do enum diz que "perdi porque é privado" e "perdi porque não sei o que é" são notícias
diferentes), e `descreverPerdas` não o usa. **Correção:** separar as duas listas no texto, com a
segunda dita como é ("o 360 não viaja em `.ebgeo`"), o que também melhora o aviso para todos os
outros perfis.

#### M3. "Importar" é oferecido ao visitante de link público e recusado operação a operação

`ACTIONS_BY_STATE[AtlasTabState.REMOTE]` inclui `import`, então o visitante público vê o botão,
escolhe um arquivo e o import roda contra um store remoto em que ele é VIEWER. Cada op é barrada por
`checkPermission` dentro das operações de store, e o usuário recebe o toast "Acesso somente leitura",
debounced, uma vez. Nada explica que o arquivo escolhido não entrou. Vale registrar o achado
estrutural que está por trás: **`GuardAction.IMPORT_DATA` não tem um único consumidor** em
`frontend/src/js/`, exatamente a forma de defeito que o comentário de `UPDATE_MAP` no mesmo arquivo
descreve. **Correção:** esconder `import` no estado REMOTE quando não houver sessão (mesmo predicado
de C1), ou, melhor, consumir `IMPORT_DATA` no ponto de entrada do import e recusar antes do seletor de
arquivo, com uma frase que diga por quê.

#### M4. Excluir o único atlas local encena uma confirmação destrutiva para uma recusa já conhecida

O visitante de primeira viagem tem exatamente um atlas (`bootstrapEntry` cria
`DEFAULT_LOCAL_ATLAS_NAME`). `LocalAtlasSection._openMenu` oferece "Excluir" sem consultar
`this._atlases.length`; o `showConfirm` de `deleteLocalAtlasFromPage` mostra o texto vermelho
irreversível ("Os mapas, feições e imagens deste atlas serão apagados deste navegador... Não há como
desfazer."); e só depois `deleteLocalAtlas` (`frontend/src/js/store/local-atlas.api.js`) devolve
`LocalAtlasError.LAST_ATLAS`: "Este é o seu único atlas local e não pode ser excluído. Crie outro
antes de excluí-lo." A recusa é boa; o caminho até ela é que assusta sem motivo. **Correção:** omitir
ou desabilitar o item quando `this._atlases.length === 1`, com o motivo no `title`.

#### M5. O teto de dez atlas locais só se anuncia depois de o usuário digitar o nome

`LocalAtlasSection._createTile` deliberadamente não desabilita a peça no teto, e o argumento escrito
lá é bom ("um botão morto não explica nada"). O custo é que o visitante clica, digita um nome no
`PromptModal` e só então recebe "Limite de 10 atlas locais atingido. Exclua um atlas antes de criar
outro." O contador `1 de 10` existe, é pequeno e nunca é explicado. **Correção:** manter o botão vivo
e antecipar a informação, dando ao contador um `title` e trocando o rótulo da peça no teto para algo
como "Limite atingido", mantendo a mensagem completa no clique.

#### M6. A recusa do comentário manda o anônimo fazer o que a interface não lhe oferece

`CommentOverlay.togglePlacement` (`frontend/src/js/comment_tool/comment-overlay.js`) escolhe entre
três frases, e o comentário do código explica corretamente por que três. A frase do caso local é
"Comentários existem só em atlas do servidor. Envie este atlas ao servidor para comentar." Para o
anônimo, "Enviar ao servidor" é justamente a ação escondida: o id `save-server` não está em
`ACTIONS_BY_STATE[LOCAL_ANON]` e `AccountControl._updateSaveToServerVisibility` exige sessão. O
ramo que diria "Entre na sua conta" só é alcançado quando já se está num atlas de servidor.
**Correção:** um quarto ramo, ou uma condicional na frase existente: sem sessão, "Comentários existem
só em atlas do servidor. Entre na sua conta e envie este atlas ao servidor para comentar."

#### M7. Não há "Criar conta" em `atlas.html`, mesmo onde o auto-cadastro está ligado

`openLoginDialog` (`frontend/src/js/projects/projects-page.js`) chama
`showLoginModal({ onSubmit })` sem `onRegister`, e `LoginModal._createForm` só constrói o link
"Não tem conta? Criar conta" quando o handler existe. O único sítio que lê
`config.features.self_registration` e liga o cadastro é `AccountControl._handleLogin`. Consequência:
o visitante que seguiu o convite "No servidor / Entrar" precisa voltar ao mapa para se cadastrar, que
é exatamente a ida e volta que o docblock desta página diz existir para remover. **Correção:**
repetir as três linhas do gate em `openLoginDialog`, ou extrair o par (ler a flag, montar
`onRegister`) para um helper compartilhado, já que a duplicação é o que fez as duas telas divergirem.

#### M8. O cadastro exige a Organização Militar sem dizer que ela é lotação e não autoriza nada

`SignupModal._createForm` (`frontend/src/js/modals/signup.modal.js`) monta "Organização Militar" como
campo obrigatório, com `placeholder: 'Selecione a organização militar'` e nenhuma nota. A cláusula
1.5 diz que a organização declarada é lotação e não autoriza nada, e a 10.5 registra que a lotação é
auto-declarada e que ninguém a verifica. **Correção:** uma linha de ajuda sob o campo, no vocabulário
do estatuto: "Sua lotação, para identificação. Não define o que você pode acessar."

#### M9. A confirmação de e-mail funde quatro desfechos numa frase só

`handleEmailVerificationFromUrl` (`frontend/src/js/index.js`) tem um `catch` único que mostra
"Não foi possível confirmar o e-mail. O link pode ter expirado." O backend distingue os casos:
`verifyEmail` (`backend/src/modules/auth/auth.service.js`) lança "Token de verificação inválido."
(desconhecido ou já consumido) e "Token de verificação expirado." Quem já confirmou e clicou no link
de novo lê que o link expirou, o que é falso e assustador. E o sucesso diz "E-mail confirmado! Faça
login para entrar." sem abrir o modal de login, deixando a próxima ação por conta da pessoa.
**Correção:** propagar a mensagem do servidor (`error?.message`) com um fallback, como
`sharingErrorMessage` já faz noutro lugar do repositório, e chamar
`getControl('account')?.requestLogin?.()` no ramo de sucesso.

#### M10. Entrar numa conta não diz nada sobre o trabalho local que ficou para trás

Este é o desfecho **correto** do ponto de vista de dados: `syncEngine.login`
(`frontend/src/js/store/sync/sync-engine.js`) não toca no store, e `AccountControl._handleLogin`
segue para `openProjectPicker()`, que navega para `atlas.html`. Nada é apagado. O atrito é que o
visitante que desenhou uma tarde inteira e entrou numa conta é levado a uma tela de seleção de atlas
e não tem como saber, naquele instante, que o desenho continua ali. Ele está, na seção "Neste
computador", mas o usuário precisa reconhecê-lo entre os cartões. **Correção:** ao chegar em
`atlas.html` vindo de um login, destacar (ou apenas ordenar primeiro) o atlas local que estava
montado, ou um toast de uma linha: "Seu atlas local continua aqui, em 'Neste computador'."

#### M11. Em `atlas.html`, falha ao ler o registro local é indistinguível de "você não tem nada"

`initProjectsPage` captura a falha de `loadLocalAtlases`, mostra o toast transitório
"Não foi possível ler os atlas deste computador." e segue com `{ atlases: [], currentId: null }`.
`LocalAtlasSection._render` não tem ramo de estado vazio nem de erro: desenha zero cartões, a peça
"Novo atlas local" e o contador `0 de 10`. Passados os segundos do toast, a tela afirma, sem
ressalva, que a pessoa não tem nada, e a convida a criar um atlas por cima de um registro que a
página acabou de não conseguir ler. Vale notar que o estado honesto de um visitante novo **nunca** é
a grade vazia (`bootstrapEntry` garante um cartão), então a grade vazia é literalmente o estado de
falha. **Correção:** um ramo de erro em `_render`, com a frase e um botão de tentar de novo, no lugar
da peça de criação.

---

### BAIXO

- **B1. Crases literais em texto de usuário.** O `showConfirm` de `handleExport`
  (`frontend/src/js/import_export/export-import.service.js`) contém "Um \`.ebgeo\` circula por e-mail
  e pendrive"; `ConfirmModal` renderiza a mensagem como texto puro separado por `\n`, então as crases
  aparecem na tela. Convenção de código vazando para a interface.
- **B2. A confirmação de exclusão de atlas local fala de servidor a quem não tem conta.** O texto de
  `deleteLocalAtlasFromPage` diz "junto com qualquer trabalho ainda não enviado ao servidor", o que
  para o anônimo descreve um caminho que ele nunca teve.
- **B3. "Configurações" do atlas promete compartilhamento num atlas local.** O rodapé do painel de
  aparência (`frontend/src/js/modals/atlas-settings.modal.js`) diz "Vale para este atlas, neste
  computador e para quem o compartilha."; a segunda metade não significa nada para o perfil.
- **B4. `?aviso=` é ecoado sem checar sessão.** `explainArrivalFromUrl`
  (`frontend/src/js/projects/projects-page.js`) traduz `excluido-por-outro` para "Este atlas foi
  excluído pelo proprietário." para qualquer visitante que chegue com o parâmetro. Só alcançável por
  URL montada à mão; custo de correção é uma condição.
- **B5. `?verify=` só é consumido depois do boot inteiro do mapa.** `handleEmailVerificationFromUrl`
  roda depois de `createControls` e do `bootRendered`, então quem clica no link de confirmação espera
  o MapLibre inteiro carregar antes de ler uma frase.
- **B6. O `.ebgeo` não aparece nas abas chamadas Importar e Exportar.** `IMPORT_FORMATS`
  (`frontend/src/js/sidebar/tabs/import.tab.js`) lista GeoJSON, Shapefile, KML/KMZ, GPX e CSV, e a
  aba de exportar oferece PDF, Garmin, KMZ e imagem. O formato próprio do produto só existe na aba
  Mapas e no arrastar-e-soltar.
- **B7. O catálogo vazio nunca diz que entrar o aumenta.** `createCatalogGrid`
  (`frontend/src/js/catalog/components/catalog-grid.js`) mostra "Nenhum item encontrado" para todos os
  casos. Não mostrar recurso privado é correto por sigilo; não mencionar que existe outro catálogo é
  a mesma perda de descoberta do A6.
- **B8. Um JSDoc contradiz o código na direção que faz alguém "consertar" o certo.** O bloco de
  `acquireTabLock` (`frontend/src/js/utilities/tab-lock.js`) diz que "the public-link open in
  `index.js` is the one that still asks without it [uma testemunha]"; `openPublicAtlasFromUrl` passa
  `witness: remoteMountWitness(atlas.id)` desde então.

---

## 4. O que está BOM e não deve ser mexido

1. **A separação entre esvaziar o atlas montado e destruir namespaces remotos.** `clearAllDataStore`
   e `discardRemoteAtlasNamespaces` (`frontend/src/js/store/store.js`) documentam por extenso por que
   a varredura deixou de ser efeito colateral de um wipe, e o caso que motivou a mudança é
   exatamente o deste perfil: o visitante de link público destruía o namespace que acabara de
   registrar. Hoje o trabalho local do anônimo não é alcançado por caminho nenhum de sessão.
2. **A ordem de `openPublicAtlasFromUrl`.** Resolver, reivindicar o tab-lock com testemunha,
   `activateRemoteAtlas`, e só então `clearAllDataStore({ markLocal: false })`. É o que garante que o
   wipe cai no namespace público e nunca no slot local, e cada passo carrega o comentário do defeito
   que ele fecha.
3. **Os textos do tab-lock.** `OVERLAY_TEXT`, `TEARDOWN_OVERLAY`,
   `TEARDOWN_OVERLAY_LOCAL_DELETED` e `DEGRADED_NOTICE` (`frontend/src/js/utilities/tab-lock.js`) são
   o melhor conjunto de mensagens do repositório: cada estado tem texto próprio, cada um diz o que
   custa a ação oferecida, e o caso degradado é banner e não overlay porque o lock falha aberto. Não
   unifique nada disso.
4. **O resgate de trabalho não sincronizado e as duas mensagens de falha.**
   `preserveUnsyncedWorkAsLocal`, `failedRescueKeepsNamespace` e o par de toasts em
   `AccountControl._handleLogout` (`frontend/src/js/account/account.control.js`): a releitura do
   registro **do disco** antes de declarar sucesso, e a recusa em mostrar a mensagem otimista quando
   o resgate falhou, são precisamente a disciplina que o resto do relatório cobra.
5. **`store-error-listener.js` nunca vaza o motivo técnico.** O `reason` de `checkPermission` é uma
   frase de desenvolvedor ("Permissão insuficiente: CREATE_FEATURE requer edit"), e o ouvinte a
   substitui por "Acesso somente leitura, você não pode editar este projeto." ou pela mensagem
   explícita do bloqueio, com debounce por tipo.
6. **`CommentOverlay.togglePlacement` nomeia o motivo real entre três.** O comentário no código diz
   por quê, e a razão vale como princípio para o resto do produto. (O ajuste de M6 é uma quarta
   frase, não uma revisão do desenho.)
7. **A cópia da seção local em `atlas.html`.** "Atlas guardados neste navegador. Nada aqui vai para o
   servidor nem é visto por outras pessoas.", "Fica só neste navegador" e o convite
   `createServerInvite`, que termina em "Os atlas deste computador continuam funcionando sem conta."
   É o texto certo; os achados A5 e A6 pedem que ele apareça em mais lugares, não que mude.
8. **O gate do cadastro por `config.features.self_registration`.** `AccountControl._handleLogin` só
   monta "Criar conta" onde a rota está montada (`backend/src/modules/auth/auth.routes.js` monta
   `/register` dentro de `if (config.security.allowSelfRegistration)`), evitando um 404 sem saída.
   M7 pede que `atlas.html` faça o mesmo, não que este afrouxe.
9. **A resposta uniforme do cadastro e o e-mail de conta existente.** `register`
   (`backend/src/modules/auth/auth.service.js`) devolve o mesmo 201 nos dois desfechos, com o bcrypt
   computado antes do ramo para fechar o oráculo por tempo, e `sendAccountExistsEmail` é honesto ao
   dizer que não há redefinição automática. O texto do `showConfirm` de
   `AccountControl._handleRegister` acompanha a ambiguidade em vez de fingir certeza.
10. **A confirmação da poda de saída.** Contar tudo, nomear no máximo três, nunca mostrar id cru, e
    ter um "Cancelar" que aborta antes do trabalho irreversível. M2 pede a distinção entre privado e
    desconhecido; o resto está certo.
11. **A exclusão de atlas local relata três desfechos, inclusive o meio-termo.** `deleteNotice`
    (`frontend/src/js/projects/local-atlas-notices.js`) trata `blockedDatabases` com uma instrução
    executável em vez de um sucesso falso.
12. **`ViewModeController`** usar classe no `body` em vez do sistema de perfis, com o motivo escrito,
    e cair para leitura sem que o usuário precise entender por quê.

---

## 5. Perguntas em aberto que só o dono decide

**P1. Recuperação de senha: rota ou frase?**
Não há cláusula na constituição sobre isso, e o backend não tem a rota. O e-mail de conta existente
já declara a política de fato ("peça a redefinição ao administrador"), coerente com a 10.6, que
transformou o desbloqueio de conta pendente em ato de administrador. Duas saídas: (a) assumir a
política e escrevê-la na tela de login, custo de uma linha; (b) implementar redefinição por e-mail,
que reabre a discussão de relay de correio que já trava a 1.5. Se for (a), vale virar cláusula, para
que a próxima sessão não implemente (b) por achar que era esquecimento.

**P2. Sem backend, o anônimo deve alcançar os atlas locais?**
Hoje não alcança em nenhuma das duas páginas, e isso é consequência direta do fail-fast, que é
decisão declarada. A pergunta é se a metade local merece exceção em `atlas.html`, que não monta store
do mapa e cuja seção local não depende de `config` para desenhar cartões. Abrir a exceção contradiz
"servidor não é opcional"; não abrir mantém a contradição entre o docblock de `initProjectsPage` e o
comportamento. Independente da resposta, a correção de texto do A2 vale.

**P3. O visitante de link público deve poder sair da visita, e como se chama isso?**
A saída existe (o botão "Abrir" leva a `atlas.html`, que funciona anônima), mas não se anuncia como
saída. Decidir se a faixa persistente do A4 leva um "Sair da visualização" explícito, e se sair
significa voltar ao último atlas local ou a "Seus atlas".

**P4. Prioridade da 10.1 diante deste perfil.**
A pendência do tile privado degrada mais o visitante de link público do que qualquer outro perfil,
porque ele não tem via de diagnóstico. Vale saber se isso muda a prioridade da decisão registrada em
[`PENDENCIA-TILE-PRIVADO.md`](PENDENCIA-TILE-PRIVADO.md), ou se a mitigação de interface do A7 é
suficiente por ora.

**P5. Quanto do convite ao servidor deve aparecer no mapa?**
O A6 propõe subir o texto de `createServerInvite`. Há uma tensão de produto real: o mapa é o produto
de quem não entrou, e encher a tela de convite contradiz isso. A pergunta é a dose, e a resposta
razoável parece ser um `title` no "Entrar" mais a reordenação em `atlas.html`, sem faixa no mapa.

**P6. O teto de dez atlas locais deve ser visível antes da recusa?**
O comentário de `_createTile` defende a recusa explicada sobre o botão morto, e o argumento é bom. A
pergunta é se o **contador** deve ganhar voz antes disso, ou se o teto deve simplesmente subir, já
que a razão registrada é o custo de dez bancos IndexedDB por slot.

**P7. A divergência entre as duas telas de compartilhar é intencional?**
`AccountControl._updateShareVisibility` gateia por `atlasRoleHasAtLeast(sessionContext.role, 'manage')`
e `MapsTab` não gateia por papel nenhum, com um comentário defendendo a escolha. Independente do C1
(que é sobre o anônimo, e não é opinável), as duas telas oferecem coisas diferentes ao mesmo usuário,
e vale decidir qual das duas está certa.
