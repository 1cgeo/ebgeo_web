// Path: tests/integration/chave-de-api-tres-amarras.test.js
//
// AS TRÊS AMARRAS DA CHAVE DE API (cláusula 10.7): prazo, escopo e revogação individual.
//
// POR QUE ESTE ARQUIVO EXISTE ANTES DO `location` DO NGINX. O dono decidiu em 2026-08-23
// que a chave de API passa a ser a credencial que o nginx valida nas rotas do servidor de
// tiles — é a saída para o defeito da 10.1, os bytes do tile privado sem gate. A
// consequência é que uma credencial que hoje um punhado de integradores carrega passaria
// a viajar na URL de CADA TILE, para dentro do log de acesso do nginx e de todo cache
// compartilhado. A frase que ordena o trabalho está em `PENDENCIA-TILE-PRIVADO.md`:
// "ligar o `location` antes das três amarras troca um vazamento por uma sessão de
// administrador sem prazo".
//
// O QUE ESTE ARQUIVO NÃO ALCANÇA, dito em voz alta porque censo que não declara o próprio
// teto vira licença para acreditar nele: ele não diz nada sobre o nginx. Que o servidor
// de produção de fato exija a chave nas rotas do Martin é sonda com data, rodada à mão no
// deploy e anotada, pela mesma razão que a 10.1 já registra.
//
// A FORMA DE CADA PAR. Todo caso negativo vem com o positivo do MESMO principal, nunca
// comparando duas pessoas: sem o par, o negativo passaria idêntico se a fixture não
// existisse, se a rota tivesse sumido ou se o predicado passasse a negar tudo. E a
// distinção 401/403 é usada de propósito como instrumento — 401 significa que a chave NÃO
// RESOLVEU (o pedido virou anônimo), 403 significa que ela resolveu e a superfície a
// recusou. Os dois desfechos são recusa, e confundi-los esconderia metade dos defeitos.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, loginUser } from '../helpers/fixtures.js';
import { API_KEY_TERM_MAX_DAYS } from '../../src/modules/users/api-key-terms.js';
import { FIND_USER_BY_API_KEY } from '../../src/modules/users/users.queries.js';

const SFX = randomUUID().slice(0, 8);
const DIA_MS = 24 * 60 * 60 * 1000;

