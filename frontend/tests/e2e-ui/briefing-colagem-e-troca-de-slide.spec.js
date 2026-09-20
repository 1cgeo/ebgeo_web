// Path: e2e-ui/briefing-colagem-e-troca-de-slide.spec.js

/**
 * COLAR UMA FIGURA E TROCAR DE SLIDE ANTES DE ELA FICAR PRONTA, no editor de briefing REAL.
 *
 * A figura embutida em HTML colado é reenviada de forma ASSÍNCRONA (um tick mais o decode), para
 * passar pela compressão e pelo teto de pixels. Trocar de slide nesse intervalo esvazia o
 * container do editor: o Quill do slide A sai da página mas continua VIVO com o ouvinte de
 * `text-change`, e esse ouvinte lia `this._quillEditor`, que já era o editor do slide B. O insert
 * tardio gravava então o HTML do slide B DENTRO do slide A, e o autosave persistia e sincronizava.
 *
 * `quill-html-colado-com-imagem.spec.js` prova a guarda no componente montado sozinho. Este
 * arquivo prova o que importa para a pessoa, no hospedeiro: depois da corrida, cada slide tem o
 * PRÓPRIO texto, e nenhum tem o do outro. A leitura é do STORE, depois do autosave, porque o
 * defeito era justamente o que ficava gravado, não o que aparecia na tela.
 */

import { test, expect } from '@playwright/test';
import zlib from 'node:zlib';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;
const B = globalThis.Buffer;

function crc32(buf) {
    let c = ~0;
    for (const b of buf) {
        c ^= b;
        for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return (~c) >>> 0;
}

function chunk(type, data) {
    const len = B.alloc(4);
    len.writeUInt32BE(data.length);
    const td = B.concat([B.from(type, 'ascii'), data]);
    const crc = B.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return B.concat([len, td, crc]);
}

/** PNG RGB com ruído: não comprime, então o decode leva tempo bastante para a corrida existir. */
function pngRuido(width, height) {
    const ihdr = B.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = 2;
    const linha = width * 3 + 1;
    const raw = B.alloc(linha * height);
    let s = 987654;
    for (let i = 0; i < raw.length; i++) {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        raw[i] = (s >> 8) & 0xff;
    }
    for (let y = 0; y < height; y++) raw[y * linha] = 0;
    return B.concat([
        B.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(raw, { level: 1 })),
        chunk('IEND', B.alloc(0)),
    ]);
}

const EDITOR = '.briefing-editor-quill-container .ql-editor';
const CARTOES = '.briefing-editor-slide-list [data-slide-id]';

