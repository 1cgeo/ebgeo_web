// Path: tests/integration/resource-grants-alcancabilidade.test.js
//
// PRESERVAÇÃO DE ALCANÇABILIDADE NA REVOGAÇÃO (decisão D3 do dono: "se B não caiu, D não
// deve cair").
//
// A poda deixou de ser "revogue tudo que pende" e passou a ser "revogue o que perdeu
// TODA autorização". Ao descer a subárvore, um filho cujo CONCEDENTE ainda tenha
// `view_share` vivo sobre o mesmo recurso, FORA do alcance da poda, é RE-PENDURADO nesse
// outro pai em vez de revogado — na mesma transação e no mesmo statement. O prazo dele é
// APARADO para o teto do pai novo (nunca esticado) e o aparo desce pela subárvore.
//
// O ARQUIVO IRMÃO É O PISO DESTE. `resource-grants-poda.test.js` mede a poda SEM resgate
// (nenhum ator dele tem segundo `view_share`) e NÃO pode precisar de edição por causa
// deste desenho: se precisar, o resgate está largo demais e o vermelho de lá é o
// diagnóstico, não um teste a ajustar.
//
// A PROPRIEDADE MAIS FRÁGIL DO DESENHO NÃO É A REGRA, É A DISJUNÇÃO. O statement tem
// TRÊS `UPDATE` numa transação só, e o Postgres não levanta erro quando duas CTEs
// modificadoras tocam a mesma linha: ele dá resultado imprevisível, sem mensagem
// nenhuma. A guarda contra isso é aritmética e está no caso da trilha — EXATAMENTE UMA
// linha de auditoria por concessão tocada, somando as três listas. Um nó que caia em dois
// conjuntos ganha duas linhas e o caso fica vermelho.
//
// D8(b) ENTRA AQUI, e não num arquivo próprio, porque é a MESMA semântica de queda vista
// por outro gatilho: desativar quem concedeu passou a derrubar o que ele concedeu, pela
// mesma cascata e com o mesmo resgate. O teste de um é o controle do outro.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, loginUser } from '../helpers/fixtures.js';

/**
 * As DUAS ações que uma poda pode escrever, como DOMÍNIO nomeado e não como hedge inline.
 *
 * A distinção importa porque `no-disjunctive-assert` passou a acusar `[a, b].includes(x)`
 * escrito na própria asserção: aquela forma quase sempre é alguém que não quis decidir entre
 * dois desfechos. Aqui os dois valores SÃO o domínio (todo nó tocado ou cai ou é repai-ado),
 * e o que a asserção prende é que a ação registrada é a do EFEITO e nunca a da causa
 * (`USER_DELETE`), que é conferida linha a linha logo acima.
 */
const ACOES_DE_EFEITO = ['PERMISSION_REVOKE', 'PERMISSION_REPARENT'];

