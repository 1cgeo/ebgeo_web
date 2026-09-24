// Path: tests/unit/foto-por-referencia.test.js
//
// FASE 2a DAS FOTOS ANEXAS: a leitura dos dois formatos (2026-09-24). Uma foto anexa pode chegar
// com os bytes dentro (`data`, o formato de sempre) ou só com a referência ao blob do atlas (`id`,
// o formato novo). Este arquivo prende as regras puras dessa leitura e as duas listas que dependem
// dela: o que um `.ebgeo` precisa levar em `images/` e o que ele avisa quando falta.

import { describe, it, expect } from 'vitest';
import {
    fotoTemBytesInline,
    idDeFotoPorReferencia,
    idsDeFotosPorReferencia,
} from '../../src/js/user_data/photo-refs.js';
import { requiredImagesOf } from '../../src/js/import_export/ebgeo-missing-images.js';

const inline = (id) => ({ id, name: `${id}.jpg`, data: 'data:image/jpeg;base64,AAAA', thumbnail: 'data:image/jpeg;base64,BB' });
const porReferencia = (id) => ({ id, name: `${id}.jpg`, thumbnail: 'data:image/jpeg;base64,BB' });

describe('as duas formas de uma foto', () => {
    it('com bytes dentro, e só a referência', () => {
        expect(fotoTemBytesInline(inline('a'))).toBe(true);
        expect(fotoTemBytesInline(porReferencia('b'))).toBe(false);
        expect(idDeFotoPorReferencia(inline('a'))).toBeNull();
        expect(idDeFotoPorReferencia(porReferencia('b'))).toBe('b');
    });

    it('o id solto (formato antigo dos itens 3D e 360) é referência', () => {
        expect(idDeFotoPorReferencia('c')).toBe('c');
        expect(fotoTemBytesInline('c')).toBe(false);
    });

    it('entradas ruins não viram id nem bytes', () => {
        for (const ruim of [null, undefined, '', 0, {}, { id: '' }, { id: 5 }, { data: '' }, []]) {
            expect(idDeFotoPorReferencia(ruim), JSON.stringify(ruim)).toBeNull();
            expect(fotoTemBytesInline(ruim)).toBe(false);
        }
    });
});

describe('idsDeFotosPorReferencia no documento do atlas', () => {
    const documento = {
        maps: {
            M1: {
                features: {
                    lines: [
                        { properties: { id: 'l1', images: [inline('i1'), porReferencia('r1')] } },
                        { properties: { id: 'l2', images: [porReferencia('r1'), porReferencia('r2')] } },
                        { properties: { id: 'l3' } },
                    ],
                    // O BALDE DAS FEIÇÕES DE IMAGEM também se chama `images`, e os itens dele são
                    // feições: não podem ser lidos como fotos.
                    images: [{ properties: { id: 'feicao-de-imagem', images: [porReferencia('r3')] } }],
                },
            },
        },
        cesium3d: { M1: { markers: [{ id: 'm1', images: [porReferencia('r4'), 'r5', inline('i2')] }], measurements: [{ images: [porReferencia('r6')] }] } },
        streetview360: { M1: { markers: [{ id: 's1', images: [porReferencia('r7')] }] } },
    };

    it('colhe as fotos por referência de feições, itens 3D e marcadores 360, sem repetir e na ordem', () => {
        expect(idsDeFotosPorReferencia(documento)).toEqual(['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7']);
    });

    it('não confunde a feição de imagem com uma foto', () => {
        expect(idsDeFotosPorReferencia(documento)).not.toContain('feicao-de-imagem');
    });

    it('documento vazio ou estranho não quebra', () => {
        for (const ruim of [null, undefined, {}, { maps: null }, { maps: { M: null } }, { maps: { M: { features: { lines: null } } } }]) {
            expect(idsDeFotosPorReferencia(ruim)).toEqual([]);
        }
    });

    it('o .ebgeo exige os bytes das fotos por referência, e só delas', () => {
        const exigidas = requiredImagesOf(documento);
        const anexos = exigidas.filter((m) => m.kind === 'anexo').map((m) => m.id);
        expect(anexos).toEqual(['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7']);
        expect(exigidas.map((m) => m.id)).not.toContain('i1');
        expect(exigidas.find((m) => m.id === 'feicao-de-imagem')?.kind).toBe('imagem');
    });
});
