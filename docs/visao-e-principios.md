# EBGeo Web — Visão de Funcionamento e Princípios

Este documento descreve **como o sistema deve funcionar** e os **princípios** que guiam a
integração com o backend. Ele existe para que ninguém, ao evoluir o produto, quebre os casos de
uso que já estão em operação — em especial o **usuário que trabalha 100% offline**.

O ponto central: **login e backend são uma CAMADA ADITIVA.** Tudo que funcionava sem servidor
continua funcionando idêntico. O modo conectado é uma capacidade a mais, nunca um pré-requisito.

**Norte do produto: o "Google Docs / Google Sheets dos mapas".** Vários usuários editam o mesmo
atlas ao vivo, sem locks, com presença em tempo real e resolução automática de conflitos. A
colaboração é fluida: ninguém trava esperando o outro, cada um desfaz as próprias ações, e o
trabalho converge sozinho.

> Documentos relacionados: arquitetura do cliente em [`.claude/rules/architecture.md`](../.claude/rules/architecture.md)
> (seção *Sync / Real-Time Collaboration*); contrato e rotas do servidor em [`backend/README.md`](../backend/README.md);
> mapeamento ação-a-ação em [`acoes-interface-multiusuario.md`](./acoes-interface-multiusuario.md).

---

## 1. Os três modos de uso (personas)

| Persona | Como trabalha | Onde ficam os dados | Compartilhamento |
|---------|---------------|---------------------|------------------|
| **Offline puro** (nunca loga) | Sempre local, anônimo | IndexedDB do navegador | Arquivos `.ebgeo` (exportar/importar) |
| **Online puro** (sempre logado) | Múltiplos atlas **remotos**, colaboração em tempo real | Servidor (PostgreSQL); cópia **temporária** no IndexedDB enquanto conectado | Compartilhamento por usuário (papéis — §11) + link público |
| **Híbrido** | Alterna entre trabalho local e atlas remotos | Os dois domínios, **separados** | `.ebgeo` **e** servidor |

O sistema precisa ser **idêntico e estável** para os três, e oferecer **ferramentas de transição**
entre os modos (seção 5). Nenhuma funcionalidade do caminho offline pode depender do servidor.

---

## 2. Dois domínios de dados: o que persiste vs o que é temporário

Há **dois domínios** claramente separados de armazenamento no navegador:

```
┌─────────────────────────────────────┐     ┌─────────────────────────────────────┐
│  DOMÍNIO LOCAL (persistente)         │     │  DOMÍNIO REMOTO (efêmero)           │
│  ─ "atlas geral deslogado" + atlas   │     │  ─ um atlas do servidor, baixado    │
│    locais (hoje: 1 por vez)          │     │    para edição colaborativa         │
│  ─ VIVE no IndexedDB da máquina      │     │  ─ só existe ENQUANTO conectado     │
│  ─ Persiste entre sessões e F5       │     │  ─ DESCARTADO ao desconectar/sair   │
│  ─ Editável SEM login                │     │  ─ NÃO editável deslogado            │
│  ─ Salvo/movido via .ebgeo           │     │  ─ Fonte da verdade = servidor      │
└─────────────────────────────────────┘     └─────────────────────────────────────┘
                    ▲                                           ▲
                    └──────────  marcador de origem  ───────────┘
                       store-origin.js: { kind: 'local' | 'remote', atlasId }
```

O discriminador é um **marcador de origem** persistido (`src/js/store/store-origin.js`):

- **Padrão `local`** — e **ausente** para todo usuário offline já existente. Por isso a camada
  remota **nunca** interfere em quem nunca logou.
- Vira `remote` apenas após uma conexão bem-sucedida a um atlas do servidor.
- Ao desconectar/sair, os dados remotos são apagados e a origem volta a `local`.

**Por que separar:** dado remoto que ficasse no IndexedDB depois do logout seria editável offline,
sem sincronizar com ninguém — o usuário acharia que está colaborando, mas estaria editando uma
cópia morta. A regra é: para trabalhar offline em algo que veio do servidor, **baixe o `.ebgeo`**
(isso o transforma num atlas local).

---

## 3. Princípios fundamentais

