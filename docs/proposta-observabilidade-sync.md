# Proposta: EBGeo SyncLedger — Sistema de Depuração e Observabilidade da Sincronização Multiusuário

> Status: **IMPLEMENTADO** (P0–P3). Verificação completa em §10. A avaliação e o desenho originais seguem abaixo como referência.
> Escopo: `ebgeo_web@integracao_backend` + `ebgeo_backend@main`.
> Objetivo: tornar **visível e rastreável** toda a comunicação de sync entre clientes e servidor — e o **efeito dela na UI** — para que (1) os testes Playwright fiquem mais simples e determinísticos e (2) agentes de IA consigam revisar bugs e validar se as ações estão corretas a partir de um artefato estruturado.

---

## 1. Diagnóstico — por que hoje é difícil depurar

O problema **não é falta de testes**. Já existem três camadas:

| Camada | Onde | O que cobre |
|---|---|---|
| Transporte (Node) | `tests/e2e/*.e2e.test.js` (~50 specs) | `ApiClient`/`WsClient` contra backend real: broadcast, LWW, replay, lamport, idempotência, snapshot |
| UI (Playwright) | `tests/e2e-ui/browser-collab-*.spec.js` (~15 specs + `browser-collab-mega`) | 2–3 navegadores reais dirigindo o store real e assertando sync nativo |
| Backend | `ebgeo_backend/tests/{unit,integration,ws}` | rotas, persistência, gateway WS |

O problema é que **o pipeline de comunicação é opaco**. Uma ação do usuário percorre 8+ estágios em 3 runtimes diferentes:

```
mutação local → fila (IndexedDB, Lamport, compaction) → flush → POST /atlas/:id/sync
   → servidor persiste (ordem de chegada = LWW) → broadcast WS
   → ws-client inbound → applyRemoteOperation (persiste + emite evento) → re-render da fonte GeoJSON
```

Quando algo quebra, **não existe um identificador de correlação** que atravesse esses estágios. O resultado é um conjunto de "buracos negros silenciosos": o estado final está errado, mas não há sinal de **em qual estágio** morreu. Exemplos confirmados no código atual:

- **`remote-operation-handler.js`** é um `switch` gigante por `entityType` (~1000 linhas) onde quase toda branch carrega um comentário `§` documentando um bug *passado* — persistir-sem-emitir (peer fica sem o dado), payload de evento errado (renderizou `[object Object]`), `mapId` UUID-vs-nome, reshape `snake_case→camelCase` incompleto. No **caminho de sucesso não há um único log**. Quando uma dessas regride, o sintoma é um no-op silencioso.
- **`operation-dispatcher.js`**: 4 `return;` mudos (logging desabilitado; `mapId` não-UUID; `setting` não-UUID; filtro de batch). "Criei a feição e nada sincronizou" pode ser qualquer um dos quatro — sem nenhum log diferenciador.
- **`ws-client.js:274-278`**: ack/`ack_batch` são emitidos via `_emit('ack', …)` — **e não há nenhum `.on('ack')` em todo `store/sync`**. `serverVersion` e `idempotent` chegam e são **descartados**. Toda a correlação `op → serverVersion` no autor é perdida.
- **`collab.rooms.js:66-86`**: `broadcastOperations` retorna `void` — é um `client.send()` fire-and-forget. **Quem recebeu, e por que alguém foi pulado (sender / socket fechado / read-only), é invisível.**
- **`sync.service.js` `applyOperation`**: as escritas de entidade usam `t.none(...)` (linhas 1267, 1317…1513), que **descarta o `rowCount`**. Um UPDATE/DELETE que casou **0 linhas** é indistinguível de um que funcionou → a classe de bug "ackado com sucesso mas sem efeito" é literalmente inobservável hoje.
- **`collab-helpers.js`**: o padrão de teste é `applyStoreOp(A) → pollPeerFeature(B)` com `expect.poll` e **timeout de 20s** lendo o *store*. Quando estoura, você sabe *que* não sincronizou, mas **nada sobre o porquê** — e os asserts olham o store, não o **render** (fonte GeoJSON do MapLibre) nem o DOM de presença.

E há um agravante de **semântica**: a doc do projeto promete "LWW por **ordem de chegada** ao servidor", mas o vencedor real (`serverVersion`) só volta no ack — que ninguém consome. Qualquer raciocínio de conflito baseado em `timestamp` (relógio de parede) ou `lamport` (causal) está **errado por construção**.

