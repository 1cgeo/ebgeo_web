// Path: tests/integration/resource-grants-revogacao-credenciado.test.js
//
// QUEM REVOGA O QUÊ (fase F9, item 3).
//
// A REGRA NOVA, em uma frase: o administrador revoga qualquer concessão; qualquer
// outro ator revoga só as que ELE concedeu.
//
// O QUE ERA. `requireGrantRevoker` consultava `fn_has_global_data_access` ANTES de
// olhar `granted_by`, e aquela função inclui o CREDENCIADO — o papel definido em
// 001_identidade.sql como "LÊ todo recurso privado do sistema e NÃO ESCREVE
// NADA". Ele derrubava, portanto, a concessão de qualquer pessoa, com a subárvore
// junto (a poda alcança os filhos, então o estrago passa longe da linha apontada).
//
// O QUE NÃO MUDA, e é metade do desenho: CONCEDER continua igual. O credenciado
// concede nos dois níveis (`view` e `view_share`) por `requireResourceShare`, que
// segue consultando o papel global. O par "concede e revoga O QUE ELE DEU" é a
// decisão do dono; fechar a concessão também seria outra decisão, e não esta.
//
// A DISCRIMINAÇÃO QUE ESTE ARQUIVO PRECISA TER, e por que ela é peculiar aqui:
// `revokeGrant` passa a ser a ÚNICA operação do módulo em que credenciado ≠ admin.
// Um teste que só mostrasse "o credenciado leva 403" seria indistinguível de um
// sistema em que NINGUÉM revoga; por isso todo caso negativo abaixo é seguido do
// positivo do mesmo par, com a mesma linha de concessão.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, loginUser } from '../helpers/fixtures.js';

