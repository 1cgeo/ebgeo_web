// Path: e2e-ui/browser-collab-lock.spec.js

/**
 * MAP LOCK — TWO real browsers + real backend, on the full-chain harness. A map lock makes
 * a map read-only LOCALLY (owner/admin-only, not broadcast). This pins toggleMapLock's
 * observable contract, with the cross-client propagation parts verified end-to-end:
 *
 *   - an editor cannot lock (permission-denied → null);
 *   - the owner can; while the owner holds the lock its OWN authoring is blocked (toolbar
 *     hidden, real canvas gesture lands nothing);
 *   - the lock does NOT corrupt collaboration: the editor (independent view) keeps editing
 *     and its features still traverse the WHOLE chain back to the owner (expectFullSyncFrom);
 *   - unlocking restores the owner's writes, which traverse the chain to the editor.
 *
 * O SEGUNDO CASO TRAVA PELO CONTROLADOR, e a diferenca importa. O primeiro dirige a op de store
 * CRUA, e ate' 2026-09-13 era esse o unico caminho exercitado aqui: a op de store gravava o app
 * setting sem logar nada, entao travar por ela travava so' aquele cliente e o par continuava
 * editando (dois specs deste repositorio nasceram travando assim e esperando a trava no Editor, e
 * falharam sempre). A op da trava passou a NASCER na store, dentro da transacao, e
 * `mapLockController.toggleMapLock` deixou de logar por fora; do outro lado, o ramo de `map` update
 * do par passou a MESCLAR so' os campos presentes, em vez de substituir o registro pelo payload
 * parcial (era isso que apagava as feicoes do Editor e engolia a propria trava, porque o app
 * setting e' chaveado pelo NOME e o payload parcial nao tem nome).
 *
 * Run headed:  npx playwright test browser-collab-lock --headed
 */

import { collabTest, expect, readFeatures, drawLineUI } from './helpers/collab.fixtures.js';

/** Drives a store op (toggleMapLock has no single-gesture collab UI; its return value is the contract). */
function applyStoreOp(page, opName, args) {
    return page.evaluate(async ({ name, a }) => {
        const store = await import('/src/js/store/index.js');
        return store[name](...a);
    }, { name: opName, a: args });
}

/**
 * Trava/destrava pelo CONTROLADOR, que e' o caminho da interface (o cadeado da aba "Mapas" chama
 * `mapLockController.toggleMapLock`). Ele gateia por posto, chama a op de store e emite
 * MAP_MODIFIED; a op de sync nasce dentro da transacao da op de store.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<boolean>} O estado resultante da trava.
 */
function toggleLockViaController(page) {
    return page.evaluate(async () => {
        const { mapLockController } = await import('/src/js/locking/map-lock.controller.js');
        return mapLockController.toggleMapLock();
    });
}

/**
 * Como o PAR le' a trava: o conjunto em memoria, que e' o gate real de edicao
 * (`isCurrentMapLockedSync`), mais a contagem de feicoes do mapa, porque o defeito media as duas
 * coisas ao mesmo tempo (a trava nao chegava E a contagem caia a zero).
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{travado: boolean, linhas: number}>}
 */
function lockStateOf(page) {
    return page.evaluate(async () => {
        const store = await import('/src/js/store/index.js');
        const feicoes = await store.getCurrentMapFeatures();
        return {
            travado: store.isCurrentMapLockedSync(),
            linhas: (feicoes?.lines ?? []).length,
        };
    });
}

const lineCoords = () => [[-43.2, -22.9], [-43.15, -22.85], [-43.1, -22.8]];

