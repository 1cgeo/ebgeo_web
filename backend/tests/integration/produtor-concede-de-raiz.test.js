// Path: tests/integration/produtor-concede-de-raiz.test.js
//
// O PRODUTOR CONCEDE ACESSO AO QUE ELE MANTÉM, E CONCEDE DE RAIZ.
//
// `parent_grant_id` é escrito num lugar só, o INSERT de `grantResource`, e ele é NULL
// quando o concedente não deriva de ninguém. Até 2026-08-20 o único titular disso era o
// papel global; o produtor entrou pela mesma porta e pela mesma razão ESTRUTURAL: ele
// enxerga o recurso por PRODUÇÃO (`fn_can_see_resource` tem esse ramo desde a baseline
// de acesso), não por concessão, então não existe `view_share` de onde pendurar. Sem o
// ramo, ele passava no gate e morria no `ForbiddenError` do serviço.
//
// A FRONTEIRA QUE NÃO PODE VAZAR é "o produtor concede o que ele NÃO produz", e ela é
// medida com os três casos indistinguíveis entre si: o institucional que ele ENXERGA
// por uma concessão `view`, o privado de outra OM que ele não enxerga, e um id que não
// existe. Os três com a mesma resposta, para que o 403 não vire oráculo de inventário.
//
// A CONSEQUÊNCIA ACEITA, e desde 2026-08-21 MEDIDA no último caso deste arquivo em vez
// de narrada aqui: a concessão-raiz dele SOBREVIVE à perda do escopo de produção, até o
// prazo, porque o predicado de leitura confere a vida do BENEFICIÁRIO e nunca a
// autoridade do concedente. A raiz de um administrador rebaixado sempre sobreviveu
// igual. O EMPRÉSTIMO por atlas não tem essa assimetria, e é o que
// `emprestimo-do-produtor-resolve.test.js` mede. Repare que D8(b) da onda 3, do jeito
// como está especificado (`fn_principal_vivo(g.granted_by)`), NÃO fecha isto: aquela
// função pergunta se a conta está viva, e rebaixar não desativa ninguém.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAdminUser, createProducerUser, loginUser,
} from '../helpers/fixtures.js';

