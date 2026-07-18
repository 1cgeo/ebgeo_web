# Síntese: decisões arquiteturais e não-objetivos

Quadro consolidado das escolhas que moldam o que o sistema pode e não pode fazer, backend aditivo com exceção única do bootstrap de config, LWW em vez de CRDT, um único workspace local (P12), 360 absorvido, WebSocket sem backplane, e das razões por trás de cada uma.

## O eixo central: o backend é aditivo

O produto nasceu local-first (IndexedDB + arquivos `.ebgeo`) e o backend foi acrescentado sem virar pré-requisito do caminho de edição. Login é capacidade extra, nunca porta de entrada.

Os mecanismos que sustentam isso não são disciplina de código, são gates concretos:

- O marcador de origem começa em `local` e é **ausente** para todo usuário pré-existente (`src/js/store/store-origin.js:31`, `DEFAULT_ORIGIN`), então a maquinaria remota só engata após um connect explícito. Ver [[dominio-local-vs-remoto]].
- O gate de papel só vale em atlas remoto conectado: `sessionContext.isOffline() || !isRemoteStoreSync()` libera tudo (`src/js/store/sync/permission-guard.js:71`). Sem isso, um usuário logado com papel global `viewer` não conseguiria desenhar no próprio store local. Ver [[permissoes-atlas]].
- O log/flush de operações é gated por conexão, então deslogado nada é transmitido. Ver [[fila-operacoes-outbound]].

### A exceção única e deliberada: bootstrap de config

O servidor **é** pré-requisito para o app *subir*. `GET /api/config` é fonte única de config e catálogo, e o boot é fail-fast: 3 tentativas com 1s de intervalo e, sem resposta, a tela "EBGeo indisponível" (`src/js/index.js:73-86`). Não existe config estático de reserva; o `config.js` embarcado é só o *shape* que o servidor hidrata.

**Armadilha de vocabulário:** onde a documentação diz "offline", leia **"sem login"**, não "sem servidor". O caminho "sem backend algum" não é mais suportado, e o caminho **anônimo com backend no ar** é o que os testes cobrem. Ver [[config-dinamico]] e [[config-runtime-urls-relativas]].

## LWW por ordem de chegada, não CRDT

A colaboração é **server-authoritative last-write-wins pela ordem de chegada ao servidor**, não por timestamp e não por merge de estrutura de dados. O servidor carimba cada op broadcastada com o `serverVersion` que ele mesmo atribuiu, e é essa ordem que os pares usam para convergir (`backend/src/modules/sync/sync.controller.js:15-16`).

Consequências que um engenheiro precisa internalizar:

- O relógio de Lamport viaja no envelope mas **não decide conflito** algum. Ele registra causalidade, o servidor define a ordem total. Ver [[envelope-operacao]] e [[modelo-conflito-lww]].
- A granularidade do LWW é a **feição inteira**, não por propriedade. Dois usuários editando propriedades diferentes da mesma feição ao mesmo tempo não fazem merge, o último a chegar sobrescreve.
- Delete (soft) vence updates subsequentes na ordem de chegada.
- Idempotência é por `op_id` do cliente, então reenvio é seguro por construção. Ver [[idempotencia-e-convergence-guard]] e [[ack-idempotencia]].

**Por que não CRDT:** o custo de um CRDT verdadeiro (estrutura de dados, tamanho de metadados, complexidade de merge por propriedade) não se paga para o padrão de uso real, no qual duas pessoas raramente editam a mesma feição no mesmo segundo. O modelo escolhido é o do Google Docs em espírito (sem locks, ninguém trava ninguém), mas com autoridade central. Detalhe em [[sintese-nao-e-crdt]].

O `locked` de mapa não contradiz isso: é **aviso de UI, frontend-only**, não um lock de concorrência.

## Um único workspace local (P12), não-objetivo explícito

**Múltiplos atlas locais nomeados coexistindo no IndexedDB NÃO serão feitos.** Local = 1 workspace + `.ebgeo`; "atlas nomeado" é capacidade do servidor.

O raciocínio: namespacing por atlas no IndexedDB seria um refactor pesado da camada de persistência **sem ganho de princípio**, porque a separação local↔remoto já é garantida pelo marcador de origem, e só adicionaria risco ao caso de uso número 1 (offline). Portabilidade e multiprojeto local se resolvem por exportar/importar `.ebgeo`.

