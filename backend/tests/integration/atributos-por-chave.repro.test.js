// Path: tests/integration/atributos-por-chave.repro.test.js
//
// OS ATRIBUTOS PERSONALIZADOS SÃO DISPUTADOS POR CHAVE (decisão do dono em 2026-09-24).
//
// CAUSA RAIZ. `prepareFeatureMutation` (`src/modules/sync/feature-conflicts.js`) só aceitava o
// caminho `['properties', chave]`, e `properties.attributes`, a bolsa de atributos que a pessoa
// nomeia e preenche um a um, era UMA unidade da fronteira. Dois colegas mexendo em atributos
// DIFERENTES da mesma feição a partir da mesma revisão disputavam a bolsa inteira, e o segundo era
// recusado com `Os mesmos campos foram alterados no servidor.`
//
// O CONSERTO: o caminho `['properties','attributes',chave]` é aceito, fundido na bolsa viva e
// registrado na fronteira por chave. A MESMA chave continua conflito (a regra de toda propriedade).
// A bolsa inteira (o formato antigo, de filas gravadas antes) continua aceita e aplicada como
// substituição, e passa a ser disputada também por uma escrita de chave feita depois da base dela.
//
// O mesmo contrato é medido do lado do cliente, com a fábrica real de operações, em
// `frontend/tests/e2e/atributos-por-chave.e2e.test.js`.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';

const DISPUTADOS = 'Os mesmos campos foram alterados no servidor.';

