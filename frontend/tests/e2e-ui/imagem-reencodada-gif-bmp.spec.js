// Path: e2e-ui/imagem-reencodada-gif-bmp.spec.js

/**
 * GIF E BMP NA FERRAMENTA DE IMAGEM: o que entra, o que fica guardado e o que sobe.
 *
 * As duas portas que RE-ENCODAM por canvas (a ferramenta de imagem e o arrastar e soltar) aceitam
 * GIF e BMP desde 2026-09-20 (`allowReencodable`, `src/js/utilities/image_utils.js`), porque o
 * servidor nunca vê o arquivo original, só o que o canvas devolve. Três afirmações dessa decisão
 * estavam escritas e NÃO medidas, e este arquivo mede as três:
 *
 *   1. GIF ANIMADO VIRA O PRIMEIRO QUADRO. Dois quadros sólidos de cores diferentes: o blob
 *      guardado tem de ser da cor do PRIMEIRO. Comparar com a cor do segundo é o que torna o caso
 *      capaz de reprovar; "é uma imagem" passaria com qualquer quadro.
 *   2. BMP ENTRA PELO NAVEGADOR, não só pelo portão unitário.
 *   3. O BLOB RE-ENCODADO SOBE. A tabela `images` tem CHECK de MIME (png, jpeg, webp), então um
 *      `image/gif` com o nome errado seria recusado pelo banco. A linha lida do Postgres, com
 *      `mime_type` e `size_bytes` iguais aos do blob local, é a prova de ponta a ponta.
 *
 * Os dois codificadores abaixo existem porque a suíte não pode depender de arquivo binário
 * versionado nem de biblioteca de imagem. O de GIF usa o LZW "sem compressão": um CLEAR a cada
 * dois pixels impede a tabela de crescer, então todo código tem três bits.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { esperarFerramentaPronta } from './helpers/ferramenta-pronta.js';
import { clicarNoMapaUI, readFeatures, seedSharedAtlas, openClient } from './helpers/collab-helpers.js';
import { createDb } from './helpers/db.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;
const B = globalThis.Buffer;

const VERMELHO = [220, 30, 30];
const AZUL = [30, 30, 220];
const VERDE = [30, 200, 60];

/** Sub-blocos de dados de imagem GIF para `pixels` índices de paleta, com código fixo de 3 bits. */
function lzwSemCompressao(pixels) {
    const CLEAR = 4;
    const EOI = 5;
    const codigos = [];
    for (let i = 0; i < pixels.length; i += 2) {
        codigos.push(CLEAR, pixels[i]);
        if (i + 1 < pixels.length) codigos.push(pixels[i + 1]);
    }
    codigos.push(EOI);

    const bytes = [];
    let acumulado = 0;
    let bits = 0;
    for (const c of codigos) {
        acumulado |= c << bits;
        bits += 3;
        while (bits >= 8) {
            bytes.push(acumulado & 0xff);
            acumulado >>= 8;
            bits -= 8;
        }
    }
    if (bits > 0) bytes.push(acumulado & 0xff);

    const blocos = [];
    for (let i = 0; i < bytes.length; i += 255) {
        const parte = bytes.slice(i, i + 255);
        blocos.push(B.from([parte.length, ...parte]));
    }
    blocos.push(B.from([0]));
    return B.concat(blocos);
}

/** GIF89a animado: um quadro sólido por cor de `quadros`, na ordem. */
function gifAnimado(lado, quadros) {
    const paleta = B.alloc(12);
    quadros.forEach((cor, i) => paleta.set(cor, (i + 1) * 3));
    const le16 = (n) => [n & 0xff, n >> 8];

    const partes = [
        B.from('GIF89a', 'ascii'),
        B.from([...le16(lado), ...le16(lado), 0x91, 0, 0]),
        paleta,
        B.from([0x21, 0xff, 0x0b]), B.from('NETSCAPE2.0', 'ascii'), B.from([3, 1, 0, 0, 0]),
    ];
    quadros.forEach((_, i) => {
        partes.push(B.from([0x21, 0xf9, 4, 0x04, ...le16(50), 0, 0]));
        partes.push(B.from([0x2c, 0, 0, 0, 0, ...le16(lado), ...le16(lado), 0]));
        partes.push(B.from([2]));
        partes.push(lzwSemCompressao(new Array(lado * lado).fill(i + 1)));
    });
    partes.push(B.from([0x3b]));
    return B.concat(partes);
}

/** BMP de 24 bits, sólido. A largura é múltipla de 4, então não há preenchimento de linha. */
function bmpSolido(largura, altura, [r, g, b]) {
    const dados = largura * altura * 3;
    const buf = B.alloc(54 + dados);
    buf.write('BM', 0, 'ascii');
    buf.writeUInt32LE(54 + dados, 2);
    buf.writeUInt32LE(54, 10);
    buf.writeUInt32LE(40, 14);
    buf.writeInt32LE(largura, 18);
    buf.writeInt32LE(altura, 22);
    buf.writeUInt16LE(1, 26);
    buf.writeUInt16LE(24, 28);
    buf.writeUInt32LE(dados, 34);
    for (let i = 54; i < buf.length; i += 3) {
        buf[i] = b;
        buf[i + 1] = g;
        buf[i + 2] = r;
    }
    return buf;
}

