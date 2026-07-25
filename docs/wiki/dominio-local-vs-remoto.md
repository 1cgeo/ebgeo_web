# Domínio local vs. domínio remoto (store-origin)

Um único IndexedDB guarda dois domínios, o workspace local permanente e a cópia efêmera de um atlas do servidor, discriminados por um marcador de origem (`frontend/src/js/store/store-origin.js`) e não por namespacing.

## Por que um marcador e não namespacing por atlas

Namespacing responderia "onde este dado mora". A pergunta que importa é outra: *este dado tem direito de continuar existindo aqui?* Dado de atlas remoto é temporário por definição, precisa sumir no logout. Um namespace o preservaria intacto e editável offline, e o usuário acharia que colabora enquanto edita uma cópia morta.

Namespacing seria ainda um refactor pesado da persistência sem ganho de princípio, já que a separação local↔remoto já está garantida, e só adicionaria risco ao caso offline. Daí o não-objetivo deliberado (P12): **não existem múltiplos atlas locais nomeados**. O modelo local é um workspace mais arquivos `.ebgeo`; "atlas nomeado" é conceito de servidor. Decisão fechada, não backlog.

Consequência prática para o usuário: trocar de atlas é destrutivo. Para trabalhar offline em algo do servidor, **baixe o `.ebgeo` antes de desconectar** (ver [[formato-ebgeo-roundtrip]]).

## Ordem, que é onde está a corretude

Duas ordens não são estilo, são o que torna o crash seguro:

- **`markStoreRemote` ANTES do `connect`** (`frontend/src/js/account/open-atlas.service.js:60`). É intenção durável: se a aba morrer no meio do pull, o boot guard vê `remote` e descarta o parcial em vez de promovê-lo a atlas local permanente. E o `catch` reverte para `markStoreLocal()` (`frontend/src/js/account/open-atlas.service.js:69`), senão um F5 retentaria eternamente um atlas morto (403/404).
- **`markStoreLocal()` DEPOIS dos clears** (`frontend/src/js/store/store.js:213`). `clearAllDataStore` apaga o appStore, onde o próprio marcador mora. Marcar antes seria apagar a marcação.

## Armadilhas

**`atlasId` é campo morto.** O marcador persiste `{kind, atlasId}` e há teste pinando a persistência (`frontend/tests/store/store-origin.test.js:42`), mas **nenhum código de produção lê `atlasId`**: só `kind` é consultado (`frontend/src/js/index.js:279`, `frontend/src/js/store/sync/permission-guard.js:71`, `frontend/src/js/locking/map-lock.controller.js:86`, `frontend/src/js/store/store.js:139`). Não escreva código novo assumindo que ele é a fonte de verdade do atlas conectado, use `syncEngine.atlasId`.

**Duas listas paralelas de clear.** `clearAllDataStore` e `enforceLocalStoreWhenLoggedOut` (`frontend/src/js/store/store.js:137`) apagam o mesmo conjunto de side-stores em código duplicado. Adicionou um side-store persistido? Ele tem que entrar nas **duas**, senão dado remoto sobrevive ao logout. O código não força isso de forma alguma.

**Replique a cláusula local em todo gate por papel.** `checkPermission` libera tudo quando `!isRemoteStoreSync()` (`frontend/src/js/store/sync/permission-guard.js:71`) e `isReadOnly()` retorna `false` de saída (`frontend/src/js/locking/map-lock.controller.js:86`). Um gate novo que consulte `sessionContext.role` cru quebra a edição do workspace local de um usuário logado cujo papel global seja restritivo. Ver [[permissoes-atlas]].

**Confirmação destrutiva só protege o local.** O par `!isRemoteStoreSync() && await hasAnyMapFeatures()` é o que dispara o aviso "baixe um `.ebgeo`". Dado remoto é descartável porque o servidor é a fonte da verdade; inverter esse teste destruiria trabalho insubstituível em silêncio.

## O anti-leak do `Principal` (comportamento que atravessa quatro arquivos)

O marcador cobre local↔remoto, **não** cobre remoto↔remoto. O isolamento entre atlas vem de outro lugar: um store por vez, clear destrutivo na troca, e uma sala por atlas com guarda IDOR no servidor (ver [[atlas-modelo-de-dados]]).

A raiz do problema é um chaveamento misto que nenhum arquivo declara sozinho: mapas de atlas remoto são chaveados por **UUID**, o mapa local padrão `Principal` é chaveado por **nome**. Quatro defesas independentes decorrem disso, e cada uma parece arbitrária lida isoladamente:

