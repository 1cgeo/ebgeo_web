// Path: tests/integration/papel-curador.test.js
//
// O PAPEL CURADOR (fase F4, decisão D5).
//
// Um terceiro valor em `users.role`, entre `user` e `admin`: vê TODO recurso
// privado do catálogo e NÃO é administrador do sistema.
//
// OS TRÊS NEGATIVOS SÃO O CORAÇÃO DESTA FASE, e não um apêndice dela. O padrão
// "lista fechada de papel" já causou dois bugs reais neste repositório, nos dois
// pacotes, sempre por EXCLUIR o nível de cima. Aqui o risco é o oposto e é pior:
// alguém escreve `if (role !== 'user')` num gate que era de administração, e o
// curador ganha poder de administrador do sistema sem que nada fique vermelho.
// Por isso este arquivo mede, um por um:
//
//   - `requireAdmin` → 403 para o curador;
//   - `requireAtlasPermission` → o curador NÃO vira dono de atlas alheio;
//   - `toFrontendRole` → o curador NÃO vira 'admin' no cliente.
//
// E o positivo que dá sentido aos três: ele VÊ o recurso privado, sem concessão
// nenhuma. Sem esse par, "recebe 403 em tudo" também é o que se mede quando o
// papel não existe.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, createAtlas, loginUser } from '../helpers/fixtures.js';
import { toFrontendRole } from '../../src/utils/roles.js';

