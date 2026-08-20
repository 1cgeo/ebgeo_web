# Síntese: o que é REST e o que trafega por sync

Por que a fronteira de escrita foi cortada entre contêiner (REST) e conteúdo (sync), quais exceções existem e o que quebra silenciosamente ao atravessá-la na direção errada.

## A regra e o motivo

O **contêiner** é REST. O **conteúdo** é sync. Só o atlas tem CRUD REST completo ([[api-rest-atlas]]); mapas e briefings expõem leitura mais **uma** escrita estrutural (`merge`), a exceção descrita abaixo; feature, layer e group não têm rota nenhuma, só aparecem no dispatch de `applyOperation`.

Sync existe para mudanças de granularidade fina, frequentes e concorrentes, cujo mérito é convergir por [[modelo-conflito-lww]] (LWW por ordem de chegada). Mover um vértice 30 vezes por segundo não cabe num `PUT`.

REST existe para mudanças raras, estruturais e não concorrentes, onde "última escrita vence por entidade" seria perigoso: quem vê o atlas, quais basemaps ele expõe, quem é o dono. Uma op de sync com granularidade "atlas inteiro" reabriria a porta para um usuário `write` sobrescrever a lista de compartilhamentos.

**A separação é o gate, não a estética.** A rota de push de sync exige no mínimo `comment` (`backend/src/modules/sync/sync.routes.js`), de propósito, para o Comentarista alcançá-la; o refinamento por op vem depois, em `assertOperationAllowed` (`backend/src/modules/sync/sync.service.js`) e em `operationDenialReason` ao lado dela. As rotas de sharing e settings exigem `manage`. Um usuário `write` nunca alcança a superfície de governança. Veja [[permissoes-atlas]], [[sintese-eixos-de-permissao]] e [[sintese-capacidades-por-papel]]; detalhes por entidade em [[tipos-entidade-sync]], [[envelope-operacao]] e [[tabela-operations]].

## A armadilha central: `atlas.settings` tem dois donos

A mesma coluna é escrita pelos dois caminhos, particionada por chave. O `PATCH /atlas/:id/settings` (`manage`) escreve *disponibilidade de recurso* ([[atlas-settings]]); a op de sync `setting` (`write`) escreve apenas uma **whitelist de preferências de app**, no ramo `setting` de `applyOperation` (`backend/src/modules/sync/sync.service.js`).

A whitelist não é cosmética, é a defesa: sem ela um usuário `write` reescreveria por sync quais camadas o atlas expõe, contornando o gate `manage`. Ao adicionar uma chave nova a `settings`, **decida a qual lado ela pertence antes da primeira linha de código**, e nunca a inclua na whitelist do sync se ela controlar acesso a recurso.

**`mapOrder` é a chave que ficou dos dois lados**, e é o custo de não ter feito essa decisão. A whitelist aceita `patch.mapOrder` para dentro de `atlas.settings`, alimentada com um array de **nomes** de mapa (`frontend/src/js/store/map.operations.js`); a coluna `atlas.map_order` é `UUID[]` (`backend/src/database/migrations/003_atlas.sql`) e só REST escreve nela (clone, duplicate e import, em `backend/src/modules/atlas/atlas.service.js`). Nada reconcilia as duas: reordenar por sync nunca toca a coluna, duplicar um mapa (que faz `array_append` nela) nunca toca o settings.

O que torna isso difícil de depurar é que **as duas viajam no MESMO snapshot**, como `atlas.settings.mapOrder` e como `atlas.mapOrder`, e só a primeira tem leitor: o cliente persiste a lista de nomes, enquanto o `mapOrder` de UUIDs que o resolvedor consome (`frontend/src/js/store/services/map-resolver.service.js`) vem do atlas LOCAL, nunca do snapshot. Ao ler ou escrever `mapOrder` em qualquer lado da fronteira, confirme primeiro de qual dos dois se trata; o nome não distingue e o tipo do array é a única pista.

Duas consequências que economizam depuração:

- As chaves de `SETTING_OBJECT_KEYS` sofrem merge de um nível (`COALESCE(settings->key,'{}') || incoming`) justamente para que gravações concorrentes por mapa não se derrubem. As demais são substituídas inteiras. Adicionar uma chave objeto sem incluí-la nessa lista causa perda de dados silenciosa entre mapas.
- `logAtlasSetting` (`frontend/src/js/store/sync/operation-dispatcher.js`) usa o UUID do atlas quando resolve, e o sentinela literal `'atlas'` quando não. Funciona porque o backend escopa pelo atlas da **rota** e ignora o `entityId`. Um `entityId` que não seja UUID nem `'atlas'` é descartado antes do flush, porque **uma única op inválida faz o Postgres estourar `22P02` e derruba o lote inteiro**, travando todo o sync.

## A exceção: escritas REST estruturais são invisíveis ao pull incremental

`duplicate`, `merge`, `clone` e `import` ([[clone-atlas]], [[atlas-import-offline]]) escrevem entidades filhas apesar da regra, porque são atômicas e estruturais (a mesclagem seria centenas de ops `update` sem atomicidade). O preço é real:

> Elas não passam pela tabela `operations` e não incrementam `current_version`. Um peer em pull incremental **nunca verá** essas mudanças.

