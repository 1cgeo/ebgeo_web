# Domínio local vs. domínio remoto (store-origin)

O IndexedDB do navegador guarda dois domínios rigidamente separados, um workspace local persistente e editável sem login, e uma cópia efêmera de um atlas do servidor descartada ao desconectar, discriminados pelo marcador de origem `store-origin.js` (`{kind: local|remote, atlasId}`).

## O problema que o marcador resolve

O EBGeo usa **um único store IndexedDB** para as duas realidades. Não há namespacing por atlas: o store guarda um atlas por vez, e trocar de atlas é destrutivo (desconecta, `clearAllDataStore`, conecta). Sem um discriminador, dado remoto que sobrevivesse ao logout ficaria editável offline, sem sincronizar com ninguém: o usuário acharia que colabora, mas estaria editando uma cópia morta. O marcador de origem é o que impede isso.

Regra de ouro para o usuário: para trabalhar offline em algo que veio do servidor, **baixe o `.ebgeo` antes de desconectar** (ver [[formato-ebgeo-roundtrip]]). Isso transforma o dado remoto em dado local.

## A API (`src/js/store/store-origin.js`)

| Função | O que faz |
|---|---|
| `loadStoreOrigin()` | Lê o marcador persistido para o espelho em memória. Chamar **uma vez no boot**, antes de qualquer leitura síncrona (`store-origin.js:44`). |
| `getStoreOriginSync()` | Lê o espelho em memória (`{kind, atlasId}`). |
| `isRemoteStoreSync()` | `true` quando o store guarda um atlas do servidor. É o predicado usado nos gates. |
| `markStoreRemote(atlasId)` / `markStoreLocal()` | Persistem a origem. |

Detalhes que importam:

- O marcador vive no appStore sob a chave `__store_origin__` (`store-origin.js:28`), via `getSettingCompat`/`setSettingCompat`.
- **Default é `local`** e o valor é **ausente** para todo usuário offline preexistente (`DEFAULT_ORIGIN`, `store-origin.js:31`). Qualquer erro de leitura ou valor malformado (sem campo `kind`) também cai em `local` (`store-origin.js:47-52`). Essa é a garantia aditiva: a maquinaria remota só engata depois de um connect explícito.
- Leituras são **síncronas** de propósito, porque rodam em caminhos quentes (guarda de permissão em toda escrita do store).
- **Armadilha:** `atlasId` é persistido mas **nenhum código de produção o lê** hoje. Só `kind` é consultado (`index.js:279`, `permission-guard.js:71`, `map-lock.controller.js:86`). O antigo `reconnectLastAtlas` sumiu; a reabertura do atlas é dirigida pela **URL** (`?atlas=<uuid>`), não pelo marcador. Não escreva código novo assumindo que `atlasId` é a fonte de verdade do atlas conectado, use `syncEngine.atlasId`.

## Onde o marcador é escrito

Todos os pontos de escrita seguem a mesma disciplina de ordem.

- **Abrir atlas do servidor** (`account/open-atlas.service.js:45-75`): confirma perda de dados locais, desconecta o anterior, `clearAllDataStore()`, **`markStoreRemote(atlasId)` ANTES do `connect`**, e só então `syncEngine.connect(atlasId, {initialPull:true})` + `activateAtlasInitialMap(mapId)`. Marcar antes é **intenção durável**: se a aba morrer no meio do pull do snapshot, o boot guard vê `remote` e descarta o parcial em vez de rotulá-lo como atlas local permanente.
- **Falha no connect** (403/404 ou queda): o `catch` faz `markStoreLocal()` e relança (`open-atlas.service.js:66-73`). Sem isso, um F5 ficaria retentando eternamente um atlas morto.
- **Seletor de projetos** (`account.control.js:790`) e **link público** (`index.js:230-233`) repetem o mesmo par `clearAllDataStore` → `markStoreRemote` → `connect`.
- **`clearAllDataStore()` sempre termina em `markStoreLocal()`** (`store.js:217`). Isso é obrigatório e não incidental: o clear apaga o appStore (`clearAllAppSettings`), o que apagaria o próprio marcador. A remarcação vem **depois** dos clears, nunca antes.
- **Logout** (`account.control.js:844-851`), **sessão perdida** (idle timeout / refresh falho) e **atlas excluído pelo dono** (`account.control.js:644-651`) convergem no mesmo destino: teardown, `clearAllDataStore()`, atlas local em branco.

## O boot guard

