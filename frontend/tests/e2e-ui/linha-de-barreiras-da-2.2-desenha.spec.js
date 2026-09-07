// Path: e2e-ui/linha-de-barreiras-da-2.2-desenha.spec.js

/**
 * @fileoverview A Linha de Barreiras de um `.ebgeo` 2.2 chega à TELA, medida em Chromium de
 * verdade.
 *
 * ---------------------------------------------------------------------------
 * O DEFEITO, E POR QUE ELE SÓ APARECE NO NAVEGADOR
 * ---------------------------------------------------------------------------
 * A outra linha do produto teve, na 2.2, a ferramenta Linha de Barreiras, que escrevia no balde
 * `barrier_lines` com `source: 'barrier_line'`. A 2.3 a generalizou na Linha de Coordenação, cujo
 * combobox escolhe um dos símbolos lineares do MD33, e a linha de barreiras é o `290199` daquele
 * catálogo. A migração 2.2 para 2.3 de lá NÃO moveu nada: acrescentou o balde novo VAZIO e deixou
 * o velho onde estava. Medido em 2026-09-07 com insumo forjado de cinco linhas: `barrier_lines`
 * tem 0 ocorrência no código da 2.3, da 2.4 e desta linha, nenhuma fonte do MapLibre tem esse
 * nome, e as feições atravessam o disco e o `.ebgeo` sem nunca serem desenhadas, listadas,
 * selecionadas nem contadas. Não é perda de bytes, é perda de alcance.
 *
 * `coordination-line-balde.test.js` responde "a função pura move o balde". Este arquivo responde a
 * pergunta que ela não alcança: o que o usuário VÊ depois de abrir o arquivo dele. As duas metades
 * de que o teste de unidade não dispõe são o MapLibre de verdade (a fonte, a camada e o filtro que
 * decidem se o losango aparece) e `applyZoomCorrections`, que REGENERA a geometria de toda linha
 * de coordenação na carga a partir de `baseCoordinates`. Foi essa segunda que reprovou a primeira
 * versão do conserto: sem recuperar `baseCoordinates`, a feição adotada é redesenhada como
 * `LineString [[0,0],[0,0]]` e vai parar na Ilha Nula, o que é pior que o defeito original.
 *
 * ---------------------------------------------------------------------------
 * O INSUMO É FORJADO AQUI, E ISSO É DECLARADO
 * ---------------------------------------------------------------------------
 * Nenhuma fixture do repositório carrega `barrier_lines` com conteúdo: a receita que as gera pede
 * a ferramenta pelo nome NOVO, e a 2.2 não a registra. Então este arquivo forja o insumo que
 * falta, a partir de `01-completo.ebgeo` (2.2 de verdade, byte a byte da outra linha): move cinco
 * linhas do mapa `02 Estilos` para `barrier_lines` e carimba nelas o `DEFAULT_PROPERTIES` que
 * `add_barrier_line_control.js` escrevia (commit `24b07975` da `main`), `baseCoordinates`
 * inclusive. O que se mede é a sobrevivência do BALDE e a fidelidade das PROPRIEDADES, não a
 * fidelidade do traço original: a geometria de entrada é a da linha comum, e é o próprio app que a
 * redesenha como losangos ao carregar, que é exatamente o que este caso quer ver acontecer.
 *
 * As cinco têm 9,3 km cada, e o par autorado (0,5 km de losango a cada 1,5 km) cabe seis vezes
 * nesse comprimento. Isso não é decoração: com um losango que não coubesse, a geometria degradaria
 * para a espinha nua e o caso ficaria verde sem nunca ter desenhado um símbolo.
 *
 * ---------------------------------------------------------------------------
 * POR QUE A FERRAMENTA É ATIVADA NO MEIO DO CASO
 * ---------------------------------------------------------------------------
 * `setupCoordinationLineLayers` só REGENERA a geometria quando `getControl` já responde, e desde
 * a onda de `await import()` (2026-08-25) a ferramenta chega tarde: sem ela, a camada é montada
 * com a geometria GUARDADA, verbatim. Numa Linha de Barreiras autêntica isso não se nota, porque
 * a geometria guardada dela JÁ é o padrão de losangos que a ferramenta da 2.2 escreveu; no insumo
 * forjado aqui a geometria guardada é a da linha comum de onde ela veio, e a primeira versão
 * deste caso ficou vermelha exatamente aí, com `LineString` onde esperava `MultiLineString`
 * (medido em 2026-09-07). Então o caso faz o gesto que falta: ativa a ferramenta pela barra, o
 * que carrega o módulo, e volta ao mapa, o que remonta a camada com o controle de pé. O que se
 * mede depois disso é o desenho REGENERADO a partir de `baseCoordinates`, que é o único caminho
 * capaz de reprovar a perda daquela propriedade.
 *
 * ---------------------------------------------------------------------------
 * O QUE UM VERDE AQUI NÃO DIZ
 * ---------------------------------------------------------------------------
 *   - NÃO diz nada sobre o IndexedDB de quem já está na 2.3 ou 2.4 desta linha: aqui o caminho é
 *     o do arquivo. Os outros dois caminhos de leitura (snapshot do servidor e IndexedDB) chamam a
 *     MESMA função pura, e quem os cobre é `tests/unit/coordination-line-balde.test.js`.
 *   - NÃO diz nada sobre o envio ao servidor: `local-atlas-to-server.js` lê os baldes crus e
 *     não passa por esta normalização.
 *   - NÃO prova o traço da linha de barreiras ORIGINAL, que este insumo não tem.
 */