Dois corolários que causam bug se ignorados:

- O store guarda **um atlas por vez**. Trocar de atlas é destrutivo e ordenado: desconecta o anterior, limpa todo o store, conecta o novo. Não há merge implícito. Ver [[atlas-modelo-de-dados]].
- Mapas de atlas remoto são chaveados por **UUID**; o mapa local padrão `Principal` é chaveado por nome e não tem UUID. Op cujo `mapId` de contexto não é UUID é **descartada antes de entrar na fila** (`src/js/store/sync/operation-dispatcher.js:133-136`), e o mesmo vale para op de SETTING com id não-UUID (`:120-123`). Isso serve a dois propósitos: impedir vazamento de feição local para atlas do servidor, e evitar que **uma única op inválida envenene o lote de flush e trave toda a sincronização** (o Postgres rejeita mapId não-UUID com 22P02). Ver [[fila-operacoes-outbound]] e [[tipos-entidade-sync]].

## Dado remoto é efêmero por decisão

Dado de atlas remoto vive no IndexedDB apenas enquanto conectado, e é apagado no logout/desconexão; um *boot guard* descarta dado remoto órfão encontrado com ninguém autenticado.

**O porquê:** dado remoto sobrevivendo ao logout seria editável offline sem sincronizar com ninguém. O usuário acharia que está colaborando quando estaria editando uma cópia morta. A regra de ouro operacional é: **baixe o `.ebgeo` antes de desconectar** se quiser guardar. Ver [[sessao-boot-e-ciclo-de-vida]] e [[formato-ebgeo-roundtrip]].

Isso amarra dois princípios de cobertura que valem como checklist ao adicionar qualquer tipo de dado persistido:

- **P9**: tudo que entra no `.ebgeo` precisa ter caminho de sincronização (sync ⊇ `.ebgeo`). Faltou caminho, é bug de cobertura.
- **P11**: round-trip `.ebgeo` → servidor → `.ebgeo` **por outro usuário** deve ser sem perda. Toda adição ao *transform* local→servidor exige a contrapartida em `applyRemoteSnapshot` mais um teste de fidelidade. Diferenças aceitáveis e intencionais: IDs remapeados para UUID, novo id de atlas, arredondamento de coordenadas no export. Ver [[snapshot-e-pull-incremental]] e [[aplicacao-operacoes-remotas]].

## Undo/redo é local por sessão, nunca sincroniza

Ctrl+Z desfaz só o que o **próprio** usuário fez. Op recebida de outro colaborador jamais entra na pilha de undo local: `remote-operation-handler` aplica sem registrar undo, e as pilhas são estado de UI por sessão. É o comportamento do Google Docs, e é uma decisão, não uma limitação a corrigir.

## Escrita de entidade só via sync (com exceções estruturais)

Não há rota REST de escrita para feature/layer/group/briefing/slide. Mutações viajam como operações. REST cuida de metadados de atlas, compartilhamento e imagens. Ver [[sintese-rest-vs-sync]], [[sintese-rest-vs-websocket]], [[api-rest-atlas]] e [[tabela-operations]].

> **[!CONTRADICAO] Regra ampla demais.** A formulação herdada ("escrita só via sync" para todas as entidades do atlas) não bate com o código: existem três escritas estruturais por REST, deliberadamente atômicas e portanto impróprias para o modelo de op incremental: `POST /atlas/:atlasId/maps/:mapId/merge` (`backend/src/modules/maps/maps.routes.js:16`), `POST /atlas/:atlasId/maps/:mapId/duplicate` (`backend/src/modules/atlas/atlas.routes.js:44`) e o bulk `POST /atlas/import` (`backend/src/modules/atlas/atlas.routes.js:22`). Leia a regra como "escrita **incremental** só via sync".

## WebSocket sem backplane, a limitação de escala aceita

O estado de salas e presença é um `Map` **em memória por processo** (`backend/src/modules/collab/collab.rooms.js:6`). Não há Redis, pub/sub ou backplane em lugar nenhum do backend.

Em termos duros:

