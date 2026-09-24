// Path: e2e-ui/imagem-formatos-pela-ferramenta.spec.js

/**
 * @fileoverview OS FORMATOS E OS LIMITES DA FERRAMENTA DE IMAGEM, medidos pelo seletor de arquivo
 * real, até os bytes no Postgres e no colega.
 *
 * O portão (`validateImageFile` e `validateImageDimensions`, `utilities/image_utils.js`) e o
 * re-encode por canvas (`resizeImage`, `draw_tools/image_tool/add_image_control.js`) tinham teste
 * unitário e UM caminho de navegador (GIF e BMP, em `imagem-reencodada-gif-bmp.spec.js`). O resto
 * do que a pessoa de fato escolhe no seletor não passava por navegador nenhum:
 *
 *   - JPEG continua JPEG e WebP vira PNG, e o que sobe é o que ficou guardado;
 *   - a foto de CELULAR: 4032 x 3024, alguns MB, cai para 800 x 600;
 *   - a foto de celular DEITADA pela orientação EXIF (a câmera grava paisagem e marca "gire 90°"):
 *     a figura tem de nascer em pé, com largura e altura da feição trocadas;
 *   - HEIC (o formato padrão do iPhone) é recusado dizendo os formatos aceitos;
 *   - o teto de 10 MB pelo SELETOR, nos dois lados: exatamente 10 MB entra, um byte a mais é
 *     recusado com a frase que diz o peso e o máximo, e nada nasce;
 *   - SVG pelo seletor (o `accept` o esconde, mas o "Todos os arquivos" do sistema o oferece);
 *   - o lado máximo de 8192 px.
 *
 * Em todo aceite o veredito é o blob que o COLEGA lê por `getImage` (SHA-256 igual ao do autor) e
 * a linha de `images` com o MIME e o tamanho do blob; em toda recusa, a frase no toast (esperada
 * pela opacidade computada, porque o toast nasce transparente) e nenhuma feição nem linha nova.
 *
 * Rodar isolado:
 *   cd frontend && npx playwright test imagem-formatos-pela-ferramenta --retries=0 --workers=1
 */

import { collabTest, expect, readFeatures } from './helpers/collab.fixtures.js';
import {
    figuraSolida, porImagemPelaFerramenta, impressaoDoBlob, linhaDeImagem, distanciaDeCor, centroDoMapa,
} from './helpers/imagem-bytes.js';
import { esperarFerramentaPronta } from './helpers/ferramenta-pronta.js';
import { clicarNoMapaUI } from './helpers/collab-helpers.js';

collabTest.describe.configure({ retries: 0 });

const B = globalThis.Buffer;
const DEZ_MB = 10 * 1024 * 1024;

/** Espera os bytes de `id` no Postgres e a impressão do colega igual à do autor. */
async function conferirSubidaEColega(collab, id, rotulo) {
    const A = collab.author;
    const Bp = collab.peers[0];
    const noAutor = await impressaoDoBlob(A, id);
    expect(noAutor, `${rotulo}: o autor não lê a própria figura`).not.toBeNull();
    await expect.poll(() => linhaDeImagem(collab.db, id), { timeout: 30000, message: `${rotulo}: os bytes nunca subiram` })
        .toMatchObject({ id, mime_type: noAutor.type, size_bytes: noAutor.size });
    let noColega = null;
    await expect.poll(async () => {
        noColega = await impressaoDoBlob(Bp, id);
        return noColega?.sha ?? null;
    }, { timeout: 30000, message: `${rotulo}: o colega não lê os mesmos bytes` }).toBe(noAutor.sha);
    return noAutor;
}

/**
 * Entrega um arquivo ao seletor e espera a RECUSA: a frase no toast e nenhuma feição nova.
 * @returns {Promise<string>} O texto do toast
 */
