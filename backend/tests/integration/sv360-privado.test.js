// Path: tests/integration/sv360-privado.test.js
//
// O 360 PRIVADO (fase F6, decisão D6).
//
// O 360 é o único dos quatro tipos que já tinha controle de acesso funcionando, e
// por isso foi o último a mudar: aqui o risco não é abrir um buraco novo, é
// FECHAR um caminho que funcionava. A suíte 360 inteira (396 casos) é metade da
// verificação desta fase; este arquivo é a outra.
//
// DOIS EIXOS ORTOGONAIS, e a confusão entre eles é o defeito provável:
//   `status`       — `disabled` OCULTA, inclusive de quem tem concessão e do curador;
//   `access_level` — `private` RESTRINGE quem está de fora, nunca a OM dona (D6).
// O caso novo é `enabled + private`.
//
// E uma propriedade de forma, não de conteúdo: o primeiro termo do predicado
// deixou de ser um booleano do JS. `TRUE` curto-circuitava a disjunção inteira, de
// modo que um erro no cálculo de `isAdmin` não errava — ABRIA. Agora o SQL resolve
// o papel a partir do UUID, e um token forjado sem linha em `users` deixou de ser
// admin. O último caso deste arquivo mede exatamente isso.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, loginUser } from '../helpers/fixtures.js';
import config from '../../src/config.js';

const ORG_DONA = '00000000-0000-0000-0000-000000000001';

// Coordenadas e zoom do tile onde a foto do projeto privado cai. O mesmo cálculo
// de `sv360-mvt.test.js`; copiado e não importado porque aquele arquivo é uma
// suíte, não um módulo de helpers.
const LON = -51.0;
const LAT = -30.0;
const Z = 12;
const TILE = (() => {
  const n = 2 ** Z;
  const latRad = (LAT * Math.PI) / 180;
  return {
    x: Math.floor(((LON + 180) / 360) * n),
    y: Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n),
  };
})();

/** Decodifica um MVT em { [camada]: [props] }. */
function decodeTile(buf) {
  const tile = new VectorTile(new PbfReader(buf));
  const out = {};
  for (const nome of Object.keys(tile.layers)) {
    const layer = tile.layers[nome];
    out[nome] = [];
    for (let i = 0; i < layer.length; i += 1) out[nome].push(layer.feature(i).properties);
  }
  return out;
}

function fetchTile(app, token) {
  let req = supertest(app).get(`/api/v1/sv360/tiles/${Z}/${TILE.x}/${TILE.y}.pbf`);
  if (token) req = req.set('Authorization', `Bearer ${token}`);
  return req.buffer().parse((r, cb) => {
    const chunks = [];
    r.on('data', (c) => chunks.push(c));
    r.on('end', () => cb(null, Buffer.concat(chunks)));
  });
}

