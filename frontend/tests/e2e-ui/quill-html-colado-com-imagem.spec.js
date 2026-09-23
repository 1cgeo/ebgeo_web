// Path: e2e-ui/quill-html-colado-com-imagem.spec.js

/**
 * A QUARTA PORTA DE IMAGEM DO EDITOR, e a única que não tinha prova em navegador.
 *
 * HTML colado que já traz `<img src="data:...">` (uma figura copiada de uma página) NÃO passa pelo
 * módulo `uploader` do Quill: ele entra por `Clipboard.convert`, que é síncrono e insere o `data:`
 * cru. Até 2026-09-20 essa porta só recusava por BYTES, então uma figura abaixo de 5 MB entrava
 * inteira no HTML do slide, sem compressão e sem teto de pixels, e o slide viaja por op de sync.
 * `createPastedImageMatcher` (`src/js/utilities/quill-helpers.js`) hoje retira TODA figura
 * embutida do Delta síncrono e a devolve pelo mesmo caminho assíncrono de um arquivo colado.
 *
 * O que este arquivo mede é o DESFECHO no DOM do editor real, montado por `createQuillEditor`
 * dentro da página do app (é o mesmo construtor que o editor de briefing chama). Os unitários de
 * `tests/unit/colagem-de-imagem-no-quill.test.js` prendem a parte pura e a fiação por texto de
 * fonte; nenhum dos dois prova que o Quill de verdade chama o matcher numa colagem de verdade.
 *
 * O TAMANHO do resultado não é asserido de propósito: a entrada do primeiro caso é RUÍDO, que JPEG
 * não comprime, e o que a porta deve é o re-encode e o limite de dimensão, não uma taxa.
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

/**
 * Um PNG válido gerado em memória.
 * @param {number} width
 * @param {number} height
 * @param {boolean} ruido - RGB com ruído (não comprime) ou cinza sólido (comprime três ordens)
 */
function png(width, height, ruido) {
    const canais = ruido ? 3 : 1;
    const ihdr = B.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = ruido ? 2 : 0;
    const linha = width * canais + 1;
    const raw = B.alloc(linha * height, 0x80);
    if (ruido) {
        let s = 12345;
        for (let i = 0; i < raw.length; i++) {
            s = (s * 1103515245 + 12345) & 0x7fffffff;
            raw[i] = s & 0xff;
        }
    }
    for (let y = 0; y < height; y++) raw[y * linha] = 0;
    return B.concat([
        B.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
        chunk('IEND', B.alloc(0)),
    ]);
}

const EDITOR = '#quill-colagem-host .ql-editor';

async function montarEditor(page) {
    await page.goto('/');
    await expect(page.locator('#nav-btn-zoom-in')).toBeAttached({ timeout: 20000 });
    await page.evaluate(async () => {
        const { createQuillEditor } = await import('/src/js/utilities/quill-helpers.js');
        const caixa = document.createElement('div');
        caixa.id = 'quill-colagem-host';
        document.body.appendChild(caixa);
        await createQuillEditor(caixa, { placeholder: 'cole aqui' });
    });
    await expect(page.locator(EDITOR)).toBeAttached();
}

function colarHtml(page, html) {
    return page.evaluate(({ seletor, conteudo }) => {
        const alvo = document.querySelector(seletor);
        alvo.focus();
        const dt = new DataTransfer();
        dt.setData('text/html', conteudo);
        dt.setData('text/plain', 'texto');
        const paste = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
        // Firefox ignores the constructor's clipboardData; make the test payload explicit.
        Object.defineProperty(paste, 'clipboardData', { value: dt });
        if (paste.clipboardData.getData('text/html') !== conteudo) throw new Error('Paste fixture lost its HTML');
        alvo.dispatchEvent(paste);
    }, { seletor: EDITOR, conteudo: html });
}

