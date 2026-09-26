// Path: e2e-ui/briefing-figura-em-link-lento.spec.js

/**
 * @fileoverview A FIGURA DE SLIDE NO LINK DE 40 kbps SOBE UMA VEZ, e o texto escrito ao lado dela
 * chega ao colega.
 *
 * Até 2026-09-26 a figura colada num slide era um data URL dentro do HTML do slide, e o slide viaja
 * INTEIRO na op: três palavras digitadas ao lado de uma figura viraram 8 envios com o HTML inteiro
 * (2,4 MB, cerca de 8 minutos), e em 5 minutos o colega não tinha o texto. Este arquivo afirmava só a
 * chegada da figura, por decisão do dono de 2026-09-25, enquanto a figura por referência não vinha.
 * Ela veio (decisão de 2026-09-26, no diário de decisões): os bytes sobem pela fila de blob, e o HTML
 * guarda `https://figura.ebgeo/<id>`. Agora o caso afirma as duas metades, no link da missão
 * (emulado por CDP só na origem do backend e só no autor, como em
 * `figura-aparece-na-hora-em-link-lento.repro.spec.js`):
 *
 *   1. os bytes da figura chegam ao colega com o mesmo SHA-256;
 *   2. as três palavras digitadas logo depois dela chegam ao colega, e nenhum envio do `/sync` do
 *      autor carrega a figura (a soma dos corpos é medida e tem teto).
 *
 * O caso também confere o instrumento: os bytes não podem chegar mais rápido que o link permite,
 * senão o estrangulamento não pegou e o verde seria de um link normal.
 *
 * Rodar isolado (só Chromium, por causa do CDP):
 *   cd frontend && npx playwright test briefing-figura-em-link-lento --retries=0 --workers=1
 */

import { collabTest, expect } from './helpers/collab.fixtures.js';
import { figurasDoSlide, conteudoDoSlide } from './helpers/figura-de-slide.js';

collabTest.describe.configure({ retries: 0 });

const EDITOR = '.briefing-editor-slide-editor .ql-editor';
/** Bytes per second of the emulated link, both ways. */
const LINK_BPS = 5000;
/** Teto da soma dos corpos do `/sync` do autor depois da figura: o texto, nunca a figura. */
const TETO_DO_SYNC = 60000;

const lerTodosBriefings = (page) => page.evaluate(async () => {
    const store = await import('/src/js/store/index.js');
    return (await store.getAllBriefings()).map((b) => b.id);
});

