import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createShare, loginUser, seedPublic360Photos, drop360Fixture } from '../helpers/fixtures.js';

describe('comment threads in a clone obey recipient resource access', () => {
  let app, db, owner, recipient, token;
  const photos = [];
  const tilesets = [];
  before(async () => {
    ({ app, db } = await setupTestEnv());
    owner = await createUser(db);
    recipient = await createUser(db);
    token = await loginUser(app, recipient.username, recipient.password);
  });
  after(async () => {
    for (const fixture of photos) await drop360Fixture(db, fixture);
    for (const id of tilesets) {
      await db.query("DELETE FROM atlas_resources WHERE resource_type='tileset' AND resource_id=$1", [id]);
      await db.query("DELETE FROM resource_grants WHERE resource_type='tileset' AND resource_id=$1", [id]);
      await db.query('DELETE FROM tilesets WHERE id=$1', [id]);
    }
    await teardownTestEnv(db);
  });

  for (const surface of ['3d', 'fp', '360']) {
    it(`${surface}: retains public and personal grants, removes hidden and borrowed threads`, async () => {
      const atlas = await createAtlas(db, owner.id);
      const map = await createMap(db, atlas.id);
      await createShare(db, atlas.id, recipient.id, 'comment', owner.id);
      let borrowedVisible = null;
      for (const access of ['public', 'hidden', 'personal', 'borrowed']) {
        const reference = `${surface}-${access}-${randomUUID()}`;
        const resourceType = surface === '360' ? 'sv360_project' : 'tileset';
        let resourceId = reference;
        if (surface === '360') {
          const fixture = await seedPublic360Photos(db, [reference]);
          photos.push(fixture);
          resourceId = fixture.projectId;
          if (access !== 'public') await db.query("UPDATE sv360.projects SET access_level='private' WHERE id=$1", [resourceId]);
        } else {
          await db.query("INSERT INTO tilesets(id,name,config,sort_order,access_level) VALUES($1,$1,'{}',0,$2)",
            [resourceId, access === 'public' ? 'public' : 'private']);
          tilesets.push(resourceId);
        }
        if (access !== 'public') {
          await db.query(`INSERT INTO resource_grants(resource_type,resource_id,grantee_id,grant_level,granted_by,expires_at)
            VALUES($1,$2,$3,'view',$4,now()+interval '30 days')`,
          [resourceType, resourceId, access === 'personal' ? recipient.id : owner.id, owner.id]);
        }
        if (access === 'borrowed') {
          await db.query('INSERT INTO atlas_resources(atlas_id,resource_type,resource_id,added_by) VALUES($1,$2,$3,$4)',
            [atlas.id, resourceType, resourceId, owner.id]);
          const visible = await db.query("SELECT fn_can_see_resource($1,$2,$3,$4,'private') AS visible",
            [recipient.id, atlas.id, resourceType, resourceId]);
          borrowedVisible = visible.rows[0].visible;
        }
        const root = randomUUID();
        for (const isReply of [false, true]) {
          const id = isReply ? randomUUID() : root;
          const data = { id, parentId: isReply ? root : null, surface, text: `${access}-${isReply ? 'reply' : 'root'}`,
            ...(surface === '360' ? { photoName: reference } : { tilesetId: reference }) };
          await db.query('INSERT INTO comments(id,atlas_id,map_id,parent_id,author_id,data) VALUES($1,$2,$3,$4,$5,$6)',
            [id, atlas.id, map.id, data.parentId, owner.id, JSON.stringify(data)]);
        }
      }
      assert.equal(borrowedVisible, true, 'borrowed source access must be real');
      const response = await supertest(app).post(`/api/v1/atlas/${atlas.id}/clone`)
        .set('Authorization', `Bearer ${token}`).send({}).expect(201);
      const copied = (await db.query('SELECT * FROM comments WHERE atlas_id=$1', [response.body.data.id])).rows;
      assert.deepEqual(copied.map(row => row.data.text).sort(), ['personal-reply', 'personal-root', 'public-reply', 'public-root']);
      const replies = copied.filter(row => row.parent_id);
      assert.equal(replies.length, 2);
      for (const reply of replies) {
        assert.ok(copied.some(row => row.id === reply.parent_id && !row.parent_id));
      }
      assert.equal(response.body.data.pruneReport[surface === '360' ? 'comments.foto360' : 'comments.modelo3d'], 2);
      assert.equal((await db.query('SELECT id FROM comments WHERE atlas_id=$1', [atlas.id])).rows.length, 8);
      const ownerToken = await loginUser(app, owner.username, owner.password);
      const duplicated = await supertest(app).post(`/api/v1/atlas/${atlas.id}/maps/${map.id}/duplicate`)
        .set('Authorization', `Bearer ${ownerToken}`).send({}).expect(201);
      assert.equal((await db.query('SELECT id FROM comments WHERE map_id=$1', [duplicated.body.data.id])).rows.length, 8);
    });
  }
});
