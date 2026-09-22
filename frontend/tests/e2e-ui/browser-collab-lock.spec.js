// Path: e2e-ui/browser-collab-lock.spec.js

/**
 * MAP LOCK — TWO real browsers + real backend, on the full-chain harness. A map lock makes a map
 * read-only for EVERYONE on it (toggling it is management-only). This pins toggleMapLock's
 * observable contract, with the cross-client propagation parts verified end-to-end:
 *
 *   - an editor cannot lock (permission-denied → null);
 *   - the owner can; while the lock is on, the owner's OWN authoring is blocked (toolbar
 *     hidden, real canvas gesture lands nothing);
 *   - the lock REACHES the editor: its edit gate flips, its draw toolbar disappears, and the
 *     command the menu still draws refuses the click naming the STATE (`aria-disabled`, never
 *     the `disabled` property);
 *   - the lock does NOT corrupt collaboration: the editor's features survive the arrival of a
 *     partial `{locked}` payload;
 *   - unlocking restores BOTH sides, and edits traverse the whole chain again in both
 *     directions.
 *
 * ESTA LISTA DIZIA "not broadcast" E "the editor keeps editing", e as duas frases descreviam o
 * produto de ANTES de `957a9567`. Enquanto a op de trava nao era logada, travar era estado local
 * de quem travou; hoje ela nasce na transacao da op de store e viaja. A frase velha custou tres
 * rodadas vermelhas por um `drawLineUI(B)` esperando um botao que a casa esconde de proposito.
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
import { setSharePermission } from './helpers/collab-helpers.js';

collabTest.describe('Map lock management button', () => {
    collabTest.use({ collabOptions: { peers: 1, permission: 'manage', mapName: 'Mapa Tático' } });

    collabTest('manager toggles through the button; live lower roles hide it and refuse writes', async ({ collab }, testInfo) => {
        collabTest.setTimeout(120000);
        const owner = collab.author;
        const manager = collab.peers[0];
        for (const page of [owner, manager]) {
            await page.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
            await expect(page.locator('[data-testid="map-lock-toggle"]')).toBeVisible();
        }
        const button = manager.locator('[data-testid="map-lock-toggle"]');
        await button.click();
        await expect.poll(async () => (await lockStateOf(owner)).travado).toBe(true);
        await expect(button).toHaveAttribute('data-locked', 'true');
        await manager.screenshot({ path: testInfo.outputPath('manager-lock-visible.png') });
        await button.click();
        await expect.poll(async () => (await lockStateOf(owner)).travado).toBe(false);

        for (const permission of ['write', 'comment', 'read']) {
            const status = await setSharePermission(owner, collab.baseUrl, collab.userA, collab.atlasId, collab.userB.id, permission);
            expect(status).toBeLessThan(300);
            await expect.poll(() => manager.evaluate(async () => {
                const { sessionContext } = await import('/src/js/store/sync/session-context.js');
                return sessionContext.role;
            })).toBe({ write: 'editor', comment: 'commenter', read: 'viewer' }[permission]);
            await expect(button).toBeHidden();
            expect(await applyStoreOp(manager, 'toggleMapLock', [])).toBeNull();
            expect(await toggleLockViaController(manager)).toBe(false);
            expect((await lockStateOf(owner)).travado).toBe(false);
            await manager.screenshot({ path: testInfo.outputPath(`${permission}-lock-hidden.png`) });
        }

        const status = await setSharePermission(owner, collab.baseUrl, collab.userA, collab.atlasId, collab.userB.id, 'manage');
        expect(status).toBeLessThan(300);
        await expect(button).toBeVisible();
        await expect(button).toBeEnabled();
    });
});

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

collabTest.describe('Map lock — management toggle, read-only on BOTH sides, collaboration stays consistent', () => {
    // ESTE CASO PEDIA "editor keeps editing" ENQUANTO O DONO SEGURAVA A TRAVA, e desde
    // `957a9567` isso deixou de ser o produto. A op de trava passou a NASCER dentro da transacao
    // da op de store, entao travar pela op crua tambem VIAJA: o Editor le' o mapa travado, a barra
    // de desenho dele some, e `drawLineUI(B)` estourava esperando para sempre por um botao que a
    // casa esconde de proposito (medido: `locator.click` em `.toolbar-group[data-group-id="draw"]`
    // com "element is not visible", 3 de 3 rodadas, `playwright-p3.log` e `playwright-base.log`).
    //
    // ELE NAO FOI FUNDIDO COM O CASO DE BAIXO, e a razao e' que os dois medem coisas disjuntas.
    // Este mede o POSTO (um Editor nao trava), a imposicao LOCAL no dono, o alcance da trava pela
    // op CRUA e o "ESTADO recusa o clique" no Editor; o de baixo mede a trava pelo CONTROLADOR (o
    // caminho do cadeado) e a sobrevivencia das feicoes do par. O que a reescrita fez foi mover a
    // afirmacao "o Editor continua editando" para DEPOIS do destravamento, que e' onde ela passou
    // a ser verdadeira, em vez de apaga-la.
    //
    // EXECUTADO EM 2026-09-21, e ate' aquela data este comentario dizia "NAO EXECUTADO ... fica
    // para o coordenador rodar" (o Playwright estava fora do laco de quem o reescreveu, porta 3912
    // em uso por outro agente). Medido em serie com `--repeat-each=3 --retries=0`, em portas
    // isoladas: 3 de 3 verdes, sem um `flaky`. Anote a data e a contagem ao re-executar; um "fica
    // para rodar" sem prazo de validade e' o que manteve esta linha viva por oito dias.
    collabTest('an editor cannot lock; the owner can; the lock blocks the owner AND reaches the editor', async ({ collab }) => {
        collabTest.setTimeout(120000);
        const A = collab.author; // owner
        const B = collab.peers[0]; // editor
        const mapName = collab.mapName;

        // Baseline BEFORE any lock: B (editor) draws a line; it reaches the owner A through the
        // whole chain. This is also the count the peer must not lose when the lock arrives.
        const warm = await drawLineUI(B, lineCoords());
        await collab.expectFullSyncFrom(B, { entityId: warm, type: 'lines', operationType: 'create' });
        const antes = await lockStateOf(B);
        expect(antes.travado, 'premissa: o Editor comeca com o mapa destravado').toBe(false);
        expect(antes.linhas, 'premissa: o Editor ve a linha que acabou de desenhar')
            .toBeGreaterThanOrEqual(1);

        // The editor B is NOT allowed to lock (canLockMaps is management-only). O POSTO, e ele
        // continua sendo a metade que nenhum outro caso deste arquivo mede.
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

        // ── A TRAVA ALCANCA O EDITOR, e e' aqui que este caso passou a medir outra coisa ──────
        //
        // The editor's own read of the edit gate (`isCurrentMapLockedSync`) flips, and its
        // features survive: the payload of a lock toggle is `{locked: true}` and nothing else, so
        // the peer that REPLACED its map document with it used to lose the whole feature
        // collection.
        await expect
            .poll(async () => (await lockStateOf(B)).travado, { timeout: 30000, intervals: [500] })
            .toBe(true);
        expect((await lockStateOf(B)).linhas, 'as feicoes do Editor sobreviveram a trava do dono')
            .toBe(antes.linhas);

        // O POSTO SOME: a barra de desenho do Editor desaparece, exatamente como a do dono. Nao e'
        // um bloqueio de papel, e' o mesmo estado, lido do outro lado.
        await expect(B.locator('.toolbar-group[data-group-id="draw"]')).toBeHidden({ timeout: 15000 });

        // O ESTADO RECUSA O CLIQUE, NOMEANDO O ESTADO. O menu por mapa e' a superficie onde a
        // regra da casa se le' inteira (`map-menu-actions.js`): "Renomear" exige `UPDATE_MAP`, que
        // um Editor tem, entao o comando NAO some por posto; ele e' desenhado, marcado com
        // `aria-disabled` e o clique explica. Modelo: `browser-layer-transfer-permissions.spec.js`.
        await B.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
        const linhaDoMapa = B.locator(`.maps-tab .map-list-item[data-map-name="${mapName}"]`);
        await expect(linhaDoMapa).toBeVisible({ timeout: 15000 });
        // O cadeado na linha do mapa e' a trava DITA na interface, e nao so' lida da memoria.
        await expect(linhaDoMapa.locator('.map-lock-indicator')).toBeVisible({ timeout: 15000 });

        await linhaDoMapa.locator('.map-list-action-btn.menu-btn').click();
        const menu = B.locator('.map-context-menu');
        await expect(menu).toBeVisible({ timeout: 5000 });
        const renomear = menu.locator('.map-context-menu-item').filter({ hasText: 'Renomear' });
        await expect(renomear, 'o comando bloqueado por ESTADO continua desenhado')
            .toBeVisible({ timeout: 5000 });
        await expect(renomear).toHaveAttribute('aria-disabled', 'true');
        // NUNCA a propriedade `disabled` (o clique e' como o motivo chega). Nao use
        // `toBeEnabled()`: o Playwright le' `aria-disabled="true"` como desabilitado e a asserção
        // mediria o CONTRARIO do que a regra da casa pede.
        expect(
            await renomear.evaluate((el) => el.disabled === true),
            'o comando bloqueado por estado nao leva a propriedade `disabled`',
        ).toBe(false);

        // `dispatchEvent`, e nao `click()`, pela mesma razao: o Playwright espera o alvo ficar
        // "enabled" e esperaria para sempre.
        await renomear.dispatchEvent('click');
        const aviso = B.locator('.toast--warning');
        await expect(aviso).toBeVisible({ timeout: 5000 });
        // A frase NOMEIA o estado (a trava) e a saida (destravar), nunca o papel de quem clicou.
        await expect(aviso).toContainText('bloqueado');
        // E NADA ACONTECEU: o prompt de renomear (`showPrompt`, `modals/prompt.modal.js`) nao
        // abriu. O seletor e' o do modal REAL, e nao um palpite: um seletor que nao casa com nada
        // deixaria este `toHaveCount(0)` verde para sempre, que e' a cobertura vazia da casa.
        await expect(B.locator('.prompt-modal-container')).toHaveCount(0);

        // ── DESTRAVAR DEVOLVE OS DOIS LADOS ──────────────────────────────────────────────────
        const unlocked = await applyStoreOp(A, 'toggleMapLock', [mapName]);
        expect(unlocked, 'second toggle unlocks').toBe(false);
        await expect
            .poll(async () => (await lockStateOf(B)).travado, { timeout: 30000, intervals: [500] })
            .toBe(false);
        await expect(B.locator('.toolbar-group[data-group-id="draw"]')).toBeVisible({ timeout: 15000 });

        // Owner writes work again and traverse the chain to B...
        const afterUnlock = await drawLineUI(A, lineCoords());
        await collab.expectFullSync({ entityId: afterUnlock, type: 'lines', operationType: 'create' });
        // ...e o Editor volta a editar, com a edicao dele atravessando a cadeia INTEIRA de volta.
        // Esta era a afirmacao original do caso; ela nao foi apagada, foi movida para depois do
        // destravamento, que e' onde ela deixou de ser falsa.
        const fromB = await drawLineUI(B, lineCoords());
        await collab.expectFullSyncFrom(B, { entityId: fromB, type: 'lines', operationType: 'create' });
    });

    // O CASO QUE FALTAVA, e o que ele mede nao e' medido por nenhum outro: a trava pelo CAMINHO DA
    // INTERFACE chegando ao PAR. Escrito em 2026-09-13 junto com as duas correcoes que o tornam
    // possivel (a op nascendo na store, e a mescla parcial na aplicacao remota). Nasceu NAO
    // EXECUTADO, porque o Playwright estava fora do laco de quem o escreveu, e foi EXECUTADO em
    // 2026-09-21: 3 de 3 verdes em serie (`--repeat-each=3 --retries=0`), sem um `flaky`. As duas
    // metades que ele cobra (a trava do controlador chegando ao par, e as feicoes do par
    // sobrevivendo ao payload parcial) estao, portanto, MEDIDAS e nao apenas afirmadas.
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
