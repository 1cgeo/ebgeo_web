# Conflitos de todas as entidades e resolução persistente

Status: pendente; os passos 1 e 2 (túmulos e a revisão por entidade, no SERVIDOR e no CLIENTE) fecharam em 2026-09-13, e o que ficou está listado abaixo. Prioridade: bloqueia lançamento. Depende de [persistência](02-persistencia.md) e [compatibilidade](01-compatibilidade.md).

## Lacuna

O tratamento de base/revisão nasceu só para feições v2 em `backend/src/modules/sync/feature-conflicts.js`. Nenhuma das duas metades é mais a que falta: a moldura de base e unidade de disputa virou genérica por entidade em `backend/src/modules/sync/entity-conflicts.js`, e o cliente passou a declarar base e unidades em `frontend/src/js/store/sync/mutation-contract.js`. O que resta é a interface que permita ao usuário resolver um conflito de forma persistente (a fila já tem resultados duráveis, classe por problema e consulta em `frontend/src/js/store/sync/operation-queue.js`) e o conteúdo do recibo.

Revisar também `backend/src/modules/sync/sync.service.js`, `backend/src/modules/sync/sync-receipts.js`, `frontend/src/js/store/sync/remote-operation-handler.js` e `frontend/src/js/store/sync/legacy-queue.js`.

### O que FECHOU em 2026-09-13 (passo 1 do bloco B5)

Os quatro buracos de túmulo, que eram a metade do F8 capaz de apagar ou ressuscitar dado no servidor por gesto comum. Dois commits, os dois só de backend:

1. **A forma array de `catalog_layer`** fazia `deleted_at = NULL` sem cláusula nenhuma no `DO UPDATE`, então uma op ressuscitava toda camada de catálogo apagada cujo id ela nomeasse, com a definição velha do remetente, e o cliente recebia ack de sucesso. O ramo de conflito passou a ter a política de UPDATE que a forma por camada já praticava (`WHERE catalog_layers.deleted_at IS NULL`, sem `deleted_at = NULL`). Guarda: `backend/tests/integration/catalogo-array-nao-ressuscita.repro.test.js`.
2. **`map`, `cesium3d` e `streetview360` recusam update sobre linha excluída**, com motivo, pelo canal de conflito e com o mesmo vocabulário da feição (`RAZAO_EXCLUIDO_NO_SERVIDOR` e irmãs, exportadas de `feature-conflicts.js`). Quem recusa é `tombstoneConflict`, que lê a linha sob a trava de escrita do atlas antes do insert no log; `buildUpdateQuery` ganhou `deleted_at IS NULL` como segunda linha. O create sobre linha existente de 3D e 360 também virou recusa nomeada, no lugar da frase genérica de integridade. Guarda: `backend/tests/integration/update-sobre-tumulo-recusado.repro.test.js`.

Medido revertendo a guarda: um mapa excluído e renomeado por op antiga voltava com o nome novo e `version` 2 para 3, com o túmulo intacto e ack `applied`; a linha 3D idem. Ou seja, a escrita caía e ninguém era avisado.

Duas decisões que a implementação teve de tomar e que quem continuar precisa conhecer:

- **O create de `map` sobre túmulo continua RESSUSCITANDO, de propósito.** É o caminho do desfazer: o Ctrl+Z de uma exclusão reenvia um create com o mesmo id, e `layer`, `group`, `map`, `briefing` e `slide` compartilham esse contrato, cada um asserido em `backend/tests/integration/sync-service-coverage.test.js`. Só 3D e 360 entram na recusa de create, porque eles nunca tiveram esse contrato (o create deles era `ON CONFLICT (id) DO NOTHING`), então nomear a recusa ali não tira capacidade nenhuma.
- **Linha que NÃO EXISTE continua sendo acked como aplicada** num update. Distinguir "nunca existiu" de "existiu e foi-se" exige a revisão durável por entidade do passo 2: o log de operações é expurgável, então ausência não prova nada, e recusar por ausência hoje transformaria todo par create/update fora de ordem numa recusa permanente. O comportamento de hoje está medido no último caso daquele arquivo, para que uma mudança futura apareça.

