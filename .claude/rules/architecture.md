# Arquitetura: o núcleo

Este arquivo e [testing.md](testing.md) carregam em toda sessão. Os outros arquivos desta pasta têm `paths:` no cabeçalho e só entram no contexto quando um arquivo da área deles é LIDO (grep não dispara), e saem na compactação: depois de um `/compact`, releia um arquivo da área antes de mexer nela. O índice no fim diz onde mora cada seção que já morou aqui, e é por ele que se resolvem as citações antigas espalhadas pelo código ("`architecture.md` §Lock", "§Sync" e afins).

## Project Structure

Um `ls frontend/src/js/` conta a estrutura melhor que qualquer árvore aqui. O que a listagem não conta:

- **Entrada**: `index.js` (boot, fail-fast em `GET /api/config`) e `map_sig.js` (init do mapa e registro de controles). Ferramenta nova toca QUATRO sítios de edição em `map_sig.js`, dois deles literais `controls:` gêmeos que nada prende um ao outro; a lista está na skill `new-tool`, e só lá.

- **`store/`** é o núcleo. `store.js` é fachada que reexporta as `*.operations.js`; `services.js` é o container de DI e precisa de `initServices()` antes de qualquer componente. Dois arquivos load-bearing: `feature-type.registry.js` (onde um tipo de feição NASCE, e de onde `store.constants.js` deriva; ver [ferramentas-e-tipos-de-feicao.md](ferramentas-e-tipos-de-feicao.md)) e `store-origin.js` (o marcador que separa local de remoto, base de quase todo comportamento de sync).

- As quatro pastas sem barrel e as cinco páginas estão na constituição. Chunk, página e vendor: [paginas-e-chunks.md](paginas-e-chunks.md).

## UI Architecture

- **StateManager** enforces mutual exclusivity: sidebar and feature panel cannot both be open

- UI components subscribe to `UI_LAYOUT_CHANGED` for position updates

- `selectFeature()` (`state_manager.js`) replaces the active selection set; the feature panel opens/closes via `FEATURE_PANEL_OPENED/CLOSED`, not by `selectFeature` itself

**Afordância negada: o POSTO some, o ESTADO recusa o clique** (decisão do dono, 2026-08-24, registrada em [`../../docs/decisions/decisions-2026.md`](../../docs/decisions/decisions-2026.md)). Bloqueio por POSTO é permanente enquanto o papel for o que é, e não há nada que a pessoa possa fazer daquela tela: o comando **não é desenhado** (modelo: `cardMenuActions` e `visibleAtlasActions`, em `frontend/src/js/sidebar/tabs/atlas-actions.js`). Bloqueio por ESTADO é reversível, e a pessoa pode ser justamente quem o reverte (mapa travado, atlas local, offline): o comando **é desenhado e o clique recusa nomeando o estado** (modelo: `CommentOverlay.togglePlacement`; a tabela de decisão do menu por mapa é `frontend/src/js/sidebar/tabs/map-menu-actions.js`). A assimetria é o desenho: antes os dois escondiam, e o menu de um Leitor era idêntico ao do dono de um mapa TRAVADO, sem que nenhum dos dois aprendesse nada.

Duas consequências que não se adivinham: use `aria-disabled` e **nunca** a propriedade `disabled` no comando bloqueado por estado, porque um botão desabilitado não dispara clique e o clique É como o motivo chega à pessoa; e a frase da recusa vem de `denialNotice` (`frontend/src/js/store/denial-phrases.js`), keyed pela CAPACIDADE que o gate consultou (`checkPermission(...).required`), nunca por papel. A sentença única anterior ("acesso somente leitura") era falsa para todo degrau acima de Visualizador.

**Uma exceção decidida, e ela é de MODIFICADOR, não de comando:** o interruptor de snap some também no mapa travado, e não só pelo posto (dono, 2026-09-22). O argumento é o da alça de continuação de linha ([ferramentas-e-tipos-de-feicao.md](ferramentas-e-tipos-de-feicao.md)): o snap modifica o desenho, com o mapa travado todas as ferramentas que ele modifica já sumiram, e desenhá-lo com `aria-disabled` faria dele a única superfície acionável de uma barra inerte. Enquanto escondido ele não age, e a preferência da pessoa não é escrita. A regra mora em `frontend/src/js/snapping/snap-availability.js`; não a "conserte" para desenhar e recusar.

