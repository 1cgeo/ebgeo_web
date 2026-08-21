// Path: tests/integration/auditoria-sv360-delete-tem-om.test.js
//
// O ARGUMENTO DECISIVO A FAVOR DA COLUNA DENORMALIZADA, medido em vez de argumentado.
//
// `DELETE /sv360/admin/projects/:slug` é o ÚNICO hard-delete do sistema, e a linha de
// `SV360_DELETE` nasce DEPOIS do DELETE, dentro da mesma transação. Se a OM alvo fosse
// resolvida na LEITURA — por junta com `sv360.projects` ou por gatilho, dá no mesmo —
// ela devolveria NULL exatamente para o evento que mais importa auditar: o produtor da
// OM não teria notícia da destruição do próprio acervo.
//
// A DISCRIMINAÇÃO ESTÁ NO MESMO CASO, e é ela que dá sentido ao número: depois do
// commit, `SELECT 1 FROM sv360.projects WHERE id = <alvo>` devolve ZERO linhas. A OM na
// trilha só pôde vir da ESCRITA.
//
// CONTROLE NEGATIVO: tirar `targetOrgId` do emissor (ou mover o `createAudit` para
// depois do commit) deixa a coluna nula, e os dois casos abaixo ficam vermelhos juntos.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createAdminUser, createProducerUser, createUser, loginUser } from '../helpers/fixtures.js';
import config from '../../src/config.js';
import { closeStore } from '../../src/modules/streetview360/sv360.blobstore.js';

const RID = crypto.randomUUID().slice(0, 8);
const SLUG = `aud-del-${RID}`;

