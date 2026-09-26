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
import { CENTRO, feicaoNoStore } from './cobertura-desenho.js';
import { trazerParaAreaLivre } from './cobertura-desenho-ciclo.js';

/**
 * As alças da feição dada, como `{ tipo, indice, lngLat }`: as DESENHADAS na vista (`queryRenderedFeatures`
 * nas camadas da fonte) ou, com `daFonte`, todas as que estão nos dados da fonte, dentro da vista ou não.
 */
async function lerAlcas(page, fonte, id, daFonte) {
    return page.evaluate(async ({ src, fid, todas }) => {
        const map = globalThis.__ebgeoMap;
        let brutas;
        if (todas) {
            brutas = (await map.getSource(src)?.getData?.())?.features ?? [];
        } else {
            const camadas = map.getStyle().layers.filter((l) => l.source === src).map((l) => l.id);
            if (camadas.length === 0) return [];
            brutas = map.queryRenderedFeatures({ layers: camadas });
        }
        const vistos = new Set();
        return brutas
            .filter((f) => f.properties?.featureId === fid || f.properties?.featureId === undefined)
            .map((f) => ({
                // Linha, polígono e seta numeram o `handleId` por alça (`vertex-0`, `midpoint-1`): o
                // índice sai, senão cada alça seria um tipo e o "tipo vértice" nunca apareceria.
                tipo: String(f.properties.handleId ?? f.properties.handleType ?? f.properties.meta ?? '?').replace(/-\d+$/, ''),
                indice: f.properties.index ?? null,
                lngLat: f.geometry?.type === 'Point' ? f.geometry.coordinates : null,
            }))
            .filter((a) => {
                if (!a.lngLat) return false;
                const chave = `${a.tipo}|${a.lngLat.join(',')}`;
                if (vistos.has(chave)) return false;
                vistos.add(chave);
                return true;
            });
    }, { src: fonte, fid: id, todas: daFonte });
}

/** As alças renderizadas da fonte, como `{ tipo, indice, lngLat }`, só as da feição dada. */
export async function alcasNaTela(page, fonte, id) {
    return lerAlcas(page, fonte, id, false);
}

/**
 * A alça de um tipo, DESENHADA na vista, ou null quando a fonte não tem alça desse tipo. Se a fonte a
 * tem e ela está fora da vista, o mapa é arrastado até ela (`trazerParaAreaLivre`), como a pessoa
 * faria: cada arraste traz a alça arrastada para o centro da área livre, e numa feição GRANDE as
 * outras saem do quadro. Medido na elipse com uma sonda: depois do arraste da rotação, a alça do eixo
 * vertical ficou em y = 820 num mapa de 720 px, e o tipo "sumia" (3 de 3 execuções de `forma de ellipse`).
 */
export async function alcaDoTipo(page, fonte, id, tipo) {
    const naTela = (await alcasNaTela(page, fonte, id)).find((a) => a.tipo === tipo);
    if (naTela) return naTela;
    const naFonte = (await lerAlcas(page, fonte, id, true)).find((a) => a.tipo === tipo);
    if (!naFonte) return null;
    await trazerParaAreaLivre(page, naFonte.lngLat);
    return (await alcasNaTela(page, fonte, id)).find((a) => a.tipo === tipo) ?? null;
}

/**
 * Espera a fonte ter alças da feição (a seleção as cria com um `setTimeout`). Só vê o que está
 * desenhado NA VISTA: selecionar pela árvore enquadra, e a alça fora do quadro não é achada
 * (`vistaDoDesenho` devolve a câmera antes).
 */
export async function esperarAlcas(page, fonte, id) {
    let alcas = [];
    await expect.poll(async () => {
        alcas = await alcasNaTela(page, fonte, id);
        return alcas.length;
    }, { timeout: 10000, message: `a fonte ${fonte} nao desenhou alca para ${id}` }).toBeGreaterThan(0);
    return alcas;
}

/**
 * Depois de selecionar pela árvore, espera o ENQUADRAMENTO terminar e devolve a câmera do desenho
 * (`CENTRO`, zoom 13), como a pessoa faria afastando o mapa para alcançar as alças.
 *
 * POR QUÊ: desde 2026-09-24 o clique na árvore enquadra a feição como "Zoom para Seleção"
 * (`frameFeatures`), perto do zoom 17, e este instrumento mede cada alça na câmera do desenho. Até
 * 2026-09-26 o quadro também deixava alças FORA da vista (a de rotação do texto em x = -82 px, presa
 * ao chão a meia largura mais 12 px do centro no zoom de criação); o dono decidiu naquele dia que o
 * quadro inclui as alças e desconta o painel, e é o que ele faz desde então.
 *
 * O fim do enquadramento é ESTADO: `frameFeatures` pede o quadro no mesmo turno em que a seleção cria
 * as alças (ele as lê de volta por `serialize()`, que é síncrono), ou antes, quando elas nascem num
 * `setTimeout`, então alça na fonte com a câmera parada é o quadro já terminado.
 */
export async function vistaDoDesenho(page, fonte, id) {
    await expect.poll(() => page.evaluate(async ({ src, fid }) => {
        const map = globalThis.__ebgeoMap;
        const dados = await map.getSource(src)?.getData?.();
        const temAlca = (dados?.features ?? []).some((f) => f.properties?.featureId === fid || f.properties?.featureId === undefined);
        return temAlca && !map.isMoving();
    }, { src: fonte, fid: id }), { timeout: 10000, message: `o enquadramento de ${id} nao terminou` }).toBe(true);
    await page.evaluate(async (c) => {
        const map = globalThis.__ebgeoMap;
        const ocioso = new Promise((ok) => { map.once('idle', ok); setTimeout(ok, 3000); });
        map.jumpTo({ center: c, zoom: 13 });
        map.triggerRepaint();
        await ocioso;
    }, CENTRO);
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