collabTest.describe('Map lock — owner-only, local read-only enforcement, collaboration stays consistent', () => {
    collabTest('an editor cannot lock; the owner can; owner-lock blocks the owner, editor keeps editing', async ({ collab }) => {
        const A = collab.author; // owner
        const B = collab.peers[0]; // editor
        const mapName = collab.mapName;

        // Baseline: B (editor) draws a line; it reaches the owner A through the whole chain.
        const warm = await drawLineUI(B, lineCoords());
        await collab.expectFullSyncFrom(B, { entityId: warm, type: 'lines', operationType: 'create' });

        // The editor B is NOT allowed to lock (canLockMaps is owner/admin-only).
        const editorTry = await applyStoreOp(B, 'toggleMapLock', [mapName]);
        expect(editorTry, 'editor cannot lock (permission denied → null)').toBeNull();

        // The owner A locks its current map → A's own authoring is blocked locally.
        const locked = await applyStoreOp(A, 'toggleMapLock', [mapName]);
        expect(locked, 'owner toggleMapLock returned locked=true').toBe(true);

        // Real UI enforcement: locking HIDES the authoring toolbar groups; the line shortcut is
        // gated and a real canvas gesture lands NOTHING on A.
        await expect(A.locator('.toolbar-group[data-group-id="draw"]')).toBeHidden({ timeout: 5000 });
        const beforeA = new Set((await readFeatures(A, 'lines')).map((x) => x.id));
        await A.locator('#map-sig .maplibregl-canvas').press('l');
        const box = await A.locator('#map-sig .maplibregl-canvas').boundingBox();
        await A.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.45);
        await A.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.55, { button: 'right' });
        await A.waitForTimeout(2500);
        const newOnA = (await readFeatures(A, 'lines')).filter((x) => !beforeA.has(x.id));
        expect(newOnA, 'owner write blocked while it holds the lock (no new line)').toHaveLength(0);

        // The editor B (independent view, not locked) keeps drawing → it still traverses the
        // WHOLE chain to A (lock blocks local authoring, not inbound sync).
        const fromB = await drawLineUI(B, lineCoords());
        await collab.expectFullSyncFrom(B, { entityId: fromB, type: 'lines', operationType: 'create' });

        // Owner unlocks → its writes work again and traverse the chain to B.
        const unlocked = await applyStoreOp(A, 'toggleMapLock', [mapName]);
        expect(unlocked, 'second toggle unlocks').toBe(false);
        const afterUnlock = await drawLineUI(A, lineCoords());
        await collab.expectFullSync({ entityId: afterUnlock, type: 'lines', operationType: 'create' });
    });

    // O CASO QUE FALTAVA, e o que ele mede nao e' medido por nenhum outro: a trava pelo CAMINHO DA
    // INTERFACE chegando ao PAR. Escrito em 2026-09-13 junto com as duas correcoes que o tornam
    // possivel (a op nascendo na store, e a mescla parcial na aplicacao remota). NAO EXECUTADO
    // pelo agente que o escreveu (o Playwright esta' fora do laco dele): fica para o coordenador
    // rodar, e se ele falhar, o que ele acusa e' uma das duas metades, nao o desenho do caso.
    collabTest('travar PELO CONTROLADOR chega ao Editor, e nao apaga as feicoes dele', async ({ collab }) => {
        const A = collab.author; // owner
        const B = collab.peers[0]; // editor

        // Duas linhas do Editor, ja' convergidas: e' a contagem que o defeito zerava no par.
        const um = await drawLineUI(B, lineCoords());
        await collab.expectFullSyncFrom(B, { entityId: um, type: 'lines', operationType: 'create' });
        const dois = await drawLineUI(B, lineCoords());
        await collab.expectFullSyncFrom(B, { entityId: dois, type: 'lines', operationType: 'create' });

        const antes = await lockStateOf(B);
        expect(antes.travado, 'premissa: o Editor comeca com o mapa destravado').toBe(false);
        expect(antes.linhas, 'premissa: o Editor ve as duas linhas').toBeGreaterThanOrEqual(2);

        // O dono trava PELO CONTROLADOR, que e' o caminho do cadeado da aba "Mapas".
        expect(await toggleLockViaController(A), 'o dono travou').toBe(true);

        // O par passa a LER o mapa como travado, e a leitura e' a do gate de edicao.
        await expect
            .poll(async () => (await lockStateOf(B)).travado, { timeout: 20000, intervals: [500] })
            .toBe(true);

        // E as feicoes dele continuam la'. Esta era a metade medida como DEFEITO: em tres rodadas
        // de tres, a contagem do Editor caia de 2 para 0, porque a aplicacao do `map` update
        // substituia o registro do mapa pelo payload parcial `{ locked: true }`.
        const depois = await lockStateOf(B);
        expect(depois.linhas, 'as feicoes do Editor sobreviveram ao travamento pelo dono')
            .toBe(antes.linhas);

        // Destravar volta pelo mesmo caminho, e o par tambem le'.
        expect(await toggleLockViaController(A), 'o dono destravou').toBe(false);
        await expect
            .poll(async () => (await lockStateOf(B)).travado, { timeout: 20000, intervals: [500] })
            .toBe(false);
        expect((await lockStateOf(B)).linhas).toBe(antes.linhas);
    });
});
