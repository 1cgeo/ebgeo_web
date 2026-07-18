# Sessão, boot e ciclo de vida da conexão

A ordem de boot é config fail-fast → restaurar sessão → boot guard do store → reconectar o último atlas, com a URL como fonte de verdade do que abrir, sessão resiliente a F5 e expiração por inatividade de 30 min.

## A ordem do boot (e por que ela é essa)

Tudo acontece em `initApp()` (`src/js/index.js:42`), sequencialmente. A ordem não é estética, cada passo depende do anterior:

1. **Captura da URL antes de qualquer `await`** (`index.js:48-49`). `bootPublicLink` e `bootAtlasLink` são lidos na primeiríssima linha porque `initAtlasUrlSync()` remove `?atlas` da barra de endereço para um visitante anônimo, e o boot do store emite `MAP_LOCK_CHANGED` cedo. Ler a URL mais tarde perde o deep link e o modal de login nunca abre. **Armadilha real**: qualquer código novo que leia `location.search` no roteador de boot está lendo tarde demais.
2. **Trace bridge** (`index.js:55-60`), gated e fail-safe, ver [[syncledger]].
3. **Config, fail-fast** (`index.js:73-86`): `applyRuntimeConfig` até 3 tentativas com 1 s de intervalo; se nenhuma aplicar, `showUnavailableScreen()` e `return`. **Não existe fallback estático**, o `config.js` embarcado é só o *shape* que o backend hidrata. Ver [[config-dinamico]] e [[config-runtime-urls-relativas]].
4. **Serviços** (`initServices()`, `index.js:92`) e **`initAtlasUrlSync()`** (`index.js:97`), este último ligado cedo de propósito para que toda forma de abrir atlas reflita na URL sem que nenhum caminho precise lembrar de escrevê-la.
5. **Restauração de sessão** (`restoreSessionFromStorage()`, `index.js:104` / `index.js:250-263`). **Precisa rodar antes do boot do store**: o boot guard consulta `sessionContext.isAuthenticated()` e, se rodasse antes, descartaria o atlas remoto em cache de um usuário legitimamente logado.
6. **Mapa + controles** (`index.js:107-120`), depois `setupCleanupHandlers`, `initTabLock()` (aba única via BroadcastChannel, `utilities/tab-lock.js`).
7. **Guardas de sessão** (`index.js:131-134`): `new IdleTimeoutController().init()` e `apiClient.setAuthLostHandler(...)`. Vêm **depois** dos controles porque ambos chamam `getControl('account')`.
8. **Roteador de boot** (`index.js:141-160`).

## Roteador de boot: precedência

Ordem literal em `index.js:141-160`:

1. `?verify=<token>` (confirmação de e-mail), anônimo e one-shot; consome o token, mostra toast e **remove o parâmetro da URL** para que um F5 não retente um token já queimado (`index.js:203-218`).
2. Barreira de serialização: `await Promise.race([bootRendered, timeout 15 s])` + `await statePromise` (`index.js:156-157`). Isso existe para impedir que o `clearAllDataStore()` de uma abertura remota se intercale com o handler de `load` do mapa (splash travada em deep link logado) e com o init do store (mapa "Principal" fantasma como 3º mapa no F5). O `race` evita deadlock caso o evento `load` nunca dispare. É espera **só de IndexedDB**, nada de rede.
3. `?atlasPublico=<link>` → visitante público anônimo (`index.js:226-241`), ver [[link-publico]].
4. `?atlas=<uuid>[&map=<uuid>]` → abre o atlas (`index.js:170-195`).
5. Nada disso → `openAtlasChooserOnBoot()` (`index.js:272-285`).

O hash `#view=3d` / `#view=360` (`deep-link/deep-link.js`) é ortogonal aos query params e é tratado antes, no caminho de load do mapa.

> **Nota histórica.** guia *visao-e-principios* (absorvido):167` (passo 4) e guia *ui-ux-ebgeo* (absorvido) §2 ("O boot não passa pelo Drive: F5 reconecta o último atlas automaticamente") dizem que o boot reconecta o último atlas remoto via `reconnectLastAtlas`. O código não tem mais essa função: `src/js/index.js:160` chama `openAtlasChooserOnBoot()`, que em `index.js:279-281` **descarta** o dado remoto órfão (`clearAllDataStore()` quando a origem é `remote`) e **abre o Atlas Drive** para o usuário escolher. guia *arquitetura-sync* (absorvido):240` e `.claude/rules/architecture.md:138` repetem a versão antiga.

O motivo da mudança está no próprio comentário do código (`index.js:275-278`): a barra de endereço é a fonte de verdade. `/?atlas=<uuid>` carrega aquele atlas; `/` puro deve **deixar escolher**, não reabrir silenciosamente o último.

## A URL como fonte de verdade

Duas peças, deliberadamente separadas:

