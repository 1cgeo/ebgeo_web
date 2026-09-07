// Path: tests/unit/mime-da-imagem-do-ebgeo.test.js

/**
 * @fileoverview Prende o TIPO da imagem ao longo das tres travessias que o `.ebgeo` faz:
 * arquivo -> IndexedDB (`loadImagesFromZip`), IndexedDB -> servidor (`buildImageUploads`) e
 * IndexedDB -> arquivo de novo (`getBlobExtension`).
 *
 * O DEFEITO QUE ELE EXISTE PARA REPROVAR (onda 3, B3-2 e B2-4). `zip.file(nome).async('blob')`
 * devolve `Blob` com `type` VAZIO: medido, 130 de 131 blobs sem MIME no dump do slot importado.
 * Dai saem duas perdas medidas. Na subida, `blob.type || 'image/png'` declarava PNG para bytes
 * JPEG e `backend/src/modules/images/images.service.js:209-214` recusava com
 * "Content does not match declared type": 4 de 4 JPEG do `03-completo-2.4.ebgeo` nunca chegaram
 * ao servidor, e o atlas de servidor desenhava X vermelho no lugar da foto. Na volta ao arquivo,
 * `getBlobExtension` caia no `default` e a foto saia com nome `.png` e bytes JPEG.
 *
 * A MARCA E O TIPO REAL DOS BYTES, nunca "tem algum tipo": um teste que so exigisse `type` nao
 * vazio passaria tambem se toda imagem virasse `image/png`, que e exatamente o estado de hoje.
 * Por isso cada caso carrega a assinatura de verdade (PNG `89 50 4E 47`, JPEG `FF D8 FF`,
 * WebP `RIFF....WEBP`) e o teste confere o par (tipo declarado, primeiros bytes).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const armazenadas = new Map();

vi.mock('@store', () => ({
    getAllMapNamesStore: vi.fn(async () => []),
    getCurrentMapName: vi.fn(async () => 'Mapa A'),
    getCurrentMapNameSync: vi.fn(() => 'Mapa A'),
    getMapOrder: vi.fn(async () => []),
    getCurrentMapFeatures: vi.fn(async () => ({})),
    getMapPosition: vi.fn(async () => ({ zoom: 8, center_lat: 0, center_long: 0, bearing: 0, pitch: 0 })),
    getCatalogLayers: vi.fn(async () => []),
    getCurrentBaseLayer: vi.fn(async () => 'carta'),
    getColorUsage: vi.fn(async () => ({})),
    getMapNotes: vi.fn(async () => ({})),
    getMapGroups: vi.fn(() => ({})),
    getLayers: vi.fn(async () => []),
    getCesium3dDataForExport: vi.fn(async () => ({})),
    getStreetview360DataForExport: vi.fn(async () => ({})),
    getMapTemporalConfig: vi.fn(async () => ({})),
    getGridStyle: vi.fn(async () => ({})),
    getComments: vi.fn(async () => ({})),
    getBriefingsForExport: vi.fn(async () => []),
    getCustomIconsForExport: vi.fn(async () => []),
    getImage: vi.fn(async (id) => armazenadas.get(id) || null),
    storeImage: vi.fn(async (id, blob) => { armazenadas.set(id, blob); }),
    setBaseLayer: vi.fn(),
    addMap: vi.fn(),
    setCurrentMap: vi.fn(),
    clearAllDataStore: vi.fn(),
    discardMapsForReplacingImport: vi.fn(),
    isRemoteStoreSync: vi.fn(() => false),
    setSchemaVersion: vi.fn(),
    setGridStyle: vi.fn(),
    getLayersRepo: vi.fn(),
    setMapLayers: vi.fn(),
    flushPendingLayerWrites: vi.fn(),
    setMapOrder: vi.fn(),
    processCatalogLayersOnImport: vi.fn(),
    setCesium3dDataForImport: vi.fn(),
    setStreetview360DataForImport: vi.fn(),
    setMapTemporalConfig: vi.fn(),
    setMapComments: vi.fn(),
    importBriefings: vi.fn(),
    restoreCustomIconsFromImport: vi.fn(),
    getGroupManager: vi.fn(() => ({})),
}));

const { ExportImportService } = await import('@js/import_export/export-import.service.js');
const { buildImageUploads, ALLOWED_IMAGE_MIME } = await import('@js/import_export/atlas-image-upload.js');

// `FileReader` nao e global do Node, e `blobToBase64` depende dele. Sem esta ponte todo blob
// cairia no `catch` de `buildImageUploads` e o arquivo mediria uma lista vazia, verde por engano.
// Le o blob de verdade, e nao devolve dado fixo.
if (typeof globalThis.FileReader === 'undefined') {
    globalThis.FileReader = class {
        readAsDataURL(blob) {
            blob.arrayBuffer().then((buf) => {
                let binario = '';
                for (const byte of new Uint8Array(buf)) binario += String.fromCharCode(byte);
                this.result = `data:${blob.type || 'application/octet-stream'};base64,${btoa(binario)}`;
                this.onloadend?.();
            }).catch((e) => { this.error = e; this.onerror?.(); });
        }
    };
}

/** Cabecalho PNG de verdade: assinatura de 8 bytes mais o comeco do `IHDR`. */
const BYTES_PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
/** Cabecalho JFIF de verdade: `SOI` mais `APP0` com a etiqueta `JFIF`. */
const BYTES_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01]);
/** Contêiner RIFF de verdade: `RIFF`, tamanho, `WEBP`, `VP8 `. */
const BYTES_WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);
/** SVG de verdade, em texto. */
const BYTES_SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');

