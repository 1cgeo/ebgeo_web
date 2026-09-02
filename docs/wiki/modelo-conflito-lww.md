# Resolução de Conflitos: LWW por Ordem de Chegada

O servidor ordena por `serverVersion` (ordem de chegada ao Postgres), nunca por timestamp de parede nem pelo relógio Lamport, com granularidade de feição inteira e idempotência por `op_id`.

## Os três campos-isca

O [[envelope-operacao]] carrega `timestamp`, `lamportTimestamp` e `clientId`. Nenhum decide conflito, e essa é a armadilha central da página: os três parecem ordenáveis e não são. `timestamp` é relógio de parede de máquinas diferentes; `lamport_timestamp` é gravado e ecoado mas nunca lido na decisão (a própria migração `backend/src/database/migrations/004_sync.sql` avisa); `clientId` serve a dedupe de eco e presença, ver [[client-id-estavel]]. O invariante I3 do [[syncledger]] falha de propósito se alguma ordenação derivar deles.

`serverVersion` não existe no envelope de saída: só volta no ack, no broadcast e no pull. Ver [[tabela-operations]] e [[ack-idempotencia]].

## Por que não é CRDT

Não há merge comutativo descentralizado: o servidor central define ordem total (*server-authoritative*, à la Figma). A alternativa CRDT chegou a existir como um módulo próprio (resolver/merger por timestamp+clientId) e foi **removida por ser código morto**: o caminho real de escrita nunca leu o timestamp do cliente.

O racional que o código apaga por construção, e a razão de a decisão não se reabrir de graça:

- **Já existe um servidor obrigatório** (auth, atlas, permissões, imagens). Havendo ponto central de qualquer forma, o CRDT cobraria a complexidade de convergir sem coordenação, propriedade que o produto não usa.
- **Offline-first é resolvido por fila, não por merge.** A [[fila-operacoes-outbound]] com compactação e flush gateado por conexão cobre o caso real (desconectar e voltar) sem estrutura de dados especial. Ver [[dominio-local-vs-remoto]].
- **O custo foi aceito de olhos abertos:** conflito na mesma feição **perde trabalho**, o perdedor some e a intenção não é reconstruível. Não é bug. Ver [[sintese-decisoes-arquiteturais]].

**A palavra "CRDT" sobrevive no repositório e engana.** Ela está em nome de rota, em título de migração e em comentário de código (`frontend/src/js/store/sync/sync-engine.js`, `frontend/src/js/store/sync/ws-client.js`, `frontend/src/js/store/sync/sync-metadata.js`, `frontend/src/js/store/map.operations.js`) como nome informal do log de ops. É resíduo, não descrição, e o barrel `frontend/src/js/store/sync/index.js` diz isso explicitamente. Do mesmo lote é `setServerTimeOffset`, que compensaria clock skew para decidir conflito: como o vencedor é por ordem de chegada, não há o que compensar, e nenhum caminho de produção a chama.

## Granularidade: feição inteira, por decisão

O LWW é por **entidade**, não por propriedade. Se A muda a cor e B move a geometria da mesma feição, o perdedor perde a mudança **inteira**, não só o campo em conflito. É aceitável porque feições são pequenas e a edição concorrente na mesma feição é rara, mas é decisão explícita, não acidente.

Consequência de projeto, e a regra que se deve seguir: **se um campo novo precisa sobreviver a edição concorrente, ou ele viaja no mesmo payload, ou vira entidade própria.** Foi assim que resposta de comentário virou entidade separada, ver [[comentario-espacial]]. O merge raso que o backend faz em `update` é merge do payload daquela op, nunca reconciliação entre autores.

## O advisory lock: sem ele, op perdida para sempre

`pushOperations` (`backend/src/modules/sync/sync.service.js`) toma `pg_advisory_xact_lock` por atlas antes do primeiro INSERT. O motivo está comentado no código com o diagrama de interleave; o que importa reter é a consequência: `server_version` vem de `nextval` no INSERT mas só fica visível no COMMIT, então sem o lock uma op pode commitar *depois* de outra com versão maior, e o pull incremental (`WHERE server_version > $lastVersion`) nunca mais a devolve. Perda silenciosa e definitiva.

Por isso `server_version` é simultaneamente o cursor do pull incremental ([[snapshot-e-pull-incremental]]) e a verdade da ordenação LWW. As duas coisas dependem do mesmo lock.

**A espera pelo lock é limitada:** um `SET LOCAL lock_timeout = '5s'` roda imediatamente antes, e o estouro (`55P03`) vira `ServiceUnavailableError`, 503 retentável. Não é refinamento: o lock é tomado com a conexão do pool **já retida**, então espera ilimitada converte contenção num único atlas em esgotamento do pool inteiro, e com `poolMax` default 10 dez pushes concorrentes derrubam junto `/health` e `/auth/login`.