**Conclusão:** o que falta não é mais teste — é **observabilidade correlacionada de ponta a ponta**, mais um artefato estruturado que humanos, Playwright e agentes de IA leiam igual.

---

## 2. A solução — EBGeo SyncLedger

Uma camada de observabilidade **aditiva e ligável por flag** que carimba **uma** chave de correlação no nascimento da ação, costura essa chave pelos tokens que **já existem** (`op.id` / `clientId` / `lamport` / `serverVersion`) através de cliente A + servidor + cliente B, e emite **Spans** tipados para *ring buffers* por runtime que se fundem num único **Ledger** causal.

Três estratos, com dependência só para baixo:

```
(C) Consumo      ── helpers Playwright · cenários declarativos · adaptador de veredito p/ IA
                       │ lê
(B) Ledger       ── schema Span (JSONL) · ring buffers (1 por runtime) · merge + reducer
                       │ alimentado por
(A) Instrumentação ── tracers in-process (browser FE + node BE), zero-custo quando desligado
```

### 2.1 O esquema de correlação (a decisão central)

Três chaves **já existem no fio e sobrevivem ao pipeline inteiro**; adicionamos exatamente **uma**:

| Chave | Origem | Papel |
|---|---|---|
| **`op.id`** | `operation-factory.createOperation` | **Chave de junção primária.** Round-trips `push→INSERT→broadcast→apply` intacto (provado por `two-client-broadcast`: `got.id===op.id`, e pelo `ON CONFLICT(atlas_id, op_id)` no backend). Presente em todo hop a partir do enqueue. |
| **`serverVersion`** | `INSERT_OPERATION` (por atlas, monotônico) | **Verdade de ordenação/LWW.** A *única* chave correta para ordenar conflitos. Nunca ordenar por `timestamp` nem por `lamport`. |
| **`clientId`** | `localStorage` (estável) | Identidade do autor — eco-próprio e presença. |
| **`traceId`** ⭐ NOVO | gerado no `runTransaction` (e no header HTTP `X-Trace-Id` + `AsyncLocalStorage` no backend) | Liga **um gesto do usuário** às suas op(s) e, quando o servidor ecoa intacto, ao apply do peer. |

**Regra de ouro:** `traceId` é **enriquecimento best-effort**; `op.id` é o fallback que sempre funciona. Se qualquer hop remover o `traceId`, o merge degrada para junção por `op.id` — ainda 100% funcional, perdendo só o vínculo gesto→op. Isso torna o rollout seguro: a base sobre `op.id` entrega a maior parte do valor sem tocar no contrato do fio.

> **Decisão tomada:** o `traceId` será threaded **já no P0**, no frontend (mint no `runTransaction` → `logXxxOperation` → `createOperation` → envelope). Como o servidor re-broadcasta o envelope cru (Joi `.unknown(true)`), o `traceId` **chega ao cliente B no broadcast sem mudança de backend** — o vínculo gesto→op→peer funciona desde o P0. Os spans *server-side* via `X-Trace-Id` middleware permanecem em P2.

### 2.2 O registro unificado (Span)

Um único formato **plano, append-only, uma linha JSONL por evento-de-estágio por ator** (inspirado em spans OTel, mas achatado para leitura direta por IA):

```jsonc
{
  "seq": 128,                 // monotônico por buffer (ordem local)
  "monoTs": 91833.4,          // performance.now (ordem intra-ator)
  "ts": 1750000000000,        // epoch ms (só display; nunca para ordenar entre máquinas)
  "actor": "clientA",         // clientA | clientB | server | <clientId>
  "stage": "server.inserted", // enum compartilhado FE/BE (ver abaixo)
  "traceId": "…", "opId": "…", "clientId": "…",
  "entityType": "feature", "operationType": "create", "entityId": "…",
  "mapId": "…", "mapName": "Mapa Tático",  // lado a lado — expõe as mentiras UUID-vs-nome
  "lamportTimestamp": 42, "serverVersion": 1007,
  "outcome": "ok",            // ok | dropped | filtered | failed | idempotent | no-effect
  "reason": null,
  "extra": { "rowsAffected": 1, "recipients": ["<clientId-B>"], "inSource": true, "inStore": true }
}
```