### P1 — O backend é aditivo; o offline nunca quebra
O caminho anônimo/offline (IndexedDB + `.ebgeo`) é o **piso garantido**. Mecanismos: o marcador de
origem é `local` por padrão; o *boot guard* (§4) só age sobre dado remoto órfão e é **no-op** para o
usuário local; o log de operações e o flush são **gated** por conexão online
(`operation-dispatcher.js`, `sync-flush.js`). Sem login, nada é transmitido e nada muda.
> **O store local é sempre editável** — inclusive por um usuário **logado** que ainda não abriu um
> atlas do servidor. O `permission-guard` só aplica o papel (viewer/editor/…) quando se está conectado
> a um atlas **remoto**; no store local todos têm controle total (`sessionContext.isOffline() ||
> !isRemoteStoreSync()` libera). Sem isso, um usuário logado com papel global `viewer` não conseguiria
> nem desenhar localmente.

### P2 — Separação rígida entre "persiste na máquina" e "persiste por causa da conexão"
Ver §2. Implementado por `store-origin.js` + a marcação em `connect`/`logout`
(`account.control.js`) + o *boot guard* em `store.js`.

### P3 — Isolamento total entre atlas (nunca vazar dados)
Dados de um atlas **jamais** podem aparecer em outro — locais ou remotos. Ver §6.

### P4 — Migração sem quebra
A transição "sem backend → com backend" **não pode quebrar** os atlas que já existem hoje no
IndexedDB. Ver §8.

### P5 — Pontes entre os dois mundos
Tem que ser fácil **exportar um atlas do servidor como `.ebgeo`** e **levar trabalho local para o
servidor**. Ver §5.

### P6 — Resiliência a redes ruins
O uso conectado tem que sobreviver a sinal que cai e degrada. O modelo é **offline-first**: edita-se
localmente sempre, e a sincronização é uma fila que drena quando dá. Ver §7.

### P7 — Sessão resiliente
O login sobrevive a F5 até o JWT/refresh expirar, e a reconexão reabre o último atlas remoto sem o
usuário refazer o caminho. Ver §4.

### P8 — Undo/redo é LOCAL por usuário, nunca global
Ctrl+Z / Ctrl+Y desfazem/refazem apenas as ações **do próprio usuário**, na sua sessão. Uma operação
recebida de outro colaborador **jamais** entra na pilha de undo local — assim como no Google Docs,
cada um desfaz só o que fez. Mecanismo: `remote-operation-handler` aplica ops remotas **sem** registrar
undo; as pilhas de undo/redo são estado de UI por sessão (`store-state-manager`), nunca sincronizado.

### P9 — Tudo que persiste no `.ebgeo` também sincroniza
O conjunto de dados **sincronizados** deve ser um **superconjunto** do que entra num `.ebgeo`: mapas,
camadas, feições, **atributos**, **imagens**, briefings, **basemap**, **trajetória/temporal**,
**posição salva do mapa**, notas, grid, cores, ícones. Se algo vai para o `.ebgeo` mas não tem caminho
de sincronização, é um **bug de cobertura**. É isto que torna "Salvar local no servidor" e "Exportar do
servidor como `.ebgeo`" reversíveis e **sem perda**.

### P10 — Conflitos resolvem por last-one-wins (LWW), sem locks
Toda alteração resolve por **last-writer-wins por ordem de chegada** ao servidor (não por timestamp);
idempotência por `op_id`. **Sem locks** — ninguém bloqueia a edição de ninguém (o `locked` de mapa é
apenas um aviso de UI, frontend-only). É o modelo de concorrência do Google Docs. Ver §7.

