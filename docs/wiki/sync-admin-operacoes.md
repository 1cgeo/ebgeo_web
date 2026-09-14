# Administração do Log de Operações de Sync

Duas rotas admin por atlas (`backend/src/modules/sync/sync.routes.js`) podam a tabela `operations` e elevam `min_version`, trocando histórico de replay por espaço em disco.

## Por que existe e o que custa

A tabela `operations` ([[tabela-operations]]) cresce indefinidamente: todo push de [[envelope-operacao]] vira uma linha durável, e é dela que sai o pull incremental de [[snapshot-e-pull-incremental]]. Sem poda, o histórico de um atlas antigo vira o maior objeto do banco.

**Cleanup é irreversível e desloca custo, não o elimina.** O que some do disco reaparece como banda: todo cliente cujo `sinceVersion` cair abaixo do novo `min_version` passa a receber snapshot completo em vez de replay. Não é otimização gratuita, é uma troca deliberada.

## Armadilhas

**1. O gate é papel global, não papel no atlas.** `requireAdmin` (`backend/src/middleware/require-admin.js`) só olha `req.user.role`; as rotas admin de sync são as únicas do router de atlas gateadas por papel **global**. Não são as únicas sem `requireAtlasPermission`: `POST /:atlasId/restore` (`backend/src/modules/atlas/atlas.routes.js`) também não o usa, e por outro motivo, explicado no comentário ao lado, o middleware só enxerga atlas vivo e o restore trabalha sobre um soft-deleted, então a conferência de dono acontece dentro do serviço. Consequência: o dono de um atlas que não seja admin da plataforma **não** limpa o próprio log, e um admin global limpa qualquer atlas sem ser membro dele. É um eixo de permissão à parte de [[permissoes-atlas]]; ver [[sintese-eixos-de-permissao]].

**2. A ordem das rotas é load-bearing.** `/admin/stats` e `/admin/cleanup` precisam vir antes de `GET /:version`. Se `/:version` capturasse `admin`, o `parseInt` do controller daria `sinceVersion = 0` e um GET malformado devolveria o snapshot inteiro do atlas em vez de 404. Mover essas linhas para baixo abre um vazamento silencioso.

**3. `keepFromVersion` tem precedência e não tem clamp.** Enviar os dois campos faz `keepDays` ser ignorado no primeiro ramo de `cleanupOldOperations` (`backend/src/modules/sync/sync.service.js`), e nada impede um valor acima da `currentVersion`: o log é esvaziado e `min_version` fica **acima** da versão corrente, condenando todo cliente a snapshot em cada pull até que novas operações elevem `current_version`. Consulte `/admin/stats` antes e escolha entre `oldestOperationVersion` e `currentVersion`.

## O recibo sai junto, e a fronteira é a mesma

Desde 14/09/2026 o expurgo também poda `sync_receipts` (decisão D10 em [`../decisions/decisions-2026.md`](../decisions/decisions-2026.md)). Antes disso nada podava aquela tabela: só o `ON DELETE CASCADE` do atlas, ou seja, ela encolhia quando o atlas inteiro morria e em mais nenhuma ocasião. O relatório da rota passou a trazer `deletedReceipts` ao lado de `deletedCount`, e `/admin/stats` passou a trazer `totalReceipts`, porque tabela que nenhuma medição mostra é tabela que ninguém poda.

**A fronteira é `min_version`, nunca um prazo próprio, e a igualdade é o desenho inteiro.** Um reenvio bate primeiro no recibo (`findReceipt`) e, na falta dele, no `ON CONFLICT (atlas_id, op_id)` do próprio log. Acima da fronteira a linha de `operations` continua lá, então a idempotência sobreviveria à saída do recibo; abaixo dela as duas saem na mesma transação, de propósito, e o cliente que estiver naquela faixa já recebe snapshot em vez de replay. Cortar recibo por data cortaria os dois lados em fronteiras diferentes, que é a alternativa recusada na decisão.

**Três coisas que não se adivinham lendo a poda:**

