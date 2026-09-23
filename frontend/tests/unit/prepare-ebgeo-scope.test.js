// Path: tests/unit/prepare-ebgeo-scope.test.js
import { beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
const disk = vi.hoisted(() => ({ stores: new Map(), fail: null, corrupt: false }));
vi.mock('@store/atlas-namespace.js', async original => ({
    ...await original(),
    getStoreFor: (name) => {
        if (!disk.stores.has(name)) disk.stores.set(name, new Map());
        const store = disk.stores.get(name);
        return {
            setItem: async (key, value) => {
                if (disk.fail === name) throw new DOMException('quota', 'QuotaExceededError');
                store.set(key, disk.corrupt ? null : structuredClone(value));
            },
            getItem: async key => store.get(key),
        };
    },
}));
import { prepareEbgeoScope } from '@js/import_export/prepare-ebgeo-scope.js';
import { StoreName } from '@store/atlas-namespace.js';

beforeEach(() => { disk.stores.clear(); disk.fail = null; disk.corrupt = false; });
const data = () => ({
    maps: { A: { id: 'duplicate', features: { points: [{ properties: { id: 'point' } }] } }, B: { id: 'duplicate', features: {} } },
    currentMap: 'B', mapOrder: ['B', 'A'],
    groups: { A: { g: { id: 'g', features: [{ id: 'point' }] } } },
    layers: { A: [{ id: 'default' }] },
    mapNotes: { A: { title: 'Notes', description: 'Keep this' } },
    temporal: { A: { ativo: true } }, gridStyle: { A: { format: 'utm' } },
    cesium3d: { A: { markers: [{ id: '3d', images: ['photo'] }] } },
    streetview360: { A: { markers: [{ id: '360' }] } },
    comments: { A: { c: { text: 'Comment' } } }, colorUsage: { A: { red: 3 } },
    briefings: [{ id: 'brief', name: 'Briefing', slides: [{ id: 'slide', mapId: 'A' }] }],
    customIcons: [{ id: 'photo', name: 'Icon' }],
});
async function run(document = data()) {
    const zip = new JSZip();
    zip.file('images/photo.jpg', new Uint8Array([255, 216, 255, 1]));
    return prepareEbgeoScope({ kind: 'local', dbSuffix: 'isolated' }, { id: 'atlas', name: 'Atlas' }, document, zip,
        layers => ({ processed: layers, unavailableCount: 0 }));
}

describe('complete isolated import', () => {
    it.each(['__proto__', 'constructor', 'toString'])('does not import inherited side records for map %s', async name => {
        const document = {
            maps: Object.fromEntries([[name, { features: {} }]]),
            groups: {}, layers: {}, comments: {}, cesium3d: {}, streetview360: {},
            temporal: {}, mapNotes: {}, gridStyle: {}, colorUsage: {},
        };
        const result = await run(document);
        expect(result.importedMapsCount).toBe(1);
        const maps = [...disk.stores.get(StoreName.MAPS).values()];
        expect(maps).toHaveLength(1);
        expect(maps[0].name).toBe(name);
        for (const store of [StoreName.GROUPS, StoreName.LAYERS, StoreName.COMMENTS, StoreName.CESIUM3D, StoreName.STREETVIEW360]) {
            expect(disk.stores.get(store)?.size ?? 0).toBe(0);
        }
        expect(disk.stores.get(StoreName.SETTINGS).has(`temporal_${name}`)).toBe(false);
    });
    it('preserves all sections, image bytes/MIME, map order, current map and separate identities', async () => {
        const result = await run();
        expect(result.importedMapsCount).toBe(2);
        const maps = [...disk.stores.get(StoreName.MAPS).values()];
        expect(new Set(maps.map(map => map.id)).size).toBe(2);
        const a = maps.find(map => map.name === 'A');
        const b = maps.find(map => map.name === 'B');
        expect(a.features.points[0].properties.id).toBe('point');
        expect(disk.stores.get(StoreName.GROUPS).get(a.id).g.features).toEqual([{ id: 'point' }]);
        expect(disk.stores.get(StoreName.LAYERS).get(`layers_${a.id}`)).toEqual([{ id: 'default' }]);
        expect(disk.stores.get(StoreName.SETTINGS).get(`map_notes_${a.id}`).description).toBe('Keep this');
        expect(disk.stores.get(StoreName.SETTINGS).get('mapOrder')).toEqual(['B', 'A']);
        expect(disk.stores.get(StoreName.SETTINGS).get('lastActiveMap')).toBe(b.id);
        expect(disk.stores.get(StoreName.COMMENTS).get(`comments_${a.id}`).c.text).toBe('Comment');
        expect(disk.stores.get(StoreName.CESIUM3D).get(`cesium3d_${a.id}`).markers[0].images).toEqual(['photo']);
        expect(disk.stores.get(StoreName.STREETVIEW360).get(`streetview360_${a.id}`).markers[0].id).toBe('360');
        expect(disk.stores.get(StoreName.BRIEFINGS).get('brief').slides[0].mapId).toBe('A');
        const blob = disk.stores.get(StoreName.IMAGES).get('photo');
        expect(blob.type).toBe('image/jpeg');
        expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([255, 216, 255, 1]);
        expect(disk.stores.get(StoreName.ATLAS).get('current_atlas').mapOrder).toEqual([b.id, a.id]);
    });
    it.each([StoreName.MAPS, StoreName.GROUPS, StoreName.LAYERS, StoreName.COMMENTS,
        StoreName.IMAGES, StoreName.BRIEFINGS, StoreName.SETTINGS, StoreName.ATLAS])('propagates a persistence failure in %s', async name => {
        disk.fail = name;
        await expect(run()).rejects.toThrow('quota');
    });
    it('detects a successful write whose read-back is corrupt', async () => {
        disk.corrupt = true;
        await expect(run()).rejects.toThrow('verificação');
    });
    it('prepares a usable Principal for an empty archive', async () => {
        await run({ maps: {} });
        expect([...disk.stores.get(StoreName.MAPS).values()][0].name).toBe('Principal');
    });
});
