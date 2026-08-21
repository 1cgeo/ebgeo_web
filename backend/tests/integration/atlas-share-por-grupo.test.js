// Path: tests/integration/atlas-share-por-grupo.test.js
//
// O EIXO DE GRUPO EM `atlas_shares`, medido onde ele mora: no banco.
//
// A PRECEDÊNCIA É SQL, então é teste de banco ou não é teste nenhum. `fn_user_atlas_shares`
// resolve o MAIOR nível entre o share direto e os shares dos grupos vivos da pessoa, e é ela
// que o gate REST, o gate do WebSocket e as três listagens de atlas consultam. Um teste que
// exercitasse só a rota mediria um dos consumidores e deixaria os outros dois no escuro.
//
// O QUE ESTE ARQUIVO NÃO ALCANÇA, dito em voz alta: o heartbeat do WebSocket
// (`tests/ws/collab-reauthz-grupo.test.js`), as três rotas de escrita e a trilha
// (`tests/integration/sharing-grupo-rotas.test.js`) e a frame de compartilhamento
// (`tests/ws/sharing-broadcast-grupo.test.js`). Verde aqui prova a resolução, não o produto.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAtlas, createShare, loginUser,
  createAccessGroup, addAccessGroupMember, createGroupShare,
} from '../helpers/fixtures.js';
import { PERMISSION_LEVELS } from '../../src/middleware/permissions.js';

const U = () => `grp_${randomUUID().slice(0, 8)}`;

// A ESCADA, ESCRITA À MÃO. Ela NÃO é derivada de `fn_permission_rank` nem de
// `PERMISSION_LEVELS`, e a razão está registrada em `permission-hierarchy-matrix`: derivar a
// expectativa da tabela sob teste faz a expectativa se mover junto com o defeito.
const LEVELS = ['read', 'comment', 'write', 'manage'];

/** O mesmo 1x1 de `atlas-cartao-projeto.test.js`: a capa precisa EXISTIR para o caso medir. */
const PNG_1X1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const maiorDe = (a, b) => (LEVELS.indexOf(a) >= LEVELS.indexOf(b) ? a : b);

