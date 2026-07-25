// Path: tests/integration/nomes-catalogo3d-paginacao.test.js
// Itens 122, 123 e 124.
//
// 122 — o predicado de acesso está DUPLICADO VERBATIM em CATALOGO_SELECT e
//       CATALOGO_COUNT (o próprio arquivo avisa em comentário). A guarda existente é
//       `assert.equal(res.body.total, res.body.data.length)`, que só vale enquanto
//       TODO o catálogo visível couber numa página de 10 num banco COMPARTILHADO
//       entre arquivos: por construção ela não pode detectar divergência quando
//       total > nr_records, que é justamente o caso em que o total mentiria.
// 123 — o gate de autenticação POR ROTA: /feicoes e /catalogo3d são auth-estrito,
//       /busca é anônimo. Nenhum teste do repositório fazia request SEM token às
//       duas primeiras: um refactor de "harmonização" removeria o `auth` sem
//       quebrar nada, porque o filtro embutido no SQL mantém os testes de conteúdo
//       verdes — e exporia anonimamente o catálogo 3D e o identify de edificações.
// 124 — bordas de catalogoSchema e o branch `q || null` do serviço. `page=0` geraria
//       OFFSET negativo (500 numa rota autenticada) sem o `min(1)` do Joi; e
//       `q || null` é o que faz `?q=` significar "sem filtro" — trocado por `q ?? null`
//       a string vazia iria para plainto_tsquery e o catálogo voltaria VAZIO.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, loginUser } from '../helpers/fixtures.js';

// Termo raro o bastante para o full-text isolar SÓ as linhas desta suíte.
const TAG = `zarvox${randomUUID().slice(0, 6)}`.toLowerCase();

