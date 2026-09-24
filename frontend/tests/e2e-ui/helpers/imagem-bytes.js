// Path: tests/e2e-ui/helpers/imagem-bytes.js

/**
 * @fileoverview O QUE UM SPEC DE IMAGEM PRECISA PARA MEDIR BYTES, E NÃO PRESENÇA.
 *
 * Três lições já pagas por esta suíte moram aqui, para que o próximo spec de imagem não as pague
 * de novo:
 *
 *   1. `map.hasImage(id)` é VERDADEIRO também quando o blob falhou: o 404 instala o placeholder de
 *      erro (64 por 64, um X vermelho) sob o MESMO id (`browser-collab-imagem-retomada.spec.js`).
 *      Por isso {@link desenhoNoMapa} devolve a LARGURA e o pixel central do bitmap registrado, e
 *      as figuras de teste têm {@link LADO} pixels, que não é 64.
 *   2. O sinal de que o servidor tem os bytes é `store.getImage(id)`, que cai no servidor quando o
 *      cache local erra. {@link impressaoDoBlob} devolve o SHA-256 do blob, então comparar a
 *      impressão da cópia com a do original prova BYTES IGUAIS, não "algum blob".
 *   3. A figura nasce pela FERRAMENTA real (seletor de arquivo), porque é ela que re-encoda por
 *      canvas e decide o MIME que sobe. Uma feição montada à mão mede outra porta.
 */

import { expect } from '@playwright/test';
import { esperarFerramentaPronta } from './ferramenta-pronta.js';
import { clicarNoMapaUI, readFeatures } from './collab-helpers.js';

/** Lado das figuras de teste, em pixels. O placeholder de erro tem 64, então 24 os separa. */
export const LADO = 24;

/**
 * Uma figura sólida de `cor`, codificada pelo canvas DO NAVEGADOR no tipo pedido.
 *
 * Gerar no navegador e não em node é o que permite JPEG e WebP sem biblioteca de imagem: o
 * codificador é o do próprio navegador, o mesmo que a ferramenta usa ao re-encodar.
 * @param {import('@playwright/test').Page} page
 * @param {[number, number, number]} cor
 * @param {{ lado?: number, tipo?: string, qualidade?: number, largura?: number, altura?: number }} [opcoes]
 * @returns {Promise<Buffer>}
 */
export async function figuraSolida(page, cor, { lado = LADO, tipo = 'image/png', qualidade = 0.95, largura, altura } = {}) {
    const b64 = await page.evaluate(async ({ c, w, h, t, q }) => {
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
        ctx.fillRect(0, 0, w, h);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, t, q));
        if (!blob || blob.type !== t) throw new Error(`o canvas nao codificou ${t} (devolveu ${blob?.type})`);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let s = '';
        for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(s);
    }, { c: cor, w: largura ?? lado, h: altura ?? lado, t: tipo, q: qualidade });
    return globalThis.Buffer.from(b64, 'base64');
}

/** O centro da vista corrente do mapa, onde a ferramenta clica quando nada é pedido. */
export const centroDoMapa = (page) => page.evaluate(() => {
    const c = globalThis.__ebgeoMap.getCenter();
    return [c.lng, c.lat];
});

/**
 * Ativa a ferramenta de imagem, clica no mapa e entrega o arquivo ao seletor, como a pessoa faz.
 * @param {import('@playwright/test').Page} page
 * @param {{ name: string, mimeType: string, buffer: Buffer }} arquivo
 * @param {[number, number]} [lngLat] - Onde a figura nasce (padrão: o centro da vista)
 * @returns {Promise<string>} O id da feição criada (que é também o id do blob)
 */
export async function porImagemPelaFerramenta(page, arquivo, lngLat) {
    const alvo = lngLat ?? await centroDoMapa(page);
    const antes = new Set((await readFeatures(page, 'images')).map((f) => f.id));
    const grupo = page.locator('.toolbar-group[data-group-id="draw"]');
    await grupo.locator('.toolbar-group-btn').click();
    await expect(grupo.locator('.toolbar-popup')).toHaveAttribute('data-visible', 'true', { timeout: 5000 });
    await grupo.locator('.toolbar-tool-btn[data-tool-id="image"]').click();
    await esperarFerramentaPronta(page, 'image');

    const seletor = page.waitForEvent('filechooser', { timeout: 10000 });
    await clicarNoMapaUI(page, alvo);
    await (await seletor).setFiles(arquivo);

    let nova = null;
    await expect.poll(async () => {
        nova = (await readFeatures(page, 'images')).find((f) => !antes.has(f.id))?.id ?? null;
        return nova;
    }, { timeout: 20000, message: 'a ferramenta de imagem nao criou feicao' }).not.toBeNull();
    return nova;
}