### O que FECHOU em 2026-09-13 (passo 2 do bloco B5), recorte SÓ SERVIDOR

A base observada e a revisão por entidade, em dois commits, os dois só de backend:

1. **`95100dec`, a preparação de mutação por base e campo virou genérica por entidade.** O gate literal `rawOp.protocolVersion === 2 && op.target === 'feature'` passou a ser "op v2 COM base declarada, para qualquer alvo da tabela de unidades", mais "feição sempre". A moldura é `backend/src/modules/sync/entity-conflicts.js`: ler a linha corrente sob a trava de escrita do atlas, resolver a base (`baseVersion`, ou o recibo de `baseOperationId`), ler a fronteira por unidade em `sync_entity_fields` com o `entity_type` REAL, recusar NOMEANDO as unidades disputadas, gravar a fronteira nova. `feature-conflicts.js` ficou só com o que é de feição e re-exporta as frases `RAZAO_*`. Guarda: `backend/tests/integration/revisao-por-entidade.repro.test.js`, 20 casos.
2. **`1a40df4f`, túmulo recusa update também em grupo, camada, briefing e slide.** Os quatro entraram em `TOMBSTONE_GUARDED_TARGETS` (agora sete) e os quatro statements ganharam `deleted_at IS NULL`. Guarda: `backend/tests/integration/update-sobre-tumulo-recusado.repro.test.js`, que foi de 11 para 16 casos.

Medido revertendo cada metade: sem a moldura, 14 dos 20 casos do repro novo ficam vermelhos (os 6 que sobram são os três estruturais, os dois contrastes de op sem base, e o túmulo de mapa, que o passo 1 já cobria); sem `layer` no conjunto de túmulo, uma camada excluída e renomeada por op antiga voltava com o nome novo, `version` 2 para 3, `deleted_at` ainda posto e ack `applied`.

**A unidade de disputa por entidade**, declarada em `DISPUTE_UNITS`: mapa (nome, posição como UMA unidade de cinco colunas, mapa-base, notas, grade, temporal, travado); camada (nome, visível, travado, opacidade, ordem, estilo); grupo (nome, visível, travado, estilo, pai); briefing (nome, descrição, settings, ordem dos slides); slide (título, conteúdo, alvo, câmera, defeito); comentário (texto, resolvido); camada de catálogo, 3D e 360 com o documento inteiro como unidade única. Membresia de grupo não tem unidade: é junção com create e delete idempotentes.

Quatro decisões que a implementação teve de tomar:

- **O gate é "a op declara base", não "o alvo é X".** O cliente de hoje só declara base para feição, então nada muda para ele nesta entrega, e o dia em que ele declarar base para mapa a verificação liga sozinha, sem mudança de servidor. Recusar toda op sem base seria recusar o cliente inteiro; há dois casos de contraste no repro (mapa e comentário) justamente para que essa "conclusão" fique vermelha antes de chegar à produção.
- **Entidade de uma unidade só não guarda linha de fronteira.** Com uma unidade, "alguma unidade passou da sua base" é aritmeticamente igual a "a versão da linha passou da sua base", então a linha seria uma segunda cópia de `version`. Isso também resolve `catalog_layer`, cujo id é TEXT enquanto `sync_entity_fields.entity_id` é UUID (`backend/src/database/migrations/004_sync.sql`). Nenhuma migração foi necessária: a tabela já era genérica, e o que faltava era usar a coluna `entity_type` em vez do literal.
- **Com base declarada, a escrita é ESTREITADA às unidades que a op declara.** Sem isso a tabela de unidades seria mentira em dois pontos: o update de `comment` grava `data` inteiro (um `{status:'resolved'}` que jura não tocar o texto apagaria o texto) e o de `slide` atribui `map_id` sempre, via `resolveSlideMapId`. As duas leem `op._unitScope`, que só existe em op com base declarada.
- **Ordem de SLIDE não é unidade de slide.** Ela é `briefings.slide_order`, então uma reordenação disputa com outra reordenação sob a unidade do briefing. O esboço do plano pedia "conteúdo, ordem" para slide; a coluna não existe ali.

