# Comentário espacial

Entidade por-mapa, não-feição, raiz e resposta na mesma forma distinguidas por `parentId`; é a forma de participação do papel Comentarista, e o Visualizador nem sequer a recebe do servidor. Contrato em `frontend/src/js/store/comment.operations.js`; UI em `src/js/comment_tool/`.

## Por que resposta é entidade própria

O caminho óbvio (respostas como array dentro da raiz) está errado aqui. O modelo de conflito é [[modelo-conflito-lww]] com granularidade de **entidade inteira**: duas respostas simultâneas viariam dois UPDATEs da mesma raiz e uma sobrescreveria a outra. Com resposta-como-entidade (`frontend/src/js/store/comment.operations.js:111-119`) viram dois CREATEs independentes, que convergem sem perda. Não "otimize" isso de volta para um array.

O preço disso é que não existe cascata no servidor: `removeComment` apaga raiz + respostas localmente e emite **N ops DELETE**, uma por id (`frontend/src/js/store/comment.operations.js:187-201`). Quem apaga é quem propaga; um par que perca o lote fica com respostas órfãs.

## As duas armadilhas de permissão

`guardComment` exige autenticação **e** a capability `COMMENT` (`frontend/src/js/store/comment.operations.js:31-44`). Duas afirmações no próprio código são falsas e induzem ao erro:

1. **O JSDoc do arquivo mente sobre offline.** `frontend/src/js/store/comment.operations.js:11` diz "commenting works fully offline (P1)". Não funciona: `guardComment` barra com `reason: 'not-authenticated'` (`:34-37`) e a ferramenta recusa entrar em colocação (`frontend/src/js/comment_tool/comment-overlay.js:123-126`). Anônimo/offline apenas **vê** comentários (por exemplo vindos de um `.ebgeo` importado).
2. **A regra "autor ou Editor+" não existe no store.** `frontend/src/js/store/sync/permission-guard.js:39-40` afirma que ela é aplicada "in the comment operations + backend"; no cliente ela só existe na UI (`frontend/src/js/comment_tool/comment-overlay.js:171-176`). `updateComment`/`removeComment` chamados fora do overlay editam ou apagam comentário alheio com qualquer papel Comentarista+. Novo call site fora de `comment_tool/` precisa replicar o teste de autoria. Ver [[permissoes-atlas]].

> **Nota histórica.** guia *visao-e-principios* (absorvido) §11 lista "Comentário disponível offline" entre as decisões fechadas. O código faz o oposto (item 1 acima). Isso vale inclusive para o visitante de [[link-publico]], que é ONLINE mas com `isAuthenticated()` falso por construção (`frontend/src/js/store/sync/session-context.js:258-266`).

## No mapa local, comentar não sai da máquina

Op de comentário é map-scoped. No mapa local `Principal` (chaveado por nome, não UUID) o dispatcher **descarta antes do flush** (`frontend/src/js/store/sync/operation-dispatcher.js:133-137`, `DropReason.NON_UUID_MAPID`), porque um `mapId` não-UUID derrubaria o lote inteiro no backend. O comentário persiste e aparece na UI, sem sinal algum de que nunca será publicado. Ver [[fila-operacoes-outbound]] e [[dominio-local-vs-remoto]].

Mesma classe de surpresa no `.ebgeo`: o import usa `setMapComments`, que grava direto no repositório e **não loga op** (`frontend/src/js/store/comment.operations.js:221-224`). Importar um projeto cheio de comentários num atlas remoto não os publica para os pares. É deliberado (import é restauração local), mas ninguém adivinha. Ver [[formato-ebgeo-roundtrip]].

## Formas divergentes: snapshot é array

O side-store e o overlay usam `{ [id]: comment }`; o backend manda `map.comments` como **array** no snapshot, normalizado em `frontend/src/js/store/sync/remote-operation-handler.js:1203-1209`, seguido de um `COMMENT_UPDATED` vazio só para o overlay recarregar (`:1226-1227`). Qualquer novo consumidor do snapshot cru precisa tratar array. Ver [[snapshot-e-pull-incremental]] e [[aplicacao-operacoes-remotas]].

O campo pode vir **ausente**, e não é bug: para conexão de nível `read` o servidor não envia comentários, nem no snapshot nem no broadcast. É filtro de transmissão, então o dado nunca chega ao IndexedDB do Visualizador. Não tente compensar isso no cliente. Ver [[canal-collab-websocket]] e [[sintese-capacidades-por-papel]].

## Contratos que a UI depende e não declara

- **Resolvido sai do mapa.** O overlay filtra `status !== 'resolved'` no render (`frontend/src/js/comment_tool/comment-overlay.js:249-251`); o comentário sobrevive só no painel, em grupo colapsado. Mexer nesse filtro muda o significado de "resolver" no produto inteiro.
- **Thread resolvida é somente-leitura** nos dois lados: a UI esconde o campo de resposta (`frontend/src/js/comment_tool/comment-overlay.js:456-461`) e `addReply` recusa pai resolvido ou deletado (`frontend/src/js/store/comment.operations.js:107-108`). Remover só uma das metades produz resposta que some, ou op de sync condenada.
- **`resolveComment` é UPDATE comum** (`frontend/src/js/store/comment.operations.js:166-172`), sujeito ao mesmo LWW: resolver e reabrir simultâneos não empatam por mérito, empatam por ordem de chegada. Ver [[modelo-conflito-lww]].
- **O painel aparece se há comentários, mesmo sem permissão** (`frontend/src/js/comment_tool/comments-panel.js:145-151`), para o Comentarista rebaixado ainda ler o histórico.
- `Shift+C` e não `C` porque as letras simples pertencem às ferramentas de desenho (`frontend/src/js/keyboard/keyboard-shortcuts.js:132`).

## Relacionados

[[atlas-modelo-de-dados]], [[envelope-operacao]], [[tipos-entidade-sync]], [[presenca-colaborativa]], [[compartilhamento-atlas]], [[modos-operacao]]

## Fontes
- guia *visao-e-principios* (absorvido) (§11): modelo de papéis, decisão raiz/resposta como entidades separadas (P10), filtro de transmissão para o Visualizador.
- Código (autoridade sobre a prosa): `frontend/src/js/store/comment.operations.js`, `src/js/comment_tool/{comment-overlay,comments-panel}.js`, `src/js/store/sync/{permission-guard,operation-dispatcher,remote-operation-handler,session-context}.js`, `frontend/src/js/import_export/export-import.service.js`.
