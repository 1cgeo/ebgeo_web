// Path: tests/unit/fotos-anexas-na-fronteira-do-servidor.test.js

/**
 * @fileoverview FASE 2c DAS FOTOS ANEXAS (2026-09-24): a foto atravessa para o servidor como blob
 * com referência, e o id que o cliente envia é o id que o servidor exige.
 *
 * Três portas levam um atlas local ao servidor ("Salvar no servidor" do mapa, "Enviar ao servidor"
 * da tela de atlas e "Importar .ebgeo" direto no servidor), e as três passam por
 * `buildServerImportPayload`. Antes desta fase:
 *  - a foto de FEIÇÃO não era citada: a foto nova da fase 2b (só referência) subia sem os bytes, e o
 *    atlas publicado apontava para um id que ele nunca recebeu;
 *  - a foto INLINE de 3D/360 era citada pelo id, sem bytes no armazém: toda porta perguntava por uma
 *    figura "ausente" que estava viajando dentro do item, e declarava ao servidor que faltava.
 *
 * A CONCORDÂNCIA é o que se prende, nunca "o id mudou": o conjunto que o cliente sobe tem de ser o
 * conjunto que `importImageIds` do SERVIDOR cita, lido no mesmo processo, porque é essa igualdade
 * que `assertImageManifest` cobra na preparação atômica.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateUUID, isValidUUID } from '@utils/uuid.js';
import { buildServerImportPayload } from '@js/import_export/local-atlas-to-server.js';
import { blobDeDataUrl } from '@utils/image_utils.js';
import { importImageIds } from '../../../backend/src/modules/atlas/import-image-refs.js';

const blobs = new Map();

vi.mock('@store', () => ({
    getImage: vi.fn(async (id) => blobs.get(id) || null),
    getAllMapNamesStore: vi.fn(async () => ['Mapa A']),
}));

const { saveLocalAtlasToServer } = await import('@js/import_export/save-local-atlas.service.js');

// `FileReader` não é global do Node, e `blobToBase64` depende dele. Lê o blob de verdade.
if (typeof globalThis.FileReader === 'undefined') {
    globalThis.FileReader = class {
        readAsDataURL(blob) {
            blob.arrayBuffer().then((buf) => {
                let bruto = '';
                for (const b of new Uint8Array(buf)) bruto += String.fromCharCode(b);
                this.result = `data:${blob.type};base64,${btoa(bruto)}`;
                this.onloadend?.();
            }, (err) => { this.error = err; this.onerror?.(); });
        }
    };
}

/** Bytes de JPEG (a assinatura que o servidor fareja) com um corpo que identifica a foto. */
function jpegBytes(marca) {
    return Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, ...marca.split('').map((c) => c.charCodeAt(0)), 0xff, 0xd9]);
}

/** Data URL de bytes. */
function dataUrl(mime, bytes) {
    let bruto = '';
    for (const b of bytes) bruto += String.fromCharCode(b);
    return `data:${mime};base64,${btoa(bruto)}`;
}

const MINIATURA = 'data:image/jpeg;base64,/9j/miniatura';