- **`deep-link/atlas-link.js`** — parse/build puros. `parseAtlasParams` exige UUID no `atlas` (id inválido ⇒ `null`); um `map` inválido é **descartado sem derrubar o atlas** (`atlas-link.js:26-33`). `buildAtlasSearch` (`atlas-link.js:46-62`) tem duas assimetrias que parecem bug e não são: (a) `mapId` falsy **preserva** o `?map=` existente, porque o id do mapa corrente resolve para um *nome* antes do map-resolver popular, e não se pode rebaixar um `?map=<uuid>` bom; (b) ao **limpar** (logout), só `atlas`/`map` saem, `atlasPublico` fica, senão o visitante público perderia o próprio link.
- **`deep-link/atlas-url-sync.js`** — reconciliação **reativa** em `CONNECTION_STATE_CHANGED`, `MAP_LOCK_CHANGED` e `SESSION_CHANGED` (`atlas-url-sync.js:45-55`). Autenticado + `syncEngine.atlasId` ⇒ escreve; deslogado ⇒ limpa; **autenticado mas ainda não conectado ⇒ não toca na URL**, para que um `?atlas=` pendente sobreviva à janela de boot e uma queda de rede transitória mantenha o atlas pretendido na URL.

Sempre `history.replaceState`, nunca `pushState` (`atlas-link.js:77-83`): a URL é um espelho do estado, não navegação, e não há handler de `popstate`. `pushState` a cada troca de mapa só entupiria o histórico e prenderia o botão Voltar.

**Link pendente**: um `?atlas=` encontrado deslogado vai para `setPendingAtlasLink` (módulo-escopo, `atlas-link.js:100-112`) e o account control chama `consumePendingAtlasLink()` logo após o login (`account/account.control.js:701-716`), levando o usuário direto ao atlas pedido em vez do seletor. É one-shot e vive só na sessão da página, o que basta porque boot e login não têm reload entre si.

## Restauração de sessão e o boot guard

`restoreSessionFromStorage` (`index.js:250-263`) faz `apiClient.loadStoredTokens()` e valida com `getMe()`. Tokens ficam em `localStorage['ebgeo_auth']` (`api-client.js:41-42`, `api-client.js:143-176`); um 401 no `getMe` dispara o refresh transparente (`api-client.js:231-233`), ver [[refresh-token-rotacao]] e [[autenticacao-jwt]]. **Qualquer** falha cai no `catch` que apaga os tokens e deixa o caminho anônimo intacto. Requisições de boot (config + `getMe`) têm timeout de 8 s (`api-client.js:49`); pull de snapshot e push de operações são **intencionalmente sem timeout**, para não abortar transferência grande em rede ruim.

O token do link público é **efêmero e não persistido** (`setEphemeralToken`, `api-client.js:117-120`): o link na URL é re-resolvido a cada boot.

**Boot guard** — `enforceLocalStoreWhenLoggedOut()` roda como primeira linha de `initializeWithLastActiveMap()` (`store/store.js:137-156`, chamado em `store.js:164`). Se a origem é `remote` **e** ninguém está autenticado, ele limpa todos os side-stores (mapas, imagens, settings, grupos, camadas, cesium3d, streetview360, briefings, comentários, atlas), esvazia a `operationQueue` e volta a origem para `local`. Para o usuário local a condição é falsa e a função é **no-op**, essa é a garantia aditiva. Ver [[dominio-local-vs-remoto]] e [[dominio-local-vs-remoto]].

A origem default é `local` e **ausente** para todo usuário pré-existente (`store/store-origin.js:31`, `store-origin.js:44-54`), então a máquina remota nunca engaja sem um connect explícito.

## Abrir um atlas remoto: ordem obrigatória

`account/open-atlas.service.js:41-81`, usado pelo deep link e pelo resume pós-login (o picker tem wrapper próprio, mesmos passos):

1. Se a origem é local **e** há feições, confirma antes de destruir (`open-atlas.service.js:45-51`), oferecendo baixar `.ebgeo` (ver [[formato-ebgeo-roundtrip]]).
2. `stopAutoFlush()` + `syncEngine.disconnect()` se já havia atlas: **um socket por atlas**, o servidor não tem "trocar" (ver [[canal-collab-websocket]]).
3. `clearAllDataStore()`.
4. `markStoreRemote(atlasId)` **antes** do connect. É intenção durável: se a aba morrer no meio do pull, o boot guard vê `remote` e descarta o parcial em vez de rotulá-lo como atlas local permanente.
5. `connect(atlasId, { initialPull: true })` + `activateAtlasInitialMap(mapId)`. Ver [[snapshot-e-pull-incremental]].
6. **No catch**: `markStoreLocal()` e re-throw. Sem isso, um 403/404 deixaria a origem apontando para um atlas morto e o boot ficaria retentando a cada F5.
7. `BaseLayerControl.switchMap(false)` **fora** do try, para que um erro de render não reverta a origem de um atlas aberto com sucesso. Esse passo existe porque o caminho de abertura define o mapa corrente mas nunca rodou `setupMapFeatures`, e os rasters de símbolo militar davam 404 intermitente.
8. `startAutoFlush()`, ver [[fila-operacoes-outbound]].

