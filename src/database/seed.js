// Path: src/database/seed.js
// Development seed data: creates admin user and sample atlas
// Usage: node src/database/seed.js

import pgPromise from 'pg-promise';
import bcrypt from 'bcrypt';
import { fileURLToPath } from 'url';

const SALT_ROUNDS = 12;

async function seed(connectionString) {
  const connStr = connectionString || process.env.DATABASE_URL;
  if (!connStr) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  const pgp = pgPromise();
  const db = pgp(connStr);

  try {
    console.log('Starting seed...');

    // Hash passwords in parallel
    const [adminPassword, testPassword] = await Promise.all([
      bcrypt.hash('admin123', SALT_ROUNDS),
      bcrypt.hash('test123', SALT_ROUNDS),
    ]);

    // Create admin user (rank/OM are FKs now; left null for the seed admin)
    const adminResult = await db.one(`
      INSERT INTO users (username, password_hash, nome, role)
      VALUES ('admin', $1, 'Administrador', 'admin')
      ON CONFLICT (username) DO UPDATE SET password_hash = $1, role = 'admin'
      RETURNING id, username
    `, [adminPassword]);
    const adminId = adminResult.id;
    console.log(`  ✓ Admin user created/updated: ${adminResult.username}`);

    // Create test user with the seeded "Capitão" rank + CIGEx org (resolved by name).
    const testResult = await db.one(`
      INSERT INTO users (username, password_hash, nome, rank_id, organization_id)
      VALUES ('cap.silva', $1, 'João Silva',
        (SELECT id FROM ranks WHERE nome_abrev = 'Cap' LIMIT 1),
        (SELECT id FROM organizations WHERE sigla = 'CIGEx' LIMIT 1))
      ON CONFLICT (username) DO UPDATE SET password_hash = $1
      RETURNING id, username
    `, [testPassword]);
    const testUserId = testResult.id;
    console.log(`  ✓ Test user created/updated: ${testResult.username}`);

    // Create sample atlas (use tx for related inserts)
    const existingAtlas = await db.oneOrNone(`
      SELECT id FROM atlas WHERE name = 'Atlas de Exemplo' AND deleted_at IS NULL
    `);

    if (!existingAtlas) {
      await db.tx(async (t) => {
        // Create atlas
        const atlas = await t.one(`
          INSERT INTO atlas (name, description, owner_id)
          VALUES ('Atlas de Exemplo', 'Atlas criado automaticamente para testes', $1)
          RETURNING id, name
        `, [adminId]);
        const atlasId = atlas.id;
        console.log(`  ✓ Sample atlas created: ${atlas.name}`);

        // Create sample map
        const map = await t.one(`
          INSERT INTO maps (atlas_id, name, base_layer, center_lat, center_long, zoom)
          VALUES ($1, 'Mapa Principal', 'carta-topografica', -22.9068, -43.1729, 10)
          RETURNING id, name
        `, [atlasId]);
        const mapId = map.id;
        console.log(`  ✓ Sample map created: ${map.name}`);

        // Update atlas map_order
        await t.none(`
          UPDATE atlas SET map_order = ARRAY[$1::uuid] WHERE id = $2
        `, [mapId, atlasId]);

        // Create sample features
        const features = [
          {
            type: 'point',
            geometry: { coordinates: [-43.1729, -22.9068] },
            properties: { name: 'Marco Central', color: '#ff0000' },
          },
          {
            type: 'polygon',
            geometry: { coordinates: [[[-43.18, -22.91], [-43.17, -22.91], [-43.17, -22.90], [-43.18, -22.90], [-43.18, -22.91]]] },
            properties: { name: 'Área de Operação', fillColor: '#00ff00', fillOpacity: 0.3 },
          },
          {
            type: 'line',
            geometry: { coordinates: [[-43.18, -22.905], [-43.16, -22.905]] },
            properties: { name: 'Eixo de Progressão', color: '#0000ff', width: 3 },
          },
        ];

        for (const feat of features) {
          await t.none(`
            INSERT INTO features (map_id, feature_type, geometry, properties)
            VALUES ($1, $2, $3::jsonb, $4::jsonb)
          `, [mapId, feat.type, JSON.stringify(feat.geometry), JSON.stringify(feat.properties)]);
        }
        console.log(`  ✓ ${features.length} sample features created`);

        // Create sample layer
        await t.none(`
          INSERT INTO layers (map_id, name, visible, sort_order)
          VALUES ($1, 'Camada Principal', true, 0)
        `, [mapId]);
        console.log('  ✓ Sample layer created');

        // Share atlas with test user
        await t.none(`
          INSERT INTO atlas_shares (atlas_id, user_id, permission, added_by)
          VALUES ($1, $2, 'write', $3)
          ON CONFLICT DO NOTHING
        `, [atlasId, testUserId, adminId]);
        console.log('  ✓ Atlas shared with test user');
      });
    } else {
      console.log('  ⚠ Sample atlas already exists, skipping');
    }

    console.log('\nSeed completed successfully!');
    console.log('\nTest credentials:');
    console.log('  Admin: admin / admin123');
    console.log('  User:  cap.silva / test123');
  } finally {
    await pgp.end();
  }
}

// Run if called directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Seed failed:', err);
      process.exit(1);
    });
}

export { seed };