import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import JSZip from 'jszip';
import { readState } from './state.js';
import { loadEbgeoFixture } from '../helpers/ebgeo-fixture.js';
import { esperarFerramentaPronta } from './helpers/ferramenta-pronta.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** O mascaramento do `.ebgeo`, o mesmo de `tests/helpers/ebgeo-fixture.js`. */
const MASK_HEADER = 'EBGXOR';
const XOR_KEY = 0xAA;

/** O mapa do arquivo que ganha as linhas forjadas, e quantas. */
const MAPA = '02 Estilos';
const QUANTAS = 5;

/** Os mapas que `01-completo.ebgeo` declara, para ancorar o fim do import. */
const MAPAS_DO_ARQUIVO = 11;

/**
 * `AddBarrierLineControl.DEFAULT_PROPERTIES` da 2.2, verbatim (`24b07975`,
 * `src/js/military_tools/barrier_line_tool/add_barrier_line_control.js:58`), menos o que o
 * controle sobrescreve por feição (`id`, `nome`, `layerId`, `baseCoordinates`).
 *
 * Está escrito por extenso, e não derivado do código de hoje, porque é o insumo: derivá-lo da
 * ferramenta ATUAL faria o caso medir a ferramenta contra ela mesma.
 */
const BARRIER_LINE_2_2 = Object.freeze({
    color: '#000000',
    lineWidth: 4,
    opacity: 1,
    source: 'barrier_line',
    symbol_size: 0.5,
    symbol_spacing: 1.5,
    createdAtZoom: 0,
    zoomCorrectionEnabled: true,
    calculatedLineWidth: 4,
    calculatedSymbolSize: 0.5,
    calculatedSymbolSpacing: 1.5,
    descricao: '',
    visivel: true,
    bloqueado: false,
});

/**
 * Forja um `.ebgeo` 2.2 com o balde `barrier_lines` cheio e o grava no disco.
 *
 * @param {string} destino - Caminho do arquivo a escrever.
 * @returns {Promise<{ids: string[], nomes: string[]}>} Ids e nomes das feições movidas.
 */
async function forjarArquivoComBarreiras(destino) {
    const raw = new Uint8Array(readFileSync(
        new URL('../fixtures/ebgeo-2.2/01-completo.ebgeo', import.meta.url)));
    const cabecalho = new TextDecoder().decode(raw.slice(0, MASK_HEADER.length));
    const zipBytes = cabecalho === MASK_HEADER
        ? Uint8Array.from(raw.slice(MASK_HEADER.length), byte => byte ^ XOR_KEY)
        : raw;

    const zip = await JSZip.loadAsync(zipBytes);
    const data = JSON.parse(await zip.file('data.json').async('string'));
    const features = data.maps[MAPA].features;

    const ids = [];
    const nomes = [];
    features.barrier_lines = [];
    for (let n = 1; n <= QUANTAS; n += 1) {
        const feicao = features.lines.pop();
        const nome = `Linha de Barreiras #${n}`;
        feicao.properties = {
            ...feicao.properties,
            ...BARRIER_LINE_2_2,
            nome,
            // O que o controle da 2.2 escrevia por feição: a espinha autorada, que é de onde a
            // ferramenta nova regenera o desenho a cada zoom.
            baseCoordinates: feicao.geometry.coordinates.map(([lng, lat]) => [lng, lat]),
        };
        ids.push(feicao.properties.id);
        nomes.push(nome);
        features.barrier_lines.push(feicao);
    }

    zip.file('data.json', JSON.stringify(data));
    const saida = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    const mascarado = Uint8Array.from(saida, byte => byte ^ XOR_KEY);
    const arquivo = new Uint8Array(MASK_HEADER.length + mascarado.length);
    arquivo.set(new TextEncoder().encode(MASK_HEADER), 0);
    arquivo.set(mascarado, MASK_HEADER.length);
    writeFileSync(destino, arquivo);

    return { ids, nomes };
}