`enforceLocalStoreWhenLoggedOut()` (`store.js:137-156`) roda como **primeira linha** de `initializeWithLastActiveMap()` (`store.js:164`), antes de qualquer leitura do repositório:

```
loadStoreOrigin()
if (!isRemoteStoreSync() || sessionContext.isAuthenticated()) return;  // no-op
→ apaga tudo (maps, images, appSettings, groups, layers, cesium3d, streetview360,
  briefings, comments, atlas, fila de operações) e markStoreLocal()
```

A condição é dupla: **origem `remote` E ninguém autenticado**. Para o usuário offline de sempre a condição é falsa, então é literalmente um no-op, é assim que o princípio P1 (backend é aditivo) se sustenta. Note que a **fila outbound também é limpa** (`operationQueue.clear()`), senão operações não enviadas de um atlas abandonado vazariam para o próximo (ver [[fila-operacoes-outbound]] e [[fila-operacoes-pendentes]]).

## O que a origem gateia

`isRemoteStoreSync()` não é um detalhe de bookkeeping, é o interruptor de três comportamentos:

1. **Permissões.** `checkPermission` libera tudo quando `sessionContext.isOffline() || !isRemoteStoreSync()` (`permission-guard.js:71`). O papel por atlas (visualizador/comentarista/editor/gestor) **só vale em atlas remoto conectado**; o store local é sempre editável, inclusive por um usuário logado cujo papel global seria restritivo. Ver [[permissoes-atlas]] e [[permissao-vs-papel]].
2. **Modo somente-leitura.** `MapLockController.isReadOnly()` retorna `false` de saída quando `!isRemoteStoreSync()` (`map-lock.controller.js:86`); só em atlas remoto um viewer/comentarista vê o cadeado não-alternável.
3. **Guarda de destruição.** Todo caminho que substitui o store (`openRemoteAtlas`, `openProjectPicker`) só pede confirmação "isso apaga seus dados locais, baixe um `.ebgeo`" quando `!isRemoteStoreSync() && await hasAnyMapFeatures()`, ou seja, quando o que será destruído é trabalho **local** insubstituível. Dado remoto é descartável por definição, o servidor é a fonte da verdade.

## Isolamento e identidade de mapa

O marcador cobre local↔remoto, mas **não** cobre remoto↔remoto. O isolamento entre atlas vem de outro lugar: um store por vez + clear destrutivo na troca, e no servidor uma sala por atlas com guarda IDOR (ver [[atlas]], [[atlas-modelo-de-dados]]).

Há uma armadilha específica de chaveamento: mapas de atlas remotos são chaveados por **UUID**, o mapa local padrão `Principal` é chaveado por **nome**. Duas defesas decorrem disso:

- Operações cujo `mapId` de contexto não é UUID são **descartadas antes de entrar na fila** (`operation-dispatcher.js:130-140`, span `preflush.drop` com razão `NON_UUID_MAPID`). Isso impede vazamento de feição local para o servidor e, tão importante quanto, impede que **uma** operação inválida faça o backend rejeitar (Postgres 22P02) o **lote inteiro** de flush e travar toda a sincronização. O mesmo vale para ops de `SETTING` com id não-UUID e diferente do sentinela `'atlas'` (`operation-dispatcher.js:120`).
- Ao ativar o mapa inicial de um atlas conectado, `activateAtlasInitialMap` remove os mapas locais não-UUID, senão o `Principal` recriado no boot sombraria, nas leituras por nome, um mapa remoto homônimo, e o usuário cairia num mapa vazio.

Ver [[envelope-operacao]] e [[syncledger]] para diagnosticar drops.

## Pontes entre os domínios

- **Remoto → local:** "Salvar projeto" exporta o estado conectado como `.ebgeo`. É a única forma suportada de levar um atlas do servidor para uso offline.
- **Local → remoto:** "Salvar no servidor" (`import_export/save-local-atlas.service.js`) empacota o workspace local, faz o transform, `POST /atlas/import` preservando IDs de entidade do cliente, sobe imagens preservando id, e então `clearAllDataStore` + `markStoreRemote` + `connect`. Ver [[atlas-import-offline]] e [[clone-atlas]].

A fidelidade de ida e volta (P11) exige que toda adição ao transform local→servidor tenha contrapartida no `applyRemoteSnapshot` (ver [[snapshot-e-pull-incremental]], [[aplicacao-operacoes-remotas]]).

## Não-objetivo deliberado: múltiplos atlas locais nomeados

