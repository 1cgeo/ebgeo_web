// Path: tests/integration/auditoria-autoedicao.test.js
//
// O TITULAR PASSA A DEIXAR RASTRO, E A SENHA CONTINUA FORA DA TRILHA.
//
// Duas das rotas classificadas como BURACO no censo de auditoria eram `PUT /users/me` e
// `PUT /users/me/password`: a edição PELO ADMINISTRADOR emitia `USER_UPDATE` e
// `PASSWORD_RESET`, e a do próprio titular não emitia nada. Quem investigava uma conta
// via o que o admin fez com ela e não o que o titular fez consigo — no único fator de
// autenticação da casa.
//
// AS AÇÕES SÃO REUSADAS DE PROPÓSITO. Criar uma segunda ação para o mesmo fato partiria
// a história de uma conta em duas listas que não se cruzam, e custaria migração com par
// DROP/ADD CONSTRAINT. `details.self === true` é o que discrimina os dois emissores.
//
// A DISCRIMINAÇÃO OBRIGATÓRIA é o caminho administrativo: ele continua produzindo A SUA
// linha, SEM `self`. Sem essa metade, fechar o buraco poderia ter canibalizado o emissor
// que já existia e o teste passaria verde.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, loginUser } from '../helpers/fixtures.js';

describe('Auditoria — a auto-edição de perfil e de senha deixam linha', () => {
  let app, db, titular, admin, tokenTitular, tokenAdmin;
  const sufixo = randomUUID().slice(0, 8);
  const SENHA_NOVA = 'Nova@Senha1234';

  const linhas = async (acao, alvo) => (await db.query(
    'SELECT * FROM audit_trail WHERE action = $1 AND target_id = $2 ORDER BY created_at',
    [acao, alvo],
  )).rows;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    titular = await createUser(db, { username: `auto_tit_${sufixo}` });
    admin = await createAdminUser(db, { username: `auto_admin_${sufixo}` });
    tokenTitular = await loginUser(app, titular.username, titular.password);
    tokenAdmin = await loginUser(app, admin.username, admin.password);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('piso: `PUT /users/me` produz UMA linha USER_UPDATE, com ator == alvo e `self`', async () => {
    assert.deepEqual(
      await linhas('USER_UPDATE', titular.id), [],
      'piso do piso: a conta começa sem linha nenhuma, senão a contagem abaixo não diz nada',
    );

    await supertest(app).put('/api/v1/users/me')
      .set('Authorization', `Bearer ${tokenTitular}`)
      .send({ nome: `Titular ${sufixo}` })
      .expect(200);

    const achadas = await linhas('USER_UPDATE', titular.id);
    assert.equal(achadas.length, 1);
    assert.equal(achadas[0].actor_id, titular.id, 'ator e alvo são a mesma pessoa');
    assert.equal(achadas[0].details.self, true);
    assert.deepEqual(achadas[0].details.fields, ['nome'], 'só os NOMES dos campos');
    assert.equal(achadas[0].target_name, `Titular ${sufixo}`);
    assert.equal(achadas[0].target_org_id, null, 'conta não tem OM DONA: o eixo é de recurso');
  });

  it('`PUT /users/me/password` produz PASSWORD_RESET, e `details` não carrega senha', async () => {
    assert.deepEqual(await linhas('PASSWORD_RESET', titular.id), []);

    await supertest(app).put('/api/v1/users/me/password')
      .set('Authorization', `Bearer ${tokenTitular}`)
      .send({ currentPassword: titular.password, newPassword: SENHA_NOVA })
      .expect(200);

    const achadas = await linhas('PASSWORD_RESET', titular.id);
    assert.equal(achadas.length, 1);
    assert.equal(achadas[0].details.self, true);

    const cru = JSON.stringify(achadas[0].details);
    assert.ok(!cru.includes(SENHA_NOVA), 'a senha NOVA não pode aparecer em details');
    assert.ok(!cru.includes(titular.password), 'a senha ANTIGA também não');
    assert.ok(!cru.includes('assword'), 'nem o nome dos campos de senha');
  });

  it('a DISCRIMINAÇÃO: o caminho ADMINISTRATIVO continua com a linha dele, sem `self`', async () => {
    const outro = await createUser(db, { username: `auto_outro_${sufixo}` });

    await supertest(app).put(`/api/v1/users/${outro.id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nome: `Outro ${sufixo}` })
      .expect(200);
    const edicao = await linhas('USER_UPDATE', outro.id);
    assert.equal(edicao.length, 1);
    assert.equal(edicao[0].actor_id, admin.id, 'o ator é o ADMINISTRADOR, não o alvo');
    assert.equal(edicao[0].details.self, undefined, '`self` ausente é o que distingue os dois');

    await supertest(app).post(`/api/v1/users/${outro.id}/reset-password`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ newPassword: 'OutraSenha@123' })
      .expect(200);
    const reset = await linhas('PASSWORD_RESET', outro.id);
    assert.equal(reset.length, 1);
    assert.equal(reset[0].actor_id, admin.id);
    assert.equal(reset[0].details?.self, undefined);
  });
});