async function esperarRecusa(collab, arquivo, trechoDaFrase) {
    const A = collab.author;
    const antes = (await readFeatures(A, 'images')).length;
    const linhasAntes = (await collab.db.raw.one('SELECT count(*)::int AS n FROM images WHERE atlas_id = $1', [collab.atlasId])).n;

    const grupo = A.locator('.toolbar-group[data-group-id="draw"]');
    await grupo.locator('.toolbar-group-btn').click();
    await expect(grupo.locator('.toolbar-popup')).toHaveAttribute('data-visible', 'true', { timeout: 5000 });
    await grupo.locator('.toolbar-tool-btn[data-tool-id="image"]').click();
    await esperarFerramentaPronta(A, 'image');
    const seletor = A.waitForEvent('filechooser', { timeout: 10000 });
    await clicarNoMapaUI(A, await centroDoMapa(A));
    await (await seletor).setFiles(arquivo);

    const toast = A.locator('.toast', { hasText: trechoDaFrase }).first();
    await expect(toast).toBeVisible({ timeout: 15000 });
    await expect.poll(() => toast.evaluate((el) => Number(getComputedStyle(el).opacity)), { timeout: 5000 }).toBeGreaterThan(0.9);
    const texto = await toast.innerText();
    console.log(`RECUSA (${arquivo.name}): ${texto}`);

    // Nada nasce: nem feição, nem linha de bytes. Uma espera curta, porque o que se afirma é AUSÊNCIA
    // e a criação, quando acontece, leva menos de um segundo nesta máquina.
    await A.waitForTimeout(1500);
    expect((await readFeatures(A, 'images')).length, 'uma feição nasceu apesar da recusa').toBe(antes);
    expect((await collab.db.raw.one('SELECT count(*)::int AS n FROM images WHERE atlas_id = $1', [collab.atlasId])).n,
        'bytes subiram apesar da recusa').toBe(linhasAntes);
    await A.keyboard.press('Escape');
    return texto;
}

/**
 * Uma "foto de celular": gradiente com ruído, codificada em JPEG pelo navegador, no tamanho pedido.
 * O ruído é o que dá o peso de uma foto real (uma cor sólida comprime para poucos KB).
 */
async function fotoDeCelular(page, largura, altura, qualidade = 0.9) {
    const b64 = await page.evaluate(async ({ w, h, q }) => {
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        const img = ctx.createImageData(w, h);
        let semente = 12345;
        const aleatorio = () => { semente = (semente * 1103515245 + 12345) & 0x7fffffff; return semente / 0x7fffffff; };
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = (y * w + x) * 4;
                const r = (x / w) * 200 + aleatorio() * 40;
                img.data[i] = r;
                img.data[i + 1] = (y / h) * 180 + aleatorio() * 40;
                img.data[i + 2] = 90 + aleatorio() * 40;
                img.data[i + 3] = 255;
            }
        }
        ctx.putImageData(img, 0, 0);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', q));
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let s = '';
        for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(s);
    }, { w: largura, h: altura, q: qualidade });
    return B.from(b64, 'base64');
}

/**
 * Um JPEG com o segmento EXIF de orientação logo depois do SOI: 6 = "gire 90° no sentido horário
 * para exibir", que é como a câmera do celular grava uma foto tirada em pé.
 */
function comOrientacaoExif(jpeg, orientacao) {
    expect(jpeg[0] === 0xff && jpeg[1] === 0xd8, 'não é um JPEG').toBe(true);
    const tiff = B.from([
        0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // MM, 42, IFD0 em 8
        0x00, 0x01, // uma entrada
        0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientacao, 0x00, 0x00, // Orientation SHORT
        0x00, 0x00, 0x00, 0x00, // sem próximo IFD
    ]);
    const corpo = B.concat([B.from('Exif\0\0', 'binary'), tiff]);
    const app1 = B.concat([B.from([0xff, 0xe1, (corpo.length + 2) >> 8, (corpo.length + 2) & 0xff]), corpo]);
    return B.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]);
}

