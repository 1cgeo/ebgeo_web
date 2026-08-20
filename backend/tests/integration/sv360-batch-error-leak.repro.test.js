// Path: tests/integration/sv360-batch-error-leak.repro.test.js
//
// Achado 109 — `batchCalibration` encaminhava `err.message` cru do driver pg dentro do
// array `failed` de uma resposta 200. O `sv360ErrorHandler` não é contornado: ele
// simplesmente NUNCA roda, porque falha por item não é erro de Express. Resultado: a
// máscara que aquele handler aplica em todo o resto do módulo — e a razão que ele dá
// no comentário, "the driver message can name columns/constraints" — não cobria este
// array. O próprio JSDoc de `batchCalibration` já dizia que a exceção capturada pode
// ser SQL ("a finite-but-out-of-range floor_level overflows the INTEGER column"), ou
// seja, o autor sabia que texto de driver caía ali.
//
// AS DUAS METADES. (a) o corpo não pode conter texto de driver, e (b) o erro cru tem
// de chegar ao logger — asserir só (a) deixaria passar um fix que engole o erro.
//
// E o teste prende também o LADO OPOSTO do gate: as recusas de `loadWritablePhoto`
// (NotFound/Forbidden, `isOperational`) carregam texto escrito para o usuário e
// precisam continuar atravessando. Mascarar tudo é a outra maneira de errar.

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createProducerUser } from '../helpers/fixtures.js';
import logger from '../../src/utils/logger.js';

const JWT_SECRET = 'test-secret-key-for-testing-purposes-only-32chars';
const SLUG = 'proj-batch-leak-sv360';

// UUID v5 determinístico: o schema do lote exige `guid({version:['uuidv5']})`
// (sv360.write.schemas.js:33-35), então um randomUUID() v4 é recusado com 422 antes
// de chegar ao serviço — o teste passaria a provar a validação, não o vazamento.
const NS = Buffer.from('1b671a64-40d5-491e-99b0-da01ff1f3341'.replace(/-/g, ''), 'hex');
function uuidv5(name) {
  const h = crypto.createHash('sha1').update(NS).update(Buffer.from(name, 'utf8')).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

/** Texto que só nasce no driver do Postgres. */
const DRIVER_TEXT = /constraint|pkey|sqlstate|violates|column|relation|out of range for type|\binteger\b|\bsv360\b|\bphotos\b/i;

// O EIXO DE ESCRITA/OCULTACAO DO 360 e o ESCOPO DE PRODUCAO (`producer_org_id`),
// concedido por administrador. `organization_id` + `org_role` — lotacao
// AUTO-DECLARADA no auto-cadastro — deixou de autorizar qualquer coisa, e continua
// viajando so como exibicao.
function mintToken({ orgId, producerOrgId = null, role = 'user', sub = crypto.randomUUID() }) {
  return jwt.sign(
    {
      sub, username: `u_${sub.slice(0, 8)}`, role,
      organization_id: orgId, org_role: 'viewer', producer_org_id: producerOrgId,
    },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '15m' }
  );
}

function spyLogger() {
  const records = [];
  const saved = [];
  for (const level of ['warn', 'error']) {
    saved.push([level, Object.getOwnPropertyDescriptor(logger, level)]);
    Object.defineProperty(logger, level, {
      configurable: true, writable: true, enumerable: false,
      value: (obj, msg) => { records.push({ level, obj, msg }); },
    });
  }
  return {
    records,
    restore() {
      for (const [level, d] of saved) {
        if (d) Object.defineProperty(logger, level, d);
        else delete logger[level];
      }
    },
  };
}