**Enum de estágios** (contrato único, espelhado FE/BE num só arquivo-fonte):

```
action.origin · enqueue · preflush.drop · flush.push · push.ack
server.inserted · server.applied · server.broadcast
ws.inbound · ws.self-echo · gateway.gate · apply.persist · remote.applied
render.source · presence · conn.transition
```

Os Spans guardam **apenas escalares e contagens derivadas** — nunca geometria, nunca payload completo (custo limitado, sem PII além de ids que já trafegam).

### 2.3 Fluxo de dados (onde cada Span nasce)

```
AUTOR A
 gesto → runTransaction[mint traceId; action.origin] → persiste
   → deferAsync logXxxOperation[traceId] → operation-dispatcher
        └─ guards de drop (hoje "return;" mudo) → preflush.drop{reason}
   → createOperation[op.id+traceId+lamport; enqueue] → fila
   → sync-flush → flush.push{batchOpIds, online} → POST /atlas/:id/sync
                                                          │
SERVIDOR  (X-Trace-Id middleware + AsyncLocalStorage)     ▼
   sync.service.pushOperations:
     após INSERT_OPERATION  → server.inserted{opId ↔ serverVersion}   ← o binding-chave
     applyOperation (t.none→t.result) → server.applied{rowsAffected, no-effect se 0}
     guards (lock/cross-atlas/forbidden) → server.applied{outcome:failed|…}
   broadcastOperations (passa a RETORNAR) → server.broadcast{sent, skipped{self,closed,readOnly}, recipients[]}
                                                          │ WS
PEER B                                                    ▼
   ws-client._onMessage → ws.inbound (parse-fail/unknown-type = dropped)
     _applyInboundOps → ws.self-echo (op.clientId===meu)  [dedupe]
   sync-gateway gate (offline) → gateway.gate
   applyRemoteOperation → apply.persist  (os 8 console.warn ganham opId+traceId)
     emit evento de ciclo de vida + REMOTE_OPERATION_APPLIED → remote.applied (captado pelo tap do EventBus)
   layers re-render fonte GeoJSON → UiEffectProbe lê __ebgeoMap.getSource → render.source{inSource,inStore,countBefore/After}
   presença via data-testid → presence

ACK (volta a A)
   ws-client ack/ack_batch (HOJE sem consumidor) → +subscriber → push.ack{opId, serverVersion, idempotent}

MERGE (teardown do teste)
   collectLedger(pages[], apiClient) = drain de cada window.__ebgeoSyncTrace + GET /api/v1/debug/trace
     → normaliza inconsistências (ops vs operations; results[].operationId vs acks[].opId)
     → ordena por serverVersion → ledger.jsonl → reduceLedger → ledger.report.md + verdict.json
```

---

## 3. O que se torna visível (buracos negros → causas nomeadas)

| Sintoma hoje (silencioso) | Vira Span |
|---|---|
| "Criei e nada sincronizou" (drop pré-fila) | `preflush.drop{reason: non_uuid_mapId \| non_uuid_setting_id \| logging_disabled}` |
| Frame WS com parse-fail / tipo desconhecido | `ws.inbound{outcome: dropped}` |
| Op duplicada / eco re-aplicado | `ws.self-echo` (o filtro vira observável) |
| **Ackado mas sem efeito** (rows 0) | `server.applied{outcome: no-effect, rowsAffected: 0}` |
| Broadcast fire-and-forget | `server.broadcast{sent, skipped*, recipients[]}` |
| Dequeue cego / perda em aceite parcial | `push.ack` lendo o `results` que o flush hoje ignora |
| Transição de conexão engolida (`_safeTransition`) | `conn.transition` |
| Persistiu mas a UI não refletiu | `apply.persist` + ausência de `render.source{inSource:true}` |

Igualmente importante: os **comportamentos by-design** que a doc alerta para **não** dar falso-positivo (eco HTTP filtrado por `clientId`; locks de camada/grupo/feição são *advisory*; sv360 não faz broadcast; `mapTemporal` não emite op; offline intencional) são codificados como `outcome`/`reason` explícitos — para o agente de IA distinguir *"dropado: anti-leak, by design"* de *"op perdida"*.

---

## 4. Ganhos concretos