### O que FECHOU em 2026-09-13 (passo 2 do bloco B5), recorte SÓ CLIENTE

Três commits, os três só de frontend, e é a metade que LIGA o que o servidor passou a saber verificar: o gate dele é "a op declara base", então a declaração é o interruptor.

1. **A revisão confirmada passou a existir em toda entidade colaborativa.** `frontend/src/js/store/sync/confirmed-version.js` é uma folha de zero imports com o nome único do fato, o MESMO que a feição já usava (`confirmedVersion`). O servidor carimba esse campo apenas na feição, e não pode passar a carimbá-lo nas outras sem mudança de backend; o que ele manda para todas é a coluna `version` em cada linha do snapshot e o `entityVersion` em cada recibo. O snapshot passou a carimbar mapa, camada, grupo, comentário, briefing, slide, camada de catálogo, 3D e 360; os ramos de aplicação que SUBSTITUEM o documento carimbam quando o payload se data; e os dois que MESCLAM payload parcial (`mergeRemoteMapUpdate` e o update de camada) passaram a ESQUECER a revisão, porque uma base velha perde para uma mudança que aquele par acabou de aplicar, e uma base ausente é o estado seguro. O recibo ganhou escritor próprio, `confirmEntityVersion` (`frontend/src/js/store/sync/remote-operation-handler.js`), que escreve UM campo no documento endereçado: sem ele a SEGUNDA edição seguida da mesma entidade declararia a revisão lida do snapshot e perderia uma disputa contra o próprio autor. Guardas: `frontend/tests/integration/recovery-remote-operation-handler.test.js` (18 casos) e `frontend/tests/integration/layer-write-ahead.test.js`.
2. **Toda op de atualização declara a base observada e o patch por unidade.** `frontend/src/js/store/sync/dispute-units.js` é o espelho de `DISPUTE_UNITS`, nos nomes de campo que o cliente envia, com os apelidos que os normalizadores do servidor resolvem; é chaveado por TIPO DE ENTIDADE, e não por alvo, porque seis tipos caem em `map` e cada sub-tipo só pode tocar a unidade dele. `frontend/src/js/store/sync/mutation-contract.js` monta a declaração, e `createOperation`/`createBatchOperations` a aplicam a todo tipo colaborativo. Guardas: `frontend/tests/unit/unidades-de-disputa-espelham-backend.test.js`, que importa as DUAS tabelas no mesmo processo, e `frontend/tests/unit/contrato-de-mutacao.test.js`.
3. **Conflito virou classe própria de problema durável.** `frontend/src/js/store/sync/issue-classes.js` separa `conflito`, `recusa` e `revisao`, e `getIssues` devolve a classe de cada registro. A dependência bloqueada é a quarta classe e NÃO se grava: ela é derivada a cada leitura por `getProblems`, com a mesma regra que o carregador da fila usa, porque a causa dela some sozinha quando a operação da frente é resolvida. O conflito já vinha pelo canal da recusa, então a op já ficava na fila bloqueando os dependentes; o que faltava era distinguir os três desfechos, que pedem coisas diferentes de quem os lê.

Medido revertendo cada metade: neutralizando o carimbo, 4 casos do repro de recuperação ficam vermelhos; neutralizando só o esquecimento, 1 (o da mescla parcial, que é o que separa base ausente de base velha); desligando o contrato na fábrica, 4 casos de write-ahead; renomeando uma unidade do espelho do cliente, 2 casos do espelho; achatando a classe de conflito, 3 casos.

