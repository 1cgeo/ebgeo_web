# Sessão, boot e ciclo de vida da conexão

A ordem de boot em `frontend/src/js/index.js` está comentada fase a fase no próprio código; esta página guarda só o que o código não consegue dizer: a documentação desatualizada que ainda contradiz o boot, e os invariantes que quebram de longe.

## O boot NÃO reconecta o último atlas

`openAtlasChooserOnBoot()` (`frontend/src/js/index.js`) **descarta** dado remoto órfão e manda escolher. A barra de endereço é a fonte de verdade: `/?atlas=<uuid>` carrega aquele atlas; `/` puro deve **deixar escolher**, não reabrir silenciosamente o último. O marcador de origem serve para descartar resíduo, não para reabrir. Ver [[dominio-local-vs-remoto]], que registra a armadilha correlata (`atlasId` é persistido e **nunca lido**).

## Escolher projeto acontece ANTES de existir mapa (2026-08-05)

O seletor virou página (`projetos.html`), e com isso o boot ganhou uma fase **-1**, antes de tudo: `shouldRouteToProjects()` decide se esta aba é do mapa ou da escolha, e um visitante logado numa `/` pura é redirecionado **antes de `createMap()`**. Três consequências que não se leem numa só função:

- **A decisão lê o token sem validar** (`apiClient.hasStoredTokens()`). Validar custaria um round trip antes de qualquer pixel. Quem valida é o destino: `projetos.html` chama `getMe`, e no fracasso **limpa os tokens** e devolve para `/`. É esse `clearTokens` que impede o pingue-pongue entre os dois redirecionamentos: remova-o e o boot entra em laço.
- **A escapatória é `sessionStorage`, não URL** (`deep-link/local-intent.js`). "Mapa local" é escolha desta aba e desta sessão; na URL ela viajaria em todo link compartilhado e imporia a decisão de um a quem abrisse. É limpa no logout, senão a próxima identidade herda a opção de sair do seletor.
- **Sem sessão não há login na página de projetos**: quem chega deslogado é mandado para o mapa, que é onde "Entrar" mora. A página não duplica autenticação.

O `openAtlasChooserOnBoot()` continua existindo para o **fallthrough**: um `?atlas=` que falhou ao abrir, ou uma aba "Mapa local" cuja sessão sobreviveu à intenção. Ele agora navega em vez de abrir modal.

## Abrir atlas tem UM pipeline, e o aviso pertence ao ato

`openRemoteAtlas` (`account/open-atlas.service.js`) é o único lugar que abre atlas remoto. Até 2026-08-05 o `AccountControl` tinha uma segunda cópia do pipeline inteiro (disconnect → wipe → markRemote → connect → activate → switchMap → auto-flush) em dois ramos duplicados e, pior, disparava o aviso de "isto vai substituir seus dados locais" quando o **seletor abria**, ou seja, logo depois de todo login, avisando sobre uma substituição que talvez nunca acontecesse. O aviso pertence ao ato, não à navegação.

A pergunta hoje tem **três** respostas (`showChoice`, em `modals/confirm.modal.js`): Cancelar / Salvar e continuar / Descartar e abrir. O motivo de não ser um confirm de dois botões vale além deste caso: quando a terceira opção é "faça, mas preserve o que é meu", um confirm binário **esconde** exatamente a que a pessoa quer, e ela acaba clicando na destrutiva ou desistindo. Dispensar o diálogo (Esc/backdrop) resolve `null` e equivale a Cancelar; Enter é inerte de propósito, porque com três ações não existe "a" confirmação e um Enter cego descartaria trabalho.

A armadilha sobrevive à correção: quem planeja a partir de uma fonte que promete reconexão automática propõe código que duplica o Atlas Drive. O símbolo que essas fontes citavam, `reconnectLastAtlas`, tem **zero ocorrências** em `frontend/src/` e nunca teve. Confirme no código antes de aceitar qualquer afirmação de reconexão no boot.

Isto foi uma `[!CONTRADICAO]` pendente até 2026-07-25, com quatro fontes afirmando o contrário. Três eram guias absorvidos e morreram com a absorção; a quarta era `.claude/rules/architecture.md`, a perigosa, por ser carregada como instrução em toda sessão de agente, e foi corrigida na mesma data. Repare por que o guarda não pegou: `frontend/tests/unit/docs-integridade.test.js` valida o **caminho** citado, nunca o **símbolo**, então uma citação a uma função que não existe atravessa o teste em silêncio.

## Invariantes que quebram de longe

O código comenta cada decisão no ponto em que ela acontece. O que ele não comenta é o que quebra **em outro arquivo**:

