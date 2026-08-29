// Path: e2e-ui/browser-collab-maps-layers.spec.js

/**
 * MAPS + LAYERS + cross-map MOVE synced cross-client — TWO real browsers + real backend,
 * on the full-chain harness. Client A drives the REAL UI (create a map via the Maps tab,
 * a layer via the Camadas tab, draw a line, move it via the "Mover para mapa" context
 * menu) and each entity is verified end-to-end:
 *
 *   1. create a SECOND map        → full chain to B (entityType 'map', SQL `maps` row)
 *   2. create a LAYER             → full chain to B (entityType 'layer', SQL `layers` row)
 *   3. draw a LINE                → full chain to B
 *   4. MOVE the line to map 2     → on B it leaves the shared map and joins the second
 *      (a compound op — verified via the peer repo per map, not a single expectFullSync)
 *
 * Run headed:  npx playwright test browser-collab-maps-layers --headed
 */

import { collabTest, expect, readFeatures, currentMapName, drawLineUI } from './helpers/collab.fixtures.js';

const SHARED_MAP = 'Mapa Tático';
const SECOND_MAP = 'Mapa Secundário';
const LAYER_NAME = 'Camada Tática';

/**
 * Resolves the sync UUID of the most recent `entityType`/`operationType` op authored on
 * this page, read from its trace (the op's entityId is the canonical sync id — the local
 * map/layer record may be name-keyed, so reading repo `.id` is NOT reliable). Polls until
 * the op's apply.persist span exists.
 */
async function syncIdFromTrace(page, entityType, operationType) {
    let id = null;
    await expect
        .poll(async () => {
            id = await page.evaluate((q) => {
                const t = window.__ebgeoSyncTrace;
                if (!t) return null;
                const spans = t.get((s) => s.stage === 'apply.persist' && s.entityType === q.et && s.operationType === q.ot);
                return spans.length ? spans[spans.length - 1].entityId : null;
            }, { et: entityType, ot: operationType });
            return id;
        }, { timeout: 10000 })
        .toBeTruthy();
    return id;
}

/** Creates a new map through the real Maps-tab UI (createMap makes it the active map). */
async function createMapUI(page, name) {
    await page.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
    await expect(page.locator('.maps-tab #current-map-name-input')).toBeVisible({ timeout: 10000 });
    await page.locator('[data-testid="maps-new-map"]').click();
    const input = page.locator('.prompt-modal-input');
    await expect(input).toBeVisible({ timeout: 5000 });
    await input.fill(name);
    await page.locator('.prompt-modal-btn-confirm').click();
    await expect(input).toBeHidden({ timeout: 5000 });
    await expect(page.locator(`.maps-tab .map-list-item[data-map-name="${name}"]`)).toBeVisible({ timeout: 5000 });
}

/**
 * Switches the active map by clicking its card in the Maps-tab list.
 *
 * O CLIQUE É REENVIADO ATÉ TOMAR, e é isso que fecha a corrida que o `poll` sozinho só observava.
 *
 * MEDIDO na suíte cheia: `Expected: "Mapa Tático" / Received: "Mapa Secundário"` depois de 10 s de
 * espera. O clique era UM só e resolvido antes: `card.evaluate((el) => el.click())` acha o elemento
 * e só então chama `click()` NAQUELE elemento. Se a lista re-renderizar nesse intervalo, e ela
 * re-renderiza a cada op de sync que chega (que é o assunto deste spec), o nó original sai do DOM e
 * o clique vai para um elemento DESTACADO. Clicar em nó destacado não levanta erro: não faz nada.
 *
 * O `poll` não podia consertar isso, e a razão vale além daqui: ele observava um efeito que nunca
 * seria produzido, porque a causa já tinha acontecido antes de ele começar. Re-localizar e
 * re-clicar DENTRO do laço troca "o clique se perdeu" por "o clique é reenviado".
 *
 * Re-clicar o card do mapa que JÁ está ativo é inócuo, então o laço não tem efeito colateral.
 */
async function switchToMapUI(page, name) {
    await page.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
    const card = page.locator(`.maps-tab .map-list-item[data-map-name="${name}"]`);
    await expect(card).toBeVisible({ timeout: 10000 });

    await expect.poll(async () => {
        if (await currentMapName(page) === name) return name;
        // RE-LOCALIZA a cada tentativa: guardar o handle é exatamente o defeito descrito acima.
        const alvo = page.locator(`.maps-tab .map-list-item[data-map-name="${name}"]`);
        if (await alvo.count() > 0) {
            await alvo.first().evaluate((el) => el.click())
                .catch(() => { /* re-render no meio do clique: a próxima volta reenvia */ });
        }
        return currentMapName(page);
    }, {
        timeout: 15000,
        message: `o mapa ativo não virou "${name}" nem com o clique reenviado`,
    }).toBe(name);
}

