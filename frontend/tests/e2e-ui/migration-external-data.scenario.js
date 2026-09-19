import { Buffer } from 'node:buffer';
import JSZip from 'jszip';
// External files are read only. Every test uses a fresh browser context and disposable backend.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { loadEbgeoFixture, buildLegacyEntries, countFixture } from '../helpers/ebgeo-fixture.js';
import { readState } from './state.js';

const directory = process.env.EBGEO_MIGRATION_DATA_DIR;
const cases = [
    ['01-completo.ebgeo', '2.2', 11, 262, 5],
    ['02-minimo.ebgeo', '2.2', 1, 1, 0],
    ['03-completo-2.4.ebgeo', '2.4', 14, 805, 149],
    ['04-completo-2.3.ebgeo', '2.3', 14, 787, 131],
    ['05-completo-2.2.ebgeo', '2.2', 14, 776, 131],
    ['03-completo-2.4.ebgeo', '2.4', 14, 805, 149, '1.7']
];
const fileHash = path => createHash('sha256').update(readFileSync(path)).digest('hex');

test.beforeAll(() => { expect(readState().skip, 'o backend de teste precisa estar disponível').toBe(false); });

async function blank(page) {
    await page.route('**/__migration_external__', route => route.fulfill({
        contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>Ensaio isolado</title>'
    }));
    await page.goto('/__migration_external__');
}

async function boot(page) {
    await page.goto('/');
    await expect(page.locator('#nav-btn-zoom-in')).toBeAttached({ timeout: 45000 });
    await page.waitForFunction(() => Boolean(globalThis.__ebgeoMap?.getZoom), null, { timeout: 45000 });
    // The MapLibre instance exists before IndexedDB initialization mounts the atlas.
    // Wait for the actual boot curtain to leave before inspecting the active stores.
    await expect(page.locator('.loading-background')).toHaveCount(0, { timeout: 45000 });
    // The curtain also disappears on a boot error, and precedes the final atlas routing.
    // This hook is installed only after the store initialization and tab-lock setup.
    await page.waitForFunction(() => typeof globalThis.__ebgeoSwitchAtlas === 'function', null, { timeout: 45000 });
}

async function counts(page) {
    return page.evaluate(async () => {
        const ns = await import('/src/js/store/atlas-namespace.js');
        const maps = ns.getStore(ns.StoreName.MAPS);
        const names = await maps.keys();
        let features = 0;
        const byMap = {};
        for (const key of names) {
            const map = await maps.getItem(key);
            const count = Object.values(map.features || {}).reduce((n, list) => n + (Array.isArray(list) ? list.length : 0), 0);
            features += count;
            byMap[map.name || key] = count;
        }
        return { maps: names.length, features, byMap, images: await ns.getStore(ns.StoreName.IMAGES).keys(),
            scope: ns.getActiveScope(), registry: await ns.readLocalAtlasRegistry() };
    });
}

// Independent comparison: compare canonical JSON and raw Blob bytes, not migration hashes.
async function compareCopy(page, entries, scope, atlasName) {
    return page.evaluate(async ({ entries, scope, atlasName }) => {
        const ns = await import('/src/js/store/atlas-namespace.js');
        const canonical = value => JSON.stringify(normalize(value));
        function normalize(value) {
            if (Array.isArray(value)) return value.map(normalize);
            if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])]));
            return value;
        }
        const differences = [];
        let records = 0, imageBytes = 0;
        for (const [id, values] of Object.entries(entries)) {
            const store = ns.getStoreFor(id, scope);
            for (const [key, original] of Object.entries(values)) {
                const landed = await store.getItem(key);
                records++;
                if (id === 'images') {
                    if (!(landed instanceof Blob)) { differences.push(`${id}:${key}:tipo`); continue; }
                    const bytes = new Uint8Array(await landed.arrayBuffer());
                    imageBytes += bytes.length;
                    if (bytes.length !== original.length || bytes.some((byte, i) => byte !== original[i])) differences.push(`${id}:${key}:bytes`);
                    continue;
                }
                let expected = original;
                if (id === 'settings' && key === 'schemaVersion') expected = '3.0';
                if (id === 'atlas') expected = { ...original, schemaVersion: '3.0', name: atlasName };
                if (id === 'maps' && original.name === 'Principal' && key !== 'Principal') expected = { ...original, name: key };
                if (canonical(landed) !== canonical(expected)) differences.push(`${id}:${key}`);
            }
        }
        return { differences, records, imageBytes };
    }, { entries, scope, atlasName });
}

