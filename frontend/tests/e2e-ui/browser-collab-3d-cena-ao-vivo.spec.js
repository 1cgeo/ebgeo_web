// Path: e2e-ui/browser-collab-3d-cena-ao-vivo.spec.js

/**
 * A CENA 3D DO PAR, AO VIVO, em DUAS browsers reais contra o backend real (2026-09-22). Relato do
 * dono no mesmo dia: "não tá propagando no 3D as feições, ao adicionar não aparece para outro
 * usuário".
 *
 * O QUE ESTE SPEC MEDE QUE `browser-collab-3d-360.spec.js` NÃO MEDE. Aquele lê o IndexedDB do par, e
 * um marcador que chega ao disco e não aparece na tela PASSA nele. Este lê a CENA: as entidades que
 * a ferramenta do visualizador 3D de B desenhou depois de a op de A atravessar o servidor. A medição
 * e a visibilidade são os casos que estavam quebrados (nenhum ouvinte de `MEASUREMENTS_3D_CHANGED`
 * nem de `VIEWSHEDS_3D_CHANGED` dentro do visualizador, os dois consertados junto com este spec); o
 * marcador está aqui como a família irmã que já tinha ouvinte, para que as três sejam cobradas pelo
 * mesmo instrumento.
 *
 * A CENA É MONTADA SEM WEBGL, e é de propósito. Abrir o visualizador de verdade exige um tileset
 * servido de verdade, que um checkout limpo não tem (ver o `MODELS_3D_DIR` de `.claude/rules/testing.md`),
 * e o sujeito aqui não é o desenho do Cesium, é a reconciliação da ferramenta com o store. Por isso o
 * `viewer` é o mínimo que a ferramenta toca: a `EntityCollection` REAL do Cesium, um canvas solto para
 * o `ScreenSpaceEventHandler` e uma cena sem pick.
 *
 * A INSTÂNCIA MEDIDA É A DO APP. O `import()` pede a ferramenta pelo mesmo endereço que `map_3d.js`
 * pediria, e ela lê o barramento pelo mesmo `@store/services.js` em que o tratador remoto emite; nada
 * aqui é editado durante a rodada, então não há `?t=` de HMR separando as duas cópias.
 *
 * A ESPERA É POR ESTÁGIO, NUNCA POR FILA: `waitForRemoteEntity` espera o `remote.applied` do par no
 * anel do SyncLedger, e só então a cena é lida (uma leitura barata de um objeto da página, depois da
 * janela de coalescência de 80 ms da ferramenta).
 *
 * NÃO EXECUTADO por quem o escreveu. Rodar de dentro de `frontend/`:
 *   npx playwright test browser-collab-3d-cena-ao-vivo --retries=0 --repeat-each=3
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { seedSharedAtlas, openClient } from './helpers/collab-helpers.js';
import { seedTileset } from './helpers/catalog-seed.js';
import { waitForRemoteEntity } from './helpers/trace-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Onde cada família mora e como ela entra na cena. */
const FAMILIAS = {
    medicao: {
        modulo: '/src/js/3d_models_viewer_tool/tools/measurement_tool_3d.js',
        render: 'renderMeasurementsForTileset',
        ouvir: 'initMeasurementToolListeners',
        prefixo: 'measurement-3d-line-',
    },
    marcador: {
        modulo: '/src/js/3d_models_viewer_tool/tools/marker_tool_3d.js',
        render: 'renderMarkersForTileset',
        ouvir: 'initMarkerToolListeners',
        prefixo: 'marker-3d-',
    },
    // A VISIBILIDADE É LIDA PELO MARCADOR DE ORIGEM, e não pelo cone: sem WebGL o motor
    // (`services/viewshed-3d.js`) não monta a renderização de profundidade, `createCesiumViewsheds`
    // devolve a lista vazia com um aviso no console, e a entrada nasce mesmo assim, porque ela é
    // decidida pela origem. O cone desenhado tem referência própria em `viewshed-3d-pixel.spec.js`.
    visibilidade: {
        modulo: '/src/js/3d_models_viewer_tool/tools/viewshed_tool_3d.js',
        render: 'renderViewshedsForTileset',
        ouvir: 'initViewshedToolListeners',
        prefixo: 'viewshed-3d-origin-',
    },
};

/**
 * Monta em `page` a cena 3D daquele tileset para uma família, e a pendura em `window.__cena3d`.
 * @param {import('@playwright/test').Page} page
 * @param {string} tilesetId
 * @param {keyof typeof FAMILIAS} familia
 */
function montarCena(page, tilesetId, familia) {
    return page.evaluate(async ({ tid, f }) => {
        const { Cesium } = await import('/src/js/vendor/cesium.js');
        const ferramenta = await import(f.modulo);
        const viewer = {
            entities: new Cesium.EntityCollection(),
            canvas: document.createElement('canvas'),
            scene: { pick: () => undefined },
            selectedEntity: undefined,
            isDestroyed: () => false,
        };
        await ferramenta[f.render](viewer, tid);
        ferramenta[f.ouvir]();
        window.__cena3d = viewer;
    }, { tid: tilesetId, f: FAMILIAS[familia] });
}

