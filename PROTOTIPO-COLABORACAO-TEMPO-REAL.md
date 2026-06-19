# `prototipo_colaboracao_tempo_real`: analise e ideias

Data: 2026-06-14
Companheiro de `AVALIACAO-REAPROVEITAMENTO.md`, `IDEIAS-EBGEO-WEB-2.md`, `SERVICO-NOMES-GEOGRAFICOS.md`
e `EBGEO-360.md`.

Por que este repo importa: a colaboracao em tempo real e a maior lacuna do `ebgeo_backend`. La o
servidor de sync existe, mas o modulo CRDT nao esta plugado no caminho de escrita e o cliente e
no-op (nenhum `new WebSocket`, `connectionState` nunca vai a ONLINE). Este prototipo (org `1cgeo`,
ultimo commit `31b5937`, 2025-04-02) tem um **loop de colaboracao de fato rodando** (cursores e
comentarios) sobre o mesmo stack de mapa que o EBGeo quer (MapLibre + react-map-gl + Zustand +
React Query). E a melhor fonte de ideias para fechar esse loop.

## 0. Resumo executivo

- **Tecnica**: NAO e CRDT, NAO e OT. E **controle de concorrencia otimista por numero de versao**
  (campo `version` inteiro, `SELECT ... FOR UPDATE`, conflito devolvido ao cliente) + **idempotencia
  por id de operacao do cliente** + LWW implicito para cursor/comentarios. Para o dominio (feicoes
  geograficas com atributos), e mais simples que CRDT e suficiente.
- **O que prova**: da para ter colaboracao de mapa ponta a ponta com o stack da casa (Node/TS +
  Express + Socket.IO + PostGIS + React), sem CRDT lib, com salas por documento e broadcast.
- **A pegar**: a camada de **borda e cliente** que o EBGeo nao tem (carregamento por viewport,
  monitor de qualidade adaptativo, compressao de geometria, presenca/UX, reconexao, batch
  idempotente). NAO trocar o motor de conflito do EBGeo por isto, nem adotar Yjs/Automerge.

---

## 1. Stack

- **Backend**: Node >=18 + TypeScript (ESM), Express 4 (REST), **Socket.IO 4.8** (tempo real),
  pg-promise 11, **PostgreSQL + PostGIS** (SRID 4326, GiST). Sem ORM. Sem testes versionados.
- **Frontend**: React 19 + TS + Vite 6, MUI 6, **MapLibre GL 5** via **react-map-gl 8**,
  **socket.io-client 4.8**, **@tanstack/react-query 5** (cache REST), **zustand 5** (estado local),
  zod, axios.
- **Transporte**: WebSocket via Socket.IO (`transports: ['websocket','polling']`, fallback
  long-polling). Nao e SSE nem WebRTC. REST roda em paralelo ao socket. Sem Yjs/Automerge/Redis.

---

## 2. Arquitetura

- **Salas por mapa**: `roomId = "map-<id>"` (`room-handler.ts`). `join-map` faz `socket.join`,
  registra o usuario, devolve `user-info` + `users`, avisa a sala (`user-joined`) e ja manda
  `features-loaded`. Broadcast sempre `io.to(room).emit(...)`.
- **Presenca/awareness**: cursores ao vivo (cliente faz throttle de 150 ms no `mousemove` ->
  servidor rebroadcast `user-move`); selecao colaborativa (`select-features`/`features-selected`);
  drag de poligono ao vivo (`drag-polygon`/`polygon-dragging`, preview transitorio sem persistir).