// Check the actual MapLibre raster and GPU-rendered feature after visiting EVERY map.
// Hidden/temporal layers are made visible only in this disposable browser view.
async function inspectRestoredImages(page, testInfo, fixture) {
    // Known defective definitions in 01-completo: no PNG, invalid SIDC, no pointCode.
    // The legacy declination aliases are recoverable and MUST render. Preserve the rest
    // and assert the visible error placeholder; do not count them as restored drawings.
    const defectiveDefinitions = ['7349fcb9-5d7b-4cd5-b9f6-69aed07d9156', '1aa313b5-26e8-485b-8224-2ba700028fbe',
        '1aa80bf7-6930-4e9f-b52a-ff1eb0ab6ad2', 'd817e2eb-6826-4aff-a344-73b60b11692b',
        '5ee25711-4a06-41c4-9fe5-d0fca11d4303', 'd461589d-0b32-41dc-963b-0c7e9737da61', '87653b44-1a23-4c8f-8b36-a8c4783ad1f9'];
    const originallyAbsent = Object.values(fixture.data.maps).flatMap(map => (map.features.images || []).filter(f => !fixture.images.has(f.properties.id)).map(f => f.properties.id));
    originallyAbsent.push(...defectiveDefinitions);
    const result = await page.evaluate(async originallyAbsent => {
        const store = await import('/src/js/store/index.js');
        const map = globalThis.__ebgeoMap;
        const layers = { images: 'image-layer', military_symbols: 'military-symbols-layer',
            coordination_measures: 'coordination-measures-layer', magnetic_declinations: 'magnetic-declinations-layer' };
        const checked = [];
        const rendered = [];
        const missingInOriginal = [];
        const recoveredWithoutStyleOverrides = [];
        for (const name of await store.getAllMapNamesStore()) {
            await store.setCurrentMap(name);
            await store.getControl('BaseLayerControl').switchMap();
            const features = await store.getCurrentMapFeatures();
            for (const [type, layer] of Object.entries(layers)) {
                const list = features[type] || [];
                for (const feature of list) {
                    const id = feature.properties.id;
                    const blob = await store.getImage(id);
                    if (originallyAbsent.includes(id)) {
                        if (!map.hasImage(id)) throw new Error(`No visible placeholder for ${id}`);
                        missingInOriginal.push({ name, id });
                        continue;
                    }
                    if (!blob) throw new Error(`Missing blob ${name}/${id}`);
                    const decoded = await createImageBitmap(blob);
                    const installed = map.getImage(id);
                    if (!installed || installed.data.width !== decoded.width || installed.data.height !== decoded.height) {
                        throw new Error(`Missing/wrong raster ${name}/${id}`);
                    }
                    if (!installed.data.data.some((v, i) => i % 4 === 3 && v > 0)) throw new Error(`Transparent raster ${id}`);
                    checked.push({ name, type, id, width: decoded.width, height: decoded.height });
                    decoded.close();
                    if (id === 'd6088ac9-6e73-4d64-8934-c79b96ca1fae') {
                        // Exercise real layer defaults: the generic sampling below forces
                        // opacity/size and would hide an incomplete property migration.
                        map.jumpTo({ center: feature.geometry.coordinates, zoom: 12 });
                        const deadline = performance.now() + 10000;
                        while (!map.queryRenderedFeatures({ layers: [layer] }).some(f => f.properties.id === id)) {
                            if (performance.now() > deadline) throw new Error(`Recovered declination not visible ${id}`);
                            await new Promise(resolve => setTimeout(resolve, 50));
                        }
                        recoveredWithoutStyleOverrides.push(feature);
                    }
                }
                if (!list.length) continue;
                const sample = list.find(f => !originallyAbsent.includes(f.properties.id));
                if (!sample) continue;
                map.setFilter(layer, null);
                map.setLayoutProperty(layer, 'visibility', 'visible');
                map.setLayoutProperty(layer, 'icon-size', 0.5);
                map.setPaintProperty(layer, 'icon-opacity', 1);
                map.jumpTo({ center: sample.geometry.coordinates, zoom: sample.properties.createdAtZoom || 12 });
                const deadline = performance.now() + 10000;
                while (!map.queryRenderedFeatures({ layers: [layer] }).some(f => f.properties.id === sample.properties.id)) {
                    if (performance.now() > deadline) throw new Error(`Not rendered ${name}/${type}/${sample.properties.id}`);
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
                rendered.push({ name, type, id: sample.properties.id });
            }
        }
        return { checked, rendered, missingInOriginal, recoveredWithoutStyleOverrides };
    }, originallyAbsent);
    const originalDeclination = Object.values(fixture.data.maps)
        .flatMap(map => map.features.magnetic_declinations || [])
        .find(feature => feature.properties.id === 'd6088ac9-6e73-4d64-8934-c79b96ca1fae');
    if (originalDeclination) {
        expect(result.recoveredWithoutStyleOverrides).toHaveLength(1);
        expect(result.recoveredWithoutStyleOverrides[0]).toMatchObject({
            geometry: originalDeclination.geometry,
            properties: { ...originalDeclination.properties, declination: -21.5, convergence: 0.7, opacity: 1 },
        });
        expect(result.checked).toContainEqual(expect.objectContaining({
            id: originalDeclination.properties.id, width: 400, height: 500,
        }));
    }
    await testInfo.attach('rendered-images.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
    console.info('IMAGES_RENDERED', JSON.stringify({ test: testInfo.title, images: result.checked.length, samples: result.rendered.length, defectiveOriginals: result.missingInOriginal }));
    return result;
}

for (const [filename, version, maps, features, images, settingsVersion] of cases) {
    const label = settingsVersion ? `${filename} [settings ${settingsVersion}, atlas ${version}]` : filename;
    test(`${label}: migração, três boots e recuperação bruta`, async ({ page }, testInfo) => {
        const path = join(directory, filename);
        const hash = fileHash(path);
        const fixture = await loadEbgeoFixture(path);
        const declared = countFixture(fixture);
        expect(declared).toMatchObject({ schemaVersion: version, maps, features, images });
        const entries = buildLegacyEntries(fixture, { schemaVersion: version, atlasName: filename,
            imageValue: bytes => Array.from(bytes), now: 1755000000000 });
        if (settingsVersion) entries.settings.schemaVersion = settingsVersion;
        await blank(page);
        const initial = await page.evaluate(async entries => {
            const ns = await import('/src/js/store/atlas-namespace.js');
            const legacy = ns.localScope('legacy', '');
            for (const [id, values] of Object.entries(entries)) {
                const store = ns.getStoreFor(id, legacy);
                for (const [key, value] of Object.entries(values)) {
                    await store.setItem(key, id === 'images' ? new Blob([new Uint8Array(value)], { type: 'image/png' }) : value);
                }
            }
            const { inventoryScope, prepareLegacyTransition } = await import('/src/js/store/migration/legacy-transition.js');
            const before = await inventoryScope(legacy);
            const start = performance.now();
            const { state } = await prepareLegacyTransition();
            return { state, before, elapsedMs: performance.now() - start, scope: ns.localScope(state.entry.id, state.destination) };
        }, entries);
        const checked = await compareCopy(page, entries, initial.scope, filename);
        expect(checked.differences).toEqual([]);
        for (let i = 0; i < 3; i++) {
            await boot(page);
            const current = await counts(page);
            expect(current).toMatchObject({ maps, features, byMap: declared.featuresByMap });
            expect(current.scope.dbSuffix).toBe(initial.state.destination);
            expect(current.registry).toHaveLength(1);
            expect(current.images).toEqual(expect.arrayContaining([...fixture.images.keys()]));
        }
        // Recovery runs from its own screen, with the map closed. A live map can still
        // persist its camera after the splash disappears; a snapshot must refuse that race.
        await blank(page);
        const restored = await page.evaluate(async before => {
            const ns = await import('/src/js/store/atlas-namespace.js');
            const migration = await import('/src/js/store/migration/legacy-transition.js');
            const recovery = await import('/src/js/store/migration/recovery-archive.js');
            const sourceIntact = JSON.stringify(before) === JSON.stringify(await migration.inventoryScope(ns.localScope('legacy', '')));
            const zip = await recovery.buildRecoveryArchive();
            const archive = await recovery.readRecoveryArchive(zip);
            const entry = await recovery.restoreRecoveryArchive(archive, 0);
            return { sourceIntact, zipBytes: zip.size, entry, scope: ns.localScope(entry.id, entry.dbSuffix) };
        }, initial.before);
        expect(restored.sourceIntact).toBe(true);
        expect((await compareCopy(page, entries, restored.scope, restored.entry.name)).differences).toEqual([]);
        expect(fileHash(path)).toBe(hash);
        const report = { filename, settingsVersion: settingsVersion || version, sha256: hash, ...declared, ...checked, elapsedMs: initial.elapsedMs, recoveryZipBytes: restored.zipBytes };
        await testInfo.attach('preservacao.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
        console.info('PRESERVACAO', JSON.stringify(report));
        await boot(page);
        await inspectRestoredImages(page, testInfo, fixture);
    });

    if (!settingsVersion) {
        test(`${filename}: importação pela interface e reabertura`, async ({ page }, testInfo) => {
            const path = join(directory, filename);
            const hash = fileHash(path);
            const fixture = await loadEbgeoFixture(path);
            const declared = countFixture(fixture);
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.goto('/atlas.html');
            await expect(page.getByTestId('local-atlas-open-file')).toBeVisible({ timeout: 45000 });
            await page.getByTestId('local-atlas-file-input').setInputFiles(path);
            await page.waitForURL(url => !url.pathname.endsWith('atlas.html'), { timeout: 45000 });
            // Maps are written first; their count alone does not mean images/side stores finished.
            await expect(page.getByText(maps === 1 ? '1 mapa carregados!' : `${maps} mapas carregados!`, { exact: true }))
                .toBeVisible({ timeout: 90000 });
            await expect.poll(async () => {
                try { return (await counts(page)).features; } catch { return -1; }
            }, { timeout: 90000 }).toBe(features);
            const first = await counts(page);
            expect(first).toMatchObject({ maps, features, byMap: declared.featuresByMap });
            expect(first.images).toEqual(expect.arrayContaining([...fixture.images.keys()]));
            const imageCheck = await compareCopy(page, { images: Object.fromEntries(
                [...fixture.images].map(([id, bytes]) => [id, Array.from(bytes)])) }, first.scope, '');
            // The renderer deliberately upgrades old symbol/measure PNG caches to bitmap v2.
            // Photos and attachments must remain byte-identical; a cache change also requires
            // the same symbol definition and the explicit v2 stamp on the stored feature.
            const regenerable = new Map();
            for (const map of Object.values(fixture.data.maps)) {
                for (const type of ['military_symbols', 'coordination_measures', 'magnetic_declinations']) {
                    for (const feature of map.features?.[type] || []) {
                        regenerable.set(feature.properties.id, feature.properties);
                    }
                }
            }
            for (const difference of imageCheck.differences) {
                const [, id, reason] = difference.split(':');
                expect(reason).toBe('bytes');
                expect(regenerable.has(id), `a imagem ${id} não é cache antigo regenerável`).toBe(true);
                const props = await page.evaluate(async id => {
                    const ns = await import('/src/js/store/atlas-namespace.js');
                    const maps = ns.getStore(ns.StoreName.MAPS);
                    for (const key of await maps.keys()) {
                        const map = await maps.getItem(key);
                        for (const list of Object.values(map.features || {})) {
                            if (!Array.isArray(list)) continue;
                            const feature = list.find(feature => feature.properties?.id === id);
                            if (feature) return feature.properties;
                        }
                    }
                    return null;
                }, id);
                expect(props.source).toBe(regenerable.get(id).source);
                if (props.source !== 'magnetic_declination') expect(props.bitmapVersion).toBe(2);
                expect(props.declination).toBe(regenerable.get(id).declination);
                expect(props.convergence).toBe(regenerable.get(id).convergence);
                expect(props.sidc).toBe(regenerable.get(id).sidc);
                expect(props.pointCode).toBe(regenerable.get(id).pointCode);
            }
            await testInfo.attach('imagens-importadas.json', { body: JSON.stringify(imageCheck, null, 2), contentType: 'application/json' });
            console.info('IMAGENS_IMPORTADAS', JSON.stringify({ filename, ...imageCheck }));
            await boot(page);
            expect(await counts(page)).toMatchObject({ maps, features, byMap: declared.featuresByMap });
            expect(fileHash(path)).toBe(hash);
            await testInfo.attach('importacao.json', { body: JSON.stringify({ filename, sha256: hash, maps, features, images: first.images.length, pageErrors: errors }, null, 2), contentType: 'application/json' });
            console.info('IMPORTACAO', JSON.stringify({ filename, maps, features, images: first.images.length, pageErrors: errors }));
            await inspectRestoredImages(page, testInfo, fixture);
            expect(errors).toEqual([]);
        });
    }
}


for (const route of ['browser-v1', 'file-v1']) {
    test(`${route}: non-UUID image IDs survive v1 migration and render after F5`, async ({ page }, testInfo) => {
        const original = await loadEbgeoFixture(join(directory, '03-completo-2.4.ebgeo'));
        const principal = structuredClone(original.data.maps.Principal);
        const images = new Map();
        const selected = {};
        for (const type of ['images', 'military_symbols', 'coordination_measures', 'magnetic_declinations']) {
            const feature = principal.features[type][0];
            const oldId = feature.properties.id;
            feature.properties.id = `legacy-${type}`;
            feature.properties.bitmapVersion = 1;
            selected[type] = [feature];
            images.set(feature.properties.id, original.images.get(oldId));
        }
        principal.features = selected;
        const fixture = { data: { version: '1.7', currentMap: 'Principal', mapOrder: ['Principal'], maps: { Principal: principal }, layers: {}, groups: {} }, images };
        if (route === 'browser-v1') {
            const entries = buildLegacyEntries(fixture, { schemaVersion: '1.7', imageValue: bytes => Array.from(bytes) });
            await blank(page);
            await page.evaluate(async entries => {
                const ns = await import('/src/js/store/atlas-namespace.js');
                const legacy = ns.localScope('legacy', '');
                for (const [id, values] of Object.entries(entries)) {
                    for (const [key, value] of Object.entries(values)) {
                        await ns.getStoreFor(id, legacy).setItem(key, id === 'images' ? new Blob([new Uint8Array(value)], { type: 'image/png' }) : value);
                    }
                }
            }, entries);
            await boot(page);
            const ids = await page.evaluate(async () => {
                const store = await import('/src/js/store/index.js');
                return Object.values(await store.getCurrentMapFeatures()).flatMap(list => Array.isArray(list) ? list.map(f => f.properties.id) : []);
            });
            expect(ids).toHaveLength(4);
            expect(ids.every(id => !id.startsWith('legacy-'))).toBe(true);
        } else {
            const zip = new JSZip();
            zip.file('data.json', JSON.stringify(fixture.data));
            for (const [id, bytes] of images) zip.file(`images/${id}.png`, bytes);
            const raw = await zip.generateAsync({ type: 'nodebuffer' });
            const buffer = Buffer.concat([Buffer.from('EBGXOR'), Buffer.from(raw.map(b => b ^ 0xaa))]);
            await page.goto('/atlas.html');
            await page.getByTestId('local-atlas-file-input').setInputFiles({ name: 'v1-images.ebgeo', mimeType: 'application/octet-stream', buffer });
            await expect(page.getByText('1 mapa carregados!', { exact: true })).toBeVisible({ timeout: 90000 });
        }
        await boot(page);
        const result = await inspectRestoredImages(page, testInfo, fixture);
        expect(result.checked).toHaveLength(4);
        expect(result.rendered).toHaveLength(4);
        await testInfo.attach('migrated-map.png', { body: await page.screenshot(), contentType: 'image/png' });
    });
}
