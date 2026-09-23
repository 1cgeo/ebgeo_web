import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas } from '../helpers/fixtures.js';
import { db } from '../../src/database/index.js';
import { getAtlasSnapshot } from '../../src/modules/sync/sync.service.js';

describe('snapshot groups visit membership rows once, rather than once per group', () => {
  let cli, atlas, mapId;
  before(async () => {
    ({ db: cli } = await setupTestEnv());
    const owner = await createUser(cli, { username: `groups_${randomUUID().slice(0, 8)}` });
    atlas = await createAtlas(cli, owner.id);
    mapId = randomUUID();
    await cli.query('INSERT INTO maps (id, atlas_id, name) VALUES ($1,$2,$3)', [mapId, atlas.id, 'Grouped']);
    await cli.query(`INSERT INTO groups (id, map_id, name)
      SELECT gen_random_uuid(), $1, n::text FROM generate_series(0,199) n`, [mapId]);
    await cli.query(`INSERT INTO features (id, map_id, feature_type, geometry, properties)
      SELECT gen_random_uuid(), $1, 'point', '{"type":"Point","coordinates":[-43,-22]}'::jsonb,
        jsonb_build_object('index',n) FROM generate_series(0,999) n`, [mapId]);
    await cli.query(`INSERT INTO group_features (group_id,feature_id)
      SELECT g.id,f.id FROM groups g JOIN features f ON f.map_id=g.map_id
      AND ((f.properties->>'index')::int / 5)::text=g.name WHERE g.map_id=$1`, [mapId]);
  });
  after(async () => teardownTestEnv(cli));

  it('keeps every typed membership with a linear traversal budget', async () => {
    let visits = 0, observed = 0;
    const opts = db.$config.options, original = opts.receive;
    opts.receive = event => {
      original?.(event);
      for (const row of event.data) {
        if (!row.feature_id || !row.group_id) continue;
        const id = row.group_id;
        observed++;
        Object.defineProperty(row, 'group_id', { enumerable: true,
          get() { visits++; return id; } });
      }
    };
    let snapshot;
    try { snapshot = await getAtlasSnapshot(atlas.id); }
    finally { opts.receive = original; }
    assert.equal(observed, 1000, 'the instrument must see real SQL membership rows');
    assert.ok(visits <= 2000, `membership visits must be linear; measured ${visits}`);
    const map = snapshot.maps.find(item => item.id === mapId);
    assert.equal(map.groups.length, 200);
    assert.equal(map.groupFeatures.length, 1000);
    for (const group of map.groups) {
      const expected = map.features.points.filter(f => String(Math.floor(f.properties.index / 5)) === group.name)
        .map(f => f.properties.id).sort();
      assert.deepEqual(group.features.map(f => f.id).sort(), expected);
      assert.ok(group.features.every(f => f.type === 'point'));
    }
  });
});