### P11 — Fidelidade de ida-e-volta `.ebgeo` ↔ servidor (round-trip sem perda)
Um `.ebgeo` que sobe ao servidor e volta a descer como `.ebgeo` — **possivelmente por outro usuário** —
deve conter **a mesma informação**. Fluxo canônico: o usuário **A** carrega seu `.ebgeo` no servidor
("Salvar local no servidor") e **compartilha** o atlas com o usuário **B**; **B** abre o atlas do
servidor e **exporta** um `.ebgeo`. Os dois `.ebgeo` (o de A e o de B) devem ser **equivalentes em
conteúdo**: mapas, camadas, feições + atributos, grupos, imagens, briefings, basemap, posição salva,
temporal/trajetória, grid, notas, cores, ícones. É a verificação mais forte de P9 — exige que (1) o
*transform* local→servidor não perca nada (`import_export/local-atlas-to-server.js`), (2) o servidor
armazene e devolva fielmente no snapshot, e (3) o `applyRemoteSnapshot` reconstrua **todos** os campos
no store local para que o re-export bata. Diferenças **aceitáveis e intencionais** (não violam o
princípio): IDs internos remapeados para UUID (ex.: a camada `default`), o id do atlas (novo no
servidor) e o arredondamento de coordenadas do export. Todo o resto deve ser igual.

### P12 — O modelo local é um único espaço de trabalho (o "atlas nomeado" é do servidor)
O caso de uso offline mantém **um único espaço de trabalho** no IndexedDB. Portabilidade e trabalho com
vários projetos **localmente** são feitos via arquivos `.ebgeo` (exportar/importar) — **não** via
múltiplos "atlas locais nomeados" coexistindo no IndexedDB. O conceito de **atlas nomeado** (vários
projetos selecionáveis e compartilháveis) é uma capacidade do **servidor** (colaboração). É decisão
**deliberada**: namespacing por atlas no IndexedDB seria um refactor pesado da camada de persistência
**sem ganho de princípio** — a separação local↔remoto já é garantida pelo marcador de origem
(`store-origin.js`, ver §2/§6) — e só adicionaria risco ao caso de uso #1 (offline). Em resumo:
**local = 1 workspace + `.ebgeo`; servidor = N atlas nomeados.**

---

## 4. Ciclo de vida (boot, login, conexão, logout, F5)

Ordem no boot (`src/js/index.js`):

1. **Configura** o cliente HTTP e mescla `GET /api/config` (à prova de falha: backend fora ⇒ segue
   no config estático).
2. **Restaura a sessão** (`restoreSessionFromStorage`): lê o token do `localStorage`, valida em
   `GET /auth/me` (com refresh transparente em 401). Sem token ou em qualquer erro ⇒ permanece
   anônimo, **sem tocar o caminho offline**.
3. **Carrega o store** (`initializeWithLastActiveMap`), que primeiro roda o **boot guard**
   (`enforceLocalStoreWhenLoggedOut`): se o IndexedDB guarda um atlas **remoto** e ninguém está
   autenticado, esse dado é **descartado** para um atlas local em branco. Para o usuário local
   (origem `local`) a condição é falsa ⇒ no-op.
4. Depois da UI pronta, **reconecta** o último atlas remoto (`reconnectLastAtlas`) se houver sessão
   restaurada e origem `remote`: re-puxa um snapshot fresco, remarca `remote`, retoma o auto-flush.

| Evento | O que acontece |
|--------|----------------|
| **Login** | Autentica, espelha identidade em `sessionContext`, abre o seletor de projetos. |
| **Abrir do servidor** | Fecha a conexão anterior (um socket por atlas), avisa se o atual é **local** (perda de dados → baixe `.ebgeo`), limpa o store, conecta, marca `remote`. |
| **Logout** | Fecha o WebSocket, revoga o refresh token, limpa a presença, **apaga o dado remoto** e volta a um atlas local em branco; o círculo de conexão e os cursores somem pelos eventos de sessão/conexão. |
| **F5** | Passos 1–4 acima — login e atlas remoto restaurados; usuário local inalterado. |

---

## 5. Pontes entre os modos (interoperabilidade)

### Servidor → local (`.ebgeo`)
Enquanto conectado, o store contém o atlas remoto. **"Salvar projeto"** exporta esse estado como
`.ebgeo` (`import_export/export-import.service.js`), gerando uma cópia **local** e durável. Esta é a
forma suportada de "tirar uma foto" de um atlas do servidor para uso offline.
> Regra de ouro: como o dado remoto é efêmero, **baixe o `.ebgeo` antes de desconectar/sair** se
> quiser guardá-lo na máquina.

