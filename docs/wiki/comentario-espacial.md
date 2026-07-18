# Comentário espacial

Entidade por-mapa, não-feição, com raiz e resposta na mesma forma distinguidas por `parentId`, ancorada numa coordenada como pin; é a forma de participação do papel Comentarista e o Visualizador nem sequer a recebe do servidor (filtro de transmissão, não esconde-UI).

## Forma da entidade

Raiz e resposta compartilham o mesmo formato e o mesmo mapa de armazenamento (`{ [id]: comment }`), diferenciados só por `parentId`:

- **Raiz** (`parentId: null`): `id`, `lng`, `lat`, `text`, `status` (`'open' | 'resolved'`), `authorId`, `authorInitials`, `authorColor`, `createdAt`, `updatedAt` (`src/js/store/comment.operations.js:66-78`).
- **Resposta** (`parentId: <id da raiz>`): mesma forma sem coordenada, sem `status` e sem `authorColor` (`comment.operations.js:111-119`).

**Cada resposta é uma entidade própria, e isso é a decisão central.** Como o modelo de conflito é [[modelo-conflito-lww]] com granularidade de entidade inteira, guardar respostas como array dentro da raiz faria duas respostas simultâneas se sobrescreverem. Com resposta-como-entidade, dois comentaristas respondendo ao mesmo tempo geram dois CREATEs independentes que convergem sem perda.

Persistência: side-store dedicado, chave `comments_<mapKey>`, onde `mapKey` é o resultado de `_resolveMapKey` (UUID quando o mapa é remoto, nome quando é local) — `src/js/store/repositories/local.repository.js:567-582`.

## Escrita: transação persistence-first

Todas as mutações passam por `runTransaction` no padrão do repo (persistência primeiro, efeitos depois): o evento `COMMENT_*` vai em `deferSync` e a operação de sync em `deferAsync` (`comment.operations.js:80-89`). Ops locais e remotas emitem **os mesmos eventos**, então overlay e painel não sabem (nem precisam saber) a origem da mudança.

Armadilhas reais no código:

- `addReply` recarrega o pai antes de gravar e **desiste** se o pai sumiu, foi deletado ou está `resolved` (`comment.operations.js:107-108`). Isso evita resposta órfã e uma op de sync condenada.
- `removeComment` faz **cascata local** da raiz + respostas e emite um DELETE por id (`comment.operations.js:187-201`). Não existe cascata no servidor: quem apaga é que emite N ops.
- `resolveComment` é açúcar sobre `updateComment` trocando `status` (`comment.operations.js:166-172`), ou seja, resolver/reabrir é um UPDATE comum sujeito ao mesmo LWW.
- `setMapComments` (usado no import `.ebgeo`) grava direto no repositório e **não loga op de sync** (`comment.operations.js:221-224`): importar projeto é restauração local, não edição colaborativa.

## Permissão: dois portões, não um

`guardComment` exige **as duas coisas** (`comment.operations.js:31-44`):

1. `sessionContext.isAuthenticated()`, porque um comentário precisa de autor;
2. `checkPermission(GuardAction.CREATE_COMMENT | UPDATE_COMMENT | DELETE_COMMENT)`, que mapeia para a capability `COMMENT` (`src/js/store/sync/permission-guard.js:41-43`).

A regra mais fina "autor ou Editor+" para editar/resolver/excluir **não** está no guard, está na UI: `_canModify` libera para quem tem `canEdit`, senão só se `comment.authorId === sessionContext.userId` (`src/js/comment_tool/comment-overlay.js:171-176`). Ver [[permissoes-atlas]] e [[permissoes-atlas]].

> [!CONTRADICAO 2026-07-18] guia *visao-e-principios* (absorvido) §11 diz "Funciona sem login (a ferramenta aparece; o gating de papel só existe conectado, P1)" e lista "Comentário disponível offline" nas decisões fechadas. O código faz o oposto: `guardComment` bloqueia com `reason: 'not-authenticated'` em `src/js/store/comment.operations.js:34-37`, e a ferramenta recusa entrar em modo de colocação exibindo "Faça login para adicionar comentários" em `src/js/comment_tool/comment-overlay.js:123-126`. Anônimo/offline apenas **vê** comentários (por exemplo os vindos de um `.ebgeo` importado). Isso vale inclusive para o visitante de [[link-publico]], que é ONLINE mas com `isAuthenticated()` falso por construção (`src/js/store/sync/session-context.js:258-266`).

## Sync

Tipo de entidade `COMMENT: 'comment'` (`src/js/store/sync/operation-types.js:34`), logado por `logCommentOperation` (`src/js/store/sync/operation-dispatcher.js:307-308`). É uma op **map-scoped**: carrega o `mapId` do mapa. Ver [[envelope-operacao]] e [[tipos-entidade-sync]].

