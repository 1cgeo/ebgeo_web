// Path: e2e-ui/colaboracao-mista-chromium-firefox.spec.js

/**
 * @fileoverview DOIS MOTORES NO MESMO ATLAS: o dono no Chromium e o editor no Firefox.
 *
 * Metade dos usuários usa Firefox (dono, 2026-09-23), e toda spec de colaboração desta pasta abre
 * os dois clientes no MESMO navegador. O que só aparece com motores diferentes dos dois lados do
 * socket (envelope, ordem de eventos de entrada, Blob e File de cada motor, Quill e tabela de
 * atributos em Gecko contra Blink) não tinha rede nenhuma.
 *
 * O Firefox é lançado DE DENTRO do projeto chromium (`firefox.launch()`), porque um projeto do
 * Playwright tem um navegador só. Duas consequências declaradas: o caso PULA no projeto firefox (lá
 * os dois lados seriam Gecko e o caso deixaria de ser misto) e PULA sem o binário do Firefox
 * instalado (`npx playwright install firefox`), nomeando a razão; e o contexto que `openClient`
 * abre no Firefox não herda o dispositivo do config, então o motor é conferido por recurso
 * (`-moz-appearance`) e não pelo userAgent.
 *
 * Medido em 2026-09-23, uma rodada de cada caso, verde, zero erro de página nos dois lados.
 */
import { test, expect, firefox } from '@playwright/test';
import { Buffer } from 'node:buffer';
import { existsSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { readState } from './state.js';
import {
    seedSharedAtlas, openClient, drawLineUI, drawPointUI, readFeatures, pollPeerFeature, pollPeerFeatureWhere, drawMilitarySymbolUI, selectFeatureUI, renameViaPanelUI,
} from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;
/**
 * Um PNG de 64x48, escrito em disco para o seletor de arquivo da ferramenta de imagem.
 * @param {string} caminho
 * @returns {string} o mesmo caminho
 */
function escreverPng(caminho) {
    const tabela = Array.from({ length: 256 }, (_, n) => {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        return c >>> 0;
    });
    const crc = (bytes) => {
        let x = 0xffffffff;
        for (const v of bytes) x = tabela[(x ^ v) & 255] ^ (x >>> 8);
        return (x ^ 0xffffffff) >>> 0;
    };
    const bloco = (tipo, dados) => {
        const tamanho = Buffer.alloc(4);
        tamanho.writeUInt32BE(dados.length);
        const corpo = Buffer.concat([Buffer.from(tipo), dados]);
        const soma = Buffer.alloc(4);
        soma.writeUInt32BE(crc(corpo));
        return Buffer.concat([tamanho, corpo, soma]);
    };
    const w = 64, h = 48;
    const cabecalho = Buffer.alloc(13);
    cabecalho.writeUInt32BE(w, 0);
    cabecalho.writeUInt32BE(h, 4);
    cabecalho[8] = 8;
    cabecalho[9] = 2;
    const cru = Buffer.alloc((w * 3 + 1) * h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const o = y * (w * 3 + 1) + 1 + x * 3;
            cru[o] = x * 4;
            cru[o + 1] = y * 5;
            cru[o + 2] = 128;
        }
    }
    writeFileSync(caminho, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        bloco('IHDR', cabecalho), bloco('IDAT', deflateSync(cru)), bloco('IEND', Buffer.alloc(0))]));
    return caminho;
}

const CENTER = { lng: -43.2, lat: -22.9 };
const ZOOM = 13;
const canvasBox = (page) => page.locator('#map-sig .maplibregl-canvas').boundingBox();

async function moveCursorOverCanvas(page) {
    const box = await canvasBox(page);
    for (let i = 0; i < 8; i++) {
        await page.mouse.move(box.x + box.width * (0.35 + i * 0.03), box.y + box.height * (0.40 + i * 0.02));
        await page.waitForTimeout(90);
    }
}

async function expandRoster(page) {
    const toggle = page.locator('[data-testid="online-users"] [data-testid="online-users-toggle"]');
    await expect(toggle).toBeVisible({ timeout: 10000 });
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
}

function renameFeature(page, type, id, nome) {
    return page.evaluate(async (q) => {
        const store = await import('/src/js/store/index.js');
        const f = await store.getFeatureById(q.type, q.id);
        if (!f) return false;
        f.properties = { ...f.properties, nome: q.nome };
        await store.updateFeature(q.type, f);
        return true;
    }, { type, id, nome });
}