- **Persistencia**: tudo durável em PostgreSQL. Estado efemero (presenca, selecoes, cache de "quem
  recebeu o que", stats) fica **em memoria no servidor** com TTL e teto (`MAX_STORED_USERS=10000`).
- **Sync inicial vs delta**: ambos. Ao entrar, **snapshot** (`features-loaded`, ou viewport se >500
  features). Para reconexao, **sync incremental por timestamp**: `get-updates-since {mapId,
  timestamp}` -> `sync-updates {features, comments, deletedFeatures}` (deletados lidos do
  `feature_history`). Mesmo via REST: `GET /maps/:mapId/sync?since=&viewport=&page=`.
- **Reconexao robusta**: `connectionStateRecovery` do Socket.IO (janela 2 min) + `clientId` estavel
  no handshake + auto-rejoin da ultima sala + keepalive ping/pong + **monitor de qualidade
  adaptativo** (`quality-monitor.ts`): mede latencia, classifica excellent/good/poor/critical e manda
  `adaptive-settings` (intervalo de batch, compressao, precisao reduzida, so-viewport, desligar
  realtime). Pensado para usuario de campo em rede ruim.

---

## 3. Tecnica de colaboracao (o algoritmo exato)

**Concorrencia otimista por versao**, em transacao com lock de linha (`features.repo.ts`,
`updateFeature`):
```ts
return this.db.tx('update-feature', async (t) => {
  const current = await t.oneOrNone(`SELECT id, version, ... FROM features WHERE id=$1 FOR UPDATE`, id);
  if (!current) return { success: false };
  if (current.version !== data.version) {           // versao enviada tem que bater
    return { success: false, currentVersion: current.version };
  }
  updates.push(`version = version + 1`, `updated_at = CURRENT_TIMESTAMP`);
  const updated = await t.one(`UPDATE features SET ${updates.join(', ')} WHERE id=$...`, values);
  return { success: true, feature: updated };
});
```
O lock e atomico. Em conflito, o handler emite `feature-update-conflict { featureId, currentVersion }`
e a **resolucao fica a cargo do cliente** (rebuscar e reenviar). Granularidade: a feicao inteira
(geometria e `properties` JSONB sao substituidas, nao mescladas). Para geometria isso e defensavel:
rejeitar e refazer evita merge incoerente de poligono. NAO ha LWW por timestamp+clientId, nem merge
por campo, nem relogio logico.

**LWW implicito** para o que nao tem versao: cursor, comentarios e respostas (so o autor edita/move/
apaga, checado por `user_id`). **Timestamps sao wall-clock** (`Date.now()`, `CURRENT_TIMESTAMP`),
usados para ordenacao e sync incremental, nao como relogio de causalidade.

**Idempotencia** por id de operacao do cliente (`op.id` -> `feature_history.client_operation_id`) e
por `client_id` na feicao. Antes de aplicar, consulta `getOperationByClientId(op.id)` e
`getFeatureByClientId(...)`; se ja existe, devolve sucesso idempotente sem duplicar. E a base do
suporte offline. Replay de delecao via tombstones do historico.

---

## 4. Protocolo (tipos de mensagem)

Eventos Socket.IO nomeados (amostra do contrato completo):
- **Conexao/qualidade**: `connection-info`, `auto-rejoin`, `latency-check(-response)`,
  `connection-quality`, `adaptive-settings`, `keepalive-ping`.
- **Sala/presenca**: `join-map`, `leave-map`, `map-heartbeat`, `get-updates-since` (in);
  `user-info`, `users`, `user-joined`, `user-disconnected`, `user-away`, `sync-updates` (out).
- **Cursor**: `mousemove` -> `user-move`. **Selecao**: `select-features` -> `features-selected`.
- **Features**: `batch-feature-operations`, `get-features-in-bounds`, `delete-features` (in);
  `features-loaded`, `feature-created/updated/deleted`, `feature-update-conflict`,
  `batch-operation-results`, `use-viewport-loading` (out).
- **Poligono (drag colaborativo)**: `drag-polygon` -> `polygon-dragging` (efemero, sem persistir).
- **Comentarios/respostas**: `create/update/delete-comment`, `update-comment-position`, `*-reply`,
  `batch-comment-operations`.

Envelope de operacao (offline/batch):
```ts
{ id: string,          // id da operacao no cliente = chave de idempotencia
  type: 'create-feature'|'update-feature'|'delete-feature'|'create-comment'|...,
  timestamp: number,   // epoch ms do cliente
  offline?: boolean,
  data: { ... } }      // payload por tipo; update exige version
```
Processado em lote por `batch-feature-operations` (socket) e `POST /maps/:mapId/batch` (REST,
transacional), com ack por operacao (`batch-operation-results` com `{success, operationId,
idempotent?, currentVersion?}`) para o cliente dar dequeue.

---

## 5. Modelo de dados

`maps`; `features` (id UUID, map_id, feature_type `point|line|polygon|text|image`, geometry GEOMETRY,
properties JSONB, user_id/name, **version**, `client_id`, `offline_created`); `comments`
(ancorados em lng/lat) e `replies`; `feature_history` (operation `create|update|delete`,
`previous_state`/`new_state` JSONB, `client_operation_id`). Trafega como GeoJSON
(`ST_AsGeoJSON`/`ST_GeomFromGeoJSON`) com **compressao por truncamento de precisao a 5 casas** (~1 m).
O `feature_history` serve a tres coisas: auditoria, idempotencia e descoberta de deletados no sync.

Atencao: o esquema real e criado em runtime por `backend/src/config/schema.init.ts` (UUID + colunas
offline). O `postgres/schema.sql` versionado esta **obsoleto** (usa `SERIAL`, sem `client_id`).

---

## 6. O cliente esta muito atras do servidor (licao central)

O loop fechado que roda de verdade e **so cursores + comentarios/respostas**. O frontend NAO escuta
nenhum evento de feature (`feature-created/updated/deleted`, `features-loaded`), NAO envia `clientId`
nem `lastMapActivity` no handshake, NAO tem fila offline nem dispara batch, NAO rastreia `version`
nem trata conflito, NAO faz sync incremental. Ou seja: todo o aparato de features versionadas, drag
de poligono, selecao colaborativa, batch offline e sync incremental **existe e esta implementado no
backend, mas o cliente ainda nao o exercita**. O prototipo prova o backend de colaboracao, nao o
cliente completo.

---

## 7. Comparacao com o `ebgeo_backend`

| Aspecto | `prototipo_colaboracao` | `ebgeo_backend` |
|---|---|---|
| Transporte | Socket.IO | `ws` puro |
| Conflito | concorrencia otimista por `version` (rejeita + refaz) | modulo CRDT LWW por timestamp+clientId... **porem nao plugado** no caminho de escrita (ver AVALIACAO 2.3); na pratica LWW por ordem de chegada |
| Loop fechado | SIM para cursor/comentario (broadcast + persistencia + re-render reais) | NAO (cliente no-op, nunca vai a ONLINE) |
| Batch offline + idempotencia | implementado (server) por `op.id`/`client_id` | nao tem caminho de reconciliacao em lote; sem idempotencia no log |
| Sync incremental | por timestamp + tombstones do historico | por `server_version` (sequence) hibrido snapshot/delta |
| Viewport loading | SIM (`ST_Intersects` + cache de ids por cliente) | NAO (manda por versao, sem filtro de area) |
| Versionamento | `version` por feicao (so concorrencia) | `server_version` sequence global + `version` por linha |
| Testes | nenhum | suite forte (~600 casos) |

O que o prototipo fecha que o EBGeo deixa em aberto: broadcast real para a sala, batch offline com
idempotencia, viewport loading, monitor de qualidade, e um **cliente de referencia** no stack certo.
O que o EBGeo tem melhor: o desenho de versao por sequence global (replay deterministico) e a suite
de testes. Os dois compartilham a mesma limitacao de escala (estado de tempo real em memoria, uma
instancia, sem Redis).

---

## 8. Ideias priorizadas a carregar

1. **Carregamento espacial por viewport + cache de ids por cliente** (`ST_Intersects` +
   `ST_MakeEnvelope` + `Set` de enviados, `feature-handler.ts`). Maior impacto: corrige o gargalo de
   "manda tudo" do sync por versao do EBGeo. Para mapa militar com muitas feicoes, e o que escala.
2. **Cliente de colaboracao de verdade**, espelhando o que o frontend do prototipo deixou de fazer:
   handshake com `clientId` estavel, fila offline + reenvio idempotente, escuta de eventos de
   feature/selection, fly-to, presenca. E a peca que o EBGeo mais precisa (o motor ja existe la). O
   stack do cliente (MapLibre + react-map-gl + Zustand + React Query) ja e o que o EBGeo quer.
3. **Monitor de qualidade + degradacao adaptativa** (`quality-monitor.ts`): medir latencia e baixar
   qualidade (batch maior, precisao reduzida, so-viewport) sob rede ruim. Casa com uso de campo/VPN.
4. **Compressao de geometria por precisao** (`geometryCompression.ts`, `ST_AsGeoJSON(geom, n)` com a
   precisao variando pela qualidade da conexao). Trivial de portar, ganho de banda imediato.
5. **Batch transacional com ack por operacao** (`results[]` com `success`/`idempotent`/
   `currentVersion`): contrato que permite ao cliente ter fila offline com dequeue confiavel. Casa
   com o sync do EBGeo (o batch vira o transporte das operacoes).
6. **Idempotencia de primeira classe** por `op.id` (`client_operation_id`) + `client_id`, com replay
   de delecao via tombstones do historico. Carregar **com UNIQUE constraint** em `client_operation_id`/
   `client_id` e `ON CONFLICT DO NOTHING` (o prototipo nao tem UNIQUE: dedup e check-then-insert,
   nao race-safe). Resolve um gap apontado no AVALIACAO 2.4 do ebgeo_backend (sem idempotencia).
7. **Distinguir queda de rede de saida intencional** (marcar `away`, nao remover) + reconexao por
   `clientId`/`auto-rejoin`. Evita o "usuario pisca na lista" a cada oscilacao.
8. **UX de presenca**: cursores rotulados, toggle de privacidade, indicador de quem-edita/selecionou,
   lista de presenca, indicador online/offline. O EBGeo ja transmite `cursor`/`selection`, falta a
   tela.
9. **Anti-DoS no endpoint de sync** (`sync.controller.ts`): paginacao, teto de itens, aviso de
   dataset grande.

---

## 9. Recomendacao: lib (Yjs/Automerge) vs CRDT proprio do EBGeo

**Manter o modelo proprio do EBGeo (LWW + log append-only por sequence), nao adotar Yjs/Automerge.**
- O motor do EBGeo ja esta no repo (resolver/merger LWW + log de operacoes + `server_version` por
  sequence). O que falta nao e o motor, e (a) plugar a resolucao de conflito no caminho de escrita
  (decisao do AVALIACAO 2.3) e (b) o cliente. Trocar por Yjs/Automerge jogaria isso fora.
- Yjs/Automerge brilham em **texto colaborativo** e estruturas finas (listas, arvores). O dominio
  aqui e **feicao geografica com atributos**: LWW por campo + rejeitar/refazer em geometria e mais
  simples de raciocinar e auditar, e o log append-only da a auditoria que o setor exige. CRDTs de
  documento dificultam auditoria e incham o estado.
- O prototipo, de forma independente, chegou a mesma conclusao (versao otimista + idempotencia, sem
  CRDT lib), o que reforca que LWW + log e o ajuste certo para feicoes.
- Ressalva: se um dia houver edicao colaborativa de **texto livre** (descricoes longas, briefing
  rico) com merge caractere a caractere, ai Yjs num campo especifico se justifica, isolado, sem
  trocar o motor de feicoes.

Melhoria sobre o prototipo: trocar o gatilho de sync de `updated_at` (relogio de parede, risco de
borda de timestamp e de regressao de relogio) pelo **`server_version` monotonico por mapa** que o
EBGeo ja tem. Esse "server sequence" e o que da replay deterministico.

---

## 10. O que NAO copiar (licoes negativas)

- **Endpoint HTTP de batch quebrado** (`batch.controller.ts`): chama `t.createFeature(...)`,
  `t.getFeature(...)` no objeto de transacao `t`, mas os metodos de repositorio sao anexados a `db`
  via `Object.assign(db, {...})`, nao a `t`. Logo `t.getFeature is not a function` em runtime. O
  caminho de batch por socket (usa `db.xxx`) funciona; o HTTP nao. Licao: o sync transacional precisa
  de repositorios que aceitem o `t` como contexto (o `ebgeo_backend` faz certo, `tx(async t => ...)`
  passando `t` adiante).
- **`postgres/schema.sql` morto e divergente** (SERIAL, sem `client_id`). Ter dois schemas, um
  errado, e armadilha. O EBGeo usa migrations versionadas, entao ja faz melhor.
- **Sem UNIQUE em `client_operation_id`/`client_id`**: a idempotencia e check-then-insert, correta no
  caso serial, race no concorrente. Adicionar UNIQUE + `ON CONFLICT`.
- **Sem testes** (nenhum `.test`/`.spec`). Os casos dificeis (conflito de versao, reenvio idempotente,
  ordem fora de sequencia) sem cobertura. Cobrir antes de producao.
- **Identidade efemera** (nome aleatorio, sem auth): nao copiar; o EBGeo ja tem JWT + permissoes.
- **Estado de tempo real em memoria, instancia unica, sem Redis**: nao escala horizontalmente
  (broadcasts `io.to(room)` so alcancam a mesma instancia). Mesma limitacao do EBGeo hoje; o caminho
  de escala e adapter Redis (Socket.IO) ou pub/sub Redis para o `ws`, mantendo o durável no Postgres.
- **`.env` presentes na arvore** (backend e frontend): conferir que nao vazaram segredos antes de
  reaproveitar.

---

## 11. O que isto encurta no caminho de ativar a colaboracao

- Entrega um **cliente de referencia funcionando** (cursores, presenca, comentarios espaciais,
  reconexao, indicador de conexao) sobre o mesmo stack de mapa que o EBGeo quer. Copiar a estrutura
  do cliente economiza a maior lacuna do EBGeo.
- Entrega **viewport-loading + cache + compressao** ja codado, a peca de escala que o sync do EBGeo
  nao tem.
- Entrega o **monitor de qualidade adaptativo** inteiro, raro de achar pronto, alinhado ao uso de
  campo.
- Mostra o **contrato de eventos completo** de uma colaboracao de mapa (nomes, payloads, fluxo
  join/sync/batch/conflito), servindo de mapa para ligar o cliente no-op do EBGeo ao motor existente.
- Da **licoes negativas concretas** (batch transacional precisa passar o `t`; schema unico; UNIQUE
  para idempotencia; cobrir os tres casos dificeis com teste) para nao repetir os erros.

Arquivos-chave (sob `prototipo_colaboracao_tempo_real\backend\src\`): `services/socket/index.ts`,
`services/socket/handlers/feature-handler.ts` (batch/idempotencia/broadcast),
`handlers/room-handler.ts` (join/sync/heartbeat), `handlers/polygon-handler.ts` (update otimista +
conflito), `services/socket/quality-monitor.ts`, `db/repos/features.repo.ts` (`FOR UPDATE`),
`db/repos/feature-history.repo.ts` (tombstones), `controllers/sync.controller.ts` e
`batch.controller.ts` (este ultimo quebrado), `config/schema.init.ts` (schema real). Frontend:
`frontend/src/App.tsx`, `components/MapContainer.tsx`, `components/UserMarker.tsx`,
`store/useUserStore.ts` (cliente: so cursor/comentario).
