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
                for (const type of ['military_symbols', 'coordination_measures']) {
                    for (const feature of map.features?.[type] || []) {
                        if (feature.properties.bitmapVersion !== 2) regenerable.set(feature.properties.id, feature.properties);
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
                expect(props).toMatchObject({ bitmapVersion: 2, source: regenerable.get(id).source });
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
            expect(errors).toEqual([]);
        });
    }
}
