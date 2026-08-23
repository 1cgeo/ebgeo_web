// Path: tests/integration/overview-nivel-do-participante.test.js
//
// O NÍVEL DE CADA PARTICIPANTE NO CARTÃO DO ATLAS (decisão do dono, 2026-08-23).
//
// O QUE MUDOU, e é uma decisão de PRIVACIDADE: até aqui "quem tem acesso e com que nível" só era
// respondível por `GET /atlas/:atlasId/sharing`, gateada em `manage`. Um Leitor ou um Editor via a
// lista de participantes SEM o nível de ninguém, então não tinha como saber a quem pedir permissão,
// nem por que um vizinho apaga o que ele não apaga. O nível passou a sair no `GET /atlas/overview`,
// que qualquer membro alcança.
//
// TRÊS COISAS QUE SÓ FALHAM AQUI:
//
// 1. O NÍVEL É O EFETIVO, não a coluna de `atlas_shares`. Desde o eixo de grupo, quem tem `read`
//    nominal e `manage` por um coletivo é tratado pelo servidor como `manage`. Um cartão que
//    mostrasse a COLUNA anunciaria um rebaixamento que o servidor nunca aplicou — o mesmo defeito
//    que `effectivePermission` fechou em `GET /sharing`, na tela ao lado.
// 2. O DONO NÃO TEM LINHA DE SHARE. Ele entra pela outra metade da união, e o nível dele é
//    sintetizado. Sem isso ele sairia com o campo NULO, que é precisamente o "vazio" que a decisão
//    manda não produzir.
// 3. O CORTE DE DEZ E O CONTADOR. O `json_agg` corta em 10 e o cartão desenha "e mais N" a partir
//    de `member_count`. Acrescentar coluna dentro de uma subconsulta com `ORDER BY ... LIMIT` é o
//    tipo de mudança que quebra o corte sem quebrar nada mais.
//
// O QUE ESTE ARQUIVO NÃO MEDE: o CAMINHO (o `effectiveVia` de `GET /sharing`). Ele fica de fora de
// propósito — dizer "por grupo" a todo membro de leitura revelaria que aquela pessoa está num
// coletivo, dedução sobre composição que as cláusulas 4.5 e 5.3 reservam a quem administra.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAtlas, createShare, loginUser,
  createAccessGroup, addAccessGroupMember, createGroupShare,
} from '../helpers/fixtures.js';

const U = () => `onp_${randomUUID().slice(0, 8)}`;