### 4.1 Playwright — esperas determinísticas no lugar de `poll`/timeout

**Antes** (`collab-helpers.js`):
```js
await pollPeerFeature(B, 'lines', id);   // expect.poll, timeout 20s, lê o store; em falha: 0 pista
```
**Depois:**
```js
await waitForOpApplied(B, opId);   // page.waitForFunction(__ebgeoSyncTrace.has(opId,'remote.applied'))
// em timeout: dump de ledger.byOp(opId) nomeando o ÚLTIMO estágio alcançado
//   (parou em enqueue → flush desligado; flush.push sem push.ack → lote-veneno;
//    action.origin → preflush.drop → mapa local não-UUID)
```
Sub-segundo em vez de 20s, e a falha **diz onde** morreu. Fecha também o gap store-vs-render: `waitForRendered(B, id)` assere a **fonte GeoJSON**, não só o store.

### 4.2 Agentes de IA — veredito rastreável (não alucinado)

O agente recebe `ledger.jsonl` + `verdict.json` e valida contra as invariantes (§5) **sem ler o código**. Cada afirmação aponta um Span real (`seq`+`stage`+`opId`), então é auditável:
> *"Passo 3 INCORRETO: `op …a1` teve `server.inserted` mas `server.applied{rowsAffected:0}` — ackado sem efeito (provável guard EXISTS / `mapId` estrangeiro). Primeiro estágio em falha: `server.applied`."*

---

## 5. Invariantes verificáveis (o "gabarito" do agente)

| # | Invariante |
|---|---|
| **I1** | **Nada some em silêncio:** todo `action.origin` com `mapId` UUID chega a `server.inserted` OU tem `preflush.drop`/`gateway.gate` com `reason`. |
| **I2** | **Ack implica efeito:** nenhum `server.applied` com `rowsAffected===0` para create/update/delete ackado com sucesso. |
| **I3** | **LWW por ordem de chegada:** vencedor = op com `max(serverVersion)`; o checker **falha** se a ordenação derivar de `timestamp` ou `lamport`. |
| **I4** | **Idempotente → dequeue:** `push.ack{idempotent:true}` é sucesso, seguido da op saindo da fila (sem loop de reenvio). |
| **I5** | **Eco exatamente-uma-vez:** toda op autorada aparece como `ws.self-echo` no autor e `remote.applied` **uma vez** em cada peer. |
| **I6** | **Paridade store↔render:** para cada feature op aplicada, o `render.source` terminal tem `inSource===inStore`. |
| **I7** | **Broadcast completo:** `recipients = membros − autor − fechados − (read-only p/ comment)`; sala não-vazia com `delivered=0` é violação. |
| **I8** | **Presença estável:** reconexão dentro de `WS_AWAY_GRACE_MS` com mesmo `clientId` emite `user_back` sem duplicar o roster. |
| **I9** | **Transição legal:** todo `conn.transition` ∈ `VALID_TRANSITIONS` (a ilegal, hoje engolida, vira violação). |
| **I10** | **Exclusões by-design** (NÃO sinalizar como bug): drop `non_uuid_mapId` no mapa local `Principal`; eco HTTP filtrado por `clientId`; locks advisory de camada/grupo/feição; sv360 sem broadcast; `mapTemporal` sem op. |
| **I11** | **Monotonicidade Lamport:** todo apply remoto avança o relógio local (inclusive no caminho snapshot/pull que hoje passa ao largo do gateway). |

---

## 6. Plano em fases

