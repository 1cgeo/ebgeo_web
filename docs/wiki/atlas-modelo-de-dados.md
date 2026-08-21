# Atlas (modelo de dados)

O Atlas é a fronteira única do sistema: isolamento de dados, permissão, sala de tempo real e ordenação de operações são todos desenhados por `atlas_id`, e o preço dessa escolha é que um projeto nomeado só existe plenamente no servidor.

Schema autoritativo: `backend/src/database/migrations/003_atlas.sql` (entidades) e `backend/src/database/migrations/004_sync.sql` (log). Entidade do cliente: `frontend/src/js/store/atlas/atlas.entity.js`.

## Uma fronteira só, e por quê

Dados, permissão (`middleware/permissions.js`), sala WS (`backend/src/modules/collab/collab.rooms.js`) e idempotência (`backend/src/database/migrations/004_sync.sql`) usam a mesma chave. Não existe broadcast entre atlas nem query cross-atlas por construção, e é isso que torna as guardas anti-IDOR baratas: `applyOperation` usa `INSERT ... SELECT ... WHERE EXISTS (mapa pertence a ESTE atlas)`, então uma op com `mapId` alheio não escreve nada em vez de escrever no lugar errado. O merge de mapas exige mesmo atlas; o upgrade do WS re-reconcilia autorização a cada heartbeat e fecha com `4003` quando um share é revogado. Ver [[permissoes-atlas]], [[canal-collab-websocket]], [[idempotencia-e-convergence-guard]].

## Os três contadores não são a mesma coisa

Armadilha número um: `atlas` tem três colunas que parecem versão e não são comparáveis.

- **`version`** conta edições de metadados via REST. Nada a ver com sync.
- **`current_version`** é o cursor do log, mantido pelo trigger no INSERT em `operations` (`backend/src/database/migrations/004_sync.sql`). É o `lastVersion` do pull incremental.
- **`min_version`** é o piso após poda do log (`backend/src/modules/sync/sync.service.js`). Pedir uma versão abaixo dele devolve snapshot completo em vez de erro (`backend/src/modules/sync/sync.service.js`): comportamento silencioso, não falha. Ver [[snapshot-e-pull-incremental]], [[sync-admin-operacoes]].

`server_version` vem de `nextval('atlas_version_seq')`, sequência **global** entre todos os atlas (`backend/src/database/migrations/004_sync.sql`). Dentro de um atlas é crescente mas **não contígua**: serve para ordenar, nunca para contar operações ou calcular "quantas versões atrás".

Duas inconsistências internas do schema, ambas em migração já aplicada e portanto congeladas (mexer nelas violaria a regra de migrações, então ficam registradas aqui em vez de corrigidas):

O trigger faz `SET current_version = NEW.server_version` sem `GREATEST` (`backend/src/database/migrations/004_sync.sql`), apesar de a semântica pretendida ser um máximo. Coincide na prática (sequência crescente, push transacional), mas não raciocine sobre inserções concorrentes assumindo máximo.

O comentário `-- 18 valid feature types` acima de `features.feature_type` (`backend/src/database/migrations/003_atlas.sql`) contradiz o próprio CHECK logo abaixo, que aceita **20** (a constraint `valid_feature_type`). O CHECK manda. Os dois extras são `processed_los`/`processed_visibility`, saídas de análise e não ferramentas; por isso `SOURCE_TYPES` no cliente tem 18. Eles precisam de linha explícita em `FEATURE_TYPE_MAPPINGS` (`frontend/src/js/store/store.constants.js`): o fallback `source + 's'` gerava `processed_loss` e o resultado caía num bucket fantasma no peer, sem nunca renderizar.

## Deleção é soft, e o CASCADE é decorativo

