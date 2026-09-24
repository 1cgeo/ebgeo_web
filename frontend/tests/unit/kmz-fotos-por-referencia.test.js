// Path: tests/unit/kmz-fotos-por-referencia.test.js
//
// FASE 2a DAS FOTOS ANEXAS (2026-09-24): o KMZ leva a foto nos dois formatos. A inline é só
// decodificada; a por referência é lida do armazém de imagens (`getImage`, que cai no servidor), e a
// que não tem bytes em lugar nenhum fica fora do balão em vez de virar um link quebrado.

import { describe, it, expect, vi } from 'vitest';

const blobs = new Map();
vi.mock('@store', () => ({
    getImage: vi.fn(async (id) => blobs.get(id) ?? null),
    getCustomIconBlob: vi.fn(async () => null),
}));

const { collectPhotos } = await import('@js/import_export/kmz/kmz-assets.js');

function registroDuble() {
    const gravados = [];
    const porChave = new Map();
    const guardar = (key, extra) => {
        if (porChave.has(key)) return porChave.get(key);
        const record = { href: `files/fotos/${gravados.length}.${extra.extension}`, width: 0, height: 0 };
        porChave.set(key, record);
        gravados.push({ key, ...extra });
        return record;
    };
    return {
        gravados,
        add: (key, data, { extension = 'png' } = {}) => guardar(key, { tipo: 'blob', data, extension }),
        addBase64: (key, base64, { extension = 'jpg' } = {}) => guardar(key, { tipo: 'base64', data: base64, extension }),
    };
}

describe('collectPhotos nos dois formatos', () => {
    it('inline é decodificada; por referência vem do armazém; sem bytes fica de fora', async () => {
        const bytes = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
        blobs.set('ref-1', bytes);
        const registro = registroDuble();
        const feicao = {
            properties: {
                id: 'f1',
                images: [
                    { id: 'in-1', name: 'a.png', data: 'data:image/png;base64,iVBORw0KGgo=' },
                    { id: 'ref-1', name: 'b.jpg', thumbnail: 'data:image/jpeg;base64,AA' },
                    { id: 'ref-sem-bytes', name: 'c.jpg', thumbnail: 'data:image/jpeg;base64,AA' },
                ],
            },
        };
        const refs = await collectPhotos(registro, feicao);
        expect(refs.map((r) => r.name)).toEqual(['a.png', 'b.jpg']);
        expect(registro.gravados.map((g) => g.tipo)).toEqual(['base64', 'blob']);
        expect(registro.gravados[1].data).toBe(bytes);
        expect(registro.gravados[1].extension).toBe('jpg');
    });

    it('feição sem fotos devolve lista vazia', async () => {
        expect(await collectPhotos(registroDuble(), { properties: { id: 'f' } })).toEqual([]);
        expect(await collectPhotos(registroDuble(), null)).toEqual([]);
    });
});