- **O recibo de uma RECUSA fica**, e o recorte o poupa por `server_version IS NOT NULL`. A recusa nasce com versão nula e **não tem linha em `operations` nenhuma**: o recibo é o único registro daquele desfecho, e não carrega versão com que se comparar contra a fronteira. A contrapartida honesta é que essa família não é podada por este caminho.
- **O recibo tem um SEGUNDO emprego**, e é ele que o expurgo custa: `resolveObservedBase` (`backend/src/modules/sync/entity-conflicts.js`) resolve `baseOperationId` lendo o recibo da op predecessora. Uma edição encadeada a uma op abaixo da fronteira passa a ser recusada por base não confirmada. Não é silencioso (volta como conflito, com motivo próprio) e é coerente com o resto: aquele cliente já recebe snapshot, então a base dele não descreve mais o servidor.
- **"Sem recibo a op reaplica" é falso para a feição**, e a suposição contrária foi medida e desmentida ao escrever o guarda. A feição tem outras duas redes: a própria linha da entidade recusa o `create` repetido, e o `update` de feição exige base declarada. O que a perda do recibo produz ali é uma **recusa no lugar de um `already_applied`**, isto é, a pessoa é chamada a resolver um conflito por uma edição que já tinha sido entregue.

Guarda: `backend/tests/integration/expurgo-de-recibos-por-min-version.test.js`.

## Contratos de fronteira

- O delete é `server_version < corte` e o `min_version` recebe exatamente esse mesmo valor (`backend/src/modules/sync/sync.queries.js`). Logo `min_version` é a versão da operação mais antiga **sobrevivente**, não a última apagada.
- Um cliente exatamente em `sinceVersion === minVersion` **ainda recebe incremental**, porque o teste em `pullOperations` (`backend/src/modules/sync/sync.service.js`) é `sinceVersion < minVersion`. Trocar por `<=` transformaria o caso de borda mais comum (cliente em dia com o corte) em snapshot.
- Caminho por dias é auto-limitado: se nenhuma operação for mais nova que o cutoff, `cleanupOldOperations` retorna zerado **sem tocar em `min_version`**. É isso que impede um atlas parado há meses de ser zerado por engano; o caminho por versão não tem essa rede.

## Efeito que atravessa módulos

O cleanup não afeta só o pull REST. `sync_request` no [[canal-collab-websocket]] chama o mesmo `pullOperations` a partir de `handleSyncRequest` (`backend/src/modules/collab/collab.handlers.js`), então um corte agressivo transforma **reconexões por queda de rede** em downloads de snapshot inteiro. O cliente aplica isso via `applyRemoteSnapshot` ([[aplicacao-operacoes-remotas]]), que substitui estado local, e não via merge incremental de [[modelo-conflito-lww]].

Operações locais ainda na [[fila-operacoes-outbound]] não se perdem: sobem depois e recebem versões novas. A garantia de não duplicar continua sendo a de [[idempotencia-e-convergence-guard]], que não depende do histórico podado.

## Operação recomendada

- Prefira `keepDays` (7 a 30) a `keepFromVersion`, pelo motivo do terceiro item de *Contratos de fronteira*.
- Dimensione `keepDays` pela maior janela offline plausível do time. Abaixo dela, todo retorno de campo vira snapshot.
- Rode `/admin/stats` antes e depois. `currentVersion - oldestOperationVersion` é a janela de replay que ainda existe; `oldestOperationVersion - minVersion` mede histórico abaixo do corte, e `totalReceipts` diz o tamanho da outra tabela que a poda alcança.
- Não há agendador embutido: cron externo ([[deploy-backend]]).

## Superfície de UI: nenhuma

Nada em `frontend/src/` referencia `sync/admin/stats` ou `sync/admin/cleanup`, inclusive em `frontend/src/js/store/sync/api-client.js`. Poda de log é HTTP direto ou ferramenta externa, e essa é a superfície que existe; para o que de fato mora no painel, ver [[gestao-usuarios]] e [[auditoria]].

## Histórico

- 2026-09-14: a poda passou a alcançar `sync_receipts` (decisão D10). Três testes de integração prendiam a propriedade OPOSTA, com o nome no título ("cleanup preserves deduplication", "even after replay cleanup", e o restore explícito com o corte no meio): a permanência dos recibos não era esquecimento, era contrato, e o achado que a encontrou tinha olhado só quem escreve a tabela. Os três foram atualizados com a supersessão datada escrita dentro deles, e o que passou a ser cobrado no lugar está na seção acima.
- 2026-08-23: as *Armadilhas* traziam um item dizendo que `keepFromVersion: 0` era silenciosamente ignorado por ser falsy no ternário do controller. O ternário foi trocado por um teste explícito de `undefined`/`null` em `cleanupOperations` (`backend/src/modules/sync/sync.controller.js`), que hoje registra o defeito antigo no comentário: um corte 0 significava "não apague nada" e disparava um expurgo de sete dias, com 200 e sem sinal.