describe('Auditoria — a destruição do projeto 360 deixa linha COM OM, sem projeto', () => {
  let app, db, orgId, projectId, dbPath;
  let tokenProdutor, tokenAdmin;
  let beneficiario;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    orgId = (await db.query(
      'INSERT INTO organizations (nome, slug, sigla) VALUES ($1, $2, $3) RETURNING id',
      [`OM del ${RID}`, `om-del-${RID}`, `D${RID.slice(0, 3)}`],
    )).rows[0].id;

    const produtor = await createProducerUser(db, orgId, { username: `auddel_prod_${RID}` });
    const admin = await createAdminUser(db, { username: `auddel_admin_${RID}` });
    tokenProdutor = await loginUser(app, produtor.username, produtor.password);
    tokenAdmin = await loginUser(app, admin.username, admin.password);

    const dbFilename = `${orgId}__${SLUG}.db`;
    dbPath = path.join(config.sv360.dbDir, dbFilename);
    mkdirSync(config.sv360.dbDir, { recursive: true });
    writeFileSync(dbPath, Buffer.from('SQLite format 3\0'));

    projectId = (await db.query(
      `INSERT INTO sv360.projects
         (organization_id, slug, name, center_lat, center_long, db_filename, status, photo_count,
          access_level)
       VALUES ($1, $2, $3, -23.5, -46.6, $4, 'enabled', 0, 'private') RETURNING id`,
      [orgId, SLUG, `Auditoria delete ${RID}`, dbFilename],
    )).rows[0].id;

    // UMA CONCESSÃO VIVA SOBRE O PROJETO, para que o hard-delete tenha o que purgar.
    // Sem ela, `purgeResourceLinks` não emite linha nenhuma e o caso de `PERMISSION_PURGE`
    // abaixo mediria conjunto vazio — o vácuo clássico deste guarda.
    beneficiario = await createUser(db, { username: `auddel_benef_${RID}` });
    await supertest(app)
      .post(`/api/v1/resource-access/sv360_project/${projectId}/grants`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ granteeId: beneficiario.id, grantLevel: 'view' })
      .expect(201);
  });

  after(async () => {
    await closeStore();
    if (existsSync(dbPath)) {
      try {
        rmSync(dbPath, { force: true });
      } catch {
        /* best effort */
      }
    }
    await teardownTestEnv(db);
  });

  it('piso: antes do delete, a mudança de STATUS já nasce carimbada com a OM', async () => {
    // O piso não é decorativo: se o carimbo estivesse quebrado para o módulo inteiro, o
    // caso do delete falharia sem dizer se a causa é o hard-delete ou o emissor.
    await supertest(app)
      .patch(`/api/v1/sv360/admin/projects/${SLUG}/status?orgId=${orgId}`)
      .set('Authorization', `Bearer ${tokenProdutor}`)
      .send({ status: 'disabled' })
      .expect(200);

    const { rows } = await db.query(
      `SELECT target_org_id FROM audit_trail
        WHERE action = 'SV360_STATUS_CHANGE' AND target_id = $1`,
      [projectId],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].target_org_id, orgId);
  });

  it('depois do HARD delete, a linha tem OM e o projeto não existe mais', async () => {
    await supertest(app)
      .delete(`/api/v1/sv360/admin/projects/${SLUG}?orgId=${orgId}`)
      .set('Authorization', `Bearer ${tokenProdutor}`)
      .expect(204);

    const trilha = await db.query(
      `SELECT target_org_id, target_name FROM audit_trail
        WHERE action = 'SV360_DELETE' AND target_id = $1`,
      [projectId],
    );
    assert.equal(trilha.rows.length, 1, 'a destruição precisa deixar exatamente uma linha');
    assert.equal(
      trilha.rows[0].target_org_id, orgId,
      'a OM só pôde vir da ESCRITA: a linha do projeto já não existe',
    );

    const sobrou = await db.query('SELECT 1 FROM sv360.projects WHERE id = $1', [projectId]);
    assert.equal(sobrou.rows.length, 0, 'hard delete: nada de onde uma junta pudesse tirar a OM');
  });

  it('`PERMISSION_PURGE` também: a OM é lida ANTES do DELETE, na mesma transação', async () => {
    // O ÚNICO EMISSOR DE `PERMISSION_PURGE` DO SISTEMA, e o mais difícil de resolver na
    // leitura: ele nasce dentro da transação que destrói o projeto, entre a leitura da OM
    // e o `DELETE`. A revisão adversarial mediu que anular este carimbo passava verde em
    // toda a suíte — é este caso que fecha aquele buraco, e ele roda DEPOIS do delete de
    // propósito, contra o mesmo `sv360.projects` que já não tem a linha.
    const linhas = (await db.query(
      `SELECT target_org_id, details FROM audit_trail
        WHERE action = 'PERMISSION_PURGE' AND target_id = $1`,
      [projectId],
    )).rows;
    assert.ok(linhas.length >= 1, 'piso: a concessão plantada precisa ter sido purgada');
    assert.deepEqual(
      [...new Set(linhas.map((l) => l.target_org_id))], [orgId],
      'toda linha de purga carrega a OM do projeto destruído',
    );
    assert.ok(
      linhas.some((l) => l.details?.kind === 'grant' && l.details?.wasLive === true),
      'a concessão purgada estava VIVA: é a que significa perda de acesso',
    );

    // E o produtor da OM a lê pela rota — que é a razão do carimbo existir.
    const res = await supertest(app)
      .get('/api/v1/audit?action=PERMISSION_PURGE')
      .set('Authorization', `Bearer ${tokenProdutor}`)
      .expect(200);
    assert.ok(res.body.data.data.some((l) => l.target_id === projectId));
  });

  it('e o PRODUTOR da OM lê a própria destruição pela rota', async () => {
    // A consequência de produto, que é o motivo de tudo isto: sem a coluna, a tela do
    // produtor não mostraria o evento mais grave do acervo dele.
    const res = await supertest(app)
      .get('/api/v1/audit?action=SV360_DELETE')
      .set('Authorization', `Bearer ${tokenProdutor}`)
      .expect(200);
    const minhas = res.body.data.data.filter((l) => l.target_id === projectId);
    assert.equal(minhas.length, 1);
    assert.equal(minhas[0].target_org_id, orgId);

    // A discriminação: o administrador vê a mesma linha (senão o caso acima poderia
    // estar medindo uma trilha que só existe para o produtor).
    const doAdmin = await supertest(app)
      .get('/api/v1/audit?action=SV360_DELETE')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);
    assert.ok(doAdmin.body.data.data.some((l) => l.target_id === projectId));
  });
});