/** Completa um JPEG com zeros DEPOIS do fim da imagem até `total` bytes: o decodificador os ignora. */
function preenchidoAte(jpeg, total) {
    expect(total).toBeGreaterThan(jpeg.length);
    return B.concat([jpeg, B.alloc(total - jpeg.length)]);
}

collabTest.describe('Formatos e limites da ferramenta de imagem, até os bytes no colega', () => {
    collabTest('JPEG continua JPEG e WebP vira PNG, e o colega lê os mesmos bytes', async ({ collab }) => {
        collabTest.setTimeout(180000);
        const A = collab.author;

        const jpeg = await figuraSolida(A, [200, 60, 40], { tipo: 'image/jpeg' });
        const idJpeg = await porImagemPelaFerramenta(A, { name: 'figura.jpg', mimeType: 'image/jpeg', buffer: jpeg });
        await A.keyboard.press('Escape');
        const j = await conferirSubidaEColega(collab, idJpeg, 'JPEG');
        expect(j.type).toBe('image/jpeg');
        expect(distanciaDeCor(j.pixel, [200, 60, 40]), `cor do JPEG ${j.pixel}`).toBeLessThanOrEqual(20);

        const webp = await figuraSolida(A, [40, 160, 200], { tipo: 'image/webp' });
        const idWebp = await porImagemPelaFerramenta(A, { name: 'figura.webp', mimeType: 'image/webp', buffer: webp });
        await A.keyboard.press('Escape');
        const w = await conferirSubidaEColega(collab, idWebp, 'WebP');
        expect(w.type, 'WebP re-encodado pelo canvas é guardado como PNG').toBe('image/png');
        expect(distanciaDeCor(w.pixel, [40, 160, 200]), `cor do WebP ${w.pixel}`).toBeLessThanOrEqual(12);
    });

    collabTest('FOTO DE CELULAR 4032 x 3024 cai para 800 x 600 e chega ao colega', async ({ collab }) => {
        collabTest.setTimeout(180000);
        const A = collab.author;
        const foto = await fotoDeCelular(A, 4032, 3024, 0.9);
        console.log(`FOTO DE CELULAR: ${foto.length} bytes`);
        expect(foto.length, 'a foto de teste tem o peso de uma foto de celular').toBeGreaterThan(1.5 * 1024 * 1024);
        expect(foto.length).toBeLessThan(DEZ_MB);

        const id = await porImagemPelaFerramenta(A, { name: 'IMG_20260924_101500.jpg', mimeType: 'image/jpeg', buffer: foto });
        await A.keyboard.press('Escape');
        const r = await conferirSubidaEColega(collab, id, 'foto de celular');
        expect({ w: r.w, h: r.h, type: r.type }).toEqual({ w: 800, h: 600, type: 'image/jpeg' });
        const props = (await readFeatures(A, 'images')).find((f) => f.id === id)?.props;
        expect({ width: props?.width, height: props?.height }, 'a feição carrega as dimensões do que foi guardado').toEqual({ width: 800, height: 600 });
    });

    collabTest('foto DEITADA pela orientação EXIF nasce EM PÉ', async ({ collab }) => {
        collabTest.setTimeout(180000);
        const A = collab.author;
        // Guardada como paisagem 48 x 24: metade ESQUERDA vermelha, direita azul. Com orientação 6
        // (girar 90° horário), a exibição é retrato 24 x 48 com o vermelho EM CIMA.
        const b64 = await A.evaluate(async () => {
            const c = document.createElement('canvas');
            c.width = 48;
            c.height = 24;
            const ctx = c.getContext('2d');
            ctx.fillStyle = 'rgb(220,30,30)';
            ctx.fillRect(0, 0, 24, 24);
            ctx.fillStyle = 'rgb(30,30,220)';
            ctx.fillRect(24, 0, 24, 24);
            const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', 0.95));
            const bytes = new Uint8Array(await blob.arrayBuffer());
            return btoa(String.fromCharCode(...bytes));
        });
        const deitada = comOrientacaoExif(B.from(b64, 'base64'), 6);

        // Controle do INSTRUMENTO: o navegador lê a orientação deste arquivo (senão o caso mediria
        // um EXIF malformado, e não o produto).
        const lidoPeloNavegador = await A.evaluate(async (s) => {
            const bytes = Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
            const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
            return { w: bmp.width, h: bmp.height };
        }, deitada.toString('base64'));
        expect(lidoPeloNavegador, 'o navegador não aplicou a orientação EXIF do arquivo de teste').toEqual({ w: 24, h: 48 });

        const id = await porImagemPelaFerramenta(A, { name: 'IMG_EM_PE.jpg', mimeType: 'image/jpeg', buffer: deitada });
        await A.keyboard.press('Escape');
        const r = await conferirSubidaEColega(collab, id, 'foto em pé');
        const topo = await A.evaluate(async (fid) => {
            const store = await import('/src/js/store/index.js');
            const blob = await store.getImage(fid);
            const bmp = await createImageBitmap(blob, { imageOrientation: 'none' });
            const c = document.createElement('canvas');
            c.width = bmp.width;
            c.height = bmp.height;
            const ctx = c.getContext('2d');
            ctx.drawImage(bmp, 0, 0);
            return [...ctx.getImageData(bmp.width >> 1, 4, 1, 1).data].slice(0, 3);
        }, id);
        const props = (await readFeatures(A, 'images')).find((f) => f.id === id)?.props;
        console.log(`EXIF 6: blob ${r.w}x${r.h}, feição ${props?.width}x${props?.height}, topo ${topo}`);
        expect({ w: r.w, h: r.h }, 'a figura guardada está em pé').toEqual({ w: 24, h: 48 });
        expect({ width: props?.width, height: props?.height }, 'a feição está em pé').toEqual({ width: 24, height: 48 });
        expect(distanciaDeCor(topo, [220, 30, 30]), `o topo da figura é ${topo}, e deveria ser o vermelho`).toBeLessThanOrEqual(40);
    });

    collabTest('o teto de 10 MB pelo SELETOR: exatamente 10 MB entra, um byte a mais é recusado', async ({ collab }) => {
        collabTest.setTimeout(180000);
        const A = collab.author;
        const base = await fotoDeCelular(A, 1200, 900, 0.9);

        const exato = preenchidoAte(base, DEZ_MB);
        const id = await porImagemPelaFerramenta(A, { name: 'exatamente-10mb.jpg', mimeType: 'image/jpeg', buffer: exato });
        await A.keyboard.press('Escape');
        const r = await conferirSubidaEColega(collab, id, '10 MB exatos');
        expect({ w: r.w, h: r.h }).toEqual({ w: 800, h: 600 });

        const acima = preenchidoAte(base, DEZ_MB + 1);
        const frase = await esperarRecusa(collab, { name: 'acima-de-10mb.jpg', mimeType: 'image/jpeg', buffer: acima }, 'o máximo é 10 MB');
        expect(frase).toContain('MB');
    });

    collabTest('HEIC do iPhone, SVG e um lado acima de 8192 px são recusados com a frase, e nada nasce', async ({ collab }) => {
        collabTest.setTimeout(180000);
        const A = collab.author;

        // HEIC: o conteúdo não importa, o portão decide pelo tipo ANTES de ler.
        const heic = await esperarRecusa(collab, { name: 'IMG_0001.HEIC', mimeType: 'image/heic', buffer: B.alloc(2048, 7) },
            'tipo de arquivo não suportado');
        expect(heic).toMatch(/JPEG|PNG/);

        const svg = B.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
        await esperarRecusa(collab, { name: 'desenho.svg', mimeType: 'image/svg+xml', buffer: svg }, 'tipo de arquivo não suportado');

        const faixa = await figuraSolida(A, [10, 10, 10], { largura: 8200, altura: 8 });
        const lado = await esperarRecusa(collab, { name: 'panorama.png', mimeType: 'image/png', buffer: faixa }, 'px de lado');
        expect(lado).toContain('8192 px');
    });
});
