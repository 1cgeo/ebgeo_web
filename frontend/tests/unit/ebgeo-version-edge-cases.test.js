import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Buffer } from 'node:buffer';
import JSZip from 'jszip';
import { importVersionRefusal, readEbgeoArchive, xorMask } from '@js/import_export/ebgeo-file-gate.js';
import { importEbgeoAsAtlas } from '@js/projects/import-ebgeo.service.js';
import { isValidUUID } from '@utils/uuid.js';

vi.mock('@js/session/uso-lote.js', () => ({ registrarUso: vi.fn() }));

const feature = (id, source = 'image') => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [-47, -15] }, properties: { id, source } });
const document = (version = '2.4') => ({ version, maps: { Principal: { features: {} } } });
async function archive(data, { masked = false, images = {} } = {}) {
    const zip = new JSZip();
    zip.file('data.json', JSON.stringify(data));
    for (const [name, bytes] of Object.entries(images)) zip.file(name, bytes);
    const raw = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' });
    const bytes = masked ? Buffer.concat([Buffer.from('EBGXOR'), xorMask(raw)]) : raw;
    return { name: 'legado.ebgeo', arrayBuffer: async () => Uint8Array.from(bytes).buffer };
}
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
let api;
beforeEach(() => {
    vi.stubGlobal('FileReader', class {
        readAsDataURL(blob) {
            blob.arrayBuffer().then(bytes => {
                this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString('base64')}`;
                this.onloadend?.();
            }).catch(error => { this.error = error; this.onerror?.(); });
        }
    });
    api = { importAtlas: vi.fn(async () => ({ id: 'server-atlas' })),
        bulkUploadImages: vi.fn(async (_id, items) => ({ mapping: Object.fromEntries(items.map(item => [item.localId, item.localId])), failed: [] })) };
});
afterEach(() => vi.unstubAllGlobals());

describe('one version/structure gate for every file import', () => {
    it.each(['1.3', '1.3.0', '1.7', '2.0', '2.2', '2.3', '2.4', '2.4.1', '3.0', '3.0.0'])('accepts supported schema %s', version => {
        expect(importVersionRefusal(document(version))).toBeNull();
    });
    it.each(['1.0', '1.2', '3.0.1', '3.1', 'future', '2.nan', 2.4, {}, true])('refuses invalid/unsupported marker %s before creating a server atlas', async version => {
        const data = document(version);
        expect(importVersionRefusal(data)).toBeTruthy();
        await expect(importEbgeoAsAtlas(await archive(data), { apiClient: api })).rejects.toThrow();
        expect(api.importAtlas).not.toHaveBeenCalled();
    });
    it.each([{ schemaVersion: '99.0' }, { atlas: { schemaVersion: '99.0' } }, { schemaVersion: {} }])('does not conceal an incompatible inner marker: %j', extra => {
        expect(importVersionRefusal({ ...document('1.7'), ...extra })).toBeTruthy();
    });
    it.each([null, [], { version: '2.4' }, { version: '2.4', maps: [] },
        { version: '2.4', maps: { M: null } }, { version: '2.4', maps: { M: { features: { points: {} } } } },
        { version: '2.4', maps: { M: { features: { points: [null] } } } }])('refuses corrupt collections %j', data => {
        expect(importVersionRefusal(data)).toBeTruthy();
    });
    it('rejects ambiguous image IDs before either importer writes data', async () => {
        const file = await archive(document(), { images: { 'images/a.png': png, 'images/a.jpg': png } });
        await expect(readEbgeoArchive(file)).rejects.toThrow(/ambíguo/);
        await expect(importEbgeoAsAtlas(file, { apiClient: api })).rejects.toThrow();
        expect(api.importAtlas).not.toHaveBeenCalled();
    });
    it('checks CRC of image entries before a destructive import is possible', async () => {
        const file = await archive(document(), { images: { 'images/a.png': png } });
        const bytes = Buffer.from(await file.arrayBuffer());
        const offset = bytes.indexOf(png);
        expect(offset).toBeGreaterThan(0);
        bytes[offset] ^= 1;
        await expect(readEbgeoArchive({ arrayBuffer: async () => bytes })).rejects.toThrow(/corrompido/);
    });
});

describe('server migration preserves image references', () => {
    it('refuses a lossy feature conversion before creating an incomplete atlas', async () => {
        const data = document();
        data.maps.Principal.features.unknown_tool = [feature('unknown', 'unknown')];
        await expect(importEbgeoAsAtlas(await archive(data), { apiClient: api })).rejects.toThrow(/convertida/);
        expect(api.importAtlas).not.toHaveBeenCalled();
    });
    it('migrates barrier lines and preserves UUID-based briefing map references', async () => {
        const data = document('2.2');
        data.maps.Principal.id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
        data.maps.Principal.features.barrier_lines = [{ ...feature('barrier', 'barrier_line'), geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } }];
        data.briefings = [{ id: 'brief', slides: [{ id: 'slide', mapId: data.maps.Principal.id }] }];
        await importEbgeoAsAtlas(await archive(data), { apiClient: api });
        const payload = api.importAtlas.mock.calls[0][0];
        expect(payload.maps[0].features[0].feature_type).toBe('coordination_line');
        expect(payload.briefings[0].slides[0].map_id).toBe(payload.maps[0].id);
    });
    it.each([false, true])('reads plain/masked archives and isolates repeated imports (masked=%s)', async masked => {
        const data = document('1.7');
        data.maps.Principal.features.images = [feature('old-photo')];
        data.maps.Principal.features.points = [{ ...feature('p', 'point'), properties: { id: 'p', source: 'point', markerSymbol: 'custom:old-icon' } }];
        data.customIcons = [{ id: 'old-icon', name: 'Antigo' }];
        data.cesium3d = { Principal: { markers: [{ id: 'marker', images: ['old-photo'] }] } };
        const file = await archive(data, { masked, images: { 'images/old-photo.png': png, 'images/old-icon.png': png } });
        const first = await importEbgeoAsAtlas(file, { apiClient: api });
        expect(first.imageStats).toEqual({ total: 2, uploaded: 2, skipped: 0, failed: 0 });
        const payload = api.importAtlas.mock.calls[0][0];
        const photoId = payload.maps[0].features.find(f => f.feature_type === 'image').id;
        const iconId = payload.atlas.settings.customIcons[0].id;
        expect(isValidUUID(photoId)).toBe(true);
        expect(isValidUUID(iconId)).toBe(true);
        expect(payload.maps[0].features.find(f => f.feature_type === 'point').properties.markerSymbol).toBe(`custom:${iconId}`);
        expect(JSON.stringify(payload.maps[0].cesium3dData)).toContain(photoId);
        expect(api.importAtlas.mock.calls[0][1].images.map(item => item.localId)).toEqual(expect.arrayContaining([photoId, iconId]));
        await importEbgeoAsAtlas(file, { apiClient: api });
        expect(api.importAtlas.mock.calls[1][0].maps[0].features.find(f => f.feature_type === 'image').id).not.toBe(photoId);
        expect(data.maps.Principal.features.images[0].properties.id).toBe('old-photo');
    });
    it('collects image buckets even when legacy source is absent, refusing missing original bytes before POST', async () => {
        const data = document();
        data.maps.Principal.features.images = [feature('photo')];
        delete data.maps.Principal.features.images[0].properties.source;
        await expect(importEbgeoAsAtlas(await archive(data), { apiClient: api })).rejects.toThrow(/ausente/);
        expect(api.importAtlas).not.toHaveBeenCalled();
    });
    it('does not report success when atomic publication cannot be confirmed', async () => {
        const data = document();
        data.maps.Principal.features.images = [feature('photo')];
        api.importAtlas.mockRejectedValue(new Error('unconfirmed commit'));
        await expect(importEbgeoAsAtlas(await archive(data, { images: { 'images/photo.png': png } }), { apiClient: api })).rejects.toThrow('unconfirmed commit');
        expect(api.bulkUploadImages).not.toHaveBeenCalled();
    });
});