describeOrSkip('HTML colado com imagem embutida (Quill real, Chromium real)', () => {
    test.describe.configure({ retries: 0 });

    test('a figura abaixo do teto de bytes entra RE-ENCODADA e limitada, e o texto colado fica', async ({ page }) => {
        await montarEditor(page);
        const src = `data:image/png;base64,${png(1200, 900, true).toString('base64')}`;
        await colarHtml(page, `<p>antes da figura</p><img src="${src}"><p>depois da figura</p>`);

        const img = page.locator(`${EDITOR} img`);
        await expect(img).toHaveCount(1, { timeout: 15000 });
        const medida = await img.evaluate((el) => ({
            prefixo: el.getAttribute('src').slice(0, 23),
            maior: Math.max(el.naturalWidth, el.naturalHeight),
        }));
        // Entrou PNG de 1200x900; o que fica é o JPEG que a casa gerou, dentro de 800x600. Se o
        // matcher deixar a figura no Delta síncrono, o prefixo continua `data:image/png`.
        expect(medida.prefixo).toBe('data:image/jpeg;base64,');
        expect(medida.maior).toBeLessThanOrEqual(800);
        await expect(page.locator(EDITOR)).toContainText('antes da figura');
        await expect(page.locator(EDITOR)).toContainText('depois da figura');
    });

    test('pequena em bytes e ENORME em pixels é recusada com a frase, e nada entra', async ({ page }) => {
        await montarEditor(page);
        const bomba = png(9000, 2000, false);
        // O controle do próprio caso: a figura passa folgada no teto de BYTES, então quem a recusa
        // só pode ser o teto de PIXELS, que esta porta não tinha.
        expect(bomba.length).toBeLessThan(100 * 1024);
        await colarHtml(page, `<p>texto que fica</p><img src="data:image/png;base64,${bomba.toString('base64')}">`);

        await expect(page.locator('.toast', { hasText: '9000 x 2000 px' })).toBeVisible({ timeout: 15000 });
        await expect(page.locator(`${EDITOR} img`)).toHaveCount(0);
        await expect(page.locator(EDITOR)).toContainText('texto que fica');
    });

    test('SVG embutido é recusado por TIPO, antes de qualquer decode', async ({ page }) => {
        await montarEditor(page);
        const svg = B.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>1</script></svg>');
        await colarHtml(page, `<p>x</p><img src="data:image/svg+xml;base64,${svg.toString('base64')}">`);

        await expect(page.locator('.toast', { hasText: 'tipo de arquivo não suportado' }))
            .toBeVisible({ timeout: 15000 });
        await expect(page.locator(`${EDITOR} img`)).toHaveCount(0);
    });

    test('SVG na grafia SEM `;base64` (percent-encoded) também é recusado, e não fica no slide', async ({ page }) => {
        // É a forma mais comum de SVG embutido numa página, e era lida como "não embute bytes",
        // no mesmo ramo de `https://`: ficava no Delta colado inteira, sem teto nenhum.
        await montarEditor(page);
        const svg = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
        await colarHtml(page, `<p>x</p><img src="data:image/svg+xml,${svg}">`);

        await expect(page.locator('.toast', { hasText: 'tipo de arquivo não suportado' }))
            .toBeVisible({ timeout: 15000 });
        await expect(page.locator(`${EDITOR} img`)).toHaveCount(0);
    });

    test('se o editor SAI DA PÁGINA antes de a figura ficar pronta, nada é inserido e a pessoa é avisada', async ({ page }) => {
        // O reenvio é assíncrono (um tick mais o decode). No editor de briefing, trocar de slide
        // nesse intervalo esvazia o container: o Quill antigo sai da página mas continua VIVO, e
        // um insert nele disparava o `text-change` que gravava o HTML do slide novo no antigo.
        await montarEditor(page);
        const src = `data:image/png;base64,${png(1200, 900, true).toString('base64')}`;
        await page.evaluate(({ seletor, conteudo }) => {
            const alvo = document.querySelector(seletor);
            globalThis.__editorAntigo = alvo;
            alvo.focus();
            const dt = new DataTransfer();
            dt.setData('text/html', conteudo);
            dt.setData('text/plain', 'texto');
            const paste = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
            // Firefox ignores the constructor's clipboardData; make the test payload explicit.
            Object.defineProperty(paste, 'clipboardData', { value: dt });
            if (paste.clipboardData.getData('text/html') !== conteudo) throw new Error('Paste fixture lost its HTML');
            alvo.dispatchEvent(paste);
            // SÍNCRONO com a colagem, antes de o tick do reenvio rodar: é a troca de slide.
            document.querySelector('#quill-colagem-host').replaceChildren();
        }, { seletor: EDITOR, conteudo: `<p>slide A</p><img src="${src}">` });

        await expect(page.locator('.toast', { hasText: 'A imagem não foi inserida' }))
            .toBeVisible({ timeout: 15000 });
        const imagensNoAntigo = await page.evaluate(
            () => globalThis.__editorAntigo.querySelectorAll('img').length,
        );
        expect(imagensNoAntigo).toBe(0);
    });
});