1. **Poison pill no flush.** O backend rejeita `mapId` não-UUID com Postgres 22P02, e **uma op ruim derruba o lote inteiro**, travando todo o sync. Por isso `frontend/src/js/store/sync/operation-dispatcher.js` descarta antes de enfileirar (`:120`, `:133`, `:192`, `:266`). Ops atlas-level passam `mapId = null` e não são afetadas.
2. **Sombreamento no connect.** Leitura por nome acerta direto a chave de armazenamento: um `Principal` local coexistindo com um mapa de atlas homônimo faz `repo.getMap('Principal')` acertar o **stray vazio**. `activateAtlasInitialMap` apaga strays não-UUID antes de resolver (`frontend/src/js/store/map.operations.js:363`).
3. **Criação com sync ativo.** `addMap` nasce UUID-keyed quando o logging está ligado (`frontend/src/js/store/map.operations.js:184`), senão uma reaplicação de snapshot duplicaria o mapa em vez de atualizá-lo.
4. **Exibição.** `getAllMapNamesStore` resolve UUID→nome (`frontend/src/js/store/map.operations.js:102`), senão o mapa de um peer aparece como UUID cru.

Detalhe fácil de quebrar: `setCurrentMap` recebe o **nome**, nunca a chave UUID, porque presença e cursores usam `mapId` por nome e peers filtram um UUID cru (ver [[presenca-colaborativa]]). Regra geral: nunca assuma que a chave de um mapa é o nome nem que é UUID, resolva pelo `mapResolver`.

Ao depurar "editei e nada sincronizou": todo drop emite span `preflush.drop` com `reason` no [[syncledger]], mas **logging desabilitado (offline/anônimo) também produz `preflush.drop`**, com `reason: logging_disabled` (`frontend/src/js/store/sync/operation-dispatcher.js:106`). Distinga as duas causas. Ver [[envelope-operacao]] e [[fila-operacoes-outbound]].

Uma chave de setting que seja view state por cliente (`lastActiveMap`) não deve virar op: seria descartada por `non_uuid_setting_id` de qualquer forma, e enfileirá-la só polui a fila.

## Pontes entre os domínios

Remoto → local é "Salvar projeto" (exporta `.ebgeo`), a única forma suportada de levar um atlas do servidor para uso offline. Local → remoto é `frontend/src/js/import_export/save-local-atlas.service.js`, que **não** conecta: o serviço empacota e importa preservando IDs do cliente, e o chamador da UI faz `clearAllDataStore` + `markStoreRemote` + `connect` depois (`frontend/src/js/import_export/save-local-atlas.service.js:11`). Ver [[atlas-import-offline]] e [[clone-atlas]].

Contrato de fidelidade (P11): toda adição ao transform local→servidor precisa de contrapartida no `applyRemoteSnapshot`, senão o dado vai e não volta. Ver [[snapshot-e-pull-incremental]] e [[aplicacao-operacoes-remotas]].

## Divergências entre documentação e código

> **Nota histórica.** Guias absorvidos (*visao-e-principios* §4, *arquitetura-sync* §7.4) descrevem um `reconnectLastAtlas()` que reconectaria ao atlas do marcador no boot. **Essa função não existe.** A precedência real é link público → deep link `?atlas=<uuid>` → `openAtlasChooserOnBoot()` (`frontend/src/js/index.js:157-160`), que descarta o resíduo remoto e **abre o seletor**. A URL é a fonte de verdade do que reabrir; o marcador só decide o que descartar. Não há reconexão silenciosa.

> **Nota histórica.** Guia *ui-ux-ebgeo* §2 diz "o boot não passa pelo Drive: F5 reconecta o último atlas". Um boot autenticado em URL nua (`/`) **abre** o Atlas Drive (`frontend/src/js/index.js:272-283`). O F5 só reabre o atlas porque `deep-link/atlas-url-sync.js:31-35` mantém `?atlas=<uuid>` na barra de endereços enquanto há conexão.

> [!CONTRADICAO 2026-07-18 — RESOLVIDO 2026-07-24] O comentário de boot em `frontend/src/js/index.js:148` descrevia "otherwise reconnect the last remote atlas for a restored authenticated session", mas o código chama `openAtlasChooserOnBoot()`. O comentário passou a dizer que o boot **não** reconecta sozinho e que o caminho é o seletor.

Ver [[sessao-boot-e-ciclo-de-vida]] e [[autenticacao-jwt]].