/** Um documento de exportação com as formas de foto que existem no acervo. */
function documento(ids) {
    const inline = { id: ids.inline, name: 'camera.jpg', type: 'image/png', size: 5000000, data: dataUrl('image/jpeg', jpegBytes('inline')), thumbnail: MINIATURA, addedAt: 1 };
    return {
        maps: {
            'Mapa A': {
                features: {
                    points: [
                        {
                            type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] },
                            properties: {
                                id: generateUUID(), source: 'point', layerId: 'default',
                                images: [
                                    inline,
                                    { id: ids.ref, name: 'nova.jpg', type: 'image/jpeg', size: 20, thumbnail: MINIATURA, addedAt: 2 },
                                    // Fica INLINE, como sempre viajou: GIF é recusado pela subida.
                                    { id: ids.gif, name: 'velha.gif', type: 'image/gif', data: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', thumbnail: MINIATURA },
                                    // Fica INLINE: sem id não há nome para o blob.
                                    { name: 'sem-id.jpg', data: dataUrl('image/jpeg', jpegBytes('semid')), thumbnail: MINIATURA },
                                ],
                            },
                        },
                        // A MESMA foto inline numa feição duplicada: um blob só.
                        {
                            type: 'Feature', geometry: { type: 'Point', coordinates: [1, 1] },
                            properties: { id: generateUUID(), source: 'point', layerId: 'default', images: [{ ...inline }] },
                        },
                    ],
                },
            },
        },
        layers: { 'Mapa A': [{ id: 'default', name: 'Padrão', order: 0, visible: true, locked: false, opacity: 1 }] },
        cesium3d: {
            'Mapa A': {
                cameraPositions: {},
                markers: [{ id: generateUUID(), tilesetId: 't1', images: [{ id: ids.m3d, name: 'm.png', type: 'image/png', data: dataUrl('image/png', Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1])), thumbnail: MINIATURA }] }],
                measurements: [], viewsheds: [],
            },
        },
        streetview360: { 'Mapa A': { orientations: {}, markers: [{ id: generateUUID(), photoName: 'p', images: [ids.s360, { id: ids.gif3d, data: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' }] }] } },
    };
}

function novosIds() {
    return { inline: generateUUID(), ref: generateUUID(), gif: generateUUID(), m3d: generateUUID(), s360: generateUUID(), gif3d: generateUUID() };
}

describe('buildServerImportPayload: a foto anexa na fronteira do servidor', () => {
    it('cita a foto que SOBE (referência e inline convertível) e não cita a que fica inline', () => {
        const ids = novosIds();
        const { imageIds } = buildServerImportPayload(documento(ids), { name: 'A' });
        expect(new Set(imageIds)).toEqual(new Set([ids.inline, ids.ref, ids.m3d, ids.s360]));
    });

    it('a inline perde os bytes no payload, guarda miniatura e nome, e os bytes voltam em inlineImages', async () => {
        const ids = novosIds();
        const dados = documento(ids);
        const sondagem = buildServerImportPayload(dados, { name: 'A' });
        const imageIdMap = Object.fromEntries(sondagem.imageIds.map((id) => [id, generateUUID()]));
        const built = buildServerImportPayload(dados, { name: 'A', imageIdMap });

        const [primeira, segunda] = built.payload.maps[0].features;
        const [inline, ref, gif, semId] = primeira.properties.images;
        expect(inline).toEqual({ id: imageIdMap[ids.inline], name: 'camera.jpg', type: 'image/jpeg', size: 5000000, thumbnail: MINIATURA, addedAt: 1 });
        expect(ref.id).toBe(imageIdMap[ids.ref]);
        expect(ref).not.toHaveProperty('data');
        expect(gif).toEqual(dados.maps['Mapa A'].features.points[0].properties.images[2]);
        expect(semId.data).toMatch(/^data:image\/jpeg;base64,/);
        // A duplicata cita o MESMO id novo, e os bytes aparecem uma vez só.
        expect(segunda.properties.images[0].id).toBe(imageIdMap[ids.inline]);
        expect([...built.inlineImages.keys()].sort()).toEqual([ids.inline, ids.m3d].sort());
        // Os bytes DECODIFICADOS (item 7 da revisão): a mesma foto, tipada pelos bytes.
        const bytesDaInline = built.inlineImages.get(ids.inline);
        expect(bytesDaInline.type).toBe('image/jpeg');
        expect(new Uint8Array(await bytesDaInline.arrayBuffer())).toEqual(jpegBytes('inline'));

        const marcador3d = built.payload.maps[0].cesium3dData.find((r) => r.data_type === 'marker');
        expect(marcador3d.data.images).toEqual([{ id: imageIdMap[ids.m3d], name: 'm.png', type: 'image/png', thumbnail: MINIATURA }]);
        const marcador360 = built.payload.maps[0].streetview360Data.find((r) => r.data_type === 'marker');
        expect(marcador360.data.images[0]).toBe(imageIdMap[ids.s360]);
        expect(marcador360.data.images[1].data).toMatch(/^data:image\/gif/);

        // O documento de origem não é tocado.
        expect(dados.maps['Mapa A'].features.points[0].properties.images[0].data).toMatch(/^data:image\/jpeg/);
    });

    it('O SERVIDOR CITA EXATAMENTE O QUE O CLIENTE SOBE (a igualdade que assertImageManifest cobra)', () => {
        const ids = novosIds();
        const dados = documento(ids);
        const sondagem = buildServerImportPayload(dados, { name: 'A' });
        const imageIdMap = Object.fromEntries(sondagem.imageIds.map((id) => [id, generateUUID()]));
        const built = buildServerImportPayload(dados, { name: 'A', imageIdMap });
        const sobe = new Set(built.imageIds.map((id) => imageIdMap[id]));
        expect(importImageIds(built.payload)).toEqual(sobe);
        expect([...sobe].every(isValidUUID)).toBe(true);
    });

    it('foto inline acima do teto de imagem do servidor fica inline', () => {
        const id = generateUUID();
        // A cabeça é JPEG de verdade (o tipo vem dos bytes); o resto é enchimento.
        const cabeca = btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1));
        const grande = `data:image/jpeg;base64,${cabeca}${'A'.repeat(Math.ceil((10 * 1024 * 1024 + 3) * 4 / 3))}`;
        const dados = { maps: { M: { features: { points: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { id: generateUUID(), source: 'point', images: [{ id, data: grande, thumbnail: MINIATURA }] } }] } } } };
        const built = buildServerImportPayload(dados, { name: 'A' });
        expect(built.imageIds).toEqual([]);
        expect(built.inlineImages.size).toBe(0);
        expect(built.payload.maps[0].features[0].properties.images[0].data).toBe(grande);
        // Controle do próprio caso: um byte abaixo do teto, a mesma foto sobe.
        const cabe = `data:image/jpeg;base64,${cabeca}${'A'.repeat(Math.floor((10 * 1024 * 1024 - 12) / 3) * 4)}`;
        // Um objeto NOVO, como num documento novo: a decisão é memorizada por objeto de foto.
        dados.maps.M.features.points[0].properties.images[0] = { id, data: cabe, thumbnail: MINIATURA };
        expect(buildServerImportPayload(dados, { name: 'A' }).imageIds).toEqual([id]);
    });

    // DECODIFICA ANTES DE DECIDIR (revisão, item 7): uma cabeça de JPEG válida sobre um corpo que não
    // decodifica perdia o `data` e chegava ao servidor como referência sem bytes, contada como
    // ausente. Agora fica inline, e o que é citado e o que é convertido não podem discordar.
    it('foto inline cujo corpo não decodifica fica inline e não é citada', () => {
        const id = generateUUID();
        // A cabeça (os primeiros bytes, que decidem o tipo) decodifica; o corpo, não.
        const quebrada = `${dataUrl('image/jpeg', jpegBytes('x'.repeat(60)))}@@@corpo-quebrado`;
        const dados = { maps: { M: { features: { points: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { id: generateUUID(), source: 'point', images: [{ id, data: quebrada, thumbnail: MINIATURA }] } }] } } } };
        const built = buildServerImportPayload(dados, { name: 'A' });
        expect(built.imageIds).toEqual([]);
        expect(built.inlineImages.size).toBe(0);
        expect(built.payload.maps[0].features[0].properties.images[0].data).toBe(quebrada);
        expect(importImageIds(built.payload).size).toBe(0);
    });

    it('foto inline SEM miniatura fica inline: a galeria desenha a de referência pela miniatura', () => {
        const id = generateUUID();
        const dados = { maps: { M: { features: { points: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { id: generateUUID(), source: 'point', images: [{ id, data: dataUrl('image/jpeg', jpegBytes('sem')) }] } }] } } } };
        const built = buildServerImportPayload(dados, { name: 'A' });
        expect(built.imageIds).toEqual([]);
        expect(built.payload.maps[0].features[0].properties.images[0].data).toMatch(/^data:image\/jpeg/);
    });
});

