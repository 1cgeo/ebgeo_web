// Path: e2e-ui/helpers/cobertura-desenho.js

/**
 * @fileoverview Instrumentos da campanha de cobertura das FERRAMENTAS DE DESENHO (2026-09-24).
 *
 * Três peças, e as três passam pela interface real:
 *
 * 1. `FERRAMENTAS`: a lista das ferramentas de desenho e geometria, com o gesto de desenho de cada
 *    uma. A lista é conferida contra a barra do produto (`toolbar/toolbar.constants.js`) por
 *    `tests/unit/cobertura-desenho-lista.test.js`, para que uma ferramenta nova não fique fora da
 *    campanha calada.
 * 2. `desenhar`: abre o grupo da barra, ativa a ferramenta, espera o gerente publicá-la ativa e faz
 *    o gesto em coordenadas de MAPA (projetadas no instante do clique), devolvendo o id da feição.
 * 3. `camposDeEstilo` / `mudarCampo`: enumeram e acionam os controles da aba Estilo do painel da
 *    feição pelo tipo de controle (deslizante, alternância, seleção, cor, grade de botões), sem
 *    tabela de rótulos escrita à mão: o que o painel desenha é o que se exercita.
 */

import { expect } from '@playwright/test';
import { esperarFerramentaPronta } from './ferramenta-pronta.js';
import { clicarNoMapaUI } from './collab-helpers.js';

/** Centro dos desenhos: longe das bordas, dos painéis e da régua. */
export const CENTRO = [-43.2, -22.9];

/** Os três pontos do gesto, em torno do centro, em zoom 13. */
const P = [[-43.215, -22.905], [-43.2, -22.895], [-43.185, -22.905]];

/** A diagonal do gesto de dois cliques: um retângulo de altura zero é recusado pela ferramenta. */
const DIAGONAL = [[-43.215, -22.91], [-43.19, -22.89]];

/**
 * As ferramentas de desenho e geometria. `gesto`: `clique` (um clique), `par` (dois cliques),
 * `vertices` (dois cliques e o terceiro com o botão direito, que termina), `traco` (arraste). `tipo` é o
 * `feature_type` do servidor (o `properties.source` da feição). `alca` é a fonte de alças de edição do
 * registro (`alcaDeEdicao` em `tool_manager/tool-registry.js`), ou null quando a ferramenta não tem alça.
 * Imagem (escolha de arquivo) e Azimute e Distância (painel de pernas) têm specs próprios.
 */
export const FERRAMENTAS = Object.freeze([
    { id: 'point', tipo: 'point', grupo: 'draw', balde: 'points', gesto: 'clique', controle: 'pointControl', alca: null },
    { id: 'line', tipo: 'line', grupo: 'draw', balde: 'lines', gesto: 'vertices', controle: 'lineControl', alca: 'line-edit-handles' },
    { id: 'polygon', tipo: 'polygon', grupo: 'draw', balde: 'polygons', gesto: 'vertices', controle: 'polygonControl', alca: 'polygon-edit-handles' },
    { id: 'rectangle', tipo: 'rectangle', grupo: 'draw', balde: 'rectangles', gesto: 'par', controle: 'rectangleControl', alca: 'rectangle-edit-handles' },
    { id: 'circle', tipo: 'circle', grupo: 'draw', balde: 'circles', gesto: 'par', controle: 'circleControl', alca: 'circle-edit-handles' },
    { id: 'ellipse', tipo: 'ellipse', grupo: 'draw', balde: 'ellipses', gesto: 'par', controle: 'ellipseControl', alca: 'ellipse-edit-handles' },
    { id: 'text', tipo: 'text', grupo: 'draw', balde: 'texts', gesto: 'clique', controle: 'textControl', alca: 'text-edit-handles' },
    { id: 'brush', tipo: 'brush', grupo: 'draw', balde: 'brushes', gesto: 'traco', controle: 'brushControl', alca: null },
    { id: 'sector', tipo: 'sector', grupo: 'draw', balde: 'setores', gesto: 'par', controle: 'sectorControl', alca: 'sector-edit-handles' },
    { id: 'arrow', tipo: 'arrow', grupo: 'military', balde: 'arrows', gesto: 'vertices', controle: 'arrowControl', alca: 'arrow-edit-handles' },
    { id: 'boundary', tipo: 'boundary', grupo: 'military', balde: 'boundarys', gesto: 'vertices', controle: 'boundaryControl', alca: 'boundary-edit-handles' },
    { id: 'occupiedFront', tipo: 'occupied_front', grupo: 'military', balde: 'occupied_fronts', gesto: 'par', controle: 'occupiedFrontControl', alca: 'occupied-front-edit-handles' },
    { id: 'coordinationLine', tipo: 'coordination_line', grupo: 'military', balde: 'coordination_lines', gesto: 'vertices', controle: 'coordinationLineControl', alca: 'coordination-line-edit-handles' },
]);

