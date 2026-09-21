// Path: tests/integration/sync-atlas-settings-app-state.test.js
// datamodel-13/14: app-level state that used to be local-only (mapBadgeColors,
// customIcons) syncs through the SAME `setting` op + whitelist as terrainExaggeration,
// shallow-merged into atlas.settings and round-tripped in the snapshot. The payload
// SHAPE here mirrors exactly what the frontend logger emits (logSettingOperation puts
// the patch in `data`):
//   - mapBadgeColors → data: { mapBadgeColors: { [mapName]: color } }  (full object)
//   - customIcons    → data: { customIcons: [ { id, name, ... } ] }    (full registry)
// Resource-availability keys (features/basemaps/...) MUST stay rejected. An editor
// (write share) may do it (§24.8 is editor-allowed, not owner-only).
//
// E `colorUsage`, QUE ERA O TERCEIRO E SAIU EM 2026-09-21 (decisão do dono). A contagem de cores
// é DERIVADA das feições que todo cliente já recebe, e as duas pontas nunca concordaram numa
// chave (o cliente gravava o disco sob o id resolvido do mapa e mandava a op sob o NOME dele),
// de modo que ela ia e voltava sem nunca convergir, e o mapa renomeado deixava o nome velho no
// sub-objeto para sempre, porque a mescla profunda nunca poda.
//
// O CASO QUE ESTE ARQUIVO PRENDE AGORA É O DO CLIENTE ANTIGO, e é o oposto de uma recusa: a op
// que ainda traz a chave tem de ser ACEITA (200), a chave DESCARTADA em silêncio como qualquer
// outra fora da lista, e o RESTO da mesma op aplicado. Recusar seria pior que gravar: uma op
// recusada não desenfileira, e a fila de saída é FIFO com retenção de cabeça, então o cliente
// antigo pararia de sincronizar TUDO. É a mesma doutrina de `src/modules/sync/temporal-config.js`:
// descartar, nunca recusar.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createShare, loginUser } from '../helpers/fixtures.js';

