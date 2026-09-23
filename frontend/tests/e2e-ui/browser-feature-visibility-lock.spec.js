// Path: e2e-ui/browser-feature-visibility-lock.spec.js

/**
 * Browser-level feature visibility/lock toggles: drives the REAL frontend transport
 * modules (api-client / operation-factory), imported live from the Vite dev server
 * INSIDE real Chromium, against the REAL spawned backend. Every assertion is grounded
 * in observable backend state read back through `api.pullSync` — no mocks, real HTTP.
 *
 * Atlas features are GeoJSON: the visibility/lock state of a feature lives in its
 * `properties` (`properties.visivel` / `properties.bloqueado`), which the backend
 * persists into the `properties` JSONB column on a `feature` `update` and
 * spreads back verbatim in the `pullSync` snapshot buckets
 * (`map.features.{points,lines,polygons}`). Writes are CRDT operations pushed via
 * `api.pushOperations` (there are NO REST write routes for features).
 *
 * TODA EDIÇÃO DECLARA A BASE OBSERVADA desde `5f91f2e9` (2026-09-13): a op carrega
 * `baseVersion` (a `properties.confirmedVersion` da linha do snapshot) e o patch das unidades
 * que mudou, e uma op sem base é recusada por `RAZAO_SEM_BASE` sem escrever nada. Este spec
 * empurrava as ops cruas, sem base, e por isso as três edições eram recusadas em silêncio para
 * quem só olhasse o conteúdo. A base é lida por `helpers/base-confirmada.js`, e é RELIDA entre
 * as duas edições do primeiro caso, porque a primeira já moveu a revisão da feição.
 *
 * Covers docs/acoes-interface-multiusuario.md §2.11-12 (toggle a single feature's
 * visibility / lock), §17.7-8 (the flags round-trip and persist), and §2.13 (a
 * multi-feature batch visibility update touches every targeted feature).
 *
 * Coverage:
 *   - create a point with visivel:true / bloqueado:false, then UPDATE it to
 *     visivel:false and assert the persisted snapshot reflects the hidden flag;
 *   - UPDATE the same feature to bloqueado:true and assert the lock persists while
 *     the previously-set visivel flag survives (update replaces the whole properties
 *     object, so the op must carry the full intended state);
 *   - batch (§2.13): create three points then push ONE batch of three `feature`
 *     `update` ops flipping visivel:false on all of them; assert every one is hidden
 *     in the snapshot and the batch was atomic (all-or-nothing);
 *   - edge: a visibility update aimed at a NON-EXISTENT feature id is REFUSED por
 *     operação, nomeando o motivo, e nunca conjura feição em bucket nenhum.
 *
 * Op shapes mirror the passing headless twin + browser-feature-crud.spec.js:
 *   createOperation('feature', 'create', featureId, mapId, geojsonFeature)
 *   window.__ebgeoBase.opDeEdicao(api, atlasId, mapId, featureId, geojsonFeature)
 * where geojsonFeature carries its type in `properties.source` and the toggled flags
 * in `properties.visivel` / `properties.bloqueado`.
 *
 * Each test self-provisions its own user + atlas + map for isolation.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { createVerifiedUser } from './helpers/accounts.js';
import { instalarBaseConfirmada } from './helpers/base-confirmada.js';
import { clienteNaPagina } from './helpers/cliente-de-teste.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

describeOrSkip('Feature visibility/lock (real Chromium + real backend, transport via page.evaluate)', () => {
    test('toggle visivel/bloqueado on a feature → flags persist in pullSync snapshot', async ({
        page,
    }) => {
        // Transport-only: a página não precisa do mapa (o cliente do teste não grava sessão).
        await page.goto('/atlas.html');
        await instalarBaseConfirmada(page);

        const user = await createVerifiedUser({ prefix: 'vislock', nome: 'VisLock User' });

        const result = await page.evaluate(async ({ api }) => {
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const atlas = await api.createAtlas({ name: 'VisLock Atlas' });
            const mapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [
                createOperation('map', 'create', mapId, null, { name: 'M1' }),
            ]);

            // ---- helpers --------------------------------------------------
            const makePoint = (id, props = {}) => ({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
                properties: { id, source: 'point', nome: 'Ponto', ...props },
            });
            const pullPoint = async (id) => {
                const pulled = await api.pullSync(atlas.id, 0);
                const map = pulled.snapshot?.maps?.find((m) => m.id === mapId);
                return (map?.features?.points || []).find((f) => f.properties.id === id);
            };

            // ---- CREATE a visible, unlocked point -------------------------
            const pointId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [
                createOperation('feature', 'create', pointId, mapId, makePoint(pointId, {
                    visivel: true,
                    bloqueado: false,
                })),
            ]);
            const created = await pullPoint(pointId);

            // ---- UPDATE: hide it (visivel -> false) -----------------------
            const ackHide = await api.pushOperations(atlas.id, [
                await window.__ebgeoBase.opDeEdicao(api, atlas.id, mapId, pointId, makePoint(pointId, {
                    visivel: false,
                    bloqueado: false,
                })),
            ]);
            const afterHide = await pullPoint(pointId);

            // ---- UPDATE: lock it, keep it hidden --------------------------
            // Base RELIDA: a edição acima moveu a revisão, e declarar a base antiga aqui
            // seria a disputa que o servidor recusa.
            const ackLock = await api.pushOperations(atlas.id, [
                await window.__ebgeoBase.opDeEdicao(api, atlas.id, mapId, pointId, makePoint(pointId, {
                    visivel: false,
                    bloqueado: true,
                })),
            ]);
            const afterLock = await pullPoint(pointId);

            return {
                hasToken: Boolean(api.getAccessToken()),
                acks: [ackHide, ackLock].map((a) => ({
                    success: a.results?.[0]?.success ?? null,
                    reason: a.results?.[0]?.reason ?? null,
                })),
                created: {
                    exists: Boolean(created),
                    visivel: created?.properties.visivel,
                    bloqueado: created?.properties.bloqueado,
                },
                hidden: {
                    exists: Boolean(afterHide),
                    visivel: afterHide?.properties.visivel,
                    bloqueado: afterHide?.properties.bloqueado,
                },
                locked: {
                    exists: Boolean(afterLock),
                    visivel: afterLock?.properties.visivel,
                    bloqueado: afterLock?.properties.bloqueado,
                },
            };
        }, { api: await clienteNaPagina(page, user) });

        expect(result.hasToken).toBe(true);
        // As duas edições foram aceitas: uma recusa por base deixaria as flags antigas na
        // linha, e o vermelho apontaria para a persistência em vez da declaração.
        expect(result.acks.map((a) => a.success), JSON.stringify(result.acks)).toEqual([true, true]);

        // ---- CREATE: flags persisted exactly as sent ----
        expect(result.created.exists).toBe(true);
        expect(result.created.visivel).toBe(true);
        expect(result.created.bloqueado).toBe(false);

        // ---- §2.11/§17.7: visibility toggle persists ----
        expect(result.hidden.exists).toBe(true);
        expect(result.hidden.visivel).toBe(false);
        expect(result.hidden.bloqueado).toBe(false);

        // ---- §2.12/§17.8: lock toggle persists, prior visibility survives ----
        expect(result.locked.exists).toBe(true);
        expect(result.locked.bloqueado).toBe(true);
        expect(result.locked.visivel).toBe(false);
    });

    test('§2.13 batch visibility: one push hides three features; update em id inexistente é recusado nomeando o motivo', async ({
        page,
    }) => {
        // Transport-only: a página não precisa do mapa (o cliente do teste não grava sessão).
        await page.goto('/atlas.html');
        await instalarBaseConfirmada(page);

        const user = await createVerifiedUser({ prefix: 'visbatch', nome: 'VisBatch User' });

        const result = await page.evaluate(async ({ api }) => {
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const atlas = await api.createAtlas({ name: 'VisBatch Atlas' });
            const mapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [
                createOperation('map', 'create', mapId, null, { name: 'M1' }),
            ]);

            const makePoint = (id, props = {}) => ({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
                properties: { id, source: 'point', nome: 'Ponto', visivel: true, ...props },
            });
            const pullPoints = async () => {
                const pulled = await api.pullSync(atlas.id, 0);
                const map = pulled.snapshot?.maps?.find((m) => m.id === mapId);
                return map?.features?.points || [];
            };

            // ---- CREATE three visible points ------------------------------
            const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
            await api.pushOperations(
                atlas.id,
                ids.map((id) => createOperation('feature', 'create', id, mapId, makePoint(id))),
            );
            const beforeBatch = await pullPoints();
            const allVisibleBefore = ids.every(
                (id) =>
                    beforeBatch.find((f) => f.properties.id === id)?.properties.visivel === true,
            );

            // ---- §2.13: ONE batch flipping visivel:false on all three ------
            // UMA leitura de snapshot para as três bases: as ops miram entidades distintas,
            // então nenhuma move a base da outra.
            const ackBatch = await api.pushOperations(
                atlas.id,
                await window.__ebgeoBase.opsDeEdicao(api, atlas.id, mapId,
                    ids.map((id) => ({ id, data: makePoint(id, { visivel: false }) }))),
            );
            const afterBatch = await pullPoints();
            const allHiddenAfter = ids.every(
                (id) =>
                    afterBatch.find((f) => f.properties.id === id)?.properties.visivel === false,
            );
            // count is unchanged — updates are not creates.
            const countStable = afterBatch.filter((f) => ids.includes(f.properties.id)).length;

            // ---- EDGE: visibility update on a non-existent feature id ------
            // Esta é a ÚNICA op deste spec que sai SEM base declarada, e sai assim por não
            // haver base: não existe linha para observar. O servidor decide o caso antes de
            // olhar a base (`prepareFeatureMutation` responde `RAZAO_EXCLUIDO_NO_SERVIDOR`
            // quando não acha a linha), então o motivo é o mesmo para "nunca existiu" e para
            // "existiu e foi-se" — o servidor não distingue os dois, por desenho.
            const ghostId = crypto.randomUUID();
            const ackGhost = await api.pushOperations(atlas.id, [
                createOperation('feature', 'update', ghostId, mapId, makePoint(ghostId, {
                    visivel: false,
                })),
            ]);
            const afterGhost = await pullPoints();
            const ghostConjured = afterGhost.some((f) => f.properties.id === ghostId);

            return {
                createdCount: beforeBatch.filter((f) => ids.includes(f.properties.id)).length,
                allVisibleBefore,
                batchAcks: ackBatch.results.map((r) => ({ success: r.success, reason: r.reason ?? null })),
                allHiddenAfter,
                countStable,
                ghost: {
                    success: ackGhost.results?.[0]?.success ?? null,
                    reason: ackGhost.results?.[0]?.reason ?? null,
                },
                ghostConjured,
            };
        }, { api: await clienteNaPagina(page, user) });

        // ---- batch precondition: all three created and visible ----
        expect(result.createdCount).toBe(3);
        expect(result.allVisibleBefore).toBe(true);

        // ---- §2.13: single batch hid every targeted feature, atomically ----
        // As três ops do lote foram aceitas, contadas uma a uma: "o lote passou" e "passaram
        // duas das três" não podem ser a mesma leitura.
        expect(result.batchAcks.length).toBe(3);
        expect(result.batchAcks.filter((a) => a.success === true).length,
            JSON.stringify(result.batchAcks)).toBe(3);
        expect(result.allHiddenAfter).toBe(true);
        expect(result.countStable).toBe(3);

        // ---- EDGE: a bad-id update is refused BY NAME and conjures nothing ----
        expect(result.ghost.success).toBe(false);
        expect(result.ghost.reason).toMatch(/excluido no servidor/i);
        expect(result.ghostConjured).toBe(false);
    });
});