A consequência que só esta página pode dar: **esse 503 é o único erro TRANSITÓRIO do push que vale reoferecer eternamente.** O cliente concorda: `PERMANENT_PUSH_REJECTIONS` no `sync-engine.js` contém só `400` e `422`, e 503 fica deliberadamente de fora, junto de 401, 403 e 429. Não trate recusa permanente e transitória pelo mesmo ramo, e não "resolva" a contenção aumentando o `lock_timeout`: 5 s já é maior que qualquer push saudável.

## Delete vence update (por ausência de filtro)

`buildUpdateQuery` (`backend/src/modules/sync/sync.service.js`) **não** filtra `deleted_at IS NULL` nos ramos de feature/layer/group, mas também não limpa `deleted_at`. Um UPDATE que chega depois de um DELETE altera colunas de uma linha já morta e **não a ressuscita**; o snapshot segue não a devolvendo. O comportamento correto emerge da ausência de uma cláusula: quem "consertar" acrescentando o filtro não muda nada visível, quem acrescentar `deleted_at = NULL` quebra o modelo.

## Create sobre linha viva: inerte no mesmo mapa, MOVER noutro

O `create` é um UPSERT por id (`applyOperation`, `backend/src/modules/sync/sync.service.js`), e o que a cláusula do `DO UPDATE` decide é QUAIS creates em conflito podem escrever. Para todo alvo menos feição ela é só a lápide (a linha viva não se sobrescreve, então um create repetido ou atrasado é acked e não aplicado), e reviver a lápide é o que faz o Ctrl+Z depois de um delete funcionar, porque o desfazer do cliente reenvia a entidade ORIGINAL, com o id original.

**Feição tem um segundo disjunto desde 2026-09-02, e ele é regra de conflito, não exceção:** um create que chega para uma linha VIVA nomeando um mapa DIFERENTE do MESMO atlas é um MOVER, e o último a chegar vence, como em todo o resto desta página. É assim que "mover uma camada inteira para outro mapa" chega ao servidor: o cliente cunha uma camada nova no destino, reemite ali cada create de feição com o MESMO id e apaga a camada de origem, sem emitir delete de feição nenhum (um delete daquele id mataria a linha que acabou de se mudar). Enquanto o disjunto não existia, `map_id` nunca mudava por op: o destino voltava vazio, as feições ficavam na origem e todas as ops voltavam acked como sucesso.

Quatro consequências que a cláusula não entrega sozinha:

- **O replay no MESMO mapa continua inerte.** É a metade antiga do guard, e é o que o disjunto novo não podia custar.
- **Quem barra o mapa de OUTRO atlas não é essa cláusula**, e sim o `INSERT ... SELECT ... WHERE EXISTS` acima dela: sem linha materializada não há conflito a resolver, então o create cross-atlas segue escrevendo zero linhas e a feição não se move.
- **É regra de FEIÇÃO só.** Grupo, camada, 3D e 360 também carregam `map_id` e não mudam de mapa hoje, e a transferência de camada cunha id novo de propósito, porque id de camada não é único entre mapas.
- **A cascata de exclusão de camada não alcança a linha movida**, porque ela mira `layer_id` E `map_id` e o move trocou os dois; pelo mesmo motivo o soft-delete de feição (`buildSoftDeleteQuery`), escopado por `map_id`, vira no-op quando mira a origem. As duas propriedades são o que torna o passo final da transferência seguro.

O custo é o desta página inteira: um create ATRASADO de um cliente que ainda tinha a feição no mapa antigo a traz de volta. A janela é estreitada pela compactação de CREATE+UPDATE da [[fila-operacoes-outbound]], nunca fechada por garantia. Guardas: `backend/tests/integration/sync-feicao-muda-de-mapa.test.js` e `frontend/tests/e2e/layer-transfer.e2e.test.js`.

## Armadilhas

