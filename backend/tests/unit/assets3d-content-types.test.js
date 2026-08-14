// Path: tests/unit/assets3d-content-types.test.js
// The Content-Type map of GET /api/v1/assets3d/*, at the unit.
//
// It exists for the first-person 3D scene, whose four file kinds (.sog model,
// .bin collision octree, .jpg item photos, .webm catalog preview) were all
// falling through to application/octet-stream. Two of those four are the reason
// this is a guard and not a formality:
//
//   - .jpg served as octet-stream only renders because a browser sniffs <img>;
//   - .webm served as octet-stream does not play at all, because <video> does
//     not sniff. The failure is a silent dead player, never an error.
//
// TWO CLAIMS, and the second is why value assertions alone were not enough.
// `.sog` and `.bin` map to the SAME string the fallback returns, so a test that
// only called contentTypeForPath would keep passing after someone deleted them
// from the map: the classic empty-coverage green. Membership is asserted
// separately, so removing any of the four turns this file red.
//
// The third claim is parity. The map is duplicated in scripts/assets3d-import.js,
// which FREEZES content_type into the SQLite row at import time, so a divergence
// there is served forever without the service ever agreeing. That duplication was
// prose-guarded by a comment; here it is asserted.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CONTENT_TYPES, contentTypeForPath, resolveAsset } from '../../src/modules/nomes/assets3d.service.js';
import { CONTENT_TYPES as IMPORT_CONTENT_TYPES } from '../../scripts/assets3d-import.js';

const ROOT = resolve('./data/assets3d');
const FIXTURE_DIR = join(ROOT, '__content-types-test__');

describe('assets3d content types', () => {
  it('maps the first-person scene photo to image/jpeg', () => {
    assert.equal(contentTypeForPath('primeira-pessoa/museu-1cgeo/itens/item_001.jpg'), 'image/jpeg');
  });

  it('maps the catalog preview clip to video/webm', () => {
    // <video> does not content-sniff: octet-stream here is a player that never starts.
    assert.equal(contentTypeForPath('primeira-pessoa/museu-1cgeo/preview/preview.webm'), 'video/webm');
  });

  it('maps the splat model and the collision octree to octet-stream', () => {
    assert.equal(contentTypeForPath('primeira-pessoa/museu-1cgeo/cena.sog'), 'application/octet-stream');
    assert.equal(contentTypeForPath('primeira-pessoa/museu-1cgeo/voxel/voxel.bin'), 'application/octet-stream');
  });

  it('declares .sog and .bin explicitly rather than letting them fall through', () => {
    // The value assertion above cannot tell a deliberate entry from the fallback.
    assert.ok(Object.hasOwn(CONTENT_TYPES, '.sog'), '.sog must be a declared entry, not a fallback');
    assert.ok(Object.hasOwn(CONTENT_TYPES, '.bin'), '.bin must be a declared entry, not a fallback');
    assert.ok(Object.hasOwn(CONTENT_TYPES, '.jpg'), '.jpg must be a declared entry');
    assert.ok(Object.hasOwn(CONTENT_TYPES, '.webm'), '.webm must be a declared entry');
  });

  it('is case-insensitive on the extension', () => {
    assert.equal(contentTypeForPath('ITEM.JPG'), 'image/jpeg');
    assert.equal(contentTypeForPath('CLIP.WebM'), 'video/webm');
  });

  it('still falls back to octet-stream for an unmapped extension', () => {
    assert.equal(contentTypeForPath('acervo/leiame.txt'), 'application/octet-stream');
    assert.equal(contentTypeForPath('sem-extensao'), 'application/octet-stream');
  });

  it('agrees exactly with the mirror in scripts/assets3d-import.js', () => {
    // Deep equality both ways: the import freezes content_type into the SQLite
    // row, so an extension present on only one side is served wrong forever.
    assert.deepEqual(IMPORT_CONTENT_TYPES, CONTENT_TYPES);
  });

  it('reaches the serving path: resolveAsset reports the new type for a real file', async () => {
    // contentTypeForPath had ZERO callers in src/ until resolveAsset was made to
    // delegate to it; without this case the whole file would test a helper the
    // route does not use.
    mkdirSync(FIXTURE_DIR, { recursive: true });
    const rel = '__content-types-test__/item_001.jpg';
    writeFileSync(join(ROOT, rel), Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    try {
      const meta = await resolveAsset(rel);
      assert.equal(meta.contentType, 'image/jpeg');
    } finally {
      rmSync(FIXTURE_DIR, { recursive: true, force: true });
    }
  });
});
