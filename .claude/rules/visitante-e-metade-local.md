---
paths:
  - "frontend/src/js/projects/**"
  - "frontend/src/js/store/local-atlas.api.js"
  - "frontend/src/js/tool_manager/edit-surface.js"
  - "frontend/src/js/catalog/private-reference-pruner.js"
  - "frontend/src/js/catalog/resource-reference.resolver.js"
  - "frontend/src/js/sidebar/tabs/maps.tab.js"
  - "frontend/src/js/import_export/export-import.service.js"
---

# O visitante e a metade local (perfil deslogado)

O quinto relatório de UX foi dissolvido em 2026-08-24 (decisão registrada em [`../../docs/decisions/decisions-2026.md`](../../docs/decisions/decisions-2026.md)). O que sobra aqui é só o que não se lê no código.

- **`atlas.html` NÃO é mais fail-fast, e o mapa continua sendo.** A assimetria é deliberada e é a decisão inteira: `loadLocalAtlases` nunca tocou a rede, então a seção "Neste computador" desenha com o `GET /api/config` fora, e só a metade de servidor vira um bloco de indisponibilidade (`createServerOutage`, `frontend/src/js/projects/atlas-drive.js`). `frontend/src/js/index.js` segue com `showUnavailableScreen()` e `return` antes de `initServices()`. Criar, renomear, copiar e excluir atlas local funcionam inteiramente offline; só ABRIR precisa do servidor, porque abrir navega para o mapa, e o texto do bloco diz isso em voz alta em vez de deixar a pessoa bater no bloqueio.

- **A grade local vazia é o estado de FALHA, nunca o estado honesto de ninguém.** `bootstrapEntry` (`frontend/src/js/store/local-atlas.api.js`) garante um cartão a todo visitante novo, então "zero atlas" só acontece quando a leitura do registro falhou. Daí o terceiro estado em `LocalAtlasSection._render`, e daí o contador se calar em vez de dizer "0 de 10" sobre um registro que a página não conseguiu ler.

- **A VISITA PÚBLICA NÃO TEM MAIS FAIXA, e o que a substitui são três cortes** (dono, 2026-09-20; decisão registrada em [`../../docs/decisions/decisions-2026.md`](../../docs/decisions/decisions-2026.md)). A faixa persistente saiu: ela cobria o topo do mapa a visita inteira para dizer o que cabe num aviso de chegada, que é o que ficou (um toast, em `openPublicAtlasFromUrl`). Os cortes: a superfície é INERTE para quem não pode editar, como no mapa travado (`isEditSurfaceInert`, `frontend/src/js/tool_manager/edit-surface.js`, lido pelos TRÊS caminhos de seleção por `_notifySelected` e pelo arrasto), porque o visitante ganhava alça de vértice e arrastava feição, a tela pintava o movimento, o store recusava e ficava na tela uma geometria que não existe em lugar nenhum; o MOUSE do visitante não viaja nem é retido (`sendCursorFrame` no cliente e `handleCursor` no servidor, que zera a posição de todo socket `isPublic`), mas o quadro SEM posição continua saindo, porque é ele que carrega o mapa ativo; e o visitante continua CONTADO na lista de quem está online, que nunca dependeu do cursor. **O VISUALIZADOR ABERTO pelo visitante segue a mesma regra desde 2026-09-22**: o quadro `viewer_context` dele não viaja nem é retido (`anunciarContextoDoVisualizador`, `backend/src/modules/collab/collab.viewer.js`, e a ponte nem o manda); como destinatário ele lê o do colega pelo predicado de principal nulo, isto é, o público e o que o atlas empresta.

- **O link público aberto por quem está LOGADO entra pela CONTA, e até 2026-09-20 ele era engolido em silêncio.** `openPublicAtlasFromUrl` devolvia falso na primeira linha quando havia sessão, a cadeia seguia até o seletor e o navegador terminava em `atlas.html` sem uma palavra; o dono mediu isso no próprio navegador. Hoje a função resolve o link PRIMEIRO (o link morto fala nos dois casos) e, com sessão, tira `?atlasPublico=` da barra e entra pelo MESMO pipeline de `?atlas=`: o servidor dá a toda conta viva a leitura de um atlas público (`requireAtlasPermission` e o gateway de colaboração), e a quem é dono ou tem share o nível que já tinha. Abrir como VISITA com conta viva não é opção, porque a sessão de visitante anula a identidade e o token efêmero disputaria com o da conta. Guarda: `frontend/tests/unit/link-publico-com-sessao-abre-pela-conta.test.js`.

- **A poda de saída afirma DUAS naturezas, e ela tem DUAS portas.** `descreverPerdas` (`frontend/src/js/catalog/resource-reference.resolver.js`) separa "por restrição de acesso" de "por não dar para confirmar, fora do servidor, que é público", e o segundo bloco é o único que um anônimo vê, porque para ele `isPrivateResource` nunca é verdadeiro. As portas são o `.ebgeo` (`import_export/export-import.service.js`) e "Salvar como local" (`sidebar/tabs/maps.tab.js`): as duas chamam a MESMA função e tinham a mesma moldura falsa, e o achado nomeava só a primeira. `descreverPerdasDoServidor` não pode ser dividida, porque o relatório do servidor não traz veredito.