- **O guard é `>=`, não `>`** (`shouldApplyVersion`, `frontend/src/js/store/sync/remote-operation-handler.js`). Versões iguais reaplicam. Só ocorre em replay/snapshot e reaplicar é idempotente no efeito. Não "conserte" para `>` sem entender o replay de ops adiadas.
- **`serverVersion == null` desliga o guard.** Ops sem carimbo (legado, testes sem backend) sempre aplicam. Não confie no guard em cenário sem servidor.
- **`lastAppliedVersion` é memória de processo.** F5 zera. A reconciliação após reload vem do snapshot / pull incremental, não do guard.
- **Tipos fora de `CONVERGENCE_GUARDED` não têm guard nenhum no cliente**: `map`, `slide`, `comment`, `catalogLayer`, `setting` e os subtipos de mapa aplicam na ordem de entrega do pacote WS. A ordem do servidor ainda vale para o estado persistido e o snapshot é o desempate. **Ao adicionar um `entityType` que substitui em bloco, inclua-o no conjunto**: o esquecimento não gera erro, só divergência. Ver [[idempotencia-e-convergence-guard]].
- **O ack é a única fonte da ordem-servidor para o autor.** O autor filtra o próprio eco no WS, logo só aprende sua `serverVersion` pela resposta do push. Descartar essa resposta (como já se fez historicamente) quebra a convergência silenciosamente e só aparece em teste de dois usuários. Comportamento que atravessa `ws-client.js`, `sync-engine.js` e `remote-operation-handler.js`, e não é visível em nenhum deles isoladamente.
- **E o ack precisa carregar a OP, não só o número, porque o adiamento tem DUAS janelas que ele não fecha** (medido em 2026-08-23, decisão registrada). A marca de edição local (`markLocalEditPending`) é posta em `logOperation`, que roda de `tx.deferAsync`, e `StoreTransaction.commit()` dispara esses efeitos sem `await`, depois de uma escrita de IndexedDB: entre a persistência do valor local e a marca há janela, fora do lock do documento. Adiantar a marca não resolve, porque `applyRemoteOperation` lê o contador ANTES de `applyRemoteFeatureOp` tomar aquele lock, então a op do par passa pelo guarda, espera o lock que a edição local segura, e escreve depois dela. Em qualquer das duas, o autor fica exibindo o valor de um par que PERDEU, para sempre, porque o eco dele nunca volta. Por isso `resolveLocalEdit` recebe a op acked e a REAPLICA quando uma op remota de versão estritamente menor foi aplicada àquela entidade (evidência em `lastRemoteAppliedVersion`, mapa separado de `lastAppliedVersion` justamente porque este último também é semeado pelos acks do próprio autor). Repro determinístico: `frontend/tests/integration/convergencia-autor-vencedor.repro.test.js`.
- **E o guarda só decide alguma coisa se checar, escrever e registrar forem UM passo.** `applyRemoteOperation` lê `shouldApplyVersion` e só depois chama um handler que espera o lock do documento, então duas aplicações passam pela checagem e aterrissam na ordem do LOCK, que é a ordem inversa. Para a op que chega pelo socket isso ficava escondido pelo encadeamento de `ws-client.js`, e TRÊS chamadores o contornam: o replay das adiadas, o reparo acima e o replay pós-flush de `reconcilePendingLocalEdits`. `serializeGuardedApply` (`frontend/src/js/store/sync/remote-operation-handler.js`) é a cadeia do caminho guardado que fecha isso. Ela NÃO substitui o lock do documento (aquele ordena o documento, e é por mapa) e não alcança `drainPendingFeatureOps`, que aplica direto e carrega a própria checagem.
- **A compactação da fila quebra a simetria 1-para-1 entre op enfileirada e ack**, e é exatamente por isso que existe `reconcilePendingLocalEdits`. Sem ela, um contador de edição pendente vazado **deferiria para sempre** as ops remotas daquela entidade.
- **Op inválida não derruba mais o lote, e some por dois caminhos independentes.** No servidor, `mapId` ou `entityId` não-UUID gera `22P02`; cada op corre num SAVEPOINT e a violação volta recusada por operação, então o lote sobrevive e é o op ruim que se perde ([[tabela-operations]]). No cliente, um 400/422 do lote inteiro dispara o modo de isolamento que identifica e descarta a ofensora ([[fila-operacoes-outbound]]). Os descartes pré-flush em `frontend/src/js/store/sync/operation-dispatcher.js` continuam necessários pelo motivo mais forte de todos: o mapa local `Principal` é chaveado por nome, e ops nele nunca podem vazar para o servidor. Ver [[dominio-local-vs-remoto]].
- **`atlas_version_seq` é global**, compartilhada por todos os atlas (`backend/src/database/migrations/004_sync.sql`). `server_version` é monotônico dentro de um atlas mas **não contíguo**. Use para ordenar, nunca para contar nem para calcular "quantas ops perdi".
- **Feição antes do mapa:** um `feature/create` pode chegar antes do `map/create` que o contém. O handler bufferiza por `mapId` e reaplica; ops bufferizadas **não** registram a versão, senão uma op legítima posterior seria descartada pelo guard. Descartar em vez de bufferizar seria perda de dado silenciosa no par.
- **Deslogado, a fila continua acumulando** até a purga de 7 dias. O log é ligado incondicionalmente no boot; só o **flush** é gated por conexão, e confundir os dois é erro recorrente. Ver [[sessao-boot-e-ciclo-de-vida]].
- **Ao adicionar campo persistido, cubra os dois caminhos** (`.ebgeo` e sync); a cobertura de sync tem que ser superconjunto do `.ebgeo`. Ver [[atlas-modelo-de-dados]] e [[formato-ebgeo-roundtrip]].
- **Lock só vale para mapa.** O servidor barra escrita apenas em mapa travado, e barra **por operação**, não abortando o lote: `lockedMapDenialReason` devolve motivo e a op volta acked com `rejected: true`. Locks de camada, grupo e feição são *advisory* no cliente e não protegem nada no servidor. Ver [[ack-idempotencia]].