`DELETE /atlas/:id` marca `deleted_at` (`backend/src/modules/atlas/atlas.service.js`). As FKs dizem `ON DELETE CASCADE`, mas como nunca há hard-delete, **mapas, feições, briefings e o log de `operations` permanecem no banco**. O atlas some das listagens e a sala fecha; `GET /atlas/trash` + `POST /:id/restore` trazem tudo intacto. Não assuma que deletar um atlas liberou espaço ou apagou dado de usuário. O soft-delete é obrigatório aqui porque o sync precisa **propagar** a exclusão: um DELETE físico não teria o que sincronizar. Ver [[tipos-entidade-sync]].

## Dois "Atlas", dois `settings`

O objeto do cliente e a linha do Postgres não são o mesmo shape, e o campo homônimo tem significados opostos:

- Cliente: `settings` é só `{ terrainExaggeration }`, propriedade **do atlas**, não do mapa.
- Servidor: `settings` é allowlist de **disponibilidade de recursos**, e vira overlay que **só restringe** sobre o `config` global (`frontend/src/js/store/sync/atlas-settings.service.js`, `intersectAvailability`). Nunca reativa o que o deploy desligou: 3D removido no build do GitHub Pages continua removido, diga o atlas o que disser. Ver [[atlas-settings]], [[config-dinamico]].

Contrato: chaves de disponibilidade **nunca** entram por op de sync do tipo `SETTING` (que faz merge whitelisted); só `PATCH /settings` com `manage` altera restrição. Quem tentar propagar restrição pelo canal de sync vai ver o merge aceitar e o efeito não acontecer.

## Um atlas montado por vez, N conjuntos de bancos no disco

O registro de Atlas é singleton **dentro de um namespace**: chave fixa `current_atlas` (`frontend/src/js/store/repositories/local.repository.js`), um registro por conjunto de bancos. Esta seção dizia que namespacing por atlas tinha sido **rejeitado** e que o local era um workspace só (P12); desde 2026-08-15 cada atlas, local ou de servidor, tem o seu conjunto de dez bancos, e o expurgo do remoto é derivado de registro. Ver [[namespace-por-atlas]].

O que não mudou: a separação local↔remoto continua sendo o marcador de origem (`store/store-origin.js`; note: em `store/`, não em `store/sync/`), default `local` e ausente para todo usuário pré-existente, de modo que a máquina remota nunca interfere em quem nunca logou. E o app continua **montando um atlas por vez**: trocar de atlas de servidor é destrutivo para o atlas montado, mas não para a fila de saída dele, que vive no namespace dele e sobrevive à saída ([[namespace-por-atlas]]). Ver [[dominio-local-vs-remoto]], [[formato-ebgeo-roundtrip]].

Consequências que causam bug se ignoradas:

1. **Abrir um atlas do servidor apaga o store** (`account/open-atlas.service.js`). Trocar de atlas é destrutivo por design. Invariante: abrir o atlas B nunca pode deixar visível feição, camada ou mapa do atlas A; por isso o clear inclui o registro do atlas. A fila de operações não flushadas fica **de fora** desse clear, e a exceção é o que a torna correta: o wipe roda com o namespace de B já montado, então varrer a fila ali seria destruir o pendente DE B três linhas antes do `connect` que o drenaria ([[fila-operacoes-outbound]], [[namespace-por-atlas]]).
2. **A origem é marcada REMOTE antes do connect**, de propósito: se a aba morrer no meio do pull, a guarda de boot vê `remote` e descarta o parcial em vez de promovê-lo a atlas local permanente.
3. **Dado remoto não sobrevive ao logout** (`enforceLocalStoreWhenLoggedOut`, `frontend/src/js/store/store.js`). Para levar um atlas do servidor para uso offline, exporte o `.ebgeo` **antes** de desconectar. Não há segunda chance. Duas ressalvas do namespace por atlas, ambas com prazo e nenhuma delas um furo: o namespace que outra aba tem MONTADO é poupado até o prazo vencer, e o trabalho não sincronizado de uma sessão que caiu sozinha é adotado como atlas local em vez de destruído. Ver [[namespace-por-atlas]].

## Identidade de mapa: UUID vs nome

Mapas de atlas remoto são chaveados por UUID; o `Principal` local é chaveado por nome e não tem UUID. Isso atravessa três arquivos, e cada um só enxerga o próprio terço:

1. Op cujo `mapId` de contexto não é UUID é descartada **antes da fila** (`frontend/src/js/store/sync/operation-dispatcher.js`). Sem isso o Postgres rejeita com 22P02 e **uma** op inválida derruba o lote inteiro do flush, travando toda a sincronização. Op de `SETTING` escapa apenas com UUID ou o sentinela literal `'atlas'`.
2. `activateAtlasInitialMap` **remove** todo mapa não-UUID ao ativar o mapa inicial (`frontend/src/js/store/map.operations.js`). Um `Principal` recriado no boot sombrearia por nome um mapa remoto homônimo, e o usuário, inclusive o dono logo após "Enviar ao servidor", cairia num mapa vazio.
3. A resolução de mapa é por **nome**, não pela chave de armazenamento: presença e cursor viajam com o nome, e peers filtram o que vier com UUID cru.

## Dois mundos de mutação, escolha explícita

Metadados de atlas são REST; feições, mapas, camadas, grupos, briefings, slides, 3D, 360 e comentários são **sync-only**, sem rota REST de escrita ([[sintese-rest-vs-sync]], [[envelope-operacao]]). Rotas em `modules/atlas/atlas.routes.js` (53 linhas, autoexplicativas).

O que muda o atlas **fora** do log de operações (`atlas_updated`, `map_duplicated`, `maps_merged`) força **re-pull de snapshot**, não apply de op (`frontend/src/js/store/sync/ws-client.js`). Imagens são o terceiro caminho: blob por REST, referência pelo sync. **Ao adicionar qualquer mutação REST no atlas, decida explicitamente em qual desses mundos ela cai**. Esquecer disso produz um cliente que nunca vê a mudança até o próximo F5.

`EntityType.ATLAS` existe no enum de sync mas está morto: mudanças de nível de atlas viajam como `SETTING` com id `'atlas'` mais broadcast `atlas_settings_updated`.

## Permissões: o que é específico do atlas como entidade

A hierarquia numérica, o bypass do admin global e o 404-vs-403 estão em [[api-rest-atlas]] e [[permissoes-atlas]]. Duas propriedades pertencem ao modelo de dados e não ao gate:

- **`owner` não é linha de `atlas_shares`** (o CHECK só aceita até `manage`): a posse mora em `atlas.owner_id` e só muda por `POST /:id/transfer`.
- **O alvo de um share é uma pessoa OU um grupo de acesso**, desde 2026-08-21, e a posse continua exigindo share DIRETO: transferir para quem só alcança o atlas por grupo trocaria uma autoridade revogável por uma irrevogável. Ver [[compartilhamento-atlas]].
- **O gate de papel só vale para atlas remoto conectado.** O store local é sempre editável, inclusive por usuário logado.

Papel de acesso do atlas e papel de identidade do frontend são vocabulários distintos: [[sintese-capacidades-por-papel]], [[autenticacao-jwt]].

O link público emite JWT efêmero (1h, `read`, identidade "Visitante") que serve para pull **e** WebSocket; no cliente `connectPublic()` desliga o logging de operações, então o visitante recebe tempo real e presença mas nunca enfileira op. Ver [[link-publico]], [[compartilhamento-atlas]].

## Detalhes que costumam morder