describe('Catálogo 3D — paginação, contagem e gates de rota', () => {
  let app, db;
  let semPerm, semPermTok, admin, adminTok, comDireta, comDiretaTok, doGrupo, doGrupoTok;
  let publicos = [];
  let privados = [];

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    semPerm = await createUser(db, { username: `cat_sem_${TAG}` });
    comDireta = await createUser(db, { username: `cat_dir_${TAG}` });
    doGrupo = await createUser(db, { username: `cat_grp_${TAG}` });
    admin = await createAdminUser(db, { username: `cat_adm_${TAG}` });
    semPermTok = await loginUser(app, semPerm.username, semPerm.password);
    comDiretaTok = await loginUser(app, comDireta.username, comDireta.password);
    doGrupoTok = await loginUser(app, doGrupo.username, doGrupo.password);
    adminTok = await loginUser(app, admin.username, admin.password);

    // 3 públicos + 2 privados, todos carregando a mesma palavra-chave rara.
    const inserir = async (nome, nivel) => {
      const { rows } = await db.query(
        `INSERT INTO ng.catalogo_3d (name, description, type, access_level)
         VALUES ($1, $2, 'Tiles 3D', $3) RETURNING id`,
        [nome, `modelo ${TAG}`, nivel]
      );
      assert.equal(rows.length, 1);
      return rows[0].id;
    };
    publicos = [
      await inserir(`Pub1 ${TAG}`, 'public'),
      await inserir(`Pub2 ${TAG}`, 'public'),
      await inserir(`Pub3 ${TAG}`, 'public'),
    ];
    privados = [await inserir(`Prv1 ${TAG}`, 'private'), await inserir(`Prv2 ${TAG}`, 'private')];
  });

  after(async () => {
    await db.query(`DELETE FROM ng.catalogo_3d WHERE description = $1`, [`modelo ${TAG}`]);
    await teardownTestEnv(db);
  });

  const pagina = async (token, page, nr_records = 2, q = TAG) => {
    const req = supertest(app).get('/api/v1/nomes/catalogo3d').query({ q, page, nr_records });
    if (token) req.set('Authorization', `Bearer ${token}`);
    const res = await req.expect(200);
    return res.body;
  };

  /** Percorre TODAS as páginas e devolve { total, ids }. */
  const varrer = async (token, nr_records = 2) => {
    const ids = [];
    const totais = new Set();
    for (let p = 1; p <= 4; p += 1) {
      const corpo = await pagina(token, p, nr_records);
      totais.add(corpo.total);
      corpo.data.forEach((m) => ids.push(m.id));
    }
    return { totais: [...totais], ids };
  };

  // ── Item 122 ───────────────────────────────────────────────────────────────

  it('usuário SEM permissão: total é 3 em todas as páginas e a união tem 3 ids distintos', async () => {
    const { totais, ids } = await varrer(semPermTok);
    assert.deepEqual(totais, [3], 'o total não pode variar com a página nem contar as privadas');
    assert.equal(new Set(ids).size, 3, 'sem sobreposição entre páginas');
    assert.equal(ids.length, 3, 'e sem repetição');
    const privadosVistos = ids.filter((id) => privados.includes(id));
    assert.deepEqual(privadosVistos, [], 'nenhuma linha privada vazou');
  });

  it('admin: total é 5 e a união das páginas traz os 5 ids', async () => {
    const { totais, ids } = await varrer(adminTok);
    assert.deepEqual(totais, [5]);
    assert.equal(new Set(ids).size, 5);
    assert.deepEqual([...ids].sort(), [...publicos, ...privados].sort());
  });

  it('permissão DIRETA num privado sobe o total de 3 para 4 (SELECT e COUNT concordam)', async () => {
    const antes = await varrer(comDiretaTok);
    assert.deepEqual(antes.totais, [3], 'baseline');

    await db.query('INSERT INTO ng.model_permissions (user_id, model_id) VALUES ($1, $2)', [
      comDireta.id,
      privados[0],
    ]);

    const depois = await varrer(comDiretaTok);
    assert.deepEqual(depois.totais, [4], 'o COUNT precisa enxergar o mesmo que o SELECT');
    assert.equal(new Set(depois.ids).size, 4);
    assert.equal(depois.ids.filter((id) => id === privados[0]).length, 1, 'o id aparece em exatamente uma página');
  });

  it('permissão por GRUPO no outro privado sobe o total pelo branch de grupo', async () => {
    const antes = await varrer(doGrupoTok);
    assert.deepEqual(antes.totais, [3], 'baseline');

    const { rows: grp } = await db.query('INSERT INTO ng.groups (name) VALUES ($1) RETURNING id', [
      `Grupo ${TAG}`,
    ]);
    assert.equal(grp.length, 1);
    await db.query('INSERT INTO ng.user_groups (user_id, group_id) VALUES ($1, $2)', [doGrupo.id, grp[0].id]);
    await db.query('INSERT INTO ng.model_group_permissions (group_id, model_id) VALUES ($1, $2)', [
      grp[0].id,
      privados[1],
    ]);

    const depois = await varrer(doGrupoTok);
    assert.deepEqual(depois.totais, [4], 'SELECT e COUNT concordam também no branch de grupo');
    assert.equal(depois.ids.filter((id) => id === privados[1]).length, 1);
  });

  // ── Item 123 ───────────────────────────────────────────────────────────────

  it('gate por rota: /feicoes e /catalogo3d exigem token; /busca é anônimo (a assimetria é deliberada)', async () => {
    const feicoes = await supertest(app)
      .get('/api/v1/nomes/feicoes')
      .query({ lat: -22.9, lon: -43.2, z: 10 })
      .expect(401);
    assert.equal(feicoes.body.error.code, 'UNAUTHORIZED', 'nem 200, nem 422 do Joi: a ordem [auth, log, validate] importa');

    const catalogo = await supertest(app).get('/api/v1/nomes/catalogo3d').expect(401);
    assert.equal(catalogo.body.error.code, 'UNAUTHORIZED');

    // No MESMO teste, para que a assimetria fique legível e não seja "consertada".
    const busca = await supertest(app)
      .get('/api/v1/nomes/busca')
      .query({ q: 'Rio', lat: -22.9, lon: -43.2 })
      .expect(200);
    assert.ok(Array.isArray(busca.body), 'contrato congelado anônimo: array nu');
  });

  it('Bearer inválido/expirado em /feicoes é 401 — não cai no caminho anônimo do flexibleAuth', async () => {
    const res = await supertest(app)
      .get('/api/v1/nomes/feicoes')
      .query({ lat: -22.9, lon: -43.2, z: 10 })
      .set('Authorization', 'Bearer nao.e.um.jwt')
      .expect(401);
    assert.equal(res.body.error.code, 'UNAUTHORIZED');
  });

  // ── Item 124 ───────────────────────────────────────────────────────────────

  it('page fora de faixa é 422 apontando o campo, nunca 500 de OFFSET negativo', async () => {
    const casos = [0, -1, 'abc'];
    const respostas = await Promise.all(
      casos.map((page) =>
        supertest(app)
          .get('/api/v1/nomes/catalogo3d')
          .query({ page })
          .set('Authorization', `Bearer ${semPermTok}`)
      )
    );
    assert.equal(respostas.length, 3);
    const statuses = respostas.map((r) => r.status);
    assert.deepEqual(statuses, [422, 422, 422]);
    const codigos = respostas.map((r) => r.body.error.code);
    assert.deepEqual(codigos, ['VALIDATION_ERROR', 'VALIDATION_ERROR', 'VALIDATION_ERROR']);
    const campos = respostas.map((r) => r.body.error.details?.[0]?.field);
    assert.deepEqual(campos, ['page', 'page', 'page']);
  });

  it('nr_records: 0 e 101 são 422; 100 é o limite inclusivo e passa', async () => {
    const q = (nr_records) =>
      supertest(app)
        .get('/api/v1/nomes/catalogo3d')
        .query({ nr_records })
        .set('Authorization', `Bearer ${semPermTok}`);

    assert.equal((await q(0)).status, 422);
    assert.equal((await q(101)).status, 422);
    const ok = await q(100);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.nr_records, 100);
  });

  it('q vazia significa SEM filtro (branch `q || null`), não busca por string vazia', async () => {
    const comQVazia = await supertest(app)
      .get('/api/v1/nomes/catalogo3d')
      .query({ q: '', nr_records: 100 })
      .set('Authorization', `Bearer ${semPermTok}`)
      .expect(200);
    const semQ = await supertest(app)
      .get('/api/v1/nomes/catalogo3d')
      .query({ nr_records: 100 })
      .set('Authorization', `Bearer ${semPermTok}`)
      .expect(200);

    assert.ok(comQVazia.body.data.length > 0, 'com `?q=` o catálogo NÃO pode voltar vazio');
    assert.equal(comQVazia.body.total, semQ.body.total, '`?q=` tem de equivaler a não mandar q');
  });

  it('sem q, duas páginas consecutivas não se sobrepõem (desempate por c.id)', async () => {
    const semQ = (page) =>
      supertest(app)
        .get('/api/v1/nomes/catalogo3d')
        .query({ page, nr_records: 2 })
        .set('Authorization', `Bearer ${semPermTok}`)
        .expect(200)
        .then((r) => r.body);

    const p1 = await semQ(1);
    const p2 = await semQ(2);
    assert.ok(p1.total >= 3, `guarda: o catálogo visível precisa ter >= 3 linhas, tem ${p1.total}`);
    assert.equal(p1.data.length, 2, 'a primeira página vem cheia');
    assert.ok(p2.data.length >= 1, 'e a segunda tem pelo menos uma linha');
    const idsP1 = p1.data.map((m) => m.id);
    const idsP2 = p2.data.map((m) => m.id);
    const intersecao = idsP1.filter((id) => idsP2.includes(id));
    assert.deepEqual(intersecao, [], 'paginação que repete linha também perde linha');
  });
});
