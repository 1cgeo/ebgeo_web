// Path: e2e-ui/cobertura-kmz-simbolos.spec.js

/**
 * @fileoverview COBERTURA da exportação KMZ dos símbolos táticos, pela porta real (aba Exportar →
 * "Exportar KMZ"). Campanha de cobertura de 2026-09-24.
 *
 * Antes dela nenhum spec de navegador exportava Símbolo Militar, Medida de Coordenação, Símbolo de
 * Engenharia ou Declinação Magnética para KMZ; só a classificação era provada em vitest
 * (`kmz-feature-types.repro.test.js`). Aqui os quatro são desenhados pela barra, o KMZ é baixado e
 * aberto com JSZip: cada símbolo precisa ser um `<Placemark>` com o nome dele e um `<Icon>` cujo
 * `href` aponta um PNG que EXISTE no zip e é um PNG de verdade (assinatura), com mais que um pixel.
 */

import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import { readFileSync } from 'node:fs';
import { readState } from './state.js';
import { readFeatures } from './helpers/collab-helpers.js';
import { esperarFerramentaPronta } from './helpers/ferramenta-pronta.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

const FERRAMENTAS = [
    { toolId: 'militarySymbol', ativo: 'militarysymbol', bucket: 'military_symbols', dx: -0.2 },
    { toolId: 'coordination', ativo: 'coordinationmeasure', bucket: 'coordination_measures', dx: -0.07 },
    { toolId: 'engineeringSymbol', ativo: 'engineeringsymbol', bucket: 'engineering_symbols', dx: 0.07 },
    { toolId: 'declination', ativo: 'declination', bucket: 'magnetic_declinations', dx: 0.2 },
];

async function criar(page, { toolId, ativo, bucket, dx }) {
    const antes = new Set((await readFeatures(page, bucket)).map((f) => f.id));
    await page.locator('.toolbar-group[data-group-id="military"] .toolbar-group-btn').click();
    await page.locator(`.toolbar-group[data-group-id="military"] .toolbar-tool-btn[data-tool-id="${toolId}"]`).click();
    await esperarFerramentaPronta(page, ativo);
    const box = await page.locator('#map-sig .maplibregl-canvas').boundingBox();
    await page.mouse.click(box.x + box.width * (0.5 + dx), box.y + box.height * 0.5);
    let feicao = null;
    await expect.poll(async () => {
        feicao = (await readFeatures(page, bucket)).find((f) => !antes.has(f.id)) ?? null;
        return feicao?.id ?? null;
    }, { timeout: 15000, message: `${toolId} nao criou` }).toBeTruthy();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    return feicao;
}

const escapar = (t) => String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describeOrSkip('KMZ dos símbolos táticos', () => {
    test.describe.configure({ retries: 0 });

    test('os quatro símbolos saem como Placemark com ícone PNG presente no zip', async ({ page }) => {
        test.setTimeout(180000);
        await page.goto('/');
        await page.waitForFunction(() => globalThis.__ebgeoMap?.getZoom, null, { timeout: 30000 });
        await page.evaluate(() => globalThis.__ebgeoMap.jumpTo({ center: [-43.2, -22.9], zoom: 13 }));
        const feicoes = [];
        for (const f of FERRAMENTAS) feicoes.push(await criar(page, f));

        await page.locator('.sidebar-nav-btn[data-tab="exportar"]').click();
        await page.locator('.export-option-btn', { hasText: 'Exportar KMZ' }).click();
        const baixando = page.waitForEvent('download', { timeout: 60000 });
        await page.locator('.kmz-export-btn').click();
        const bytes = readFileSync(await (await baixando).path());
        const zip = await JSZip.loadAsync(bytes);
        const kmlNome = Object.keys(zip.files).find((n) => n.endsWith('.kml'));
        expect(kmlNome, 'o KMZ tem um documento KML').toBeTruthy();
        const kml = await zip.file(kmlNome).async('string');

        const placemarks = kml.match(/<Placemark>[\s\S]*?<\/Placemark>/g) ?? [];
        const estilos = new Map([...kml.matchAll(/<Style id="([^"]+)">([\s\S]*?)<\/Style>/g)].map((m) => [m[1], m[2]]));
        for (const f of feicoes) {
            const pm = placemarks.find((p) => new RegExp(`<name>(<!\\[CDATA\\[)?${escapar(f.nome)}(\\]\\]>)?</name>`).test(p));
            expect(pm, `sem Placemark para "${f.nome}"`).toBeTruthy();
            const styleUrl = pm.match(/<styleUrl>#([^<]+)<\/styleUrl>/)?.[1];
            const corpo = (styleUrl && estilos.get(styleUrl)) || pm;
            const href = corpo.match(/<Icon>\s*<href>([^<]+)<\/href>/)?.[1];
            expect(href, `"${f.nome}" sem <Icon><href>`).toBeTruthy();
            const arquivo = zip.file(href);
            expect(arquivo, `o zip nao tem ${href}`).toBeTruthy();
            const png = await arquivo.async('uint8array');
            expect([...png.slice(0, 8)], `${href} nao e PNG`).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
            const largura = (png[16] << 24) | (png[17] << 16) | (png[18] << 8) | png[19];
            expect(largura, `${href} com largura ${largura}`).toBeGreaterThan(8);
        }
    });
});