/** Ids das feições de um balde do mapa corrente. */
export async function idsDoBalde(page, balde) {
    return page.evaluate(async (b) => {
        const s = await import('/src/js/store/index.js');
        const f = await s.getCurrentMapFeatures();
        return (f[b] ?? []).map((x) => x.properties?.id);
    }, balde);
}

/** Propriedades e geometria de uma feição do store da página, ou null. */
export async function feicaoNoStore(page, balde, id) {
    return page.evaluate(async ({ b, fid }) => {
        const s = await import('/src/js/store/index.js');
        const f = await s.getCurrentMapFeatures();
        const achada = (f[b] ?? []).find((x) => x.properties?.id === fid);
        return achada ? JSON.parse(JSON.stringify({ properties: achada.properties, geometry: achada.geometry })) : null;
    }, { b: balde, fid: id });
}

/** Abre o grupo da barra (idempotente) e ativa a ferramenta, esperando o gerente. */
export async function ativarFerramenta(page, { id, grupo }) {
    const popup = page.locator(`.toolbar-group[data-group-id="${grupo}"] .toolbar-popup`);
    if ((await popup.getAttribute('data-visible')) !== 'true') {
        await page.locator(`.toolbar-group[data-group-id="${grupo}"] .toolbar-group-btn`).click();
    }
    await expect(popup).toHaveAttribute('data-visible', 'true', { timeout: 10000 });
    await page.locator(`.toolbar-group[data-group-id="${grupo}"] .toolbar-tool-btn[data-tool-id="${id}"]`).click();
    await esperarFerramentaPronta(page, id);
}

/**
 * Desenha uma feição com a ferramenta real e devolve o id dela.
 * @param {import('@playwright/test').Page} page
 * @param {typeof FERRAMENTAS[number]} ferramenta
 * @returns {Promise<string>}
 */
export async function desenhar(page, ferramenta) {
    const antes = new Set(await idsDoBalde(page, ferramenta.balde));
    await page.evaluate((c) => globalThis.__ebgeoMap.jumpTo({ center: c, zoom: 13 }), CENTRO);
    await ativarFerramenta(page, ferramenta);
    switch (ferramenta.gesto) {
    case 'clique':
        await clicarNoMapaUI(page, P[1]);
        break;
    case 'par':
        await clicarNoMapaUI(page, DIAGONAL[0]);
        await clicarNoMapaUI(page, DIAGONAL[1]);
        break;
    case 'vertices':
        await clicarNoMapaUI(page, P[0]);
        await clicarNoMapaUI(page, P[1]);
        await clicarNoMapaUI(page, P[2], { button: 'right' });
        break;
    case 'traco': {
        const px = (ll) => page.evaluate((p) => {
            const map = globalThis.__ebgeoMap;
            const r = map.getCanvas().getBoundingClientRect();
            const pt = map.project(p);
            return { x: r.left + pt.x, y: r.top + pt.y };
        }, ll);
        const [a, b, c] = [await px(P[0]), await px(P[1]), await px(P[2])];
        await page.mouse.move(a.x, a.y);
        await page.mouse.down();
        await page.mouse.move(b.x, b.y, { steps: 8 });
        await page.mouse.move(c.x, c.y, { steps: 8 });
        await page.mouse.up();
        break;
    }
    default:
        throw new Error(`gesto desconhecido: ${ferramenta.gesto}`);
    }
    let id = null;
    await expect.poll(async () => {
        id = (await idsDoBalde(page, ferramenta.balde)).find((x) => !antes.has(x)) ?? null;
        return id;
    }, { timeout: 20000, message: `a ferramenta ${ferramenta.id} nao criou feicao` }).toBeTruthy();
    await page.keyboard.press('Escape');
    return id;
}