- **Todo modal novo com handler de Escape** precisa excluir `.idle-warning__overlay` da própria condição. Quando o aviso de inatividade está no ar ele tem que ser o único a reagir ao Esc (Esc = "estou aqui", `frontend/src/js/session/idle-watch.js`). Um modal novo que esqueça isso faz o Esc fechar o modal e deixar a sessão expirar em silêncio. Esta regra ficou **sem exemplo vivo** em 2026-08-05: as duas superfícies que a cumpriam (o seletor de projetos e o painel admin) viraram PÁGINAS (`projetos.html`, `admin.html`) e perderam o Esc-para-fechar junto com o botão de fechar, porque página não fecha. A regra continua valendo para o próximo modal de tela cheia; a ausência de exemplo é o motivo de ela estar escrita aqui.
- **A vigília de inatividade mora em `frontend/src/js/session/idle-watch.js`**, não no controller. `startIdleWatch` (atividade + overlay + `IdleTimer`) não conhece store nem event bus, e é isso que permite a página do admin ter o mesmo timeout sem arrastar o mapa. O `IdleTimeoutController` ficou só com o ciclo de sessão (`SESSION_CHANGED` → começa/para) e com o que expirar significa no mapa. Quem escrever uma terceira página deve chamar `startIdleWatch` com o próprio `onExpire`, nunca recriar o overlay.
- **`?map=` só aceita UUID** (`frontend/src/js/deep-link/atlas-url-sync.js`). Escrever um nome ali expõe nome interno e rebaixa um link bom. As duas assimetrias de `buildAtlasSearch` que parecem bug e não são (mapId falsy preserva o `?map=` existente; limpar não remove `atlasPublico`) estão explicadas no JSDoc de `frontend/src/js/deep-link/atlas-link.js`.
- **Não existe fallback de config.** O boot morre na tela "EBGeo indisponível" após 3 tentativas. O `frontend/src/js/config.js` embarcado é só o *shape* que o backend hidrata. Ver [[config-dinamico]] e [[config-runtime-urls-relativas]].
- **Ordem no store**: restaurar sessão precisa vir antes do boot guard, senão o guard descarta o atlas remoto em cache de um usuário legitimamente logado (`enforceLocalStoreWhenLoggedOut`, `frontend/src/js/store/store.js`). O guard é no-op para o usuário local, essa é a garantia aditiva.

## Custo escondido e limites

- Requisições de boot (config + `getMe`) têm timeout de 8 s (`BOOT_TIMEOUT_MS`); **pull de snapshot e push de operações são intencionalmente sem timeout**, para não abortar transferência grande em rede ruim. Não "conserte" isso adicionando timeout.
- A barreira `Promise.race([bootRendered, 15 s])` (`frontend/src/js/index.js`) é espera **só de IndexedDB**, nada de rede. O teto existe contra deadlock se o evento `load` nunca disparar.
- O link pendente pós-login vive em escopo de módulo (`frontend/src/js/deep-link/atlas-link.js`), o que basta porque **este** fluxo não recarrega: quem chega com `?atlas=` deslogado faz login no próprio mapa e retoma no mesmo documento. Ficou a um passo de deixar de bastar em 2026-08-05, quando o login SEM link passou a navegar para `projetos.html`, e o caminho com link foi deliberadamente mantido sem navegação por isso. Mover o login para outra página exige trocar isto por `sessionStorage`, como já foi feito com a intenção "Mapa local".
- Token de link público é efêmero e não persistido (`setEphemeralToken`, `frontend/src/js/store/sync/api-client.js`): o link é re-resolvido a cada boot. Ver [[link-publico]].

## Sequências onde a ordem é o contrato

`openRemoteAtlas` (`frontend/src/js/account/open-atlas.service.js`) tem cada passo justificado em comentário. Os três que custam caro se invertidos:

- `markStoreRemote` **antes** do connect: intenção durável, para que uma aba morta no meio do pull vire descarte e não atlas local corrompido.
- `markStoreLocal()` no catch: sem isso um 403/404 deixa o boot retentando um atlas morto a cada F5.
- `disconnect()` antes de abrir outro: um socket por atlas, o servidor não tem "trocar" (ver [[canal-collab-websocket]]).

`IdleTimeoutController` e o handler de auth-lost são ligados **depois** dos controles porque ambos chamam `getControl('account')`; ligados antes, a expiração vira no-op silencioso.

Ver [[snapshot-e-pull-incremental]], [[fila-operacoes-outbound]], [[permissoes-atlas]], [[formato-ebgeo-roundtrip]], [[presenca-colaborativa]], [[refresh-token-rotacao]], [[autenticacao-jwt]], [[syncledger]].

Os arquivos citados acima têm JSDoc explicando o porquê no ponto de uso; prefira o código a qualquer paráfrase, esta inclusa.
