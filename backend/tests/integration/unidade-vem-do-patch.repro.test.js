// Path: tests/integration/unidade-vem-do-patch.repro.test.js
//
// CAUSA RAIZ (B5, item 4). O servidor derivava as unidades em disputa das COLUNAS QUE O PAYLOAD
// CARREGA (`declaredUpdateColumns`), e o payload de uma camada é o DOCUMENTO INTEIRO: o cliente
// manda `{id, name, visible, locked, opacity, order, style}` mesmo quando mexeu num campo só. Duas
// pessoas editando campos DIFERENTES da mesma camada a partir da mesma base disputavam todas as
// seis unidades, e a segunda era recusada por um conflito que não existia. O veredito era honesto
// enquanto a escrita fosse larga (uma escrita de documento inteiro a partir de base velha
// realmente sobrescreve tudo), e é justamente essa parte que muda aqui.
//
// O CONSERTO SÃO DUAS METADES QUE NÃO PODEM VIAJAR SEPARADAS:
//   1. a reivindicação passa a vir do `patch` que o cliente declara (os campos que ele de fato
//      MUDOU, diffados contra o documento que ele leu antes de escrever);
//   2. a ESCRITA é estreitada às colunas dessas unidades (`columnsForUnits` via `op._unitScope`).
// Só a primeira seria uma REGRESSÃO, não um refinamento: a op deixaria de ser recusada e passaria a
// escrever, do documento velho, exatamente as unidades que ela jurou não tocar. O caso "a escrita
// de B não move o nome que A gravou" é o que mede isso, e é o que fica vermelho se alguém aceitar a
// metade 1 sozinha.
//
// POR QUE SÓ `layer` E `map` (`PATCH_NARROWED_TARGETS`). Estreitar a escrita faz a linha do
// servidor divergir do payload que foi transmitido, então a entidade só entra na lista quando o par
// converge na linha do SERVIDOR de qualquer jeito: a camada porque o ack e o broadcast já carregam
// a linha canônica (`canonicalLayer`) e o par a MESCLA; o mapa porque a estreitada ali é
// provadamente inócua com o cliente de hoje (todo sítio de escrita de mapa manda só o campo que
// mudou) e porque o par mescla as chaves presentes. `group`, `briefing`, `slide` e `comment` ficam
// de fora com motivo escrito: o par SUBSTITUI o documento deles pelo payload transmitido, e
// estreitar a escrita sem retransmitir a linha canônica deixaria todo par com uma linha que não
// existe em lugar nenhum. Os dois casos de contraste abaixo prendem essa fronteira, para que ela
// seja uma decisão e não um esquecimento.
//
// CONTROLE NEGATIVO, medido em 2026-09-13, e as duas metades falham em conjuntos DIFERENTES, que é
// a evidência de que cada uma tem um caso próprio:
//   - esvaziando `PATCH_NARROWED_TARGETS` (sem derivação por patch): 3 vermelhos, os dois casos de
//     camada que dependem da precisão da unidade e o contraste "sem patch", que compara os dois
//     regimes lado a lado. Os outros 3 seguem verdes: o `remove` porque o payload já nomeava a
//     coluna, e os contrastes de grupo e de mapa porque eles descrevem o que NÃO muda;
//   - mantendo a derivação e devolvendo os campos crus em `narrow` (sem estreitada): 1 vermelho, e
//     é "a escrita de B não move o nome que A gravou". É exatamente o caso que existe para provar
//     que a metade 1 sozinha troca uma recusa por uma perda silenciosa.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createLayer, createGroup, loginUser } from '../helpers/fixtures.js';

const DISPUTADOS = 'Os mesmos campos foram alterados no servidor.';