/** Seletores dos tipos de controle da aba Estilo, e o rótulo de cada um. */
const TIPOS = Object.freeze({
    deslizante: { raiz: '.attr-modern-slider', rotulo: '.attr-modern-slider-label' },
    alternancia: { raiz: '.attr-modern-toggle', rotulo: '.attr-modern-toggle-label' },
    selecao: { raiz: '.attr-modern-select', rotulo: '.attr-modern-select-label' },
    cor: { raiz: '.color-picker-circles', rotulo: '.color-picker-circles-header' },
    tracejado: { raiz: '.attr-modern-line-style', rotulo: '.attr-modern-line-style-label' },
    alinhamento: { raiz: '.attr-modern-alignment', rotulo: '.attr-modern-alignment-label' },
    hachura: { raiz: '.attr-modern-hatch', rotulo: '.attr-modern-hatch-label' },
});

/** A aba Estilo do painel aberto. */
function abaEstilo(page) {
    return page.locator('.feature-panel[data-expanded="true"] .feature-tab-content[data-tab-id="estilo"]');
}

/**
 * Os controles VISÍVEIS e HABILITADOS da aba Estilo, como `{ tipo, rotulo, ordem }` (a ordem
 * desempata rótulos repetidos do mesmo tipo, como as duas "Correção de Zoom" do ponto).
 */
export async function camposDeEstilo(page) {
    const aba = abaEstilo(page);
    await expect(aba).toBeVisible({ timeout: 10000 });
    const campos = [];
    for (const [tipo, { raiz, rotulo }] of Object.entries(TIPOS)) {
        const lista = await aba.locator(raiz).evaluateAll((els, sel) => els.map((el) => ({
            rotulo: el.querySelector(sel)?.textContent?.trim() ?? '',
            visivel: el.offsetParent !== null,
            // Desabilitado pelo PRODUTO (ex.: o alinhamento de um texto de uma linha só): fora da
            // lista, porque não há gesto a fazer, e não é defeito.
            desabilitado: el.classList.contains('attr-modern-slider-disabled')
                || !!el.querySelector('input:disabled, select:disabled')
                || (el.querySelectorAll('button').length > 0
                    && [...el.querySelectorAll('button')].every((b) => b.disabled)),
        })), rotulo);
        const vistos = new Map();
        for (const item of lista) {
            const ordem = vistos.get(item.rotulo) ?? 0;
            vistos.set(item.rotulo, ordem + 1);
            if (item.visivel && !item.desabilitado) campos.push({ tipo, rotulo: item.rotulo, ordem });
        }
    }
    return campos;
}