describe('Chave de API: prazo, escopo e revogação individual', () => {
  let app, db;
  let dono, donoToken, admin, adminToken;

  /** Emite uma chave nomeada pela rota de auto-serviço, com a sessão do titular. */
  async function emitir(token, corpo) {
    const res = await supertest(app)
      .post('/api/v1/users/me/api-keys')
      .set('Authorization', `Bearer ${token}`)
      .send(corpo);
    assert.equal(res.status, 201, `emissão falhou: ${JSON.stringify(res.body)}`);
    return res.body.data;
  }

  /** A rota ESTRITA mais barata do sistema, e a que os testes de chave já usavam. */
  const comChave = (chave) => supertest(app).get('/api/v1/auth/me').set('x-api-key', chave);

  /** Envelhece uma chave nomeada respeitando `api_keys_expires_at_check`. */
  const vencer = (id) => db.query(
    `UPDATE api_keys SET created_at = NOW() - INTERVAL '2 days', expires_at = NOW() - INTERVAL '1 day'
      WHERE id = $1`,
    [id]
  );

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    dono = await createUser(db, { username: `chave_dono_${SFX}` });
    donoToken = await loginUser(app, dono.username, dono.password);

    admin = await createAdminUser(db, { username: `chave_adm_${SFX}` });
    adminToken = await loginUser(app, admin.username, admin.password);
  });

  after(async () => {
    await db.query('DELETE FROM api_keys WHERE user_id = ANY($1::uuid[])', [[dono.id, admin.id]]);
    await db.query('DELETE FROM audit_trail WHERE actor_id = ANY($1::uuid[])', [[dono.id, admin.id]]);
    await db.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[dono.id, admin.id]]);
    await teardownTestEnv(db);
  });

  // =========================================================================
  // AMARRA 1 — PRAZO
  // =========================================================================
  describe('AMARRA 1: a chave tem validade, e ela morre no PREDICADO', () => {
    it('CONTROLE POSITIVO: a chave viva de escopo `full` autentica na rota estrita', async () => {
      const chave = await emitir(donoToken, { label: 'viva', scope: 'full' });
      const res = await comChave(chave.apiKey);
      assert.equal(res.status, 200);
      assert.equal(res.body.data.id, dono.id, 'e resolve para a pessoa certa');
    });

    it('a chave VENCIDA não autentica, e a mesma chave autenticava um instante antes', async () => {
      const chave = await emitir(donoToken, { label: 'a vencer', scope: 'full' });

      // O POSITIVO E O NEGATIVO SOBRE A MESMA LINHA. Sem o primeiro, o 401 abaixo seria
      // indistinguível de uma chave que nunca funcionou.
      const antes = await comChave(chave.apiKey);
      assert.equal(antes.status, 200, 'antes de vencer, a chave vale');

      await vencer(chave.id);

      const depois = await comChave(chave.apiKey);
      assert.equal(depois.status, 401, 'vencida, a chave não resolve: o pedido vira anônimo');
    });

    it('CONTROLE NEGATIVO: a linha continua lá, e é só o termo de prazo que a exclui', async () => {
      const chave = await emitir(donoToken, { label: 'controle de prazo', scope: 'full' });
      await vencer(chave.id);

      // Byte a byte o predicado SEM o prazo. Ele achar a linha é o que prova que a conta
      // está ativa, que a chave é a certa e que nada da fixture se desfez — sem isto,
      // "não achou" e "recusou" são a mesma resposta.
      const semPrazo = await db.query(
        'SELECT id FROM api_keys WHERE api_key = $1 AND revoked_at IS NULL',
        [chave.apiKey]
      );
      assert.equal(semPrazo.rows.length, 1, 'a linha continua no banco, não revogada');

      const comPrazo = await db.query(
        'SELECT id FROM api_keys WHERE api_key = $1 AND revoked_at IS NULL AND expires_at > NOW()',
        [chave.apiKey]
      );
      assert.equal(comPrazo.rows.length, 0, 'e o predicado vigente a exclui, pelo prazo e por mais nada');
    });

    it('o TETO de um ano é do BANCO, e o pedido maior é aparado em vez de recusado', async () => {
      const chave = await emitir(donoToken, { label: 'pedido absurdo', scope: 'full', expiresInDays: 3000 });
      const dias = (new Date(chave.expiresAt).getTime() - Date.now()) / DIA_MS;
      assert.ok(dias > API_KEY_TERM_MAX_DAYS - 2, `esperava ~${API_KEY_TERM_MAX_DAYS} dias, achei ${dias}`);
      assert.ok(dias < API_KEY_TERM_MAX_DAYS + 1, `o pedido de 3000 dias precisa virar o teto, achei ${dias}`);
    });

    it('e o CHECK recusa a linha de dois anos escrita FORA da borda', async () => {
      // O aparo em JS é conveniência de tela; a garantia é o CHECK, que nenhum caminho de
      // escrita contorna. Sem este caso, apagar `clampApiKeyTermDays` deixaria o teto
      // valendo só para quem passa pela rota.
      let recusou = false;
      try {
        await db.query(
          `INSERT INTO api_keys (user_id, api_key, label, scope, expires_at)
           VALUES ($1, gen_random_uuid(), 'dois anos', 'full', NOW() + INTERVAL '2 years')`,
          [dono.id]
        );
      } catch (err) {
        recusou = String(err.message).includes('api_keys_expires_at_check');
      }
      assert.equal(recusou, true, 'o CHECK precisa recusar o prazo de dois anos, nomeando a constraint');

      // DISCRIMINAÇÃO: 364 dias entram. Sem isto, um CHECK que recusasse TUDO passaria
      // o caso acima.
      const ok = await db.query(
        `INSERT INTO api_keys (user_id, api_key, label, scope, expires_at)
         VALUES ($1, gen_random_uuid(), 'quase um ano', 'full', NOW() + INTERVAL '364 days')
         RETURNING id`,
        [dono.id]
      );
      assert.equal(ok.rows.length, 1, 'o prazo dentro do teto precisa ser aceito');
    });

    it('o SLOT LEGADO também ganhou prazo, e a rotação o renova', async () => {
      // `users.api_key` é a chave que os integradores carregam hoje. Ela não podia ficar
      // permanente, e não podia deixar de funcionar: a migração deu noventa dias a toda
      // linha e a rotação renova.
      const rot = await supertest(app)
        .post('/api/v1/users/me/api-key/rotate')
        .set('Authorization', `Bearer ${donoToken}`)
        .expect(200);
      const legada = rot.body.data.apiKey;

      const viva = await comChave(legada);
      assert.equal(viva.status, 200, 'recém-rotacionada, a chave legada vale');

      const { rows } = await db.query('SELECT api_key_expires_at FROM users WHERE id = $1', [dono.id]);
      assert.equal(rows.length, 1);
      assert.ok(rows[0].api_key_expires_at, 'a rotação precisa ter carimbado um prazo');

      // Envelhecida, ela para de valer — e volta a valer quando o relógio volta, o que
      // prova que a recusa é do PRAZO e não da chave.
      await db.query(
        `UPDATE users SET api_key_created_at = NOW() - INTERVAL '400 days',
                          api_key_expires_at = NOW() - INTERVAL '1 day' WHERE id = $1`,
        [dono.id]
      );
      const vencida = await comChave(legada);
      assert.equal(vencida.status, 401, 'vencido, o slot legado não autentica');

      await db.query(
        `UPDATE users SET api_key_created_at = NOW(),
                          api_key_expires_at = NOW() + INTERVAL '90 days' WHERE id = $1`,
        [dono.id]
      );
      const devolta = await comChave(legada);
      assert.equal(devolta.status, 200, 'restaurado o prazo, a MESMA chave volta a valer');
    });
  });

  // =========================================================================
  // AMARRA 2 — ESCOPO
  // =========================================================================
  describe('AMARRA 2: a chave nomeia o que alcança, e nenhuma alcança administração', () => {
    it('a chave de escopo `tiles` RESOLVE e mesmo assim é recusada na rota estrita', async () => {
      const chave = await emitir(donoToken, { label: 'só tile', scope: 'tiles' });
      const res = await comChave(chave.apiKey);

      // 403, E NÃO 401, é o assert que importa: 401 seria uma chave que não resolveu, e o
      // caso passaria idêntico com a chave malformada, com a conta apagada ou com o
      // predicado negando tudo. 403 diz que o principal existe e que o ESCOPO o barrou.
      assert.equal(res.status, 403, 'a chave de tile não alcança rota que exige sessão');
      assert.match(res.body.error.message, /chave de API/i, 'e a recusa nomeia a credencial');
    });

    it('DISCRIMINAÇÃO: a mesma emissão com escopo `full` passa na mesma rota', async () => {
      // Sem este par, "recusa a chave de tile" seria indistinguível de "recusa toda chave".
      const chave = await emitir(donoToken, { label: 'sessão inteira', scope: 'full' });
      const res = await comChave(chave.apiKey);
      assert.equal(res.status, 200);
    });

    it('o escopo PADRÃO da emissão é o de tile: o alcance largo precisa ser pedido', async () => {
      const chave = await emitir(donoToken, { label: 'sem escopo declarado' });
      assert.equal(chave.scope, 'tiles', 'quem não pede escopo recebe o mais estreito');
    });

    it('a chave de um ADMINISTRADOR é recusada na rota de administração', async () => {
      // O CASO QUE A CLÁUSULA 10.7 NOMEIA: "uma chave que vaza de um log de tile é uma
      // sessão de administrador sem prazo". Escopo `full`, que é o mais largo que existe,
      // e ainda assim 403.
      const chave = await emitir(adminToken, { label: 'chave do administrador', scope: 'full' });

      const naAdmin = await supertest(app).get('/api/v1/users').set('x-api-key', chave.apiKey);
      assert.equal(naAdmin.status, 403, 'nenhuma chave configura o sistema');
      assert.match(naAdmin.body.error.message, /chave de API/i);

      // O PAR, EM DOIS SENTIDOS. A MESMA chave alcança a rota estrita comum (logo ela está
      // viva, e a recusa acima é da superfície, não da credencial)...
      const naComum = await comChave(chave.apiKey);
      assert.equal(naComum.status, 200, 'a mesma chave continua valendo fora da administração');

      // ...e a MESMA pessoa, com sessão, alcança a rota de administração (logo o papel
      // está de pé, e a recusa acima não é falta de posto).
      const comSessao = await supertest(app)
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`);
      assert.equal(comSessao.status, 200, 'com sessão, o administrador administra');
    });
  });

  // =========================================================================
  // AMARRA 3 — REVOGAÇÃO QUE NÃO É A ROTAÇÃO
  // =========================================================================
  describe('AMARRA 3: revogar UMA chave não derruba as irmãs', () => {
    it('duas chaves vivas, uma revogada: a outra continua autenticando', async () => {
      const integracaoA = await emitir(donoToken, { label: 'integração A', scope: 'full' });
      const integracaoB = await emitir(donoToken, { label: 'integração B', scope: 'full' });

      // AS DUAS ANTES. Sem isto, a sobrevivente do fim poderia estar sobrevivendo por
      // nunca ter funcionado.
      assert.equal((await comChave(integracaoA.apiKey)).status, 200, 'A vale antes');
      assert.equal((await comChave(integracaoB.apiKey)).status, 200, 'B vale antes');

      const del = await supertest(app)
        .delete(`/api/v1/users/me/api-keys/${integracaoA.id}`)
        .set('Authorization', `Bearer ${donoToken}`);
      assert.equal(del.status, 200);
      assert.equal(del.body.data.label, 'integração A', 'a resposta nomeia a chave que caiu');

      assert.equal((await comChave(integracaoA.apiKey)).status, 401, 'a revogada não autentica mais');
      assert.equal(
        (await comChave(integracaoB.apiKey)).status, 200,
        'A IRMÃ CONTINUA DE PÉ: é isto que a rotação não sabia fazer'
      );
    });

    it('revogar duas vezes é 404, e a hora da primeira revogação não é reescrita', async () => {
      const chave = await emitir(donoToken, { label: 'revogada duas vezes', scope: 'full' });
      await supertest(app)
        .delete(`/api/v1/users/me/api-keys/${chave.id}`)
        .set('Authorization', `Bearer ${donoToken}`)
        .expect(200);

      const { rows: primeira } = await db.query('SELECT revoked_at FROM api_keys WHERE id = $1', [chave.id]);
      assert.equal(primeira.length, 1);

      const segunda = await supertest(app)
        .delete(`/api/v1/users/me/api-keys/${chave.id}`)
        .set('Authorization', `Bearer ${donoToken}`);
      assert.equal(segunda.status, 404, 'a segunda revogação não acha linha viva para revogar');

      const { rows: depois } = await db.query('SELECT revoked_at FROM api_keys WHERE id = $1', [chave.id]);
      assert.equal(depois.length, 1);
      assert.equal(
        depois[0].revoked_at.getTime(), primeira[0].revoked_at.getTime(),
        'QUANDO a chave caiu é o dado da investigação, e não pode ser sobrescrito'
      );
    });

    it('ninguém revoga a chave alheia por auto-serviço, e o dono revoga a mesma linha', async () => {
      const chave = await emitir(adminToken, { label: 'do administrador', scope: 'full' });

      // O `user_id` viaja no WHERE do UPDATE, e não só no gate da rota.
      const intruso = await supertest(app)
        .delete(`/api/v1/users/me/api-keys/${chave.id}`)
        .set('Authorization', `Bearer ${donoToken}`);
      assert.equal(intruso.status, 404, 'a linha existe, mas não é dele: 404 sem oráculo');

      // A DISCRIMINAÇÃO: a mesma linha, pelo dono, cai. Sem isto, o 404 acima passaria
      // idêntico com um id inexistente.
      const legitimo = await supertest(app)
        .delete(`/api/v1/users/me/api-keys/${chave.id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      assert.equal(legitimo.status, 200);
    });

    it('o administrador revoga a chave de terceiro (contenção de incidente)', async () => {
      const chave = await emitir(donoToken, { label: 'vazada', scope: 'tiles' });
      const res = await supertest(app)
        .delete(`/api/v1/users/${dono.id}/api-keys/${chave.id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      assert.equal(res.status, 200);

      const { rows } = await db.query('SELECT revoked_by FROM api_keys WHERE id = $1', [chave.id]);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].revoked_by, admin.id, 'a linha registra QUEM revogou');
    });

    it('a listagem mostra as mortas junto das vivas, e NUNCA o segredo', async () => {
      const res = await supertest(app)
        .get('/api/v1/users/me/api-keys')
        .set('Authorization', `Bearer ${donoToken}`);
      assert.equal(res.status, 200);
      assert.ok(res.body.data.length >= 2, 'a fixture já emitiu várias chaves para esta conta');

      const comSegredo = res.body.data.filter((k) => k.api_key !== undefined || k.apiKey !== undefined);
      assert.deepEqual(
        comSegredo, [],
        'o segredo sai UMA vez, na emissão: uma listagem que o devolvesse faria de toda '
        + 'leitura de perfil um vazamento de credencial'
      );

      const vivas = res.body.data.filter((k) => k.viva === true);
      const mortas = res.body.data.filter((k) => k.viva === false);
      assert.ok(vivas.length >= 1, 'precisa haver chave viva na lista');
      assert.ok(mortas.length >= 1, 'e chave morta: quem investiga precisa ver que ela existiu');
    });

    it('o CORTE DE SESSÃO em massa alcança a chave, que não tem `iat` para comparar', async () => {
      // O terceiro item da cláusula 10.7: "ela não cai no corte de sessão em massa, porque
      // aquele corte compara o `iat` de um JWT". A comparação passou a ser com o
      // NASCIMENTO da chave, que existe nas duas moradas.
      const chave = await emitir(donoToken, { label: 'antes do corte', scope: 'full' });
      assert.equal((await comChave(chave.apiKey)).status, 200, 'antes do corte, vale');

      await db.query('UPDATE users SET sessions_valid_from = NOW() WHERE id = $1', [dono.id]);
      assert.equal((await comChave(chave.apiKey)).status, 401, 'depois do corte, não vale');

      // CONTROLE NEGATIVO: a linha não foi revogada nem venceu. Só o corte a exclui.
      const { rows } = await db.query(
        'SELECT revoked_at, expires_at > NOW() AS no_prazo FROM api_keys WHERE api_key = $1',
        [chave.apiKey]
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].revoked_at, null, 'não foi revogada');
      assert.equal(rows[0].no_prazo, true, 'nem venceu');

      // E desfeito o corte, a MESMA chave volta: a recusa é de ESTADO, não de chave.
      await db.query('UPDATE users SET sessions_valid_from = NULL WHERE id = $1', [dono.id]);
      assert.equal((await comChave(chave.apiKey)).status, 200, 'desfeito o corte, volta a valer');
    });
  });

  // =========================================================================
  // A AMARRA QUE JÁ EXISTIA, e que continua valendo depois das outras três
  // =========================================================================
  // A MEDIÇÃO POR HTTP AQUI SERIA FANTASMA, e isso foi MEDIDO, não suposto: apagar
  // `u.is_active = true` de `FIND_USER_BY_API_KEY` deixa a rodada inteira VERDE, porque
  // `/auth/me` é rota de `auth` ESTRITO e a reconciliação viva (`getLiveAuthState`)
  // responde 401 'Account is inactive' antes que a falta do termo apareça. É a mesma
  // assimetria que `chave-de-api-exige-om-ativa.test.js` documenta para a OM, e a mesma
  // saída: além do par por HTTP (que descreve o que a pessoa vê), o caso confere a
  // CONSULTA, com o par "sem o termo acha / com o termo não acha".
  describe('a conta desativada derruba a chave, como sempre derrubou', () => {
    it('chave de conta desativada não autentica, e volta a autenticar na reativação', async () => {
      const vitima = await createUser(db, { username: `chave_off_${SFX}` });
      const token = await loginUser(app, vitima.username, vitima.password);
      const chave = await emitir(token, { label: 'conta a desativar', scope: 'full' });

      assert.equal((await comChave(chave.apiKey)).status, 200, 'com a conta ativa, vale');

      await db.query('UPDATE users SET is_active = false WHERE id = $1', [vitima.id]);
      assert.equal((await comChave(chave.apiKey)).status, 401, 'desativada a conta, não vale');

      // O PAR QUE DE FATO MEDE O PREDICADO. Sem ele, este caso passa verde com o termo
      // de conta ativa apagado da consulta.
      const semTermo = await db.query(
        `SELECT u.id FROM api_keys k JOIN users u ON u.id = k.user_id
          WHERE k.api_key = $1 AND k.revoked_at IS NULL AND k.expires_at > NOW()`,
        [chave.apiKey]
      );
      assert.equal(semTermo.rows.length, 1, 'a chave e a conta continuam lá: nada da fixture se desfez');

      const vigente = await db.query(FIND_USER_BY_API_KEY, [chave.apiKey]);
      assert.equal(vigente.rows.length, 0, 'e a consulta VIGENTE não devolve nada, pela conta e por mais nada');

      await db.query('UPDATE users SET is_active = true WHERE id = $1', [vitima.id]);
      assert.equal((await comChave(chave.apiKey)).status, 200, 'reativada, a MESMA chave volta');
      const dePe = await db.query(FIND_USER_BY_API_KEY, [chave.apiKey]);
      assert.equal(dePe.rows.length, 1, 'e a consulta volta a devolvê-la: a recusa era de ESTADO');

      await db.query('DELETE FROM api_keys WHERE user_id = $1', [vitima.id]);
      await db.query('DELETE FROM audit_trail WHERE actor_id = $1', [vitima.id]);
      await db.query('DELETE FROM refresh_tokens WHERE user_id = $1', [vitima.id]);
      await db.query('DELETE FROM users WHERE id = $1', [vitima.id]);
    });
  });

  // =========================================================================
  // A TRILHA
  // =========================================================================
  describe('emitir e revogar deixam trilha, com ação própria e sem o segredo', () => {
    it('a trilha registra as duas ações e não guarda a chave', async () => {
      const chave = await emitir(donoToken, { label: 'auditada', scope: 'tiles' });
      await supertest(app)
        .delete(`/api/v1/users/me/api-keys/${chave.id}`)
        .set('Authorization', `Bearer ${donoToken}`)
        .expect(200);

      const { rows } = await db.query(
        `SELECT action, details FROM audit_trail
          WHERE actor_id = $1 AND action IN ('API_KEY_CREATE','API_KEY_REVOKE')
            AND details->>'keyId' = $2
          ORDER BY created_at`,
        [dono.id, chave.id]
      );
      assert.equal(rows.length, 2, 'uma linha por ato, e as duas apontam para a MESMA chave');
      assert.equal(rows[0].action, 'API_KEY_CREATE');
      assert.equal(rows[1].action, 'API_KEY_REVOKE');

      const cru = JSON.stringify(rows);
      assert.equal(
        cru.includes(chave.apiKey), false,
        'o segredo não entra na trilha: `details` é lido por quem investiga, e gravá-lo ali '
        + 'seria distribuir a credencial para a investigação'
      );
    });
  });
});
