# Sessão, boot e ciclo de vida da conexão

A ordem de boot em `frontend/src/js/index.js` está comentada fase a fase no próprio código; esta página guarda só o que o código não consegue dizer: a documentação desatualizada que ainda contradiz o boot, e os invariantes que quebram de longe.

## O boot NÃO reconecta o último atlas

`frontend/src/js/index.js:161` chama `openAtlasChooserOnBoot()`, que **descarta** dado remoto órfão e abre o Atlas Drive (`frontend/src/js/index.js:280-282`). A decisão está no comentário em `frontend/src/js/index.js:276-279`: a barra de endereço é a fonte de verdade. `/?atlas=<uuid>` carrega aquele atlas; `/` puro deve **deixar escolher**, não reabrir silenciosamente o último. O marcador de origem serve para descartar resíduo, não para reabrir. Ver [[dominio-local-vs-remoto]], que registra a armadilha correlata (`atlasId` é persistido e **nunca lido**).

A armadilha sobrevive à correção: quem planeja a partir de uma fonte que promete reconexão automática propõe código que duplica o Atlas Drive. O símbolo que essas fontes citavam, `reconnectLastAtlas`, tem **zero ocorrências** em `frontend/src/` e nunca teve. Confirme no código antes de aceitar qualquer afirmação de reconexão no boot.

Isto foi uma `[!CONTRADICAO]` pendente até 2026-07-25, com quatro fontes afirmando o contrário. Três eram guias absorvidos e morreram com a absorção; a quarta era `.claude/rules/architecture.md`, a perigosa, por ser carregada como instrução em toda sessão de agente, e foi corrigida na mesma data. Repare por que o guarda não pegou: `frontend/tests/unit/docs-integridade.test.js` valida o **caminho** citado, nunca o **símbolo**, então uma citação a uma função que não existe atravessa o teste em silêncio.

## Invariantes que quebram de longe

O código comenta cada decisão no ponto em que ela acontece. O que ele não comenta é o que quebra **em outro arquivo**:

- **Todo modal novo com handler de Escape** precisa excluir `.idle-warning__overlay` da própria condição, como fazem `frontend/src/js/modals/project-picker.modal.js:133` e `frontend/src/js/admin/admin-panel.js:163`. Quando o aviso de inatividade está no ar ele tem que ser o único a reagir ao Esc (Esc = "estou aqui", `frontend/src/js/session/idle-timeout.controller.js:174`). Um modal novo que esqueça isso faz o Esc fechar o modal e deixar a sessão expirar em silêncio.
- **`?map=` só aceita UUID** (`frontend/src/js/deep-link/atlas-url-sync.js:35`). Escrever um nome ali expõe nome interno e rebaixa um link bom. As duas assimetrias de `buildAtlasSearch` que parecem bug e não são (mapId falsy preserva o `?map=` existente; limpar não remove `atlasPublico`) estão explicadas em `frontend/src/js/deep-link/atlas-link.js:38-58`.
- **Não existe fallback de config.** O boot morre na tela "EBGeo indisponível" após 3 tentativas. O `frontend/src/js/config.js` embarcado é só o *shape* que o backend hidrata. Ver [[config-dinamico]] e [[config-runtime-urls-relativas]].
- **Ordem no store**: restaurar sessão precisa vir antes do boot guard, senão o guard descarta o atlas remoto em cache de um usuário legitimamente logado (`store/store.js:137-156`). O guard é no-op para o usuário local, essa é a garantia aditiva.

## Custo escondido e limites

- Requisições de boot (config + `getMe`) têm timeout de 8 s; **pull de snapshot e push de operações são intencionalmente sem timeout** (`frontend/src/js/store/sync/api-client.js:41-49`), para não abortar transferência grande em rede ruim. Não "conserte" isso adicionando timeout.
- A barreira `Promise.race([bootRendered, 15 s])` (`frontend/src/js/index.js:156`) é espera **só de IndexedDB**, nada de rede. O teto existe contra deadlock se o evento `load` nunca disparar.
- O link pendente pós-login vive em escopo de módulo (`frontend/src/js/deep-link/atlas-link.js:100-112`), o que basta porque boot e login não têm reload entre si. Deixa de bastar no instante em que algum fluxo de login recarregar a página.
- Token de link público é efêmero e não persistido (`frontend/src/js/store/sync/api-client.js:117-120`): o link é re-resolvido a cada boot. Ver [[link-publico]].

## Sequências onde a ordem é o contrato

`openRemoteAtlas` (`account/open-atlas.service.js:41-81`) tem cada passo justificado em comentário. Os três que custam caro se invertidos:

- `markStoreRemote` **antes** do connect: intenção durável, para que uma aba morta no meio do pull vire descarte e não atlas local corrompido.
- `markStoreLocal()` no catch: sem isso um 403/404 deixa o boot retentando um atlas morto a cada F5.
- `disconnect()` antes de abrir outro: um socket por atlas, o servidor não tem "trocar" (ver [[canal-collab-websocket]]).

`IdleTimeoutController` e o handler de auth-lost são ligados **depois** dos controles porque ambos chamam `getControl('account')`; ligados antes, a expiração vira no-op silencioso.

Ver [[snapshot-e-pull-incremental]], [[fila-operacoes-outbound]], [[permissoes-atlas]], [[formato-ebgeo-roundtrip]], [[presenca-colaborativa]], [[refresh-token-rotacao]], [[autenticacao-jwt]], [[syncledger]].

## Fontes

Código: `frontend/src/js/index.js`, `deep-link/atlas-link.js`, `deep-link/atlas-url-sync.js`, `account/open-atlas.service.js`, `account/account.control.js`, `session/idle-timeout.controller.js`, `store/sync/api-client.js`, `store/store.js`, `store/store-origin.js`. Todos com JSDoc que explica o porquê no ponto de uso; prefira o código a qualquer paráfrase.
