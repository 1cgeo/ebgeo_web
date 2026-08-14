// Path: e2e-ui/browser-feature-panel-edits.spec.js

/**
 * Browser-level feature style-panel edits: drives the REAL frontend transport
 * (api-client / operation-factory), imported live from the Vite dev server INSIDE
 * real Chromium, against the REAL spawned backend. Every assertion is grounded in a
 * `pullSync` snapshot — no mocks, real HTTP round-trips.
 *
 * Covers §17.3-6,9,18,20 of docs/acoes-interface-multiusuario.md: a `feature`
 * UPDATE round-trips the style properties the painel-de-edicao mutates. A feature is
 * a GeoJSON Feature whose type lives in `properties.source` and whose entire
 * `properties` bag is persisted to the `properties` JSONB column and overwritten
 * wholesale on update (Last-Write-Wins — see the headless twin
 * tests/e2e/attribute-custom.e2e.test.js). The style fields therefore ride inside
 * `properties` and reappear verbatim in the snapshot bucket. Op shapes mirror the
 * passing headless twins (tests/e2e/feature-crud.e2e.test.js, attribute-custom):
 *   createOperation('feature','create', id, mapId, { type:'Feature', geometry, properties:{ source, ... } })
 *   createOperation('feature','update', id, mapId, { properties: { source, ...style } })
 *
 * Coverage:
 *   - §17.3 fillColor (cor de preenchimento), §17.4 lineColor (cor de traço),
 *     §17.5 opacity, §17.6 width/size (espessura), §17.18 symbol rotation, and
 *     §17.20 a point label config (mostrar/texto/cor/contorno/zoom-correction) all
 *     round-trip on a point UPDATE;
 *   - §17.9 hatch pattern (padrão de hachura) round-trips on a POLYGON UPDATE;
 *   - last-write-wins: a 2nd update overwrites the style and (whole-properties
 *     replacement) drops a key omitted from the later payload.
 *
 * Each test self-provisions its own user + atlas + map for isolation.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

describeOrSkip('Feature style-panel edits (real Chromium + real backend, transport via page.evaluate)', () => {
    test('point style props (fill/line/opacity/width/rotation/label) round-trip on update; LWW on a 2nd update', async ({
        page,
    }) => {
        await page.goto('/');

        const result = await page.evaluate(async (baseUrl) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            const username = `fpe_pt_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
            const password = 'Sup3r-Secret-Pw!';
            await api.register({ username, password, nome: 'Feature Panel Owner' });
            await api.login(username, password);

            const atlas = await api.createAtlas({ name: 'Feature Panel Atlas' });
            const mapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [
                createOperation('map', 'create', mapId, null, { name: 'M1' }),
            ]);

            // ONE pull, and BOTH the entity and the counts come out of that SAME read.
            // A count taken from `find(...) || null` can only ever be 0 or 1, so it would
            // restate "I found it" instead of counting: it could never see a duplicate.
            // `total` is the whole points bucket of this freshly seeded map, which holds
            // exactly one point — so an extra row under ANY id (an update applied as a
            // second create, a snapshot that emits the entity twice) turns it red.
            const pullPoints = async (id) => {
                const pulled = await api.pullSync(atlas.id, 0);
                const map = pulled.snapshot?.maps?.find((m) => m.id === mapId);
                const points = map?.features?.points || [];
                return {
                    total: points.length,
                    withId: points.filter((f) => f.properties.id === id).length,
                    properties: points.find((f) => f.properties.id === id)?.properties || null,
                };
            };

            const pointId = crypto.randomUUID();

            // ---- CREATE a bare point (default style) ----------------------
            await api.pushOperations(atlas.id, [
                createOperation('feature', 'create', pointId, mapId, {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
                    properties: { source: 'point', layerId: null, nome: 'Símbolo' },
                }),
            ]);
            const created = await pullPoints(pointId);

            // ---- UPDATE: apply the painel-de-edicao style bag -------------
            // §17.3 fill, §17.4 line/traço, §17.5 opacity, §17.6 width/size,
            // §17.18 rotation, §17.20 label config (mostrar/texto/cor/contorno/zoom).
            const styled = {
                source: 'point',
                layerId: null,
                nome: 'Símbolo',
                fillColor: '#ff0000',
                lineColor: '#0000ff',
                opacity: 0.42,
                width: 5,
                size: 24,
                rotation: 135,
                label: {
                    show: true,
                    text: 'Posto',
                    color: '#00ff00',
                    haloColor: '#101010',
                    zoomCorrection: -2,
                },
                // a key the 2nd update will deliberately omit (LWW drop proof).
                legado: 'remove-me',
            };
            await api.pushOperations(atlas.id, [
                createOperation('feature', 'update', pointId, mapId, { properties: styled }),
            ]);
            const afterStyle = await pullPoints(pointId);

            // ---- 2nd UPDATE: last-write-wins, omits `legado` --------------
            const restyled = {
                source: 'point',
                layerId: null,
                nome: 'Símbolo',
                fillColor: '#123456',
                lineColor: '#abcdef',
                opacity: 0.9,
                width: 1,
                size: 8,
                rotation: 270,
                label: {
                    show: false,
                    text: 'Novo',
                    color: '#ffffff',
                    haloColor: '#222222',
                    zoomCorrection: 3,
                },
            };
            await api.pushOperations(atlas.id, [
                createOperation('feature', 'update', pointId, mapId, { properties: restyled }),
            ]);
            const afterRestyle = await pullPoints(pointId);

            return {
                hasToken: Boolean(api.getAccessToken()),
                createdSource: created.properties?.source,
                createdNoFill: Boolean(created.properties) && created.properties.fillColor === undefined,
                createdTotal: created.total,
                styled: afterStyle.properties,
                styledTotal: afterStyle.total,
                restyled: afterRestyle.properties,
                restyledTotal: afterRestyle.total,
                restyledWithId: afterRestyle.withId,
            };
        }, state.baseUrl);

        expect(result.hasToken).toBe(true);

        // baseline: the create put exactly ONE point in the map, and it has no style yet.
        expect(result.createdTotal).toBe(1);
        expect(result.createdSource).toBe('point');
        expect(result.createdNoFill).toBe(true);

        // ---- style props persisted after the 1st update ----
        const s = result.styled;
        expect(s).toBeTruthy();
        expect(s.fillColor).toBe('#ff0000'); // §17.3 cor de preenchimento
        expect(s.lineColor).toBe('#0000ff'); // §17.4 cor de traço
        expect(s.opacity).toBe(0.42); // §17.5 opacidade
        expect(s.width).toBe(5); // §17.6 espessura
        expect(s.size).toBe(24); // §17.6 tamanho do símbolo
        expect(s.rotation).toBe(135); // §17.18 rotação do símbolo
        // §17.20 configuração de rótulo (label) round-trips whole.
        expect(s.label).toEqual({
            show: true,
            text: 'Posto',
            color: '#00ff00',
            haloColor: '#101010',
            zoomCorrection: -2,
        });
        // backend-managed fields survive the update.
        expect(s.source).toBe('point');
        expect(s.id).toBeTruthy();
        // the update mutated the existing point instead of adding one.
        expect(result.styledTotal).toBe(1);

        // ---- LWW: the 2nd update overwrites the whole properties bag ----
        const r = result.restyled;
        expect(r).toBeTruthy();
        expect(r.fillColor).toBe('#123456');
        expect(r.lineColor).toBe('#abcdef');
        expect(r.opacity).toBe(0.9);
        expect(r.width).toBe(1);
        expect(r.size).toBe(8);
        expect(r.rotation).toBe(270);
        expect(r.label.show).toBe(false);
        expect(r.label.text).toBe('Novo');
        expect(r.label.zoomCorrection).toBe(3);
        // whole-properties replacement: a key omitted from the later payload is GONE.
        expect(r).not.toHaveProperty('legado');
        // update is not a second create — after TWO updates the map still holds exactly
        // one point in total, and exactly one entity answers to this id. Both numbers are
        // counted over the pulled bucket, not inferred from having found the entity.
        expect(result.restyledTotal).toBe(1);
        expect(result.restyledWithId).toBe(1);
    });

    test('§17.9 hatch pattern round-trips on a polygon update (and overwrites on a 2nd update)', async ({ page }) => {
        await page.goto('/');

        const result = await page.evaluate(async (baseUrl) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            const username = `fpe_pg_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
            const password = 'Sup3r-Secret-Pw!';
            await api.register({ username, password, nome: 'Feature Panel Polygon' });
            await api.login(username, password);

            const atlas = await api.createAtlas({ name: 'Feature Panel Polygon Atlas' });
            const mapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [
                createOperation('map', 'create', mapId, null, { name: 'M1' }),
            ]);

            // Same single read → entity + real counts (see the point test above).
            const pullPolygons = async (id) => {
                const pulled = await api.pullSync(atlas.id, 0);
                const map = pulled.snapshot?.maps?.find((m) => m.id === mapId);
                const polygons = map?.features?.polygons || [];
                return {
                    total: polygons.length,
                    withId: polygons.filter((f) => f.properties.id === id).length,
                    properties: polygons.find((f) => f.properties.id === id)?.properties || null,
                };
            };

            const polygonId = crypto.randomUUID();
            const geometry = {
                type: 'Polygon',
                coordinates: [
                    [
                        [-43.2, -22.9],
                        [-43.1, -22.9],
                        [-43.1, -22.8],
                        [-43.2, -22.9],
                    ],
                ],
            };

            await api.pushOperations(atlas.id, [
                createOperation('feature', 'create', polygonId, mapId, {
                    type: 'Feature',
                    geometry,
                    properties: { source: 'polygon', layerId: null },
                }),
            ]);

            // §17.9 padrão de hachura: the panel sets a hatch pattern + fill.
            await api.pushOperations(atlas.id, [
                createOperation('feature', 'update', polygonId, mapId, {
                    properties: {
                        source: 'polygon',
                        layerId: null,
                        fillColor: '#445566',
                        opacity: 0.6,
                        hatch: { pattern: 'diagonal', color: '#778899', spacing: 8, angle: 45 },
                    },
                }),
            ]);
            const hatched = await pullPolygons(polygonId);

            // 2nd update overwrites the hatch pattern (LWW).
            await api.pushOperations(atlas.id, [
                createOperation('feature', 'update', polygonId, mapId, {
                    properties: {
                        source: 'polygon',
                        layerId: null,
                        fillColor: '#445566',
                        opacity: 0.6,
                        hatch: { pattern: 'cross', color: '#000000', spacing: 4, angle: 0 },
                    },
                }),
            ]);
            const rehatched = await pullPolygons(polygonId);

            return {
                inPolygons: Boolean(hatched.properties),
                hatched: hatched.properties,
                hatchedTotal: hatched.total,
                rehatched: rehatched.properties,
                rehatchedTotal: rehatched.total,
                rehatchedWithId: rehatched.withId,
            };
        }, state.baseUrl);

        expect(result.inPolygons).toBe(true);

        const h = result.hatched;
        expect(h).toBeTruthy();
        expect(h.source).toBe('polygon');
        // §17.9 hatch pattern persisted whole.
        expect(h.hatch).toEqual({ pattern: 'diagonal', color: '#778899', spacing: 8, angle: 45 });
        expect(h.fillColor).toBe('#445566');
        expect(h.opacity).toBe(0.6);
        // the hatch update mutated the existing polygon instead of adding one.
        expect(result.hatchedTotal).toBe(1);

        // LWW: the later hatch pattern wins.
        const r = result.rehatched;
        expect(r).toBeTruthy();
        expect(r.hatch).toEqual({ pattern: 'cross', color: '#000000', spacing: 4, angle: 0 });
        expect(r.hatch.pattern).toBe('cross');
        // counted over the pulled bucket: two updates left ONE polygon in the map, and
        // exactly one entity answering to this id.
        expect(result.rehatchedTotal).toBe(1);
        expect(result.rehatchedWithId).toBe(1);
    });
});
