// Path: e2e-ui/imagem-reencodada-gif-bmp.spec.js

/**
 * GIF E BMP NAS DUAS PORTAS QUE RE-ENCODAM: o que entra, o que fica guardado, o que sobe e o que
 * chega ao par.
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
 * ===================== AS TRÊS LACUNAS FECHADAS EM 2026-09-20 =====================
 *
 *   L1. A SEGUNDA PORTA. Os três casos acima entram todos pela FERRAMENTA (seletor de arquivo).
 *       O arrastar e soltar chega a `addImageFeature` por outro chamador
 *       (`processImageFile`, `src/js/import_export/drag-drop.handler.js`), com um gate ESCRITO
 *       DE NOVO naquele arquivo, e até aqui ele só tinha teste unitário. A §"Arrastar e soltar"
 *       solta um `DragEvent` de verdade sobre o container do mapa, com `DataTransfer` e as
 *       coordenadas da solta, e mede as duas metades: o que a porta ACEITA (GIF, BMP, e a
 *       feição nascendo no ponto da solta) e o que ela RECUSA, pelas três frases distintas que
 *       a pessoa lê (classificação da solta, MIME fora da lista, peso acima do teto).
 *   L2. O PAR. Um blob que fica guardado como PNG nesta máquina não prova que o par o RECEBE.
 *       A §"Colaboração" põe o GIF numa browser e lê o blob na OUTRA. O sinal é o BLOB, nunca
 *       `map.hasImage`: o 404 instala o placeholder de erro sob o MESMO id, então a imagem no
 *       mapa é verdadeira nos DOIS desfechos (o mesmo achado de
 *       `browser-collab-colar-imagem.spec.js`).
 *   L3. O SEGUNDO NAVEGADOR. A decodificação de GIF e de BMP é do NAVEGADOR, então é aqui que o
 *       Firefox pode divergir do Chromium. O arquivo inteiro roda em `--project=firefox`, e em
 *       2026-09-20 deu 11 de 11 nos dois, sem uma asserção afrouxada: o Firefox 151 do Playwright
 *       decodifica o GIF animado e o BMP como o Chromium, e o primeiro quadro é o mesmo. O
 *       segundo navegador custa cerca de três vezes o tempo (o `timeout` triplo do projeto
 *       `firefox` já cobre isso) e nada mais. O que se suspeitava que ele quebraria está medido
 *       no bloco "O CONTROLE DE QUADROS" logo abaixo, e a suspeita era falsa.
 *
 * ===================== O CONTROLE DE QUADROS, E POR QUE SÃO DOIS =====================
 *
 * Um GIF de UM quadro passaria em "vira o primeiro quadro" sem provar nada sobre animação, então
 * o número de quadros do arquivo precisa ser afirmado por fora do próprio codificador. O controle
 * original era só `ImageDecoder` dentro da página, e a suspeita era que ele fosse o ponto em que
 * o segundo navegador quebraria. **Medido em 2026-09-20, a suspeita estava errada nos dois
 * sentidos:** `ImageDecoder` existe no Chromium 149 E no Firefox 151 do Playwright, e os dois
 * contam 2 quadros neste GIF; o que ele exige não é navegador, é CONTEXTO SEGURO — em
 * `about:blank` `typeof ImageDecoder` é `'undefined'` nos DOIS, e em `http://localhost` é
 * `'function'` nos dois. Ou seja, um controle preso a ele passaria a mentir se algum dia este
 * arnês servisse o app de uma origem opaca, e não porque alguém trocou de navegador.
 *
 * Daí serem dois, com o portátil como piso:
 *
 *   - {@link quadrosNoArquivo}, em node, CAMINHA os blocos do GIF (extensões, descritores de
 *     imagem, sub-blocos) e conta descritores. Não depende de navegador nem de contexto, e como
 *     ele levanta em bloco desconhecido, também afirma que o codificador emite um GIF bem formado.
 *     É ele que SEMPRE roda.
 *   - `ImageDecoder`, dentro da página, quando existe: aí quem conta é um decodificador do próprio
 *     navegador. Onde ele falta, o caso ANOTA a ausência (`controle-de-quadros`) em vez de se
 *     calar, porque um controle que some sem deixar rastro é cobertura vazia.
 *
 * Os dois codificadores existem porque a suíte não pode depender de arquivo binário versionado
 * nem de biblioteca de imagem. O de GIF usa o LZW "sem compressão": um CLEAR a cada dois pixels
 * impede a tabela de crescer, então todo código tem três bits.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { esperarFerramentaPronta } from './helpers/ferramenta-pronta.js';
import { clicarNoMapaUI, readFeatures, seedSharedAtlas, openClient } from './helpers/collab-helpers.js';
import { waitForRemoteEntity } from './helpers/trace-helpers.js';
import { createDb } from './helpers/db.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;
const B = globalThis.Buffer;

const VERMELHO = [220, 30, 30];
const AZUL = [30, 30, 220];
const VERDE = [30, 200, 60];

/** Onde a ferramenta clica e onde a solta cai. Está na vista padrão do mapa. */
const ALVO = [-53.4, -30.0];