### Local → servidor — **"Salvar atlas local no servidor"** (implementado)
Estando **logado** e trabalhando no store **local**, o item *"Salvar no servidor"* (menu da conta)
empacota todo o atlas local e o sobe como um **novo atlas remoto**, conectando ao vivo. Ordem
(`import_export/save-local-atlas.service.js`): build do `.ebgeo` em memória
(`exportService.buildExportDataObject`) → *transform* (`local-atlas-to-server.js`) → `POST /atlas/import`
(bulk, **preservando os IDs de entidade do cliente**) → upload das imagens em lotes ≤50
**preservando o id** (`INSERT_IMAGE_WITH_ID`, então refs de feição-imagem seguem válidas sem reescrita)
→ `clearAllDataStore` + `markStoreRemote` + `connect`. O compartilhamento (link público + membros) é
escolhido no mesmo diálogo de criação. Segue válido também o caminho manual: criar/abrir um atlas no
servidor e **importar** um `.ebgeo` de forma aditiva.

---

## 6. Isolamento entre atlas — nunca vazar (P3)

**No cliente:** o store guarda **um atlas por vez**. Trocar de atlas é uma operação destrutiva e
ordenada — *desconecta o anterior → limpa todo o store → conecta o novo* (`account.control.js`,
`clearAllDataStore`). Não há merge implícito entre atlas. A separação local/remoto (§2) garante que
um atlas remoto nunca contamine o local persistido, nem vice-versa.

**Identidade de mapa:** mapas de atlas remotos são chaveados por **UUID**; o mapa local padrão
(`Principal`) é chaveado por nome e **não** tem UUID. Uma operação cujo `mapId` de contexto não é um
UUID é **descartada antes de entrar na fila** (`operation-dispatcher.js`) — isso impede que uma
feição desenhada num mapa local "vaze" para um atlas do servidor (e também impede que uma única
operação inválida envenene o lote de flush e trave toda a sincronização). E, **ao ativar o mapa
inicial de um atlas conectado** (`activateAtlasInitialMap`), todo mapa local **não-UUID** (o default
`Principal` recriado no boot) é **removido** — senão, nas leituras por nome, ele sombrearia um mapa
remoto de mesmo nome e o usuário (inclusive o dono, logo após "Salvar no servidor") cairia num mapa
**vazio**.

**No servidor:** uma **sala por atlas** (`collab.rooms.js`); o JWT carrega a permissão **por atlas**;
toda query de escrita tem guarda IDOR (`EXISTS … atlas_id`); soft-delete por entidade. Um cliente só
recebe broadcast do atlas em que está conectado.

**Invariante:** abrir o atlas B nunca pode deixar visível qualquer feição/camada/mapa do atlas A.

---

## 7. Resiliência a redes ruins (P6) — offline-first

O uso conectado é **offline-first**: a edição **sempre** acontece no store local; a sincronização é
uma fila que drena quando a rede permite. Sinal ruim degrada a *latência* da colaboração, nunca a
capacidade de continuar trabalhando.

| Mecanismo | Onde | O que dá |
|-----------|------|----------|
| **Fila de operações** (IndexedDB) | `operation-queue.js` | Operações acumulam localmente; sobrevivem a quedas e F5; compactação (CREATE+DELETE se anulam, CREATE+UPDATEs fundem). |
| **Flush guarded** | `sync-flush.js` | Só transmite quando `ONLINE`; *in-flight guard* (sem flushes sobrepostos); dispara por intervalo **e** por evento de mudança. |
| **Idempotência + ordenação** | `op_id` único + relógio de Lamport | Reenvio seguro; conflito resolvido por **last-write-wins por ordem de chegada** ao servidor. |
| **Reconexão automática** | `ws-client.js` | Backoff exponencial; ao reconectar envia `sync_request(lastVersion)` e **reaplica** o que perdeu (replay). |
| **Heartbeat** | `ws-client.js` (ping/pong) | Detecta socket morto e força reconectar. |
| **Presença tolerante a queda** | backend `WS_AWAY_GRACE_MS` | Queda vira `away` por uma janela de graça; reconexão com o mesmo `clientId` emite `user_back` (não some/reaparece). |
| **Qualidade adaptativa** | `connection-quality` → `adaptive-settings` | O servidor pode ajustar parâmetros conforme a qualidade do enlace. |
| **Estado de conexão** | `connection-state.js` | Máquina `OFFLINE→CONNECTING→ONLINE→RECONNECTING`; a UI (círculo de conexão) reflete em tempo real. |