describe('F9 — revogar é de quem concedeu (ou do administrador)', () => {
  let app, db, admin, credenciado, cedente, beneficiario;
  let tokenAdmin, tokenCredenciado, tokenCedente;
  const sufixo = randomUUID().slice(0, 8);
  const TILESET = `rev-${sufixo}`;

  /** Concede `TILESET` a `granteeId` com o token dado, e devolve a linha criada. */
  const conceder = async (token, granteeId, grantLevel = 'view') => {
    const res = await supertest(app)
      .post(`/api/v1/resource-access/tileset/${TILESET}/grants`)
      .set('Authorization', `Bearer ${token}`)
      .send({ granteeId, grantLevel })
      .expect(201);
    return res.body.data;
  };

  const revogar = (token, grantId) =>
    supertest(app)
      .delete(`/api/v1/resource-access/grants/${grantId}`)
      .set('Authorization', `Bearer ${token}`);

  const viva = async (grantId) => {
    const { rows } = await db.query(
      'SELECT revoked_at FROM resource_grants WHERE id = $1::uuid', [grantId]
    );
    return rows.length === 1 && rows[0].revoked_at === null;
  };

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    admin = await createAdminUser(db, { username: `rev_admin_${sufixo}` });
    credenciado = await createUser(db, { username: `rev_cred_${sufixo}`, role: 'credenciado' });
    cedente = await createUser(db, { username: `rev_ced_${sufixo}` });
    beneficiario = await createUser(db, { username: `rev_ben_${sufixo}` });
    tokenAdmin = await loginUser(app, admin.username, admin.password);
    tokenCredenciado = await loginUser(app, credenciado.username, credenciado.password);
    tokenCedente = await loginUser(app, cedente.username, cedente.password);

    await db.query(
      `INSERT INTO tilesets (id, name, config, sort_order, access_level)
       VALUES ($1, $2, '{"url":"/x"}'::jsonb, 0, 'private')`,
      [TILESET, `Tileset revogação ${sufixo}`]
    );
  });

  after(async () => {
    await db.query('DELETE FROM resource_grants WHERE resource_id = $1', [TILESET]);
    await db.query('DELETE FROM tilesets WHERE id = $1', [TILESET]);
    await db.query('DELETE FROM users WHERE username LIKE $1', [`rev\\_%\\_${sufixo}`]);
    await teardownTestEnv(db);
  });

  it('NEGATIVO — o credenciado NÃO revoga a concessão de outra pessoa', async () => {
    const doAdmin = await conceder(tokenAdmin, beneficiario.id);
    assert.ok(await viva(doAdmin.id), 'piso: a concessão nasceu viva');

    const res = await revogar(tokenCredenciado, doAdmin.id).expect(403);
    assert.match(String(res.body.error?.message ?? res.body.error ?? ''), /concedeu|administrador/i);

    // O QUE O 403 TEM DE PROVAR não é o código, é que a linha continua de pé: um gate
    // que recusasse DEPOIS de escrever `revoked_at` responderia o mesmo 403.
    assert.ok(await viva(doAdmin.id), 'a concessão de terceiro continua viva depois do 403');

    // O PAR: o administrador, no mesmo instante e sobre a MESMA linha, revoga.
    await revogar(tokenAdmin, doAdmin.id).expect(200);
    assert.equal(await viva(doAdmin.id), false);
  });

  it('POSITIVO — o credenciado revoga O QUE ELE DEU (conceder não mudou)', async () => {
    // Metade do desenho: `requireResourceShare` continua consultando o papel global,
    // então o credenciado CONCEDE de raiz. Se este 201 virar 403, a fase mexeu no gate
    // errado.
    const dele = await conceder(tokenCredenciado, beneficiario.id);
    assert.equal(dele.parent_grant_id, null, 'papel global concede de RAIZ');
    assert.equal(dele.granted_by, credenciado.id);

    await revogar(tokenCredenciado, dele.id).expect(200);
    assert.equal(await viva(dele.id), false);
  });

  it('o mesmo vale para o usuário COMUM: ele revoga a sua, e não a alheia', async () => {
    // O ramo estreito não pergunta papel nenhum, pergunta AUTORIA — e é por isso que a
    // regra vale igual para quem repassou por `view_share`. Sem este caso, "o
    // credenciado perdeu o curinga" seria indistinguível de "só admin revoga".
    const paraOCedente = await conceder(tokenAdmin, cedente.id, 'view_share');
    const doCedente = await conceder(tokenCedente, beneficiario.id);

    // A dele: passa.
    await revogar(tokenCedente, doCedente.id).expect(200);
    assert.equal(await viva(doCedente.id), false);

    // A do administrador sobre ELE MESMO: 403, e continua de pé.
    await revogar(tokenCedente, paraOCedente.id).expect(403);
    assert.ok(await viva(paraOCedente.id));

    await revogar(tokenAdmin, paraOCedente.id).expect(200);
  });

  it('404 para concessão inexistente, e o 404 vem ANTES de qualquer decisão de papel', async () => {
    // A ordem importa: perguntar o papel primeiro e devolver 403 para um id que não
    // existe entregaria a existência de linhas de graça a quem sondasse.
    await revogar(tokenAdmin, randomUUID()).expect(404);
    await revogar(tokenCredenciado, randomUUID()).expect(404);
    await revogar(tokenCedente, randomUUID()).expect(404);
  });

  it('o gate resolve o papel NO BANCO: rebaixar o admin fecha a porta na mesma requisição', async () => {
    // `GRANT_REVOKER_ACTOR` consulta `users.role` a partir do UUID em vez de ler
    // `req.user.role`, e este é o caso que separa as duas leituras. O token continua
    // válido e continua dizendo `role: 'admin'`; o banco diz outra coisa, e é o banco
    // que decide.
    //
    // A LINHA ALVO É DE OUTRA PESSOA, e essa escolha é o próprio ponto: sobre uma
    // concessão que o admin tivesse concedido, o ramo de AUTORIA passaria sozinho e o
    // caso mediria o papel sem nunca depender dele — verde inútil.
    const deTerceiro = await conceder(tokenCredenciado, beneficiario.id);
    await db.query(`UPDATE users SET role = 'user' WHERE id = $1`, [admin.id]);
    try {
      await revogar(tokenAdmin, deTerceiro.id).expect(403);
      assert.ok(await viva(deTerceiro.id));
    } finally {
      await db.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [admin.id]);
    }
    // E o par, com o papel de volta: a MESMA requisição passa.
    await revogar(tokenAdmin, deTerceiro.id).expect(200);
  });

  it('conta desativada não revoga nem o que ela mesma concedeu', async () => {
    // O `EXISTS` do papel cobra `is_active`, e o ramo de autoria não cobra nada — mas
    // `auth` estrito recusa a conta desativada antes disso. O caso existe para que a
    // camada que de fato barra fique escrita: se alguém trocar `auth` por
    // `flexibleAuth` nesta rota, este vira o único caso vermelho.
    // O cedente precisa do `view_share` de volta: o caso anterior revogou o dele.
    await conceder(tokenAdmin, cedente.id, 'view_share');
    const dele = await conceder(tokenCedente, beneficiario.id);
    await db.query('UPDATE users SET is_active = false WHERE id = $1', [cedente.id]);
    try {
      // 401, e nao 403: `auth` estrito recarrega o estado vivo da conta e trata
      // desativacao como problema de AUTENTICACAO, para o cliente derrubar a sessao.
      await revogar(tokenCedente, dele.id).expect(401);
      assert.ok(await viva(dele.id));
    } finally {
      await db.query('UPDATE users SET is_active = true WHERE id = $1', [cedente.id]);
    }
  });
});