describe('B5.4 — a unidade em disputa vem do `patch`, e a escrita é estreitada a ela', () => {
  let app, db, token, atlas, map;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    const owner = await createUser(db, { username: 'patch_owner' });
    token = await loginUser(app, owner.username, owner.password);
    atlas = await createAtlas(db, owner.id, { name: 'Unidade pelo patch' });
    map = await createMap(db, atlas.id, { name: 'Mapa do patch' });
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
    protocolVersion: 2, id: randomUUID(), timestamp: Date.now(), clientId: 'c-patch', ...extra,
  }])).body.data.acks[0];

  const linha = async (tabela, id) => {
    const { rows } = await db.query(`SELECT * FROM ${tabela} WHERE id = $1`, [id]);
    assert.equal(rows.length, 1, `a linha de ${tabela} existe (uma só)`);
    return rows[0];
  };

  /** O documento INTEIRO de uma camada, que é o que o cliente real manda em toda edição dela. */
  const documentoDaCamada = (row, mudancas) => ({
    id: row.id,
    name: row.name,
    visible: row.visible,
    locked: row.locked,
    opacity: row.opacity,
    order: row.sort_order,
    style: row.style,
    ...mudancas,
  });

  // ==========================================================================
  // CAMADA — o aceite escrito da pendência
  // ==========================================================================

  it('CAMADA: dois clientes editando campos DISTINTOS da mesma base convergem sem recusa', async () => {
    const layer = await createLayer(db, map.id, { name: 'Camada convergente' });
    const base = Number(layer.version);

    const deA = await uma({
      entityType: 'layer', operationType: 'update', entityId: layer.id, mapId: map.id,
      baseVersion: base,
      data: documentoDaCamada(layer, { name: 'Renomeada por A' }),
      patch: [{ op: 'set', path: ['name'], value: 'Renomeada por A' }],
    });
    assert.equal(deA.rejected, undefined, `A renomeia (motivo: ${deA.reason})`);

    const deB = await uma({
      entityType: 'layer', operationType: 'update', entityId: layer.id, mapId: map.id,
      // A MESMA BASE de A: B nunca viu a renomeação, e o documento que ele manda ainda tem o nome
      // velho. É o caso inteiro.
      baseVersion: base,
      data: documentoDaCamada(layer, { visible: false }),
      patch: [{ op: 'set', path: ['visible'], value: false }],
    });
    assert.equal(deB.rejected, undefined,
      `B esconde a camada da MESMA base e NÃO é recusado (motivo: ${deB.reason})`);

    const depois = await linha('layers', layer.id);
    assert.equal(depois.name, 'Renomeada por A',
      'A ESCRITA DE B NÃO MOVEU O NOME: sem a estreitada, o documento velho de B teria voltado '
      + 'o nome ao original, em silêncio, e este arquivo teria trocado uma recusa por uma perda');
    assert.equal(depois.visible, false, 'e a visibilidade de B entrou');
    assert.equal(Number(depois.version), base + 2, 'as duas escritas aconteceram');
  });

  it('CAMADA: o MESMO campo da mesma base continua sendo conflito, nomeando a unidade', async () => {
    // O contraste que impede a leitura "agora nada mais conflita". O `patch` estreita a
    // reivindicação; ele não desliga a comparação.
    const layer = await createLayer(db, map.id, { name: 'Camada disputada' });
    const base = Number(layer.version);
    const renomear = (quem) => ({
      entityType: 'layer', operationType: 'update', entityId: layer.id, mapId: map.id,
      baseVersion: base,
      data: documentoDaCamada(layer, { name: `Renomeada por ${quem}` }),
      patch: [{ op: 'set', path: ['name'], value: `Renomeada por ${quem}` }],
    });

    assert.equal((await uma(renomear('A'))).rejected, undefined, 'A renomeia');
    const deC = await uma(renomear('C'));
    assert.equal(deC.rejected, true, 'C renomeia da base velha e é recusado');
    assert.equal(deC.reason, DISPUTADOS, 'pelo motivo compartilhado');
    assert.deepEqual(deC.conflict.fields, ['nome'], 'nomeando a unidade, e só ela');
    assert.equal((await linha('layers', layer.id)).name, 'Renomeada por A', 'nada sobrescrito');
  });

  it('CAMADA: um `remove` do patch reivindica a coluna, senão o apagamento não aconteceria', async () => {
    // Uma entrada de `remove` não tem `value`, então lê-la como ausente deixaria a coluna fora da
    // reivindicação E fora da escrita estreitada: o campo que a pessoa apagou continuaria lá, com
    // ack de sucesso.
    const layer = await createLayer(db, map.id, { name: 'Camada com estilo' });
    await db.query(`UPDATE layers SET style = '{"cor":"vermelho"}'::jsonb WHERE id = $1`, [layer.id]);
    const comEstilo = await linha('layers', layer.id);

    const ack = await uma({
      entityType: 'layer', operationType: 'update', entityId: layer.id, mapId: map.id,
      baseVersion: Number(comEstilo.version),
      data: { ...documentoDaCamada(comEstilo), style: null },
      patch: [{ op: 'remove', path: ['style'] }],
    });
    assert.equal(ack.rejected, undefined, `o apagamento entra (motivo: ${ack.reason})`);
    assert.equal((await linha('layers', layer.id)).style, null, 'e o estilo foi de fato apagado');
  });

  // ==========================================================================
  // OS CONTRASTES — a fronteira declarada de `PATCH_NARROWED_TARGETS`
  // ==========================================================================

  it('CONTRASTE: sem `patch`, a camada volta a disputar tudo o que o payload carrega', async () => {
    // O cliente que não declara patch (nem por isso base, mas aqui a base é declarada à mão) não
    // ganha precisão nenhuma, e é assim que tem de ser: sem a lista do que mudou, o documento
    // inteiro é o que a escrita vai gravar.
    const layer = await createLayer(db, map.id, { name: 'Camada sem patch' });
    const base = Number(layer.version);

    assert.equal((await uma({
      entityType: 'layer', operationType: 'update', entityId: layer.id, mapId: map.id,
      baseVersion: base, data: documentoDaCamada(layer, { name: 'Nome de A' }),
      patch: [{ op: 'set', path: ['name'], value: 'Nome de A' }],
    })).rejected, undefined, 'A renomeia declarando o patch');

    const semPatch = await uma({
      entityType: 'layer', operationType: 'update', entityId: layer.id, mapId: map.id,
      baseVersion: base, data: documentoDaCamada(layer, { visible: false }),
    });
    assert.equal(semPatch.rejected, true, 'sem patch, a mesma edição de outro campo é recusada');
    assert.deepEqual(semPatch.conflict.fields, ['nome'],
      'e a unidade nomeada é a que o servidor viu mexer, não a que o payload inteiro carrega');
  });

  it('CONTRASTE: `group` NÃO está na lista, e continua disputando pelo payload', async () => {
    // A fronteira é declarada, não esquecida: o par SUBSTITUI o documento do grupo pelo payload
    // transmitido, então estreitar a escrita ali sem retransmitir a linha canônica deixaria todo
    // par com uma linha que não existe em lugar nenhum. Recusar demais é o lado certo de errar.
    const group = await createGroup(db, map.id, { name: 'Grupo fora da lista' });
    const base = Number(group.version);
    const documento = (mudancas) => ({
      id: group.id, name: group.name, visible: group.visible, locked: group.locked,
      style: group.style, parent_id: group.parent_id, ...mudancas,
    });

    assert.equal((await uma({
      entityType: 'group', operationType: 'update', entityId: group.id, mapId: map.id,
      baseVersion: base, data: documento({ name: 'Grupo de A' }),
      patch: [{ op: 'set', path: ['name'], value: 'Grupo de A' }],
    })).rejected, undefined, 'A renomeia o grupo');

    const deB = await uma({
      entityType: 'group', operationType: 'update', entityId: group.id, mapId: map.id,
      baseVersion: base, data: documento({ visible: false }),
      patch: [{ op: 'set', path: ['visible'], value: false }],
    });
    assert.equal(deB.rejected, true,
      'o grupo ainda recusa, mesmo com patch declarado: ele não está em PATCH_NARROWED_TARGETS');
    assert.equal((await linha('groups', group.id)).name, 'Grupo de A',
      'e a recusa é o que protege o nome de A, já que a escrita dele não seria estreitada');
  });

  it('CONTRASTE: no MAPA a estreitada é inócua, porque o payload já é estreito', async () => {
    // O mapa está na lista para que continue assim: todo sítio de escrita de mapa manda só o campo
    // que mudou, então patch e payload nomeiam as mesmas colunas e a estreitada não tira nada. Se
    // um dia um payload largo de mapa aparecer, ele será estreitado em vez de alargar a disputa.
    const alvo = await createMap(db, atlas.id, { name: 'Mapa estreito' });
    const base = Number((await linha('maps', alvo.id)).version);

    assert.equal((await uma({
      type: 'update', target: 'map', targetId: alvo.id, baseVersion: base,
      changes: { name: 'Mapa de A' }, patch: [{ op: 'set', path: ['name'], value: 'Mapa de A' }],
    })).rejected, undefined, 'A renomeia o mapa');

    const travar = await uma({
      type: 'update', target: 'map', targetId: alvo.id, baseVersion: base,
      changes: { locked: true }, patch: [{ op: 'set', path: ['locked'], value: true }],
    });
    assert.equal(travar.rejected, undefined, 'B trava o mapa da mesma base: outra unidade');

    const depois = await linha('maps', alvo.id);
    assert.equal(depois.name, 'Mapa de A', 'o nome de A sobreviveu');
    assert.equal(depois.locked, true, 'e a trava de B entrou');
  });
});