/** A entidade daquela família está na cena do par? */
function naCena(page, familia, id) {
    return page.evaluate(
        ({ prefixo, entityId }) => !!window.__cena3d?.entities.getById(`${prefixo}${entityId}`),
        { prefixo: FAMILIAS[familia].prefixo, entityId: id },
    );
}

describeOrSkip('cena 3D do par — a feição 3D do colega aparece e some sem reabrir o visualizador', () => {
    test('uma MEDIÇÃO criada por A aparece na cena 3D aberta de B, e some quando A a apaga', async ({ browser }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl, { permission: 'write' });
        const A = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
        const B = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);
        try {
            // O tileset tem de EXISTIR: a borda de escrita recusa op que referencia recurso invisível.
            const tilesetId = await seedTileset(state.dbName, { esperarCatalogo: false });
            await montarCena(B, tilesetId, 'medicao');

            const id = await A.evaluate(async (tid) => {
                const c3d = await import('/src/js/store/cesium3d.operations.js');
                const m = await c3d.addMeasurement(tid, {
                    type: 'distance',
                    positions: [
                        { longitude: -43.2, latitude: -22.9, height: 10 },
                        { longitude: -43.21, latitude: -22.91, height: 12 },
                    ],
                    result: { value: 1234, formatted: '' },
                });
                return m?.id ?? null;
            }, tilesetId);
            expect(id, 'a medição de A foi recusada pelo próprio store').toBeTruthy();

            await waitForRemoteEntity(B, id, { operationType: 'create', timeout: 20000 });
            await expect.poll(() => naCena(B, 'medicao', id), {
                timeout: 5000,
                message: 'B aplicou a op mas a cena 3D não desenhou a medição',
            }).toBe(true);

            const removida = await A.evaluate(async (mid) => {
                const c3d = await import('/src/js/store/cesium3d.operations.js');
                return c3d.removeMeasurement(mid);
            }, id);
            expect(removida).toBe(true);

            await waitForRemoteEntity(B, id, { operationType: 'delete', timeout: 20000 });
            await expect.poll(() => naCena(B, 'medicao', id), {
                timeout: 5000,
                message: 'B aplicou a exclusão mas a medição continua na cena 3D',
            }).toBe(false);
        } finally {
            await A.context().close();
            await B.context().close();
        }
    });

    test('uma VISIBILIDADE criada por A aparece na cena 3D aberta de B, e some quando A a apaga', async ({ browser }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl, { permission: 'write' });
        const A = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
        const B = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);
        try {
            const tilesetId = await seedTileset(state.dbName, { esperarCatalogo: false });
            await montarCena(B, tilesetId, 'visibilidade');

            const id = await A.evaluate(async (tid) => {
                const c3d = await import('/src/js/store/cesium3d.operations.js');
                const v = await c3d.addViewshed(tid, {
                    position: { longitude: -43.2, latitude: -22.9, height: 10 },
                    targetPosition: { longitude: -43.19, latitude: -22.9, height: 10 },
                    terrainBaseHeight: 10,
                    parameters: { horizontalAngle: 120, verticalAngle: 90, distance: 300 },
                    observerHeight: 1.5,
                });
                return v?.id ?? null;
            }, tilesetId);
            expect(id, 'a visibilidade de A foi recusada pelo próprio store').toBeTruthy();

            await waitForRemoteEntity(B, id, { operationType: 'create', timeout: 20000 });
            await expect.poll(() => naCena(B, 'visibilidade', id), {
                timeout: 5000,
                message: 'B aplicou a op mas a cena 3D não desenhou a visibilidade',
            }).toBe(true);

            const removida = await A.evaluate(async (vid) => {
                const c3d = await import('/src/js/store/cesium3d.operations.js');
                return c3d.removeViewshed(vid);
            }, id);
            expect(removida).toBe(true);

            await waitForRemoteEntity(B, id, { operationType: 'delete', timeout: 20000 });
            await expect.poll(() => naCena(B, 'visibilidade', id), {
                timeout: 5000,
                message: 'B aplicou a exclusão mas a visibilidade continua na cena 3D',
            }).toBe(false);
        } finally {
            await A.context().close();
            await B.context().close();
        }
    });

    test('um MARCADOR criado por A aparece na cena 3D aberta de B', async ({ browser }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl, { permission: 'write' });
        const A = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
        const B = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);
        try {
            const tilesetId = await seedTileset(state.dbName, { esperarCatalogo: false });
            await montarCena(B, tilesetId, 'marcador');

            const id = await A.evaluate(async (tid) => {
                const c3d = await import('/src/js/store/cesium3d.operations.js');
                const m = await c3d.addMarker(tid, {
                    position: { longitude: -43.2, latitude: -22.9, height: 50 },
                    properties: { nome: 'Marcador na cena do colega' },
                });
                return m?.id ?? null;
            }, tilesetId);
            expect(id, 'o marcador de A foi recusado pelo próprio store').toBeTruthy();

            await waitForRemoteEntity(B, id, { operationType: 'create', timeout: 20000 });
            await expect.poll(() => naCena(B, 'marcador', id), {
                timeout: 5000,
                message: 'B aplicou a op mas a cena 3D não desenhou o marcador',
            }).toBe(true);
        } finally {
            await A.context().close();
            await B.context().close();
        }
    });
});