describe('F6 — projeto 360 enabled+private', () => {
  let app, db, admin, curador, beneficiario, forasteiro, daOrgDona;
  let tokenAdmin, tokenCurador, tokenBeneficiario, tokenForasteiro, tokenOrgDona;
  let projetoId, projetoPublicoId;
  const fotoPrivadaId = crypto.randomUUID();
  const fotoPublicaId = crypto.randomUUID();
  const sufixo = crypto.randomUUID().slice(0, 8);
  const SLUG = `priv360-${sufixo}`;
  let outraOrgId;

  const getProjeto = (token) => {
    const req = supertest(app).get(`/api/v1/sv360/projects/${SLUG}`);
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req;
  };

  const listaSlugs = async (token) => {
    const req = supertest(app).get('/api/v1/sv360/projects');
    if (token) req.set('Authorization', `Bearer ${token}`);
    const res = await req.expect(200);
    return (res.body.projects ?? res.body).map((p) => p.slug);
  };

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const { rows: orgs } = await db.query(
      `INSERT INTO organizations (nome, slug, sigla) VALUES ($1, $2, $3) RETURNING id`,
      [`OM 360 ${sufixo}`, `om360-${sufixo}`, `O${sufixo.slice(0, 4)}`]
    );
    outraOrgId = orgs[0].id;

    admin = await createAdminUser(db, { username: `p360_admin_${sufixo}` });
    curador = await createUser(db, { username: `p360_cur_${sufixo}`, role: 'curator' });
    beneficiario = await createUser(db, { username: `p360_ben_${sufixo}` });
    forasteiro = await createUser(db, { username: `p360_fora_${sufixo}` });
    daOrgDona = await createUser(db, { username: `p360_om_${sufixo}`, organization_id: outraOrgId });
    tokenAdmin = await loginUser(app, admin.username, admin.password);
    tokenCurador = await loginUser(app, curador.username, curador.password);
    tokenBeneficiario = await loginUser(app, beneficiario.username, beneficiario.password);
    tokenForasteiro = await loginUser(app, forasteiro.username, forasteiro.password);
    tokenOrgDona = await loginUser(app, daOrgDona.username, daOrgDona.password);

    // enabled + private, de uma OM que NÃO é a dos forasteiros: o caso novo.
    const { rows } = await db.query(
      `INSERT INTO sv360.projects (organization_id, slug, name, db_filename, status, access_level,
                                   center_lat, center_long, photo_count)
       VALUES ($1, $2, $3, $4, 'enabled', 'private', -30.0, -51.0, 0) RETURNING id`,
      [outraOrgId, SLUG, `Projeto privado ${sufixo}`, `${outraOrgId}__${SLUG}.db`]
    );
    projetoId = rows[0].id;

    // Uma foto e uma TRACK no projeto privado, mais um projeto PÚBLICO vizinho no
    // MESMO tile. O vizinho é o controle de discriminação do MVT: sem ele, "o tile
    // não traz a foto privada" também é o que se mede quando o tile vem vazio.
    const { rows: pub } = await db.query(
      `INSERT INTO sv360.projects (organization_id, slug, name, db_filename, status, access_level,
                                   center_lat, center_long, photo_count)
       VALUES ($1, $2, $3, $4, 'enabled', 'public', $5, $6, 1) RETURNING id`,
      [outraOrgId, `${SLUG}-pub`, `Vizinho público ${sufixo}`, `${outraOrgId}__${SLUG}-pub.db`, LAT, LON]
    );
    projetoPublicoId = pub[0].id;

    for (const [id, projeto, nome] of [
      [fotoPrivadaId, projetoId, 'privada.jpg'],
      [fotoPublicaId, projetoPublicoId, 'publica.jpg'],
    ]) {
      await db.query(
        `INSERT INTO sv360.photos (id, project_id, original_name, sequence_number, lat, lon, geom, floor_level)
         VALUES ($1, $2, $3, 1, $5, $4, ST_SetSRID(ST_MakePoint($4, $5), 4326), 0)`,
        [id, projeto, nome, LON, LAT]
      );
    }
    // A TRAJETÓRIA do projeto privado, que alimenta a camada de LINHA. Um filtro
    // aplicado só nos pontos deixaria esta linha desenhada no mapa.
    await db.query(
      `INSERT INTO sv360.tracks (project_id, geom)
       VALUES ($1, ST_SetSRID(ST_MakeLine(ST_MakePoint($2, $3), ST_MakePoint($4, $5)), 4326))`,
      [projetoId, LON, LAT, LON + 0.0004, LAT + 0.0004]
    );
  });

  after(async () => {
    await db.query('DELETE FROM resource_grants WHERE resource_id = $1', [projetoId]);
    await db.query('DELETE FROM sv360.projects WHERE id = ANY($1::uuid[])', [[projetoId, projetoPublicoId]]);
    await db.query('DELETE FROM users WHERE organization_id = $1', [outraOrgId]);
    await db.query('DELETE FROM organizations WHERE id = $1', [outraOrgId]);
    await teardownTestEnv(db);
  });

  it('NEGATIVO — 404 para o anônimo e para o forasteiro; ausente da listagem dos dois', async () => {
    await getProjeto(null).expect(404);
    await getProjeto(tokenForasteiro).expect(404);
    assert.ok(!(await listaSlugs(null)).includes(SLUG));
    assert.ok(!(await listaSlugs(tokenForasteiro)).includes(SLUG));
  });

  it('POSITIVO — 200 para a OM DONA, para o admin e para o curador (D6)', async () => {
    // A OM dona vê o PRÓPRIO dado inclusive privado: privacidade restringe quem
    // está de FORA. Sem este caso, a mudança poderia ter fechado o dono junto.
    for (const [quem, token] of [['OM dona', tokenOrgDona], ['admin', tokenAdmin], ['curador', tokenCurador]]) {
      await getProjeto(token).expect(200);
      assert.ok((await listaSlugs(token)).includes(SLUG), `${quem} precisa ver na listagem`);
    }
  });

  it('POSITIVO — concedido, o beneficiário passa a ver; o forasteiro continua fora', async () => {
    assert.equal(
      (await getProjeto(tokenBeneficiario)).status, 404,
      'piso: antes da concessão ele é indistinguível de inexistente'
    );

    await supertest(app)
      .post(`/api/v1/resource-access/sv360_project/${projetoId}/grants`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ granteeId: beneficiario.id, grantLevel: 'view' })
      .expect(201);

    await getProjeto(tokenBeneficiario).expect(200);
    assert.ok((await listaSlugs(tokenBeneficiario)).includes(SLUG));
    // A concessão é PESSOAL: o forasteiro não pega carona.
    await getProjeto(tokenForasteiro).expect(404);
  });

  it('os DOIS eixos são ortogonais: `disabled` oculta até de quem tem concessão', async () => {
    await db.query(`UPDATE sv360.projects SET status = 'disabled' WHERE id = $1`, [projetoId]);
    try {
      await getProjeto(tokenBeneficiario).expect(404);
      // …e continua visível para a OM dona, que é o significado de `disabled`.
      await getProjeto(tokenOrgDona).expect(200);
    } finally {
      await db.query(`UPDATE sv360.projects SET status = 'enabled' WHERE id = $1`, [projetoId]);
    }
    // E o par: reabilitado, ele volta — o que prova que o 404 acima foi o eixo de
    // status e nao a concessao ter sumido.
    await getProjeto(tokenBeneficiario).expect(200);
  });

  it('a listagem do PAINEL entrega os dois eixos, para que o administrador possa vê-los', async () => {
    // O painel do administrador mostra "Status" e "Acesso" lado a lado, e sem esta
    // coluna na resposta ele teria de adivinhar um deles — que é como um eixo de
    // acesso fica invisível justamente para quem o administra. Repare que a
    // listagem administrativa NÃO filtra por privacidade de propósito: ela existe
    // para administrar, e o gate dela é `requireAdmin`, não o eixo de recurso.
    const res = await supertest(app)
      .get('/api/v1/sv360/admin/projects')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);
    const linhas = res.body.projects ?? res.body;
    const privado = linhas.find((p) => p.slug === SLUG);
    const publico = linhas.find((p) => p.slug === `${SLUG}-pub`);
    assert.ok(privado, 'guarda: o projeto privado precisa estar na listagem administrativa');
    assert.ok(publico, 'guarda: e o vizinho público também');
    // Os dois juntos: um só não distingue "traz a coluna" de "traz sempre o mesmo".
    assert.equal(privado.access_level, 'private');
    assert.equal(publico.access_level, 'public');
    assert.equal(privado.status, 'enabled', 'e o eixo de status continua chegando separado');
  });

  it('remarcado público, volta a ser público — e a concessão fica DORMENTE, não apagada', async () => {
    await db.query(`UPDATE sv360.projects SET access_level = 'public' WHERE id = $1`, [projetoId]);
    try {
      await getProjeto(null).expect(200);
      await getProjeto(tokenForasteiro).expect(200);
      const { rows } = await db.query(
        `SELECT COUNT(*)::int AS n FROM resource_grants
          WHERE resource_id = $1 AND revoked_at IS NULL`,
        [projetoId]
      );
      assert.equal(rows[0].n, 1, 'a concessão não é apagada — ela apenas deixa de ser necessária');
    } finally {
      await db.query(`UPDATE sv360.projects SET access_level = 'private' WHERE id = $1`, [projetoId]);
    }
    // E ela volta a valer quando o projeto é remarcado privado (R5).
    await getProjeto(tokenForasteiro).expect(404);
    await getProjeto(tokenBeneficiario).expect(200);
  });

  it('O TOKEN SOZINHO NÃO É MAIS ADMIN: `sub` sem linha em `users` não abre nada', async () => {
    // O primeiro termo do predicado deixou de ser `$1::boolean`. Um token assinado
    // com a chave certa, declarando `role: 'admin'`, mas cujo `sub` não existe no
    // banco, era admin para o SQL antigo e não é mais. É a janela de rebaixamento
    // de 15 minutos de `flexibleAuth` fechada por construção.
    const forjado = jwt.sign(
      { sub: crypto.randomUUID(), role: 'admin', organization_id: ORG_DONA, org_role: 'admin' },
      config.jwt.secret,
      { algorithm: 'HS256', expiresIn: '5m' }
    );
    await getProjeto(forjado).expect(404);
    assert.ok(!(await listaSlugs(forjado)).includes(SLUG));

    // A DISCRIMINAÇÃO: o mesmo `role: 'admin'`, agora com linha em `users`, abre.
    await getProjeto(tokenAdmin).expect(200);
  });

  it('MVT — a foto privada some das DUAS camadas para o forasteiro', async () => {
    // AS DUAS CAMADAS, e não só a de pontos. A CTE `visible` alimenta `fotos` E
    // `fotos_linha`, e um filtro aplicado só nos pontos deixaria a TRAJETÓRIA do
    // projeto invisível desenhada no mapa — é o negativo que a suíte de MVT já
    // cobrava para o eixo de `status`, e que o eixo de privacidade precisava herdar.
    const camadas = decodeTile((await fetchTile(app, tokenForasteiro)).body);
    const ids = (camadas.fotos || []).map((f) => f.id);

    // O CONTROLE DE DISCRIMINAÇÃO primeiro: o tile NÃO está vazio.
    assert.ok(ids.includes(fotoPublicaId), 'guarda: a foto do projeto público precisa estar no tile');
    assert.ok(!ids.includes(fotoPrivadaId), 'a foto do projeto privado não pode vazar');
    const linhas = camadas.fotos_linha || [];
    assert.ok(
      !linhas.some((l) => l.projectSlug === SLUG),
      'nem a trajetória dele — a camada de linha é gateada pelo mesmo predicado'
    );
  });

  it('MVT — e o beneficiário RECEBE as duas, com a concessão viva', async () => {
    const camadas = decodeTile((await fetchTile(app, tokenBeneficiario)).body);
    const ids = (camadas.fotos || []).map((f) => f.id);
    assert.ok(ids.includes(fotoPrivadaId), 'concedido, o ponto aparece');
    assert.ok(
      (camadas.fotos_linha || []).some((l) => l.projectSlug === SLUG),
      'e a trajetória junto'
    );
  });

  it('MVT — o anônimo também não recebe nenhuma das duas', async () => {
    const camadas = decodeTile((await fetchTile(app, null)).body);
    const ids = (camadas.fotos || []).map((f) => f.id);
    assert.ok(ids.includes(fotoPublicaId), 'guarda: o tile anônimo carrega o público');
    assert.ok(!ids.includes(fotoPrivadaId));
    assert.ok(!(camadas.fotos_linha || []).some((l) => l.projectSlug === SLUG));
  });

  it('`?atlasId=` é INERTE nas rotas de leitura do 360, e isso é deliberado', async () => {
    // O EMPRÉSTIMO POR ATLAS NÃO ALCANÇA ESTAS ROTAS, e o motivo é de segurança:
    // elas são servidas por `flexibleAuth` (não há gate de atlas nenhum) e as
    // respostas de tile/geojson são cacheadas como PÚBLICAS para o chamador
    // anônimo. Honrar um `atlasId` vindo da query entregaria os panoramas
    // emprestados a qualquer um que soubesse o UUID do atlas — e ainda os deixaria
    // num cache compartilhado. Este caso pinta o comportamento seguro de hoje: um
    // parâmetro a mais na URL não muda a resposta. Se alguém ligar o eixo, ele
    // fica vermelho, que é o sinal de que a autorização de atlas precisa vir junto.
    const semParam = await getProjeto(tokenForasteiro).expect(404);
    const comParam = await supertest(app)
      .get(`/api/v1/sv360/projects/${SLUG}?atlasId=${crypto.randomUUID()}`)
      .set('Authorization', `Bearer ${tokenForasteiro}`)
      .expect(404);
    assert.equal(comParam.status, semParam.status);
  });
});
