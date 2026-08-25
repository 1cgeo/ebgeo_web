// Path: tests/integration/tile-access-auth-request.test.js
//
// O ENDPOINT DE `auth_request` DO NGINX PARA AS ROTAS DO MARTIN (cláusula 10.7).
//
// O QUE ESTE ARQUIVO MEDE, E O QUE ELE NÃO PODE MEDIR. Ele mede que
// `GET /api/v1/auth/tile-access` responde 200 para uma chave de API viva de escopo que
// alcança tile, e 401 sem corpo para todo o resto. Ele NÃO mede privacidade por
// recurso, e não mede porque ela não existe neste desenho: a rota responde sobre a
// CREDENCIAL e nunca sobre a CAMADA, `fn_can_see_resource` não entra na história, e um
// usuário comum com chave viva alcança os bytes do tile de uma camada privada que o
// catálogo não lhe mostra. Isso está escrito no `fileoverview` de
// `src/modules/auth/tile-access.js` e repetido aqui de propósito: um arquivo de teste
// que não declara o próprio teto vira licença para acreditar que ele fecha mais do que
// fecha. E ele não mede NADA sobre o nginx: que o servidor de produção de fato exija a
// chave é sonda com data, rodada à mão no deploy, pela mesma razão que a 10.1 registra.
//
// A ARMADILHA DESTA MEDIÇÃO, e ela é específica. Quase toda recusa aqui nasce de um
// termo de `FIND_USER_BY_API_KEY` (prazo, revogação, conta ativa, OM ativa, corte de
// sessão): a chave não resolve, `flexibleAuth` deixa o pedido anônimo, e o gate desta
// rota recusa. Ou seja, os desfechos são o MESMO 401, e um caso poderia estar passando
// pelo motivo errado sem nada acusar. Foi exatamente isso que já aconteceu uma vez
// noutro lote: um caso de conta desativada media por rota de `auth` ESTRITO, onde o 401
// vem da reconciliação viva do middleware e não do predicado da chave — apagar o termo
// da consulta deixava a rodada inteira verde.
//
// AS DUAS DEFESAS, e as duas são necessárias:
//
//   1. ESTA ROTA NÃO TEM `auth` ESTRITO. Ela é só-`flexibleAuth` por decisão (o estrito
//      recusa a chave de escopo `tiles`), então não existe reconciliação viva no
//      caminho para produzir um 401 por outro motivo. É o oposto do caso citado acima.
//   2. TODO NEGATIVO VEM COM O PAR SOBRE A MESMA LINHA, e com um CONTROLE que roda o
//      predicado SEM o termo acusado e exige que a linha seja encontrada. O par prova
//      que só aquela coluna decide (a mesma chave passa quando ela vira); o controle
//      prova que a fixture não se desfez, que a conta existe e que "não achou" não está
//      sendo lido como "recusou".
//
// O motivo da recusa também sai em `X-EBGeo-Tile-Denial`, e ele é asserido: sem isso,
// "escopo que não alcança" e "chave que não resolve" seriam o mesmo 401.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, loginUser } from '../helpers/fixtures.js';
import { installPoolQueryCounter } from '../helpers/query-counter.js';
import { TILE_ACCESS_DENIAL } from '../../src/modules/auth/tile-access.js';

const SFX = randomUUID().slice(0, 8);
const ROTA = '/api/v1/auth/tile-access';

