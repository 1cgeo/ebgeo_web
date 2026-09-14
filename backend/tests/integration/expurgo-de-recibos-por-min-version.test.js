// Path: tests/integration/expurgo-de-recibos-por-min-version.test.js
//
// A13 / decisao D10 de 14/09/2026. Ate esta data `sync_receipts` NAO TINHA EXPURGO NENHUM: o
// `POST /sync/admin/cleanup` do administrador apagava `operations` e elevava `min_version`, e a
// tabela de recibos so encolhia pelo `ON DELETE CASCADE` da exclusao do atlas inteiro. A decisao
// do dono amarra a poda de recibo a MESMA fronteira da poda de operacoes, e recusa prazo solto.
//
// O QUE ESTE ARQUIVO PRENDE, e cada bloco existe porque o verde do vizinho nao o provaria:
//
//   1. o recibo ABAIXO da fronteira sai, e o relatorio da rota CONTA quantos sairam (um expurgo
//      que apaga sem dizer e indistinguivel de um que nao apagou);
//   2. o recibo NA fronteira e ACIMA dela fica (a comparacao e `<`, a mesma de
//      `DELETE_OLD_OPERATIONS` e a mesma que `pullOperations` usa para decidir snapshot);
//   3. `/admin/stats` publica a contagem de recibos, que e como a poda se dimensiona antes de
//      ser disparada;
//   4. o recibo de uma RECUSA fica, com corte agressivo inclusive, porque ele nasce com
//      `server_version` nulo e nao tem linha em `operations` para substitui-lo;
//   5. reenviar uma op cujo recibo ficou continua respondendo `already_applied`, sem reaplicar;
//   6. CONTROLE NEGATIVO: sem o par recibo + linha de log, o mesmo reenvio deixa de ser
//      reconhecido como repeticao. Sem ele, o bloco 5 passaria identico com um servidor que
//      nunca reconhece nada;
//   7. O CUSTO DECLARADO: `baseOperationId` resolve a base LENDO o recibo da predecessora, entao
//      purgar recibo recusa a edicao encadeada a uma op abaixo da fronteira. O par mede os dois
//      lados, porque so o ramo recusado nao provaria que a cadeia funciona com o recibo la.
//
// DUAS MEDICOES DESTE ARQUIVO CONTRARIAM A INTUICAO com que ele foi comecado, e ficam escritas
// porque as duas mudam o que o expurgo custa. A primeira: "sem recibo a op REAPLICA" e falso para
// a feicao, que tem outras duas redes (a linha da entidade recusa o `create` repetido, e o
// `update` de feicao exige base declarada); o que a perda do recibo produz ali e uma RECUSA no
// lugar de um `already_applied`. A segunda: o recibo nao serve so a idempotencia do reenvio, ele
// e tambem o comprovante que `resolveObservedBase` le para resolver `baseOperationId`.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';
// Pelo SIMBOLO, nunca pela frase copiada: a recusa que este arquivo cobra e exatamente a que o
// servidor emite quando o recibo da predecessora nao esta la, e uma copia da string deixaria o
// caso verde depois de o servidor passar a recusar por outro motivo.
import { RAZAO_BASE_NAO_CONFIRMADA } from '../../src/modules/sync/entity-conflicts.js';

const U = () => `rec_${randomUUID().slice(0, 8)}`;

