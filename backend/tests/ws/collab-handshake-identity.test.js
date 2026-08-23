// Path: tests/ws/collab-handshake-identity.test.js
// Item 18 — o gate de identidade do `server.on('upgrade')`.
//
// `reconcileAuthorization` declara o princípio P1 ("conta desativada / admin
// rebaixado perde acesso IMEDIATAMENTE") e lê o banco a cada sweep; até 2026-07-25 o
// handshake, na MESMA página, decidia só pelo claim do JWT: `orgIsActive(payload.
// organization_id)` e `payload.role`. Consequência real: um usuário desativado com
// access token ainda válido (15 min) abria socket novo, escrevia por até ~30 s até o
// sweep derrubá-lo, e reconectava em laço. Um admin rebaixado seguia sendo promovido
// a `owner` em QUALQUER atlas.
//
// Estes testes exercem o gate pelo PONTO DE ENTRADA (conexão nova), que é o caminho
// que nenhum teste tocava: collab-reauthz.test.js só exercita `reconcileAuthorization`
// contra um socket falso já aberto, e collab-roles.test.js só o admin ainda vigente.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { createServer } from 'http';
import WebSocket from 'ws';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';

const U = () => `hsid_${randomUUID().slice(0, 8)}`;

/** Abre um socket cru e resolve o desfecho; nunca rejeita (recusa é caminho esperado). */
function rawConnect(url) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    let settled = false;
    const done = (val) => {
      if (settled) return;
      settled = true;
      resolve({ ws, ...val });
    };
    const messages = [];
    ws.on('message', (raw) => messages.push(JSON.parse(raw.toString())));
    ws.on('open', () => setTimeout(() => done({ connected: true, messages }), 200));
    ws.on('error', () => done({ connected: false, messages }));
    ws.on('unexpected-response', (_req, res) => done({ connected: false, statusCode: res.statusCode, messages }));
    ws.on('close', () => done({ connected: false, messages }));
    setTimeout(() => done({ connected: false, timedOut: true, messages }), 4000);
  });
}