/** Uma foto de 800 x 600 (o teto do re-encode) com textura, em PNG, codificada pelo navegador. */
async function foto(page) {
    const b64 = await page.evaluate(async () => {
        const c = document.createElement('canvas');
        c.width = 800;
        c.height = 600;
        const ctx = c.getContext('2d');
        const img = ctx.createImageData(800, 600);
        let s = 3;
        for (let i = 0; i < img.data.length; i += 4) {
            s = (s * 1103515245 + 12345) & 0x7fffffff;
            const r = (s / 0x7fffffff) * 60;
            const p = i / 4;
            img.data[i] = (p % 800) / 4 + r; img.data[i + 1] = (p / 800) / 3 + r; img.data[i + 2] = 100 + r; img.data[i + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
        const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/png'));
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let out = '';
        for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(out);
    });
    return globalThis.Buffer.from(b64, 'base64');
}

collabTest.describe('Figura de slide no link de 40 kbps', () => {
    collabTest('a figura sobe uma vez, e o texto ao lado dela chega ao colega', async ({ collab, browserName }) => {
        collabTest.skip(browserName !== 'chromium', 'a emulação de link é por CDP');
        collabTest.setTimeout(360000);
        const A = collab.author;
        const B = collab.peers[0];

        const antes = new Set(await lerTodosBriefings(A));
        if (!(await A.locator('.briefings-create-btn').isVisible())) await A.locator('.sidebar-nav-btn[data-tab="briefings"]').click();
        await A.locator('.briefings-create-btn').click();
        await expect(A.locator(EDITOR)).toBeVisible({ timeout: 10000 });
        let bid = null;
        await expect.poll(async () => {
            bid = (await lerTodosBriefings(A)).find((b) => !antes.has(b)) ?? null;
            return bid;
        }, { timeout: 10000 }).toBeTruthy();
        // O slide existe no colega antes de o link cair, para que a espera abaixo meça a FIGURA.
        await expect.poll(async () => (await lerTodosBriefings(B)).includes(bid), { timeout: 30000 }).toBe(true);

        const corpos = [];
        A.on('request', (r) => {
            if (r.method() === 'POST' && /\/sync$/.test(new URL(r.url()).pathname)) corpos.push(r.postData()?.length ?? 0);
        });

        // O LINK DE 40 kbps, só no autor e só na origem do backend.
        const cdp = await A.context().newCDPSession(A);
        try {
            await cdp.send('Network.enable');
            await cdp.send('Network.emulateNetworkConditionsByRule', {
                matchedNetworkConditions: [{ urlPattern: `${collab.baseUrl}/*`, latency: 300, downloadThroughput: LINK_BPS, uploadThroughput: LINK_BPS }],
            });

            const png = await foto(A);
            await A.evaluate(({ seletor, conteudo }) => {
                const editor = document.querySelector(seletor);
                editor.focus();
                const dt = new DataTransfer();
                dt.setData('text/html', conteudo);
                dt.setData('text/plain', 'x');
                const paste = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
                Object.defineProperty(paste, 'clipboardData', { value: dt });
                editor.dispatchEvent(paste);
            }, { seletor: EDITOR, conteudo: `<p>Figura</p><img src="data:image/png;base64,${png.toString('base64')}">` });
            let figura = null;
            await expect.poll(async () => {
                figura = (await figurasDoSlide(A, bid))[0] ?? null;
                return figura?.sha ?? null;
            }, { timeout: 20000 }).not.toBeNull();
            const t0 = Date.now();

            // Três palavras ao lado da figura, logo depois dela.
            await A.locator(EDITOR).click();
            await A.keyboard.press('Control+End');
            await A.keyboard.type(' tres palavras depois');

            await expect.poll(async () => (await figurasDoSlide(B, bid))[0]?.sha ?? null, { timeout: 240000,
                message: 'os bytes da figura não chegaram ao colega no link de 40 kbps' }).toBe(figura.sha);
            const chegadaMs = Date.now() - t0;
            await expect.poll(async () => (await conteudoDoSlide(B, bid)).includes('tres palavras depois'), { timeout: 120000,
                message: 'o texto digitado ao lado da figura não chegou ao colega' }).toBe(true);
            const textoMs = Date.now() - t0;
            const somaDoSync = corpos.reduce((a, b) => a + b, 0);
            console.log(`[slide em link lento] figura de ${figura.bytes} bytes no colega em ${Math.round(chegadaMs / 1000)} s; `
                + `texto em ${Math.round(textoMs / 1000)} s; ${corpos.length} envios do /sync somando ${somaDoSync} bytes`);

            // O instrumento: os bytes sobem em base64, então não chegam em menos de bytes / LINK_BPS
            // segundos; metade disso é o piso. Mais rápido que isso, o estrangulamento não pegou.
            expect(chegadaMs, 'a figura chegou mais rápido que o link de 40 kbps permite: o estrangulamento não pegou')
                .toBeGreaterThan((figura.bytes / LINK_BPS) * 1000 * 0.5);
            // O defeito: cada envio carregava a figura. Hoje nenhum carrega.
            expect(somaDoSync, 'os envios do /sync ainda carregam a figura').toBeLessThan(TETO_DO_SYNC);
            expect(somaDoSync, 'nenhum envio medido: o instrumento não viu a op do texto').toBeGreaterThan(0);
        } finally {
            await cdp.detach().catch(() => {});
        }
    });
});