| Fase | Meta | Entregáveis principais | Esforço |
|---|---|---|---|
| **P0 — MVP: ledger FE-only sobre `op.id` + visibilidade dos drops** | ~70% do valor, **zero backend** | `trace-core.js` (ring buffer `window.__ebgeoSyncTrace`, schema Span, `record()` zero-custo, liga por `?trace=sync`/`localStorage`/`addInitScript`); tap único no `emit()` do EventBus (allowlist; exclui `TEMPORAL_CURSOR_CHANGED`/`PRESENCE_CURSORS_CHANGED`); trocar os 4 `return;` mudos do dispatcher por `preflush.drop{reason}`; spans `enqueue`/`flush.push`/`ws.inbound`/`ws.self-echo`/`conn.transition`; **+ o subscriber de `ack` que falta** → `push.ack` | M |
| **P1 — Esperas Playwright determinísticas + probe de efeito na UI** | matar todo `expect.poll`/`waitForTimeout` | `waitForOpApplied/Rendered/Acked/Converged/Gone` (dump do ledger em timeout); `UiEffectProbe` (lê `__ebgeoMap.getSource` membership+count → `render.source`); migrar corpo de `pollPeerFeature*` (call-sites intactos); paridade Node (`harness.js waitFor()` tapa o ring do `WsClient`) | M |
| **P2 — Ring no backend + `GET /api/v1/debug/trace` + `traceId` ponta a ponta** | verdade do servidor (serverVersion, rowCount, fan-out) + vínculo do gesto | ring em memória (independente do pino, alcançável em `NODE_ENV=test`) + endpoint gated por admin/test; `server.inserted`/`server.applied` (`t.none→t.result`)/`server.broadcast` (retorno de `broadcastOperations`); `traceId` (`runTransaction→createOperation`, `X-Trace-Id` middleware, eco no ack/broadcast; best-effort com fallback `op.id`); `collectLedger` + `ledger.jsonl` | L |
| **P3 — Reducer, cenários declarativos, adaptador de veredito IA** | transformar spans no oráculo e o comportamento colaborativo em **dados** | `reduceLedger` (pura, node-testável) → `{timelines, divergences, orphans+causa, conflicts winner-by-serverVersion}` + `ledger.report.md`; formato `CollabScenario` + `runScenario` (reusa `seedSharedAtlas`/`openClient`); `assertInvariants`/`assertNoOrphanOps` com tags by-design; adaptador de veredito → `<scenario>.verdict.json`; portar specs (mega→cenários; conflito ganha oráculo LWW); overlay dev opcional | L |

### Quick wins (alto valor, baixo esforço — ótimos primeiros passos)

1. **Adicionar o consumidor de `ack` que falta** no `ws-client` (~10 linhas) → `push.ack{opId, serverVersion, idempotent}`. Restaura a correlação `op→serverVersion` no autor — base de toda espera determinística.
2. **Trocar os 4 `return;` mudos** do `operation-dispatcher.js` por `preflush.drop` contado e com `reason`. **A inserção de maior valor isolado** — converte o buraco negro dominante ("nada sincronizou, zero sinal") numa causa nomeada, sem dependência de backend.
3. **Tap único no `emit()`** do `getEventBus()` compartilhado → captura automática de todo evento de ciclo de vida + `StoreErrorEvents`; `REMOTE_OPERATION_APPLIED` vira âncora instantânea de "aplicado no peer".
4. **`t.none → t.result`** no `applyOperation` do backend → expõe `rowCount` e torna o bug "ackado mas rows:0" diretamente observável (uma linha).
5. **`broadcastOperations` passar a RETORNAR** `{sent, skipped{self,closed,readOnly}, recipients[]}` → fan-out invisível vira `server.broadcast` assertável.
6. **Pilotar** `waitForOpApplied(B, opId)` no lugar de **um** `pollPeerFeature` em `two-client-broadcast` — generaliza o buffer `ws.on('operation')` que esse spec já constrói à mão.

---