O modelo local é **um workspace + arquivos `.ebgeo`**. "Atlas nomeado" é conceito de servidor. Namespacing por atlas no IndexedDB seria um refactor pesado da persistência **sem ganho de princípio**, já que a separação local↔remoto já é garantida pelo marcador, e só adicionaria risco ao caso de uso offline. Isso é P12 e é decisão fechada, não backlog.

## Divergências entre documentação e código

> [!CONTRADICAO 2026-07-18] `docs/visao-e-principios.md` §4 (passo 4) diz que o boot "reconecta o último atlas remoto (`reconnectLastAtlas`) se houver sessão restaurada e origem `remote`". Não existe mais `reconnectLastAtlas` no código. Em `src/js/index.js:157-160` a precedência é: link público (`?atlasPublico=`) → deep link `?atlas=<uuid>` (`openAtlasFromUrl`) → senão `openAtlasChooserOnBoot()`, que em `index.js:279-281` faz `loadStoreOrigin()` e, se a origem for `remote`, chama `clearAllDataStore()` e **abre o seletor de projetos**. Ou seja, a URL é a fonte de verdade do que reabrir; o marcador serve apenas para descartar o resíduo remoto.

> [!CONTRADICAO 2026-07-18] `docs/ui-ux-ebgeo.md` §2 diz "O boot não passa pelo Drive: F5 reconecta o último atlas automaticamente". Em `src/js/index.js:272-283`, um boot autenticado numa URL nua (`/`) **abre** o Atlas Drive e descarta o dado remoto anterior. O F5 só reabre o atlas porque `deep-link/atlas-url-sync.js:31-35` mantém `?atlas=<uuid>` escrito na barra de endereços enquanto há conexão.

> [!CONTRADICAO 2026-07-18] O comentário de boot em `src/js/index.js:148` ainda descreve "otherwise reconnect the last remote atlas for a restored authenticated session", mas a linha `index.js:160` chama `openAtlasChooserOnBoot()`. Comentário desatualizado, o comportamento é o seletor.

Ver [[sessao-boot-e-ciclo-de-vida]] para a sequência completa de boot e [[autenticacao-jwt]] para a restauração de sessão.

## Checklist para não errar

- Precisa saber se pode escrever? Use `checkPermission`, não `sessionContext.role` cru, e nunca esqueça que local é sempre editável.
- Adicionou um novo side-store persistido? Ele precisa entrar em **`clearAllDataStore` e em `enforceLocalStoreWhenLoggedOut`** (as duas listas são paralelas e precisam ficar em sincronia), senão dado remoto sobrevive ao logout (violação da invariante 2).
- Vai marcar `remote`? Marque **antes** do `connect` e reverta para `local` no `catch`.
- Vai limpar o store? `markStoreLocal()` depois dos clears, nunca antes.
- Adicionou um dado que entra no `.ebgeo`? Ele precisa ter caminho de sincronização (P9) e voltar no snapshot (P11).

## Fontes
- `docs/visao-e-principios.md`: os dois domínios (§2), princípios P1/P2/P3/P4/P9/P11/P12, ciclo de vida de boot/login/logout (§4), pontes entre modos (§5), isolamento e chaveamento por UUID (§6), invariantes (§9).
- `docs/ui-ux-ebgeo.md`: estados de sessão, URL como fonte de verdade, Atlas Drive, modo de visualização segura, decisão do workspace único (§10).
- `src/js/store/store-origin.js`: API, chave `__store_origin__`, default LOCAL e fallback em erro.
- `src/js/store/store.js:137-218`: boot guard `enforceLocalStoreWhenLoggedOut` e `clearAllDataStore` (incluindo a ordem clear → `markStoreLocal`).
- `src/js/account/open-atlas.service.js` e `src/js/account/account.control.js`: marcar remoto antes do connect, reverter no erro, guardas de confirmação, logout e atlas excluído.
- `src/js/index.js:148-283`: precedência de roteamento de boot e `openAtlasChooserOnBoot` (base das contradições registradas).
- `src/js/store/sync/permission-guard.js:71` e `src/js/locking/map-lock.controller.js:86`: gates que dependem de `isRemoteStoreSync()`.
- `src/js/store/sync/operation-dispatcher.js:108-140`: descarte pré-flush de ops com `mapId`/`settingId` não-UUID.
- `tests/store/store-origin.test.js`: comportamento pinado (default LOCAL, persistência do `atlasId`, fallback em valor malformado).