/** Creates a layer on the ACTIVE map through the real Camadas-tab UI. */
async function createLayerUI(page, name) {
    await page.locator('.sidebar-nav-btn[data-tab="camadas"]').click();
    const addBtn = page.locator('.layers-tab .sidebar-section-header-btn[title="Nova camada"]');
    await expect(addBtn).toBeVisible({ timeout: 10000 });
    await addBtn.click();
    const input = page.locator('.prompt-modal-input');
    await expect(input).toBeVisible({ timeout: 5000 });
    await input.fill(name);
    await page.locator('.prompt-modal-btn-confirm').click();
    await expect(input).toBeHidden({ timeout: 5000 });
}

/**
 * Solta a ferramenta de desenho ativa, para que o menu de contexto do mapa possa abrir.
 *
 * O QUE ESTE HELPER FAZIA, E POR QUE NÃO VERIFICAVA NADA. Ele pressionava `Escape` e exigia
 * `.toolbar-tool-btn[data-active="true"]` com contagem ZERO. Esse atributo NÃO É ESCRITO POR
 * NINGUÉM: uma varredura por `data-active` em `src/js` acha o botão de feição e o de navegação
 * da barra inferior, e nenhum `.toolbar-tool-btn`. A asserção era verdadeira SEMPRE, por
 * vacuidade. E `Escape` não desativa ferramenta: nenhum controle de desenho escuta a tecla.
 * O helper não desativava, e provava que tinha desativado.
 *
 * O QUE ISSO CUSTAVA: `ContextMenuControl._onRightClick` sai cedo quando
 * `toolManager.hasActiveTool()` é verdadeiro, então um tool ainda ativo faz o clique-direito ser
 * ENGOLIDO, e o sintoma aparece duas funções adiante como "o menu não ficou visível".
 *
 * A CORREÇÃO TEM DUAS METADES, e a segunda é a que importa: desativar de fato, e verificar contra
 * `hasActiveTool()`, que é EXATAMENTE o predicado que o menu consulta. Verificar por atributo de
 * CSS era medir um proxy; verificar pelo predicado do consumidor não passa verde com o produto
 * errado.
 *
 * O `toolManager` vem do controle registrado (`BaseControl` o guarda em `this.toolManager`), que é
 * o mesmo caminho que `drawViaToolUI` já usa para ler `drawPoints`.
 */
async function deactivateToolUI(page) {
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.press('Escape');

    await page.evaluate(async () => {
        const s = await import('/src/js/store/index.js');
        // Qualquer controle de desenho serve: todos compartilham a MESMA instância de ToolManager.
        for (const nome of ['AddLineControl', 'AddPointControl', 'AddPolygonControl']) {
            const tm = s.getControl?.(nome)?.toolManager;
            if (tm?.deactivateCurrentTool) { tm.deactivateCurrentTool(); return; }
        }
    });

    await expect.poll(async () => page.evaluate(async () => {
        const s = await import('/src/js/store/index.js');
        for (const nome of ['AddLineControl', 'AddPointControl', 'AddPolygonControl']) {
            const tm = s.getControl?.(nome)?.toolManager;
            if (tm?.hasActiveTool) return tm.hasActiveTool();
        }
        // Sem controle registrado a pergunta não tem sujeito, e devolver `false` seria o mesmo
        // verde vazio que esta função acabou de perder.
        return 'sem-toolmanager';
    }), {
        timeout: 5000,
        message: 'a ferramenta continua ativa, e com ela o clique-direito do mapa é engolido',
    }).toBe(false);
}

/** Selects a feature by id in the layers tree (expanding any collapsed layers first). */
async function selectFeatureInTreeUI(page, featureId) {
    await page.locator('.sidebar-nav-btn[data-tab="camadas"]').click();
    await expect(page.locator('.layer-container').first()).toBeVisible({ timeout: 10000 });
    for (const icon of await page.locator('.layer-expand-icon.collapsed').all()) {
        await icon.click().catch(() => {});
    }
    const row = page.locator(`.feature-item[data-feature-id="${featureId}"] .feature-main`).first();
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect
        .poll(async () => {
            if ((await page.locator('.feature-panel[data-expanded="true"]').count()) > 0) return 1;
            await row.evaluate((el) => el.click()).catch(() => {});
            await page.waitForTimeout(500);
            return page.locator('.feature-panel[data-expanded="true"]').count();
        }, { timeout: 15000, intervals: [700] })
        .toBeGreaterThan(0);
}