## 7. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| **Vazamento/overhead no caminho quente** (tap do EventBus ou cursores/temporal inundam o buffer; `TEMPORAL_CURSOR_CHANGED` dispara por rAF; cursor 80ms) | `record()` com early-return booleano de custo zero; build/flag-gated (prod = branch morto); allowlist exclui `TEMPORAL_CURSOR_CHANGED`/`PRESENCE_CURSORS_CHANGED`; spans só escalares; `UiEffectProbe` roda em eventos discretos, nunca por rAF, e lê membership/count (não `getData()`). |
| **Monkey-patch do `emit()`** compartilhado pode quebrar entrega de eventos | Embrulhar a **instância** (não a classe) uma vez no boot, idempotente e restaurável; wrapper isolado por try/catch que sempre delega ao `emit` original; teste unitário garantindo entrega intacta mesmo se o tracer lançar. *(Alternativa mais limpa: um `onAny()` de primeira classe no `EventEmitter`.)* |
| **`traceId` não propaga** (removido em algum hop) | `op.id` é primário; `traceId` é puro enriquecimento (P0/P1 nem usam). Allowlist explícito no `pushSchema` em vez de confiar em `.unknown(true)`; auto-check do ledger sinaliza spans sem `traceId` (degradação visível, não silenciosa). |
| **`t.none→t.result` e middleware tocam o caminho de escrita** | `t.result` é leitura pura de `rowCount`, sem mudança de comportamento — regressão sobre o rollback de batch; middleware só gera/lê header em `AsyncLocalStorage`, antes do `flexibleAuth`, sem alterar auth; endpoint estritamente gated por env/role. |
| **Eviction do ring em sessão longa** (mega de 180s) gera órfãos falsos | Capacidade tunável por cenário; em teste, array crescível em vez de ring fixo; `collectLedger` drena nos limites de fase; `assertNoOrphanOps` **avisa** (não falha) em `entityType` desconhecido. |
| **Clock-skew / ordenação errada** | Ordenar **só** por `serverVersion`; `lamport` é gravado mas o reducer nunca assere lamport absoluto; `ts` de parede só para display. |
| **Drift do enum FE/BE** fragmenta merges | Arquivo de contrato único como fonte; cópia BE gerada/asseverada igual em CI; merger rejeita/sinaliza stage desconhecido. |
| **Privacidade do artefato** | Spans só com ids que já trafegam (sem conteúdo/PII); endpoint BE gated por admin/test e desligado fora de test/dev; buffer FE em memória, limpo no reload/logout; `ledger.jsonl` é debug-only. |

---

## 8. Decisões tomadas

1. **`traceId`** → threaded **já no P0** (frontend: mint no `runTransaction` → `createOperation` → envelope). Viaja no broadcast até B sem mudança de backend; spans server-side via `X-Trace-Id` ficam em P2.
2. **Durabilidade no backend** → **só ring em memória** (independente do pino, alcançável em `NODE_ENV=test`). Sem tabela Postgres.
3. **Gating** → **estritamente test/dev, env-gated**. Produção não embarca o tracer; endpoint do backend só em test/dev + role admin.
4. **Tap de eventos** → **`onAny()` de 1ª classe** no `EventEmitter` (sem monkey-patch), coberto por teste unitário garantindo entrega intacta.
5. *(default)* **`ledger.jsonl`** → `testInfo.attach` (efêmero); promovível a diretório de artefatos/CI depois.
6. *(default)* **Escopo de cenários** → inclui tipos de efeito distintos (`presence` keyed por `clientId`; `refetch` para 3D/360/sv360 emit-only/sem broadcast).

---

## 9. Recomendação

Começar pelos **6 quick wins** (essencialmente o conteúdo da **P0** + 2 toques de uma linha no backend). Eles são aditivos, reversíveis, e já convertem os principais buracos negros em causas nomeadas — entregando valor de depuração imediato e a fundação para as esperas determinísticas do Playwright, **antes** de qualquer investimento maior em P2/P3.

---

## 10. Estado da implementação (P0–P3 entregues)