## Contrato congelado

Escrita **incremental** de entidade colaborativa é só por sync: não existe rota REST que altere um pedaço de feature, layer, group, map, briefing, slide, cesium3d ou streetview360. As exceções são estruturais e deliberadas, e são **quatro**: merge de mapas, import de atlas, duplicação de mapa (`POST /:atlasId/maps/:mapId/duplicate`) e clone de atlas (`POST /:atlasId/clone`, `backend/src/modules/atlas/atlas.routes.js`, ver [[clone-atlas]]). Todas são operações de entidade INTEIRA cujo efeito não se expressa como sequência de ops. Ler a regra sem o "incremental" faz parecer que essas rotas são violações, e elas não são; contá-las a menos tem o efeito oposto e igualmente caro, porque a subcontagem vira premissa e a próxima rota estrutural passa a parecer proibida (a constituição declara as quatro e registra o episódio). O gate de papel é aplicado em `assertOperationAllowed` antes do INSERT. Ver [[sintese-rest-vs-sync]] e [[permissoes-atlas]].

Idempotência por `UNIQUE (atlas_id, op_id)` + `ON CONFLICT DO NOTHING`: reenviar a fila inteira após reconexão nunca duplica. Detalhe fácil de errar: ops de nível atlas chegam com o sentinela `'atlas'` como `entityId`, mas a coluna é `UUID NOT NULL`; o servidor grava contra o id do próprio atlas e devolve no ack o `entity_id` **como gravado**, para que o par receba o mesmo `entityId` ao vivo e via pull. Mexer nisso desalinha os dois caminhos de entrega.

`atlas_updated`, `map_duplicated` e `maps_merged` alteram dados **fora** da tabela `operations` e não têm `serverVersion` comparável. O cliente reage a esses sinais com re-pull de snapshot (`serverResync`), nunca com apply de op.

## Histórico

- 2026-09-02: acrescentada a seção "Create sobre linha viva", que descreve o upsert de create pelo lado do servidor. A página descrevia o LWW por chegada e a regra de delete-vence-update, e não dizia nada sobre o que um create faz quando o id já existe; enquanto isso, "o upsert por entityId move a linha" era premissa de quem escrevia cliente, e o e2e de contrato da transferência de camada a refutou.
- 2026-07-25: absorvida a página que existia só para dizer o que a seção "Por que não é CRDT" já dizia. Eram três páginas para um conceito (esta, aquela e [[idempotencia-e-convergence-guard]]) repetindo os mesmos quatro fatos, e foi por esse caminho que a formulação ampla demais de "escrita só via sync" se propagou. `sintese-` é para conhecimento que **cruza** páginas; o porquê de uma decisão pertence à página da decisão.
- 2026-07-25: removido um `[!CONTRADICAO]` que negava a existência do `lock_timeout` de 5 s ("`grep` no backend não retorna nada") e mandava tratar o esgotamento de pool como dívida aberta. **O marcador nunca foi verdadeiro:** a mitigação entrou antes de o marcador ser escrito, no mesmo dia. Enquanto durou, [[sintese-limites-collab]] descrevia a mitigação corretamente e esta página a negava, com a página errada sendo a que carregava o marcador que acorda o gate. Lição: um `grep` que volta vazio prova que a busca falhou, não que o código não existe.

## Relacionados

[[idempotencia-e-convergence-guard]], [[envelope-operacao]], [[fila-operacoes-outbound]], [[aplicacao-operacoes-remotas]], [[snapshot-e-pull-incremental]], [[canal-collab-websocket]], [[presenca-colaborativa]], [[syncledger]], [[tipos-entidade-sync]], [[modos-operacao]], [[atlas-modelo-de-dados]], [[sintese-limites-collab]], [[sintese-decisoes-arquiteturais]], [[sintese-contratos-congelados]].