describe('F4 — o Curador vê o privado e não administra nada', () => {
  let app, db, curador, comum, admin, atlasDoAdmin;
  let tokenCurador, tokenComum, tokenAdmin;
  const sufixo = randomUUID().slice(0, 8);
  const TILESET = `cur-${sufixo}`;

  const visiveis = async (token) => (await supertest(app)
    .get('/api/v1/resource-access/visible')
    .set('Authorization', `Bearer ${token}`)
    .expect(200)).body.data;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    admin = await createAdminUser(db, { username: `cur_admin_${sufixo}` });
    comum = await createUser(db, { username: `cur_comum_${sufixo}` });
    curador = await createUser(db, { username: `cur_curador_${sufixo}`, role: 'curator' });
    tokenAdmin = await loginUser(app, admin.username, admin.password);
    tokenComum = await loginUser(app, comum.username, comum.password);
    tokenCurador = await loginUser(app, curador.username, curador.password);
    atlasDoAdmin = await createAtlas(db, admin.id, { name: `Atlas do admin ${sufixo}` });

    await db.query(
      `INSERT INTO tilesets (id, name, config, sort_order, access_level)
       VALUES ($1, $2, '{"url":"/x"}'::jsonb, 0, 'private')`,
      [TILESET, `Tileset ${sufixo}`]
    );
  });

  after(async () => {
    await db.query('DELETE FROM resource_grants WHERE resource_id = $1', [TILESET]);
    await db.query('DELETE FROM tilesets WHERE id = $1', [TILESET]);
    await db.query('DELETE FROM atlas WHERE id = $1', [atlasDoAdmin.id]);
    await teardownTestEnv(db);
  });

  it('o CHECK de `users.role` aceita o terceiro valor (migração 018)', async () => {
    const { rows } = await db.query('SELECT role FROM users WHERE id = $1', [curador.id]);
    assert.equal(rows[0].role, 'curator');
    // Discriminação: um quarto valor continua recusado, senão o CHECK teria sido
    // ALARGADO demais (ou removido) e este arquivo mediria a ausência de guarda.
    await assert.rejects(
      () => db.query('UPDATE users SET role = $1 WHERE id = $2', ['superuser', comum.id]),
      /users_role_check/
    );
  });

  it('POSITIVO — o curador enxerga o privado SEM concessão nenhuma', async () => {
    const { rows } = await db.query(
      'SELECT COUNT(*)::int AS n FROM resource_grants WHERE grantee_id = $1', [curador.id]
    );
    assert.equal(rows[0].n, 0, 'piso: o curador não pode ter concessão — o que ele tem é o papel');

    assert.ok((await visiveis(tokenCurador)).tilesets.map((t) => t.id).includes(TILESET));
    // O par: o usuário comum, no mesmo instante, não vê.
    assert.ok(!(await visiveis(tokenComum)).tilesets.map((t) => t.id).includes(TILESET));
  });

  it('POSITIVO — e o curador CONCEDE de raiz, como o administrador', async () => {
    const res = await supertest(app)
      .post(`/api/v1/resource-access/tileset/${TILESET}/grants`)
      .set('Authorization', `Bearer ${tokenCurador}`)
      .send({ granteeId: comum.id, grantLevel: 'view' })
      .expect(201);
    assert.equal(res.body.data.parent_grant_id, null, 'papel global concede de RAIZ');
    assert.ok((await visiveis(tokenComum)).tilesets.map((t) => t.id).includes(TILESET));

    await supertest(app)
      .delete(`/api/v1/resource-access/grants/${res.body.data.id}`)
      .set('Authorization', `Bearer ${tokenCurador}`)
      .expect(200);
  });

  it('NEGATIVO 1 — o curador NÃO passa em `requireAdmin`', async () => {
    // A rota de visibilidade é `auth` + `requireAdmin`: marcar privado é ato de
    // ADMINISTRAÇÃO do catálogo, e o curador repassa acesso sem decidir que o
    // recurso deixou de ser público para todo mundo.
    await supertest(app)
      .patch(`/api/v1/resource-access/tileset/${TILESET}/visibility`)
      .set('Authorization', `Bearer ${tokenCurador}`)
      .send({ accessLevel: 'public' })
      .expect(403);
    // E o mesmo corpo, com o admin, passa.
    await supertest(app)
      .patch(`/api/v1/resource-access/tileset/${TILESET}/visibility`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ accessLevel: 'public' })
      .expect(200);
    await supertest(app)
      .patch(`/api/v1/resource-access/tileset/${TILESET}/visibility`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ accessLevel: 'private' })
      .expect(200);

    // Outro gate de administração, para não medir uma rota só: a lista de usuários.
    await supertest(app).get('/api/v1/users').set('Authorization', `Bearer ${tokenCurador}`).expect(403);
    await supertest(app).get('/api/v1/users').set('Authorization', `Bearer ${tokenAdmin}`).expect(200);
  });

  it('NEGATIVO 2 — o curador NÃO vira dono em `requireAtlasPermission`', async () => {
    // Admin global é tratado como dono de QUALQUER atlas. O curador não: ele vê
    // recurso de catálogo, não o conteúdo de projeto alheio.
    await supertest(app)
      .get(`/api/v1/atlas/${atlasDoAdmin.id}`)
      .set('Authorization', `Bearer ${tokenCurador}`)
      .expect(404);
    // Discriminação: o admin abre o mesmo atlas.
    await supertest(app)
      .get(`/api/v1/atlas/${atlasDoAdmin.id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);
  });

  it('NEGATIVO 3 — `toFrontendRole` não devolve `admin` para o curador', () => {
    // O sítio mais perigoso do censo inteiro: mapear curador para 'admin' aqui lhe
    // daria a INTERFACE de administrador sem passar por gate nenhum de servidor.
    assert.equal(toFrontendRole(null, 'curator'), 'viewer');
    assert.equal(toFrontendRole('read', 'curator'), 'viewer');
    assert.equal(toFrontendRole('write', 'curator'), 'editor', 'a permissão POR ATLAS continua valendo');
    // Discriminação: o admin global continua curto-circuitando.
    assert.equal(toFrontendRole(null, 'admin'), 'admin');
  });

  it('o papel é resolvido no BANCO: rebaixar o curador vale na hora, sem novo token', async () => {
    // `fn_has_global_data_access` consulta `users`, e não recebe booleano do JS.
    // É o que elimina a janela de até 15 min do token — `flexibleAuth` é global,
    // não-bloqueante e NÃO reconcilia.
    assert.ok((await visiveis(tokenCurador)).tilesets.map((t) => t.id).includes(TILESET));

    await db.query('UPDATE users SET role = $1 WHERE id = $2', ['user', curador.id]);
    try {
      assert.ok(
        !(await visiveis(tokenCurador)).tilesets.map((t) => t.id).includes(TILESET),
        'o MESMO token, depois do rebaixamento, já não enxerga'
      );
    } finally {
      await db.query('UPDATE users SET role = $1 WHERE id = $2', ['curator', curador.id]);
    }
    assert.ok((await visiveis(tokenCurador)).tilesets.map((t) => t.id).includes(TILESET), 'e volta ao repromover');
  });

  it('curador DESATIVADO não enxerga nada (a função cobra `is_active`)', async () => {
    await db.query('UPDATE users SET is_active = false WHERE id = $1', [curador.id]);
    try {
      // O caminho estrito derruba a sessão inteira em 401 — o que já é a resposta
      // certa. A asserção é sobre a FUNÇÃO, que é quem carrega a garantia mesmo se
      // a camada de aplicação errar.
      const { rows } = await db.query('SELECT fn_has_global_data_access($1::uuid) AS ok', [curador.id]);
      assert.equal(rows[0].ok, false);
    } finally {
      await db.query('UPDATE users SET is_active = true WHERE id = $1', [curador.id]);
    }
    const { rows } = await db.query('SELECT fn_has_global_data_access($1::uuid) AS ok', [curador.id]);
    assert.equal(rows[0].ok, true, 'e volta ao reativar');
  });
});