### Frontend (`ebgeo_web`)
- **Núcleo** — `store/sync/diag/trace-stages.js` (contrato de estágios/outcomes/reasons), `store/sync/diag/trace-core.js` (ring buffer, `record()` zero-custo, `window.__ebgeoSyncTrace`, Node-safe), `store/sync/diag/bus-tap.js` (tap `onAny` → `remote.applied` + probe `render.source`).
- **`onAny()` de 1ª classe** em `events/event_emitter.js` (decisão #4) — wildcard error-isolado, coberto por teste.
- **`traceId`** mintado em `store/store-transaction.js` (gesto) → `operation-factory.js` (ambient + stamp no envelope).
- **Spans instrumentados** — `operation-dispatcher.js` (4 `preflush.drop` + `enqueue`), `sync-engine.js` (`flush.push` + `push.ack` lendo a resposta antes ignorada), `ws-client.js` (`push.ack` do ack antes morto, `ws.inbound`/`ws.self-echo`/`conn.transition`), `sync-gateway.js` (`gateway.gate`). Instalação em `store/services.js` + `index.js`.
- **Helpers de teste** — `tests/e2e-ui/helpers/trace-helpers.js` (`waitForRemoteEntity`, `waitForStage`, `getClientLedger`), `tests/e2e-ui/helpers/ledger.js` (`collectLedger`, `reduceLedger` puro, `findViolations`, `renderReport`). `collab-helpers.js` ligado ao tracer (todas as specs collab passam a ser SyncLedger-gated, com fallback gracioso).

### Backend (`ebgeo_backend`)
- **Tracer** — `utils/sync-trace.js` (ring por atlas, gated por `EBGEO_TRACE`/`NODE_ENV=test`, espelha o contrato de estágios).
- **Spans** — `modules/sync/sync.service.js` (`server.inserted` op.id↔serverVersion; `server.applied` com `rowsAffected` via `t.none→t.result` — guard I2), `modules/collab/collab.rooms.js` (`broadcastOperations`/`broadcastToRoom` passam a RETORNAR `{sent,recipients,…}` + `server.broadcast`).
- **`traceId`** explícito em `sync.schemas.js` (sobrevive à validação e ao broadcast). **Endpoint** `GET/DELETE /api/v1/debug/trace` (`modules/debug/debug.routes.js`, montado só com tracer ligado).

### Verificação (tudo verde)
| Suite | Resultado |
|---|---|
| Web unit/integration (`npx vitest run`) | **2272** testes, 106 arquivos — pass |
| Web e2e transporte (`npm run test:e2e`, backend real) | **164** testes, 51 arquivos — pass (inclui `ledger-trace.e2e.test.js`) |
| Web e2e-ui browser (`npm run test:e2e:ui`, Chromium + backend real) | **191** passed, 0 failed, 1 skipped — pass (specs collab com o tracer ligado) |
| Backend (`npm test`, Postgres real) | **1159** testes — pass (inclui `sync-trace.test.js` + WS collab/broadcast/batch) |
| Lint web (`npm run lint`) + backend (`npm run lint`) | limpo |

Testes novos de regressão: `event-emitter-onany`, `trace-core`, `operation-traceid`, `ledger-reduce` (web) + `sync-trace` (backend). Specs de demonstração SyncLedger: `tests/e2e-ui/browser-collab-ledger.spec.js` (browser) e `tests/e2e/ledger-trace.e2e.test.js` (transporte).

### e2e-ui (Playwright) — integração do ledger + condição da suíte

O Chromium foi instalado e o `tests/e2e-ui` foi executado contra o backend real.

- **Todas as specs collab usam o SyncLedger** sem edição por spec: `collab-helpers.openClient` liga o tracer e os `pollPeer*` viraram esperas determinísticas por `remote.applied` (com fallback ao poll de store quando o tracer está inativo — escape hatch `EBGEO_E2E_NO_TRACE=1`).
- **Oráculo de ledger** (`assertLedgerClean`, em `collab-helpers`) anexa o `ledger.jsonl` + relatório e assere `noEffects===0` (I2). Aplicado ao **mega** + `feature-mutations` + `all-types` + `three-client-flow`. Nova spec de demonstração: `browser-collab-ledger.spec.js`.
- **Probe `render.source` agora é opt-in** (`globalThis.__EBGEO_TRACE_RENDER__`) — evita leitura O(feições) por evento em sessões pesadas; o sinal determinístico (`remote.applied`) não depende dele.

**Suíte normal completa (`npm run test:e2e:ui`): 191 passed, 0 failed, 1 skipped (13,6 min)** — backend + Postgres reais, com o tracer ligado em todas as specs collab. **Zero regressão.**

> Durante a investigação, runs ISOLADOS rápidos de `mega`/`three-client`/`native-render` flakaram no passo de **conflito simultâneo** sob a carga que eu mesmo gerei (vários suites de browser em sequência). No run ordenado normal (+ `retries:1`) **passaram**. Provei que é independente do tracer com `EBGEO_E2E_NO_TRACE=1` (falha/flaka igual com e sem ele). O `mega` é o "demonstration piece" excluído da suíte normal (`testIgnore`).

> **Bug real exposto pelo ledger (intermitente):** o passo de conflito simultâneo às vezes **diverge** porque `applyRemoteFeatureOp` (UPDATE) faz `features[index] = data` **sem LWW por versão** — duas edições concorrentes na MESMA feição podem deixar A no valor de B e B no de A, sem reconvergência inbound. É uma corrida real (a equipe já a gerencia via `retries`/exclusão); agora **depurável pelo `ledger.jsonl`** anexo. Candidato a correção em lógica core de sync (fora do escopo da observabilidade).