describe('tile-access: o `auth_request` do nginx para as rotas do Martin', () => {
  let app, db;
  let dono, donoToken;
  let orgId, lotado;

  /** O pedido do nginx: a chave viaja na QUERY, como o MapLibre a carrega. */
  const pedir = (chave) => supertest(app).get(chave === undefined ? ROTA : `${ROTA}?api_key=${chave}`);

  /**
   * Insere uma chave nomeada direto no banco.
   *
   * DIRETO, e não pela rota de emissão, porque cada caso negativo precisa controlar UMA
   * coluna e só ela (prazo, revogação, escopo). A rota de emissão é exercida à parte,
   * num caso próprio, para que a cadeia inteira também fique medida.
   */
  async function inserirChave(userId, { scope = 'tiles', vencida = false, revogada = false } = {}) {
    const chave = randomUUID();
    const { rows } = await db.query(
      `INSERT INTO api_keys (user_id, api_key, label, scope, created_at, expires_at, revoked_at)
       VALUES ($1, $2, $3, $4,
               CASE WHEN $5 THEN NOW() - INTERVAL '2 days' ELSE NOW() END,
               CASE WHEN $5 THEN NOW() - INTERVAL '1 day' ELSE NOW() + INTERVAL '30 days' END,
               CASE WHEN $6 THEN NOW() ELSE NULL END)
       RETURNING id`,
      [userId, chave, `tile ${SFX}`, scope, vencida, revogada]
    );
    return { id: rows[0].id, apiKey: chave };
  }

  /**
   * O CONTROLE DE CADA TERMO: o predicado de autenticação SEM a cláusula acusada.
   *
   * Se ele achar a linha, "não achou" está descartado e a recusa é do termo. Se ele NÃO
   * achar, o caso negativo estaria passando por acidente, e é isso que este helper
   * existe para tornar impossível.
   */
  const acharSemTermo = async (chave, sql, params = []) => (await db.query(sql, [chave, ...params])).rows;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    dono = await createUser(db, { username: `tile_dono_${SFX}` });
    donoToken = await loginUser(app, dono.username, dono.password);

    const { rows } = await db.query(
      'INSERT INTO organizations (nome, slug, sigla) VALUES ($1, $2, $3) RETURNING id',
      [`OM tile ${SFX}`, `om-tile-${SFX}`, `OMT${SFX.slice(0, 3)}`]
    );
    orgId = rows[0].id;
    lotado = await createUser(db, { username: `tile_lotado_${SFX}`, organization_id: orgId });
  });

  after(async () => {
    await db.query('DELETE FROM api_keys WHERE user_id = ANY($1::uuid[])', [[dono.id, lotado.id]]);
    await db.query('DELETE FROM audit_trail WHERE actor_id = ANY($1::uuid[])', [[dono.id, lotado.id]]);
    await db.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[dono.id, lotado.id]]);
    await db.query('DELETE FROM organizations WHERE id = $1', [orgId]);
    await teardownTestEnv(db);
  });

  // =========================================================================
  // O SIM
  // =========================================================================
  describe('o SIM: chave viva de escopo que alcança tile', () => {
    it('a chave de escopo `tiles` responde 200, e SEM CORPO', async () => {
      const chave = await inserirChave(dono.id, { scope: 'tiles' });
      const res = await pedir(chave.apiKey);

      assert.equal(res.status, 200);
      // O corpo vazio não é detalhe de estilo: o `auth_request` do nginx descarta o
      // corpo e só olha o status, então qualquer byte aqui é banda gasta POR TILE.
      assert.equal(res.text, '', 'a resposta precisa sair sem corpo');
      assert.equal(res.headers['content-type'], undefined, 'e sem Content-Type de payload');
    });

    it('DISCRIMINAÇÃO: essa MESMA chave é recusada na rota estrita, com 403', async () => {
      // Sem este par, "esta rota aceita a chave de tile" seria indistinguível de "todas
      // aceitam", e a razão de a rota ser só-flexível ficaria sem prova. 403 (e não 401)
      // diz que lá a chave RESOLVEU e o escopo a barrou, que é a amarra 2 de pé.
      const chave = await inserirChave(dono.id, { scope: 'tiles' });
      const estrita = await supertest(app).get('/api/v1/auth/me').set('x-api-key', chave.apiKey);
      assert.equal(estrita.status, 403, 'a rota estrita recusa a chave de tile');

      const aqui = await pedir(chave.apiKey);
      assert.equal(aqui.status, 200, 'e esta rota, que existe para ela, aceita');
    });

    it('o escopo `full` também alcança o tile: o vocabulário inteiro passa', async () => {
      // A tabela de alcance declara que as superfícies SÓ-FLEXÍVEIS são alcançadas por
      // toda chave que resolve. Sem este caso, o gate poderia estar comparando por
      // igualdade com `tiles` e ninguém saberia até um integrador reclamar.
      const chave = await inserirChave(dono.id, { scope: 'full' });
      const res = await pedir(chave.apiKey);
      assert.equal(res.status, 200);
    });

    it('o SLOT LEGADO (`users.api_key`) também abre o tile', async () => {
      const rot = await supertest(app)
        .post('/api/v1/users/me/api-key/rotate')
        .set('Authorization', `Bearer ${donoToken}`)
        .expect(200);
      const res = await pedir(rot.body.data.apiKey);
      assert.equal(res.status, 200, 'a chave que os integradores carregam hoje precisa continuar valendo');
    });

    it('a chave EMITIDA pela rota de auto-serviço abre o tile: a cadeia inteira fecha', async () => {
      const emissao = await supertest(app)
        .post('/api/v1/users/me/api-keys')
        .set('Authorization', `Bearer ${donoToken}`)
        .send({ label: `emitida ${SFX}`, scope: 'tiles' })
        .expect(201);

      const res = await pedir(emissao.body.data.apiKey);
      assert.equal(res.status, 200);
    });
  });

  // =========================================================================
  // O NÃO, um termo por caso
  // =========================================================================
  describe('o NÃO: cada recusa pelo termo que se acha que ela vem', () => {
    it('SEM `api_key` nenhuma: 401, e o motivo é `sem-chave-viva`', async () => {
      const res = await supertest(app).get(ROTA);
      assert.equal(res.status, 401);
      assert.equal(res.text, '', 'o NÃO também sai sem corpo');
      assert.equal(res.headers['x-ebgeo-tile-denial'], TILE_ACCESS_DENIAL.SEM_CHAVE_VIVA);
    });

    it('chave VENCIDA: 401, e a MESMA linha passa quando o prazo volta', async () => {
      const chave = await inserirChave(dono.id, { vencida: true });

      const vencida = await pedir(chave.apiKey);
      assert.equal(vencida.status, 401);
      assert.equal(vencida.headers['x-ebgeo-tile-denial'], TILE_ACCESS_DENIAL.SEM_CHAVE_VIVA);

      // CONTROLE DO TERMO: o predicado sem `expires_at > NOW()` acha a linha. Logo a
      // recusa é do prazo, e não de a chave não existir ou de a conta ter sumido.
      const semPrazo = await acharSemTermo(
        chave.apiKey,
        'SELECT id FROM api_keys WHERE api_key = $1 AND revoked_at IS NULL'
      );
      assert.equal(semPrazo.length, 1, 'a linha existe e não está revogada: só o prazo a exclui');

      // O PAR SOBRE A MESMA LINHA.
      await db.query(
        `UPDATE api_keys SET created_at = NOW(), expires_at = NOW() + INTERVAL '30 days' WHERE id = $1`,
        [chave.id]
      );
      const viva = await pedir(chave.apiKey);
      assert.equal(viva.status, 200, 'restaurado o prazo, a MESMA chave abre o tile');
    });

    it('chave REVOGADA: 401, e a MESMA linha passa quando a revogação sai', async () => {
      const chave = await inserirChave(dono.id, { revogada: true });

      const revogada = await pedir(chave.apiKey);
      assert.equal(revogada.status, 401);
      assert.equal(revogada.headers['x-ebgeo-tile-denial'], TILE_ACCESS_DENIAL.SEM_CHAVE_VIVA);

      // CONTROLE DO TERMO: sem `revoked_at IS NULL` a linha aparece, viva e no prazo.
      const semRevogacao = await acharSemTermo(
        chave.apiKey,
        'SELECT id FROM api_keys WHERE api_key = $1 AND expires_at > NOW()'
      );
      assert.equal(semRevogacao.length, 1, 'a linha existe e está no prazo: só a revogação a exclui');

      await db.query('UPDATE api_keys SET revoked_at = NULL WHERE id = $1', [chave.id]);
      const viva = await pedir(chave.apiKey);
      assert.equal(viva.status, 200, 'desfeita a revogação, a MESMA chave abre o tile');
    });

    it('chave de conta DESATIVADA: 401, e a MESMA chave passa quando a conta volta', async () => {
      const chave = await inserirChave(dono.id);
      const antes = await pedir(chave.apiKey);
      assert.equal(antes.status, 200, 'com a conta ativa, a chave abre o tile');

      await db.query('UPDATE users SET is_active = false WHERE id = $1', [dono.id]);
      const depois = await pedir(chave.apiKey);
      assert.equal(depois.status, 401);
      assert.equal(depois.headers['x-ebgeo-tile-denial'], TILE_ACCESS_DENIAL.SEM_CHAVE_VIVA);

      // CONTROLE DO TERMO: a chave continua viva, no prazo e não revogada; quem a exclui
      // é `u.is_active = true` do JOIN, e não um gate de sessão — esta rota não tem `auth`
      // estrito, então a reconciliação viva não roda aqui.
      const semConta = await acharSemTermo(
        chave.apiKey,
        'SELECT id FROM api_keys WHERE api_key = $1 AND revoked_at IS NULL AND expires_at > NOW()'
      );
      assert.equal(semConta.length, 1, 'a chave está viva: quem recusa é a conta');

      await db.query('UPDATE users SET is_active = true WHERE id = $1', [dono.id]);
      const devolta = await pedir(chave.apiKey);
      assert.equal(devolta.status, 200, 'reativada a conta, a MESMA chave abre o tile');
    });

    it('chave de OM INATIVA: 401, e a MESMA chave passa quando a OM volta', async () => {
      const chave = await inserirChave(lotado.id);
      const antes = await pedir(chave.apiKey);
      assert.equal(antes.status, 200, 'com a OM ativa, a chave abre o tile');

      await db.query('UPDATE organizations SET is_active = false WHERE id = $1', [orgId]);
      const depois = await pedir(chave.apiKey);
      assert.equal(depois.status, 401);
      assert.equal(depois.headers['x-ebgeo-tile-denial'], TILE_ACCESS_DENIAL.SEM_CHAVE_VIVA);

      // CONTROLE DO TERMO: a conta segue ativa e a chave viva; quem exclui é o
      // `COALESCE(o.is_active, true)` que viaja dentro de `FIND_USER_BY_API_KEY`.
      const semOm = await acharSemTermo(
        chave.apiKey,
        `SELECT k.id FROM api_keys k JOIN users u ON u.id = k.user_id
          WHERE k.api_key = $1 AND k.revoked_at IS NULL AND k.expires_at > NOW() AND u.is_active = true`
      );
      assert.equal(semOm.length, 1, 'a chave está viva e a conta ativa: quem recusa é a OM');

      await db.query('UPDATE organizations SET is_active = true WHERE id = $1', [orgId]);
      const devolta = await pedir(chave.apiKey);
      assert.equal(devolta.status, 200, 'reativada a OM, a MESMA chave abre o tile');
    });

    it('sessão de COOKIE/Bearer sem chave nenhuma: 401', async () => {
      // A rota valida a credencial que o TILE carrega, e o MapLibre não põe cabeçalho
      // num pedido de tile. Uma sessão JWT que chegasse aqui e passasse tornaria o gate
      // dependente de uma credencial que o pedido do tile pode não ter, e esconderia o
      // passo que ainda falta: distribuir a chave ao cliente.
      const res = await supertest(app).get(ROTA).set('Authorization', `Bearer ${donoToken}`);
      assert.equal(res.status, 401);
      assert.equal(res.headers['x-ebgeo-tile-denial'], TILE_ACCESS_DENIAL.SEM_CHAVE_VIVA);

      // DISCRIMINAÇÃO: a mesma sessão vale onde ela deve valer.
      const me = await supertest(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${donoToken}`);
      assert.equal(me.status, 200, 'a sessão é boa; ela apenas não é a credencial deste endpoint');
    });
  });

  // =========================================================================
  // O CUSTO POR TILE
  // =========================================================================
  describe('o custo: é uma subrequisição POR TILE', () => {
    it('LIXO na query não consulta o banco: zero statements', async () => {
      const contador = installPoolQueryCounter();
      try {
        contador.reset();
        const res = await pedir('nao-e-um-uuid');
        assert.equal(res.status, 401);
        assert.equal(res.headers['x-ebgeo-tile-denial'], TILE_ACCESS_DENIAL.SEM_CHAVE_VIVA);
        assert.equal(
          contador.state.count, 0,
          `a peneira de UUID de flexibleAuth precisa devolver o passante ANTES do banco; `
          + `statements: ${contador.state.statements.join(' | ')}`
        );
      } finally {
        contador.restore();
      }
    });

    it('a chave viva custa UMA consulta, e o handler não faz I/O nenhum', async () => {
      // O NÚMERO É O ASSUNTO DESTE CASO, não um detalhe: são milhares de tiles por
      // sessão, e uma consulta a mais aqui multiplica por esse fator. Sem este caso, um
      // gate futuro que resolvesse o recurso entraria sem nada acusar.
      const chave = await inserirChave(dono.id);
      const contador = installPoolQueryCounter();
      try {
        contador.reset();
        const res = await pedir(chave.apiKey);
        assert.equal(res.status, 200);
        assert.equal(
          contador.state.count, 1,
          `esperava UMA consulta (a de flexibleAuth); statements: ${contador.state.statements.join(' | ')}`
        );
        // O contador guarda os 70 primeiros caracteres do statement, então a âncora é o
        // CABEÇALHO de `FIND_USER_BY_API_KEY` e não o corpo dele.
        assert.match(
          contador.state.statements[0], /api_key_id/,
          `e a consulta precisa ser a de autenticação da chave; achei: ${contador.state.statements[0]}`
        );
      } finally {
        contador.restore();
      }
    });
  });
});