describe('atlas_shares · o eixo de GRUPO', () => {
  let app, db, dono, donoTok, x, xTok, y, yTok, z;

  const resolve = async (userId, atlasId) => {
    const { rows } = await db.query(
      'SELECT permission FROM fn_user_atlas_shares($1::uuid, $2::uuid)',
      [userId, atlasId]
    );
    return rows[0]?.permission ?? null;
  };

  const abrir = (token, atlasId) =>
    supertest(app).get(`/api/v1/atlas/${atlasId}`).set('Authorization', `Bearer ${token}`);

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    dono = await createUser(db, { username: U(), nome: 'Dona do Atlas' });
    donoTok = await loginUser(app, dono.username, dono.password);
    x = await createUser(db, { username: U(), nome: 'Xisto' });
    xTok = await loginUser(app, x.username, x.password);
    y = await createUser(db, { username: U(), nome: 'Ypsilon' });
    yTok = await loginUser(app, y.username, y.password);
    z = await createUser(db, { username: U(), nome: 'Zeta' });
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  // -------------------------------------------------------------------------
  it('piso: estranho leva 404; posto no grupo compartilhado, o MESMO gate resolve write', async () => {
    const atlas = await createAtlas(db, dono.id, { name: `piso ${U()}` });

    // PISO ASSERIDO, não presumido: antes de qualquer grupo existir, X não tem relação
    // nenhuma com o atlas e o gate responde 404 (contrato de "sem relação", não 403).
    await abrir(xTok, atlas.id).expect(404);
    assert.equal(await resolve(x.id, atlas.id), null, 'piso: nenhum share alcança X');

    const g = await createAccessGroup(db, dono.id);
    await addAccessGroupMember(db, g.id, x.id, dono.id);
    await createGroupShare(db, atlas.id, g.id, 'write', dono.id);

    assert.equal(await resolve(x.id, atlas.id), 'write');
    const abriu = await abrir(xTok, atlas.id).expect(200);
    assert.equal(abriu.body.data.id, atlas.id);

    // DISCRIMINAÇÃO: Y, que não está no grupo, continua 404 NA MESMA RODADA. Sem este par,
    // um código que passasse a liberar todo mundo ficaria verde acima.
    await abrir(yTok, atlas.id).expect(404);
    assert.equal(await resolve(y.id, atlas.id), null);
  });

  // -------------------------------------------------------------------------
  it('precedência 4x4: o MAIOR vence e nenhum caminho rebaixa', async () => {
    // Um atlas por par, para que os 16 casos não se contaminem pelo UNIQUE de cada alvo.
    for (const direto of LEVELS) {
      for (const porGrupo of LEVELS) {
        const atlas = await createAtlas(db, dono.id, { name: `4x4 ${direto}/${porGrupo} ${U()}` });
        const g = await createAccessGroup(db, dono.id);
        await addAccessGroupMember(db, g.id, x.id, dono.id);
        await createShare(db, atlas.id, x.id, direto, dono.id);
        await createGroupShare(db, atlas.id, g.id, porGrupo, dono.id);

        const efetivo = await resolve(x.id, atlas.id);
        const esperado = maiorDe(direto, porGrupo);

        // AS TRÊS ASSERÇÕES JUNTAS. A igualdade sozinha ficaria verde para uma
        // implementação que devolvesse sempre 'manage'; as duas desigualdades sozinhas
        // ficariam verdes para um máximo errado. Só o máximo correto passa nas três.
        assert.equal(efetivo, esperado, `direto=${direto} grupo=${porGrupo}`);
        assert.ok(
          LEVELS.indexOf(efetivo) >= LEVELS.indexOf(direto),
          `o caminho de grupo NUNCA rebaixa o direto (${direto} → ${efetivo})`
        );
        assert.ok(
          LEVELS.indexOf(efetivo) >= LEVELS.indexOf(porGrupo),
          `o caminho direto NUNCA rebaixa o de grupo (${porGrupo} → ${efetivo})`
        );
      }
    }
  });

  it('os dois casos degenerados: um caminho só devolve aquele caminho', async () => {
    for (const nivel of LEVELS) {
      const soDireto = await createAtlas(db, dono.id, { name: `só direto ${nivel} ${U()}` });
      await createShare(db, soDireto.id, x.id, nivel, dono.id);
      assert.equal(await resolve(x.id, soDireto.id), nivel, `só direto ${nivel}`);

      const soGrupo = await createAtlas(db, dono.id, { name: `só grupo ${nivel} ${U()}` });
      const g = await createAccessGroup(db, dono.id);
      await addAccessGroupMember(db, g.id, x.id, dono.id);
      await createGroupShare(db, soGrupo.id, g.id, nivel, dono.id);
      assert.equal(await resolve(x.id, soGrupo.id), nivel, `só grupo ${nivel}`);
    }
  });

  // -------------------------------------------------------------------------
  it('fn_permission_rank concorda com PERMISSION_LEVELS, valor a valor', async () => {
    const nomes = Object.keys(PERMISSION_LEVELS);
    assert.equal(nomes.length, 5, 'piso: a escada do JS tem cinco degraus');

    for (const nome of nomes) {
      const { rows } = await db.query('SELECT fn_permission_rank($1) AS r', [nome]);
      assert.equal(rows[0].r, PERMISSION_LEVELS[nome], `fn_permission_rank('${nome}')`);
    }

    // DUAS ASSERÇÕES ABSOLUTAS, que não dependem de NENHUMA das duas tabelas. Sem elas,
    // duas cópias erradas do MESMO jeito passariam verdes — o defeito que o guarda de
    // calibração/marcador já nomeou nesta casa.
    const { rows: abs } = await db.query(
      `SELECT fn_permission_rank('manage') AS manage,
              fn_permission_rank('write')  AS write,
              fn_permission_rank('read')   AS read,
              fn_permission_rank('superuser') AS desconhecido`
    );
    assert.ok(abs[0].manage > abs[0].write, 'manage está ACIMA de write');
    assert.ok(abs[0].desconhecido < abs[0].read, 'nível desconhecido falha FECHADO (abaixo de read)');
  });

  // -------------------------------------------------------------------------
  it('GET /api/v1/atlas lista o atlas por grupo UMA vez, mesmo com dois grupos', async () => {
    const atlas = await createAtlas(db, dono.id, { name: `lista ${U()}` });

    const listar = async (token) => {
      const res = await supertest(app).get('/api/v1/atlas')
        .set('Authorization', `Bearer ${token}`).expect(200);
      return res.body.data;
    };

    // PISO: contagem asserida como ZERO antes do ato.
    assert.equal((await listar(xTok)).filter((a) => a.id === atlas.id).length, 0);

    const g1 = await createAccessGroup(db, dono.id);
    const g2 = await createAccessGroup(db, dono.id);
    for (const g of [g1, g2]) await addAccessGroupMember(db, g.id, x.id, dono.id);
    await createGroupShare(db, atlas.id, g1.id, 'read', dono.id);
    await createGroupShare(db, atlas.id, g2.id, 'manage', dono.id);

    const linhas = (await listar(xTok)).filter((a) => a.id === atlas.id);
    // EXATAMENTE UMA, não ">= 1": um LEFT JOIN cru sobre `atlas_shares` (a implementação
    // ingênua) devolve DUAS e fica vermelho exatamente aqui.
    assert.equal(linhas.length, 1, 'dois grupos, um cartão');
    assert.equal(linhas[0].user_permission, 'manage', 'o maior dos dois');

    // DISCRIMINAÇÃO: Y, sem grupo, continua sem ver o atlas na mesma rodada.
    assert.equal((await listar(yTok)).filter((a) => a.id === atlas.id).length, 0);
  });

  it('o overview conta e lista as pessoas que entram por grupo, sem duplicar o dono', async () => {
    const atlas = await createAtlas(db, dono.id, { name: `overview ${U()}` });
    const g = await createAccessGroup(db, dono.id);
    // O DONO dentro do próprio grupo compartilhado é o caso que a contagem erraria: sem o
    // `<> a.owner_id`, ele apareceria duas vezes e `member_count` diria 3 para 2 pessoas.
    await addAccessGroupMember(db, g.id, dono.id, dono.id);
    await addAccessGroupMember(db, g.id, x.id, dono.id);
    await createGroupShare(db, atlas.id, g.id, 'write', dono.id);

    const res = await supertest(app).get('/api/v1/atlas/overview')
      .set('Authorization', `Bearer ${donoTok}`).expect(200);
    const cartao = res.body.data.atlases.find((a) => a.id === atlas.id);
    assert.ok(cartao, 'o dono vê o próprio atlas');
    assert.equal(cartao.member_count, 2, 'dono + o membro por grupo, o dono contado UMA vez');
    assert.deepEqual(cartao.members.map((m) => m.id).sort(), [dono.id, x.id].sort());
  });

  // -------------------------------------------------------------------------
  it('apagar o grupo mata o share, e mata sem escrever em atlas_shares', async () => {
    const atlas = await createAtlas(db, dono.id, { name: `apagar ${U()}` });
    const g = await createAccessGroup(db, dono.id);
    await addAccessGroupMember(db, g.id, x.id, dono.id);
    await createGroupShare(db, atlas.id, g.id, 'write', dono.id);
    await createShare(db, atlas.id, z.id, 'read', dono.id);

    // PISO: as duas medidas verdes IMEDIATAMENTE antes do DELETE.
    assert.equal(await resolve(x.id, atlas.id), 'write');
    await abrir(xTok, atlas.id).expect(200);

    await db.query('UPDATE access_groups SET deleted_at = NOW() WHERE id = $1', [g.id]);

    assert.equal(await resolve(x.id, atlas.id), null);
    // 404 e NÃO 403: é o contrato de "sem relação nenhuma".
    await abrir(xTok, atlas.id).expect(404);

    // CONTROLE 1: Z, com share DIRETO no mesmo atlas, não se moveu.
    assert.equal(await resolve(z.id, atlas.id), 'read');

    // CONTROLE 2: a morte foi por RESOLUÇÃO, não por escrita. Se algum lote futuro
    // acrescentar um DELETE no caminho do soft-delete, este caso fica vermelho e a
    // duplicação de mecanismo aparece em vez de passar despercebida.
    const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM atlas_shares WHERE group_id = $1', [g.id]);
    assert.equal(rows[0].n, 1, 'a linha continua fisicamente na tabela');
  });

  it('o dono do grupo desativado derruba o share por grupo (a mesma porta de fn_user_group_ids)', async () => {
    const atlas = await createAtlas(db, dono.id, { name: `dono morto ${U()}` });
    const efemero = await createUser(db, { username: U() });
    const g = await createAccessGroup(db, efemero.id);
    await addAccessGroupMember(db, g.id, x.id, efemero.id);
    await createGroupShare(db, atlas.id, g.id, 'write', dono.id);

    // DISCRIMINAÇÃO: um segundo grupo, de dono VIVO, com o MESMO membro no MESMO atlas.
    const gVivo = await createAccessGroup(db, dono.id);
    await addAccessGroupMember(db, gVivo.id, x.id, dono.id);
    await createGroupShare(db, atlas.id, gVivo.id, 'read', dono.id);

    assert.equal(await resolve(x.id, atlas.id), 'write', 'piso: o maior dos dois grupos');

    await db.query('UPDATE users SET is_active = false WHERE id = $1', [efemero.id]);

    // Cai para o grupo de dono vivo — não para null. Um predicado quebrado que zerasse
    // TODOS os grupos daria null aqui.
    assert.equal(await resolve(x.id, atlas.id), 'read');
  });

  it('o dono do grupo desativado tira o membro da LISTA de participantes, e não só da resolução', async () => {
    // AS DUAS PORTAS FECHAM JUNTAS, e este caso existe porque elas não fechavam: enquanto
    // `fn_atlas_member_ids` filtrava só `deleted_at IS NULL`, o cartão de "Seus atlas"
    // CONTAVA e NOMEAVA (`nome`, `posto_graduacao`) quem `fn_user_atlas_shares` já recusava
    // com 404. Medido: `resolve = null` e `member_count` inalterado, na mesma fixture.
    //
    // A divulgação não é hipotética: `GET /atlas/overview` é `auth`-only e responde a
    // QUALQUER participante, inclusive Leitor.
    const atlas = await createAtlas(db, dono.id, { name: `membros dono morto ${U()}` });
    const efemero = await createUser(db, { username: U() });
    const gMorto = await createAccessGroup(db, efemero.id);
    await addAccessGroupMember(db, gMorto.id, x.id, efemero.id);
    await createGroupShare(db, atlas.id, gMorto.id, 'write', dono.id);

    // DISCRIMINAÇÃO: um segundo grupo, de dono VIVO, com OUTRA pessoa, no MESMO atlas. Sem
    // ele, um predicado quebrado que zerasse todos os grupos passaria verde abaixo.
    const gVivo = await createAccessGroup(db, dono.id);
    await addAccessGroupMember(db, gVivo.id, y.id, dono.id);
    await createGroupShare(db, atlas.id, gVivo.id, 'read', dono.id);

    const cartao = async () => {
      const res = await supertest(app).get('/api/v1/atlas/overview')
        .set('Authorization', `Bearer ${donoTok}`).expect(200);
      return res.body.data.atlases.find((a) => a.id === atlas.id);
    };

    // PISO, e ele é o par: a lista E a resolução concordam ANTES do ato.
    const antes = await cartao();
    assert.equal(antes.member_count, 3, 'piso: dono + o membro de cada grupo');
    assert.deepEqual(antes.members.map((m) => m.id).sort(), [dono.id, x.id, y.id].sort());
    assert.equal(await resolve(x.id, atlas.id), 'write', 'piso: e X alcança o atlas');

    await db.query('UPDATE users SET is_active = false WHERE id = $1', [efemero.id]);

    const depois = await cartao();
    assert.equal(depois.member_count, 2, 'X sai da contagem junto com a autoridade do grupo dele');
    assert.deepEqual(depois.members.map((m) => m.id).sort(), [dono.id, y.id].sort());

    // AS DUAS METADES NA MESMA RODADA: a porta que fechou e a que não podia fechar.
    assert.equal(await resolve(x.id, atlas.id), null, 'e o gate concorda com a lista');
    assert.equal(await resolve(y.id, atlas.id), 'read', 'o grupo de dono VIVO não se moveu');
  });

  it('a CAPA acompanha o cartão: quem entra por grupo recebe as duas coisas', async () => {
    // `LIST_USER_ATLAS_COVERS` é a terceira listagem que mudou de eixo, e era a única sem
    // guarda de COMPORTAMENTO: o censo estrutural prova que a chamada está escrita, nunca
    // que ela decide alguma coisa. Revertendo aquele `LEFT JOIN` para o eixo só-pessoa, o
    // membro por grupo veria o cartão SEM capa, e nenhum caso ficava vermelho.
    const atlas = await createAtlas(db, dono.id, { name: `capa por grupo ${U()}` });
    const g = await createAccessGroup(db, dono.id);
    await addAccessGroupMember(db, g.id, x.id, dono.id);
    await createGroupShare(db, atlas.id, g.id, 'read', dono.id);

    await supertest(app).put(`/api/v1/atlas/${atlas.id}/cover`)
      .set('Authorization', `Bearer ${donoTok}`)
      .send({ image: PNG_1X1 })
      .expect(200);

    const overview = async (token) => {
      const res = await supertest(app).get('/api/v1/atlas/overview')
        .set('Authorization', `Bearer ${token}`).expect(200);
      return res.body.data;
    };

    // PISO: a capa existe e o dono a recebe. Sem esta linha os `undefined` abaixo seriam
    // verdadeiros com a capa nunca gravada, e o caso provaria nada.
    assert.equal((await overview(donoTok)).covers[atlas.id], PNG_1X1, 'piso: a capa existe');

    const deX = await overview(xTok);
    assert.ok(deX.atlases.some((a) => a.id === atlas.id), 'o cartão aparece para quem entra por grupo');
    assert.equal(deX.covers[atlas.id], PNG_1X1, 'e a capa vem junto — cartão sem capa é o defeito');

    // DISCRIMINAÇÃO: Y, fora do grupo, não recebe NEM o cartão NEM a capa. Sem esta metade,
    // uma rota que entregasse capa a todo mundo passaria idêntica acima.
    const deY = await overview(yTok);
    assert.equal(deY.atlases.find((a) => a.id === atlas.id), undefined);
    assert.equal(deY.covers[atlas.id], undefined);
  });

  it('a POSSE continua NOMINAL: não se transfere o atlas a quem só alcança por grupo', async () => {
    // `transferOwnership` ganhou um `AND s.user_id IS NOT NULL` nesta onda e a linha vinha
    // sem asserção nenhuma: o `JOIN users u ON u.id = s.user_id` já descartava a linha
    // coletiva por acidente, então o comentário prometia uma guarda que ninguém media.
    // Posse é coluna (`atlas.owner_id`), não coletivo, e entregá-la a quem entra por um
    // grupo trocaria uma autoridade revogável (tirar o grupo) por uma irrevogável.
    const atlas = await createAtlas(db, dono.id, { name: `posse nominal ${U()}` });
    const g = await createAccessGroup(db, dono.id);
    await addAccessGroupMember(db, g.id, x.id, dono.id);
    await createGroupShare(db, atlas.id, g.id, 'manage', dono.id);
    await createShare(db, atlas.id, y.id, 'write', dono.id);

    const transferir = (novoDono) => supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/transfer`)
      .set('Authorization', `Bearer ${donoTok}`)
      .send({ newOwnerId: novoDono });

    // PISO: X alcança o atlas, e no nível MAIS ALTO que um share concede.
    assert.equal(await resolve(x.id, atlas.id), 'manage');

    await transferir(x.id).expect(400);
    const { rows } = await db.query('SELECT owner_id FROM atlas WHERE id = $1', [atlas.id]);
    assert.equal(rows[0].owner_id, dono.id, 'a recusa não pode ter movido a posse');

    // DISCRIMINAÇÃO: Y, com share DIRETO menor, recebe a posse na mesma rodada. Sem esta
    // metade, o 400 acima passaria idêntico numa rota que recusasse toda transferência.
    await transferir(y.id).expect(200);
    const { rows: depois } = await db.query('SELECT owner_id FROM atlas WHERE id = $1', [atlas.id]);
    assert.equal(depois[0].owner_id, y.id);
  });

  // -------------------------------------------------------------------------
  it('alvo único e unicidade: o CHECK e os dois UNIQUE fazem o que dizem', async () => {
    const atlas = await createAtlas(db, dono.id, { name: `check ${U()}` });
    const g1 = await createAccessGroup(db, dono.id);
    const g2 = await createAccessGroup(db, dono.id);

    const erroDe = async (sql, params) => {
      try {
        await db.query(sql, params);
        return null;
      } catch (e) {
        return e.constraint ?? e.message;
      }
    };

    // Os dois alvos preenchidos, e nenhum dos dois: o MESMO CHECK, capturado PELO NOME.
    assert.equal(
      await erroDe(
        'INSERT INTO atlas_shares (atlas_id, user_id, group_id, permission) VALUES ($1,$2,$3,$4)',
        [atlas.id, x.id, g1.id, 'read']
      ),
      'atlas_shares_alvo_unico_check'
    );
    assert.equal(
      await erroDe('INSERT INTO atlas_shares (atlas_id, permission) VALUES ($1,$2)', [atlas.id, 'read']),
      'atlas_shares_alvo_unico_check'
    );

    // Cada alvo sozinho insere.
    await createShare(db, atlas.id, x.id, 'read', dono.id);
    await createGroupShare(db, atlas.id, g1.id, 'read', dono.id);

    // Duas linhas para o MESMO grupo colidem.
    assert.equal(
      await erroDe(
        'INSERT INTO atlas_shares (atlas_id, group_id, permission) VALUES ($1,$2,$3)',
        [atlas.id, g1.id, 'write']
      ),
      'atlas_shares_atlas_id_group_id_key'
    );

    // E DUAS LINHAS PARA GRUPOS DIFERENTES COEXISTEM. Este é o caso que prova a premissa
    // de NULLS DISTINCT sobre a qual o desenho inteiro (sem `DROP CONSTRAINT` no
    // `UNIQUE (atlas_id, user_id)` herdado) se apoia: se ela não valer nesta instalação,
    // este caso fica vermelho antes de qualquer usuário sofrer.
    assert.equal(
      await erroDe(
        'INSERT INTO atlas_shares (atlas_id, group_id, permission) VALUES ($1,$2,$3)',
        [atlas.id, g2.id, 'write']
      ),
      null,
      'dois grupos no mesmo atlas coexistem (NULLS DISTINCT)'
    );
  });
});
