// Path: e2e-ui/transferir-para-mapa-recem-criado.spec.js

/**
 * MOVING A LAYER INTO A MAP CREATED A MOMENT BEFORE, in a server atlas, in real Chromium against
 * the real backend, through the store facade (`transferLayerToMap`).
 *
 * WHAT WAS MEASURED (performance front, 2026-09-23, reported and not investigated there): the
 * transfer returned `target_write_incomplete` and the person read "Não foi possível salvar neste
 * computador. Verifique o espaço disponível no navegador.", while the SERVER applied the move.
 * This file decides whether that is the product or an artefact, and pins the answer.
 */

import { collabTest, expect, drawPointUI, readFeatures } from './helpers/collab.fixtures.js';

const MAPA_DESTINO = 'Mapa Destino';

function applyStoreOp(page, opName, args) {
    return page.evaluate(async ({ name, a }) => {
        const store = await import('/src/js/store/index.js');
        return store[name](...a);
    }, { name: opName, a: args });
}

function idDoMapa(page, nome) {
    return page.evaluate(async (n) => {
        const { mapResolver } = await import('/src/js/store/services/map-resolver.service.js');
        return mapResolver.resolveToId(n) ?? null;
    }, nome);
}

collabTest.describe('Transferir camada para um mapa recém-criado', () => {
    collabTest.describe.configure({ retries: 0 });

    collabTest('o mover chega ao destino e o desfecho diz que chegou', async ({ collab }) => {
        collabTest.setTimeout(180000);
        const A = collab.author;
        const ids = [await drawPointUI(A, [-43.21, -22.91]), await drawPointUI(A, [-43.19, -22.89])];
        const camada = await applyStoreOp(A, 'createLayer', ['Camada Viajante']);
        const camadaId = camada?.id ?? camada;
        await applyStoreOp(A, 'moveFeaturesToLayer', [ids.map((id) => ({ type: 'point', id })), camadaId]);
        await expect.poll(async () => (await readFeatures(A, 'points'))
            .filter((f) => f.props?.layerId === camadaId).length).toBe(2);
        // 98 more in the same layer, cloned from a drawn point (the measured size was 100).
        await A.evaluate(async ({ camadaId, total }) => {
            const store = await import('/src/js/store/index.js');
            const f = await store.getCurrentMapFeatures();
            const modelo = f.points.find((p) => p.properties.layerId === camadaId);
            const novas = Array.from({ length: total }, (_, i) => ({
                ...structuredClone(modelo),
                id: undefined,
                properties: { ...structuredClone(modelo.properties), id: crypto.randomUUID(), nome: `P${i}` },
                geometry: { type: 'Point', coordinates: [-43.2 + i * 0.001, -22.9] },
            }));
            await store.addFeatures({ points: novas });
        }, { camadaId, total: 98 });
        await expect.poll(async () => (await readFeatures(A, 'points'))
            .filter((f) => f.props?.layerId === camadaId).length).toBe(100);

        const toasts = [];
        A.on('console', (m) => { if (/transferLayerToMap|destination accepted/.test(m.text())) toasts.push(m.text()); });

        // The measured shape: create the map and transfer right after, without waiting for sync.
        await applyStoreOp(A, 'addMap', [MAPA_DESTINO]);
        const resultado = await applyStoreOp(A, 'transferLayerToMap', [camadaId, MAPA_DESTINO, { mode: 'move' }]);
        console.log('[resultado]', JSON.stringify(resultado), JSON.stringify(toasts));
        const aviso = await A.locator('.toast').allInnerTexts();
        console.log('[toasts]', JSON.stringify(aviso));

        expect(resultado?.success, `desfecho: ${JSON.stringify(resultado)}`).toBe(true);
        expect(aviso.some((t) => t.includes('espaço disponível'))).toBe(false);
        const destinoId = await idDoMapa(A, MAPA_DESTINO);
        expect(destinoId).toMatch(/^[0-9a-f]{8}-/i);
    });
});