**Garantia:** desconectar no meio de uma edição **não perde** trabalho — as operações ficam na fila
e sobem quando a conexão volta. Reabrir/reconectar reconcilia via snapshot/replay.

---

## 8. Migração sem quebra (P4)

- **Versionamento de schema** (`store/migration/`): migrações são **forward-only e aditivas**
  (v1→v2→v2.1→v2.2), rodam sozinhas no boot e **não destroem** dados existentes.
- **Marcador de origem ausente ⇒ `local`**: o usuário que já tem atlas no IndexedDB e nunca logou é
  tratado como local automaticamente; o *boot guard* não age sobre ele.
- **Formato `.ebgeo` inalterado**: continua sendo o contêiner portável e a forma de
  backup/compartilhamento offline; importação/exportação seguem funcionando.
- **Backend aditivo**: a app funciona idêntica para o usuário não autenticado; o servidor nunca é
  pré-requisito do caminho local.

**Invariante de migração:** atualizar o app **nunca** pode apagar ou tornar inacessível um atlas que
já estava em operação no IndexedDB.

---

## 9. Invariantes (regras para não quebrar o sistema)

1. **Nunca** torne o servidor pré-requisito de uma ação que hoje funciona offline.
2. **Nunca** persista dado de atlas remoto fora do domínio efêmero, nem deixe-o sobreviver ao
   logout/desconexão.
3. **Nunca** deixe dado de um atlas visível em outro (cheque o isolamento ao mexer em store/sync).
4. Toda operação colaborativa precisa **tolerar reenvio** (idempotência) e **fila offline**.
5. Mudança de schema é **aditiva** e tem **teste de regressão** garantindo que dados antigos abrem.
6. Toda transição entre modos preserva o trabalho do usuário (avisar + oferecer `.ebgeo` antes de
   qualquer descarte de dado **local**).
7. O caminho offline deve passar nos testes **sem** backend disponível.
8. **Undo/redo nunca sincroniza** nem inclui operações remotas — é estritamente local por sessão (P8).
9. **Toda informação que entra no `.ebgeo` precisa ter caminho de sincronização** (cobertura de sync ⊇
   cobertura de `.ebgeo`, P9); ao adicionar um novo tipo de dado persistido, cubra os dois caminhos.
10. **Round-trip `.ebgeo` → servidor → `.ebgeo` é sem perda** (P11): qualquer informação que entra no
    servidor por "Salvar local no servidor" precisa voltar idêntica num export feito por outro usuário
    com quem o atlas foi compartilhado. **Toda adição ao *transform* local→servidor exige a
    contrapartida no `applyRemoteSnapshot`** (e um teste de fidelidade).
11. **Os testes de UI (Playwright) dirigem a UI REAL.** Toda ação que um usuário realiza pela
    interface é executada **pela interface** no teste: ativar a ferramenta na toolbar + clicar no
    canvas para desenhar feições, painéis de atributos para editar (renomear/recolorir/descrever/
    mover/excluir), sidebar para mapas/camadas/grupos, modais/toggles para configurações. Atalhos
    programáticos (`store.addFeature/updateFeature/...` via `page.evaluate`) são permitidos **apenas**
    para **setup sem UI** (registrar usuários, semear atlas, compartilhar/permissões, forçar
    reconexão/relógio, ligar o tracer) e **leituras de asserção** de estado (`readFeatures`,
    `getCurrentMapFeatures`, `getSource().getData()`) — não há UI para "asserir". Quando um tipo/ação
    genuinamente não tem gesto de UI (ex.: `processed_los`/`processed_visibility` são **saídas** de
    análise, não feições colocadas; `image` exige seletor de arquivo), documente a exceção no próprio
    teste. Helpers reutilizáveis em `tests/e2e-ui/helpers/collab-helpers.js`
    (`drawLineUI`/`drawPointUI`/`drawPolygonUI`/…); referência: `browser-collab-native-render.spec.js`
    e `tests/e2e-ui/README.md` §"UI-first philosophy".

