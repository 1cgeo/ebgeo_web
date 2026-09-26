import { beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { IDBObjectStore } from 'fake-indexeddb';
import { resetIndexedDB } from '../helpers/idb-helpers.js';

let ns, prepare, source, destination;
const put = (scope, store, key, value) => ns.getStoreFor(ns.StoreName[store], scope).setItem(key, value);
const get = (scope, store, key) => ns.getStoreFor(ns.StoreName[store], scope).getItem(key);
const values = async (scope, store) => {
    const result = [];
    await ns.getStoreFor(ns.StoreName[store], scope).iterate(value => { result.push(value); });
    return result;
};
const input = () => ({
    maps: { A: { id: 'map', features: { images: [{ properties: { id: 'photo', source: 'image', layerId: 'layer' } }],
        points: [{ properties: { id: 'point', source: 'point', markerSymbol: 'custom:icon', groupId: 'group',
            attributes: { id: 'photo', parentId: 'group', nested: { id: 'operator reference' } } } }] },
        catalogLayers: [{ id: 'point', nome: 'Catalog identity', source: { id: 'photo' } }] } },
    layers: { A: [{ id: 'layer', nome: 'Imported layer' }] },
    groups: { A: { group: { id: 'group', features: [{ id: 'point' }] } } },
    briefings: [{ id: 'brief', name: 'Brief', slides: [{ id: 'slide', mapId: 'map' }] }],
    customIcons: [{ id: 'icon', name: 'Icon' }],
    cesium3d: { A: { markers: [{ id: 'marker', images: ['photo'] }] } },
    comments: { A: { point: [{ id: 'comment', text: 'Keep it' }] } },
    mapNotes: { A: { title: 'Imported notes' } },
});
async function run(data = input(), missing = false) {
    const zip = new JSZip();
    if (!missing) zip.file('images/photo.png', new Uint8Array([1, 2, 3]));
    zip.file('images/icon.png', new Uint8Array([4, 5]));
    return prepare(source, destination, { id: 'atlas', name: 'Original' }, data, zip,
        layers => ({ processed: layers, unavailableCount: 0 }));
}
beforeEach(async () => {
    await resetIndexedDB(); vi.resetModules();
    ns = await import('@store/atlas-namespace.js');
    prepare = (await import('@js/import_export/prepare-additive-scope.js')).prepareAdditiveScope;
    source = ns.localScope('atlas', 'original'); destination = ns.localScope('atlas', 'prepared');
    await put(source, 'MAPS', 'A', { name: 'A', features: {} });
    await put(source, 'IMAGES', 'photo', new Blob(['original']));
    await put(source, 'SETTINGS', 'custom_icons', [{ id: 'existing', name: 'Original icon' }]);
    await put(source, 'SETTINGS', 'lastActiveMap', 'A');
    await put(source, 'SETTINGS', 'mapOrder', ['A']);
    await put(source, 'BRIEFINGS', 'brief', { id: 'brief', name: 'Brief', slides: [] });
    await put(source, 'ATLAS', 'current_atlas', { id: 'atlas', name: 'Original', description: 'Keep description' });
});
describe('additive preparation', () => {
    it('preserves the original bytes and settings while renaming maps and remapping every imported reference', async () => {
        const originalInput = input();
        await run(originalInput);
        const maps = await values(destination, 'MAPS');
        expect(maps.map(map => map.name).sort()).toEqual(['A', 'A_1']);
        const imported = maps.find(map => map.name === 'A_1');
        const photo = imported.features.images[0].properties.id;
        const point = imported.features.points[0].properties;
        expect(point.attributes).toEqual(originalInput.maps.A.features.points[0].properties.attributes);
        expect(imported.catalogLayers).toEqual(originalInput.maps.A.catalogLayers);
        expect(photo).not.toBe('photo');
        expect(await (await get(destination, 'IMAGES', 'photo')).text()).toBe('original');
        expect([...new Uint8Array(await (await get(destination, 'IMAGES', photo)).arrayBuffer())]).toEqual([1, 2, 3]);
        const groups = await get(destination, 'GROUPS', imported.id);
        expect(Object.keys(groups)).toEqual([point.groupId]);
        expect(groups[point.groupId].features).toEqual([{ id: point.id }]);
        const layer = (await get(destination, 'LAYERS', `layers_${imported.id}`))[0];
        expect(imported.features.images[0].properties.layerId).toBe(layer.id);
        expect((await get(destination, 'CESIUM3D', `cesium3d_${imported.id}`)).markers[0].images).toEqual([photo]);
        expect((await get(destination, 'COMMENTS', `comments_${imported.id}`))[point.id][0].text).toBe('Keep it');
        const briefs = await values(destination, 'BRIEFINGS');
        expect(briefs).toHaveLength(2);
        expect(briefs.find(brief => brief.name === 'Brief_1').slides[0].mapId).toBe(imported.id);
        expect(await get(destination, 'SETTINGS', 'lastActiveMap')).toBe('A');
        expect(await get(destination, 'SETTINGS', 'mapOrder')).toEqual(['A', 'A_1']);
        expect((await get(destination, 'ATLAS', 'current_atlas')).description).toBe('Keep description');
        expect(await get(destination, 'SETTINGS', 'custom_icons')).toEqual([{ id: 'existing', name: 'Original icon' },
            { id: point.markerSymbol.slice(7), name: 'Icon' }]);
        expect(await values(source, 'MAPS')).toEqual([{ name: 'A', features: {} }]);
        expect(originalInput).toEqual(input());
    });
    it('does not borrow same-id bytes from the original when an incoming photo is missing', async () => {
        expect((await run(input(), true)).missingOriginalImages).toBe(1);
        const imported = (await values(destination, 'MAPS')).find(map => map.name === 'A_1');
        const id = imported.features.images[0].properties.id;
        expect(id).not.toBe('photo');
        expect(await get(destination, 'IMAGES', id)).toBeNull();
        expect(await (await get(source, 'IMAGES', 'photo')).text()).toBe('original');
        expect(await values(source, 'MAPS')).toHaveLength(1);
    });
    it('a destination quota failure never changes the source', async () => {
        const original = IDBObjectStore.prototype.put;
        const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (...args) {
            if (this.transaction.db.name === 'ebgeo_images__prepared') throw new Error('quota');
            return original.apply(this, args);
        });
        try { await expect(run()).rejects.toThrow('quota'); } finally { spy.mockRestore(); }
        expect(await values(source, 'MAPS')).toHaveLength(1);
        expect(await (await get(source, 'IMAGES', 'photo')).text()).toBe('original');
    });
    it('refuses a total above the map limit before appending', async () => {
        for (let i = 1; i < 100; i++) await put(source, 'MAPS', `A${i}`, { features: {} });
        await expect(run()).rejects.toThrow(/100 mapas/);
        expect(await values(source, 'MAPS')).toHaveLength(100);
    });
    // FASE 2c DAS FOTOS ANEXAS (2026-09-24): a conta de figuras ausentes olha a foto por REFERÊNCIA
    // de feição e de 3D/360, e nunca a inline, que chega dentro do próprio arquivo.
    it('a foto inline de 3D não é contada como ausente: os bytes vieram no documento', async () => {
        const data = input();
        data.cesium3d.A.markers[0].images.push({ id: 'inline', name: 'velha.jpg', data: 'data:image/png;base64,AQID' });
        expect((await run(data)).missingOriginalImages).toBe(0);
        const imported = (await values(destination, 'MAPS')).find(map => map.name === 'A_1');
        const inline = (await get(destination, 'CESIUM3D', `cesium3d_${imported.id}`)).markers[0].images[1];
        expect(inline.data).toBe('data:image/png;base64,AQID');
    });
    it('a foto de FEIÇÃO por referência vem do arquivo sob o id novo, e a que falta é contada', async () => {
        const data = input();
        data.maps.A.features.points[0].properties.images = [{ id: 'fphoto', name: 'nova.jpg', thumbnail: 'data:image/jpeg;base64,/9j/' }];
        const zip = new JSZip();
        zip.file('images/photo.png', new Uint8Array([1, 2, 3]));
        zip.file('images/icon.png', new Uint8Array([4, 5]));
        zip.file('images/fphoto.jpg', new Uint8Array([9, 9]));
        const completo = await prepare(source, destination, { id: 'atlas', name: 'Original' }, data, zip,
            layers => ({ processed: layers, unavailableCount: 0 }));
        expect(completo.missingOriginalImages).toBe(0);
        const imported = (await values(destination, 'MAPS')).find(map => map.name === 'A_1');
        const foto = imported.features.points[0].properties.images[0];
        expect(foto.id).not.toBe('fphoto');
        expect([...new Uint8Array(await (await get(destination, 'IMAGES', foto.id)).arrayBuffer())]).toEqual([9, 9]);
    });
    it('a FIGURA DE SLIDE por referência ganha id novo, e o HTML do slide e das notas o segue', async () => {
        const figura = '11111111-1111-4111-8111-111111111111';
        const html = `<p>x</p><img src="https://figura.ebgeo/${figura}" width="9">`;
        const data = input();
        data.briefings[0].slides[0].content = html;
        data.mapNotes.A.description = html;
        const zip = new JSZip();
        zip.file('images/photo.png', new Uint8Array([1, 2, 3]));
        zip.file('images/icon.png', new Uint8Array([4, 5]));
        zip.file(`images/${figura}.jpg`, new Uint8Array([9, 9]));
        const result = await prepare(source, destination, { id: 'atlas', name: 'Original' }, data, zip,
            layers => ({ processed: layers, unavailableCount: 0 }));
        expect(result.missingOriginalImages).toBe(0);
        const briefing = (await values(destination, 'BRIEFINGS')).find(b => b.slides?.length);
        const novo = briefing.slides[0].content.match(/figura\.ebgeo\/([0-9a-f-]{36})/)[1];
        expect(novo).not.toBe(figura);
        expect(briefing.slides[0].content).toContain('width="9"');
        expect([...new Uint8Array(await (await get(destination, 'IMAGES', novo)).arrayBuffer())]).toEqual([9, 9]);
        const importado = (await values(destination, 'MAPS')).find(map => map.name === 'A_1');
        const notas = await get(destination, 'SETTINGS', `map_notes_${importado.id}`);
        expect(notas?.description ?? '').toContain(`figura.ebgeo/${novo}`);
    });

    it('a FIGURA DE SLIDE que o arquivo não traz é contada como ausente', async () => {
        const data = input();
        data.briefings[0].slides[0].content = '<img src="https://figura.ebgeo/11111111-1111-4111-8111-111111111111">';
        const result = await run(data);
        expect(result.missingOriginalImages).toBe(1);
    });

    it('a foto de FEIÇÃO por referência que o arquivo não traz é contada como ausente', async () => {
        const data = input();
        data.maps.A.features.points[0].properties.images = [{ id: 'fphoto', name: 'nova.jpg' }];
        expect((await run(data)).missingOriginalImages).toBe(1);
    });
});
