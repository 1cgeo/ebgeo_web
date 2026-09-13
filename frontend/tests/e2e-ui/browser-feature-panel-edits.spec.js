// Path: e2e-ui/browser-feature-panel-edits.spec.js

/**
 * Browser-level feature style-panel edits: drives the REAL frontend transport
 * (api-client / operation-factory), imported live from the Vite dev server INSIDE
 * real Chromium, against the REAL spawned backend. Every assertion is grounded in a
 * `pullSync` snapshot — no mocks, real HTTP round-trips.
 *
 * Covers §17.3-6,9,18,20 of docs/acoes-interface-multiusuario.md: a `feature`
 * UPDATE round-trips the style properties the painel-de-edicao mutates. A feature is
 * a GeoJSON Feature whose type lives in `properties.source`, so the style fields ride
 * inside `properties` and reappear verbatim in the snapshot bucket.
 *
 * A SEGUNDA EDIÇÃO NÃO VENCE MAIS "POR CHEGAR DEPOIS", E ISSO É O CONTRATO DE `5f91f2e9`
 * (2026-09-13). Até ali o `properties` inteiro era gravado por cima, e este spec media LWW cego:
 * quem chegasse por último escrevia. Hoje a op declara a base observada (`baseVersion`, lida de
 * `properties.confirmedVersion` da linha do snapshot) e um PATCH das unidades que mudou, e uma op
 * sem base é recusada por `RAZAO_SEM_BASE` antes de escrever. As duas edições daqui são
 * SEQUENCIAIS, cada uma contra a base que acabou de ler, então as duas são aceitas — o que o caso
 * mede é isso, e não a chegada. A queda da chave omitida (`legado`) sobrevive porque é o patch que
 * a produz: uma chave ausente do payload vira um `remove` explícito. Base velha contra base atual
 * é medido em browser-idempotency-lww.spec.js. Op shapes:
 *   createOperation('feature','create', id, mapId, { type:'Feature', geometry, properties:{ source, ... } })
 *   window.__ebgeoBase.opDeEdicao(api, atlasId, mapId, id, { properties: { source, ...style } })
 *
 * Coverage:
 *   - §17.3 fillColor (cor de preenchimento), §17.4 lineColor (cor de traço),
 *     §17.5 opacity, §17.6 width/size (espessura), §17.18 symbol rotation, and
 *     §17.20 a point label config (mostrar/texto/cor/contorno/zoom-correction) all
 *     round-trip on a point UPDATE;
 *   - §17.9 hatch pattern (padrão de hachura) round-trips on a POLYGON UPDATE;
 *   - a 2ª edição contra a base atual sobrescreve o estilo e derruba a chave omitida
 *     do payload posterior.
 *
 * Each test self-provisions its own user + atlas + map for isolation.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { createVerifiedUser } from './helpers/accounts.js';
import { instalarBaseConfirmada } from './helpers/base-confirmada.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

describeOrSkip('Feature style-panel edits (real Chromium + real backend, transport via page.evaluate)', () => {
    test('point style props (fill/line/opacity/width/rotation/label) round-trip on update; a 2ª edição contra a base atual sobrescreve', async ({
        page,
    }) => {
        await page.goto('/');
        await instalarBaseConfirmada(page);

        const user = await createVerifiedUser({ prefix: 'fpe_pt', nome: 'Feature Panel Owner' });

        const result = await page.evaluate(async ({ baseUrl, u }) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            await api.login(u.username, u.password);

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
                // a key the 2nd update will deliberately omit (prova da queda por `remove`).
                legado: 'remove-me',
            };
            // A base observada é a linha do snapshot; o payload continua sendo só `properties`,
            // e a geometria vem do documento observado.
            const ackStyle = await api.pushOperations(atlas.id, [
                await window.__ebgeoBase.opDeEdicao(api, atlas.id, mapId, pointId, { properties: styled }),
            ]);
            const afterStyle = await pullPoints(pointId);

            // ---- 2nd UPDATE: contra a base que a 1ª deixou, e omite `legado` --------------
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
            const ackRestyle = await api.pushOperations(atlas.id, [
                await window.__ebgeoBase.opDeEdicao(api, atlas.id, mapId, pointId, { properties: restyled }),
            ]);
            const afterRestyle = await pullPoints(pointId);

            return {
                hasToken: Boolean(api.getAccessToken()),
                acks: [ackStyle, ackRestyle].map((a) => ({
                    success: a.results?.[0]?.success ?? null,
                    reason: a.results?.[0]?.reason ?? null,
                })),
                createdSource: created.properties?.source,
                createdNoFill: Boolean(created.properties) && created.properties.fillColor === undefined,
                createdTotal: created.total,
                styled: afterStyle.properties,
                styledTotal: afterStyle.total,
                restyled: afterRestyle.properties,
                restyledTotal: afterRestyle.total,
                restyledWithId: afterRestyle.withId,
            };
        }, { baseUrl: state.baseUrl, u: user });

        expect(result.hasToken).toBe(true);
        // As duas edições foram ACEITAS. Uma recusa por base deixaria o estilo antigo na
        // linha, e o vermelho seria "fillColor errado", que aponta para o lugar errado.
        expect(result.acks.map((a) => a.success), JSON.stringify(result.acks)).toEqual([true, true]);

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

        // ---- a 2ª edição, contra a base atual, sobrescreve o estilo ----
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
        // a chave omitida do payload posterior vira um `remove` no patch, e some.
        expect(r).not.toHaveProperty('legado');
        // update is not a second create — after TWO updates the map still holds exactly
        // one point in total, and exactly one entity answers to this id. Both numbers are
        // counted over the pulled bucket, not inferred from having found the entity.
        expect(result.restyledTotal).toBe(1);
        expect(result.restyledWithId).toBe(1);
    });

    test('§17.9 hatch pattern round-trips on a polygon update (and overwrites on a 2nd update)', async ({ page }) => {
        await page.goto('/');
        await instalarBaseConfirmada(page);

        const user = await createVerifiedUser({ prefix: 'fpe_pg', nome: 'Feature Panel Polygon' });

        const result = await page.evaluate(async ({ baseUrl, u }) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            await api.login(u.username, u.password);

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
            const ackHatch = await api.pushOperations(atlas.id, [
                await window.__ebgeoBase.opDeEdicao(api, atlas.id, mapId, polygonId, {
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

            // 2nd update, contra a base que a 1ª deixou, troca o padrão de hachura.
            const ackRehatch = await api.pushOperations(atlas.id, [
                await window.__ebgeoBase.opDeEdicao(api, atlas.id, mapId, polygonId, {
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
                acks: [ackHatch, ackRehatch].map((a) => ({
                    success: a.results?.[0]?.success ?? null,
                    reason: a.results?.[0]?.reason ?? null,
                })),
                inPolygons: Boolean(hatched.properties),
                hatched: hatched.properties,
                hatchedTotal: hatched.total,
                rehatched: rehatched.properties,
                rehatchedTotal: rehatched.total,
                rehatchedWithId: rehatched.withId,
            };
        }, { baseUrl: state.baseUrl, u: user });

        expect(result.acks.map((a) => a.success), JSON.stringify(result.acks)).toEqual([true, true]);
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

        // A hachura posterior, escrita contra a base atual, vence.
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