describeOrSkip('Colaboração mista Chromium + Firefox', () => {
    test.describe.configure({ retries: 0 });
    let ff;
    const temFirefox = () => existsSync(firefox.executablePath());
    test.beforeEach(({ browserName }) => {
        test.skip(browserName !== 'chromium', 'o caso é misto: o lado A é o Chromium do projeto, o B é lançado aqui');
        test.skip(!temFirefox(), 'Firefox do Playwright ausente: npx playwright install firefox');
    });
    test.beforeAll(async ({ browserName }) => {
        if (browserName === 'chromium' && temFirefox()) ff = await firefox.launch();
    });
    test.afterAll(async () => { await ff?.close(); });

    test('cursores, presença e feições nos dois sentidos, e edição concorrente converge', async ({ browser }) => {
        test.setTimeout(300000);
        const seed = await seedSharedAtlas(browser, state.baseUrl);
        const pageA = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
        const pageB = await openClient(ff, state.baseUrl, seed.atlasId, seed.userB);
        const errs = { A: [], B: [] };
        pageA.on('pageerror', (e) => errs.A.push(String(e.message)));
        pageB.on('pageerror', (e) => errs.B.push(String(e.message)));
        try {
            // CONTROLE DO INSTRUMENTO: os dois lados são mesmo motores diferentes.
            expect(await pageA.evaluate(() => CSS.supports('-moz-appearance', 'none'))).toBe(false);
            expect(await pageB.evaluate(() => CSS.supports('-moz-appearance', 'none'))).toBe(true);
            for (const page of [pageA, pageB]) {
                await page.evaluate(({ c, z }) => globalThis.__ebgeoMap.jumpTo({ center: [c.lng, c.lat], zoom: z }), { c: CENTER, z: ZOOM });
            }
            await moveCursorOverCanvas(pageA);
            await expect(pageB.locator('[data-testid="remote-cursor"]')).toHaveCount(1, { timeout: 15000 });
            await moveCursorOverCanvas(pageB);
            await expect(pageA.locator('[data-testid="remote-cursor"]')).toHaveCount(1, { timeout: 15000 });

            const lineId = await drawLineUI(pageA, [
                [CENTER.lng - 0.012, CENTER.lat - 0.006],
                [CENTER.lng + 0.004, CENTER.lat + 0.009],
                [CENTER.lng + 0.013, CENTER.lat - 0.002],
            ]);
            expect(lineId).toBeTruthy();
            await pollPeerFeature(pageB, 'lines', lineId, { timeout: 30000 });

            const pointId = await drawPointUI(pageB, [CENTER.lng + 0.003, CENTER.lat + 0.002]);
            expect(pointId).toBeTruthy();
            await pollPeerFeature(pageA, 'points', pointId, { timeout: 30000 });

            for (const page of [pageA, pageB]) {
                await expandRoster(page);
                await expect(page.locator('[data-testid="online-users"] [data-testid="online-user-item"]')).toHaveCount(1, { timeout: 15000 });
            }

            // Concurrent rename of the SAME feature from both engines: both must converge to one value.
            await Promise.all([
                renameFeature(pageA, 'lines', lineId, 'Nome do Chromium'),
                renameFeature(pageB, 'lines', lineId, 'Nome do Firefox'),
            ]);
            const nameOn = async (page) => (await readFeatures(page, 'lines')).find((f) => f.id === lineId)?.props?.nome;
            await expect.poll(async () => {
                const a = await nameOn(pageA); const b = await nameOn(pageB);
                return a && a === b ? a : `A=${a} B=${b}`;
            }, { timeout: 30000 }).toMatch(/^Nome do (Chromium|Firefox)$/);
            const server = await pageA.evaluate(async ({ id }) => {
                const { getFeatureById } = await import('/src/js/store/index.js');
                return (await getFeatureById('lines', id))?.properties?.nome;
            }, { id: lineId });
            expect(server).toMatch(/^Nome do (Chromium|Firefox)$/);

            // Firefox peer drops the connection (offline + socket closed), edits, and comes back.
            const ctxB = pageB.context();
            await ctxB.setOffline(true);
            await pageB.evaluate(async () => {
                const { wsClient } = await import('/src/js/store/sync/ws-client.js');
                wsClient._socket?.close(4000, 'network fault injection');
            });
            await renameFeature(pageB, 'points', pointId, 'Editado offline no Firefox');
            await pageB.waitForTimeout(2000);
            await ctxB.setOffline(false);
            await pollPeerFeatureWhere(pageA, 'points', pointId, (p) => p.nome === 'Editado offline no Firefox', 60000);
            expect(errs.A).toEqual([]);
            expect(errs.B).toEqual([]);
        } finally {
            await pageA.context().close();
            await pageB.context().close();
        }
    });
    test('imagem pela ferramenta real e simbolo militar: Firefox para Chromium e de volta, com os BYTES', async ({ browser }) => {
        test.setTimeout(300000);
        const PNG = escreverPng(test.info().outputPath('figura.png'));
        const seed = await seedSharedAtlas(browser, state.baseUrl);
        const pageA = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
        const pageB = await openClient(ff, state.baseUrl, seed.atlasId, seed.userB);
        const errs = { A: [], B: [] };
        pageA.on('pageerror', (e) => errs.A.push(String(e.message)));
        pageB.on('pageerror', (e) => errs.B.push(String(e.message)));
        const estado = (page, id) => page.evaluate(async (fid) => {
            const store = await import('/src/js/store/index.js');
            const blob = await store.getImage(fid);
            return { tamanho: blob?.size ?? 0, noMapa: !!globalThis.__ebgeoMap?.hasImage(fid) };
        }, id);
        async function drawImage(page) {
            const before = new Set((await readFeatures(page, 'images')).map((f) => f.id));
            await page.locator('.toolbar-group[data-group-id="draw"] .toolbar-group-btn').click();
            await page.locator('[data-tool-id="image"]').click();
            await expect(page.locator('[data-tool-id="image"]')).toHaveAttribute('data-active', 'true', { timeout: 30000 });
            const chooser = page.waitForEvent('filechooser', { timeout: 20000 });
            const box = await canvasBox(page);
            await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.45);
            await (await chooser).setFiles(PNG);
            let id = null;
            await expect.poll(async () => {
                id = (await readFeatures(page, 'images')).find((f) => !before.has(f.id))?.id ?? null;
                return id;
            }, { timeout: 30000 }).toBeTruthy();
            return id;
        }
        try {
            for (const page of [pageA, pageB]) {
                await page.evaluate(({ c, z }) => globalThis.__ebgeoMap.jumpTo({ center: [c.lng, c.lat], zoom: z }), { c: CENTER, z: ZOOM });
            }
            const imgB = await drawImage(pageB);
            await pollPeerFeature(pageA, 'images', imgB, { timeout: 30000 });
            await expect.poll(async () => (await estado(pageA, imgB)).tamanho, { timeout: 30000 }).toBeGreaterThan(0);
            const imgA = await drawImage(pageA);
            await pollPeerFeature(pageB, 'images', imgA, { timeout: 30000 });
            await expect.poll(async () => (await estado(pageB, imgA)).tamanho, { timeout: 30000 }).toBeGreaterThan(0);
            const symB = await drawMilitarySymbolUI(pageB, [CENTER.lng + 0.004, CENTER.lat - 0.002]);
            await pollPeerFeature(pageA, 'military_symbols', symB, { timeout: 30000 });
            await expect.poll(async () => pageA.evaluate((id) => !!globalThis.__ebgeoMap.hasImage(id), symB), { timeout: 30000 }).toBe(true);
            expect(errs.A).toEqual([]);
            expect(errs.B).toEqual([]);
        } finally {
            await pageA.context().close();
            await pageB.context().close();
        }
    });
    test('atributo pelo painel, célula da tabela de atributos, comentário e briefing com Quill, entre os dois motores', async ({ browser }) => {
        test.setTimeout(360000);
        const seed = await seedSharedAtlas(browser, state.baseUrl);
        const A = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
        const B = await openClient(ff, state.baseUrl, seed.atlasId, seed.userB);
        const errs = { A: [], B: [] };
        A.on('pageerror', (e) => errs.A.push(String(e.message)));
        B.on('pageerror', (e) => errs.B.push(String(e.message)));
        const nomeEm = async (page, id) => (await readFeatures(page, 'points')).find((f) => f.id === id)?.props?.nome;
        try {
            for (const page of [A, B]) {
                await page.evaluate(({ c, z }) => globalThis.__ebgeoMap.jumpTo({ center: [c.lng, c.lat], zoom: z }), { c: CENTER, z: ZOOM });
            }
            // 1. Chromium desenha e renomeia pelo PAINEL; o Firefox vê o nome novo.
            const id = await drawPointUI(A, [CENTER.lng, CENTER.lat]);
            await pollPeerFeature(B, 'points', id, { timeout: 30000 });
            await selectFeatureUI(A, id);
            await renameViaPanelUI(A, 'Posto do Chromium');
            await expect.poll(() => nomeEm(B, id), { timeout: 30000 }).toBe('Posto do Chromium');

            // 2. Firefox edita a MESMA feição pela CÉLULA da tabela de atributos; o Chromium vê.
            await B.locator('.sidebar-nav-btn[data-tab="camadas"]').click();
            await B.locator('.table-toggle').first().click();
            await expect(B.locator('.attribute-table-panel')).toBeVisible({ timeout: 20000 });
            const linha = B.locator('.attribute-table-panel tr.attribute-table-row').filter({ hasText: 'Posto do Chromium' });
            await expect(linha).toHaveCount(1, { timeout: 20000 });
            await linha.locator('td.attribute-table-cell-name').dblclick();
            const entrada = B.locator('.attribute-table-cell-input');
            await expect(entrada).toBeVisible({ timeout: 5000 });
            await entrada.fill('Posto do Firefox');
            await entrada.press('Enter');
            await expect.poll(() => nomeEm(A, id), { timeout: 30000 }).toBe('Posto do Firefox');
            await expect.poll(() => nomeEm(B, id), { timeout: 30000 }).toBe('Posto do Firefox');

            // 3. Comentário: raiz no Chromium, resposta pela tela do Firefox, e o Chromium a lê.
            const raiz = await A.evaluate(async () => {
                const store = await import('/src/js/store/index.js');
                return (await store.addComment({ lng: -43.2, lat: -22.9, text: 'Pergunta do Chromium' })).id;
            });
            await expect.poll(() => B.evaluate(async (r) => {
                const store = await import('/src/js/store/index.js');
                return Boolean((await store.getComments(await store.getCurrentMapName()))[r]);
            }, raiz), { timeout: 30000 }).toBe(true);
            await B.evaluate(async (r) => {
                const { getControl } = await import('/src/js/store/control.registry.js');
                await getControl('commentOverlay').focusComment(r);
            }, raiz);
            await B.getByTestId('comment-reply-input').fill('Resposta do Firefox, com acentuação: ção');
            await B.getByTestId('comment-reply-submit').click();
            await expect.poll(() => A.evaluate(async (r) => {
                const store = await import('/src/js/store/index.js');
                const todos = await store.getComments(await store.getCurrentMapName());
                return Object.values(todos).some((c) => c.parentId === r && String(c.text).includes('acentuação: ção'))
                    || JSON.stringify(todos).includes('acentuação: ção');
            }, raiz), { timeout: 30000 }).toBe(true);

            // 4. Briefing criado, renomeado, com slide e texto no Quill, tudo pelo Firefox.
            await B.locator('.attribute-table-panel [title="Fechar"], .attribute-table-panel .attribute-table-close-btn').first().click().catch(() => {});
            await B.locator('.sidebar-nav-btn[data-tab="briefings"]').click();
            await expect(B.locator('.briefings-create-btn')).toBeVisible({ timeout: 10000 });
            await B.locator('.briefings-create-btn').click();
            await expect(B.locator('#briefing-editor')).toBeVisible({ timeout: 10000 });
            const nome = B.locator('.briefing-editor-name-input');
            await nome.fill('Briefing do Firefox');
            await nome.blur();
            await B.locator('.briefing-editor-add-slide-btn[title="Adicionar slide"]').click();
            const editor = B.locator('.briefing-editor-quill-container .ql-editor');
            await expect(editor).toBeVisible({ timeout: 10000 });
            await editor.click();
            await B.keyboard.type('Texto do slide digitado no Firefox');
            await B.locator('.briefing-editor-back-btn').click();
            await expect.poll(() => A.evaluate(async () => {
                const store = await import('/src/js/store/index.js');
                const todos = await store.getAllBriefings();
                const b = todos.find((x) => x.name === 'Briefing do Firefox');
                return b ? (b.slides || []).map((sl) => sl.content || '').join('|') : null;
            }), { timeout: 30000 }).toContain('Texto do slide digitado no Firefox');
            expect(errs.A).toEqual([]);
            expect(errs.B).toEqual([]);
        } finally {
            await A.context().close();
            await B.context().close();
        }
    });
});