Consequência direta do escopo por mapa: no mapa local `Principal` (chaveado por nome, não UUID) o dispatcher **descarta a op antes do flush** (`operation-dispatcher.js:133-137`, `DropReason.NON_UUID_MAPID`), porque o backend rejeitaria um `mapId` não-UUID e derrubaria o lote inteiro. Comentar num mapa local persiste, mas nunca sai da máquina. Ver [[fila-operacoes-outbound]] e [[dominio-local-vs-remoto]].

Entrada remota: `applyRemoteCommentOp` grava no side-store e emite `COMMENT_CREATED`/`COMMENT_UPDATED`/`COMMENT_DELETED` (`src/js/store/sync/remote-operation-handler.js:658-671`) — mesma simetria de [[aplicacao-operacoes-remotas]].

No [[snapshot-e-pull-incremental]] há uma diferença de forma que já causou bug: o backend manda `map.comments` como **array**, e o handler normaliza para `{ [id]: comment }` antes de salvar (`remote-operation-handler.js:1203-1209`), depois emite um `COMMENT_UPDATED` vazio só para o overlay recarregar (`:1226-1227`). Se você consumir o snapshot cru em outro ponto, lembre que ali é array.

## O Visualizador não recebe, não é esconde-UI

Para conexão de nível `read`, snapshot e broadcast do servidor **não enviam comentários**. É filtro de transmissão, então o dado nunca chega ao IndexedDB do Visualizador. Isso é intencional e é a razão de o campo `map.comments` poder vir ausente do snapshot (comentado em `remote-operation-handler.js:1204-1205`). Não tente "consertar" isso no cliente. Ver [[canal-collab-websocket]] e [[sintese-capacidades-por-papel]].

## UI

`comment_tool/` tem overlay no mapa + painel lateral (`comment-overlay.js`, `comments-panel.js`). `Shift+C` alterna a colocação (`src/js/keyboard/keyboard-shortcuts.js:132`), atalho escolhido porque as letras simples já pertencem às ferramentas de desenho.

- O pin da raiz mostra as 2 iniciais do autor; clicar abre a thread (respostas, resolver/reabrir, excluir).
- **Resolvido sai do mapa**: o render filtra `status !== 'resolved'` (`comment-overlay.js:249-251`); o comentário fica só no painel, em grupo separado e colapsado por padrão (`comments-panel.js:165-181`).
- Thread resolvida é somente-leitura: sem campo de resposta até reabrir (`comment-overlay.js:456-461`), coerente com `addReply` recusando pai resolvido.
- `togglePlacement` checa a permissão **antes** de ativar, para não deixar o usuário clicar e digitar um comentário que o store rejeitaria em silêncio (`comment-overlay.js:118-127`).
- O painel aparece se o usuário pode comentar **ou** se já existem comentários (`comments-panel.js:145-151`), para o Comentarista rebaixado ainda ler o histórico.

## Round-trip `.ebgeo`

Comentários entram no arquivo por mapa (`src/js/import_export/export-import.service.js:1124-1125`) e voltam via `setMapComments`, com remapeamento de nome de mapa no import aditivo (`:692-693`) e direto no import normal (`:730-731`). Ver [[formato-ebgeo-roundtrip]]. Como o import não loga ops, importar um `.ebgeo` cheio de comentários num atlas remoto **não** os publica para os pares.

## Relacionados

[[atlas-modelo-de-dados]], [[modelo-conflito-lww]], [[presenca-colaborativa]], [[compartilhamento-atlas]], [[modos-operacao]], [[sintese-nao-e-crdt]]

## Fontes
- guia *visao-e-principios* (absorvido) (§11): modelo de papéis, matriz de capacidades, decisão raiz/resposta como entidades separadas (P10), "resolvido sai do mapa", filtro de transmissão para o Visualizador, schema no baseline `002_atlas.sql` com o texto no `data` JSONB, comentário fora do link público.
- guia *ui-ux-ebgeo* (absorvido) (§Comentários espaciais, §Papéis): overlay + painel, `Shift+C`, comentário como forma de participação do Comentarista, gating de broadcast de seleção por edição.
- Código (autoridade sobre a prosa): `src/js/store/comment.operations.js`, `src/js/comment_tool/comment-overlay.js`, `src/js/comment_tool/comments-panel.js`, `src/js/store/sync/{permission-guard,operation-types,operation-dispatcher,remote-operation-handler,session-context}.js`, `src/js/store/repositories/local.repository.js`, `src/js/import_export/export-import.service.js`, `src/js/keyboard/keyboard-shortcuts.js`.