describe('WS handshake — gate de identidade viva (P1/O1 no upgrade)', () => {
  let app, db, server, base;
  let owner, atlas;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    server = createServer(app);
    const gw = await import('../../src/modules/collab/collab.gateway.js');
    gw.attachWebSocket(server);
    await new Promise((resolve) => server.listen(0, () => resolve()));
    const addr = server.address();
    base = `ws://localhost:${typeof addr === 'object' ? addr.port : addr}`;

    owner = await createUser(db, { username: U() });
    atlas = await createAtlas(db, owner.id, { name: `Atlas ${U()}` });
    await createMap(db, atlas.id);
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await teardownTestEnv(db);
  });

  it("controle positivo: share 'write' conecta e recebe permission 'write'", async () => {
    const w = await createUser(db, { username: U() });
    await db.query(
      `INSERT INTO atlas_shares (atlas_id, user_id, permission, added_by) VALUES ($1, $2, 'write', $3)`,
      [atlas.id, w.id, owner.id]
    );
    const token = await loginUser(app, w.username, w.password);

    const r = await rawConnect(`${base}/api/v1/collab?atlasId=${atlas.id}&token=${token}`);
    assert.equal(r.connected, true, 'a fixture tem de conectar, senão os negativos não provam nada');
    const connected = r.messages.find((m) => m.type === 'connected');
    assert.ok(connected, 'frame `connected` recebido');
    assert.equal(connected.permission, 'write');
    r.ws.close();
  });

  it('conta DESATIVADA com o MESMO token não abre socket novo', async () => {
    const u = await createUser(db, { username: U() });
    await db.query(
      `INSERT INTO atlas_shares (atlas_id, user_id, permission, added_by) VALUES ($1, $2, 'write', $3)`,
      [atlas.id, u.id, owner.id]
    );
    const token = await loginUser(app, u.username, u.password);

    // Prova que o token serve ANTES da desativação (isola a variável).
    const antes = await rawConnect(`${base}/api/v1/collab?atlasId=${atlas.id}&token=${token}`);
    assert.equal(antes.connected, true);
    antes.ws.close();
    await new Promise((r) => setTimeout(r, 100));

    await db.query('UPDATE users SET is_active = false WHERE id = $1', [u.id]);

    const depois = await rawConnect(`${base}/api/v1/collab?atlasId=${atlas.id}&token=${token}`);
    assert.equal(depois.connected, false, 'usuário desativado não pode abrir socket novo');
    assert.equal(
      depois.messages.find((m) => m.type === 'connected'),
      undefined,
      'nenhum frame `connected`'
    );
    depois.ws.close();

    // A metade "e nenhuma linha de sessão" saiu em 2026-08-23, com a tabela
    // `active_sessions`. O que ela media era que o gate barra ANTES de `onConnection`, e
    // isso continua asserido acima, pelo que o cliente OBSERVA: a conexão não abre e não
    // chega frame `connected`. Que nenhum caminho de socket escreva no banco tem arquivo
    // próprio, tests/ws/collab-presenca-sem-banco.test.js.
  });

  it('admin global rebaixado a user, MESMO token, perde o acesso ao atlas de terceiro', async () => {
    const adm = await createAdminUser(db, { username: U() });
    const token = await loginUser(app, adm.username, adm.password);

    // Enquanto admin: acesso owner em atlas alheio (bypass deliberado, resolvePermission:83).
    const comoAdmin = await rawConnect(`${base}/api/v1/collab?atlasId=${atlas.id}&token=${token}`);
    assert.equal(comoAdmin.connected, true);
    const connected = comoAdmin.messages.find((m) => m.type === 'connected');
    assert.ok(connected, 'frame `connected` recebido enquanto admin');
    assert.equal(connected.permission, 'owner');
    assert.equal(connected.role, 'admin');
    comoAdmin.ws.close();
    await new Promise((r) => setTimeout(r, 100));

    await db.query(`UPDATE users SET role = 'user' WHERE id = $1`, [adm.id]);

    // Rebaixado e sem share: o claim `role:'admin'` do token não pode mais valer.
    const rebaixado = await rawConnect(`${base}/api/v1/collab?atlasId=${atlas.id}&token=${token}`);
    assert.equal(rebaixado.connected, false, 'admin rebaixado não entra em atlas de terceiro');
    assert.equal(rebaixado.messages.find((m) => m.type === 'connected'), undefined);
    rebaixado.ws.close();
  });

  it('org VIVA do usuário desativada barra, mesmo com o token carregando a org antiga (ativa)', async () => {
    const orgAntiga = '00000000-0000-0000-0000-000000000001'; // default, ativa
    const slug = U();
    const { rows: novaOrg } = await db.query(
      `INSERT INTO organizations (nome, sigla, slug) VALUES ($1, $2, $3) RETURNING id`,
      [`Org ${slug}`, slug.slice(0, 8), slug]
    );

    const u = await createUser(db, { username: U(), organization_id: orgAntiga });
    await db.query(
      `INSERT INTO atlas_shares (atlas_id, user_id, permission, added_by) VALUES ($1, $2, 'write', $3)`,
      [atlas.id, u.id, owner.id]
    );
    // O token é emitido AGORA, com a org antiga (ativa) no claim.
    const token = await loginUser(app, u.username, u.password);

    // Move o usuário para uma org que em seguida é desativada. O claim segue apontando
    // para a org antiga, que continua ativa — só a leitura VIVA vê a mudança.
    await db.query('UPDATE users SET organization_id = $1 WHERE id = $2', [novaOrg[0].id, u.id]);
    await db.query('UPDATE organizations SET is_active = false WHERE id = $1', [novaOrg[0].id]);

    const r = await rawConnect(`${base}/api/v1/collab?atlasId=${atlas.id}&token=${token}`);
    assert.equal(r.connected, false, 'a org do claim não é autoridade; a viva é');
    assert.equal(r.messages.find((m) => m.type === 'connected'), undefined);
    r.ws.close();
  });
});
