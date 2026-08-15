# Domínio local vs. domínio remoto (store-origin)

Dois domínios convivem no IndexedDB, o workspace local permanente e a cópia efêmera de um atlas do servidor, discriminados por um marcador de origem (`frontend/src/js/store/store-origin.js`); desde 2026-08-15 cada atlas também tem o seu conjunto de bancos, e as duas coisas respondem perguntas diferentes.

## O marcador e o namespace respondem perguntas diferentes

O namespace responde "**onde** este dado mora": qual banco IndexedDB um `getStore()` resolve, dado o atlas ativo. O marcador responde a pergunta que decide destruição: *este dado tem direito de continuar existindo aqui?* Dado de atlas remoto é temporário por definição e precisa sumir no logout, senão o usuário acha que colabora enquanto edita uma cópia morta.

**Esta seção dizia que namespacing tinha sido rejeitado, e isso deixou de valer.** O argumento da rejeição era que o namespace seria refactor pesado sem ganho de princípio, porque a separação local↔remoto já estava garantida pelo marcador. Ele foi vencido por um caso que o marcador não cobre: duas abas em atlas de servidor DIFERENTES eram, com um scratch único, o mesmo conjunto de dez bancos, o que não é contenção que um lock arbitre, é um endereço com dois donos. O invariante que a rejeição protegia ("dado remoto não sobrevive ao logout") continua de pé por outro meio, um registro mais um expurgo derivado dele. Ver [[namespace-por-atlas]] e [[coordenacao-entre-abas]].

O que o marcador continua sendo, e nada disso mudou: a fonte que o boot guard lê para descartar resíduo, o que `checkPermission` consulta para liberar o store local, e a intenção durável gravada antes do pull.

**Múltiplos atlas locais nomeados deixaram de ser não-objetivo na persistência, e o produto expõe só a criação.** O registro, o teto de 10 (`MAX_LOCAL_ATLASES`) e as operações de criar, trocar e excluir estão em `frontend/src/js/store/local-atlas.api.js`. Criar tem um gesto (importar um `.ebgeo` com um atlas de servidor aberto, ver [[formato-ebgeo-roundtrip]]) e o resgate de logout cria outro; **trocar e excluir não têm tela nenhuma**. Planejar a partir de "o usuário escolhe entre seus atlas locais" é planejar sobre UI que não existe, e o efeito colateral é real: o slot anterior fica no disco sem caminho de volta.

Consequência prática para o usuário: trocar de atlas de servidor esvazia o store montado e **não** toca no que ficou pendente do atlas que se deixa, porque a fila de saída é por atlas e fica de fora do wipe de entrada ([[namespace-por-atlas]]). O que não volta é o DADO do atlas anterior, que se busca de novo no servidor. Para trabalhar offline em algo do servidor, **baixe o `.ebgeo` antes de desconectar** (ver [[formato-ebgeo-roundtrip]]).

## Ordem, que é onde está a corretude

Duas ordens não são estilo, são o que torna o crash seguro:

- **`markStoreRemote` ANTES do `connect`** (`frontend/src/js/account/open-atlas.service.js`). É intenção durável: se a aba morrer no meio do pull, o boot guard vê `remote` e descarta o parcial em vez de promovê-lo a atlas local permanente. E o `catch` reverte para `markStoreLocal()` (`frontend/src/js/account/open-atlas.service.js`), senão um F5 retentaria eternamente um atlas morto (403/404).
- **`markStoreLocal()` DEPOIS dos clears** (`frontend/src/js/store/store.js`). `clearAllDataStore` apaga o appStore, onde o próprio marcador mora. Marcar antes seria apagar a marcação.

## Armadilhas