describeOrSkip('briefing: colar figura e trocar de slide no meio (editor real)', () => {
    test.describe.configure({ retries: 0 });

    test('cada slide fica com o PRÓPRIO conteúdo, e nenhum recebe o do outro', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#nav-btn-zoom-in')).toBeAttached({ timeout: 20000 });

        await page.locator('.sidebar-nav-btn[data-tab="briefings"]').click();
        await page.locator('.briefings-create-btn').click();
        await expect(page.locator('.briefing-editor-slide-list')).toBeVisible({ timeout: 15000 });

        // Dois slides, cada um com um texto que o identifica.
        const adicionar = page.locator('.briefing-editor-add-slide-btn[title="Adicionar slide"]');
        while (await page.locator(CARTOES).count() < 2) {
            const antes = await page.locator(CARTOES).count();
            await adicionar.click();
            await expect(page.locator(CARTOES)).toHaveCount(antes + 1, { timeout: 10000 });
        }
        const [idA, idB] = await page.locator(CARTOES).evaluateAll((els) => els.map((e) => e.dataset.slideId));

        await page.locator(`[data-slide-id="${idB}"]`).click();
        await expect(page.locator(EDITOR)).toBeVisible();
        await page.locator(EDITOR).click();
        await page.keyboard.type('TEXTO-DO-SLIDE-B');

        await page.locator(`[data-slide-id="${idA}"]`).click();
        await expect(page.locator(EDITOR)).toBeVisible();
        await expect(page.locator(EDITOR)).not.toContainText('TEXTO-DO-SLIDE-B');
        await page.locator(EDITOR).click();
        await page.keyboard.type('TEXTO-DO-SLIDE-A');

        // A INTERCALAÇÃO PERDEDORA É TORNADA DETERMINÍSTICA. Medido em 2026-09-20: nesta máquina o
        // decode de 1600x1200 termina ANTES de o editor do slide B existir, então a corrida crua
        // não acontece e o caso passava VERDE com os dois consertos retirados, provando nada. O
        // `onload` de toda `Image` criada daqui em diante é atrasado em 1,5 s, o que garante a
        // ordem que interessa: o editor de B já está montado quando a figura de A fica pronta.
        await page.evaluate(() => {
            const Original = globalThis.Image;
            globalThis.Image = function ImagemLenta(...args) {
                const img = new Original(...args);
                Object.defineProperty(img, 'onload', {
                    configurable: true,
                    set(fn) {
                        img.addEventListener('load', (e) => setTimeout(() => fn.call(img, e), 1500));
                    },
                });
                return img;
            };
        });

        // A CORRIDA: cola HTML com figura embutida em A e, no MESMO turno, clica no cartão de B.
        const src = `data:image/png;base64,${pngRuido(1600, 1200).toString('base64')}`;
        await page.evaluate(({ seletor, conteudo, alvoB }) => {
            const editor = document.querySelector(seletor);
            editor.focus();
            const dt = new DataTransfer();
            dt.setData('text/html', conteudo);
            dt.setData('text/plain', 'x');
            editor.dispatchEvent(new ClipboardEvent('paste', {
                clipboardData: dt, bubbles: true, cancelable: true,
            }));
            document.querySelector(`[data-slide-id="${alvoB}"]`).click();
        }, { seletor: EDITOR, conteudo: `<p>COLADO-EM-A</p><img src="${src}">`, alvoB: idB });

        // B está na tela, com o texto DELE.
        await expect(page.locator(EDITOR)).toContainText('TEXTO-DO-SLIDE-B', { timeout: 15000 });
        // O aviso é OBSERVADO desde já e asserido por último: o conteúdo gravado é a asserção que
        // nomeia o defeito, e ela tem de ser a primeira a reprovar quando ele voltar.
        const viuAviso = page.locator('.toast', { hasText: 'A imagem não foi inserida' })
            .waitFor({ state: 'visible', timeout: 15000 }).then(() => true, () => false);
        // 1,5 s do `onload` atrasado, mais o autosave de 1,5 s, mais folga.
        await page.waitForTimeout(5000);

        const gravado = await page.evaluate(async ({ a, b }) => {
            const store = await import('/src/js/store/index.js');
            const todos = await store.getAllBriefings();
            const slides = todos.flatMap((br) => br.slides ?? []);
            const de = (id) => slides.find((s) => s.id === id)?.content ?? '';
            return { a: de(a), b: de(b) };
        }, { a: idA, b: idB });

        // O defeito era exatamente este cruzamento: o HTML de B gravado dentro de A.
        expect(gravado.a, 'o slide A não pode conter o texto do slide B').not.toContain('TEXTO-DO-SLIDE-B');
        expect(gravado.a).toContain('TEXTO-DO-SLIDE-A');
        expect(gravado.b).toContain('TEXTO-DO-SLIDE-B');
        expect(gravado.b, 'o slide B não pode conter o texto do slide A').not.toContain('TEXTO-DO-SLIDE-A');
        // A pessoa é AVISADA de que a figura não entrou: ela saiu do Delta colado e não volta.
        expect(await viuAviso, 'o aviso de figura não inserida apareceu').toBe(true);
    });
});