---

## 10. Status atual e pendências

**Implementado:** separação local/remoto com marcador de origem + boot guard; logout volta a atlas
em branco e descarta o remoto; abrir-do-servidor fecha a conexão anterior e avisa sobre perda de
dados locais; sessão persiste em F5 e reconecta o último atlas remoto; sincronização resiliente
(fila, flush, reconexão/replay, LWW, idempotência, presença away/back); export `.ebgeo` do estado
atual (inclusive de um atlas remoto conectado); criar atlas com opções de compartilhamento; botão de
compartilhar na área do usuário; gating dos botões por login.

**Concluído (evolução já implementada + testada):**
- **"Salvar atlas local no servidor" de um clique** (§5) — item no menu da conta empacota o store
  local (`save-local-atlas.service.js`: transform → `importAtlas` → upload de imagens **preservando
  os ids**, então as refs ficam válidas sem reescrita) e conecta ao novo atlas ao vivo. Transform +
  imagens + orquestração cobertos por testes unit + E2E real-backend.
- **Cobertura de sync vs `.ebgeo` (P9)** — operação **ao vivo** agora persiste inbound TUDO (posição,
  basemap, notas, grid, catalog, 3D/360 **e `mapOrder`**); `gridStyle` faz round-trip no `.ebgeo`.
- **Fidelidade de round-trip (P11)** — auditoria achou e corrigiu 3 gaps no `applyRemoteSnapshot`
  (layers/cesium3d/streetview360 iam só ao doc do mapa, não aos side-stores dos leitores). Bug
  pré-existente corrigido: grupos nunca entravam no `.ebgeo` (check `.size` de Map num objeto).
- **Cobertura E2E + Playwright** dos fluxos completos — `tests/e2e/` (vitest, backend real) tem **50
  arquivos / 163 testes**; `tests/e2e-ui/` (Playwright, Chromium real) cobre as jornadas de UI,
  incluindo **"Salvar no servidor" → editar ao vivo**, **round-trip P11 (dois usuários)** e **undo
  local por usuário (P8)**. Um **guard não-gateado** (`_backend-required`) faz o e2e **falhar** — não
  pular silenciosamente em verde — se o backend não subir.
- **Bugs reais achados pela camada Playwright e corrigidos:** (1) edição local bloqueada quando logado
  (papel global `viewer`) → o gate de role só vale em atlas remoto (P1); (2) o mapa local `Principal`
  sombreava o mapa do atlas de mesmo nome ao abrir/salvar no servidor → strays não-UUID são removidos no
  `connect`. Ambos cobertos por testes; `export-import.service` ganhou testes de unidade (cobertura do
  `.ebgeo`, incl. regressão dos grupos).

**Decisões / não-objetivos:**
- **Múltiplos atlas locais nomeados — NÃO será feito** (ver **P12**). O modelo local é um único
  workspace + `.ebgeo`; "atlas nomeado" é capacidade do **servidor**. A separação local↔remoto já é
  garantida pelo marcador de origem — não há gap de princípio.
- **Papéis, permissões e comentário espacial** — a escala de níveis concedíveis **é** exposta na UI
  (Leitura/Comentário/Edição/Gestão), com comentário espacial, link público abrível e transferência de
  propriedade. Ver **§11** (reverte a decisão anterior de não expor a escala de papéis).

---

## 11. Papéis, permissões e comentário espacial

A camada de colaboração tem um **modelo de papéis por atlas** e o **comentário espacial**. Como tudo na
camada remota, isto **só incide sobre um atlas remoto conectado** — o store local é sempre editável (P1).

### Modelo de papéis

Dois eixos no backend: papel global (`users.role ∈ {user, admin}`) + permissão **por-atlas**
(`atlas_shares.permission`). `utils/roles.js#toFrontendRole` traduz para o vocabulário do frontend.