**E uma exceção de FAMÍLIA: os painéis laterais escondem também pela trava** (dono, 2026-09-25). Painel de feição, tabela de atributos, lista de camadas, notas do mapa e processamento perguntam por `semEdicaoSync` ou `edicaoIndisponivelSync` e tiram o comando de edição nos dois eixos, acompanhando ao vivo por `assinarEdicaoIndisponivel`; o motivo, quando o painel o diz, vai em texto, não num botão inerte. Desenhar e recusar continua sendo a regra do menu por mapa (`frontend/src/js/sidebar/tabs/map-menu-actions.js`), onde o cadeado está ao lado dos comandos.

## Data Model

**Atlas** (container de projeto) → **Maps** (workspaces) → **Layers** (contêiner de feições, com `visivel`/`bloqueado`) → **Features**.

O metadado de sync **não é uniforme entre entidades**: Atlas, Map e Group carregam SETE campos (`createdAt`, `updatedAt`, `version`, `ownerId`, `dirty`, `deleted`, `deletedAt`), enquanto **feição e CAMADA carregam só três** (`createdAt`, `updatedAt`, `version`), postos por `addCreatedTimestamp` (`frontend/src/js/store/feature.operations.js`) e no ponto de criação de `frontend/src/js/layers/layer.manager.js`. Camada do lado dos três é o que surpreende, porque ela é entidade de escrita incremental por sync, com op própria: código que espere `ownerId`, `dirty` ou `deleted` numa camada lê `undefined`, sem erro. As cinco entidades estão declaradas no `fileoverview` de `frontend/src/js/store/sync/index.js`.

**Getter SÍNCRONO do barril `@store` significa leitura de `memoryStore`, e `memoryStore` é hidratado UM MAPA POR VEZ.** `setCurrentMap` chama `loadGroupsToMemory` e `loadLayersToMemory` para o mapa CORRENTE, e nada carrega os demais no boot: quem precisa do dado de um mapa que não é o corrente tem de usar o gêmeo ASSÍNCRONO de repositório (`getMapGroupsFromDB` no lugar de `getMapGroups`, `getLayersRepo` no lugar de `getLayers`). As duas formas de falha são diferentes, e a de camada é a pior: grupo falha FECHADO (vem vazio, e a seção some do documento), camada falha ABERTO, porque `_resolveMap` passa por `_ensureMapLayersExist`, que é ajudante de ESCRITA, então o caminho de LEITURA FABRICA uma camada `getDefaultLayer` para mapa não carregado e a ausência de camada fica indistinguível de uma camada padrão real. A classe é INTERMITENTE POR SESSÃO, que é o que a torna difícil de acreditar: `importMapGroups` povoa a memória de grupos de TODOS os mapas por efeito colateral, enquanto o irmão de camada só escreve o mapa corrente, de modo que importar e exportar na mesma sessão esconde a metade de grupo do defeito e só um F5 no meio revela as duas. Medido em 2026-09-01 na saída de `.ebgeo` e no envio ao servidor: um atlas de 11 mapas subia com 11 camadas de 17 e ZERO grupos de 2, sem um erro em lugar nenhum. Ler do repositório traz uma consequência que anda junto: a escrita de camada é adiada por `DebouncedPersist`, então quem lê para exportar descarrega antes, por `flushPendingLayerWrites` (`buildExportDataObject` o faz uma vez), senão a troca compra a perda grande pagando com uma pequena. Guarda: `frontend/tests/integration/export-le-do-repositorio.test.js`.

