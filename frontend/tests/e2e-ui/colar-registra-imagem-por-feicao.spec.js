// Path: e2e-ui/colar-registra-imagem-por-feicao.spec.js

/**
 * REPRO DE TELA: colar uma MEDIDA DE COORDENAÇÃO ou uma DECLINAÇÃO MAGNÉTICA colava a feição
 * SEM o símbolo. O traço só aparecia depois de um F5.
 *
 * O SEM-RECARREGAR É O TESTE. As três famílias de símbolo desenham um raster registrado no
 * MapLibre sob o `properties.id` da feição (`'icon-image': ['get', 'id']`, em
 * `layers/styles/symbol.layers.js`), e colar cunha um id novo. O F5 sempre funcionou, porque
 * `setImages` (`layers/layer_setup.js`) varria os quatro buckets com blob; quem estava dois
 * tipos atrás era a varredura de `loadPastedImages`
 * (`tool_manager/clipboard_manager.js`). Logo, um spec que recarregasse a página mediria
 * exatamente a metade que nunca esteve quebrada e fecharia verde sobre o defeito.
 *
 * Por isso a asserção é `__ebgeoMap.hasImage(idNovo)` LOGO DEPOIS da colagem, e nada mais: é
 * o predicado que o estilo consulta para desenhar, é o que era falso antes da correção, e é
 * a única pergunta que o F5 não responde por acidente.
 *
 * `hasImage(idAntigo)` entra ao lado como controle: ele já era verdadeiro antes da colagem
 * (o desenho registra o próprio símbolo), então um `hasImage` que respondesse `true` para
 * tudo não distinguiria nada, e um que respondesse `false` para tudo derrubaria o par.
 *
 * LOCAL E ANÔNIMO, de propósito, no molde de `context-menu-local.spec.js`: a colagem é
 * inteiramente do cliente, `checkPermission` é permissivo sobre a store local, e o defeito
 * não tem metade de servidor (o blob destas três famílias NUNCA sobe, por desenho: o par
 * regenera pelo `layers/image-regen-registry.js`). O backend precisa estar de pé só porque o
 * boot do mapa é fail-fast em `GET /api/config`.
 *
 * AS DUAS FAMÍLIAS RODAM, e não uma: elas são os dois tipos que faltavam na lista fechada, e
 * o que a correção promete é que a lista agora é DERIVADA. Um caso só provaria o conserto de
 * um dos dois.
 *
 * ARMADILHA MEDIDA NA ESCRITA: o id da BARRA e o nome do TOOL ATIVO divergem para a medida de
 * coordenação (`coordination` no botão, `coordinationmeasure` no `getActiveTool()`), então
 * `esperarFerramentaPronta` tem de receber o SEGUNDO. Passar o id do botão faz a espera
 * queimar o timeout inteiro e o clique seguinte cair no vazio, que é o mesmo sintoma mudo de
 * uma ferramenta que não carregou. `declination` coincide nos dois.
 *
 * `drawViaToolUI` (`helpers/collab-helpers.js`) não serve aqui: ele é fixo no grupo
 * `data-group-id="draw"` da barra, e as duas ferramentas moram no grupo `military`. O gesto
 * abaixo é o de `drawMilitarySymbolUI`, do mesmo arquivo, com o id da ferramenta trocado.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { esperarFerramentaPronta } from './helpers/ferramenta-pronta.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Boots the app and waits for the 2D MapLibre map, its canvas and the splash to be gone. */
async function bootMap(page) {
    await page.goto('/');
    await expect(page.locator('#map-sig .maplibregl-canvas')).toBeAttached({ timeout: 20000 });
    await page.waitForFunction(
        () => globalThis.__ebgeoMap && globalThis.__ebgeoMap.loaded?.() === true,
        null,
        { timeout: 20000 },
    );
    // O splash cobre o canvas até `hideLoadingScreen()` desanexá-lo, e um clique de desenho
    // dentro dessa janela vai para ele, não para o mapa.
    await expect(page.locator('#initial-loader')).toHaveCount(0, { timeout: 20000 });
}

/** Every feature id currently in a storage bucket of the live store. */
const idsDoBucket = (page, bucket) =>
    page.evaluate(async (b) => {
        const store = await import('/src/js/store/index.js');
        const features = await store.getCurrentMapFeatures();
        return (features?.[b] || []).map((f) => f.properties?.id);
    }, bucket);

/**
 * Draws ONE feature with a single-click tool of the MILITARY toolbar group and returns its id.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{toolId: string, toolAtivoId: string, bucket: string}} ferramenta
 *   `toolId` is the toolbar's `data-tool-id`; `toolAtivoId` is what `getActiveTool()` reports
 *   (they differ for the coordination measure); `bucket` is the storage type.
 * @returns {Promise<string>} the new feature id
 */