**`atlasId` deixou de ser campo morto, e isso muda como se lê o marcador.** Até o namespace por atlas existir, só `kind` era consultado e esta linha mandava ignorar o `atlasId` persistido. Hoje ele decide coisas: `initLocalAtlases` (`frontend/src/js/store/local-atlas.api.js`) o usa para reativar e REPARAR o registro do namespace no boot, `purgeReachedAtlas` (`frontend/src/js/store/remote-atlas.api.js`) o usa para decidir se o segundo apagamento do boot guard ainda precisa rodar, e `resolveTabMountOrigin` (`frontend/src/js/store/store-origin.js`) o usa como QUEDA do ponteiro de montagem por aba, que é a fonte de primeira escolha desde que o ponteiro passou a viver em `sessionStorage`. A precedência do boot é ponteiro da aba primeiro, marcador da instalação depois; o que mudou é que o `atlasId` do marcador é caminho vivo nas duas pontas. (Esta linha citou um terceiro consumidor em `frontend/src/js/account/account.control.js`, com um nome que nunca existiu no código, e o guarda de símbolo de `frontend/tests/unit/docs-integridade.test.js` foi quem acusou. Por isso a convenção pede crase só para o que existe.)

**A lista de bancos a limpar é derivada, não escrita à mão.** Esta linha registrava duas listas paralelas em `clearAllDataStore` e `enforceLocalStoreWhenLoggedOut`, com nada forçando as duas a concordarem. As duas passaram a chamar `unmountCurrentAtlas`, que usa `clearAllAtlasStores` derivada de `STORE_DESCRIPTORS` (`frontend/src/js/store/atlas-namespace.js`). Adicionar um banco persistido é adicionar uma linha àquele descritor, e os caminhos de limpeza o alcançam sozinhos.

**Replique a cláusula local em todo gate por papel.** `checkPermission` libera tudo quando `!isRemoteStoreSync()` (`frontend/src/js/store/sync/permission-guard.js`) e `isReadOnly()` retorna `false` de saída (`frontend/src/js/locking/map-lock.controller.js`). Um gate novo que consulte `sessionContext.role` cru quebra a edição do workspace local de um usuário logado cujo papel global seja restritivo. Ver [[permissoes-atlas]].

**Confirmação destrutiva só protege o local.** O par `!isRemoteStoreSync() && await hasAnyMapFeatures()` é o que dispara o aviso "baixe um `.ebgeo`". Dado remoto é descartável porque o servidor é a fonte da verdade; inverter esse teste destruiria trabalho insubstituível em silêncio.

## O anti-leak do `Principal` (comportamento que atravessa quatro arquivos)

O marcador cobre local↔remoto, **não** cobre remoto↔remoto. O isolamento entre atlas de servidor vem de outro lugar: o namespace por atlas ([[namespace-por-atlas]]), o clear destrutivo na troca, e uma sala por atlas com guarda IDOR no servidor (ver [[atlas-modelo-de-dados]]).

A raiz do problema é um chaveamento misto que nenhum arquivo declara sozinho: mapas de atlas remoto são chaveados por **UUID**, o mapa local padrão `Principal` é chaveado por **nome**. Quatro defesas independentes decorrem disso, e cada uma parece arbitrária lida isoladamente:

1. **Poison pill no flush.** O backend rejeita `mapId` não-UUID com Postgres 22P02, e **uma op ruim derruba o lote inteiro**, travando todo o sync. Por isso `frontend/src/js/store/sync/operation-dispatcher.js` descarta antes de enfileirar. Ops atlas-level passam `mapId = null` e não são afetadas.
2. **Sombreamento no connect.** Leitura por nome acerta direto a chave de armazenamento: um `Principal` local coexistindo com um mapa de atlas homônimo faz `repo.getMap('Principal')` acertar o **stray vazio**. `activateAtlasInitialMap` apaga strays não-UUID antes de resolver (`frontend/src/js/store/map.operations.js`).
3. **Criação com sync ativo.** `addMap` nasce UUID-keyed quando o logging está ligado (`frontend/src/js/store/map.operations.js`), senão uma reaplicação de snapshot duplicaria o mapa em vez de atualizá-lo.
4. **Exibição.** `getAllMapNamesStore` resolve UUID→nome (`frontend/src/js/store/map.operations.js`), senão o mapa de um peer aparece como UUID cru.