- `broadcastToRoom`/`closeRoom` só alcançam clientes conectados **àquela instância**. Rodar 2 ou mais réplicas **quebra o broadcast cross-instância**: cursor, seleção, `operations` e `atlas_updated` não chegam a quem está em outra réplica.
- O WS está acoplado ao mesmo processo HTTP (`createServer(app)` + handler de `upgrade`), então não dá para escalar WS separado do HTTP.
- O **durável** (atlas, ops, sync, metadados 360) está no Postgres. Só o fan-out em tempo real é por-instância. A perda numa horizontalização mal feita é **silenciosa**, não é erro.

**Caminho de menor risco em produção: uma instância do backend (escala vertical).** Horizontalizar exige sticky sessions mais backplane **antes**, não depois. O mesmo defeito afeta o rate limiter (`express-rate-limit` in-memory por instância, logo o limite multiplica pelo número de réplicas). Ver [[canal-collab-websocket]], [[sintese-limites-collab]] e [[presenca-colaborativa]].

Compensações já implementadas dentro da instância única: backpressure por socket, com frames coalescáveis (`cursor`, `temporal`, `selection`) descartados a 1 MiB de buffer não drenado e socket terminado a 8 MiB (`backend/src/modules/collab/collab.rooms.js:13-15`). A assimetria é deliberada: descartar frame de presença se auto-cura no próximo frame, descartar op durável divergiria o par em silêncio; por isso o socket travado é morto para reconectar e reaplicar via `sync_request`. Ver [[qualidade-conexao-adaptativa]].

## StreetView 360 absorvido

O 360 deixou de ser microsserviço separado e virou o módulo `sv360` do backend único, montado em `/api/v1/sv360` (`backend/src/app.js:112`). **Não existe mais upstream `:8081`** (`backend/src/config.js:158`).

O preço da absorção foi manter um **contrato congelado**: as rotas do `sv360` respondem **nuas** (objeto ou array, sem envelope `data`) e usam envelope de erro **plano** `{ "error": "..." }`, diferente do `{ error: { code, message } }` global. `GET /nomes/busca` também responde array nu. Quebrar isso quebra clientes existentes. Ver [[streetview-360]], [[sintese-contratos-congelados]], [[sintese-contrato-erros-http]] e [[erros-api]].

Decisão correlata de armazenamento: **BLOB pesado não vai para o Postgres**. Binários WebP do 360 ficam em SQLite por projeto (`{orgId}__{slug}.db`, ~41 GB no dataset real) e assets 3D em SQLite mais fallback de FS; o Postgres guarda metadado e ponteiro. O nome do `.db` é derivado server-side de `(orgId, slug)` e o `db_filename` do manifest do cliente é **ignorado**, como guard anti-overwrite cross-OM. Ver [[assets3d-distribuicao]], [[catalogo-3d]], [[calibracao-e-grafo-360]] e [[ingestao-projetos-360]].

## Persistência: JSONB e PostGIS coexistindo isolados por schema

Um banco, três schemas: `public` (atlas e features com geometria em **JSONB**, sem PostGIS), `ng` (gazetteer PostGIS, catálogo 3D, zonas) e `sv360`. PostGIS foi **aditivo**: não converteu o schema do atlas.

Armadilha de deploy: a migração `004` faz `CREATE EXTENSION postgis`, que é untrusted, exige superusuário e roda **incondicionalmente**. Logo **PostGIS é pré-requisito de qualquer deploy completo, mesmo um deploy só do atlas**. Ver [[deploy-backend]], [[gazetteer-nomes-geograficos]] e [[zonas-acesso-geografico]].

Migrações são **forward-only, sem rollback, rastreadas por NOME de arquivo**. Nunca renumere, renomeie ou reordene uma migração já aplicada; para corrigir defeito, adicione a próxima. A mesma convenção levou o schema de comentário a entrar **editando o baseline `backend/src/database/migrations/002_atlas.sql` in-place**, não numa migração nova.

No cliente vale o mesmo princípio (v1→v2→v2.1→v2.2, no boot). **Invariante de migração: atualizar o app nunca pode apagar ou tornar inacessível um atlas que já estava em operação.**

## Identidade: um único emissor de JWT

