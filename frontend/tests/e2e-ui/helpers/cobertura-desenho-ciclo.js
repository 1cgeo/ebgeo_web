// Path: e2e-ui/helpers/cobertura-desenho-ciclo.js

/**
 * @fileoverview Passos do CICLO DE VIDA de uma feição pela interface real, comuns ao spec de atlas
 * de servidor (`cobertura-desenho-ciclo.spec.js`) e ao de atlas local (`cobertura-desenho-local.spec.js`):
 * nome, descrição, atributo, mover pelo corpo, copiar e colar, desfazer e refazer.
 */

import { expect } from '@playwright/test';
import { feicaoNoStore, idsDoBalde } from './cobertura-desenho.js';

/** O painel da feição aberto. */
export function painelAberto(page) {
    return page.locator('.feature-panel[data-expanded="true"]');
}

/** Nome pelo campo do cabeçalho do painel, confirmado com Enter. */
export async function nomear(page, balde, id, nome) {
    const painel = painelAberto(page);
    await painel.locator('.feature-identification-name').click();
    const campo = painel.locator('.feature-identification-name-input:not(.feature-identification-name-input--hidden)');
    await campo.fill(nome);
    await campo.press('Enter');
    await expect.poll(async () => (await feicaoNoStore(page, balde, id))?.properties?.nome, { timeout: 10000 }).toBe(nome);
}

/** Descrição pela seção do painel, com o "Salvar" dela. */
export async function descrever(page, balde, id, texto) {
    const painel = painelAberto(page);
    await painel.locator('.feature-description-add-btn, .feature-description-edit-btn').first().click();
    await painel.locator('.feature-description-textarea').fill(texto);
    await painel.locator('.feature-description-save-btn').click();
    await expect.poll(async () => (await feicaoNoStore(page, balde, id))?.properties?.descricao ?? '', { timeout: 10000 })
        .toContain(texto);
}

/** Atributo customizado pela aba Atributos ("+", chave, valor, confirmar). */
export async function atribuir(page, balde, id, chave, valor) {
    const painel = painelAberto(page);
    await painel.locator('.feature-tab-btn[data-tab-id="atributos"]').click();
    const aba = painel.locator('.feature-tab-content[data-tab-id="atributos"]');
    await aba.locator('.feature-attributes-add-btn').click();
    const [campoChave, campoValor] = await aba.locator('.feature-attributes-inline-input').all();
    await campoChave.fill(chave);
    await campoValor.fill(valor);
    await aba.locator('.feature-attributes-inline-confirm').click();
    await expect.poll(async () => (await feicaoNoStore(page, balde, id))?.properties?.attributes?.[chave] ?? null, { timeout: 10000 })
        .toBe(valor);
}

/** Um ponto DENTRO do corpo da feição, longe das alças de vértice e de ponto médio. */
export function pontoDePega(feicao) {
    const base = feicao.properties?.baseCoordinates;
    const g = feicao.geometry;
    if (g.type === 'Point') return g.coordinates;
    const aoLongo = ([a, b]) => [a[0] + (b[0] - a[0]) * 0.3, a[1] + (b[1] - a[1]) * 0.3];
    if (Array.isArray(base) && base.length >= 2 && Array.isArray(base[0]) && typeof base[0][0] === 'number') return aoLongo(base);
    if (g.type === 'LineString') return aoLongo(g.coordinates);
    if (g.type === 'MultiLineString') return aoLongo(g.coordinates[0]);
    const anel = g.type === 'Polygon' ? g.coordinates[0] : g.coordinates[0][0];
    const pts = anel.slice(0, -1);
    return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
}

/**
 * Centraliza uma coordenada na parte do mapa que o painel da feição NÃO cobre, sem animação, e devolve
 * o pixel de página dela. O arraste exige a feição SELECIONADA (`_startDrag`, `move_handler.js`), e a
 * seleção abre o painel, que ocupa a faixa esquerda: medido em 2026-09-24, a pega de uma linha no
 * centro do mapa caía sob `.feature-panel-content` e o clique nunca chegava ao canvas.
 *
 * E ESPERA O MAPA FICAR OCIOSO depois do deslocamento: o texto é camada de SÍMBOLO, e o índice de
 * colisão dos símbolos só é refeito no quadro seguinte, então um acerto logo depois do `panBy` não
 * acha o texto (medido: zero feições renderizadas na camada de texto e o menu de contexto sem
 * "Copiar Feição").
 */