describe('F17 — o produtor concede DE RAIZ o que ele produz', () => {
  let app, db;
  const sufixo = randomUUID().slice(0, 8);
  const atores = {};
  const tokens = {};
  let orgA, orgB;

  const DELE = `raiz-a-${sufixo}`;
  const DO_VIZINHO = `raiz-b-${sufixo}`;
  const INSTITUCIONAL = `raiz-inst-${sufixo}`;
  const INEXISTENTE = `raiz-nao-existe-${sufixo}`;

  const conceder = (quem, id, corpo) => supertest(app)
    .post(`/api/v1/resource-access/tileset/${id}/grants`)
    .set('Authorization', `Bearer ${tokens[quem]}`)
    .send(corpo);

  const revogar = (quem, grantId) => supertest(app)
    .delete(`/api/v1/resource-access/grants/${grantId}`)
    .set('Authorization', `Bearer ${tokens[quem]}`);

  async function visiveis(quem) {
    const res = await supertest(app)
      .get('/api/v1/resource-access/visible')
      .set('Authorization', `Bearer ${tokens[quem]}`)
      .expect(200);
    return res.body.data.tilesets.map((t) => t.id);
  }

  const contaVivas = async (resourceId, granteeId) => (await db.query(
    `SELECT COUNT(*)::int AS n FROM resource_grants
      WHERE resource_id = $1 AND grantee_id = $2::uuid AND revoked_at IS NULL`,
    [resourceId, granteeId],
  )).rows[0].n;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const criaOrg = async (rotulo) => (await db.query(
      `INSERT INTO organizations (nome, slug, sigla) VALUES ($1, $2, $3) RETURNING id`,
      [`OM raiz ${rotulo} ${sufixo}`, `om-raiz-${rotulo}-${sufixo}`, `${rotulo}${sufixo.slice(0, 3)}`],
    )).rows[0].id;
    orgA = await criaOrg('a');
    orgB = await criaOrg('b');

    atores.admin = await createAdminUser(db, { username: `rz_admin_${sufixo}` });
    atores.produtor = await createProducerUser(db, orgA, { username: `rz_prod_${sufixo}` });
    atores.colega = await createProducerUser(db, orgA, { username: `rz_colega_${sufixo}` });
    for (const nome of ['beneficiario', 'terceiro', 'outro', 'quarto']) {
      atores[nome] = await createUser(db, { username: `rz_${nome}_${sufixo}` });
    }
    for (const nome of Object.keys(atores)) {
      tokens[nome] = await loginUser(app, atores[nome].username, atores[nome].password);
    }

    for (const [id, org] of [[DELE, orgA], [DO_VIZINHO, orgB], [INSTITUCIONAL, null]]) {
      await db.query(
        `INSERT INTO tilesets (id, name, config, sort_order, owner_org_id, access_level)
         VALUES ($1, $2, '{"url":"/x"}'::jsonb, 0, $3::uuid, 'private')`,
        [id, `Tileset ${id}`, org],
      );
    }
    // O produtor ENXERGA o institucional, por uma concessão `view` — o nível cuja
    // definição é "vê e NÃO repassa". É ele que torna o caso da fronteira honesto:
    // sem esta linha, o 403 sobre o institucional seria o de quem não conhece a linha.
    await supertest(app)
      .post(`/api/v1/resource-access/tileset/${INSTITUCIONAL}/grants`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ granteeId: atores.produtor.id, grantLevel: 'view' })
      .expect(201);
  });

  after(async () => {
    await db.query('DELETE FROM resource_grants WHERE resource_id LIKE $1', [`%${sufixo}%`]);
    await db.query('DELETE FROM tilesets WHERE id LIKE $1', [`%${sufixo}%`]);
    await db.query('DELETE FROM users WHERE producer_org_id = ANY($1::uuid[])', [[orgA, orgB]]);
    await db.query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [[orgA, orgB]]);
    await teardownTestEnv(db);
  });

  it('o produtor concede DE RAIZ o recurso que produz', async () => {
    // O PISO É A AUSÊNCIA DE PAI: ele não tem concessão nenhuma sobre este recurso, e é
    // isso que dá sentido a "de raiz". O que ele tem é o crachá.
    assert.equal(
      await contaVivas(DELE, atores.produtor.id), 0,
      'piso: o produtor não recebeu concessão nenhuma sobre o que ele mesmo mantém',
    );
    assert.ok(
      !(await visiveis('beneficiario')).includes(DELE),
      'piso: o beneficiário não via o recurso antes',
    );

    const criada = (await conceder('produtor', DELE, {
      granteeId: atores.beneficiario.id, grantLevel: 'view',
    }).expect(201)).body.data;

    assert.equal(criada.parent_grant_id, null, 'concessão de RAIZ: não há pai de onde derivar');
    assert.equal(criada.granted_by, atores.produtor.id);
    // O 201 SOZINHO PASSARIA numa concessão pendurada em pai errado, numa que nasce
    // morta pelo prazo, ou numa que não entrega acesso nenhum.
    assert.ok(
      (await visiveis('beneficiario')).includes(DELE),
      'e o beneficiário passa a VER o recurso, que é o que a concessão promete',
    );
  });

  it('A FRONTEIRA: o produtor não concede o que não produz, e os três casos são iguais', async () => {
    // O PISO ESTÁ NO MESMO ARQUIVO E NO MESMO INSTANTE: a rota funciona para ele, com
    // este token. Sem isso, três 403 são o que se mede numa rota quebrada.
    await conceder('produtor', DELE, {
      granteeId: atores.terceiro.id, grantLevel: 'view',
    }).expect(201);

    const fronteira = [
      // Ele VÊ este (por uma concessão `view`) e mesmo assim não o repassa.
      INSTITUCIONAL,
      // Este ele não vê: é privado de outra OM.
      DO_VIZINHO,
      // E este não existe. Os três com a MESMA resposta, para que o 403 não conte nada
      // sobre o inventário.
      INEXISTENTE,
    ];
    assert.equal(fronteira.length, 3, 'os três casos indistinguíveis');

    for (const id of fronteira) {
      await conceder('produtor', id, {
        granteeId: atores.outro.id, grantLevel: 'view',
      }).expect(403);
      const { rows } = await db.query(
        'SELECT COUNT(*)::int AS n FROM resource_grants WHERE resource_id = $1 AND grantee_id = $2::uuid',
        [id, atores.outro.id],
      );
      assert.equal(rows[0].n, 0, `${id}: a recusa precisa ser SEM EFEITO`);
    }

    // FECHA POR CIMA: o administrador concede o institucional, provando que o recurso é
    // concedível e que o que falta ao produtor é a AUTORIDADE sobre ele.
    await supertest(app)
      .post(`/api/v1/resource-access/tileset/${INSTITUCIONAL}/grants`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ granteeId: atores.outro.id, grantLevel: 'view' })
      .expect(201);
    assert.ok((await visiveis('outro')).includes(INSTITUCIONAL));
  });

  it('quem revoga a concessão-raiz do produtor é quem a DEU (ou o administrador)', async () => {
    const doProdutor = (await conceder('produtor', DELE, {
      granteeId: atores.outro.id, grantLevel: 'view',
    }).expect(201)).body.data;
    const doAdmin = (await supertest(app)
      .post(`/api/v1/resource-access/tileset/${DELE}/grants`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ granteeId: atores.quarto.id, grantLevel: 'view' })
      .expect(201)).body.data;

    assert.ok((await visiveis('outro')).includes(DELE), 'piso: a concessão está viva e funciona');

    // O beneficiário da segunda linha é um usuário COMUM, e não o colega produtor: o
    // produtor da OM vê o recurso pelo crachá, então revogar a concessão dele não
    // mudaria nada na leitura e o controle de reversão não discriminaria nada.
    //
    // A DISCRIMINAÇÃO CENTRAL: um SEGUNDO produtor da MESMA OM não revoga o que o
    // colega deu. A autoridade de revogar é por AUTORIA (`granted_by`), não por OM —
    // sem esta linha, "o produtor revoga o que deu" passaria idêntico num gate que
    // deixasse qualquer produtor derrubar a subárvore alheia.
    await revogar('colega', doProdutor.id).expect(403);
    assert.ok((await visiveis('outro')).includes(DELE), 'e a recusa é sem efeito');

    await revogar('produtor', doProdutor.id).expect(200);
    assert.ok(!(await visiveis('outro')).includes(DELE), 'quem deu, tira');

    // E o ramo CURINGA: o administrador revoga a que ele mesmo deu (e revogaria
    // qualquer outra). Sem ele, o 403 acima seria compatível com uma rota fechada.
    await revogar('admin', doAdmin.id).expect(200);
    assert.ok(!(await visiveis('quarto')).includes(DELE));
  });

  it('o `view` que o produtor deu NÃO vira `view_share`', async () => {
    // A RAIZ NOVA NÃO PODE AFROUXAR A DISTINÇÃO ENTRE OS DOIS NÍVEIS, que é a única
    // coisa que os separa: quem recebeu `view` vê e não repassa, venha a concessão de
    // quem vier.
    const layer = DELE;
    // O beneficiário recebeu `view` do produtor no primeiro caso, e o piso é ele VER:
    // sem isso, o 403 abaixo seria o de alguém sem acesso nenhum.
    assert.ok((await visiveis('beneficiario')).includes(layer), 'piso: ele vê o recurso');

    await conceder('beneficiario', layer, {
      granteeId: atores.outro.id, grantLevel: 'view',
    }).expect(403);

    // A DISCRIMINAÇÃO, no mesmo instante: o produtor concedente repassa a um terceiro
    // com 201. Sem ela, o 403 acima seria o de uma rota que passou a negar tudo.
    const paraOutro = (await conceder('produtor', layer, {
      granteeId: atores.outro.id, grantLevel: 'view_share',
    }).expect(201)).body.data;
    assert.equal(paraOutro.parent_grant_id, null, 'e continua sendo de RAIZ');
    // E quem recebeu `view_share` DO produtor repassa de fato, derivando dele.
    const derivada = (await conceder('outro', layer, {
      granteeId: atores.beneficiario.id, grantLevel: 'view',
    }).expect(201)).body.data;
    assert.equal(
      derivada.parent_grant_id, paraOutro.id,
      'a cadeia continua sendo uma árvore: o filho pendura no `view_share` de onde veio',
    );
  });

  it('A LACUNA, MEDIDA: o REBAIXAMENTO do concedente NÃO derruba a concessão-raiz', async () => {
    // ESTE CASO AFIRMA O COMPORTAMENTO DE HOJE, e é deliberado que ele afirme o lado
    // frouxo. O cabeçalho deste arquivo declarava a consequência em prosa ("registrada e
    // não medida aqui"), e consequência narrada em comentário é a que a próxima sessão lê
    // como já resolvida. Aqui ela vira número.
    //
    // POR QUE ISSO NÃO É O QUE D8(b) VAI CONSERTAR, e é a parte que ninguém tinha escrito:
    // D8(b) foi especificado como "uma concessão de raiz vive enquanto
    // `fn_principal_vivo(g.granted_by)`", e `fn_principal_vivo` pergunta se a CONTA está
    // viva, não se a AUTORIDADE está. Um produtor rebaixado, um administrador rebaixado e
    // um credenciado rebaixado seguem com conta ativa. Logo, depois da onda 3, este caso
    // continua verde do jeito que está — quem for implementá-la e quiser fechar a lacuna
    // precisa exigir a AUTORIDADE da raiz no braço de concessão, e então INVERTER este
    // caso. Se o dono decidir que rebaixamento nunca propaga, o caso fica como está e
    // passa a ser a asserção da decisão.
    //
    // O CONTRASTE É O ARGUMENTO: o EMPRÉSTIMO por atlas é reavaliado a cada leitura e cai
    // no mesmo rebaixamento (`emprestimo-do-produtor-resolve.test.js`). Os dois eixos
    // ficam com regras opostas sobre o mesmo ato.
    const layer = DELE;
    const doColega = (await conceder('colega', layer, {
      granteeId: atores.quarto.id, grantLevel: 'view',
    }).expect(201)).body.data;
    assert.equal(doColega.parent_grant_id, null, 'piso: é concessão de RAIZ');
    assert.ok((await visiveis('quarto')).includes(layer), 'piso: o beneficiário vê');

    // REBAIXAMENTO, e não desativação: a conta continua ATIVA, e é isso que faz
    // `fn_principal_vivo` continuar dizendo "sim" sobre o concedente.
    await db.query(
      `UPDATE users SET role = 'user', producer_org_id = NULL WHERE id = $1`, [atores.colega.id],
    );
    try {
      const { rows: produz } = await db.query(
        `SELECT fn_can_produce_resource($1::uuid, 'tileset', $2) AS ok`, [atores.colega.id, layer],
      );
      assert.equal(produz[0].ok, false, 'o concedente deixou de produzir');
      const { rows: vivo } = await db.query(
        'SELECT fn_principal_vivo($1::uuid) AS ok', [atores.colega.id],
      );
      assert.equal(vivo[0].ok, true, 'e continua VIVO: é a conta que ela mede, não a autoridade');

      assert.ok(
        (await visiveis('quarto')).includes(layer),
        'e o beneficiário CONTINUA vendo: a raiz não é reavaliada contra a autoridade de quem a deu',
      );
      const { rows: linha } = await db.query(
        'SELECT revoked_at FROM resource_grants WHERE id = $1::uuid', [doColega.id],
      );
      assert.equal(linha[0].revoked_at, null, 'nem a linha foi revogada por ninguém');
    } finally {
      await db.query(
        `UPDATE users SET role = 'producer', producer_org_id = $2::uuid WHERE id = $1`,
        [atores.colega.id, orgA],
      );
      await db.query('UPDATE resource_grants SET revoked_at = NOW() WHERE id = $1::uuid', [doColega.id]);
    }
  });
});