async function esperarMapa(page) {
    await expect(page.locator('#nav-btn-zoom-in')).toBeAttached({ timeout: 20000 });
    await page.waitForFunction(() => globalThis.__ebgeoMap && globalThis.__ebgeoMap.loaded(), null, { timeout: 20000 });
    await page.waitForTimeout(400);
}

/** Ativa a ferramenta, clica no mapa e entrega `arquivo` ao seletor. Devolve a feição criada. */
async function porImagem(page, arquivo) {
    const antes = (await readFeatures(page, 'images')).length;
    const grupo = page.locator('.toolbar-group[data-group-id="draw"]');
    await grupo.locator('.toolbar-group-btn').click();
    await expect(grupo.locator('.toolbar-popup')).toHaveAttribute('data-visible', 'true', { timeout: 5000 });
    await grupo.locator('.toolbar-tool-btn[data-tool-id="image"]').click();
    await esperarFerramentaPronta(page, 'image');

    const seletor = page.waitForEvent('filechooser', { timeout: 10000 });
    await clicarNoMapaUI(page, [-53.4, -30.0]);
    await (await seletor).setFiles(arquivo);

    await expect.poll(async () => (await readFeatures(page, 'images')).length, { timeout: 15000 })
        .toBe(antes + 1);
    const todas = await readFeatures(page, 'images');
    return todas[todas.length - 1];
}

/** Tipo, tamanho e pixel central do blob que a loja guardou sob `imageId`. */
function blobGuardado(page, imageId) {
    return page.evaluate(async (id) => {
        const store = await import('/src/js/store/index.js');
        const blob = await store.getImage(id);
        if (!blob) return null;
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0);
        const [r, g, b] = ctx.getImageData(bitmap.width >> 1, bitmap.height >> 1, 1, 1).data;
        return { type: blob.type, size: blob.size, w: bitmap.width, h: bitmap.height, pixel: [r, g, b] };
    }, imageId);
}

/** Distância máxima por canal: o re-encode é PNG (sem perda), mas o gerenciador de cor pode mexer uma unidade. */
const perto = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i]))) <= 3;

describeOrSkip('GIF e BMP pela ferramenta de imagem (Chromium real, backend real)', () => {
    test.describe.configure({ retries: 0 });

    test('GIF ANIMADO entra, vira o PRIMEIRO quadro e fica guardado como PNG', async ({ page }) => {
        await page.goto('/');
        await esperarMapa(page);
        const gif = gifAnimado(16, [VERMELHO, AZUL]);

        // Controle do INSTRUMENTO, antes do gesto: o próprio Chromium decodifica este GIF e o vê
        // com DOIS quadros. Sem isto, um codificador que só emitisse um quadro faria o caso passar
        // provando nada sobre animação.
        const quadros = await page.evaluate(async (b64) => {
            const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
            const decoder = new ImageDecoder({ data: bytes.buffer, type: 'image/gif' });
            await decoder.tracks.ready;
            return decoder.tracks.selectedTrack.frameCount;
        }, gif.toString('base64'));
        expect(quadros).toBe(2);

        const feicao = await porImagem(page, { name: 'animado.gif', mimeType: 'image/gif', buffer: gif });
        const guardado = await blobGuardado(page, feicao.id);
        expect(guardado, 'o blob da feição existe na loja').not.toBeNull();
        expect(guardado.type).toBe('image/png');
        expect(perto(guardado.pixel, VERMELHO), `pixel ${guardado.pixel}`).toBe(true);
        expect(perto(guardado.pixel, AZUL)).toBe(false);
    });

    test('BMP entra pelo navegador e fica guardado como PNG', async ({ page }) => {
        await page.goto('/');
        await esperarMapa(page);
        const bmp = bmpSolido(40, 30, VERDE);

        const feicao = await porImagem(page, { name: 'carta.bmp', mimeType: 'image/bmp', buffer: bmp });
        const guardado = await blobGuardado(page, feicao.id);
        expect(guardado).not.toBeNull();
        expect(guardado.type).toBe('image/png');
        expect([guardado.w, guardado.h]).toEqual([40, 30]);
        expect(perto(guardado.pixel, VERDE), `pixel ${guardado.pixel}`).toBe(true);
    });

    test('o GIF re-encodado SOBE: a linha em `images` é PNG e tem o tamanho do blob local', async ({ browser }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl);
        const page = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA, { expectMapName: seed.mapName });
        await esperarMapa(page);

        const gif = gifAnimado(16, [VERMELHO, AZUL]);
        const feicao = await porImagem(page, { name: 'animado.gif', mimeType: 'image/gif', buffer: gif });
        const imageId = feicao.id;
        const local = await blobGuardado(page, imageId);
        expect(local.type).toBe('image/png');

        const db = createDb(state.dbName).raw;
        await expect.poll(
            () => db.oneOrNone('SELECT mime_type, size_bytes, atlas_id FROM images WHERE id = $1', [imageId]),
            { timeout: 20000, message: 'a linha da imagem nunca chegou ao Postgres' },
        ).not.toBeNull();
        const linha = await db.one('SELECT mime_type, size_bytes, atlas_id FROM images WHERE id = $1', [imageId]);
        expect(linha.mime_type).toBe('image/png');
        expect(linha.size_bytes).toBe(local.size);
        expect(linha.atlas_id).toBe(seed.atlasId);
        await page.context().close();
    });
});