**A TRAVA DE OUTRO MAPA CAI NA MESMA ARMADILHA, e a assimetria é local contra remoto.** `memoryStore.lockedMaps` só é COMPLETO em atlas de SERVIDOR, onde o snapshot traz a trava de todo mapa; em atlas LOCAL apenas o mapa corrente chega a entrar nele, porque só `toggleMapLock` o escreve. Perguntar ao conjunto sobre OUTRO mapa responde "destravado" para um mapa travado, em silêncio e só em atlas local, que é a metade do produto onde ninguém procura defeito de trava. A pergunta certa sobre outro mapa é a ASSÍNCRONA `isMapLocked`, que lê o app setting do disco; `isCurrentMapLockedSync` continua certa para o mapa corrente, que é exatamente a entrada que o conjunto tem. Guarda: o caso de destino travado em `frontend/tests/store/layer-transfer.test.js`, que deixa o conjunto VAZIO de propósito e mesmo assim exige a recusa.

O resto do modelo (propriedades de camada e briefing, contagem de cores, dado temporal por feição, `transferLayerToMap`) está em [modelo-de-dados.md](modelo-de-dados.md).

## Permissão no cliente

`frontend/src/js/store/sync/session-context.js` carrega DOIS vocabulários homônimos e sem parentesco. `UserRole` é o eixo POR ATLAS e tem SEIS valores (`owner`, `admin`, `manager`, `editor`, `commenter`, `viewer`), porque dobra o `admin` GLOBAL para dentro da escada de CINCO do servidor (`read < comment < write < manage < owner`, a mesma que a API devolve como `user_permission`). A tradução é `toFrontendRole` (`backend/src/utils/roles.js`), chamada pelo gateway de colaboração e pelo controlador de compartilhamento. `GlobalRole` é o eixo GLOBAL (`user`, `producer`, `credenciado`, `admin`), lido por `isAdmin()`, `isProducer()`, `canProduceFor()` e `hasGlobalDataAccess()`. `UserRole.ADMIN` e `GlobalRole.ADMIN` são a mesma string em eixos diferentes.

- A **única** implementação da hierarquia é `frontend/src/js/projects/permission-levels.js` (`PERMISSION_ORDER`, `permissionRank`, `hasAtLeast`), sobre os cinco valores do servidor. `ROLE_PERMISSIONS` é tabela de FLAGS por papel, sem ordem: gatear a partir dela acaba em igualdade, que é a lista fechada proibida.

- `canDeleteMap` é flag SEPARADA de `canDelete`, e a separação é contrato com o servidor (`operationDenialReason`): juntá-las fazia o cliente oferecer um botão que o servidor recusava, e a op recusada congelava a fila de saída.

- O gate por papel só vale em atlas remoto CONECTADO; o store local é sempre editável, logado ou não. Offline é `clientId` anônimo com permissão local total.

## Boot

**Roteamento do boot, em ordem** (`index.js`, e a ordem É o contrato): antes de tudo, um visitante COM sessão numa URL nua vai para `atlas.html` por `window.location.replace` (`shouldRouteToProjects`), e só ele; depois, já no mapa, a cadeia é `openPublicAtlasFromUrl` (`?atlasPublico=`) → `openAtlasFromUrl` (`?atlas=`) → `enterLocalMapOnBoot` ("Mapa local") → `openAtlasChooserOnBoot`. Cada uma retorna cedo se assumiu o boot. Anônimo fica no mapa de propósito: o mapa É o produto para quem não entrou. `?verify=` (confirmação de e-mail) é consumido antes da cadeia, e `#view=3d/360` tem precedência absoluta no caminho de load do mapa.

## Application Modes

`NORMAL` (default) | `BRIEFING_EDIT` | `BRIEFING_PRESENT`, geridos por `ApplicationModeManager` (`mode/application-mode.manager.js`); a troca de modo dirige perfis de visibilidade da UI.

## Event Types Reference

A lista canônica é `frontend/src/js/events/event_types.js`, acessada por `EventTypes.XXX` (nunca string literal). Ficam os dois pontos que a leitura do arquivo não entrega:

- **`FEATURE_MODIFIED` vs `FEATURE_UPDATED`.** O JSDoc do enum descreve o segundo como mudança de user-data, atributo ou imagem, e o primeiro como a mudança da feição em si (payload com `previousFeature`). O que a leitura do código acrescenta, e contraria a intuição: em `frontend/src/`, o ÚNICO ponto que emite `FEATURE_MODIFIED` é `store/sync/remote-operation-handler.js`, ou seja, op REMOTA chegando. Edição local não o emite; todos os outros pontos que citam o nome são assinantes ou listas de gatilho (`sync-flush.js`, `phone/phone-layout.js`, `layers/remote-feature-render.js`, `store/sync/diag/bus-tap.js`). Se isso é o desenho ou um defeito está sob diagnóstico, e nesta revisão fica só o fato verificado: quem assinar `FEATURE_MODIFIED` esperando pegar a edição do próprio usuário não pega nada.

- **TRÊS vocabulários de evento vivem FORA de `event_types.js`**, e procurar no arquivo errado dá a impressão de que não existem: `StoreErrorEvents` (`STORE_PERSIST_ERROR`, `STORE_SYNC_ERROR`, `STORE_OPERATION_BLOCKED`) em `frontend/src/js/store/store-errors.js`; `ApplicationModeEvents` (`MODE_CHANGED`, `VIEWER_MODE_CHANGED`) em `frontend/src/js/mode/application-mode.manager.js`; e `UIVisibilityEvents` (`PROFILE_CHANGED`) em `frontend/src/js/ui/ui-visibility.controller.js`. Os dois últimos são emitidos no MESMO barramento dos demais, então a separação é de arquivo, não de canal.

## Duas convenções curtas

- **CSS novo do mapa entra por `@import` em `frontend/src/css/style.css`**, que é o único arquivo que `index.html` liga. Importar o CSS de dentro do módulo JS funciona no Vite e diverge da casa; a asserção de fiação mira o MANIFESTO, porque é ele que decide se a regra chega ao navegador.

- **Tabela de frase indexada por valor vindo da URL se lê com `Object.hasOwn`.** `ARRIVAL_NOTICES[code] ?? null` devolvia `Object.prototype.toString` para `?aviso=toString`, e `Object.freeze` não protege disso.

## Índice das regras com escopo

Cada arquivo carrega quando um arquivo que casa com os `paths:` dele é lido. A lista de padrões está no cabeçalho de cada um; aqui fica o que mora em cada, com o nome da seção de onde veio.

| arquivo | assunto (seção de origem) |
|---|---|
| [sync-e-colaboracao.md](sync-e-colaboracao.md) | transporte, fila, lote, blob, trava, SyncLedger (§Sync / Real-Time Collaboration, §Lock, membresia de grupo) |
| [recurso-privado.md](recurso-privado.md) | catálogo privado, tile, empréstimo, painel de falha de camada (§Recurso privado do catálogo) |
| [atlas-namespace-e-tab-lock.md](atlas-namespace-e-tab-lock.md) | bancos por atlas, geração, expurgo, tab-lock, barreira de logout (§Atlas, namespace e tab-lock) |
| [modelo-de-dados.md](modelo-de-dados.md) | propriedades, contagem de cores, `transferLayerToMap` (resto do §Data Model) |
| [ferramentas-e-tipos-de-feicao.md](ferramentas-e-tipos-de-feicao.md) | registro de tipo, medição, etiqueta de ponto, continuação pela ponta (§Registro de tipo de feição, §Measurement Tools, §Point Label, §Continuar uma feição linear pela ponta) |
| [temporal.md](temporal.md) | linha do tempo, vista da pessoa, lente pura (§Temporal Module) |
| [painel-de-administracao.md](painel-de-administracao.md) | abas por audiência, concessões, frases de ato destrutivo (§O painel de administração) |
| [paginas-e-chunks.md](paginas-e-chunks.md) | as cinco páginas, grupos de chunk, vendors do npm, `keepNames` (§Páginas e chunks) |
| [visitante-e-metade-local.md](visitante-e-metade-local.md) | `atlas.html` sem servidor, visita pública, poda de saída (§O visitante e a metade local) |
| [common-tasks.md](common-tasks.md) | Street View 360 e calibração, conferência com o `ebgeo_360` |
| [algoritmo-de-processamento.md](algoritmo-de-processamento.md), [migracao-de-esquema.md](migracao-de-esquema.md), [exportacao-pdf.md](exportacao-pdf.md) | as três receitas que moravam em `common-tasks.md` |