/** Espera o mapa 2D estar de pé. */
async function esperarMapa(page) {
    await expect(page.locator('#nav-btn-zoom-in')).toBeAttached({ timeout: 30000 });
    await page.waitForFunction(
        () => globalThis.__ebgeoMap && typeof globalThis.__ebgeoMap.getZoom === 'function',
        null,
        { timeout: 30000 },
    );
}

describeOrSkip('o balde `barrier_lines` da 2.2 chega à tela como Linha de Coordenação', () => {
    test('as cinco desenham o losango do 290199 e a aba as lista', async ({ page }, testInfo) => {
        test.setTimeout(180000);

        const arquivo = testInfo.outputPath('22-com-barreiras.ebgeo');
        const { ids, nomes } = await forjarArquivoComBarreiras(arquivo);

        // CONTROLE DO INSUMO: o arquivo que vai entrar tem MESMO o balde velho cheio e o novo
        // ausente. Sem isto, um forjador quebrado daria um caso verde sobre um arquivo comum.
        const forjado = await loadEbgeoFixture('01-completo.ebgeo').then(async () => {
            const bruto = new Uint8Array(readFileSync(arquivo));
            const zip = await JSZip.loadAsync(
                Uint8Array.from(bruto.slice(MASK_HEADER.length), byte => byte ^ XOR_KEY));
            return JSON.parse(await zip.file('data.json').async('string'));
        });
        expect(forjado.version, 'o insumo é 2.2').toBe('2.2');
        expect(forjado.maps[MAPA].features.barrier_lines).toHaveLength(QUANTAS);
        expect(forjado.maps[MAPA].features.coordination_lines).toBeUndefined();

        await page.goto('/atlas.html');
        await expect(page.locator('[data-testid="local-atlas-section"]')).toBeVisible({ timeout: 20000 });
        await page.locator('[data-testid="local-atlas-file-input"]').setInputFiles(arquivo);
        await page.waitForURL((url) => !url.pathname.endsWith('atlas.html'), { timeout: 30000 });
        await esperarMapa(page);

        // O toast é a ÚLTIMA linha do fluxo de import, então é o único sinal de "acabou".
        await expect(page.locator('.toast', { hasText: `${MAPAS_DO_ARQUIVO} mapas carregados!` }))
            .toBeVisible({ timeout: 60000 });

        // A ferramenta pela BARRA, ANTES da troca de mapa: é o clique que carrega o módulo e
        // registra o controle, e sem ele a camada do mapa seguinte seria montada com a geometria
        // guardada, verbatim. Ver o cabeçalho.
        await page.locator('.toolbar-group[data-group-id="military"] .toolbar-group-btn').click();
        await expect(page.locator('.toolbar-group[data-group-id="military"] .toolbar-popup'))
            .toHaveAttribute('data-visible', 'true', { timeout: 5000 });
        await page.locator(
            '.toolbar-group[data-group-id="military"] .toolbar-tool-btn[data-tool-id="coordinationLine"]',
        ).click();
        await esperarFerramentaPronta(page, 'coordinationLine');
        await page.keyboard.press('Escape');

        // O mapa das linhas pela TELA, que é o gesto do usuário. O clique vai dentro de um
        // `evaluate` porque a lista se REDESENHA sozinha e um locator resolvido num tique clica
        // noutro elemento no seguinte (o mesmo motivo registrado em `maps-tab-navigation.spec.js`).
        await page.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
        const cartao = page.locator(`.maps-tab .map-list-item[data-map-name="${MAPA}"]`);
        await expect(cartao).toBeVisible({ timeout: 15000 });
        await page.evaluate((nome) => {
            document.querySelector(`.maps-tab .map-list-item[data-map-name="${nome}"]`)?.click();
        }, MAPA);
        await expect(cartao).toHaveAttribute('data-selected', 'true', { timeout: 15000 });
        await page.waitForTimeout(3000);

        // ------------------------------------------------------------------
        // O QUE O STORE GUARDA
        // ------------------------------------------------------------------
        const noStore = await page.evaluate(async () => {
            const { getMapData, getCurrentMapNameSync } = await import('/src/js/store/index.js');
            const dados = await getMapData(getCurrentMapNameSync());
            const baldes = {};
            for (const [balde, lista] of Object.entries(dados?.features ?? {})) {
                if (Array.isArray(lista) && lista.length) baldes[balde] = lista.length;
            }
            return {
                baldes,
                temBaldeVelho: Object.prototype.hasOwnProperty.call(dados?.features ?? {}, 'barrier_lines'),
                linhas: (dados?.features?.coordination_lines ?? []).map((f) => ({
                    id: f.properties?.id,
                    nome: f.properties?.nome,
                    source: f.properties?.source,
                    symbol_code: f.properties?.symbol_code,
                    symbol_size: f.properties?.symbol_size,
                    symbol_spacing: f.properties?.symbol_spacing,
                    zoomCorrectionEnabled: f.properties?.zoomCorrectionEnabled,
                    vertices: (f.properties?.baseCoordinates ?? []).length,
                })),
            };
        });

        expect(noStore.temBaldeVelho, 'o balde velho não sobrevive à leitura').toBe(false);
        expect(noStore.baldes.barrier_lines).toBeUndefined();
        expect(noStore.linhas).toHaveLength(QUANTAS);
        expect(noStore.linhas.map((l) => l.id).sort()).toEqual([...ids].sort());
        expect(noStore.linhas.map((l) => l.nome).sort()).toEqual([...nomes].sort());
        for (const linha of noStore.linhas) {
            expect(linha.source).toBe('coordination_line');
            expect(linha.symbol_code, 'o símbolo é a linha de barreiras do MD33').toBe('290199');
            expect(linha.symbol_size).toBe(0.5);
            expect(linha.symbol_spacing).toBe(1.5);
            expect(linha.zoomCorrectionEnabled).toBe(true);
            expect(linha.vertices).toBeGreaterThanOrEqual(2);
        }

        // ------------------------------------------------------------------
        // O QUE O MAPA DESENHA
        // ------------------------------------------------------------------
        const naTela = await page.evaluate(async () => {
            const mapa = globalThis.__ebgeoMap;
            const fonte = mapa.getStyle().sources.coordination_lines;
            const feicoes = fonte?.data?.features ?? [];

            // Enquadra as linhas antes de perguntar o que está desenhado: no enquadramento
            // padrão elas ficam fora da tela e `queryRenderedFeatures` responderia zero por
            // motivo que não é o defeito.
            const pontos = [];
            for (const f of feicoes) {
                const g = f.geometry;
                if (g?.type === 'MultiLineString') for (const parte of g.coordinates) pontos.push(...parte);
                else if (g?.type === 'LineString') pontos.push(...g.coordinates);
            }
            if (pontos.length) {
                const lngs = pontos.map((p) => p[0]);
                const lats = pontos.map((p) => p[1]);
                mapa.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
                    { padding: 60, duration: 0 });
                await new Promise((resolve) => mapa.once('idle', resolve));
                await new Promise((resolve) => setTimeout(resolve, 1500));
            }

            return {
                temCamada: Boolean(mapa.getLayer('coordination-line-layer')),
                naFonte: feicoes.length,
                tiposDeGeometria: [...new Set(feicoes.map((f) => f.geometry?.type))],
                // Um losango é um anel fechado a mais na MultiLineString, além dos trechos da
                // espinha. Contar as PARTES é como se vê que o símbolo foi gerado.
                partesPorFeicao: feicoes.map((f) => (f.geometry?.coordinates ?? []).length),
                naIlhaNula: feicoes.filter((f) => JSON.stringify(f.geometry?.coordinates ?? [])
                    .includes('[0,0]')).length,
                renderizadas: mapa.queryRenderedFeatures({ layers: ['coordination-line-layer'] }).length,
            };
        });

        expect(naTela.temCamada, 'a camada da linha de coordenação existe').toBe(true);
        expect(naTela.naFonte, 'a fonte do MapLibre recebeu as cinco').toBe(QUANTAS);
        expect(naTela.tiposDeGeometria, 'o app REGENEROU o desenho como padrão de losangos')
            .toEqual(['MultiLineString']);
        // Seis losangos e os trechos de espinha entre eles: qualquer número acima de 2 partes já
        // é símbolo desenhado, e a espinha nua (a degradação) daria exatamente 1.
        for (const partes of naTela.partesPorFeicao) expect(partes).toBeGreaterThan(2);
        expect(naTela.naIlhaNula, 'nenhuma feição foi parar em [0,0]').toBe(0);
        expect(naTela.renderizadas, 'o MapLibre desenhou as cinco').toBeGreaterThanOrEqual(QUANTAS);

        await page.screenshot({ path: testInfo.outputPath('barreiras-da-2.2-na-tela.png') });

        // ------------------------------------------------------------------
        // O QUE A ABA LISTA
        // ------------------------------------------------------------------
        await page.locator('.sidebar-nav-btn[data-tab="camadas"]').click();
        const itens = page.locator('.feature-item[data-feature-type="coordination_lines"]');
        await expect(itens).toHaveCount(QUANTAS, { timeout: 15000 });
        await expect(itens.first().locator('.feature-type-icon'))
            .toHaveAttribute('alt', 'Linha de Coordenação');
        for (const nome of nomes) {
            await expect(page.locator('.feature-item[data-feature-type="coordination_lines"] .feature-name',
                { hasText: nome })).toHaveCount(1);
        }

        await page.screenshot({ path: testInfo.outputPath('barreiras-da-2.2-na-aba.png') });
    });
});