Detalhe fácil de quebrar: `setCurrentMap` recebe o **nome**, nunca a chave UUID, porque presença e cursores usam `mapId` por nome e peers filtram um UUID cru (ver [[presenca-colaborativa]]). Regra geral: nunca assuma que a chave de um mapa é o nome nem que é UUID, resolva pelo `mapResolver`.

Ao depurar "editei e nada sincronizou": todo drop emite span `preflush.drop` com `reason` no [[syncledger]], mas **logging desabilitado (offline/anônimo) também produz `preflush.drop`**, com `reason: logging_disabled` (`frontend/src/js/store/sync/operation-dispatcher.js`). Distinga as duas causas. Ver [[envelope-operacao]] e [[fila-operacoes-outbound]].

Uma chave de setting que seja view state por cliente (`lastActiveMap`) não deve virar op: seria descartada por `non_uuid_setting_id` de qualquer forma, e enfileirá-la só polui a fila.

## Pontes entre os domínios

Remoto → local é "Salvar projeto" (exporta `.ebgeo`), a única forma suportada de levar um atlas do servidor para uso offline. Local → remoto é `frontend/src/js/import_export/save-local-atlas.service.js`, que **não** conecta: o serviço empacota e importa preservando IDs do cliente, e o chamador da UI faz `clearAllDataStore` + `markStoreRemote` + `connect` depois (`frontend/src/js/import_export/save-local-atlas.service.js`). Ver [[atlas-import-offline]] e [[clone-atlas]].

Contrato de fidelidade (P11): toda adição ao transform local→servidor precisa de contrapartida no `applyRemoteSnapshot`, senão o dado vai e não volta. Ver [[snapshot-e-pull-incremental]] e [[aplicacao-operacoes-remotas]].

## O boot NÃO reconecta o último atlas

O modelo mental errado mais persistente sobre esta página é o de uma função que reconectaria ao atlas do marcador no boot. **Ela não existe** (zero ocorrências de reconnectLastAtlas em `frontend/src/`), e planejar a partir dela produz código que duplica o Atlas Drive.

A precedência real é link público, depois deep link `?atlas=<uuid>`, depois `openAtlasChooserOnBoot` (`frontend/src/js/index.js`), que descarta o resíduo remoto e **abre o seletor**. A URL é a fonte de verdade do que reabrir; o marcador só decide o que descartar. O F5 reabre o atlas apenas porque `syncAtlasUrl` (`frontend/src/js/deep-link/atlas-url-sync.js`) mantém `?atlas=<uuid>` na barra de endereços enquanto há conexão, e a limpa assim que a sessão deixa de estar autenticada.

> [!CONTRADICAO 2026-07-18] RESOLVIDO 2026-07-24: o comentário de boot em `frontend/src/js/index.js` descrevia "otherwise reconnect the last remote atlas for a restored authenticated session", mas o código chama `openAtlasChooserOnBoot`. O comentário passou a dizer que o boot **não** reconecta sozinho e que o caminho é o seletor.

Ver [[sessao-boot-e-ciclo-de-vida]] e [[autenticacao-jwt]].

## Histórico

- **2026-08-15.** Namespacing por atlas deixou de ser alternativa rejeitada e passou a existir, então três afirmações desta página foram reescritas acima: "um único IndexedDB", "namespacing foi rejeitado" e "não existem múltiplos atlas locais nomeados (P12)". Não é contradição, é supersessão: o invariante que a rejeição protegia continua valendo, agora por registro mais expurgo derivado. Junto caíram duas armadilhas que o código já não tem, o `atlasId` como campo morto e as duas listas paralelas de clear. O não-objetivo P12 estava replicado em [[sintese-decisoes-arquiteturais]], [[atlas-modelo-de-dados]], [[modos-operacao]] e [[formato-ebgeo-roundtrip]], que foram corrigidas na mesma data; a lição é que um não-objetivo repetido em cinco páginas custa cinco edições quando cai.