describe('D3 — a poda preserva quem alcança o recurso por outro caminho', () => {
  let app, db;
  const sufixo = randomUUID().slice(0, 8);
  const atores = {};
  const tokens = {};
  const recursos = [];

  /** Um tileset PRIVADO novo, para isolar cada caso numa árvore própria. */
  async function novoTileset(nome) {
    const id = `alc-${nome}-${sufixo}`;
    await db.query(
      `INSERT INTO tilesets (id, name, config, sort_order, access_level)
       VALUES ($1, $2, '{"url":"/x"}'::jsonb, 0, 'private')`,
      [id, `Tileset ${nome} ${sufixo}`],
    );
    recursos.push(id);
    return id;
  }

  /** POST /grants como `quem`, devolvendo o corpo já desembrulhado. */
  async function conceder(quem, recurso, corpo, esperado = 201) {
    const res = await supertest(app)
      .post(`/api/v1/resource-access/tileset/${recurso}/grants`)
      .set('Authorization', `Bearer ${tokens[quem]}`)
      .send(corpo)
      .expect(esperado);
    return res.body.data;
  }

  /** DELETE /grants/:id como `quem`, devolvendo `{revoked, reparented, trimmed}`. */
  async function revogar(quem, grantId, esperado = 200) {
    const res = await supertest(app)
      .delete(`/api/v1/resource-access/grants/${grantId}`)
      .set('Authorization', `Bearer ${tokens[quem]}`)
      .expect(esperado);
    return res.body.data;
  }

  /** Os tilesets que este usuário enxerga (sem atlas em foco). */
  async function visiveis(quem) {
    const res = await supertest(app)
      .get('/api/v1/resource-access/visible')
      .set('Authorization', `Bearer ${tokens[quem]}`)
      .expect(200);
    return res.body.data.tilesets.map((t) => t.id);
  }

  /** A linha crua, para ler `parent_grant_id`/`expires_at`/`revoked_at` sem passar por rota. */
  async function linha(id) {
    const { rows } = await db.query(
      'SELECT id, parent_grant_id, expires_at, revoked_at FROM resource_grants WHERE id = $1',
      [id],
    );
    assert.equal(rows.length, 1, 'a linha precisa existir para ser medida');
    return rows[0];
  }

  const ids = (lista) => (lista ?? []).map((r) => r.id).sort();

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    for (const nome of ['admin', 'a', 'b', 'c', 'd', 'e', 'x', 'z', 'dono']) {
      atores[nome] = nome === 'admin'
        ? await createAdminUser(db, { username: `alc_admin_${sufixo}` })
        : await createUser(db, { username: `alc_${nome}_${sufixo}` });
      tokens[nome] = await loginUser(app, atores[nome].username, atores[nome].password);
    }
  });

  after(async () => {
    if (recursos.length > 0) {
      await db.query('DELETE FROM resource_grants WHERE resource_id = ANY($1::text[])', [recursos]);
      await db.query('DELETE FROM tilesets WHERE id = ANY($1::text[])', [recursos]);
    }
    await teardownTestEnv(db);
  });

  // -------------------------------------------------------------------------
  // O caso do dono
  // -------------------------------------------------------------------------

  it('o caso do dono: B tem view_share por DOIS caminhos, e revogar um NÃO derruba D', async () => {
    const r = await novoTileset('dono');

    const aB = await conceder('admin', r, { granteeId: atores.b.id, grantLevel: 'view_share' });
    // O SEGUNDO CAMINHO VEM DE OUTRO CONCEDENTE, e não é escolha de estilo: o mesmo
    // concedente repetindo a concessão leva 409 (`LIVE_GRANT_FROM_ACTOR_TO_GRANTEE`).
    // Dois caminhos só existem quando duas PESSOAS decidiram.
    await conceder('admin', r, { granteeId: atores.b.id, grantLevel: 'view_share' }, 409);
    await conceder('admin', r, { granteeId: atores.c.id, grantLevel: 'view_share' });
    const cB2 = await conceder('c', r, { granteeId: atores.b.id, grantLevel: 'view_share' });

    const bD = await conceder('b', r, { granteeId: atores.d.id, grantLevel: 'view' });

    // O PISO, em quatro medições e nenhuma suposição.
    assert.ok((await visiveis('d')).includes(r), 'piso 1: D vê o recurso');
    assert.equal(
      bD.parent_grant_id, aB.id,
      'piso 2: B→D pendura em A→B (o caminho que VAI cair). Sem isto o caso passaria trivialmente',
    );
    assert.ok((await visiveis('b')).includes(r), 'piso 3: B vê o recurso');
    const { rows: caminhosDeB } = await db.query(
      `SELECT id, granted_by FROM resource_grants
        WHERE resource_id = $1 AND grantee_id = $2 AND revoked_at IS NULL
          AND expires_at > NOW() AND grant_level = 'view_share'`,
      [r, atores.b.id],
    );
    assert.equal(caminhosDeB.length, 2, 'piso 4: B tem DOIS view_share vivos');
    assert.equal(
      new Set(caminhosDeB.map((l) => l.granted_by)).size, 2,
      'e eles vêm de concedentes DIFERENTES — é isso que os torna dois caminhos',
    );

    const podada = await revogar('admin', aB.id);

    assert.deepEqual(ids(podada.revoked), [aB.id], 'só a âncora cai');
    assert.deepEqual(ids(podada.reparented), [bD.id], 'e B→D é RESGATADO, não revogado');
    assert.deepEqual(podada.trimmed, [], 'nada a aparar: os dois caminhos nascem com o mesmo prazo');

    const depois = await linha(bD.id);
    assert.equal(depois.revoked_at, null, 'a concessão resgatada continua viva');
    assert.equal(depois.parent_grant_id, cB2.id, 'e passou a pendurar no caminho que sobreviveu');

    assert.ok((await visiveis('d')).includes(r), 'D continua vendo: "se B não caiu, D não deve cair"');
    assert.ok((await visiveis('b')).includes(r), 'e B também, pelo outro caminho');
  });

  it('DISCRIMINAÇÃO: com UM só caminho, a poda derruba como sempre derrubou', async () => {
    // O GÊMEO. Sem ele, um resgate que salvasse TUDO (ou uma poda que não podasse nada)
    // passaria verde no caso acima.
    const r = await novoTileset('gemeo');

    const aB = await conceder('admin', r, { granteeId: atores.b.id, grantLevel: 'view_share' });
    const bD = await conceder('b', r, { granteeId: atores.d.id, grantLevel: 'view' });
    assert.equal(bD.parent_grant_id, aB.id);
    assert.ok((await visiveis('d')).includes(r), 'piso: D vê');

    const podada = await revogar('admin', aB.id);
    assert.deepEqual(ids(podada.revoked), ids([aB, bD]), 'os dois caem');
    assert.deepEqual(podada.reparented, [], 'e nada é resgatado');
    assert.ok(!(await visiveis('d')).includes(r), 'D perde o acesso');
  });

  // -------------------------------------------------------------------------
  // A âncora
  // -------------------------------------------------------------------------

  it('a âncora NUNCA é resgatada, mesmo quando o beneficiário tem outro caminho vivo', async () => {
    const r = await novoTileset('ancora');

    const aB = await conceder('admin', r, { granteeId: atores.b.id, grantLevel: 'view_share' });
    await conceder('admin', r, { granteeId: atores.c.id, grantLevel: 'view_share' });
    const cB = await conceder('c', r, { granteeId: atores.b.id, grantLevel: 'view_share' });

    assert.ok(aB.id && cB.id && aB.id !== cB.id, 'piso: os dois caminhos existem');
    assert.ok((await visiveis('b')).includes(r), 'piso: B vê');

    const podada = await revogar('c', cB.id);
    assert.deepEqual(ids(podada.revoked), [cB.id], 'a revogação explícita SEMPRE tem efeito');
    assert.deepEqual(podada.reparented, [], 'a âncora não entra no resgate');

    // A segunda metade: uma poda larga demais também passaria na primeira.
    assert.ok((await visiveis('b')).includes(r), 'B continua vendo pelo caminho de A');

    // O QUE ESTE CASO **NÃO** PROVA, e vale mais escrito do que suposto. Rodei o controle
    // negativo: removendo `a.id <> $1` de `resgate` E o `pai_antigo IN podados` de
    // `salvos` — as duas travas que impedem o resgate da âncora — os 17 casos continuam
    // VERDES. O motivo é o mesmo acidente medido no caso da trilha: sem elas a âncora cai
    // em `podados` E em `salvos`, e o segundo `UPDATE` da mesma linha no mesmo statement
    // não a toca; hoje `revogados` vem primeiro e vence, então o comportamento observável
    // não muda. O manual do Postgres promete IMPREVISÍVEL, não "a primeira ganha", e por
    // isso as duas linhas ficam. O modo de falha que elas evitam é não-determinismo, e não
    // existe verde que o distinga do correto — este comentário é a única guarda que cabe.
    assert.ok(
      !(await visiveis('b')).includes('nao-existe'),
      'guarda de sanidade da leitura acima: `visiveis` não devolve id inventado',
    );
  });

  // -------------------------------------------------------------------------
  // O prazo
  // -------------------------------------------------------------------------

  /** ISO de uma data daqui a N dias, para o corpo do POST. */
  const emDias = (n) => new Date(Date.now() + n * 24 * 3600 * 1000).toISOString();
  const dias = (linhaGrant) => (linhaGrant.expires_at.getTime() - Date.now()) / (24 * 3600 * 1000);

  it('o prazo do pai novo é TETO: o filho encolhe, e nunca estica', async () => {
    const r = await novoTileset('prazo');

    const aB = await conceder('admin', r, { granteeId: atores.b.id, grantLevel: 'view_share' });
    await conceder('admin', r, { granteeId: atores.c.id, grantLevel: 'view_share' });
    const cB = await conceder('c', r, {
      granteeId: atores.b.id, grantLevel: 'view_share', expiresAt: emDias(1),
    });
    const bD = await conceder('b', r, { granteeId: atores.d.id, grantLevel: 'view' });

    const antes = await linha(bD.id);
    assert.ok(dias(antes) > 300, `piso: B→D nasce com o teto de um ano, e não com o de C→B (${dias(antes)} dias)`);

    await revogar('admin', aB.id);

    const depois = await linha(bD.id);
    const paiNovo = await linha(cB.id);
    assert.equal(depois.parent_grant_id, cB.id, 'piso do ato: o repai aconteceu');
    assert.ok(
      depois.expires_at.getTime() <= paiNovo.expires_at.getTime(),
      'o filho não pode viver mais que o pai novo',
    );
    assert.ok(
      depois.expires_at.getTime() > Date.now(),
      'e não pode nascer morto: o CHECK `expires_at > created_at` continua valendo',
    );
  });

  it('DISCRIMINAÇÃO do prazo: pai novo mais LONGO que o filho não estica o filho', async () => {
    // Sem este gêmeo, um `SET expires_at = pai.expires_at` (que ESTICA) passaria verde
    // no caso acima, porque lá o pai novo é mais curto.
    const r = await novoTileset('prazo-longo');

    const aB = await conceder('admin', r, { granteeId: atores.b.id, grantLevel: 'view_share' });
    await conceder('admin', r, { granteeId: atores.c.id, grantLevel: 'view_share' });
    const cB = await conceder('c', r, { granteeId: atores.b.id, grantLevel: 'view_share' });
    const bD = await conceder('b', r, {
      granteeId: atores.d.id, grantLevel: 'view', expiresAt: emDias(5),
    });

    const antes = await linha(bD.id);
    assert.ok(dias(antes) < 10, 'piso: o filho é o CURTO desta vez');
    assert.ok(dias(await linha(cB.id)) > 300, 'piso: e o pai novo é o longo');

    const podada = await revogar('admin', aB.id);
    assert.deepEqual(ids(podada.reparented), [bD.id], 'piso do ato: o repai aconteceu');
    assert.deepEqual(podada.trimmed, [], 'e nada foi aparado');

    const depois = await linha(bD.id);
    assert.equal(
      depois.expires_at.getTime(), antes.expires_at.getTime(),
      'o prazo do filho fica IDÊNTICO: o repai apara, nunca estica',
    );
  });

  it('o aparo de prazo DESCE pela subárvore do resgatado, e só o prazo desce', async () => {
    // O ÚNICO CASO QUE PRENDE a invariante "filho não vive mais que o pai" FORA do
    // INSERT. Até esta fase ela era garantida só pelo `LEAST` do INSERT.
    const r = await novoTileset('cascata');

    const aB = await conceder('admin', r, { granteeId: atores.b.id, grantLevel: 'view_share' });
    await conceder('admin', r, { granteeId: atores.c.id, grantLevel: 'view_share' });
    const cB = await conceder('c', r, {
      granteeId: atores.b.id, grantLevel: 'view_share', expiresAt: emDias(1),
    });
    const bD = await conceder('b', r, { granteeId: atores.d.id, grantLevel: 'view_share' });
    const dE = await conceder('d', r, { granteeId: atores.e.id, grantLevel: 'view' });

    const antesE = await linha(dE.id);
    assert.ok(dias(antesE) > 300, 'piso: E nasce com um ano');
    assert.equal(antesE.parent_grant_id, bD.id, 'piso: E pendura em B→D');

    const podada = await revogar('admin', aB.id);
    assert.deepEqual(ids(podada.reparented), [bD.id], 'só a FRONTEIRA muda de pai');
    assert.deepEqual(ids(podada.trimmed), [dE.id], 'e o neto só tem o prazo aparado');

    const depoisE = await linha(dE.id);
    const paiNovo = await linha(cB.id);
    assert.ok(
      depoisE.expires_at.getTime() <= paiNovo.expires_at.getTime(),
      'o teto do pai novo desceu até o neto',
    );
    assert.equal(
      depoisE.parent_grant_id, bD.id,
      'e o pai do neto NÃO mudou: o repai é só na fronteira, o aparo é que desce',
    );
    assert.equal(depoisE.revoked_at, null, 'o neto continua vivo');
    assert.ok((await visiveis('e')).includes(r), 'e continua vendo');
  });

  it('DISCRIMINAÇÃO da cascata: pai novo mais longo não apara neto nenhum', async () => {
    // Sem este par, um aparo INCONDICIONAL (que reescrevesse o prazo do neto sempre)
    // passaria verde no caso acima.
    const r = await novoTileset('cascata-longa');

    const aB = await conceder('admin', r, { granteeId: atores.b.id, grantLevel: 'view_share' });
    await conceder('admin', r, { granteeId: atores.c.id, grantLevel: 'view_share' });
    await conceder('c', r, { granteeId: atores.b.id, grantLevel: 'view_share' });
    const bD = await conceder('b', r, { granteeId: atores.d.id, grantLevel: 'view_share' });
    const dE = await conceder('d', r, { granteeId: atores.e.id, grantLevel: 'view' });

    const antesE = await linha(dE.id);
    const podada = await revogar('admin', aB.id);
    assert.deepEqual(ids(podada.reparented), [bD.id], 'piso do ato: houve repai');
    assert.deepEqual(podada.trimmed, [], 'e NADA foi aparado');
    assert.equal(
      (await linha(dE.id)).expires_at.getTime(), antesE.expires_at.getTime(),
      'o prazo do neto fica byte a byte igual',
    );
  });

  // -------------------------------------------------------------------------
  // O braço de GRUPO
  // -------------------------------------------------------------------------

  /** Um grupo vivo de `dono`, com os membros pedidos. */
  async function novoGrupo(nome, membros) {
    const res = await supertest(app)
      .post('/api/v1/access-groups')
      .set('Authorization', `Bearer ${tokens.dono}`)
      .send({ name: `Alc ${nome} ${sufixo}` })
      .expect(201);
    const grupo = res.body.data;
    for (const m of membros) {
      await supertest(app)
        .post(`/api/v1/access-groups/${grupo.id}/members`)
        .set('Authorization', `Bearer ${tokens.dono}`)
        .send({ userId: atores[m].id })
        .expect(200);
    }
    return grupo;
  }

  it('o resgate atravessa GRUPO: o segundo view_share de B chega por um coletivo', async () => {
    const r = await novoTileset('grupo');
    const grupo = await novoGrupo('grupo', ['b']);

    const aB = await conceder('admin', r, { granteeId: atores.b.id, grantLevel: 'view_share' });
    const xG = await conceder('admin', r, { granteeGroupId: grupo.id, grantLevel: 'view_share' });
    const bD = await conceder('b', r, { granteeId: atores.d.id, grantLevel: 'view' });

    assert.equal(bD.parent_grant_id, aB.id, 'piso: o pai de D é A→B');
    assert.ok((await visiveis('d')).includes(r), 'piso: D vê');

    const podada = await revogar('admin', aB.id);
    assert.deepEqual(ids(podada.reparented), [bD.id], 'B é alcançado pelo grupo, então D é resgatado');
    assert.equal((await linha(bD.id)).parent_grant_id, xG.id, 'e o pai novo é a concessão AO GRUPO');
    assert.ok((await visiveis('d')).includes(r), 'D continua vendo');
  });

  it('DISCRIMINAÇÃO do grupo: fora do grupo, ou com o grupo apagado, D cai', async () => {
    // OS DOIS GÊMEOS JUNTOS prendem exatamente o braço `fn_user_group_ids` e o
    // `deleted_at IS NULL` que mora dentro dele: sem o braço, o caso acima fica
    // vermelho; se ele ignorasse a composição ou a vida do grupo, estes ficam.

    // (a) B foi REMOVIDO do grupo antes do ato.
    const r1 = await novoTileset('grupo-sem-membro');
    const grupo1 = await novoGrupo('sem-membro', ['b']);
    const aB1 = await conceder('admin', r1, { granteeId: atores.b.id, grantLevel: 'view_share' });
    await conceder('admin', r1, { granteeGroupId: grupo1.id, grantLevel: 'view_share' });
    const bD1 = await conceder('b', r1, { granteeId: atores.d.id, grantLevel: 'view' });
    assert.ok((await visiveis('d')).includes(r1), 'piso: D vê');

    await supertest(app)
      .delete(`/api/v1/access-groups/${grupo1.id}/members/${atores.b.id}`)
      .set('Authorization', `Bearer ${tokens.dono}`)
      .expect(200);

    const podada1 = await revogar('admin', aB1.id);
    assert.deepEqual(podada1.reparented, [], 'sem pertencer ao grupo, não há segundo caminho');
    assert.deepEqual(ids(podada1.revoked), ids([aB1, bD1]), 'os dois caem');
    assert.ok(!(await visiveis('d')).includes(r1), 'D perde o acesso');

    // (b) o grupo foi APAGADO antes do ato.
    const r2 = await novoTileset('grupo-apagado');
    const grupo2 = await novoGrupo('apagado', ['b']);
    const aB2 = await conceder('admin', r2, { granteeId: atores.b.id, grantLevel: 'view_share' });
    await conceder('admin', r2, { granteeGroupId: grupo2.id, grantLevel: 'view_share' });
    const bD2 = await conceder('b', r2, { granteeId: atores.d.id, grantLevel: 'view' });
    assert.ok((await visiveis('d')).includes(r2), 'piso: D vê');

    await supertest(app)
      .delete(`/api/v1/access-groups/${grupo2.id}`)
      .set('Authorization', `Bearer ${tokens.dono}`)
      .expect(200);

    const podada2 = await revogar('admin', aB2.id);
    assert.deepEqual(podada2.reparented, [], 'grupo apagado não concede, logo não resgata');
    assert.ok(ids(podada2.revoked).includes(bD2.id), 'e o repasse cai junto');
    assert.ok(!(await visiveis('d')).includes(r2), 'D perde o acesso');
  });

  // -------------------------------------------------------------------------
  // O que NÃO serve de pai alternativo
  // -------------------------------------------------------------------------

  it('o pai alternativo precisa ser view_share VIVO, NÃO VENCIDO e de concedente VIVO', async () => {
    // CINCO PARES GÊMEOS. Nos casos (i), (ii), (iii) e (v) D CAI; no (iv) D FICA. Sem o
    // controle positivo, os negativos seriam indistinguíveis de um resgate que nunca
    // acontece; sem os negativos, um resgate que aceita qualquer linha da tabela passaria.
    //
    // O (v) FOI ACRESCENTADO DEPOIS DE UMA REVISÃO ADVERSARIAL, e a lição é do tipo que a
    // constituição chama de cobertura vazia: este caso já se CHAMAVA "de concedente VIVO"
    // e nenhum dos quatro sub-casos tinha concedente morto. Medido: neutralizando o termo
    // `fn_principal_vivo(p.granted_by)` do resgate, a suíte inteira do backend (3311
    // casos) continuava VERDE. O terço do título era prosa.
    //
    // ELE PRECISA MATAR A **OM**, E NÃO A CONTA, e essa escolha é o caso inteiro:
    // desativar a conta dispara `podarConcessoesDeQuemFoiDesativado`, que REVOGA a linha
    // — e aí o caso passaria pelo motivo (iii), que já está coberto, sem tocar no termo
    // novo. Desativar a OM esconde sem revogar, que é exatamente o estado em que a linha
    // continua na tabela e não pode servir de pai.
    const cenario = async (nome, prepararSegundoCaminho) => {
      const r = await novoTileset(nome);
      const aB = await conceder('admin', r, { granteeId: atores.b.id, grantLevel: 'view_share' });
      await prepararSegundoCaminho(r);
      const bD = await conceder('b', r, { granteeId: atores.d.id, grantLevel: 'view' });
      assert.equal(bD.parent_grant_id, aB.id, `piso (${nome}): o pai de D é A→B`);
      assert.ok((await visiveis('d')).includes(r), `piso (${nome}): D vê`);
      return { r, aB, bD, podada: await revogar('admin', aB.id) };
    };

    // (i) o segundo caminho é `view`, não `view_share`.
    {
      const { bD, podada } = await cenario('nivel', async (r) => {
        await conceder('admin', r, { granteeId: atores.c.id, grantLevel: 'view_share' });
        await conceder('c', r, { granteeId: atores.b.id, grantLevel: 'view' });
      });
      assert.deepEqual(podada.reparented, [], '`view` não autoriza repassar, logo não sustenta repasse');
      assert.ok(ids(podada.revoked).includes(bD.id));
    }

    // (ii) o segundo caminho está VENCIDO (INSERT cru, a forma que `008_acesso_a_recurso.sql`
    //      declara existir por extenso: os testes de função escrevem direto na tabela).
    {
      const { bD, podada } = await cenario('vencido', async (r) => {
        await db.query(
          `INSERT INTO resource_grants
             (resource_type, resource_id, grantee_id, grant_level, granted_by, created_at, expires_at)
           VALUES ('tileset', $1, $2, 'view_share', $3, NOW() - INTERVAL '10 days', NOW() - INTERVAL '1 day')`,
          [r, atores.b.id, atores.c.id],
        );
      });
      assert.deepEqual(podada.reparented, [], 'concessão vencida não resgata: a morte mora no predicado');
      assert.ok(ids(podada.revoked).includes(bD.id));
    }

    // (iii) o segundo caminho já foi REVOGADO.
    {
      const { bD, podada } = await cenario('revogado', async (r) => {
        await conceder('admin', r, { granteeId: atores.c.id, grantLevel: 'view_share' });
        const cB = await conceder('c', r, { granteeId: atores.b.id, grantLevel: 'view_share' });
        await revogar('c', cB.id);
      });
      assert.deepEqual(podada.reparented, [], 'concessão revogada não resgata');
      assert.ok(ids(podada.revoked).includes(bD.id));
    }

    // (iv) o CONTROLE POSITIVO: vivo, futuro e `view_share`.
    {
      const { bD, podada } = await cenario('vivo', async (r) => {
        await conceder('admin', r, { granteeId: atores.c.id, grantLevel: 'view_share' });
        await conceder('c', r, { granteeId: atores.b.id, grantLevel: 'view_share' });
      });
      assert.deepEqual(ids(podada.reparented), [bD.id], 'e com o caminho VIVO, D é resgatado');
    }

    // (v) o segundo caminho tem CONCEDENTE MORTO: a OM dele foi desativada. A linha
    //     continua viva na tabela e na listagem, e mesmo assim não sustenta ninguém.
    {
      const { rows: orgs } = await db.query(
        `INSERT INTO organizations (nome, slug, sigla, is_active)
         VALUES ($1, $2, $3, true) RETURNING id`,
        [`Alc Morto ${sufixo}`, `alc-morto-${sufixo}`, `AMT${sufixo.slice(0, 4)}`],
      );
      const org = orgs[0].id;
      const morto = await createUser(db, { username: `alc_morto_${sufixo}` });
      await db.query('UPDATE users SET organization_id = $1 WHERE id = $2', [org, morto.id]);

      let idAlternativo = null;
      const { r, bD, podada } = await cenario('concedente-morto', async (rec) => {
        // O concedente recebe `view_share` do admin e dá `view_share` a B — o segundo
        // caminho. Por INSERT cru porque ele precisa existir ANTES de a OM morrer, e a
        // rota exigiria um login que a desativação depois invalidaria.
        const { rows: raiz } = await db.query(
          `INSERT INTO resource_grants (resource_type, resource_id, grantee_id, grant_level, granted_by)
           VALUES ('tileset', $1, $2, 'view_share', $3) RETURNING id`,
          [rec, morto.id, atores.admin.id],
        );
        const { rows: alt } = await db.query(
          `INSERT INTO resource_grants
             (resource_type, resource_id, grantee_id, grant_level, granted_by, parent_grant_id)
           VALUES ('tileset', $1, $2, 'view_share', $3, $4) RETURNING id`,
          [rec, atores.b.id, morto.id, raiz[0].id],
        );
        idAlternativo = alt[0].id;
        // PISO DO SUB-CASO: com a OM VIVA, esta linha é um pai alternativo legítimo.
        // Sem esta asserção, o vazio abaixo poderia vir de uma montagem que nunca
        // qualificou, e o caso mediria a própria fixture em vez do predicado.
        const { rows: viva } = await db.query(
          `SELECT fn_principal_vivo($1) AS vivo`, [morto.id],
        );
        assert.equal(viva[0].vivo, true, 'piso: antes de matar a OM, o concedente está VIVO');

        await db.query('UPDATE organizations SET is_active = false WHERE id = $1', [org]);
      });

      assert.equal(
        (await linha(idAlternativo)).revoked_at, null,
        'guarda: o segundo caminho NÃO foi revogado — quem o desqualifica é a vida do concedente',
      );
      assert.deepEqual(
        podada.reparented, [],
        'concedente morto não sustenta repasse: a autoridade morre com quem a exercia',
      );
      assert.ok(ids(podada.revoked).includes(bD.id), 'e o repasse cai');
      assert.ok(!(await visiveis('d')).includes(r), 'D perde o acesso de fato');

      await db.query('DELETE FROM resource_grants WHERE resource_id = $1', [r]);
      await db.query('UPDATE users SET organization_id = NULL WHERE id = $1', [morto.id]);
      await db.query('DELETE FROM organizations WHERE id = $1', [org]);
    }
  });

  it('o pai novo é o de MAIOR prazo, e é isso que minimiza o aparo', async () => {
    // A DECISÃO (6) DO SQL (`ORDER BY p.expires_at DESC`) não tinha teste nenhum: em todos
    // os outros casos existe UM só candidato a pai alternativo, então o `ORDER BY` nunca
    // desempata nada. Medido numa revisão adversarial: trocando `DESC` por `ASC`, a suíte
    // inteira do backend continuava verde. A propriedade que decide QUANTO acesso de
    // terceiro é encurtado estava sem verificador.
    const r = await novoTileset('maior-prazo');

    const aB = await conceder('admin', r, { granteeId: atores.b.id, grantLevel: 'view_share' });
    // DOIS candidatos a pai alternativo para B, de prazos deliberadamente distantes.
    await conceder('admin', r, { granteeId: atores.c.id, grantLevel: 'view_share' });
    await conceder('admin', r, { granteeId: atores.x.id, grantLevel: 'view_share' });
    const curto = await conceder('c', r, {
      granteeId: atores.b.id, grantLevel: 'view_share', expiresAt: emDias(1),
    });
    const longo = await conceder('x', r, {
      granteeId: atores.b.id, grantLevel: 'view_share', expiresAt: emDias(300),
    });
    // O REPASSE E O NETO NASCEM COM PRAZO DE 10 DIAS, e o número não é decorativo: ele
    // precisa ficar ENTRE os dois candidatos. Com o teto de um ano no `expiresAt`, um
    // repasse de prazo default (1 ano) seria aparado pelos DOIS candidatos, e o caso
    // deixaria de discriminar — foi o que a primeira versão deste teste fez, e o vermelho
    // dela é o que trouxe o número para cá.
    const bD = await conceder('b', r, {
      granteeId: atores.d.id, grantLevel: 'view_share', expiresAt: emDias(10),
    });
    const dE = await conceder('d', r, {
      granteeId: atores.e.id, grantLevel: 'view', expiresAt: emDias(10),
    });

    assert.equal(bD.parent_grant_id, aB.id, 'piso: o repasse pendura na raiz que vai cair');
    assert.ok(dias(await linha(bD.id)) > 9, 'piso: e nasce com os 10 dias pedidos');

    const podada = await revogar('admin', aB.id);

    assert.deepEqual(ids(podada.reparented), [bD.id], 'o repasse é resgatado');
    assert.equal(
      (await linha(bD.id)).parent_grant_id, longo.id,
      'e o pai novo é o de MAIOR prazo, não o mais antigo nem o primeiro da tabela',
    );

    // A DISCRIMINAÇÃO, e é ela que dá dentes: com o LONGO (300 dias) escolhido, o filho de
    // 10 dias não é aparado e o neto tampouco. Se o CURTO (1 dia) fosse escolhido, o filho
    // cairia para 1 dia e o neto apareceria em `trimmed`. Sem esta metade, um `ORDER BY`
    // qualquer que por acaso devolvesse o longo passaria verde.
    assert.deepEqual(podada.trimmed, [], 'o pai de maior prazo não apara ninguém');
    assert.ok(dias(await linha(bD.id)) > 9, 'o repasse mantém os 10 dias');
    assert.ok(dias(await linha(dE.id)) > 9, 'e o neto mantém o prazo que tinha');
    assert.ok(
      dias(await linha(curto.id)) < 2,
      'guarda da montagem: o candidato CURTO existia mesmo, e vencia bem antes',
    );
  });

  // -------------------------------------------------------------------------
  // O pai alternativo DENTRO da poda, e a aciclicidade medida
  // -------------------------------------------------------------------------

  /** Nenhuma cadeia de `parent_grant_id` revisita um id. Aciclicidade MEDIDA. */
  async function assertSemCiclo(recurso) {
    const { rows } = await db.query(
      'SELECT id, parent_grant_id FROM resource_grants WHERE resource_id = $1 AND revoked_at IS NULL',
      [recurso],
    );
    assert.ok(rows.length > 0, 'guarda: a varredura precisa ter o que percorrer');
    const paiDe = new Map(rows.map((l) => [String(l.id), l.parent_grant_id && String(l.parent_grant_id)]));
    assert.ok(paiDe.size > 0, 'guarda: o laço abaixo precisa ter cadeia para percorrer');
    for (const [inicio] of paiDe) {
      const vistos = new Set([inicio]);
      let atual = paiDe.get(inicio);
      while (atual) {
        assert.ok(!vistos.has(atual), `ciclo na cadeia de pais a partir de ${inicio}`);
        vistos.add(atual);
        atual = paiDe.get(atual) ?? null;
      }
    }
  }

  it('o pai alternativo DENTRO da poda não resgata ninguém, e nenhum ciclo nasce', async () => {
    const r = await novoTileset('dentro');

    const adminA = await conceder('admin', r, { granteeId: atores.a.id, grantLevel: 'view_share' });
    const aB = await conceder('a', r, { granteeId: atores.b.id, grantLevel: 'view_share' });
    const bC = await conceder('b', r, { granteeId: atores.c.id, grantLevel: 'view_share' });
    const cB = await conceder('c', r, { granteeId: atores.b.id, grantLevel: 'view_share' });

    assert.equal(cB.parent_grant_id, bC.id, 'piso: o candidato a pai é mesmo DESCENDENTE da poda');
    const { rows: vivas } = await db.query(
      'SELECT id FROM resource_grants WHERE resource_id = $1 AND revoked_at IS NULL', [r],
    );
    assert.equal(vivas.length, 4, 'piso: os quatro estão vivos');

    const podada = await revogar('admin', adminA.id);
    assert.deepEqual(podada.reparented, [], 'um pai dentro da poda seria ponto fixo: o resgate recusa');
    assert.deepEqual(ids(podada.revoked), ids([adminA, aB, bC, cB]), 'e os quatro caem');
  });

  it('com um pai alternativo de FORA, o mesmo desenho resgata — e a árvore continua acíclica', async () => {
    const r = await novoTileset('fora');

    const adminA = await conceder('admin', r, { granteeId: atores.a.id, grantLevel: 'view_share' });
    const aB = await conceder('a', r, { granteeId: atores.b.id, grantLevel: 'view_share' });
    const bC = await conceder('b', r, { granteeId: atores.c.id, grantLevel: 'view_share' });
    // O X→B de FORA da subárvore: X recebeu do admin, em raiz própria.
    await conceder('admin', r, { granteeId: atores.x.id, grantLevel: 'view_share' });
    const xB = await conceder('x', r, { granteeId: atores.b.id, grantLevel: 'view_share' });

    assert.equal(aB.parent_grant_id, adminA.id, 'piso: A→B pendura na raiz que vai cair');
    assert.equal(bC.parent_grant_id, aB.id, 'piso: B→C pendura em A→B');

    const podada = await revogar('admin', adminA.id);
    assert.deepEqual(ids(podada.reparented), [bC.id], 'B→C é resgatado no X→B, que está fora da poda');
    assert.equal((await linha(bC.id)).parent_grant_id, xB.id, 'e a aresta nova aponta para lá');

    // A ACICLICIDADE MEDIDA, e não afirmada. Esta é a primeira escrita de
    // `parent_grant_id` fora do INSERT, então o argumento antigo caiu.
    await assertSemCiclo(r);
  });

  // -------------------------------------------------------------------------
  // O teto de 32
  // -------------------------------------------------------------------------

  /**
   * Uma cadeia de `n` elos por INSERT cru, cada elo concedido pelo beneficiário do
   * anterior, mais um pai alternativo VIVO e de FORA para o beneficiário do elo do meio.
   * Devolve os ids da cadeia, da raiz para a folha.
   */
  async function cadeia(recurso, n, pessoas) {
    const elos = [];
    let pai = null;
    for (let i = 0; i < n; i += 1) {
      const { rows } = await db.query(
        `INSERT INTO resource_grants
           (resource_type, resource_id, grantee_id, grant_level, granted_by, parent_grant_id)
         VALUES ('tileset', $1, $2, 'view_share', $3, $4) RETURNING id`,
        [recurso, pessoas[i + 1].id, pessoas[i].id, pai],
      );
      elos.push(rows[0].id);
      pai = rows[0].id;
    }
    return elos;
  }

  it('o teto de 32 é fail-closed para o RESGATE e fail-OPEN para a PODA', async () => {
    // O RESGATE SÓ É SEGURO ENQUANTO `alcance` CONTÉM TODOS OS DESCENDENTES. Truncada a
    // travessia, a prova de aciclicidade deixa de valer, e o resgate degrada para o
    // comportamento anterior (revogar), que é o lado fechado.
    //
    // O NOME DESTE CASO DIZIA SÓ "fail-closed" E ISSO ERA METADE DO FATO, apontando para o
    // lado errado. O único assert do braço (a) media o que NÃO foi resgatado e nada media
    // o que caiu; instrumentado numa revisão adversarial, o que se viu foi: numa cadeia de
    // 33 elos a poda derruba 32 e DEIXA O 33º VIVO, pendurado num pai já revogado. Como
    // `fn_granted_resource_ids` nunca sobe a cadeia de `parent_grant_id`, essa pessoa
    // segue com acesso depois de a raiz inteira ter caído — fail-OPEN.
    //
    // ISSO É HERDADO, NÃO REGRESSÃO: a `REVOKE_GRANT_SUBTREE` anterior tinha o mesmo teto.
    // Fica MEDIDO aqui em vez de escondido, porque um caso chamado "fail-closed" ao lado
    // de um desfecho aberto é documentação que engana. O conserto não é aumentar o teto (a
    // cadeia seguinte teria 34): é a poda devolver `truncado` e o serviço recusar ou
    // reenfileirar, o que é decisão do dono.
    const pessoas = [];
    for (let i = 0; i <= 34; i += 1) {
      pessoas.push(await createUser(db, { username: `alc_len_${i}_${sufixo}` }));
    }

    // (a) A CADEIA LONGA: 33 elos.
    const rLongo = await novoTileset('teto-longo');
    const longa = await cadeia(rLongo, 33, pessoas);
    const meioLongo = 16;
    // O pai alternativo do beneficiário do elo do meio, de fora da cadeia.
    await db.query(
      `INSERT INTO resource_grants
         (resource_type, resource_id, grantee_id, grant_level, granted_by)
       VALUES ('tileset', $1, $2, 'view_share', $3)`,
      [rLongo, pessoas[meioLongo].id, atores.admin.id],
    );
    const { rows: contagem } = await db.query(
      'SELECT COUNT(*)::int AS n FROM resource_grants WHERE resource_id = $1 AND revoked_at IS NULL',
      [rLongo],
    );
    assert.equal(contagem[0].n, 34, 'piso: 33 elos vivos mais o pai alternativo');

    const longoPodado = await revogar('admin', longa[0]);
    assert.deepEqual(
      longoPodado.reparented, [],
      'travessia truncada desliga o resgate: fail-closed',
    );

    // E O QUE ELA FAZ COM A PODA, dito por extenso em vez de deixado fora do quadro.
    assert.equal(
      longoPodado.revoked.length, 32,
      'a poda TAMBÉM trunca em 32: dos 33 elos, 32 caem',
    );
    assert.equal(
      (await linha(longa[32])).revoked_at, null,
      'e o 33º elo SOBREVIVE pendurado num pai revogado — o teto é fail-OPEN para a poda, '
      + 'porque o predicado de leitura não sobe a cadeia de pais',
    );
    // A CONSEQUÊNCIA REAL, medida na porta e não na tabela: o beneficiário do 33º elo
    // continua enxergando o recurso depois de a raiz inteira ter sido revogada. É o que
    // torna esta linha um fato de produto, e não uma curiosidade de CTE.
    const tokenSobrevivente = await loginUser(
      app, pessoas[33].username, pessoas[33].password,
    );
    const vistos = await supertest(app)
      .get('/api/v1/resource-access/visible')
      .set('Authorization', `Bearer ${tokenSobrevivente}`)
      .expect(200);
    assert.ok(
      vistos.body.data.tilesets.map((t) => t.id).includes(rLongo),
      'o beneficiário do elo além do teto continua VENDO o recurso: buraco conhecido e herdado',
    );

    // (b) O CONTROLE: a MESMA montagem com 3 elos resgata o mesmo nó do meio.
    const rCurto = await novoTileset('teto-curto');
    const curta = await cadeia(rCurto, 3, pessoas);
    await db.query(
      `INSERT INTO resource_grants
         (resource_type, resource_id, grantee_id, grant_level, granted_by)
       VALUES ('tileset', $1, $2, 'view_share', $3)`,
      [rCurto, pessoas[1].id, atores.admin.id],
    );
    const curtoPodado = await revogar('admin', curta[0]);
    assert.deepEqual(
      ids(curtoPodado.reparented), [curta[1]],
      'sem o truncamento, o mesmo desenho resgata — logo o vazio acima é o teto, não a montagem',
    );
  });

  // -------------------------------------------------------------------------
  // A trilha, e a guarda da DISJUNÇÃO
  // -------------------------------------------------------------------------

  it('a trilha explica quem MANTEVE o acesso, e uma linha por concessão tocada', async () => {
    const r = await novoTileset('trilha');

    const aB = await conceder('admin', r, { granteeId: atores.b.id, grantLevel: 'view_share' });
    await conceder('admin', r, { granteeId: atores.c.id, grantLevel: 'view_share' });
    await conceder('c', r, {
      granteeId: atores.b.id, grantLevel: 'view_share', expiresAt: emDias(2),
    });
    const bD = await conceder('b', r, { granteeId: atores.d.id, grantLevel: 'view_share' });
    const dE = await conceder('d', r, { granteeId: atores.e.id, grantLevel: 'view' });

    const { rows: zero } = await db.query(
      "SELECT COUNT(*)::int AS n FROM audit_trail WHERE details->>'rootGrantId' = $1", [aB.id],
    );
    assert.equal(zero[0].n, 0, 'piso: nenhuma linha de trilha para esta raiz antes do ato');

    const podada = await revogar('admin', aB.id);

    const { rows: trilha } = await db.query(
      `SELECT action, target_type, target_id, details FROM audit_trail
        WHERE details->>'rootGrantId' = $1`,
      [aB.id],
    );

    // A CLASSIFICAÇÃO É QUEM PRENDE A DISJUNÇÃO, e não a contagem — MEDIDO, e o contrário
    // do que o plano supunha. Os três `UPDATE` do statement só são legais porque os
    // conjuntos são disjuntos, e o Postgres não levanta erro quando não são: ele dá
    // resultado imprevisível. O plano propunha como guarda "exatamente uma linha de trilha
    // por concessão tocada, somando as três listas". Rodei o controle negativo (remover o
    // `NOT EXISTS (... resgate ...)` do braço recursivo de `podados`, que põe o mesmo id em
    // `podados` E em `salvos`) e MEDI o que acontece: `{rev:3, rep:0, tri:0, trilha:3}`
    // contra `{rev:1, rep:1, tri:1, trilha:3}` com o fix. Ou seja o segundo `UPDATE` da
    // mesma linha, no mesmo statement, não a toca e não a devolve no RETURNING — a
    // aritmética fica IDÊNTICA e o que muda é em qual lista cada id aparece. As três
    // igualdades abaixo são, portanto, a guarda com dentes, e vêm primeiro.
    assert.deepEqual(ids(podada.revoked), [aB.id], 'só a âncora perde acesso');
    assert.deepEqual(ids(podada.reparented), [bD.id], 'o filho MUDA DE ORIGEM, não cai');
    assert.deepEqual(ids(podada.trimmed), [dE.id], 'e o neto só herda o teto de prazo');

    // A contagem FICA, porque ela pega a outra forma da mesma falha: um desenho em que os
    // dois UPDATEs devolvessem a linha (por exemplo trocando um deles por escrita em duas
    // passadas) daria duplicata aqui e passaria nas três igualdades acima.
    const tocadas = [...podada.revoked, ...podada.reparented, ...podada.trimmed].map((l) => l.id);
    assert.equal(
      tocadas.length, new Set(tocadas).size,
      'nenhuma concessão pode aparecer em duas das três listas: os conjuntos escritos são DISJUNTOS',
    );
    assert.equal(
      trilha.length, tocadas.length,
      'EXATAMENTE uma linha de trilha por concessão tocada, somando as três listas',
    );
    const porGrant = new Map(trilha.map((l) => [l.details.grantId, l]));
    assert.equal(porGrant.size, trilha.length, 'e nenhum grantId repetido entre as linhas');

    assert.equal(porGrant.get(aB.id).action, 'PERMISSION_REVOKE');
    assert.equal(porGrant.get(bD.id).action, 'PERMISSION_REPARENT');
    assert.equal(porGrant.get(bD.id).details.kind, 'reparent');
    assert.equal(porGrant.get(dE.id).action, 'PERMISSION_REPARENT');
    assert.equal(porGrant.get(dE.id).details.kind, 'prazo_herdado');

    for (const l of trilha) {
      assert.equal(l.target_type, 'TILESET', 'o alvo é o RECURSO, igual ao par grant/revoke');
      assert.equal(l.target_id, r);
    }

    // O CONTROLE que pega o erro fácil (emitir as duas ações para o mesmo sujeito):
    // quem foi resgatado NÃO pode aparecer numa linha de revogação da mesma poda.
    const revogados = trilha.filter((l) => l.action === 'PERMISSION_REVOKE');
    const beneficiariosRevogados = revogados.map((l) => l.details.granteeId);
    assert.ok(
      !beneficiariosRevogados.includes(atores.d.id),
      'o beneficiário resgatado não aparece em nenhum PERMISSION_REVOKE desta raiz',
    );
    assert.ok(
      !beneficiariosRevogados.includes(atores.e.id),
      'nem o que teve só o prazo aparado',
    );

    // E o repai é RASTREÁVEL: a linha diz de onde para onde.
    const repai = porGrant.get(bD.id).details;
    assert.equal(repai.parentGrantIdAnterior, aB.id, 'de onde saiu');
    assert.ok(repai.parentGrantId && repai.parentGrantId !== aB.id, 'e para onde foi');
  });

  it('revogar duas vezes não repai-a duas vezes', async () => {
    const r = await novoTileset('idempotente');

    const aB = await conceder('admin', r, { granteeId: atores.b.id, grantLevel: 'view_share' });
    await conceder('admin', r, { granteeId: atores.c.id, grantLevel: 'view_share' });
    await conceder('c', r, {
      granteeId: atores.b.id, grantLevel: 'view_share', expiresAt: emDias(3),
    });
    const bD = await conceder('b', r, { granteeId: atores.d.id, grantLevel: 'view' });

    const primeira = await revogar('admin', aB.id);
    assert.deepEqual(ids(primeira.reparented), [bD.id], 'piso: a primeira resgatou');
    const antes = await linha(bD.id);

    const segunda = await revogar('admin', aB.id);
    assert.deepEqual(segunda.revoked, [], 'a segunda não derruba nada');
    assert.deepEqual(segunda.reparented, [], 'nem repai-a nada');
    assert.deepEqual(segunda.trimmed, [], 'nem apara nada');

    const depois = await linha(bD.id);
    assert.equal(depois.parent_grant_id, antes.parent_grant_id, 'o pai continua o mesmo');
    assert.equal(
      depois.expires_at.getTime(), antes.expires_at.getTime(),
      'e o prazo não encolhe de novo a cada chamada',
    );
  });

  // -------------------------------------------------------------------------
  // D8(b): a autoridade morre com quem a exercia
  // -------------------------------------------------------------------------

  it('D8(b): desativar quem concedeu derruba o que ele concedeu, e o resgate vale igual', async () => {
    // O MESMO PAR DE CASOS DO REPAI, disparado por DESATIVAÇÃO em vez de revogação. É o
    // que prova que os dois caminhos de queda compartilham a semântica em vez de terem
    // duas cópias dela.
    const r = await novoTileset('d8b');

    // GUARDA DA MONTAGEM: sem `view_share` Z não concede nada. É o que garante que a
    // autoridade dele, abaixo, vem toda da raiz que o admin lhe deu — e não de outro
    // lugar que sobreviveria à desativação por acidente.
    await conceder('z', r, { granteeId: atores.b.id, grantLevel: 'view_share' }, 403);

    // Z recebe `view_share` do admin e concede a B (que só alcança por Z) e a C.
    const adminZ = await conceder('admin', r, { granteeId: atores.z.id, grantLevel: 'view_share' });
    const zB = await conceder('z', r, { granteeId: atores.b.id, grantLevel: 'view_share' });
    const zC = await conceder('z', r, { granteeId: atores.c.id, grantLevel: 'view_share' });
    // C TAMBÉM alcança por um terceiro VIVO (X), e é essa a discriminação.
    await conceder('admin', r, { granteeId: atores.x.id, grantLevel: 'view_share' });
    const xC = await conceder('x', r, { granteeId: atores.c.id, grantLevel: 'view_share' });
    // E o repasse de C, que é quem tem de ser REPAI-ADO em vez de derrubado.
    const cE = await conceder('c', r, { granteeId: atores.e.id, grantLevel: 'view' });

    assert.equal(cE.parent_grant_id, zC.id, 'piso: o repasse de C pendura no caminho que vem de Z');
    assert.ok((await visiveis('b')).includes(r), 'piso: B enxerga por concessão de Z');
    assert.ok((await visiveis('c')).includes(r), 'piso: C também');
    assert.ok((await visiveis('e')).includes(r), 'piso: e E, pelo repasse de C');
    assert.equal(adminZ.parent_grant_id, null, 'piso: a autoridade de Z nasce numa raiz do admin');

    const respostaDelete = await supertest(app)
      .delete(`/api/v1/users/${atores.z.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .expect(200);

    // A ROTA DEVOLVE AS DUAS CONTAGENS, e elas são o piso das asserções de trilha lá
    // embaixo: medidas na resposta, não presumidas por mim.
    assert.equal(respostaDelete.body.data.grantsRevoked, 2, 'as duas concessões de Z caem');
    assert.equal(respostaDelete.body.data.grantsReparented, 1, 'e o repasse de C é mantido');

    assert.ok(!(await visiveis('b')).includes(r), 'B deixa de enxergar: a autoridade morreu com Z');
    // A DISCRIMINAÇÃO: C recebeu do mesmo Z, mas TAMBÉM de um terceiro vivo.
    assert.ok((await visiveis('c')).includes(r), 'C continua enxergando, pelo caminho de X');
    assert.ok((await visiveis('e')).includes(r), 'e o repasse de C sobrevive, REPAI-ADO');
    assert.equal(
      (await linha(cE.id)).parent_grant_id, xC.id,
      'a aresta do repasse de C passou a apontar para o caminho vivo',
    );
    assert.equal((await linha(cE.id)).revoked_at, null, 'e ele não foi revogado');

    // O que caiu, caiu de verdade (e não só sumiu do predicado).
    assert.ok((await linha(zB.id)).revoked_at, 'a concessão de Z a B está REVOGADA');
    await assertSemCiclo(r);

    // A TRILHA DIZ POR QUE A PODA ACONTECEU. `origem` separa uma revogação deliberada de
    // um efeito colateral da desativação de uma conta, e sem ela o registro mostraria um
    // administrador revogando concessões que ele nunca concedeu, sem nada explicando a
    // autoridade dele para isso. Ela era escrita e nenhum teste a lia: apagar o argumento
    // no serviço não deixava nada vermelho.
    // AS RAÍZES DESTA PODA SÃO AS CONCESSÕES DE Z, e não a que ele recebeu: quem desativa
    // uma conta poda tudo o que ELA concedeu (`LIVE_GRANT_IDS_BY_GRANTER`), então a raiz
    // registrada na trilha é `zB`/`zC`. Apontar para `adminZ` aqui devolvia zero linhas, e
    // era o laço vazio que a constituição chama de cobertura vazia — foi o que a primeira
    // versão deste bloco fez, e a guarda de tamanho abaixo é o que a pegou.
    const { rows: trilhaPoda } = await db.query(
      `SELECT action, details FROM audit_trail
        WHERE details->>'rootGrantId' = ANY($1::text[])`,
      [[zB.id, zC.id]],
    );
    assert.ok(trilhaPoda.length > 0, 'guarda: o laço abaixo precisa ter linhas para percorrer');
    for (const l of trilhaPoda) {
      assert.equal(l.details.origem, 'USER_DELETE', 'toda linha desta poda diz de onde veio');
      // A DISCRIMINAÇÃO: `origem` não pode ter virado a ação. As duas continuam
      // significando coisas diferentes, e é o par que responde "por que Fulano perdeu" e
      // "por que Fulano manteve".
      assert.ok(
        ACOES_DE_EFEITO.includes(l.action),
        'e a ação continua sendo a do efeito, não a da causa',
      );
    }

    // AS DUAS CONTAGENS DA LINHA `USER_DELETE`, que também eram escritas sem leitor: elas
    // existem para que um número menor que o esperado não pareça poda incompleta. Podiam
    // ser constantes zero e a suíte inteira continuava verde.
    const { rows: linhaDelete } = await db.query(
      `SELECT details FROM audit_trail
        WHERE action = 'USER_DELETE' AND target_type = 'USER' AND target_id = $1
        ORDER BY created_at DESC LIMIT 1`,
      [atores.z.id],
    );
    assert.equal(linhaDelete.length, 1, 'a desativação deixou exatamente uma linha própria');
    const detalhes = linhaDelete[0].details;
    assert.equal(
      detalhes.grantsRevoked, respostaDelete.body.data.grantsRevoked,
      'a trilha registra o mesmo número que a resposta: quantos perderam acesso',
    );
    assert.equal(
      detalhes.grantsReparented, respostaDelete.body.data.grantsReparented,
      'e quantos MANTIVERAM o acesso por outro caminho',
    );
    assert.ok(
      detalhes.grantsReparented > 0,
      'guarda: a montagem precisa ter produzido um repai, senão as duas igualdades acima '
      + 'passariam com dois zeros e não provariam nada',
    );
    // A DISCRIMINAÇÃO: o vizinho que NÃO pode mudar. `atlasTransferred` responde outra
    // pergunta na mesma linha, e as contagens novas não podem tê-la contaminado.
    assert.equal(detalhes.atlasTransferred, 0, 'Z não era dono de atlas nenhum');
  });

  it('D8(b), o outro lado: desativar a OM ESCONDE sem revogar', async () => {
    // OS DOIS MECANISMOS SÃO DISTINGUÍVEIS PELO `revoked_at`, e este caso é o que os
    // separa. A poda (acima) só roda na rota de desativação de CONTA; o predicado
    // (`fn_granted_resource_ids`) alcança também a desativação da ORGANIZAÇÃO, que não
    // passa por rota de usuário nenhuma. Sem este par, um dos dois lados poderia sumir
    // sem nada ficar vermelho.
    const r = await novoTileset('d8b-om');
    const { rows: orgs } = await db.query(
      `INSERT INTO organizations (nome, slug, sigla, is_active)
       VALUES ($1, $2, $3, true) RETURNING id`,
      [`Alc OM ${sufixo}`, `alc-om-${sufixo}`, `ALC${sufixo.slice(0, 4)}`],
    );
    const org = orgs[0].id;
    const concedente = await createUser(db, { username: `alc_om_${sufixo}` });
    await db.query('UPDATE users SET organization_id = $1 WHERE id = $2', [org, concedente.id]);

    // O concedente recebe `view_share` do admin e repassa a B.
    const { rows: raiz } = await db.query(
      `INSERT INTO resource_grants (resource_type, resource_id, grantee_id, grant_level, granted_by)
       VALUES ('tileset', $1, $2, 'view_share', $3) RETURNING id`,
      [r, concedente.id, atores.admin.id],
    );
    const { rows: repasse } = await db.query(
      `INSERT INTO resource_grants
         (resource_type, resource_id, grantee_id, grant_level, granted_by, parent_grant_id)
       VALUES ('tileset', $1, $2, 'view', $3, $4) RETURNING id`,
      [r, atores.b.id, concedente.id, raiz[0].id],
    );

    assert.ok((await visiveis('b')).includes(r), 'piso: B vê pelo repasse');

    await db.query('UPDATE organizations SET is_active = false WHERE id = $1', [org]);

    assert.ok(!(await visiveis('b')).includes(r), 'desativar a OM do concedente esconde o repasse');
    assert.equal(
      (await linha(repasse[0].id)).revoked_at, null,
      'e ele NÃO foi revogado: aqui quem age é o predicado, não a poda — por isso reativar devolve',
    );

    // A DISCRIMINAÇÃO, no mesmo par: reativar a OM devolve o acesso. Sem ela, um
    // predicado que zerasse tudo passaria verde.
    await db.query('UPDATE organizations SET is_active = true WHERE id = $1', [org]);
    assert.ok((await visiveis('b')).includes(r), 'reativada a OM, o acesso volta');

    await db.query('DELETE FROM resource_grants WHERE resource_id = $1', [r]);
    await db.query('UPDATE users SET organization_id = NULL WHERE id = $1', [concedente.id]);
    await db.query('DELETE FROM organizations WHERE id = $1', [org]);
  });

  it('D8(b): quem perdeu a LEITURA porque o concedente morreu não consegue REPASSAR', async () => {
    // O BURACO QUE ESTE CASO FECHA FOI MEDIDO, e ele era acesso indevido de verdade, não
    // estética. Quando `fn_granted_resource_ids` passou a exigir
    // `fn_principal_vivo(g.granted_by)`, o predicado de LEITURA e o gate de ESCRITA
    // (`LIVE_GRANTS_OF_ACTOR`, de que `requireResourceShare` se alimenta) deixaram de
    // concordar — e a diferença era para o lado ABERTO. Medido contra o banco real: B
    // deixava de VER o recurso e mesmo assim `POST .../grants` devolvia 201, e o
    // beneficiário novo PASSAVA A VER, porque a linha nova nasce com `granted_by = B`,
    // que está vivo. Bastava esse beneficiário devolver o repasse para o próprio B voltar
    // a enxergar: a transitividade que D8(b) existe para fechar, reaberta pela escrita.
    //
    // O SUJEITO É O BENEFICIÁRIO VIVO, E NÃO O CONCEDENTE MORTO, e essa distinção é o
    // caso: quem tem a conta ou a OM desativada é barrado no `auth` pela reconciliação ao
    // vivo e não chega a rota nenhuma. A primeira tentativa de medir isto usou o próprio
    // concedente, levou 403 e quase deu o buraco por inexistente.
    const r = await novoTileset('d8b-repasse');
    const { rows: orgs } = await db.query(
      `INSERT INTO organizations (nome, slug, sigla, is_active)
       VALUES ($1, $2, $3, true) RETURNING id`,
      [`Alc Rep ${sufixo}`, `alc-rep-${sufixo}`, `ARP${sufixo.slice(0, 4)}`],
    );
    const org = orgs[0].id;
    const concedente = await createUser(db, { username: `alc_rep_${sufixo}` });
    await db.query('UPDATE users SET organization_id = $1 WHERE id = $2', [org, concedente.id]);
    const tokenConcedente = await loginUser(app, concedente.username, concedente.password);

    // admin → concedente → B, os dois com `view_share`, pelas rotas.
    await supertest(app)
      .post(`/api/v1/resource-access/tileset/${r}/grants`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ granteeId: concedente.id, grantLevel: 'view_share' })
      .expect(201);
    await supertest(app)
      .post(`/api/v1/resource-access/tileset/${r}/grants`)
      .set('Authorization', `Bearer ${tokenConcedente}`)
      .send({ granteeId: atores.b.id, grantLevel: 'view_share' })
      .expect(201);

    assert.ok((await visiveis('b')).includes(r), 'piso: B vê o recurso');
    // PISO DA ESCRITA, e sem ele o 403 lá embaixo poderia vir de B nunca ter podido
    // repassar. B repassa a E enquanto a autoridade está viva.
    const antes = await conceder('b', r, { granteeId: atores.e.id, grantLevel: 'view' });
    assert.ok(antes.id, 'piso: com o concedente vivo, B repassa normalmente');
    await revogar('b', antes.id);

    await db.query('UPDATE organizations SET is_active = false WHERE id = $1', [org]);

    assert.ok(!(await visiveis('b')).includes(r), 'B deixa de ver: a autoridade dele morreu');

    // O ATO: B tenta repassar o que já não enxerga.
    await conceder('b', r, { granteeId: atores.d.id, grantLevel: 'view_share' }, 403);
    assert.ok(!(await visiveis('d')).includes(r), 'e D não ganhou acesso nenhum');

    // A DISCRIMINAÇÃO, no mesmo recurso e no mesmo quadro: X, cujo concedente (o admin)
    // continua vivo, repassa normalmente. Sem ela, um gate quebrado que recusasse TODO
    // repasse passaria verde neste caso.
    await supertest(app)
      .post(`/api/v1/resource-access/tileset/${r}/grants`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ granteeId: atores.x.id, grantLevel: 'view_share' })
      .expect(201);
    const repasseVivo = await conceder('x', r, { granteeId: atores.d.id, grantLevel: 'view' });
    assert.ok(repasseVivo.id, 'quem tem concedente VIVO continua repassando');
    assert.ok((await visiveis('d')).includes(r), 'e o beneficiário dele vê o recurso');

    // A REVERSIBILIDADE, que é o que separa este mecanismo da poda: reativada a OM, B
    // volta a ver E volta a poder repassar. A linha nunca foi revogada.
    await db.query('UPDATE organizations SET is_active = true WHERE id = $1', [org]);
    assert.ok((await visiveis('b')).includes(r), 'reativada a OM, B volta a ver');
    const depois = await conceder('b', r, { granteeId: atores.c.id, grantLevel: 'view' });
    assert.ok(depois.id, 'e volta a repassar: o gate acompanha o predicado nos dois sentidos');

    await db.query('DELETE FROM resource_grants WHERE resource_id = $1', [r]);
    await db.query('UPDATE users SET organization_id = NULL WHERE id = $1', [concedente.id]);
    await db.query('DELETE FROM organizations WHERE id = $1', [org]);
  });
});