describe('overview · o nível de cada participante', () => {
  let app, db, dono, donoTok, leitor, leitorTok;

  /** O cartão de UM atlas, como o chamador o recebe. */
  const cartao = async (tok, atlasId) => {
    const res = await supertest(app)
      .get('/api/v1/atlas/overview')
      .set('Authorization', `Bearer ${tok}`)
      .expect(200);
    return res.body.data.atlases.find((a) => a.id === atlasId) ?? null;
  };

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    dono = await createUser(db, { username: U(), nome: 'Ana Dona' });
    donoTok = await loginUser(app, dono.username, dono.password);
    leitor = await createUser(db, { username: U(), nome: 'Beto Leitor' });
    leitorTok = await loginUser(app, leitor.username, leitor.password);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('o dono sai como `owner` e cada membro com o nível da sua linha', async () => {
    const atlas = await createAtlas(db, dono.id, { name: `ONP ${U()}` });
    const editor = await createUser(db, { username: U(), nome: 'Caio Editor' });
    const gestor = await createUser(db, { username: U(), nome: 'Dora Gestora' });
    await createShare(db, atlas.id, editor.id, 'write', dono.id);
    await createShare(db, atlas.id, gestor.id, 'manage', dono.id);

    const c = await cartao(donoTok, atlas.id);
    assert.ok(c, 'premissa: o cartão do próprio atlas aparece');
    assert.equal(c.members.length, 3, 'dono + dois compartilhamentos');

    const porId = new Map(c.members.map((m) => [m.id, m.permission]));
    assert.equal(porId.get(dono.id), 'owner', 'o dono não tem linha de share e mesmo assim tem nível');
    assert.equal(porId.get(editor.id), 'write');
    assert.equal(porId.get(gestor.id), 'manage');
  });

  it('o LEITOR recebe os mesmos níveis (é isto que a decisão abriu)', async () => {
    // A DISCRIMINAÇÃO DESTE CASO é o par com a rota antiga: o mesmo Leitor continua levando 403 em
    // `GET /sharing`. Sem essa metade, o caso mediria apenas que a consulta devolve linhas.
    const atlas = await createAtlas(db, dono.id, { name: `ONP ${U()}` });
    const gestor = await createUser(db, { username: U(), nome: 'Dora Gestora' });
    await createShare(db, atlas.id, leitor.id, 'read', dono.id);
    await createShare(db, atlas.id, gestor.id, 'manage', dono.id);

    const c = await cartao(leitorTok, atlas.id);
    assert.ok(c, 'premissa: o leitor enxerga o cartão');
    assert.equal(c.members.length, 3);
    const porId = new Map(c.members.map((m) => [m.id, m.permission]));
    assert.equal(porId.get(dono.id), 'owner');
    assert.equal(porId.get(leitor.id), 'read', 'o próprio nível');
    assert.equal(porId.get(gestor.id), 'manage', 'e o do vizinho, que é o ponto da decisão');

    await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/sharing`)
      .set('Authorization', `Bearer ${leitorTok}`)
      .expect(403);
  });

  it('o nível é o EFETIVO: `manage` por grupo vence `read` nominal', async () => {
    // O CONTROLE NEGATIVO DESTE ARQUIVO. Com a COLUNA de `atlas_shares` no lugar de
    // `fn_user_atlas_shares`, este caso lê 'read' e todos os outros continuam verdes.
    const atlas = await createAtlas(db, dono.id, { name: `ONP ${U()}` });
    const duplo = await createUser(db, { username: U(), nome: 'Elza Dupla' });
    const g = await createAccessGroup(db, dono.id);
    await addAccessGroupMember(db, g.id, duplo.id, dono.id);
    await createShare(db, atlas.id, duplo.id, 'read', dono.id);
    await createGroupShare(db, atlas.id, g.id, 'manage', dono.id);

    const { rows } = await db.query(
      'SELECT permission FROM atlas_shares WHERE atlas_id = $1 AND user_id = $2',
      [atlas.id, duplo.id]
    );
    assert.equal(rows.length, 1, 'premissa: a linha nominal existe');
    assert.equal(rows[0].permission, 'read', 'premissa: e ela diz `read`');

    const c = await cartao(donoTok, atlas.id);
    assert.ok(c);
    const dela = c.members.find((m) => m.id === duplo.id);
    assert.ok(dela, 'a pessoa precisa estar na lista');
    assert.equal(dela.permission, 'manage', 'o cartão mostra o que o servidor aplica, não a coluna');
  });

  it('quem alcança SÓ por grupo aparece como pessoa, com o nível do coletivo', async () => {
    // O EIXO DE GRUPO JÁ ENTRAVA na lista (`fn_atlas_member_ids` expande o coletivo em pessoas),
    // e é isto que faz o cartão não MENTIR sobre quem alcança o atlas. O que ele não nomeia é o
    // grupo, e isso é decisão de composição, não omissão.
    const atlas = await createAtlas(db, dono.id, { name: `ONP ${U()}` });
    const soGrupo = await createUser(db, { username: U(), nome: 'Fábio Coletivo' });
    const g = await createAccessGroup(db, dono.id);
    await addAccessGroupMember(db, g.id, soGrupo.id, dono.id);
    await createGroupShare(db, atlas.id, g.id, 'comment', dono.id);

    const c = await cartao(donoTok, atlas.id);
    assert.ok(c);
    assert.equal(c.member_count, 2, 'o coletivo conta como as PESSOAS dele');
    const dele = c.members.find((m) => m.id === soGrupo.id);
    assert.ok(dele, 'quem entra por grupo precisa aparecer na lista de participantes');
    assert.equal(dele.permission, 'comment');
  });

  it('o corte de dez e o contador sobrevivem, e todo item cortado traz nível', async () => {
    const atlas = await createAtlas(db, dono.id, { name: `ONP ${U()}` });
    const membros = [];
    for (let i = 0; i < 12; i += 1) {
      // Nome com índice zero-padded: a ordenação da subconsulta é por `ord, nome`, e sem ordem
      // estável o corte devolveria um subconjunto diferente a cada rodada.
      const u = await createUser(db, { username: U(), nome: `Membro ${String(i).padStart(2, '0')}` });
      await createShare(db, atlas.id, u.id, 'read', dono.id);
      membros.push(u);
    }
    assert.equal(membros.length, 12, 'premissa: doze compartilhamentos criados');

    const c = await cartao(donoTok, atlas.id);
    assert.ok(c);
    assert.equal(c.member_count, 13, 'a contagem VERDADEIRA é o dono mais os doze');
    assert.equal(c.members.length, 10, 'e a lista continua cortada em dez');
    assert.equal(c.members[0].id, dono.id, 'o dono continua em primeiro lugar');

    const semNivel = c.members.filter((m) => !m.permission);
    assert.deepEqual(semNivel, [], 'nenhum item pode sair sem nível');
    const niveis = new Set(c.members.map((m) => m.permission));
    assert.deepEqual([...niveis].sort(), ['owner', 'read'], 'o dono e os nove leitores');
  });
});