/**
 * Um ponto do canvas onde o clique-direito ABRE o menu de contexto do mapa.
 *
 * NÃO É "O CENTRO DO CANVAS", e a diferença foi medida com a pilha de quem interrompia o evento.
 * Com uma feição selecionada, a ferramenta dela entra em modo de edição e desenha ALÇAS DE
 * VÉRTICE. `AddLineControl.handleEditRightClick` (e as irmãs de polígono, seta e limite) escuta
 * `contextmenu` no canvas em FASE DE CAPTURA, de propósito, e chama `stopPropagation()` quando o
 * clique cai sobre uma alça: ali o botão direito REMOVE O VÉRTICE, e o menu do mapa não deve
 * abrir. Isso é o produto certo.
 *
 * O centro do canvas calha de cair sobre um vértice da linha deste spec dependendo da câmera, e
 * era essa moeda que decidia se o caso passava. O sintoma ficava a três camadas de distância:
 * `.context-menu` não fica visível, sem erro, sem console, e com o menu VAZIO no DOM (o handler
 * do menu nunca roda, então ele nunca é preenchido).
 *
 * A pergunta certa não é "este pixel é do canvas?" e sim "este pixel abre o menu?". As duas
 * condições são independentes e as duas são necessárias:
 *   1. nenhum elemento de DOM por cima (painel de atributos, paleta) — `elementFromPoint`;
 *   2. nenhuma ALÇA DE EDIÇÃO desenhada ali — `queryRenderedFeatures`, que é a MESMA consulta
 *      que a ferramenta usa para decidir se engole o evento. Perguntar ao produto, e não a uma
 *      heurística de posição, é o que mantém isto verdadeiro quando alguém acrescentar a quinta
 *      ferramenta com alças.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{x: number, y: number}>}
 */
async function pontoQueAbreOMenu(page) {
    const ponto = await page.evaluate(() => {
        const map = globalThis.__ebgeoMap;
        const canvas = map?.getCanvas?.();
        if (!canvas) return null;
        const r = canvas.getBoundingClientRect();

        // As camadas de alça vivem no estilo e o nome delas é convenção do produto
        // (`*-edit-handles-layer`). Derivar do estilo alcança a ferramenta nova sem editar isto.
        const camadasDeAlca = (map.getStyle()?.layers ?? [])
            .map((l) => l.id)
            .filter((id) => /edit-handles/.test(id) && map.getLayer(id));

        const serve = (x, y) => {
            const topo = document.elementFromPoint(Math.round(x), Math.round(y));
            if (!topo || (topo !== canvas && !canvas.contains(topo))) return false;
            if (camadasDeAlca.length === 0) return true;
            const alcas = map.queryRenderedFeatures(
                [Math.round(x - r.left), Math.round(y - r.top)],
                { layers: camadasDeAlca },
            );
            return alcas.length === 0;
        };

        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        if (serve(cx, cy)) return { x: Math.round(cx), y: Math.round(cy) };

        for (const raio of [0.12, 0.22, 0.32, 0.42]) {
            const dx = r.width * raio;
            const dy = r.height * raio;
            for (const [x, y] of [
                [cx - dx, cy], [cx, cy - dy], [cx + dx, cy], [cx, cy + dy],
                [cx - dx, cy - dy], [cx + dx, cy - dy], [cx - dx, cy + dy], [cx + dx, cy + dy],
            ]) {
                if (x > r.left + 8 && x < r.right - 8 && y > r.top + 8 && y < r.bottom - 8 && serve(x, y)) {
                    return { x: Math.round(x), y: Math.round(y) };
                }
            }
        }
        return null;
    });
    // Falhar aqui é honesto: um canvas sem um único pixel que abra o menu é um estado que o teste
    // precisa relatar, e não algo para contornar clicando às cegas.
    expect(ponto, 'nenhum pixel do canvas abre o menu de contexto (overlay ou alça de edição em toda parte)').not.toBeNull();
    return ponto;
}

/**
 * Abre o menu de contexto num ponto livre do canvas, ESCOLHENDO O PONTO E CLICANDO NO MESMO
 * gesto, repetido ate o menu aparecer.
 *
 * O PONTO ENVELHECE ENTRE A ESCOLHA E O CLIQUE, e era essa a causa do flake cronico desta spec.
 * `pontoQueAbreOMenu` valida com `document.elementFromPoint` no instante T; o clique acontece em
 * T + delta, e nesse intervalo a tela se mexe sozinha (um toast de sincronizacao, a barra de
 * presenca do par, um painel que abre). Se algo cobriu o pixel, o `contextmenu` vai para o
 * overlay e NUNCA chega ao listener, que mora no canvas do MapLibre: o `.context-menu` fica no
 * DOM, vazio e escondido, e o teste espera 5 s por um menu que ninguem mandou abrir.
 *
 * Medido em 2026-08-29, 8 rodadas isoladas desta spec: 4 reprovaram na primeira tentativa, e em
 * TODAS elas uma sonda dentro de `_onRightClick` mostrou que o handler nao foi chamado nenhuma
 * vez naquela tentativa (o produto estava intacto: nas execucoes em que o clique chegou, o menu
 * montou 12 itens em 414 a 651 ms). Nao ha o que corrigir no app; o que estava errado era o
 * gesto do driver, que separava a mira do tiro.
 *
 * Reescolher o ponto a cada tentativa e o que um usuario faz quando o clique direito nao abre
 * nada. O teto de 20 s mantem a falha honesta: se o menu nunca abrir, o caso reprova.
 */
