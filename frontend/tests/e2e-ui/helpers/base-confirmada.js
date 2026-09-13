// Path: e2e-ui/helpers/base-confirmada.js

/**
 * @fileoverview The confirmed revision a feature edit declares, for the transport-probe specs
 * that build their operations inside `page.evaluate`.
 *
 * WHY IT EXISTS. Since 2026-09-13 a feature `update` (and a feature `delete`) is judged against
 * the base it DECLARES: `createOperation` reads `previousData.properties.confirmedVersion` and
 * stamps `baseVersion` plus the `patch` of changed units (`store/sync/feature-patch.js`), and the
 * server refuses an operation that declares none with `RAZAO_SEM_BASE`
 * (`resolveObservedBase`, `backend/src/modules/sync/entity-conflicts.js`). A probe that calls
 * `createOperation('feature', 'update', id, mapId, data)` with no sixth argument therefore sends
 * `baseVersion: null` and is refused before it writes anything. That is not a defect to work
 * around: it is the contract, and the probe has to observe it the way the product does.
 *
 * WHAT THE PRODUCT DOES, AND WHAT THIS MIRRORS. A store operation reads the document out of
 * IndexedDB just before writing over it and hands that document to the factory as `previousData`;
 * the confirmed revision travels INSIDE it (`store/sync/confirmed-version.js`). A probe has no
 * IndexedDB, so its equivalent of "the document I observed" is the snapshot row, which carries
 * `properties.confirmedVersion` (`buildMapFeatures`, `backend/src/modules/sync/sync.service.js`).
 * This is the same shape `confirmedFeature` / `editFeatureOperation` give the contract suite
 * (`frontend/tests/e2e/helpers/harness.js`); it is duplicated here rather than imported because
 * these specs build their operations in the BROWSER, where a Node import is not reachable.
 *
 * THE HELPER IS INSTALLED ON `window`, not passed as an argument, for the same reason: a Playwright
 * `page.evaluate` receives only serializable data, so a function has to be defined inside the page
 * once and read from `window.__ebgeoBase` by every later evaluate on that same page. Install it
 * AFTER `page.goto`, since a navigation throws the window away.
 *
 * IT REFUSES TO GUESS. When the snapshot row carries no `confirmedVersion`, the helper throws
 * instead of falling back to 1 or to null: an operation with an invented base is a probe measuring
 * its own arithmetic, and an operation with no base is exactly the failure this file exists to
 * prevent. The one legitimate caller of the base-less envelope is the probe that edits a feature
 * the server does NOT have (the "ghost id" edge), where there is no revision to observe and the
 * refusal is `RAZAO_EXCLUIDO_NO_SERVIDOR`, decided before the base is ever read.
 */

/**
 * Defines `window.__ebgeoBase` on the page: the readers and builders a transport probe needs to
 * declare the base of a feature edit.
 *
 * The installed object:
 *   - `feicoesConfirmadas(api, atlasId, mapId)` → `Map` of feature id → snapshot feature (ONE pull,
 *     every bucket flattened);
 *   - `feicaoConfirmada(api, atlasId, mapId, featureId)` → one snapshot feature, throwing when it
 *     carries no confirmed revision;
 *   - `opContraBase(previous, mapId, featureId, data)` → the `update` (or `delete`, for a null
 *     `data`) operation declaring `previous` as its base, with no extra pull;
 *   - `opDeEdicao(api, atlasId, mapId, featureId, data)` → the same, reading the base itself;
 *   - `opsDeEdicao(api, atlasId, mapId, edicoes)` → N operations over N features from ONE pull,
 *     for a batch push (`edicoes` is `[{ id, data }]`).
 *
 * @param {import('@playwright/test').Page} page - A page already navigated to the app.
 * @returns {Promise<void>}
 */
export async function instalarBaseConfirmada(page) {
    await page.evaluate(async () => {
        const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

        /** Every feature of one map in the snapshot, keyed by id, from a single pull. */
        const lerMapa = async (api, atlasId, mapId) => {
            const pulled = await api.pullSync(atlasId, 0);
            const mapa = (pulled.snapshot?.maps || []).find((m) => m.id === mapId);
            const porId = new Map();
            for (const balde of Object.values(mapa?.features || {})) {
                if (!Array.isArray(balde)) continue;
                for (const f of balde) porId.set(f?.properties?.id, f);
            }
            return porId;
        };

        /** The snapshot row, or a failure that names what is missing and why it matters. */
        const exigirBase = (feicao, featureId) => {
            if (!feicao) {
                throw new Error(`base confirmada: a feição ${featureId} não está no snapshot deste mapa`);
            }
            if (!Number.isSafeInteger(feicao.properties?.confirmedVersion)) {
                throw new Error(`base confirmada: a feição ${featureId} veio do snapshot sem `
                    + '`properties.confirmedVersion`, então nenhuma edição dela pode declarar base');
            }
            return feicao;
        };

        window.__ebgeoBase = {
            feicoesConfirmadas: lerMapa,

            async feicaoConfirmada(api, atlasId, mapId, featureId) {
                return exigirBase((await lerMapa(api, atlasId, mapId)).get(featureId), featureId);
            },

            opContraBase(previous, mapId, featureId, data) {
                exigirBase(previous, featureId);
                // `{ ...previous, ...data }` is what lets a probe send only the half it is
                // editing: a payload of `{ properties }` keeps the observed geometry, and a full
                // GeoJSON feature overrides both. The diff against `previous` is what becomes the
                // patch, so a key the payload omits is REMOVED, which is the behaviour the
                // whole-properties probes were written to measure.
                return createOperation(
                    'feature', data === null ? 'delete' : 'update', featureId, mapId,
                    data === null ? null : { ...previous, ...data }, previous,
                );
            },

            async opDeEdicao(api, atlasId, mapId, featureId, data) {
                const previous = await this.feicaoConfirmada(api, atlasId, mapId, featureId);
                return this.opContraBase(previous, mapId, featureId, data);
            },

            async opsDeEdicao(api, atlasId, mapId, edicoes) {
                const porId = await lerMapa(api, atlasId, mapId);
                return edicoes.map(({ id, data }) =>
                    this.opContraBase(exigirBase(porId.get(id), id), mapId, id, data));
            },
        };
    });
}
