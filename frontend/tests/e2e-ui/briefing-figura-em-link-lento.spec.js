// Path: e2e-ui/briefing-figura-em-link-lento.spec.js

/**
 * @fileoverview A FIGURA DE SLIDE NO LINK DE 40 kbps: ela chega ao colega com os bytes, e o que CUSTA
 * digitar num slide que já tem uma figura é MEDIDO.
 *
 * A figura colada num slide é um data URL dentro do HTML do slide, e o slide viaja INTEIRO na op
 * (`content`). Duas perguntas no link da missão (40 kbps, emulado por CDP só na origem do backend,
 * como em `figura-aparece-na-hora-em-link-lento.repro.spec.js`):
 *
 *   1. a figura chega ao colega com o mesmo SHA-256? (AFIRMADO);
 *   2. quanto sobe quando a pessoa DIGITA no slide depois da figura? Cada salvamento automático
 *      (1,5 s depois da última tecla) é uma op com o HTML inteiro, figura inclusive, e a fila não
 *      funde operações desde 2026-09-12. Este caso REGISTRA os POST /sync do autor (quantos, e
 *      quantos bytes) numa digitação curta, e ANOTA o número: a pergunta de desenho (a figura do
 *      slide virar blob por id, como a foto anexa na fase 2) é do dono, não deste teste.
 *
 * Rodar isolado (só Chromium, por causa do CDP):
 *   cd frontend && npx playwright test briefing-figura-em-link-lento --retries=0 --workers=1
 */

import { createHash } from 'node:crypto';
import { collabTest, expect } from './helpers/collab.fixtures.js';
import { readState } from './state.js';

collabTest.describe.configure({ retries: 0 });

const EDITOR = '.briefing-editor-slide-editor .ql-editor';
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
    collabTest('a figura chega ao colega; o custo de digitar no slide é medido', async ({ collab, browserName }) => {
        collabTest.skip(browserName !== 'chromium', 'a emulação de link é por CDP');
        collabTest.setTimeout(420000);
        const A = collab.author;
        const B = collab.peers[0];
        const { baseUrl } = readState();

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
        await cdp.send('Network.enable');
        await cdp.send('Network.emulateNetworkConditionsByRule', {
            matchedNetworkConditions: [{ urlPattern: `${baseUrl}/*`, latency: 300, downloadThroughput: 5000, uploadThroughput: 5000 }],
        });
        const envios = [];
        A.on('request', (r) => {
            if (r.method() === 'POST' && /\/sync$/.test(new URL(r.url()).pathname)) {
                envios.push({ t: Date.now(), bytes: globalThis.Buffer.byteLength(r.postData() ?? '') });
            }
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
        const tamanhoDaFigura = figura.length;
        const t0 = Date.now();

        // 1. A FIGURA CHEGA AO COLEGA.
        await expect.poll(async () => figurasDe(await conteudoNoDisco(B, bid)).map(sha), { timeout: 240000,
            message: 'a figura do slide não chegou ao colega no link de 40 kbps' }).toEqual([sha(figura)]);
        const chegada = Math.round((Date.now() - t0) / 1000);

        // 2. O CUSTO DE DIGITAR: três palavras, com pausa maior que o salvamento automático entre elas.
        const enviosAntes = envios.length;
        const inicio = Date.now();
        for (const palavra of [' alfa', ' bravo', ' charlie']) {
            await A.locator(EDITOR).click();
            await A.keyboard.press('End');
            await A.keyboard.type(palavra);
            await A.waitForTimeout(2500);
        }
        const diag = async () => ({
            autorTemTexto: (await conteudoNoDisco(A, bid)).includes('charlie'),
            fila: await A.evaluate(async () => (await import('/src/js/store/sync/operation-queue.js')).operationQueue.countByState()),
            envios: envios.map((e) => ({ s: Math.round((e.t - t0) / 1000), kb: Math.round(e.bytes / 1024) })),
        });
        console.log(`[slide em link lento] logo depois de digitar: ${JSON.stringify(await diag())}`); // SONDA
        // Espera o texto chegar ao colega, que é quando a fila do autor terminou.
        await expect.poll(async () => (await conteudoNoDisco(B, bid)).includes('charlie'), { timeout: 300000,
            message: 'o texto digitado depois da figura não chegou ao colega' }).toBe(true)
            .catch(async (e) => { console.log(`[slide em link lento] ao estourar: ${JSON.stringify(await diag())}`); throw e; }); // SONDA
        const digitacao = envios.slice(enviosAntes);
        const medida = {
            figuraCaracteres: tamanhoDaFigura,
            chegadaDaFiguraS: chegada,
            postsDaDigitacao: digitacao.length,
            bytesDaDigitacao: digitacao.reduce((s, e) => s + e.bytes, 0),
            segundosAteOColegaVerOTexto: Math.round((Date.now() - inicio) / 1000),
        };
        console.log(`[slide em link lento] ${JSON.stringify(medida)}`);
        collabTest.info().annotations.push({ type: 'custo-de-digitar-num-slide-com-figura', description: JSON.stringify(medida) });
        await cdp.detach();
    });
});