/** A rota que SERVE o blob de uma imagem ao par (`ApiClient.imageUrl`). */
const ROTA_DE_IMAGEM = '**/atlas/*/images/*';

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

/**
 * Quantos QUADROS o arquivo carrega, caminhando os blocos do GIF.
 *
 * INDEPENDENTE DO CODIFICADOR ACIMA e de navegador nenhum: ele lê a estrutura declarada pelo
 * formato (tabela global de cores pelo flag, extensões por sub-blocos, descritor de imagem com
 * tabela local opcional) em vez de contar bytes 0x2C soltos, que apareceriam também dentro de
 * dados LZW. Levanta em bloco desconhecido, de propósito: um codificador que emita lixo tem de
 * reprovar aqui, e não adiante com a mensagem de outra coisa.
 *
 * @param {Buffer} buf - O arquivo GIF inteiro
 * @returns {number} Número de descritores de imagem (quadros)
 */
function quadrosNoArquivo(buf) {
    if (buf.slice(0, 3).toString('ascii') !== 'GIF') throw new Error('não é um GIF');
    let i = 6;
    const flags = buf[i + 4];
    i += 7;
    if (flags & 0x80) i += 3 * (2 ** ((flags & 0x07) + 1));

    const pularSubBlocos = () => {
        while (buf[i] !== 0) i += buf[i] + 1;
        i += 1;
    };

    let quadros = 0;
    while (i < buf.length) {
        const marcador = buf[i];
        i += 1;
        if (marcador === 0x3b) break;
        if (marcador === 0x21) { i += 1; pularSubBlocos(); continue; }
        if (marcador === 0x2c) {
            quadros += 1;
            const local = buf[i + 8];
            i += 9;
            if (local & 0x80) i += 3 * (2 ** ((local & 0x07) + 1));
            i += 1;
            pularSubBlocos();
            continue;
        }
        throw new Error(`bloco GIF desconhecido 0x${marcador.toString(16)} em ${i - 1}`);
    }
    return quadros;
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

/**
 * O SEGUNDO controle de quadros, o que depende do navegador.
 *
 * Devolve `null` onde não há `ImageDecoder` — que NÃO é uma questão de navegador e sim de
 * contexto seguro (ver o cabeçalho) —, e o chamador ANOTA isso em vez de tratar ausência como
 * igualdade. Quem sempre roda é {@link quadrosNoArquivo}.
 * @returns {Promise<number|null>}
 */
function quadrosNoNavegador(page, gif) {
    return page.evaluate(async (b64) => {
        if (typeof ImageDecoder !== 'function') return null;
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const decoder = new ImageDecoder({ data: bytes.buffer, type: 'image/gif' });
        await decoder.tracks.ready;
        return decoder.tracks.selectedTrack.frameCount;
    }, gif.toString('base64'));
}

/** Os DOIS controles de quadro, com a ausência do segundo anotada no relatório do caso. */
async function conferirDoisQuadros(page, gif) {
    expect(quadrosNoArquivo(gif), 'o codificador emitiu um GIF de DOIS quadros').toBe(2);
    const noNavegador = await quadrosNoNavegador(page, gif);
    test.info().annotations.push({
        type: 'controle-de-quadros',
        description: noNavegador === null
            ? 'bytes apenas (este navegador nao tem ImageDecoder)'
            : `bytes + ImageDecoder (${noNavegador})`,
    });
    if (noNavegador !== null) expect(noNavegador).toBe(2);
}

async function esperarMapa(page) {
    await expect(page.locator('#nav-btn-zoom-in')).toBeAttached({ timeout: 20000 });
    await page.waitForFunction(() => globalThis.__ebgeoMap && globalThis.__ebgeoMap.loaded(), null, { timeout: 20000 });
    await page.waitForTimeout(400);
}

/**
 * Espera o ARRASTAR E SOLTAR estar de fato armado.
 *
 * `map.loaded()` NÃO diz isso: `dragDropHandler.enable()` roda no meio de `createControls`
 * (`src/js/map_sig.js`) e não deixa sinal próprio. Uma solta despachada antes dele é engolida
 * pelo documento sem erro nenhum, e o caso morre trinta linhas adiante dizendo "a solta não criou
 * feição". O registro de controles é preenchido no FIM da mesma função, depois da fiação da
 * solta, então a presença da última entrada dele é o sinal que cobre o instante certo.
 */
async function esperarSoltaArmada(page) {
    await expect.poll(() => page.evaluate(async () => {
        const store = await import('/src/js/store/index.js');
        return !!store.getControl('commentOverlay');
    }), { message: 'a camada que arma a solta de arquivo nao montou', timeout: 20000 }).toBe(true);
}

/** Fecha o painel de atributos que a criação de uma feição abre, para o gesto seguinte. */
async function dispensarPainelDeFeicao(page) {
    if ((await page.locator('.feature-panel[data-expanded="true"]').count()) === 0) return;
    await page.keyboard.press('Escape');
    await expect(page.locator('.feature-panel[data-expanded="true"]')).toHaveCount(0, { timeout: 5000 });
    await page.waitForTimeout(350);
}

/** Ativa a ferramenta, clica no mapa e entrega `arquivo` ao seletor. Devolve a feição criada. */
async function porImagem(page, arquivo, lngLat = ALVO) {
    const antes = (await readFeatures(page, 'images')).length;
    const grupo = page.locator('.toolbar-group[data-group-id="draw"]');
    await grupo.locator('.toolbar-group-btn').click();
    await expect(grupo.locator('.toolbar-popup')).toHaveAttribute('data-visible', 'true', { timeout: 5000 });
    await grupo.locator('.toolbar-tool-btn[data-tool-id="image"]').click();
    await esperarFerramentaPronta(page, 'image');

    const seletor = page.waitForEvent('filechooser', { timeout: 10000 });
    await clicarNoMapaUI(page, lngLat);
    await (await seletor).setFiles(arquivo);

    await expect.poll(async () => (await readFeatures(page, 'images')).length, { timeout: 15000 })
        .toBe(antes + 1);
    const todas = await readFeatures(page, 'images');
    return todas[todas.length - 1];
}

/**
 * SOLTA um arquivo sobre o container do mapa, como o navegador faz.
 *
 * O handler lê três coisas do evento (`dataTransfer.files`, `clientX`, `clientY`), então o gesto
 * é um `DragEvent('drop')` construído com um `DataTransfer` real e as coordenadas de tela do
 * ponto pedido. Duas asserções de INSTRUMENTO ficam aqui, antes de qualquer asserção de produto:
 * o ponto tem de cair dentro do container (um mapa reposicionado soltaria fora da tela e o caso
 * acusaria o produto), e o evento tem de chegar com UM arquivo — se um navegador ignorar o
 * `dataTransfer` do construtor, o teste precisa reprovar dizendo isso, e não medir uma solta
 * vazia.
 *
 * @param {import('@playwright/test').Page} page
 * @param {[number, number]} lngLat - Onde soltar
 * @param {{nome: string, tipo: string, buffer?: Buffer, bytes?: number}} arquivo - `bytes` cria
 *   um arquivo de N bytes DENTRO da página (um teto de peso não precisa viajar pelo CDP).
 * @returns {Promise<{clientX: number, clientY: number, transporte: string, tamanho: number}>}
 */
async function soltarNoMapa(page, lngLat, arquivo) {
    const r = await page.evaluate(async (e) => {
        const map = globalThis.__ebgeoMap;
        const container = map.getContainer();
        const rect = container.getBoundingClientRect();
        const pt = map.project(e.lngLat);
        const clientX = Math.round(rect.left + pt.x);
        const clientY = Math.round(rect.top + pt.y);
        const dentro = pt.x >= 0 && pt.y >= 0 && pt.x <= rect.width && pt.y <= rect.height;

        const corpo = e.base64 === null
            ? new Uint8Array(e.bytes)
            : Uint8Array.from(atob(e.base64), (c) => c.charCodeAt(0));
        const file = new File([corpo], e.nome, { type: e.tipo });

        const dt = new DataTransfer();
        dt.items.add(file);

        const evento = new DragEvent('drop', {
            dataTransfer: dt, clientX, clientY, bubbles: true, cancelable: true,
        });
        // O construtor de `DragEvent` já ignorou `dataTransfer` em navegadores de outras épocas.
        // Se este ignorar, o transporte cai para a propriedade definida à mão e o caso DIZ isso
        // no retorno (anotação `transporte-da-solta`), em vez de medir uma solta sem arquivo.
        // MEDIDO em 2026-09-20: o ramo do `defineProperty` NÃO é exercitado por nenhum dos dois
        // navegadores desta camada (Chromium 149 e Firefox 151 devolvem o MESMO objeto), então
        // ele é rede de segurança declarada, e quem prova que a rede é necessária é a asserção de
        // `arquivosVistos`, não este ramo.
        let transporte = 'DragEvent';
        if (evento.dataTransfer !== dt) {
            Object.defineProperty(evento, 'dataTransfer', { value: dt, configurable: true });
            transporte = 'defineProperty';
        }
        const arquivosVistos = evento.dataTransfer?.files?.length ?? 0;
        container.dispatchEvent(evento);
        return { clientX, clientY, dentro, transporte, arquivosVistos, tamanho: file.size };
    }, {
        lngLat,
        nome: arquivo.nome,
        tipo: arquivo.tipo,
        base64: arquivo.buffer ? arquivo.buffer.toString('base64') : null,
        bytes: arquivo.bytes ?? 0,
    });

    expect(r.dentro, 'o ponto da solta caiu FORA do container do mapa').toBe(true);
    expect(r.arquivosVistos, `a solta chegou sem arquivo (transporte: ${r.transporte})`).toBe(1);
    test.info().annotations.push({ type: 'transporte-da-solta', description: r.transporte });
    return r;
}

/** As feições de imagem do mapa corrente, com a geometria (que `readFeatures` não devolve). */
function imagensDoMapa(page) {
    return page.evaluate(async () => {
        const store = await import('/src/js/store/index.js');
        const f = await store.getCurrentMapFeatures();
        return (f.images || []).map((x) => ({ id: x.properties?.id, coords: x.geometry?.coordinates }));
    });
}

/** Espera nascer UMA imagem que não estava em `antes` e a devolve. */
async function esperarNovaImagem(page, antes, timeout = 15000) {
    const conhecidos = new Set(antes.map((i) => i.id));
    let nova = null;
    await expect
        .poll(async () => {
            nova = (await imagensDoMapa(page)).find((i) => !conhecidos.has(i.id)) ?? null;
            return nova?.id ?? null;
        }, { timeout, message: 'a solta nao criou nenhuma feicao de imagem' })
        .not.toBeNull();
    return nova;
}

/** O pixel de tela de uma coordenada, para conferir onde a feição nasceu. */
const pixelDaCoordenada = (page, coords) => page.evaluate((c) => {
    const map = globalThis.__ebgeoMap;
    const rect = map.getContainer().getBoundingClientRect();
    const p = map.project(c);
    return { x: Math.round(rect.left + p.x), y: Math.round(rect.top + p.y) };
}, coords);

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

describeOrSkip('GIF e BMP pela ferramenta de imagem (navegador real, backend real)', () => {
    test.describe.configure({ retries: 0 });

    test('GIF ANIMADO entra, vira o PRIMEIRO quadro e fica guardado como PNG', async ({ page }) => {
        await page.goto('/');
        await esperarMapa(page);
        const gif = gifAnimado(16, [VERMELHO, AZUL]);

        // Controle do INSTRUMENTO, antes do gesto: este GIF tem de ter DOIS quadros. Sem isto, um
        // codificador que só emitisse um quadro faria o caso passar provando nada sobre animação.
        await conferirDoisQuadros(page, gif);

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

// =================================================================================================
// L1 — ARRASTAR E SOLTAR: a segunda porta, com gate PRÓPRIO
// =================================================================================================

describeOrSkip('GIF e BMP soltos no mapa (arrastar e soltar)', () => {
    test.describe.configure({ retries: 0 });

    test('GIF ANIMADO solto vira o PRIMEIRO quadro, fica PNG e nasce NO PONTO da solta', async ({ page }) => {
        await page.goto('/');
        await esperarMapa(page);
        await esperarSoltaArmada(page);
        const gif = gifAnimado(16, [VERMELHO, AZUL]);
        await conferirDoisQuadros(page, gif);

        const antes = await imagensDoMapa(page);
        const solta = await soltarNoMapa(page, ALVO, { nome: 'animado.gif', tipo: 'image/gif', buffer: gif });

        const nova = await esperarNovaImagem(page, antes);
        const guardado = await blobGuardado(page, nova.id);
        expect(guardado, 'o blob da feição solta existe na loja').not.toBeNull();
        expect(guardado.type).toBe('image/png');
        expect(perto(guardado.pixel, VERMELHO), `pixel ${guardado.pixel}`).toBe(true);
        expect(perto(guardado.pixel, AZUL)).toBe(false);

        // A SOLTA DECIDE ONDE, e é o único caminho de criação de imagem em que isso é verdade
        // (a ferramenta usa o clique). `handleDrop` desprojeta `clientX/clientY` contra o retângulo
        // do container; reprojetar a coordenada guardada tem de devolver o mesmo pixel.
        const px = await pixelDaCoordenada(page, nova.coords);
        expect(Math.hypot(px.x - solta.clientX, px.y - solta.clientY),
            `a feição nasceu em ${JSON.stringify(nova.coords)} (${px.x},${px.y}), e a solta foi em `
            + `(${solta.clientX},${solta.clientY})`).toBeLessThanOrEqual(2);
    });

    test('CONTROLE DE ORDEM: invertidos os quadros, a solta guarda o OUTRO primeiro quadro', async ({ page }) => {
        // O CASO ACIMA SOZINHO NÃO SEPARA "primeiro quadro" DE "vermelho". Um re-encode que sempre
        // pegasse o ÚLTIMO quadro, ou que por acaso produzisse vermelho, passaria lá e reprova
        // aqui: este GIF é o mesmo com as cores trocadas de lugar.
        await page.goto('/');
        await esperarMapa(page);
        await esperarSoltaArmada(page);
        const gif = gifAnimado(16, [AZUL, VERMELHO]);
        await conferirDoisQuadros(page, gif);

        const antes = await imagensDoMapa(page);
        await soltarNoMapa(page, ALVO, { nome: 'invertido.gif', tipo: 'image/gif', buffer: gif });

        const nova = await esperarNovaImagem(page, antes);
        const guardado = await blobGuardado(page, nova.id);
        expect(guardado).not.toBeNull();
        expect(guardado.type).toBe('image/png');
        expect(perto(guardado.pixel, AZUL), `pixel ${guardado.pixel}`).toBe(true);
        expect(perto(guardado.pixel, VERMELHO)).toBe(false);
    });

    test('BMP solto entra, fica PNG e mantém as dimensões', async ({ page }) => {
        await page.goto('/');
        await esperarMapa(page);
        await esperarSoltaArmada(page);

        const antes = await imagensDoMapa(page);
        await soltarNoMapa(page, ALVO, { nome: 'carta.bmp', tipo: 'image/bmp', buffer: bmpSolido(40, 30, VERDE) });

        const nova = await esperarNovaImagem(page, antes);
        const guardado = await blobGuardado(page, nova.id);
        expect(guardado).not.toBeNull();
        expect(guardado.type).toBe('image/png');
        expect([guardado.w, guardado.h]).toEqual([40, 30]);
        expect(perto(guardado.pixel, VERDE), `pixel ${guardado.pixel}`).toBe(true);
    });

    test('a solta RECUSA .tiff pela CLASSIFICAÇÃO e nomeia o arquivo', async ({ page }) => {
        // A PRIMEIRA DE DUAS RECUSAS DE TIPO, e elas não são a mesma. Esta é de `classifyFile`, que
        // olha a EXTENSÃO antes de qualquer portão de imagem: `.tiff` não está em nenhuma das três
        // famílias de extensão, então a solta nem chega a `processImageFile`.
        await page.goto('/');
        await esperarMapa(page);
        await esperarSoltaArmada(page);

        const antes = await imagensDoMapa(page);
        await soltarNoMapa(page, ALVO, { nome: 'foto.tiff', tipo: 'image/tiff', buffer: B.from([0x49, 0x49, 0x2a, 0x00]) });

        await expect(page.locator('.toast--error', { hasText: 'Tipo de arquivo não suportado: foto.tiff' }))
            .toBeVisible({ timeout: 8000 });
        await page.waitForTimeout(1500);
        expect((await imagensDoMapa(page)).length, 'a recusa deixou nascer uma feição').toBe(antes.length);
    });

    test('a solta RECUSA um MIME fora da lista e a frase NOMEIA GIF e BMP entre os aceitos', async ({ page }) => {
        // A SEGUNDA RECUSA DE TIPO, e é ela que mede a decisão deste lote. O arquivo passa pela
        // classificação (extensão `.png`) e cai em `validateImageFile` com `allowReencodable: true`,
        // cuja frase é MONTADA a partir da lista que aquele portão de fato aceita. Se a solta
        // deixasse de optar pelos re-encodáveis, a frase voltaria a dizer "JPEG, PNG ou WebP" e
        // este caso reprovaria na palavra, que é o que a pessoa lê.
        await page.goto('/');
        await esperarMapa(page);
        await esperarSoltaArmada(page);

        const antes = await imagensDoMapa(page);
        await soltarNoMapa(page, ALVO, { nome: 'disfarce.png', tipo: 'image/tiff', buffer: B.from([0x49, 0x49, 0x2a, 0x00]) });

        await expect(page.locator('.toast--error', {
            hasText: 'A imagem não foi carregada: tipo de arquivo não suportado (use JPEG, PNG, WebP, GIF ou BMP).',
        })).toBeVisible({ timeout: 8000 });
        await page.waitForTimeout(1500);
        expect((await imagensDoMapa(page)).length, 'a recusa deixou nascer uma feição').toBe(antes.length);
    });

    test('a solta RECUSA acima de 10 MB e a frase diz os DOIS números', async ({ page }) => {
        // O TETO É MEDIDO ANTES DO `FileReader`, e é por isso que este caso pode existir: os 11 MB
        // nascem DENTRO da página e nunca são lidos, então nada aqui constrói a base64 de 15 MB que
        // o comentário de `processImageFile` diz que mataria a aba.
        await page.goto('/');
        await esperarMapa(page);
        await esperarSoltaArmada(page);

        const antes = await imagensDoMapa(page);
        const solta = await soltarNoMapa(page, ALVO, { nome: 'grande.png', tipo: 'image/png', bytes: 11 * 1024 * 1024 });
        expect(solta.tamanho).toBe(11 * 1024 * 1024);

        await expect(page.locator('.toast--error', {
            hasText: 'A imagem não foi carregada: o arquivo tem 11 MB e o máximo é 10 MB.',
        })).toBeVisible({ timeout: 8000 });
        await page.waitForTimeout(1500);
        expect((await imagensDoMapa(page)).length, 'a recusa deixou nascer uma feição').toBe(antes.length);
    });
});

// =================================================================================================
// L2 — O PAR: a imagem cuja origem foi um GIF chega ao outro usuário, com BYTES
// =================================================================================================

/** Abre dois clientes reais no mesmo atlas de servidor e devolve autor e par. */
async function abrirPar(browser) {
    const seed = await seedSharedAtlas(browser, state.baseUrl);
    const autor = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA, { expectMapName: seed.mapName });
    const par = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB, { expectMapName: seed.mapName });
    await esperarMapa(autor);
    await esperarMapa(par);
    return { seed, autor, par };
}

/** Espera a feição de imagem `id` chegar ao par: sinal de trace primeiro, loja como verdade. */
async function esperarFeicaoNoPar(par, id, timeout = 30000) {
    await waitForRemoteEntity(par, id, { operationType: 'create', timeout }).catch(() => {
        // O sinal determinístico pode faltar (tracer desligado por `EBGEO_E2E_NO_TRACE`, ou a op
        // chegando por snapshot em vez de broadcast). A leitura da loja abaixo é quem decide.
    });
    await expect
        .poll(async () => (await readFeatures(par, 'images')).map((f) => f.id), {
            timeout, message: 'a feição de imagem nunca chegou ao par',
        })
        .toContain(id);
}

describeOrSkip('A imagem cuja origem foi um GIF chega ao PAR', () => {
    test.describe.configure({ retries: 0 });

    test('o par recebe a feição E o BLOB do primeiro quadro, como PNG', async ({ browser }) => {
        const { autor, par } = await abrirPar(browser);
        const gif = gifAnimado(16, [VERMELHO, AZUL]);
        await conferirDoisQuadros(autor, gif);

        const feicao = await porImagem(autor, { name: 'animado.gif', mimeType: 'image/gif', buffer: gif });
        const local = await blobGuardado(autor, feicao.id);
        expect(local.type).toBe('image/png');

        await esperarFeicaoNoPar(par, feicao.id);

        // O SINAL É O BLOB, NUNCA `map.hasImage`: o 404 instala o placeholder de ERRO sob o MESMO
        // id, então a imagem no mapa é verdadeira nos dois desfechos. O par nunca teve estes bytes
        // por outra via — o GIF foi lido na outra browser e a imagem não é regenerável a partir das
        // propriedades (ao contrário de símbolo militar, medida de coordenação e declinação).
        await expect
            .poll(async () => (await blobGuardado(par, feicao.id))?.type ?? null, {
                timeout: 30000, message: 'o blob re-encodado nunca resolveu no par',
            })
            .toBe('image/png');

        const noPar = await blobGuardado(par, feicao.id);
        expect(noPar.size, 'o par recebeu bytes de tamanho diferente do que o autor guardou').toBe(local.size);
        expect(perto(noPar.pixel, VERMELHO), `pixel no par ${noPar.pixel}`).toBe(true);
        expect(perto(noPar.pixel, AZUL)).toBe(false);

        // CONTROLE: um id que ninguém criou não resolve. Sem ele, um `getImage` que devolvesse
        // qualquer coisa para qualquer id passaria em tudo acima.
        expect(await blobGuardado(par, '00000000-0000-4000-8000-000000000000'),
            'getImage devolveu bytes para um id inventado').toBeNull();

        await autor.context().close();
        await par.context().close();
    });

    test('CONTROLE: recusada a rota de imagem no par, o mesmo sinal fica NULO; liberada, volta', async ({ browser }) => {
        // O CONTROLE NEGATIVO DO CASO ACIMA, com as duas metades no MESMO par e na MESMA rodada.
        // Sem a primeira metade, "o blob chegou" é indistinguível de um `getImage` que devolvesse
        // bytes de qualquer lugar; sem a segunda, o nulo seria indistinguível de um par quebrado.
        const { autor, par } = await abrirPar(browser);

        await par.route(ROTA_DE_IMAGEM, (rota) => (rota.request().method() === 'GET'
            ? rota.fulfill({ status: 404, contentType: 'text/plain', body: 'recusado pelo teste' })
            : rota.continue()));

        const primeiro = await porImagem(autor, {
            name: 'bloqueado.gif', mimeType: 'image/gif', buffer: gifAnimado(16, [VERMELHO, AZUL]),
        });
        await esperarFeicaoNoPar(par, primeiro.id);

        // NULO POR UMA JANELA, e não num instante: "ainda não chegou" e "não vai chegar" têm a
        // mesma leitura num ponto só.
        for (let i = 0; i < 5; i++) {
            expect(await blobGuardado(par, primeiro.id),
                'o blob resolveu no par com a rota de imagem recusada').toBeNull();
            await par.waitForTimeout(800);
        }

        await par.unroute(ROTA_DE_IMAGEM);
        await dispensarPainelDeFeicao(autor);

        const segundo = await porImagem(autor, {
            name: 'liberado.gif', mimeType: 'image/gif', buffer: gifAnimado(16, [VERDE, AZUL]),
        }, [-53.9, -30.4]);
        await esperarFeicaoNoPar(par, segundo.id);

        await expect
            .poll(async () => (await blobGuardado(par, segundo.id))?.type ?? null, {
                timeout: 30000, message: 'liberada a rota, o blob ainda não resolveu no par',
            })
            .toBe('image/png');
        const guardado = await blobGuardado(par, segundo.id);
        expect(perto(guardado.pixel, VERDE), `pixel no par ${guardado.pixel}`).toBe(true);

        await autor.context().close();
        await par.context().close();
    });
});