Há **um** emissor de token, este backend. O payload carrega dois eixos ortogonais: papel global (`role ∈ {user, admin}`) e identidade org-scoped (`organization_id` + `org_role`), com aliases `org`/`login` mantidos por compatibilidade com o que o 360 lia. Como agora o **mesmo processo** valida o token, sumiu o problema de "alinhar dois serviços". Tokens legados sem claim de org ainda validam (`org_role→viewer`, `organization_id→null`). Ver [[autenticacao-jwt]], [[jwt-emissor-unico]], [[refresh-token-rotacao]], [[auth-flexivel]] e [[organizacoes-om]].

A permissão por atlas é um **terceiro** eixo, resolvido em waterfall: owner → share → público → 403, na hierarquia `owner > manage > write > comment > read`. Ver [[sintese-eixos-de-permissao]] e [[sintese-capacidades-por-papel]].

## Decisões menores com consequência grande

- **Link público = somente leitura, e "acesso geral" = só o link.** Não há papel por organização concedido implicitamente; convidar é sempre share explícito por usuário. Decisão de produto para um GIS sensível. O token do link expira em ~1h e o visitante público **não recebe comentários**. Ver [[link-publico]] e [[compartilhamento-atlas]].
- **Visualizador não recebe comentários do servidor**: é **filtro de transmissão** (snapshot e broadcast não enviam), não esconde-UI. Ver [[comentario-espacial]].
- **"A permissão padrão abaixa, nunca eleva"**: convite concede Leitura por padrão; elevar é ação deliberada.
- **Config por atlas é interseção, nunca expansão**: um `atlas.settings` só desliga o que o deploy suporta, jamais liga o que não existe, e é revertido ao desconectar. Ver [[atlas-settings]], [[resources-catalogo]] e [[modos-operacao]].
- **Sem thumbnail/snapshot de atlas** nos cards do Atlas Drive (faixa colorida com iniciais, cor determinística do nome). Decisão de escopo.
- **Mídia do catálogo embutida em base64** no config, porque não há static público no backend e `deploy/` é protegido.
- **Ex-dono vira Gestor** na transferência de propriedade, transação atômica, nunca existe estado "sem dono". Ver [[clone-atlas]] e [[gestao-usuarios]].
- **Sem CI no GitHub** no backend: nada roda lint/test/build em PR. Não há rede de segurança no servidor, rode local antes de publicar a imagem.
- **Observabilidade de sync é test/dev only**: o SyncLedger é env-gated e em produção é branch morto, com cross-check `!config.isProd` para o caso de `EBGEO_TRACE=1` vazar. Ver [[syncledger]].
- **Imutabilidade de cache** é padrão carregado: imagens, assets 3D e thumbnails 360 são `immutable` com ETag O(1)/304/Range; tiles MVT do 360 são `max-age=60` porque mudam a cada ingestão. Ver [[sintese-cache-http-imutavel]], [[imagens-atlas]] e [[upload-imagens-seguranca]].

## O que fica fora do sync

Gazetteer, catálogo 3D, assets e panoramas 360 são **REST read-only** sobre PostGIS, com autorização embutida na própria query SQL: um dado privado só aparece para admin, permissão direta ou geometria contida numa zona do usuário. A consequência é que **não existe caminho de UI que contorne a autorização**, mas também que uma mudança de zona não invalida resultado já entregue. Ver [[sintese-modulos-fora-do-sync]], [[ranking-busca-toponimos]], [[sync-admin-operacoes]], [[atlas-import-offline]], [[hardening-borda-api]], [[api-keys]], [[auditoria]], [[client-id-estavel]] e [[modulo-temporal]].

## Não-objetivos declarados (lista curta)

1. Múltiplos atlas locais nomeados no IndexedDB (P12).
2. CRDT verdadeiro com merge por propriedade.
3. Locks de edição, ninguém bloqueia ninguém.
4. Undo/redo global ou sincronizado.
5. Backend como pré-requisito de qualquer ação de edição, salvo o bootstrap de config.
6. Escala horizontal do WebSocket sem backplane.
7. PMTiles e GeoJSON-como-fonte no 360 (descontinuados; não provisionar tippecanoe).
8. Suporte a lista de origens em CORS (uma única origem, `credentials:true`, então `'*'` não funciona).
9. Rate limit global entre réplicas (store in-memory, por instância).
