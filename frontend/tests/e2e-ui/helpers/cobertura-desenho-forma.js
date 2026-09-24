// Path: e2e-ui/helpers/cobertura-desenho-forma.js

/**
 * @fileoverview Instrumentos das ALÇAS DE EDIÇÃO das ferramentas de desenho (campanha de cobertura de
 * 2026-09-24), sem tabela de alças escrita à mão: o que a ferramenta desenha na fonte de alças dela
 * (`alcaDeEdicao` do registro, `alca` em `FERRAMENTAS`) é o que se exercita.
 *
 * O tipo de uma alça é `handleId ?? handleType ?? meta` sem o índice final (`vertex-0` vira `vertex`):
 * retângulo e elipse nomeiam por `handleId`, linha, polígono e seta numeram o `handleId` por alça, e
 * limite e linha de coordenação só têm `handleType`.
 */

import { expect } from '@playwright/test';
import { feicaoNoStore } from './cobertura-desenho.js';
import { trazerParaAreaLivre } from './cobertura-desenho-ciclo.js';

/** As alças renderizadas da fonte, como `{ tipo, indice, lngLat }`, só as da feição dada. */
export async function alcasNaTela(page, fonte, id) {
    return page.evaluate(({ src, fid }) => {
        const map = globalThis.__ebgeoMap;
        const camadas = map.getStyle().layers.filter((l) => l.source === src).map((l) => l.id);
        if (camadas.length === 0) return [];
        const vistos = new Set();
        return map.queryRenderedFeatures({ layers: camadas })
            .filter((f) => f.properties?.featureId === fid || f.properties?.featureId === undefined)
            .map((f) => ({
                // Linha, polígono e seta numeram o `handleId` por alça (`vertex-0`, `midpoint-1`): o
                // índice sai, senão cada alça seria um tipo e o "tipo vértice" nunca apareceria.
                tipo: String(f.properties.handleId ?? f.properties.handleType ?? f.properties.meta ?? '?').replace(/-\d+$/, ''),
                indice: f.properties.index ?? null,
                lngLat: f.geometry.type === 'Point' ? f.geometry.coordinates : null,
            }))
            .filter((a) => {
                if (!a.lngLat) return false;
                const chave = `${a.tipo}|${a.lngLat.join(',')}`;
                if (vistos.has(chave)) return false;
                vistos.add(chave);
                return true;
            });
    }, { src: fonte, fid: id });
}

/** Espera a fonte ter alças da feição (a seleção as cria com um `setTimeout`). */
export async function esperarAlcas(page, fonte, id) {
    let alcas = [];
    await expect.poll(async () => {
        alcas = await alcasNaTela(page, fonte, id);
        return alcas.length;
    }, { timeout: 10000, message: `a fonte ${fonte} nao desenhou alca para ${id}` }).toBeGreaterThan(0);
    return alcas;
}

/** O retrato comparável de uma feição do store: propriedades e geometria em texto. */
async function retrato(page, balde, id) {
    const f = await feicaoNoStore(page, balde, id);
    return f ? JSON.stringify({ p: f.properties, g: f.geometry }) : null;
}

/**
 * Arrasta uma alça pelo ponteiro real, trazendo-a antes para a área que o painel não cobre, e devolve
 * se o store da feição mudou.
 */
export async function arrastarAlca(page, balde, id, alca, deslocamento = { dx: 35, dy: 20 }) {
    const antes = await retrato(page, balde, id);
    const p = await trazerParaAreaLivre(page, alca.lngLat);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x + deslocamento.dx / 2, p.y + deslocamento.dy / 2, { steps: 4 });
    await page.mouse.move(p.x + deslocamento.dx, p.y + deslocamento.dy, { steps: 4 });
    await page.mouse.up();
    try {
        await expect.poll(() => retrato(page, balde, id), { timeout: 8000 }).not.toBe(antes);
        return true;
    } catch {
        return false;
    }
}

/** Botão direito sobre uma alça (remover vértice), e devolve se o store mudou. */
export async function botaoDireitoNaAlca(page, balde, id, alca) {
    const antes = await retrato(page, balde, id);
    const p = await trazerParaAreaLivre(page, alca.lngLat);
    await page.mouse.click(p.x, p.y, { button: 'right' });
    try {
        await expect.poll(() => retrato(page, balde, id), { timeout: 8000 }).not.toBe(antes);
        return true;
    } catch {
        return false;
    }
}

/** Quantos vértices a feição tem, pelo eixo guardado (`baseCoordinates`) ou pela geometria. */
export async function verticesDaFeicao(page, balde, id) {
    const f = await feicaoNoStore(page, balde, id);
    let base = f?.properties?.baseCoordinates;
    if (typeof base === 'string') base = JSON.parse(base);
    if (Array.isArray(base) && Array.isArray(base[0]) && typeof base[0][0] === 'number') return base.length;
    const g = f?.geometry;
    if (g?.type === 'LineString') return g.coordinates.length;
    if (g?.type === 'Polygon') return g.coordinates[0].length - 1;
    return null;
}

/** A última coordenada do eixo guardado, para posicionar a continuação pela ponta. */
export async function pontaFinal(page, balde, id) {
    const f = await feicaoNoStore(page, balde, id);
    let base = f?.properties?.baseCoordinates;
    if (typeof base === 'string') base = JSON.parse(base);
    if (Array.isArray(base) && base.length > 0) return base[base.length - 1];
    const g = f.geometry;
    return g.type === 'LineString' ? g.coordinates[g.coordinates.length - 1] : null;
}