async function desenharFerramentaMilitar(page, { toolId, toolAtivoId, bucket }) {
    const antes = new Set(await idsDoBucket(page, bucket));

    const box = await page.locator('#map-sig .maplibregl-canvas').boundingBox();
    expect(box).not.toBeNull();

    await page.locator('.toolbar-group[data-group-id="military"] .toolbar-group-btn').click();
    await expect(page.locator('.toolbar-group[data-group-id="military"] .toolbar-popup'))
        .toHaveAttribute('data-visible', 'true', { timeout: 5000 });

    const btn = page.locator(
        `.toolbar-group[data-group-id="military"] .toolbar-tool-btn[data-tool-id="${toolId}"]`,
    );
    await btn.click();
    await expect(btn).toHaveAttribute('data-active', 'true', { timeout: 5000 });
    // O botão acender NÃO é a ferramenta estar pronta: ela vem por `await import()` desde a
    // carga tardia, e o clique abaixo cairia antes de `activate()` pendurar o handler.
    await esperarFerramentaPronta(page, toolAtivoId);

    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.45);

    let id = null;
    await expect
        .poll(async () => {
            id = (await idsDoBucket(page, bucket)).find((x) => !antes.has(x)) ?? null;
            return id;
        }, {
            timeout: 15000,
            message: `a ferramenta "${toolId}" nao criou feicao em "${bucket}"`,
        })
        .toBeTruthy();

    return id;
}

/** Selects one feature and runs the REAL clipboard copy/paste (the "Duplicar Seleção" path). */
async function copiarEColar(page, bucket, featureId) {
    await page.evaluate(async ({ b, id }) => {
        const store = await import('/src/js/store/index.js');
        const features = await store.getCurrentMapFeatures();
        const feature = (features?.[b] || []).find((f) => f.properties?.id === id);

        const sm = store.getStateManager();
        sm.batchUpdate(() => {
            sm.clearSelection();
            sm.addToSelection(b, String(id), feature);
        });

        const clipboard = store.getControl('ClipboardManager');
        // `copy()` é assíncrona desde a carga tardia das ferramentas: sem o await, `paste()`
        // colaria o clipboard anterior.
        await clipboard.copy();
        await clipboard.paste();
    }, { b: bucket, id: featureId });
}

/** `map.hasImage(id)` read from the LIVE map, with no reload in between. */
const mapaTemImagem = (page, imageId) =>
    page.evaluate((id) => globalThis.__ebgeoMap.hasImage(id) === true, imageId);

const FAMILIAS = [
    { nome: 'medida de coordenação', toolId: 'coordination', toolAtivoId: 'coordinationmeasure', bucket: 'coordination_measures' },
    { nome: 'declinação magnética', toolId: 'declination', toolAtivoId: 'declination', bucket: 'magnetic_declinations' },
];

describeOrSkip('colar registra a imagem de TODA feição que carrega símbolo (local, sem recarregar)', () => {
    for (const familia of FAMILIAS) {
        test(`colar uma ${familia.nome} registra o símbolo sob o id NOVO`, async ({ page }) => {
            await bootMap(page);

            const idOriginal = await desenharFerramentaMilitar(page, familia);

            // CONTROLE, antes da colagem: o desenho registra o próprio símbolo. Sem isto, um
            // `hasImage` sempre-falso passaria despercebido como "o defeito continua".
            expect(await mapaTemImagem(page, idOriginal), 'o desenho nao registrou o simbolo original').toBe(true);

            await copiarEColar(page, familia.bucket, idOriginal);

            await expect
                .poll(async () => (await idsDoBucket(page, familia.bucket)).length, { timeout: 15000 })
                .toBe(2);

            const ids = await idsDoBucket(page, familia.bucket);
            const idNovo = ids.find((x) => x !== idOriginal);
            expect(idNovo, 'a colagem nao cunhou um id novo').toBeTruthy();

            // A ASSERÇÃO DO DEFEITO. Sem recarregar: era falso antes da correção, porque
            // `loadPastedImages` varria uma lista fechada de dois buckets.
            expect(
                await mapaTemImagem(page, idNovo),
                `a feicao colada (${idNovo}) nao tem imagem registrada no mapa: ela desenha vazia ate um F5`,
            ).toBe(true);

            // E a original continua desenhando: a colagem duplica o blob, não o move.
            expect(await mapaTemImagem(page, idOriginal)).toBe(true);
        });
    }
});
