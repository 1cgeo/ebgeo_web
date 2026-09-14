// Path: tests/integration/patch-vazio-nao-disputa.repro.test.js
//
// CAUSA RAIZ, medida em 2026-09-13 com duas browsers de verdade. `patchAsChanges` tratava
// `patch: []` como a AUSÊNCIA de uma declaração e caía no payload inteiro, de modo que uma operação
// que dizia, com todas as letras, não ter mudado campo nenhum passava a disputar toda unidade que o
// payload carregava.
//
// O caminho completo do defeito, porque nenhuma metade dele é adivinhável a partir da outra:
//   1. `base-layer.control.js` regrava o mapa-base ao trocar de mapa, e regrava o MESMO valor. O
//      cliente compara o documento que leu com o que escreveu (`entityMutationContract`) e publica
//      `patch: []`: nada mudou.
//   2. desde 2026-09-13 o mapa DECLARA a base que observou, então essa op entra no regime de base e
//      revisão em vez de ser aplicada por ordem de chegada.
//   3. lida como "sem patch", a op reivindicava `mapaBase`, a unidade que a op ANTERIOR DO MESMO
//      AUTOR acabara de mover, e voltava recusada com `Os mesmos campos foram alterados no
//      servidor.` Não havia colaborador nenhum na história.
//   4. recusa vira problema durável na fila do cliente, e o `PendingBlockade` segura toda operação
//      seguinte cujo `mapId` seja aquele mapa: a criação de camada nunca saía, e o full-chain
//      acusava `never acked` no elo 2. Dois specs de duas browsers caíam assim
//      (`browser-collab-maps-layers`, `browser-p8-undo-local`).
//
// O CONSERTO SÃO DUAS METADES, pela mesma razão que a derivação por patch já tinha duas:
//   1. `[]` é uma declaração de que nada mudou (`patchAsChanges` devolve `{}`), e entrada
//      MALFORMADA continua alargando para o payload, porque essa sim é ilegível;
//   2. a op que reivindica ZERO unidade ESCREVE zero coluna (`_unitScope: []` mais o Set vazio de
//      `columnsForUnits`). Só a primeira seria pior que o defeito: a op deixaria de ser recusada e
//      passaria a gravar o payload, subindo a `version` da linha SEM mover a fronteira durável, o
//      que envelhece a fronteira e recusa a edição seguinte. O caso "não sobe a version" é o que
//      mede isso.
//
// CONTROLE NEGATIVO, medido: devolvendo `null` para o array vazio em `patchAsChanges`, 2 dos 5
// casos ficam vermelhos (o repro e o da version). Mantendo a leitura do vazio e devolvendo `null`
// em `columnsForUnits` para o escopo vazio, 1 fica vermelho, e é justamente o da escrita.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';

const DISPUTADOS = 'Os mesmos campos foram alterados no servidor.';