describe('blobDeDataUrl', () => {
    it('devolve os bytes e o tipo do data URL', async () => {
        const bytes = jpegBytes('x');
        const blob = blobDeDataUrl(dataUrl('image/jpeg', bytes));
        expect(blob.type).toBe('image/jpeg');
        expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
    });

    it('devolve null para o que não é data URL base64 ou não decodifica', () => {
        expect(blobDeDataUrl(null)).toBeNull();
        expect(blobDeDataUrl('https://x/y.jpg')).toBeNull();
        expect(blobDeDataUrl('data:image/svg+xml,%3Csvg%3E')).toBeNull();
        expect(blobDeDataUrl('data:image/jpeg;base64,@@@')).toBeNull();
    });
});

describe('salvar atlas local no servidor: as fotos sobem pelos dois caminhos', () => {
    let ids, exportService, apiClient, importado, enviados, opcoes;

    beforeEach(() => {
        blobs.clear();
        ids = novosIds();
        // Só a foto por referência e a do 360 estão no armazém; as inline estão no documento.
        blobs.set(ids.ref, new Blob([jpegBytes('ref')], { type: 'image/jpeg' }));
        blobs.set(ids.s360, new Blob([jpegBytes('s360')], { type: 'image/jpeg' }));
        importado = null;
        enviados = [];
        exportService = { buildExportDataObject: vi.fn(async () => documento(ids)) };
        apiClient = {
            importAtlas: vi.fn(async (payload, options) => {
                importado = payload;
                opcoes = options;
                enviados.push(...options.images);
                return { id: generateUUID(), name: payload.atlas.name };
            }),
        };
    });

    it('sobe os bytes da inline e os do armazém, sem perguntar por imagem ausente', async () => {
        const confirmMissingImages = vi.fn(async () => true);
        const resultado = await saveLocalAtlasToServer(apiClient, exportService, { name: 'Com fotos', confirmMissingImages });

        expect(confirmMissingImages).not.toHaveBeenCalled();
        expect(opcoes.missingImageIds).toEqual([]);
        expect(resultado.imageStats).toMatchObject({ total: 4, uploaded: 4, missing: 0, skipped: 0 });

        const citados = importImageIds(importado);
        expect(new Set(enviados.map((u) => u.localId))).toEqual(citados);

        // Os bytes que subiram sob o id da foto inline SÃO os dela.
        const fotoInline = importado.maps[0].features[0].properties.images[0];
        const subida = enviados.find((u) => u.localId === fotoInline.id);
        expect(subida.mimeType).toBe('image/jpeg');
        expect(subida.data).toBe(dataUrl('image/jpeg', jpegBytes('inline')));
        const fotoRef = importado.maps[0].features[0].properties.images[1];
        expect(enviados.find((u) => u.localId === fotoRef.id).data).toBe(dataUrl('image/jpeg', jpegBytes('ref')));
        // Nenhum byte de foto convertida ficou dentro do payload.
        expect(JSON.stringify(importado)).not.toContain(btoa(String.fromCharCode(...jpegBytes('inline'))));
    });

    it('a foto por referência sem bytes no disco continua sendo pergunta, pelo id que ela tem', async () => {
        blobs.delete(ids.ref);
        const confirmMissingImages = vi.fn(async () => true);
        await saveLocalAtlasToServer(apiClient, exportService, { name: 'Sem uma', confirmMissingImages });
        expect(confirmMissingImages).toHaveBeenCalledTimes(1);
        expect(opcoes.missingImageIds).toEqual([importado.maps[0].features[0].properties.images[1].id]);
    });
});