Erros são traduzidos no chamador: 403 "Você não tem acesso a este projeto", 404 "Projeto não encontrado" (`index.js:186-194`). Ver [[permissoes-atlas]] e [[permissoes-atlas]].

## Expiração por inatividade

`session/idle-timeout.controller.js`. Só roda **autenticado**, ligado/desligado por `SESSION_CHANGED` (`idle-timeout.controller.js:61-64`), então o usuário anônimo nunca é incomodado.

- Janela padrão **30 min** (`DEFAULT_IDLE_MINUTES = 30`, `idle-timeout.controller.js:22`), configurável por `config.features.idle_timeout_minutes`; aviso padrão **60 s** (`idle_warning_seconds`). Valores não finitos ou ≤ 0 caem no default (`idle-timeout.controller.js:28-37`).
- Atividade = `mousedown`, `keydown`, `wheel`, `touchstart`, `pointermove`, com throttle de 1 s (`idle-timeout.controller.js:24-25`, `:97-102`). `pointermove` sem throttle mataria a performance.
- O overlay de aviso oferece "Continuar conectado" / "Sair agora"; **Esc equivale a continuar** (`idle-timeout.controller.js:174`). Por isso `project-picker.modal.js:133` e `admin-panel.js:163` excluem `.idle-warning__overlay` dos próprios handlers de Escape: quando o aviso está no ar, ele é o único a reagir.
- Na expiração, `account.handleSessionLost('Sua sessão expirou por inatividade. Entre novamente.')`.

O mesmo destino serve para um 401 terminal: `apiClient` chama `_notifyAuthLost()` **no máximo uma vez por sessão** (`api-client.js:87-95`, disparado em `api-client.js:305` quando o refresh falha de vez), e `index.js:132-134` liga isso a `handleSessionLost`. `handleSessionLost` (`account.control.js:865-881`) tem guarda de reentrância (`_sessionLostHandling`) e não empilha um segundo modal de login, porque idle e 401 podem chegar quase juntos.

## Logout e desconexão

`_handleLogout` (`account.control.js:840-858`): `stopAutoFlush()` → `syncEngine.logoutAndDisconnect()` → `presenceStore.clear()` → `clearAllDataStore()` → re-render. O `auth.logout` do servidor revoga **apenas** o refresh token; fechar o socket e desmontar a presença é responsabilidade do cliente (ver [[presenca-colaborativa]]). O dado remoto **não sobrevive** ao logout, quem quiser guardá-lo baixa o `.ebgeo` antes.

## Armadilhas para não repetir

- Ler `location.search` depois do primeiro `await` do boot: o link já foi removido.
- Marcar `remote` só depois do connect: aba morta no meio do pull vira atlas local corrompido.
- Não reverter para `local` quando o connect falha: F5 em loop contra um atlas inacessível.
- Abrir atlas sem `disconnect()` antes: dois sockets, um por atlas, e vazamento entre atlas.
- Ligar `IdleTimeoutController` antes dos controles: `getControl('account')` volta `undefined` e a expiração vira no-op silencioso.
- Escrever `?map=` com um valor não-UUID: `atlas-url-sync.js:35` filtra com `isValidUUID` justamente para não expor nome interno nem rebaixar um link bom.
- Supor fallback de config: não existe, o boot morre na tela "EBGeo indisponível".

## Fontes

- guia *visao-e-principios* (absorvido): §2 dois domínios de dados, P1/P7/P12, §4 ciclo de vida (boot, login, logout, F5), §6 isolamento entre atlas, exceção deliberada do bootstrap de config.
- guia *ui-ux-ebgeo* (absorvido): §1 três estados de sessão, URL como fonte de verdade, idle timeout de 30 min com aviso; §2 Atlas Drive (a afirmação de que o boot reconecta sozinho está desatualizada).
- guia *10-config* (absorvido): `GET /api/v1/config` público, envelope `{ data }`, contrato congelado das 12 chaves, tratamento de erro (500 ⇒ falha de boot, 3 tentativas, sem fallback).
- guia *00-visao-geral* (absorvido): constraint do backend aditivo, JWT access + refresh de emissor único, config dinâmico como parte do backend único.
- Código: `src/js/index.js`, `src/js/deep-link/atlas-link.js`, `src/js/deep-link/atlas-url-sync.js`, `src/js/account/open-atlas.service.js`, `src/js/account/account.control.js`, `src/js/session/idle-timeout.controller.js`, `src/js/store/sync/api-client.js`, `src/js/store/store.js`, `src/js/store/store-origin.js`.