export async function trazerParaAreaLivre(page, ll) {
    return page.evaluate(async (c) => {
        const map = globalThis.__ebgeoMap;
        const r = map.getCanvas().getBoundingClientRect();
        const painel = document.querySelector('.feature-panel[data-expanded="true"]')?.getBoundingClientRect();
        const esquerda = painel && painel.right > r.left ? Math.min(painel.right, r.right - 200) : r.left;
        const alvo = { x: (esquerda + r.right) / 2, y: r.top + r.height / 2 };
        const pt = map.project(c);
        const ocioso = new Promise((ok) => { map.once('idle', ok); setTimeout(ok, 3000); });
        map.panBy([r.left + pt.x - alvo.x, r.top + pt.y - alvo.y], { animate: false });
        map.triggerRepaint();
        await ocioso;
        const depois = map.project(c);
        return { x: r.left + depois.x, y: r.top + depois.y };
    }, ll);
}

/** Arrasta a feição selecionada pelo corpo, com o ponteiro real, e espera a geometria mudar. */
export async function moverPeloCorpo(page, balde, id) {
    const antes = await feicaoNoStore(page, balde, id);
    const p = await trazerParaAreaLivre(page, pontoDePega(antes));
    // O que está sob o ponteiro no instante da pega, e o que está selecionado: é o que nomeia a causa
    // quando o arraste não pega (alça por cima, outra feição, o painel), em vez de um "não moveu" mudo.
    const sob = await page.evaluate(async ({ x, y }) => {
        const map = globalThis.__ebgeoMap;
        const r = map.getCanvas().getBoundingClientRect();
        const cx = x - r.left;
        const cy = y - r.top;
        const topo = document.elementFromPoint(x, y);
        const linhas = map.queryRenderedFeatures([[cx - 4, cy - 4], [cx + 4, cy + 4]])
            .map((f) => `${f.source}:${f.properties?.id ?? f.properties?.handleType ?? '?'}`);
        const s = await import('/src/js/store/index.js');
        const sel = s.getControl('ClipboardManager')?.selectionManager?.getAllSelectedFeatures?.()
            ?.map((f) => f.properties?.id) ?? 'sem-gerente';
        return { topo: topo ? `${topo.tagName}.${topo.className}` : null, linhas: [...new Set(linhas)], sel };
    }, p);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x + 30, p.y + 15, { steps: 5 });
    await page.mouse.move(p.x + 60, p.y + 30, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => JSON.stringify((await feicaoNoStore(page, balde, id))?.geometry), {
        timeout: 15000, message: `o arraste nao moveu a feicao ${id}; sob o ponteiro: ${JSON.stringify(sob)}`,
    }).not.toBe(JSON.stringify(antes.geometry));
}

/** Ctrl+C e Ctrl+V com a feição selecionada; devolve o id da cópia. */
export async function copiarEColar(page, balde, id) {
    const antes = new Set(await idsDoBalde(page, balde));
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');
    let copia = null;
    await expect.poll(async () => {
        copia = (await idsDoBalde(page, balde)).find((x) => !antes.has(x)) ?? null;
        return copia;
    }, { timeout: 15000, message: `Ctrl+V nao criou a copia de ${id}` }).toBeTruthy();
    return copia;
}

/** Desfazer e refazer pelos botões da barra (a mesma porta do Ctrl+Z / Ctrl+Y). */
export async function desfazer(page) {
    await page.locator('.toolbar-standalone-btn[data-tool-id="undo"]').dispatchEvent('click');
}
export async function refazer(page) {
    await page.locator('.toolbar-standalone-btn[data-tool-id="redo"]').dispatchEvent('click');
}
