// Path: e2e-ui/helpers/figura-de-slide.js

/**
 * @fileoverview As figuras de um slide, lidas como os specs de figura precisam desde 2026-09-26.
 *
 * A figura de slide passou a ser uma REFERÊNCIA (decisão do dono daquela data): o HTML do slide
 * guarda `https://figura.ebgeo/<id>` e os bytes moram no banco de imagens do atlas
 * (`frontend/src/js/briefing/figura-de-slide.js`). Os specs que conferiam a figura pelo SHA do data
 * URL dentro do HTML passam a conferir os BYTES, lidos do banco de imagens da página por `getImage`
 * (que cai no servidor e guarda, como a tela faz). Comparar SHA de bytes entre autor e colega é o
 * mesmo veredito de antes, agora sobre o que viaja de fato.
 */

/** O sentinela de uma figura no HTML do slide, com o id capturado. */
export const SENTINELA = /https:\/\/figura\.ebgeo\/([A-Za-z0-9-]{8,64})/g;

/** Os ids das figuras de um HTML, na ordem. */
export function idsDasFiguras(html) {
    return [...String(html ?? '').matchAll(SENTINELA)].map((m) => m[1]);
}

/** O `content` do slide `indice` do briefing `bid`, lido do disco da página. */
export function conteudoDoSlide(page, bid, indice = 0) {
    return page.evaluate(async ({ id, i }) => {
        const store = await import('/src/js/store/index.js');
        return ((await store.getBriefingById(id))?.slides ?? [])[i]?.content ?? '';
    }, { id: bid, i: indice });
}

/**
 * Os bytes de cada figura de um HTML, pela porta da tela (`getImage`): SHA-256, tamanho e o data URL
 * (para decodificar). Uma figura cujos bytes a página não consegue ter sai com `sha: null`.
 * @returns {Promise<Array<{id: string, sha: (string|null), bytes: number, dataUrl: (string|null)}>>}
 */
export function bytesDasFiguras(page, html) {
    return page.evaluate(async (ids) => {
        const store = await import('/src/js/store/index.js');
        const saida = [];
        for (const id of ids) {
            const blob = await store.getImage(id).catch(() => null);
            if (!blob) {
                saida.push({ id, sha: null, bytes: 0, dataUrl: null });
                continue;
            }
            const buffer = await blob.arrayBuffer();
            const hash = await crypto.subtle.digest('SHA-256', buffer);
            const dataUrl = await new Promise((resolve) => {
                const leitor = new FileReader();
                leitor.onload = () => resolve(leitor.result);
                leitor.readAsDataURL(blob);
            });
            saida.push({
                id,
                sha: [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join(''),
                bytes: buffer.byteLength,
                dataUrl,
            });
        }
        return saida;
    }, idsDasFiguras(html));
}

/** Atalho: os bytes das figuras do slide `indice` do briefing `bid`, na página. */
export async function figurasDoSlide(page, bid, indice = 0) {
    return bytesDasFiguras(page, await conteudoDoSlide(page, bid, indice));
}