/**
 * Tipo, tamanho, SHA-256 e pixel central do blob sob `id`, lido por `store.getImage` (que cai no
 * servidor quando o cache local erra). `null` quando nenhum dos dois tem o blob.
 * @param {import('@playwright/test').Page} page
 * @param {string} id
 * @returns {Promise<{ type: string, size: number, sha: string, w: number, h: number, pixel: number[], local: boolean }|null>}
 */
export function impressaoDoBlob(page, id) {
    return page.evaluate(async (fid) => {
        const store = await import('/src/js/store/index.js');
        const blob = await store.getImage(fid);
        if (!blob || !blob.size) return null;
        const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
        const sha = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0);
        const [r, g, b] = ctx.getImageData(bitmap.width >> 1, bitmap.height >> 1, 1, 1).data;
        return {
            type: blob.type, size: blob.size, sha, w: bitmap.width, h: bitmap.height,
            pixel: [r, g, b], local: await store.hasImage(fid),
        };
    }, id);
}

/**
 * O que o MAPA registrou sob `id`: largura do bitmap e pixel central (RGBA). O placeholder de erro
 * tem 64 de largura e um X vermelho no centro, então largura {@link LADO} com a cor da figura é
 * a figura de verdade.
 * @param {import('@playwright/test').Page} page
 * @param {string} id
 * @returns {Promise<{ registrada: boolean, largura: number|null, pixel: number[]|null }>}
 */
export function desenhoNoMapa(page, id) {
    return page.evaluate((fid) => {
        const map = globalThis.__ebgeoMap;
        const bruta = map?.getImage?.(fid) ?? null;
        const bitmap = bruta?.data ?? null;
        const largura = bitmap?.width ?? null;
        const altura = bitmap?.height ?? null;
        let pixel = null;
        if (bitmap?.data && largura && altura) {
            const i = (Math.floor(altura / 2) * largura + Math.floor(largura / 2)) * 4;
            pixel = [bitmap.data[i], bitmap.data[i + 1], bitmap.data[i + 2], bitmap.data[i + 3]];
        }
        return { registrada: !!map?.hasImage?.(fid), largura, pixel };
    }, id);
}

/** Distância máxima por canal entre duas cores (JPEG e gerência de cor mexem poucas unidades). */
export const distanciaDeCor = (a, b) => Math.max(...a.slice(0, 3).map((v, i) => Math.abs(v - b[i])));

/**
 * Espera o mapa desenhar a figura `id` com a cor `cor`, e devolve a última leitura.
 * @param {import('@playwright/test').Page} page
 * @param {string} id
 * @param {[number, number, number]} cor
 * @param {{ timeout?: number, tolerancia?: number, rotulo?: string }} [opcoes]
 */
export async function esperarDesenho(page, id, cor, { timeout = 20000, tolerancia = 12, rotulo = '' } = {}) {
    let ultima = null;
    await expect.poll(async () => {
        ultima = await desenhoNoMapa(page, id);
        return ultima.largura === LADO && ultima.pixel !== null && distanciaDeCor(ultima.pixel, cor) <= tolerancia;
    }, { timeout, message: `${rotulo} o mapa nao desenha a figura ${id} (ultima leitura abaixo)` }).toBe(true)
        .catch((erro) => { throw new Error(`${erro.message}\n${JSON.stringify(ultima)}`); });
    return ultima;
}

/**
 * A linha de `images` sob `id` no Postgres, ou `null`.
 * @param {{ raw: import('pg-promise').IDatabase }} db
 * @param {string} id
 */
export const linhaDeImagem = (db, id) => db.raw.oneOrNone(
    'SELECT id, atlas_id, mime_type, size_bytes FROM images WHERE id = $1', [id]);