**O que o cliente declara e o que o servidor de fato lê são coisas diferentes, e a diferença é declarada.** O servidor deriva as unidades das COLUNAS que o payload declara (`declaredUpdateColumns`), não do `patch`, que só é aplicado no caminho de feição. Payload de documento inteiro (uma camada, um grupo) reivindica todas as unidades que carrega, e esse é o veredito honesto, porque uma escrita larga a partir de base velha realmente sobrescreveria todas; onde o cliente já manda payload estreito (renomear mapa, travar, os cinco sub-tipos) a precisão é a da tabela.

### O que segue PENDENTE

- **`map` e seus cinco sub-tipos continuam SEM declarar base**, e é o único buraco do lado do cliente. A declaração é lida de `previousData`, e os sítios de escrita do mapa registram o campo mudado (`{name: oldName}`, `{locked: false}`), nunca o documento; ler o documento ali custaria a leitura do mapa inteiro, feições incluídas, numa operação que hoje não lê nada. A saída barata é o recibo canônico de mapa do passo 3: com ele o sítio de escrita carrega o número que já aprendeu, sem leitura nova.
- **Conteúdo do recibo** (passo 3): operação canônica por entidade. Hoje o conflito de entidade que não é feição devolve `serverData: null` e o ack traz `entityVersion` sem `canonicalOperation`, porque publicar um canônico sem serializador seria devolver o documento do remetente com aparência de aval do servidor. É esse serializador que fecha o item acima e que dá ao painel o "estado atual permitido".
- **O servidor lendo o `patch`** em vez de derivar as unidades do payload, que é o que daria precisão de unidade também às entidades cujo cliente envia documento inteiro. Alternativa: estreitar o payload no cliente, que só é seguro depois que cada entidade tiver canônico, senão o par que recebe a transmissão perde os campos ausentes no blind-replace.
- **Painel de resolução** (passo 5), inteiro.
- **A forma array de `catalog_layer`** continua escrevendo a linha VIVA com o que carrega: ela não endereça uma linha só, então não é verificável por base. O replay literal é barrado pelo recibo; o fora de ordem, não. Nenhum cliente vivo a emite.
- **Linha que NÃO EXISTE continua sendo acked como aplicada** num update. Vale a mesma razão do passo 1, agora com a revisão no ar: o log é expurgável, então ausência não prova exclusão, e a fronteira durável só existe para linha que já foi escrita pelo sync.

## Correção

1. Definir a unidade de disputa por entidade: campos independentes, geometria inteira, ordem, hierarquia, membros, slides e referências. Não fundir arrays genericamente.
2. Expandir revisões, bases observadas e tombstones para mapas, camadas, grupos, comentários, slides, catálogo, 3D/360 e configurações compartilhadas. Incluir aliases de metadados aceitos pelo backend. Autorização e detecção de conflito não podem depender da retenção do log de replay.
3. Distinguir aplicado, recusado, conflito e dependência bloqueada. Uma exclusão confirmada não pode ser revertida por edição antiga. Conservar o conteúdo da tentativa e sua identidade.
4. Entregar painel com item, motivo e dependentes, conteúdo local e estado atual permitido. Aceitar servidor remove a tentativa por decisão explícita; reaplicar uma escolha cria nova operação, com nova base observada. Conciliação de geometria requer comparação visual.
5. Incluir filas antigas sem recibo inequívoco. F5, outra aba ou fechamento do toast não podem apagar a pendência. Acesso revogado impede buscar ou mostrar novos dados do servidor.

## Aceite

Dois e três clientes editando campos distintos, o mesmo campo, geometria, ordem e membros; edição versus exclusão; nova edição remota durante resolução; permissão revogada. Repetir após F5 e entre abas. Comparar servidor, fila e projeção. Nenhuma sobrescrita silenciosa e nenhum retry reaproveitando ID com conteúdo diferente. Remover temporariamente o guarda deve tornar a regressão vermelha. Pendências só desaparecem por confirmação comprovada ou decisão autorizada.
