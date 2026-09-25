// Path: e2e-ui/briefing-figura-em-link-lento.spec.js

/**
 * @fileoverview A FIGURA DE SLIDE NO LINK DE 40 kbps chega ao colega com os mesmos bytes.
 *
 * A figura colada num slide é um data URL dentro do HTML do slide, e o slide viaja INTEIRO na op
 * (`content`). No link da missão (40 kbps, emulado por CDP só na origem do backend e só no autor,
 * como em `figura-aparece-na-hora-em-link-lento.repro.spec.js`), a figura colada tem de chegar ao
 * colega com o mesmo SHA-256. O caso também confere o instrumento: a chegada não pode ser mais
 * rápida que o link permite, senão o estrangulamento não pegou e o verde seria de um link normal.
 *
 * A digitação no slide DEPOIS da figura NÃO é afirmada aqui: cada salvamento automático reenvia o
 * HTML inteiro, figura inclusive, e esse custo é do produto, registrado no item 3 de
 * `PENDENCIAS-LANCAMENTO.md` à espera da decisão do dono sobre a figura por referência.
 *
 * Rodar isolado (só Chromium, por causa do CDP):
 *   cd frontend && npx playwright test briefing-figura-em-link-lento --retries=0 --workers=1
 */

import { createHash } from 'node:crypto';
import { collabTest, expect } from './helpers/collab.fixtures.js';

collabTest.describe.configure({ retries: 0 });

const EDITOR = '.briefing-editor-slide-editor .ql-editor';
/** Bytes per second of the emulated link, both ways. */
const LINK_BPS = 5000;
const sha = (t) => createHash('sha256').update(t).digest('hex');
const figurasDe = (html) => [...String(html ?? '').matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);

const lerTodosBriefings = (page) => page.evaluate(async () => {
    const store = await import('/src/js/store/index.js');
    return (await store.getAllBriefings()).map((b) => b.id);
});

const conteudoNoDisco = (page, bid) => page.evaluate(async (id) => {
    const store = await import('/src/js/store/index.js');
    return ((await store.getBriefingById(id))?.slides ?? [])[0]?.content ?? '';
}, bid);

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
    collabTest('a figura colada no slide chega ao colega com o mesmo SHA-256', async ({ collab, browserName }) => {
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
                figura = figurasDe(await conteudoNoDisco(A, bid))[0] ?? null;
                return figura;
            }, { timeout: 20000 }).not.toBeNull();
            const t0 = Date.now();

            await expect.poll(async () => figurasDe(await conteudoNoDisco(B, bid)).map(sha), { timeout: 240000,
                message: 'a figura do slide não chegou ao colega no link de 40 kbps' }).toEqual([sha(figura)]);
            const chegadaMs = Date.now() - t0;
            console.log(`[slide em link lento] figura de ${figura.length} caracteres chegou ao colega em ${Math.round(chegadaMs / 1000)} s`);

            // The op carries at least the data URL, so on the emulated link it cannot arrive in less
            // than figura.length / LINK_BPS seconds. Half of that is the floor: a faster arrival
            // means the throttle rule matched nothing and the case measured a normal link.
            expect(chegadaMs, 'a figura chegou mais rápido que o link de 40 kbps permite: o estrangulamento não pegou')
                .toBeGreaterThan((figura.length / LINK_BPS) * 1000 * 0.5);
        } finally {
            await cdp.detach().catch(() => {});
        }
    });
});
