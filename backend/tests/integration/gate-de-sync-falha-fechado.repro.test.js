// Path: tests/integration/gate-de-sync-falha-fechado.repro.test.js
//
// `assertOperationAllowed` ERA O UNICO GATE DO EIXO POR ATLAS QUE FALHAVA ABERTO.
//
// A escada e `read < comment < write < manage < owner`, e a constituicao (clausula 5.2)
// manda gatear por HIERARQUIA porque lista fechada exclui em silencio o degrau que nascer
// no meio. Aquele gate comparava por IGUALDADE, em duas linhas separadas:
//
//     if (permission === 'read') throw ...
//     if (permission === 'comment' && op.target !== 'comment') throw ...
//
// Um degrau NOVO entre `read` e `write` cai fora dos dois `if` e recebe escrita PLENA.
// A wiki [[permissoes-atlas]] ja nomeava este sitio como "o unico que falha ABERTO" e
// como "o primeiro lugar a mexer"; o censo por atlas nao o acusava, porque a forma que
// ele proibe e dois degraus DISTINTOS na MESMA linha, e uma cadeia de igualdades em
// linhas separadas e a mesma exclusao escrita na vertical.
//
// POR QUE O DEGRAU SINTETICO E A UNICA FORMA DE MEDIR ISSO. O CHECK de
// `atlas_shares.permission` (`003_atlas.sql`) so aceita os quatro concedíveis, entao nao
// ha fixture nem rota capaz de entregar um sexto valor ao gate: o defeito e de EXTENSAO,
// e so se mede injetando o degrau que ainda nao existe. `pushOperations` recebe a
// permissao como PARAMETRO, resolvida pelo middleware, e e por essa porta que o teste
// entra — sem exportar nada novo, e exercitando o mesmo caminho de escrita que a rota usa.
//
// CONTROLE NEGATIVO: revertendo o gate para as duas igualdades, o caso do degrau
// desconhecido passa a APLICAR a op (o mapa aparece em `maps`) e este arquivo fica
// vermelho nele. Os quatro casos dos degraus vivos continuam verdes com as duas formas,
// e e por isso que eles estao aqui: eles provam que o conserto nao mudou o que vale hoje.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas } from '../helpers/fixtures.js';
import { pushOperations } from '../../src/modules/sync/sync.service.js';

describe('assertOperationAllowed — o gate por operacao falha FECHADO', () => {
  let db, dono, atlas;

  before(async () => {
    ({ db } = await setupTestEnv());
    dono = await createUser(db, { username: `gate_fechado_${randomUUID().slice(0, 8)}` });
    atlas = await createAtlas(db, dono.id, { name: 'Atlas do gate' });
  });

  after(async () => teardownTestEnv(db));

  /** Uma op de MAPA, que e escrita comum: nem comentario, nem alvo com politica propria. */
  const opDeMapa = () => ({
    protocolVersion: 2,
    id: randomUUID(),
    entityType: 'map',
    operationType: 'create',
    entityId: randomUUID(),
    data: { name: 'Mapa que nao deveria nascer' },
    timestamp: Date.now(),
    clientId: 'gate-fechado',
  });

  /** Quantos mapas existem neste atlas agora. */
  const mapas = async () => Number(
    (await db.query('SELECT count(*)::int AS n FROM maps WHERE atlas_id = $1', [atlas.id])).rows[0].n
  );

  it('o degrau DESCONHECIDO e recusado, e nao escreve linha nenhuma', async () => {
    // O sexto degrau: qualquer coisa fora dos cinco. Antes do conserto ele passava pelos
    // dois `if` de igualdade e a op era APLICADA, com 200 e tudo.
    const antes = await mapas();
    const op = opDeMapa();

    await assert.rejects(
      pushOperations(atlas.id, [op], dono.id, 'supervisor'),
      (err) => {
        assert.equal(err.statusCode, 403, 'recusa por autorizacao, nao por outra coisa');
        return true;
      },
      'um degrau que a escada nao conhece precisa ser RECUSADO, nunca ignorado',
    );

    assert.equal(await mapas(), antes, 'nenhum mapa foi criado');
    const logadas = Number((await db.query(
      'SELECT count(*)::int AS n FROM operations WHERE atlas_id = $1 AND id = $2', [atlas.id, op.id]
    )).rows[0].n);
    assert.equal(logadas, 0, 'a op nao entrou no log append-only');
  });

  it('a AUSENCIA de degrau e recusada pela mesma porta', async () => {
    // `null` chega quando um chamador futuro esquecer de passar a permissao resolvida.
    // (`undefined` nao serve de sonda: a assinatura tem `permission = 'owner'` como
    // default, entao ele vira o TOPO da escada antes de o gate ver qualquer coisa. Este
    // caso mede o que sobra, e o default fica registrado aqui como o que ele e.)
    const antes = await mapas();
    await assert.rejects(pushOperations(atlas.id, [opDeMapa()], dono.id, null), { statusCode: 403 });
    assert.equal(await mapas(), antes);
  });

  it('`read` continua sem escrever nada', async () => {
    const antes = await mapas();
    await assert.rejects(pushOperations(atlas.id, [opDeMapa()], dono.id, 'read'), { statusCode: 403 });
    assert.equal(await mapas(), antes);
  });

  it('`comment` continua recusado fora de comentario', async () => {
    const antes = await mapas();
    await assert.rejects(pushOperations(atlas.id, [opDeMapa()], dono.id, 'comment'), { statusCode: 403 });
    assert.equal(await mapas(), antes);
  });

  it('`write`, `manage` e `owner` continuam escrevendo — o conserto nao fechou os vivos', async () => {
    for (const degrau of ['write', 'manage', 'owner']) {
      const op = opDeMapa();
      const antes = await mapas();
      const resultado = await pushOperations(atlas.id, [op], dono.id, degrau);
      assert.equal(resultado.results[0].status, 'applied', `${degrau} devia aplicar`);
      assert.equal(await mapas(), antes + 1, `${degrau} devia ter criado o mapa`);
    }
  });
});