/**
 * Um dublê de JSZip que se comporta como o de produção no ponto que importa: `async('blob')`
 * devolve `Blob` SEM tipo (é isso que o navegador faz e é a origem do defeito), e
 * `async('arraybuffer')` devolve os bytes crus.
 * @param {Object<string, Uint8Array>} arquivos
 */
function zipFalso(arquivos) {
    const files = {};
    for (const nome of Object.keys(arquivos)) files[nome] = { name: nome };
    return {
        files,
        file(nome) {
            const bytes = arquivos[nome];
            if (!bytes) return null;
            return {
                async(tipo) {
                    if (tipo === 'arraybuffer') return Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
                    if (tipo === 'uint8array') return Promise.resolve(bytes);
                    return Promise.resolve(new Blob([bytes]));
                },
            };
        },
    };
}

/** @returns {ExportImportService} */
function servico() {
    return new ExportImportService({}, { deactivateCurrentTool: vi.fn() }, {}, null);
}

/** @param {Blob} blob @returns {Promise<number[]>} */
async function primeirosBytes(blob, n = 4) {
    return [...new Uint8Array(await blob.arrayBuffer())].slice(0, n);
}

beforeEach(() => { armazenadas.clear(); });

describe('B3-2: o blob restaurado do zip carrega o MIME da extensao', () => {
    it('da a cada imagem o tipo da extensao, e nao o tipo vazio do JSZip', async () => {
        const zip = zipFalso({
            'images/foto-a.jpg': BYTES_JPEG,
            'images/foto-b.jpeg': BYTES_JPEG,
            'images/simbolo.png': BYTES_PNG,
            'images/mapa.webp': BYTES_WEBP,
            'images/icone.svg': BYTES_SVG,
        });

        await servico().loadImagesFromZip(zip);

        expect([...armazenadas.keys()].sort()).toEqual(['foto-a', 'foto-b', 'icone', 'mapa', 'simbolo']);
        expect(armazenadas.get('foto-a').type).toBe('image/jpeg');
        expect(armazenadas.get('foto-b').type).toBe('image/jpeg');
        expect(armazenadas.get('simbolo').type).toBe('image/png');
        expect(armazenadas.get('mapa').type).toBe('image/webp');
        expect(armazenadas.get('icone').type).toBe('image/svg+xml');
    });

    it('nao inventa tipo: os bytes gravados continuam sendo os do zip', async () => {
        const zip = zipFalso({ 'images/foto-a.jpg': BYTES_JPEG, 'images/simbolo.png': BYTES_PNG });

        await servico().loadImagesFromZip(zip);

        expect(await primeirosBytes(armazenadas.get('foto-a'), 3)).toEqual([0xff, 0xd8, 0xff]);
        expect(await primeirosBytes(armazenadas.get('simbolo'))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    });

    it('extensao em maiuscula tambem casa (o nome no zip vem de quem exportou)', async () => {
        const zip = zipFalso({ 'images/FOTO_0001.JPG': BYTES_JPEG });

        await servico().loadImagesFromZip(zip);

        expect(armazenadas.get('FOTO_0001').type).toBe('image/jpeg');
    });
});

describe('B3-2: a subida fareja a assinatura quando o blob nao tem tipo', () => {
    it('declara image/jpeg para bytes JPEG sem tipo, em vez do image/png fixo', async () => {
        const blobs = new Map([
            ['id-jpeg', new Blob([BYTES_JPEG])],
            ['id-png', new Blob([BYTES_PNG])],
            ['id-webp', new Blob([BYTES_WEBP])],
        ]);

        const { uploads, skipped } = await buildImageUploads(blobs);

        expect(skipped).toEqual([]);
        const porId = Object.fromEntries(uploads.map((u) => [u.localId, u]));
        expect(porId['id-jpeg'].mimeType).toBe('image/jpeg');
        expect(porId['id-jpeg'].filename).toBe('id-jpeg.jpg');
        expect(porId['id-png'].mimeType).toBe('image/png');
        expect(porId['id-png'].filename).toBe('id-png.png');
        expect(porId['id-webp'].mimeType).toBe('image/webp');
        expect(porId['id-webp'].filename).toBe('id-webp.webp');
    });

    it('o tipo declarado no blob vence o faro (quem colou a foto no navegador ja tem MIME)', async () => {
        const blobs = new Map([['id-a', new Blob([BYTES_JPEG], { type: 'image/jpeg' })]]);

        const { uploads } = await buildImageUploads(blobs);

        expect(uploads[0].mimeType).toBe('image/jpeg');
        expect(uploads[0].filename).toBe('id-a.jpg');
    });

    it('SVG sem tipo vira recusa declarada, nao um PNG mentiroso que o servidor derruba', async () => {
        const blobs = new Map([['id-svg', new Blob([BYTES_SVG])]]);

        const { uploads, skipped } = await buildImageUploads(blobs);

        expect(uploads).toEqual([]);
        expect(skipped).toEqual(['id-svg']);
        expect(ALLOWED_IMAGE_MIME.has('image/svg+xml')).toBe(false);
    });

    it('bytes que nao sao imagem nenhuma continuam caindo no padrao PNG, como hoje', async () => {
        const blobs = new Map([['id-x', new Blob([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])])]]);

        const { uploads, skipped } = await buildImageUploads(blobs);

        expect(skipped).toEqual([]);
        expect(uploads[0].mimeType).toBe('image/png');
    });
});

describe('B2-4: o round-trip devolve o JPEG com a extensao certa', () => {
    it('arquivo -> store -> arquivo mantem .jpg no JPEG e .png no PNG', async () => {
        const zip = zipFalso({ 'images/foto-a.jpg': BYTES_JPEG, 'images/simbolo.png': BYTES_PNG });
        const svc = servico();

        await svc.loadImagesFromZip(zip);

        expect(svc.getBlobExtension(armazenadas.get('foto-a'))).toBe('jpg');
        expect(svc.getBlobExtension(armazenadas.get('simbolo'))).toBe('png');
    });
});