/** Aciona um controle da aba Estilo, trocando o valor para outro válido. */
export async function mudarCampo(page, { tipo, rotulo, ordem }) {
    const { raiz, rotulo: selRotulo } = TIPOS[tipo];
    const alvo = abaEstilo(page).locator(raiz).filter({ has: page.locator(selRotulo, { hasText: rotulo }) }).nth(ordem);
    await expect(alvo).toBeVisible({ timeout: 10000 });
    switch (tipo) {
    case 'deslizante': {
        const trilho = alvo.locator('.attr-modern-slider-track');
        const { min, max, valor, passo } = await trilho.evaluate((el) => ({
            min: Number(el.min), max: Number(el.max), valor: Number(el.value), passo: Number(el.step) || 1,
        }));
        // Um valor válido e DIFERENTE: o meio da faixa, ou um passo acima do meio se já estiver lá.
        let novo = Math.round(((min + max) / 2) / passo) * passo;
        if (Math.abs(novo - valor) < passo / 2) novo = Math.min(max, novo + passo);
        const campo = alvo.locator('.attr-modern-slider-input');
        if (await campo.count()) {
            await campo.fill(String(Number(novo.toFixed(4))));
            await campo.press('Tab');
        } else {
            await trilho.evaluate((el, v) => {
                el.value = String(v);
                el.dispatchEvent(new Event('input', { bubbles: true }));
            }, novo);
        }
        return;
    }
    case 'alternancia':
        await alvo.locator('.attr-modern-toggle-switch').click({ timeout: 5000 });
        return;
    case 'selecao': {
        const sel = alvo.locator('.attr-modern-select-input');
        const opcoes = await sel.evaluate((el) => ({ atual: el.value, todas: [...el.options].map((o) => o.value) }));
        const outra = opcoes.todas.find((v) => v !== opcoes.atual);
        if (outra !== undefined) await sel.selectOption(outra);
        return;
    }
    case 'cor': {
        // Pela entrada de cor nativa do próprio controle (o botão "Cor personalizada"), que é o
        // mesmo caminho de `recolorViaPanelUI`: um círculo da grade pode ser a cor atual numa
        // grafia diferente, e o clique nele não muda nada.
        const nativo = alvo.locator('.color-picker-native-hidden');
        if (await nativo.count()) {
            const atual = String(await nativo.first().inputValue().catch(() => '')).toLowerCase();
            const nova = atual === '#3a7bd5' ? '#d53a7b' : '#3a7bd5';
            await nativo.first().evaluate((el, valor) => {
                el.value = valor;
                el.dispatchEvent(new Event('change', { bubbles: true }));
            }, nova);
            return;
        }
        const atual = await alvo.locator('.color-picker-circle.selected, .color-picker-circle.active, .color-picker-circle[aria-pressed="true"]')
            .first().getAttribute('data-color').catch(() => null);
        const circulos = alvo.locator('.color-picker-circle[data-color]:not(.color-picker-custom-btn)');
        const n = await circulos.count();
        for (let i = 0; i < n; i++) {
            const cor = await circulos.nth(i).getAttribute('data-color');
            if (cor && cor !== atual) { await circulos.nth(i).click(); return; }
        }
        return;
    }
    default: {
        // Grade de botões (tracejado, alinhamento, hachura): o primeiro que não está ativo.
        const botoes = alvo.locator('button');
        const n = await botoes.count();
        for (let i = 0; i < n; i++) {
            const ativo = await botoes.nth(i).evaluate((b) => /active|selected/.test(b.className)
                || b.getAttribute('aria-pressed') === 'true');
            if (!ativo) { await botoes.nth(i).click({ timeout: 5000 }); return; }
        }
    }
    }
}

/** Chaves de escrituração que cada cliente carimba por conta própria. */
export const ESCRITURACAO = Object.freeze(['confirmedVersion', 'version', 'createdAt', 'updatedAt', 'sync']);

/** As propriedades sem a escrituração, para comparar clientes e servidor. */
export function semEscrituracao(props) {
    const copia = { ...(props ?? {}) };
    for (const chave of ESCRITURACAO) delete copia[chave];
    return copia;
}

/** As chaves de propriedade cujo valor mudou entre dois retratos. */
export function chavesMudadas(antes, depois) {
    const a = semEscrituracao(antes);
    const d = semEscrituracao(depois);
    return [...new Set([...Object.keys(a), ...Object.keys(d)])]
        .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(d[k]))
        .sort();
}
