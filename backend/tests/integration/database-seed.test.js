// Path: tests/integration/database-seed.test.js
// Item 164 — src/database/seed.js, a ferramenta que monta o ambiente de dev
// documentado no CLAUDE.md (`npm run db:seed`, usuários admin/cap.silva).
// Cobertura confirmada como ZERO: o runner só chama migrate.js.
//
// O modo de falha mais provável é SILENCIOSO: o seed resolve posto e OM por
// SUBSELECT literal (`WHERE nome_abrev = 'Cap'`, `WHERE sigla = 'CIGEx'`). Se a
// migração 001 mudar a abreviação ou a sigla, o subselect devolve NULL, o usuário
// nasce sem posto nem OM, e ninguém percebe até alguém depurar o dropdown de
// cadastro achando que o bug está no frontend.
//
// O teste limpa TUDO no `after`: o banco de teste é compartilhado e um usuário
// 'admin' vazado contaminaria as outras suítes.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { seed } from '../../src/database/seed.js';

const ATLAS = 'Atlas de Exemplo';

describe('src/database/seed.js (item 164)', () => {
  let db;

  before(async () => {
    const env = await setupTestEnv();
    db = env.db;

    // Guarda de isolamento: se alguma dessas linhas já existir, o teste estaria
    // afirmando sobre dado de outra suíte.
    const { rows } = await db.query(
      `SELECT username FROM users WHERE username IN ('admin','cap.silva')`
    );
    assert.deepEqual(rows, [], 'o banco não pode já conter os usuários do seed');

    await seed(process.env.DATABASE_URL);
  });

  after(async () => {
    // atlas_shares / maps / features / layers caem por ON DELETE CASCADE do atlas.
    await db.query(`DELETE FROM atlas WHERE name = $1`, [ATLAS]);
    await db.query(`DELETE FROM users WHERE username IN ('admin','cap.silva')`);
    await teardownTestEnv(db);
  });

  const usuario = async (username) => {
    const { rows } = await db.query('SELECT * FROM users WHERE username = $1', [username]);
    assert.equal(rows.length, 1, `usuário ${username} precisa existir`);
    return rows[0];
  };

  const atlas = async () => {
    const { rows } = await db.query('SELECT * FROM atlas WHERE name = $1', [ATLAS]);
    assert.equal(rows.length, 1, 'o atlas de exemplo precisa existir e ser único');
    return rows[0];
  };

  it('cria admin (role admin) e cap.silva', async () => {
    const adm = await usuario('admin');
    assert.equal(adm.role, 'admin');
    assert.equal(adm.nome, 'Administrador');

    const cap = await usuario('cap.silva');
    assert.equal(cap.role, 'user');
    assert.equal(cap.nome, 'João Silva');
  });

  it('cap.silva sai com rank_id E organization_id resolvidos (pega a quebra do subselect literal)', async () => {
    const cap = await usuario('cap.silva');
    assert.notEqual(cap.rank_id, null, "o subselect WHERE nome_abrev = 'Cap' não pode devolver NULL");
    assert.notEqual(cap.organization_id, null, "o subselect WHERE sigla = 'CIGEx' não pode devolver NULL");

    const { rows } = await db.query(
      `SELECT r.nome AS posto, o.sigla AS om
         FROM users u
         JOIN ranks r ON r.id = u.rank_id
         JOIN organizations o ON o.id = u.organization_id
        WHERE u.username = 'cap.silva'`
    );
    assert.equal(rows.length, 1, 'os dois joins precisam resolver');
    assert.equal(rows[0].posto, 'Capitão');
    assert.equal(rows[0].om, 'CIGEx');
  });

  it('cria o atlas de exemplo com 1 mapa, 3 feições, 1 camada e share write para cap.silva', async () => {
    const a = await atlas();
    const adm = await usuario('admin');
    const cap = await usuario('cap.silva');
    assert.equal(a.owner_id, adm.id);

    const mapas = await db.query('SELECT id, name FROM maps WHERE atlas_id = $1', [a.id]);
    assert.equal(mapas.rows.length, 1);
    assert.equal(mapas.rows[0].name, 'Mapa Principal');
    assert.deepEqual(a.map_order, [mapas.rows[0].id], 'map_order precisa apontar para o mapa criado');

    const feicoes = await db.query(
      'SELECT feature_type FROM features WHERE map_id = $1 ORDER BY feature_type',
      [mapas.rows[0].id]
    );
    assert.deepEqual(feicoes.rows.map((r) => r.feature_type), ['line', 'point', 'polygon']);

    const camadas = await db.query('SELECT name FROM layers WHERE map_id = $1', [mapas.rows[0].id]);
    assert.equal(camadas.rows.length, 1);
    assert.equal(camadas.rows[0].name, 'Camada Principal');

    const shares = await db.query(
      'SELECT permission, user_id FROM atlas_shares WHERE atlas_id = $1',
      [a.id]
    );
    assert.equal(shares.rows.length, 1);
    assert.equal(shares.rows[0].permission, 'write');
    assert.equal(shares.rows[0].user_id, cap.id);
  });

  it('rodar o seed de novo é idempotente e não corrompe a credencial', async () => {
    await seed(process.env.DATABASE_URL);

    const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM atlas WHERE name = $1', [ATLAS]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].n, 1, 'o atlas de exemplo não pode duplicar');

    const adm = await usuario('admin');
    assert.equal(await bcrypt.compare('admin123', adm.password_hash), true);
    assert.equal(adm.role, 'admin', 'o ON CONFLICT DO UPDATE preserva o papel');

    const cap = await usuario('cap.silva');
    assert.equal(await bcrypt.compare('test123', cap.password_hash), true);
    assert.notEqual(cap.rank_id, null, 'e o ON CONFLICT não zera posto/OM');
    assert.notEqual(cap.organization_id, null);
  });
});