describe('POST /sv360/photos/batch-calibration — erro por item sanitizado (109)', () => {
  let app, db, orgId, projectId, ownerToken, spy;
  const photoA = uuidv5('default/proj-batch-leak-sv360/bl-foto001.jpg');
  const photoB = uuidv5('default/proj-batch-leak-sv360/bl-foto002.jpg');

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const org = await db.query(`SELECT id FROM public.organizations WHERE slug = 'default'`);
    orgId = org.rows[0].id;

    const proj = await db.query(
      `INSERT INTO sv360.projects
         (organization_id, slug, name, center_lat, center_long, db_filename, status, photo_count)
       VALUES ($1, $2, 'Proj Batch Leak', -23.5, -46.6, $3, 'enabled', 2) RETURNING id`,
      [orgId, SLUG, `${SLUG}.db`]
    );
    projectId = proj.rows[0].id;

    for (const [i, id] of [photoA, photoB].entries()) {
      await db.query(
        `INSERT INTO sv360.photos
           (id, project_id, original_name, display_name, sequence_number, lat, lon, ele, floor_level)
         VALUES ($1, $2, $3, $4, $5, -23.5, -46.6, 700, 1)`,
        [id, projectId, `bl-foto00${i + 1}.jpg`, `BL Foto 00${i + 1}`, i + 1]
      );
    }

    // OS ATORES COM PODER PRECISAM DE LINHA EM `users`, e nao so de claim: as rotas de
    // LEITURA do 360 resolvem papel e producao no SQL, a partir do UUID. Um `sub`
    // sintetico escreveria (o gate de escrita e JS) e nao leria nada — um 404 com cara
    // de autorizacao que e, na verdade, fixture.
    const produtor = await createProducerUser(db, orgId, { username: `blk_prod_${crypto.randomUUID().slice(0, 8)}` });
    ownerToken = mintToken({ orgId, producerOrgId: orgId, sub: produtor.id });
  });

  after(async () => {
    await db.query(`DELETE FROM sv360.photos WHERE project_id = $1`, [projectId]);
    await db.query(`DELETE FROM sv360.projects WHERE id = $1`, [projectId]);
    await teardownTestEnv(db);
  });

  beforeEach(() => { spy = spyLogger(); });
  afterEach(() => { spy.restore(); });

  const batch = (photos) => supertest(app)
    .post('/api/v1/sv360/photos/batch-calibration')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ photos });

  it('overflow de floor_level devolve texto fixo, não o do driver, e loga o erro cru', async () => {
    // `floor_level` é Joi.number().integer() sem faixa (decisão documentada), mas a
    // coluna é INTEGER de 4 bytes: um valor finito e enorme passa a validação e
    // estoura no banco com SQLSTATE 22003.
    const res = await batch([
      { uuid: photoA, heading: 33 },              // item bom, prova a não-vacuidade
      { uuid: photoB, floor_level: 9999999999 },  // item que estoura no SQL
    ]).expect(200);

    assert.equal(res.body.updated.length, 1, 'o item válido tem de passar');
    assert.equal(res.body.updated[0].camera.id, photoA);

    // (a) o corpo não carrega nada do driver.
    assert.equal(res.body.failed.length, 1);
    assert.equal(res.body.failed[0].uuid, photoB);
    assert.equal(res.body.failed[0].error, 'Numeric value out of range');
    const corpo = JSON.stringify(res.body.failed);
    assert.doesNotMatch(corpo, DRIVER_TEXT, `texto de driver no corpo: ${corpo}`);
    assert.ok(!corpo.includes('9999999999'), `o valor ofensor foi ecoado de volta: ${corpo}`);

    // (b) o erro CRU chegou ao log — sem isto, um fix que apenas engolisse o erro
    // passaria verde. A âncora NÃO pode ser a prosa do driver: o Postgres a traduz
    // conforme o locale do servidor (esta instância responde 'inteiro fora do
    // intervalo'), que é a terceira razão listada em `integrityRejectionReason` para
    // nunca encaminhá-la. Âncoras independentes de locale: o SQLSTATE, e o fato de o
    // texto logado ser DIFERENTE do que o cliente recebeu.
    const meus = spy.records.filter((r) => r.msg === 'sv360 batch-calibration item failed');
    assert.equal(meus.length, 1, `o item que falhou tem de produzir exatamente um log: ${JSON.stringify(spy.records.map((r) => r.msg))}`);
    assert.ok(meus[0].obj.err instanceof Error, 'o log tem de carregar o objeto de erro, não uma string');
    assert.equal(meus[0].obj.err.code, '22003', 'o SQLSTATE original tem de sobreviver no log');
    assert.equal(meus[0].obj.uuid, photoB, 'o log tem de dizer QUAL item falhou');
    assert.notEqual(
      meus[0].obj.err.message,
      res.body.failed[0].error,
      'o texto logado tem de ser o do driver, não a cópia sanitizada'
    );
  });

  it('a recusa de acesso continua explícita: NotFound não pode virar texto genérico', async () => {
    // `loadWritablePhoto` lança AppError (isOperational) com texto pensado para o
    // usuário. Se o gate mascarasse por status em vez de por origem, este teste cairia
    // — e o cliente perderia a única informação acionável que o lote produz.
    const inexistente = uuidv5('default/proj-batch-leak-sv360/nao-existe.jpg');
    const res = await batch([{ uuid: inexistente, heading: 10 }]).expect(200);

    assert.equal(res.body.updated.length, 0);
    assert.equal(res.body.failed.length, 1);
    assert.equal(res.body.failed[0].uuid, inexistente);
    assert.equal(res.body.failed[0].error, 'Photo not found');
  });

  it('um lote inteiramente válido não produz failed nem log de erro', async () => {
    // Controle de não-vacuidade do arquivo: se o gatilho acima parasse de disparar
    // (por exemplo se floor_level ganhasse faixa no Joi), este teste seguiria verde e
    // o de cima falharia — a assimetria é o que impede o par de passar por acidente.
    const res = await batch([
      { uuid: photoA, heading: 11 },
      { uuid: photoB, heading: 12 },
    ]).expect(200);

    assert.equal(res.body.failed.length, 0, `nada pode falhar: ${JSON.stringify(res.body.failed)}`);
    assert.equal(res.body.updated.length, 2);
    const comErro = spy.records.filter((r) => r.obj && r.obj.err instanceof Error);
    assert.equal(comErro.length, 0, 'nenhum erro logado num lote são');
  });
});