| Exibição PT-BR | Token frontend | Origem backend | Nível |
|---|---|---|---|
| **Admin do sistema** | `sysadmin` | `users.role='admin'` | — (bypass total) |
| **Gestor** (dono) | `owner` | `atlas.owner_id` | 5 |
| **Gestor** (promovido) | `manager` | `atlas_shares.permission='manage'` | 4 |
| **Editor** | `editor` | `atlas_shares.permission='write'` | 3 |
| **Comentarista** | `commenter` | `atlas_shares.permission='comment'` | 2 |
| **Visualizador** | `viewer` | `atlas_shares.permission='read'` **ou** link público | 1 |

`owner` e `manager` exibem ambos **"Gestor"**; o dono recebe um selo **(dono)**. O `<select>` de
compartilhamento expõe os 4 níveis concedíveis: **Leitura / Comentário / Edição / Gestão**.

### Matriz de capacidades (atlas remoto conectado)

| Ação | Visualiz. | Coment. | Editor | Gestor | Dono | Sysadmin |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Ver mapas/feições | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Ver comentários** | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| Criar/responder/resolver comentário | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| Editar/apagar comentário | — | autor | ✓ | ✓ | ✓ | ✓ |
| Editar feições/camadas/mapas | — | — | ✓ | ✓ | ✓ | ✓ |
| Compartilhar (até nível Gestor) | — | — | — | ✓ | ✓ | ✓ |
| Add/remover **gestores** (exceto o dono) | — | — | — | ✓ | ✓ | ✓ |
| Configurar atlas (3D/360/basemap) | — | — | — | ✓ | ✓ | ✓ |
| **Apagar o atlas** | — | — | — | — | ✓ | ✓ |
| **Transferir propriedade** | — | — | — | — | ✓ | ✓ |

> "autor" = só o autor do próprio comentário. O Visualizador **não recebe** comentários do servidor — é
> um **filtro de transmissão** (snapshot + broadcast não enviam comentário a conexão nível `read`), não
> apenas um esconde-UI.

### Comentário espacial

Entidade dedicada **por-mapa**, não-feição (Comentarista não cria camadas). **Raiz e resposta na mesma
entidade**, distinguidas por `parentId`; cada resposta é uma entidade própria → respostas simultâneas
**não se sobrescrevem** (P10, LWW por chegada). A raiz é um **pin** na coordenada com as 2 iniciais do
autor; clicar abre a thread (respostas + resolver/reabrir + excluir). Comentário **resolvido sai do
mapa** — fica só no painel lateral (Maps). Permissões: criar/responder = Comentarista+; editar/resolver/
excluir = **autor ou Editor+**. **Funciona 100% offline** (a ferramenta aparece; o gating de papel só
existe conectado, P1). Persiste e sincroniza, então **entra no `.ebgeo`** (P9, nível Editor+) e faz
round-trip (P11); a não-entrega ao Visualizador é diferença **intencional**, como os IDs remapeados.

### Configuração por atlas e link público

- **Config por atlas** (`atlas.settings`): o Gestor restringe a disponibilidade de **3D / 360 / basemap**.
  Princípio **interseção, nunca expansão** — um setting só desliga o que o deploy suporta, nunca liga o
  que não existe. Aplicado como overlay sobre o `config` global e **revertido ao desconectar** (P1).
- **Link público**: abre um atlas marcado como público **sem login**, como Visualizador anônimo
  (read-only, store remoto efêmero, **sem comentários**); o token expira em ~1h.

### Transferência de propriedade

Só o **dono atual** (ou Admin do sistema) elege um novo dono **entre os membros ativos** do atlas, numa
transação atômica (sem estado "sem dono"). O **ex-dono vira Gestor** (`manage`) — mantém acesso, não é
expulso. Co-gestor **não** transfere nem apaga o atlas.

### Decisões fechadas (referência)

- O schema do comentário entrou **editando o baseline `002_atlas.sql`** in-place (convenção forward-only
  do repo), não numa migração nova; o texto do comentário vive no `data` JSONB (sem coluna `text`).
- **Comentário disponível offline**; gating de papel só conectado.
- **Ex-dono vira Gestor** na transferência (não perde acesso).
- **Link público e comentário** em escopo e **implementados**.