describe('atributos personalizados: a unidade de disputa é a chave', () => {
  let app, db, token, atlas, map;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    const owner = await createUser(db, { username: 'atributos_owner' });
    token = await loginUser(app, owner.username, owner.password);
    atlas = await createAtlas(db, owner.id, { name: 'Atributos por chave' });
    map = await createMap(db, atlas.id, { name: 'Mapa dos atributos' });
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const uma = async (extra) => (await supertest(app)
    .post(`/api/v1/atlas/${atlas.id}/sync`)
    .set('Authorization', `Bearer ${token}`)
    .send({ operations: [{ protocolVersion: 2, id: randomUUID(), timestamp: Date.now(), clientId: 'c-attr', ...extra }] })
    .expect(200)).body.data.acks[0];

  const linha = async (id) => {
    const { rows } = await db.query('SELECT version, properties FROM features WHERE id = $1', [id]);
    assert.equal(rows.length, 1, 'a feição existe');
    return { version: Number(rows[0].version), attributes: rows[0].properties.attributes };
  };

  /** Um ponto com a bolsa dada, e a revisão em que ele nasceu. */
  const ponto = async (attributes) => {
    const id = randomUUID();
    const properties = { id, source: 'point', nome: 'Posto' };
    if (attributes !== undefined) properties.attributes = attributes;
    const ack = await uma({
      entityType: 'feature', operationType: 'create', entityId: id, mapId: map.id,
      data: { type: 'Feature', geometry: { type: 'Point', coordinates: [-43.2, -22.9] }, properties },
    });
    assert.equal(ack.rejected, undefined, `o ponto nasceu (motivo: ${ack.reason})`);
    return { id, base: (await linha(id)).version };
  };

  const edicao = (id, base, patch) => ({
    entityType: 'feature', operationType: 'update', entityId: id, mapId: map.id, baseVersion: base, patch,
  });
  const chave = (op, nome, value) => (op === 'remove'
    ? { op, path: ['properties', 'attributes', nome] }
    : { op, path: ['properties', 'attributes', nome], value });

  it('REPRO: excluir "x" e mudar "y" da mesma base, as duas ficam', async () => {
    const { id, base } = await ponto({ x: 'um', y: 'um' });
    const a = await uma(edicao(id, base, [chave('remove', 'x')]));
    assert.equal(a.rejected, undefined, `a primeira grava (motivo: ${a.reason})`);
    const b = await uma(edicao(id, base, [chave('set', 'y', 'dois')]));
    assert.equal(b.rejected, undefined, `a segunda não disputa a primeira (motivo: ${b.reason})`);
    assert.deepEqual((await linha(id)).attributes, { y: 'dois' });
  });

  it('REPRO: mudar "x" e mudar "y" da mesma base, as duas ficam', async () => {
    const { id, base } = await ponto({ x: 'um', y: 'um' });
    assert.equal((await uma(edicao(id, base, [chave('set', 'x', 'A')]))).rejected, undefined);
    const b = await uma(edicao(id, base, [chave('set', 'y', 'B')]));
    assert.equal(b.rejected, undefined, `motivo: ${b.reason}`);
    assert.deepEqual((await linha(id)).attributes, { x: 'A', y: 'B' });
  });

  it('a MESMA chave continua conflito, nomeando a chave', async () => {
    const { id, base } = await ponto({ y: 'um' });
    assert.equal((await uma(edicao(id, base, [chave('set', 'y', 'A')]))).rejected, undefined);
    const b = await uma(edicao(id, base, [chave('set', 'y', 'B')]));
    assert.equal(b.rejected, true);
    assert.equal(b.reason, DISPUTADOS);
    assert.deepEqual(b.conflict.fields, [['properties', 'attributes', 'y']]);
    assert.deepEqual((await linha(id)).attributes, { y: 'A' });
  });

  it('o primeiro atributo por chave cria a bolsa, e excluir de uma bolsa ausente não a cria', async () => {
    const semBolsa = await ponto(undefined);
    assert.equal((await uma(edicao(semBolsa.id, semBolsa.base, [chave('set', 'x', 'um')]))).rejected, undefined);
    assert.deepEqual((await linha(semBolsa.id)).attributes, { x: 'um' });

    const outro = await ponto(undefined);
    assert.equal((await uma(edicao(outro.id, outro.base, [chave('remove', 'x')]))).rejected, undefined);
    assert.equal((await linha(outro.id)).attributes, undefined);
  });

  it('o formato ANTIGO (a bolsa inteira) continua aceito e substitui a bolsa, como antes', async () => {
    const { id, base } = await ponto({ x: 'um', y: 'um' });
    const velha = await uma(edicao(id, base, [{ op: 'set', path: ['properties', 'attributes'], value: { y: 'um', z: 'novo' } }]));
    assert.equal(velha.rejected, undefined, `motivo: ${velha.reason}`);
    assert.deepEqual((await linha(id)).attributes, { y: 'um', z: 'novo' });
  });

  it('o formato ANTIGO é disputado por uma escrita de chave feita depois da base dele', async () => {
    const { id, base } = await ponto({ x: 'um', y: 'um' });
    assert.equal((await uma(edicao(id, base, [chave('set', 'x', 'A')]))).rejected, undefined);
    const velha = await uma(edicao(id, base, [{ op: 'set', path: ['properties', 'attributes'], value: { x: 'um', y: 'velho' } }]));
    assert.equal(velha.rejected, true);
    assert.equal(velha.reason, DISPUTADOS);
    assert.deepEqual((await linha(id)).attributes, { x: 'A', y: 'um' });
  });

  // A BASE ENCADEADA NÃO PODE ESCONDER UMA CHAVE QUE O AUTOR NUNCA VIU. Uma op que depende de outra do
  // MESMO autor (`baseOperationId`) adota a revisão que a antecessora commitou (`resolveObservedBase`),
  // e essa revisão já inclui o que um colega escreveu ENTRE a base declarada e a antecessora. Para uma
  // chave que o autor escreve, isso é a regra de sempre; para a bolsa INTEIRA, que substitui chaves que
  // o autor nem tocou, era perda muda: a chave "z" do colega, gravada em v6, não passava de v7 e sumia.
  it('REPRO: a bolsa inteira encadeada é disputada pela chave que um colega gravou depois da base DECLARADA', async () => {
    const { id, base } = await ponto({ x: 'um' });
    // B, sem rede, enfileira op1 (nome) e op2 (a bolsa inteira, formato antigo), as duas na base velha.
    const op1Id = randomUUID();
    // A grava a chave "z" antes de B voltar.
    assert.equal((await uma(edicao(id, base, [chave('set', 'z', 'do colega')]))).rejected, undefined);
    const op1 = await uma({ ...edicao(id, base, [{ op: 'set', path: ['properties', 'nome'], value: 'Nome de B' }]), id: op1Id });
    assert.equal(op1.rejected, undefined, `op1 grava (motivo: ${op1.reason})`);
    const op2 = await uma({
      ...edicao(id, base, [{ op: 'set', path: ['properties', 'attributes'], value: { x: 'dois' } }]),
      baseOperationId: op1Id,
    });
    assert.equal(op2.rejected, true, 'a bolsa inteira apagaria a chave "z" do colega');
    assert.equal(op2.reason, DISPUTADOS);
    assert.deepEqual((await linha(id)).attributes, { x: 'um', z: 'do colega' });
  });

  it('CONTROLE: a bolsa inteira encadeada à própria escrita de chave do autor não se disputa com ela', async () => {
    const { id, base } = await ponto({ x: 'um' });
    const op1Id = randomUUID();
    const op1 = await uma({ ...edicao(id, base, [chave('set', 'y', 'meu')]), id: op1Id });
    assert.equal(op1.rejected, undefined, `op1 grava (motivo: ${op1.reason})`);
    const op2 = await uma({
      ...edicao(id, base, [{ op: 'set', path: ['properties', 'attributes'], value: { x: 'um', y: 'meu', w: 'novo' } }]),
      baseOperationId: op1Id,
    });
    assert.equal(op2.rejected, undefined, `a chave da própria antecessora não disputa (motivo: ${op2.reason})`);
    assert.deepEqual((await linha(id)).attributes, { x: 'um', y: 'meu', w: 'novo' });
  });

  it('a chave escrita depois de a bolsa inteira ter sido substituída é disputada pela bolsa', async () => {
    const { id, base } = await ponto({ x: 'um' });
    assert.equal((await uma(edicao(id, base, [{ op: 'set', path: ['properties', 'attributes'], value: { x: 'dois' } }]))).rejected, undefined);
    const b = await uma(edicao(id, base, [chave('set', 'x', 'tres')]));
    assert.equal(b.rejected, true);
    assert.equal(b.reason, DISPUTADOS);
  });

  it('a bolsa inteira e uma chave dela no MESMO patch são recusadas', async () => {
    const { id, base } = await ponto({ x: 'um' });
    const ack = await uma(edicao(id, base, [
      { op: 'set', path: ['properties', 'attributes'], value: { x: 'dois' } },
      chave('set', 'y', 'um'),
    ]));
    assert.equal(ack.rejected, true);
    assert.deepEqual((await linha(id)).attributes, { x: 'um' });
  });

  it('um nome de chave que alcançaria o protótipo é recusado', async () => {
    const { id, base } = await ponto({ x: 'um' });
    for (const nome of ['__proto__', 'constructor', 'prototype']) {
      const ack = await uma(edicao(id, base, [chave('set', nome, 'mal')]));
      assert.equal(ack.rejected, true, `a chave "${nome}" foi aceita`);
    }
    // O nome vazio nem chega ao julgamento: a validação do envelope recusa o segmento vazio.
    await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations: [{ protocolVersion: 2, id: randomUUID(), timestamp: Date.now(), clientId: 'c-attr',
        ...edicao(id, base, [chave('set', '', 'mal')]) }] })
      .expect(422);
    assert.deepEqual((await linha(id)).attributes, { x: 'um' });
    assert.equal(Object.prototype.mal, undefined);
  });

  it('uma chave aninhada além do nome não é um caminho válido', async () => {
    const { id, base } = await ponto({ x: 'um' });
    const ack = await uma(edicao(id, base, [{ op: 'set', path: ['properties', 'attributes', 'x', 'y'], value: 1 }]));
    assert.equal(ack.rejected, true);
    const outra = await uma(edicao(id, base, [{ op: 'set', path: ['properties', 'nome', 'x'], value: 1 }]));
    assert.equal(outra.rejected, true);
  });
});