describe('expurgo de recibos de sync — a fronteira e min_version, nunca um prazo', () => {
  let app, db, user, token, adminToken;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    user = await createUser(db, { username: U() });
    token = await loginUser(app, user.username, user.password);
    const admin = await createAdminUser(db, { username: U() });
    adminToken = await loginUser(app, admin.username, admin.password);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const featureOp = (mapId, nome) => ({
    protocolVersion: 2,
    id: randomUUID(),
    entityType: 'feature',
    operationType: 'create',
    entityId: randomUUID(),
    mapId,
    data: {
      feature_type: 'point',
      geometry: { coordinates: [-43.2, -22.9] },
      properties: { name: nome },
    },
    timestamp: Date.now(),
    clientId: 'rec-client',
  });

  const push = (atlasId, ops) =>
    supertest(app)
      .post(`/api/v1/atlas/${atlasId}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations: ops });

  const cleanup = (atlasId, body) =>
    supertest(app)
      .post(`/api/v1/atlas/${atlasId}/sync/admin/cleanup`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body);

  const recibo = async (atlasId, opId) => {
    const { rows } = await db.query(
      'SELECT op_id, server_version FROM sync_receipts WHERE atlas_id=$1 AND op_id=$2',
      [atlasId, opId]);
    return rows[0] ?? null;
  };

  const contar = async (sql, params) => Number((await db.query(sql, params)).rows[0].n);

  /**
   * Tres ops aplicadas em sequencia, cada uma com a sua versao de servidor, mais o mapa.
   * As versoes vem do ack, que e o unico lugar onde elas sao observaveis sem ler a tabela.
   */
  async function atlasComTresOps() {
    const atlas = await createAtlas(db, user.id, { name: `Atlas ${U()}` });
    const map = await createMap(db, atlas.id);

    const ops = [featureOp(map.id, 'a'), featureOp(map.id, 'b'), featureOp(map.id, 'c')];
    const versoes = [];
    for (const op of ops) {
      const res = await push(atlas.id, [op]).expect(200);
      const ack = res.body.data.results[0];
      assert.equal(ack.status, 'applied', 'guarda: a montagem precisa de fato aplicar');
      versoes.push(Number(ack.currentVersion));
    }
    assert.ok(versoes[0] < versoes[1] && versoes[1] < versoes[2],
      `guarda: as versoes precisam ser crescentes, vieram ${versoes.join(', ')}`);
    return { atlas, map, ops, versoes };
  }

  it('o recibo ABAIXO da fronteira sai e o relatorio o conta; o da fronteira e o de cima ficam', async () => {
    const { atlas, ops, versoes } = await atlasComTresOps();

    assert.equal(ops.length, 3, 'guarda: laco sobre colecao vazia seria verde vazio');
    for (const op of ops) {
      assert.ok(await recibo(atlas.id, op.id), `guarda: o recibo de ${op.id} precisa existir antes`);
    }

    // Corte na versao da SEGUNDA op: a primeira fica abaixo, a segunda esta EM cima da fronteira.
    const res = await cleanup(atlas.id, { keepFromVersion: versoes[1] }).expect(200);

    assert.equal(res.body.data.deletedReceipts, 1,
      'o relatorio precisa contar o recibo apagado, e apenas ele');
    assert.ok(res.body.data.deletedCount >= 1,
      'guarda: sem operacao apagada o expurgo nao rodou e o zero acima nao prova nada');

    assert.equal(await recibo(atlas.id, ops[0].id), null, 'o recibo abaixo da fronteira sai');
    assert.ok(await recibo(atlas.id, ops[1].id), 'o recibo NA fronteira fica (a comparacao e `<`)');
    assert.ok(await recibo(atlas.id, ops[2].id), 'o recibo acima da fronteira fica');
  });

  it('/admin/stats publica a contagem de recibos, que e como a poda se dimensiona', async () => {
    const { atlas } = await atlasComTresOps();
    const res = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/sync/admin/stats`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    assert.equal(res.body.data.totalReceipts, 3);
  });

  it('o recibo de uma RECUSA fica, porque ele e o unico registro daquele desfecho', async () => {
    const { atlas, map, versoes } = await atlasComTresOps();

    // Recusa por ALVO DESCONHECIDO (`unknownTargetDenialReason`): o Joi deixa passar
    // `entityType` livre de proposito, e o servidor recusa por operacao. O que a torna util aqui
    // nao e a causa, e a FORMA do desfecho: ela NAO escreve linha em `operations`, so o recibo,
    // com `server_version` nulo.
    const recusada = {
      protocolVersion: 2,
      id: randomUUID(),
      entityType: 'entidade_que_nao_existe',
      operationType: 'create',
      entityId: randomUUID(),
      mapId: map.id,
      data: { qualquer: 1 },
      timestamp: Date.now(),
      clientId: 'rec-client',
    };
    const resPush = await push(atlas.id, [recusada]).expect(200);
    assert.equal(resPush.body.data.results[0].success, false,
      'guarda: esta op precisa ser recusada, senao o caso mede outra coisa');

    const antes = await recibo(atlas.id, recusada.id);
    assert.ok(antes, 'guarda: a recusa precisa ter deixado recibo');
    assert.equal(antes.server_version, null, 'guarda: o recibo da recusa nasce sem versao');

    // Corte AGRESSIVO: acima de tudo o que existe. Se o recorte olhasse so `server_version < $2`
    // sem a guarda de nulo, ou se alguem escrevesse `IS NULL OR`, este recibo sairia.
    await cleanup(atlas.id, { keepFromVersion: versoes[2] + 1000 }).expect(200);

    assert.ok(await recibo(atlas.id, recusada.id),
      'o recibo sem versao nao tem como ser comparado com a fronteira, entao fica');
  });

  it('reenviar uma op cujo recibo FICOU continua idempotente, sem reaplicar', async () => {
    const { atlas, map, ops, versoes } = await atlasComTresOps();

    await cleanup(atlas.id, { keepFromVersion: versoes[1] }).expect(200);
    assert.ok(await recibo(atlas.id, ops[2].id), 'guarda: o recibo desta op precisa ter sobrevivido');

    const antes = await contar(
      'SELECT COUNT(*)::int AS n FROM features WHERE map_id=$1 AND deleted_at IS NULL', [map.id]);

    const res = await push(atlas.id, [ops[2]]).expect(200);
    const ack = res.body.data.results[0];
    assert.equal(ack.status, 'already_applied', `o reenvio precisa ser acked como repetido: ${JSON.stringify(ack)}`);
    assert.equal(ack.idempotent, true);

    const depois = await contar(
      'SELECT COUNT(*)::int AS n FROM features WHERE map_id=$1 AND deleted_at IS NULL', [map.id]);
    assert.equal(depois, antes, 'nenhuma feicao nova pode ter nascido do reenvio');
  });

  it('CONTROLE NEGATIVO: sem o recibo o MESMO reenvio deixa de ser reconhecido como repeticao', async () => {
    // O que um expurgo por PRAZO faria: cortar recibo numa fronteira PROPRIA, diferente da do
    // log, e alcancar assim uma op que o log ainda guardaria. O efeito e forjado a mao sobre a op
    // do topo da pilha, justamente a que o bloco anterior mostrou protegida, para que a unica
    // variavel entre os dois seja a existencia do par recibo + linha de log.
    //
    // O DESFECHO MEDIDO NAO E O QUE A PERGUNTA ORIGINAL SUPUNHA, e a diferenca fica registrada
    // porque ela DIMINUI o estrago e nao pode ser lida como garantia de mais nada. "Purgar por
    // prazo faria a op REAPLICAR" e verdade para um alvo que escreva por chegada; para a FEICAO
    // ha duas outras redes, e as duas foram medidas ao escrever este arquivo:
    //
    //   - o `create` repetido bate na PROPRIA LINHA da entidade ("Ja existe um item com este
    //     identificador") e volta como `conflict`, sem escrever;
    //   - o `update` de feicao exige base declarada (`RAZAO_SEM_BASE`, em
    //     `src/modules/sync/entity-conflicts.js`), entao nem chega a haver caminho de chegada
    //     pura para ele.
    //
    // O que a perda do recibo produz, entao, e uma RECUSA no lugar de um `already_applied`: o
    // cliente que reenviar recebe conflito por uma edicao que ele JA tinha entregue, e a pessoa
    // e chamada a resolver o que ja estava resolvido. E menos grave que reaplicar e nao e de
    // graca, e e por isso que a fronteira e `min_version` e nao uma data.
    const { atlas, ops } = await atlasComTresOps();

    await db.query('DELETE FROM sync_receipts WHERE atlas_id=$1 AND op_id=$2', [atlas.id, ops[2].id]);
    await db.query('DELETE FROM operations WHERE atlas_id=$1 AND op_id=$2', [atlas.id, ops[2].id]);

    const res = await push(atlas.id, [ops[2]]).expect(200);
    const ack = res.body.data.results[0];
    assert.notEqual(ack.status, 'already_applied',
      `sem o par recibo/log o reenvio nao pode mais ser reconhecido: ${JSON.stringify(ack)}`);
    assert.equal(ack.status, 'conflict');
    assert.equal(ack.rejected, true);
  });

  it('O CUSTO DECLARADO: o recibo purgado quebra a cadeia de `baseOperationId`, e o intacto nao', async () => {
    // Esta e a consequencia que o expurgo introduz e que nao se ve lendo so a poda:
    // `resolveObservedBase` (`src/modules/sync/entity-conflicts.js`) resolve a base de uma edicao
    // sequencial offline LENDO O RECIBO da op predecessora (`findReceipt(t, atlasId,
    // rawOp.baseOperationId)`). Ou seja, o recibo nao serve so para a idempotencia do reenvio: ele
    // e tambem o comprovante de "o que eu editei foi esta versao".
    //
    // Consequencia, e ela fica ESCRITA em vez de descoberta depois: uma edicao encadeada a uma op
    // abaixo da fronteira passa a ser RECUSADA por base nao confirmada. Isso e defensavel (aquele
    // cliente ja recebe snapshot no pull, entao a base dele nao descreve mais nada do servidor) e
    // NAO e silencioso: volta como conflito, com motivo proprio. O par abaixo mede os dois lados,
    // porque so o ramo recusado nao provaria que a cadeia funciona quando o recibo esta la.
    const { atlas, map, ops } = await atlasComTresOps();

    const edicaoEncadeada = (alvo, predecessora, nome) => ({
      protocolVersion: 2,
      id: randomUUID(),
      entityType: 'feature',
      operationType: 'update',
      entityId: alvo,
      mapId: map.id,
      baseOperationId: predecessora,
      patch: [{ op: 'set', path: ['properties', 'name'], value: nome }],
      timestamp: Date.now(),
      clientId: 'rec-client',
    });

    // Com o recibo da predecessora INTACTO: a cadeia resolve e a edicao entra.
    const comRecibo = await push(atlas.id,
      [edicaoEncadeada(ops[2].entityId, ops[2].id, 'encadeada')]).expect(200);
    assert.equal(comRecibo.body.data.results[0].status, 'applied',
      `guarda: com o recibo la a cadeia precisa funcionar: ${JSON.stringify(comRecibo.body.data.results[0])}`);

    // Agora o recibo da predecessora sai pela poda (corte acima da versao dela).
    await cleanup(atlas.id, { keepFromVersion: 1 }).expect(200);
    await db.query('DELETE FROM sync_receipts WHERE atlas_id=$1 AND op_id=$2', [atlas.id, ops[0].id]);

    const semRecibo = await push(atlas.id,
      [edicaoEncadeada(ops[0].entityId, ops[0].id, 'orfa')]).expect(200);
    const ack = semRecibo.body.data.results[0];
    assert.equal(ack.status, 'conflict',
      `sem o recibo da predecessora a cadeia precisa RECUSAR, nao aplicar: ${JSON.stringify(ack)}`);
    assert.equal(ack.reason, RAZAO_BASE_NAO_CONFIRMADA,
      'e a recusa precisa ser a da base nao confirmada, nao outra qualquer');
  });
});