async function abrirMenuDeContexto(page) {
    const menu = page.locator('.context-menu');
    await expect(async () => {
        const { x, y } = await pontoQueAbreOMenu(page);
        await page.mouse.move(x, y);
        await page.mouse.click(x, y, { button: 'right' });
        await expect(menu).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 20000 });
    return menu;
}

/** Moves the selected feature(s) to `targetMapName` via the real "Mover para mapa" submenu. */
async function moveSelectedToMapUI(page, targetMapName) {
    const menu = await abrirMenuDeContexto(page);
    const trigger = menu.locator('.context-menu-submenu-trigger', { hasText: 'Mover para mapa' });
    await expect(trigger).toBeVisible({ timeout: 5000 });
    await trigger.dispatchEvent('mouseenter');
    const mapItem = menu.locator('.context-submenu .context-menu-item', { hasText: targetMapName });
    await expect(mapItem).toBeVisible({ timeout: 5000 });
    await mapItem.click();
    await expect(menu).toBeHidden({ timeout: 5000 });
}

/** Reads a specific map's stored feature ids (by storage type) from the peer repo. */
function readPeerMapFeatures(page, mapName, type) {
    return page.evaluate(async ({ mn, t }) => {
        const { getRepository } = await import('/src/js/store/repositories/index.js');
        const mapData = await getRepository().getMap(mn);
        const arr = (mapData && mapData.features && mapData.features[t]) || [];
        return arr.map((x) => x.properties?.id);
    }, { mn: mapName, t: type });
}

collabTest.describe('Maps + layers + cross-map move sync cross-client (real UI gestures + full chain)', () => {
    collabTest('create map → full chain; create layer → full chain; move feature between maps → B reflects it', async ({ collab }) => {
        collabTest.setTimeout(120000);
        const A = collab.author;
        const B = collab.peers[0];

        expect(await currentMapName(A)).toBe(SHARED_MAP);
        expect(await currentMapName(B)).toBe(SHARED_MAP);

        // 1. A creates a SECOND map via the real Maps-tab UI → full chain to B. The map's sync
        //    UUID is the op's entityId (read from the trace; the local record is name-keyed).
        await createMapUI(A, SECOND_MAP);
        expect(await currentMapName(A), 'creating a map makes it the active map').toBe(SECOND_MAP);
        const secondMapId = await syncIdFromTrace(A, 'map', 'create');
        await collab.expectFullSync({ entityId: secondMapId, entityType: 'map', operationType: 'create' });
        await switchToMapUI(A, SHARED_MAP);
        expect(await currentMapName(A), 'A is back on the shared map').toBe(SHARED_MAP);

        // 2. A creates a LAYER on the shared map via the real Camadas-tab UI → full chain to B.
        await collab.clearTraces(); // so the only layer-create span is this one
        await createLayerUI(A, LAYER_NAME);
        const layerId = await syncIdFromTrace(A, 'layer', 'create');
        await collab.expectFullSync({ entityId: layerId, entityType: 'layer', operationType: 'create' });

        // 3. A draws a LINE on the shared map → full chain to B.
        const lineId = await drawLineUI(A, [[-43.2, -22.9], [-43.15, -22.85], [-43.1, -22.8]]);
        expect(lineId, 'the line tool created a line').toBeTruthy();
        await collab.expectFullSync({ entityId: lineId, type: 'lines', operationType: 'create' });

        // 4. A moves its line to the second map via the real "Mover para mapa" submenu. The move
        //    is a compound op (leave map1, join map2), so verify it via the peer repo per map.
        await deactivateToolUI(A);
        await selectFeatureInTreeUI(A, lineId);
        await moveSelectedToMapUI(A, SECOND_MAP);

        // Sanity on A: the line left the shared map.
        await expect
            .poll(async () => (await readFeatures(A, 'lines')).some((x) => x.id === lineId), { timeout: 10000 })
            .toBe(false);

        // On B: the line is GONE from the shared map and PRESENT on the second map.
        await expect
            .poll(async () => (await readPeerMapFeatures(B, SECOND_MAP, 'lines')).includes(lineId), { timeout: 20000 })
            .toBe(true);
        await expect
            .poll(async () => (await readFeatures(B, 'lines')).some((x) => x.id === lineId), { timeout: 20000 })
            .toBe(false);
    });
});