- **`images` não tem `version` nem `deleted_at`** (`backend/src/database/migrations/003_atlas.sql`). É a única filha do atlas fora do modelo de soft-delete/sync. Blobs sobem preservando o id (`INSERT_IMAGE_WITH_ID`) para que referências feição→imagem sobrevivam sem reescrita. Ver [[imagens-atlas]].
- **Comentários não vão para conexões `read`**: o filtro é de transmissão, no snapshot (`backend/src/modules/sync/sync.service.js`) e no pull incremental, não de renderização. Respostas são entidades próprias com `parent_id`, para não haver clobber LWW numa thread. Ver [[comentario-espacial]].
- **`maps.locked` é aviso de UI, não lock de concorrência.** Ninguém bloqueia a edição de ninguém (P10).
- **`catalog_layers` é tabela própria, e desde 2026-08-18 é a ÚNICA casa.** Existia uma coluna homônima em `maps`, para clone/import e clientes de array; ela nunca teve leitor no cliente e servia a definição de recurso por três rotas que não passam pela reidratação do snapshot, então saiu do schema em vez de ganhar um filtro. A chave `catalog_layers` do payload de import continua aceita e é materializada na tabela.
- **Toda escrita do sync é `INSERT ... SELECT ... WHERE EXISTS`, e o motivo não é anti-IDOR, é o 23503.** Uma FK violada custa a op: desde 2026-07-25 ela é recusada por operação em vez de abortar o lote (antes travava o sync inteiro do cliente), e em qualquer dos dois regimes a escrita se perde, e por isso o apply prefere gravar zero linhas a estourar. `groups.parent_id` (`backend/src/database/migrations/003_atlas.sql`) é a exceção aberta: o insert de grupo guarda só o mapa e passa o `parent_id` cru, enquanto o insert estruturalmente idêntico de comentário também exige que o pai exista (`applyOperation` e `applyCommentOp`, `backend/src/modules/sync/sync.service.js`). A compactação da fila outbound remove pares CREATE+DELETE, então o create do grupo-pai pode sumir e o do filho chegar com pai pendurado. A assimetria não é visível em nenhum dos dois arquivos isoladamente.
- **Dois formatos de índice parcial de soft-delete, e só um paga.** `backend/src/database/migrations/003_atlas.sql` traz a forma `<tabela>(id) WHERE deleted_at IS NULL`, que indexa a coluna **já coberta pela PK**, e a forma `<tabela>(<fk>) WHERE deleted_at IS NULL`, que serve o acesso que o sync realmente faz, "todos os filhos vivos deste mapa". Ao acrescentar tabela filha nova, copie a segunda. (Uma auditoria de 2026-07-19 relatou a primeira forma como sem leitor; o formato se lê no arquivo, mas o uso pelo planner exigiria `EXPLAIN` contra dado real e não foi medido.)
- **`features.layer_id` é UUID puro, SEM FK, e a ausência é load-bearing.** `002_atlas.sql` declara só `layer_id UUID,` enquanto as irmãs do mesmo arquivo declaram `REFERENCES` (`groups.parent_id`, `group_features.group_id`). A ausência parece esquecimento e não é: pela mesma razão do bullet acima, uma feição pode citar camada cujo create ainda não chegou ou foi eliminado pela compactação da fila, e uma FK ali transformaria isso em `23503`, que hoje descarta a feição em silêncio (e, antes de 2026-07-25, travava a fila daquele cliente para sempre). **Integridade referencial não é imponível num log de aplicação por ordem de chegada.** Registre isto antes de "consertar": acrescentar a FK que falta parece higiene de schema e é regressão de sync. O porquê também vive no ponto de uso, em `002_atlas.sql`.
- **Slides quebram sozinhos**: `trg_mark_slides_broken` marca `is_broken` quando o mapa referenciado é soft-deletado.
- **`temporal_config` é por mapa**, não por atlas. Ver [[modulo-temporal]].
- **`schemaVersion` do cliente é `ATLAS_SCHEMA_VERSION` (`frontend/src/js/store/atlas/atlas.entity.js`), e desde 2026-08-15 ele é POR SLOT**, não da instalação: cada conjunto de bancos carrega a sua, e a migração recebe o escopo como argumento ([[namespace-por-atlas]]). O valor não se copia para cá porque ele sobe a cada migração nova, e a constante é o único lugar que não envelhece. O contrato congelado é o outro: migrações são forward-only e aditivas, e atualizar o app nunca pode tornar inacessível um atlas já no IndexedDB.

Conflito é LWW por ordem de chegada ao servidor, não por timestamp: [[modelo-conflito-lww]]. Para depurar convergência ponta a ponta, [[syncledger]].