describe('Sync atlas-level app-state settings (datamodel-13/14)', () => {
  let app, db, owner, editor, ownerTok, editorTok, atlas;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    owner = await createUser(db, { username: 'appstate_owner' });
    editor = await createUser(db, { username: 'appstate_editor' });
    ownerTok = await loginUser(app, owner.username, owner.password);
    editorTok = await loginUser(app, editor.username, editor.password);
    atlas = await createAtlas(db, owner.id);
    await createShare(db, atlas.id, editor.id, 'write', owner.id);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  // Mirrors the frontend logger output: logSettingOperation(UPDATE, atlasId, patch)
  // puts the whitelisted patch in `data`.
  const pushSetting = (token, data) =>
    supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations: [{ protocolVersion: 2,
        id: randomUUID(), entityType: 'setting', operationType: 'update',
        entityId: atlas.id, data, timestamp: Date.now(), clientId: 's-client',
      }] });

  const settings = async () => {
    const res = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/sync/0`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .expect(200);
    return res.body.data.snapshot.atlas.settings;
  };

  it('datamodel-13: merges mapBadgeColors (full map→color object) into atlas.settings and round-trips', async () => {
    const mapBadgeColors = { Alfa: '#3b82f6', Bravo: '#f59e0b' };
    await pushSetting(ownerTok, { mapBadgeColors }).expect(200);
    const s = await settings();
    assert.deepEqual(s.mapBadgeColors, mapBadgeColors, 'mapBadgeColors persisted and surfaced in snapshot');
  });

  it('datamodel-13: a later mapBadgeColors write accumulates (deep-merge, does not clobber siblings)', async () => {
    await pushSetting(ownerTok, { mapBadgeColors: { Charlie: '#10b981' } }).expect(200);
    const s = await settings();
    assert.equal(s.mapBadgeColors.Alfa, '#3b82f6', 'existing map color preserved');
    assert.equal(s.mapBadgeColors.Charlie, '#10b981', 'new map color added');
  });

  it('2026-09-21: uma op de cliente ANTIGO com colorUsage é ACEITA e a chave NÃO é gravada', async () => {
    // O 200 é metade da asserção, e é a metade que se esquece: um 4xx aqui congelaria a fila de
    // saída inteira daquele cliente, que é um estrago maior que o do valor que se quer podar.
    const res = await pushSetting(ownerTok, { colorUsage: { Alfa: { '#ff0000': 3, '#00ff00': 1 } } })
      .expect(200);
    assert.equal(res.body.data.results[0].status, 'applied',
      'a op volta aplicada, e não recusada: recusa retém a cabeça da fila do cliente');

    const s = await settings();
    assert.equal(s.colorUsage, undefined, 'a chave descartada não foi criada em atlas.settings');
  });

  it('2026-09-21: o IRMÃO mapBadgeColors da MESMA op continua sendo gravado', async () => {
    // Sem este caso a poda passaria verde tendo levado junto o irmão, que NÃO é derivado: a cor
    // do crachá é escolha do usuário. É o mesmo par do caso `malicious` mais abaixo, e é o que
    // distingue "a chave saiu da lista" de "o ramo inteiro parou de escrever".
    await pushSetting(ownerTok, {
      colorUsage: { Bravo: { '#0000ff': 5 } },
      mapBadgeColors: { Foxtrot: '#6366f1' },
    }).expect(200);

    const s = await settings();
    assert.equal(s.mapBadgeColors.Foxtrot, '#6366f1', 'o irmão da mesma op foi aplicado');
    assert.equal(s.colorUsage, undefined, 'e a chave podada continua sem ser criada');
    assert.equal(s.mapBadgeColors.Alfa, '#3b82f6', 'e o merge profundo do irmão não perdeu vizinho');
  });

  it('datamodel-14: merges customIcons (the icon registry list) into atlas.settings and round-trips', async () => {
    const customIcons = [
      { id: 'icon-1', name: 'Tank', thumbnail: 'data:img', type: 'image/png', createdAt: 1718900000000 },
      { id: 'icon-2', name: 'Jet', thumbnail: 'data:img2', type: 'image/png', createdAt: 1718900000001 },
    ];
    await pushSetting(ownerTok, { customIcons }).expect(200);
    const s = await settings();
    assert.deepEqual(s.customIcons, customIcons, 'customIcons registry persisted and surfaced in snapshot');
  });

  it('datamodel-14: customIcons is replaced wholesale (a list, not deep-merged)', async () => {
    await pushSetting(ownerTok, { customIcons: [{ id: 'icon-9', name: 'Only', type: 'image/png', createdAt: 1 }] }).expect(200);
    const s = await settings();
    assert.equal(s.customIcons.length, 1, 'registry list replaced, not merged');
    assert.equal(s.customIcons[0].id, 'icon-9');
  });

  it('NEGATIVE: a resource-availability key (basemaps/features) is NOT merged', async () => {
    await pushSetting(ownerTok, {
      mapBadgeColors: { Delta: '#ec4899' },
      basemaps: ['evil'],
      features: { map_3d: false },
      malicious: 'x',
    }).expect(200);
    const s = await settings();
    assert.equal(s.mapBadgeColors.Delta, '#ec4899', 'whitelisted key rode along fine');
    assert.deepEqual(s.basemaps, [], 'resource key (basemaps) NOT overwritten — default [] preserved');
    assert.deepEqual(s.features,
      { map_3d: true, panoramic_images: true, terrain_3d: true, data_layers: true, analysis_layers: true },
      'resource key (features) NOT overwritten — default preserved');
    assert.ok(!('malicious' in s), 'non-whitelisted key dropped');
  });

  it('a write-share editor can sync app-state settings (§24.8 is editor-allowed)', async () => {
    await pushSetting(editorTok, { mapBadgeColors: { Echo: '#84cc16' } }).expect(200);
    const s = await settings();
    assert.equal(s.mapBadgeColors.Echo, '#84cc16');
  });
});