describe('B11d — `patch: []` declara que nada mudou, e não disputa unidade nenhuma', () => {
  let app, db, token, atlas;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    const owner = await createUser(db, { username: 'patch_vazio_owner' });
    token = await loginUser(app, owner.username, owner.password);
    atlas = await createAtlas(db, owner.id, { name: 'Patch vazio' });
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const push = (operations) =>
    supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations })
      .expect(200);

  const uma = async (extra) => (await push([{
    protocolVersion: 2, id: randomUUID(), timestamp: Date.now(), clientId: 'c-vazio', ...extra,
  }])).body.data.acks[0];

  const linhaDoMapa = async (id) => {
    const { rows } = await db.query('SELECT * FROM maps WHERE id = $1', [id]);
    assert.equal(rows.length, 1, 'a linha do mapa existe (uma só)');
    return rows[0];
  };

  /** Um `baseLayer` como o cliente o manda: o valor no payload, os campos mudados no patch. */
  const mapaBase = (map, valor, { base, patch }) => ({
    entityType: 'baseLayer', operationType: 'update', entityId: map.id, mapId: map.id,
    baseVersion: base, data: { baseLayer: valor }, patch,
  });

  /**
   * Um mapa cuja unidade `mapaBase` JÁ FOI MOVIDA por este mesmo autor, que é a única forma de a
   * fronteira daquela unidade ficar à frente da base que o documento local ainda carrega.
   * @param {string} nome - Nome do mapa.
   * @returns {Promise<{map: Object, baseVelha: number}>} O mapa e a base que o cliente declararia.
   */
  const mapaComMapaBaseJaMovido = async (nome) => {
    const map = await createMap(db, atlas.id, { name: nome });
    const baseVelha = Number(map.version);
    const primeira = await uma(mapaBase(map, 'carta-topografica', {
      base: baseVelha, patch: [{ op: 'set', path: ['baseLayer'], value: 'carta-topografica' }],
    }));
    assert.equal(primeira.rejected, undefined, `a primeira grava (motivo: ${primeira.reason})`);
    assert.ok(primeira.entityVersion > baseVelha, 'a primeira moveu a version da linha');
    return { map, baseVelha };
  };

  it('REPRO: a segunda escrita do MESMO valor, com patch vazio e base velha, é ACEITA', async () => {
    const { map, baseVelha } = await mapaComMapaBaseJaMovido('Mapa do patch vazio');

    // A op que o cliente de fato produz ao trocar de mapa: o payload repete o valor já gravado, o
    // patch está vazio porque nada mudou, e a base é a que o documento local ainda carregava.
    const segunda = await uma(mapaBase(map, 'carta-topografica', { base: baseVelha, patch: [] }));

    assert.equal(segunda.rejected, undefined,
      `declarar patch vazio não disputa unidade nenhuma (motivo: ${segunda.reason})`);
    assert.notEqual(segunda.reason, DISPUTADOS);
  });

  it('E NÃO ESCREVE: a version da linha não sobe, e a fronteira não envelhece', async () => {
    const { map, baseVelha } = await mapaComMapaBaseJaMovido('Mapa que não sobe version');
    const antes = await linhaDoMapa(map.id);

    // O PAYLOAD DISCORDA DO PATCH DE PROPÓSITO. É a única forma de separar "escreveu o mesmo
    // valor" de "não escreveu": o patch jura que nada mudou, o payload carrega outra camada, e
    // quem decide é a escrita. Se o escopo vazio não estreitasse a escrita, esta linha gravaria
    // `bdgex` e subiria a version SEM mover a fronteira, que é o defeito seguinte.
    const segunda = await uma(mapaBase(map, 'bdgex', { base: baseVelha, patch: [] }));
    assert.equal(segunda.rejected, undefined, `aceita (motivo: ${segunda.reason})`);

    const depois = await linhaDoMapa(map.id);
    assert.equal(Number(depois.version), Number(antes.version),
      'uma op que reivindica zero unidade escreve zero coluna, então a version fica onde estava');
    assert.equal(depois.base_layer, antes.base_layer,
      'e o payload, que o patch jurou não ter mudado, não é gravado');
    assert.equal(segunda.entityVersion, Number(antes.version),
      'o recibo devolve a revisão CORRENTE, que é o que reconcilia a base do autor');
  });

  it('A TERCEIRA edição, depois da vazia, continua sendo aceita a partir do recibo', async () => {
    const { map, baseVelha } = await mapaComMapaBaseJaMovido('Mapa da terceira edição');
    const vazia = await uma(mapaBase(map, 'carta-topografica', { base: baseVelha, patch: [] }));
    assert.equal(vazia.rejected, undefined, 'a vazia passa');

    const terceira = await uma(mapaBase(map, 'bdgex', {
      base: vazia.entityVersion,
      patch: [{ op: 'set', path: ['baseLayer'], value: 'bdgex' }],
    }));
    assert.equal(terceira.rejected, undefined,
      `a base que o recibo da vazia devolveu ainda vale (motivo: ${terceira.reason})`);
    assert.equal((await linhaDoMapa(map.id)).base_layer, 'bdgex', 'e ela grava');
  });

  it('CONTRASTE: patch AUSENTE continua alargando para o payload, e continua recusado', async () => {
    const { map, baseVelha } = await mapaComMapaBaseJaMovido('Mapa sem patch nenhum');

    // SEM `patch` é outra coisa que `patch: []`, e a distinção é o conserto inteiro: aqui não há
    // declaração para ler, então a resposta conservadora continua sendo a larga (o payload).
    const semPatch = await uma(mapaBase(map, 'carta-topografica', { base: baseVelha, patch: undefined }));
    assert.equal(semPatch.rejected, true, 'sem declaração, o payload segue sendo a reivindicação');
    assert.equal(semPatch.reason, DISPUTADOS);
    assert.deepEqual(semPatch.conflict?.fields, ['mapaBase']);
  });

  it('CONTRASTE: patch que MUDA a mesma unidade, de base velha, continua recusado', async () => {
    const { map, baseVelha } = await mapaComMapaBaseJaMovido('Mapa da disputa real');

    const disputa = await uma(mapaBase(map, 'bdgex', {
      base: baseVelha, patch: [{ op: 'set', path: ['baseLayer'], value: 'bdgex' }],
    }));
    assert.equal(disputa.rejected, true, 'a que de fato muda a unidade movida continua perdendo');
    assert.equal(disputa.reason, DISPUTADOS);
    assert.deepEqual(disputa.conflict?.fields, ['mapaBase']);
  });
});