**`merge` deixou de ser assim, e é o desenho a copiar.** Desde `1d23ac9` (2026-07-19) ele grava uma op MARCADORA `map_merge` na mesma transação (`backend/src/modules/maps/maps.service.js`), então avança `current_version` e aparece no replay; quem a recebe resolve tomando snapshot (`STRUCTURAL_RESYNC_OPS`, `frontend/src/js/store/sync/sync-engine.js`). O motivo de fazer isso, e não confiar no frame: sem op escrita, o peer que reconecta pede a cauda a partir de um `current_version` que não mudou e recebe lista vazia, ou seja, conclui que está em dia. Silêncio indistinguível de "nada mudou". As outras três continuam dependendo só do frame.

A compensação é um **frame de notificação**, não uma op. O cliente colapsa `atlas_updated`, `map_duplicated` e `maps_merged` num único sinal `serverResync` (`frontend/src/js/store/sync/ws-client.js`), que dispara `syncEngine.resync()`, ou seja, um pull forçado de **snapshot completo** ([[snapshot-e-pull-incremental]]). O comentário no próprio `ws-client.js` registra que antes esses frames caíam no `default` e a mudança sumia sem erro.

Portanto: **toda rota REST nova que escreva entidades filhas obriga um broadcast que o cliente mapeie para `serverResync`.** Sem isso a mudança é invisível ao vivo e invisível no pull. Quem estiver offline no momento só converge ao receber um snapshot. A distinção op versus frame está em [[sintese-rest-vs-websocket]] e [[canal-collab-websocket]].

## Imagens: o único objeto que atravessa as duas superfícies

O **blob** sobe por REST multipart; a **referência** viaja dentro da op de feature ([[imagens-atlas]]). Ordem obrigatória: **suba o blob primeiro, só então grave a feição**, senão o peer resolve o id antes do upload terminar e recebe 404.

`uploadImageBlob` é best-effort e retorna `null` em qualquer falha (`frontend/src/js/store/sync/image-sync.js`), e o chamador cai para um id local. O resultado não é um erro visível: a feição fica com **uma imagem que nenhum peer consegue ver**. O clone de atlas herda o modelo, copia referências e não duplica arquivos.

## Pegadinhas do gate

- **`manage` está acima de `write`.** Um gate escrito como `permission === 'write' || permission === 'owner'` exclui o co-Gestor em silêncio.
- **`owner` nunca vem de `atlas_shares`.** É sintetizado de `atlas.owner_id`, e o CHECK da tabela não aceita `owner` como nível concedível (`backend/src/database/migrations/003_atlas.sql`; o enum do Joi espelha isso em `backend/src/modules/sharing/sharing.schemas.js`). A posse só muda pela rota de transferência. **Nunca ancore contrato de schema em comentário de código**: a versão anterior desta linha citava um comentário de rota que a própria wiki registra como mentiroso.
- **Deletar mapa é `manage` para cima; travar mapa é `owner` estrito**, embora sejam ops de sync, não REST (`operationDenialReason`, `backend/src/modules/sync/sync.service.js`). É fácil supor que toda op de sync aceite `write`, e igualmente fácil supor que as duas andem juntas: o lock é override de coordenação, o delete é ação de gestão.
- **`GET /atlas/:id/sharing` responde camelCase; `POST /sharing/users` responde o registro cru da tabela em snake_case.** Explicação e ancoragem em [[compartilhamento-atlas]].
- Erros das duas superfícies compartilham o envelope `{ error: { code, message } }`, veja [[erros-api]] e [[comentario-espacial]].

## Contadores e código morto que enganam

- **`atlas.version` e `current_version` são contadores diferentes.** As escritas REST incrementam `version` (versionamento otimista do atlas) e nunca tocam `current_version`, que é a ordem de chegada usada pelo sync. Confundi-los quebra o pull ([[fila-operacoes-outbound]]).
- **`deleteAtlas` é soft-delete sem cascade.** Mapas, features e briefings permanecem no banco, por isso existem lixeira e restore, e por isso o restore é checado dentro do serviço: `requireAtlasPermission` só enxerga atlas vivos.
- **O snapshot filtra comentários por papel** (`read` não os recebe), tanto no incremental quanto no snapshot. Um viewer que "não vê comentários" pode não ser bug de UI.
- **O acesso público usa um JWT temporário de 1h read-only** que serve tanto para REST quanto para o WebSocket, veja [[link-publico]] e [[autenticacao-jwt]].

## Checklist ao adicionar uma escrita nova

1. É configuração do contêiner ou dado do conteúdo? Contêiner vai para REST, conteúdo vira op.
2. Se virou op, ela existe em `EntityType` (frontend) **e** no dispatch de `applyOperation` (backend)? Um tipo desconhecido cai no `default` de `frontend/src/js/store/sync/remote-operation-handler.js` com apenas um `console.warn`, e a op se perde sem erro.
3. Se foi para REST e altera dados que o peer renderiza, você emitiu broadcast e o `frontend/src/js/store/sync/ws-client.js` mapeia esse `type`?
4. Se toca `atlas.settings`, a chave é de disponibilidade de recurso (fora da whitelist) ou preferência de app (dentro)?
5. O gate corresponde à superfície? `manage` para governança e delete de mapa, `write` para conteúdo, `owner` para posse e lock de mapa.

## Ver também

[[atlas-modelo-de-dados]] · [[aplicacao-operacoes-remotas]] · [[compartilhamento-atlas]] · [[dominio-local-vs-remoto]] · [[sintese-modulos-fora-do-sync]] · [[sintese-limites-collab]] · [[sync-admin-operacoes]] · [[formato-ebgeo-roundtrip]]
