// Path: tests/unit/foto-anexa-preparo.test.js
//
// FASE 2b DAS FOTOS ANEXAS (2026-09-24): o preparo de uma foto. O preparo só PROCESSA; os bytes vão
// para o armazém e a subida é REGISTRADA por `gravar`, que cada porta chama DENTRO da transação da
// entidade (revisão da fase 2c, item 5), antes da intenção; a transferência só começa depois do save
// (`confirmar`), e só a recusa limpa descarta a pendência e os bytes. O item nunca leva `data`.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ ordem: [], envio: null }));

vi.mock('../../src/js/utilities/image_utils.js', () => ({
    processImageFile: vi.fn(async (file) => {
        h.ordem.push('processar');
        return { blob: new Blob([new Uint8Array(7)], { type: 'image/jpeg' }), thumbnail: `data:image/jpeg;base64,${file.name}` };
    }),
}));
vi.mock('../../src/js/store/settings.operations.js', () => ({
    storeImage: vi.fn(async (id) => { h.ordem.push(`guardar:${id}`); }),
    removeImage: vi.fn(async (id) => { h.ordem.push(`apagar:${id}`); }),
}));
vi.mock('../../src/js/store/sync/image-sync.js', () => ({
    registrarEnvioDeImagem: vi.fn(async (_blob, id) => {
        h.ordem.push(`registrar:${id}`);
        h.envio = {
            enviar: vi.fn(() => h.ordem.push('enviar')),
            descartar: vi.fn(async () => { h.ordem.push('descartar'); }),
        };
        return { registrado: true, ...h.envio };
    }),
}));

const { prepararFotoAnexa } = await import('../../src/js/store/photo-attach.js');

beforeEach(() => {
    h.ordem.length = 0;
    h.envio = null;
});

describe('prepararFotoAnexa', () => {
    it('o preparo só processa; gravar guarda e registra, e o item leva só a referência e a miniatura', async () => {
        const foto = await prepararFotoAnexa({ name: 'IMG_1.jpg', type: 'image/png', size: 999 });
        const { id } = foto.item;
        expect(h.ordem, 'nada é escrito fora da transação').toEqual(['processar']);
        await foto.gravar();
        expect(h.ordem).toEqual(['processar', `guardar:${id}`, `registrar:${id}`]);
        expect(foto.item).toMatchObject({ name: 'IMG_1.jpg', type: 'image/jpeg', size: 7, thumbnail: 'data:image/jpeg;base64,IMG_1.jpg' });
        expect(foto.item).not.toHaveProperty('data');
        expect(id).toMatch(/^[0-9a-f-]{36}$/);
        expect(foto.bytes).toBe(7);
    });

    it('confirmar começa a transferência; nada sobe antes dele', async () => {
        const foto = await prepararFotoAnexa({ name: 'a.jpg', type: 'image/jpeg', size: 1 });
        await foto.gravar();
        expect(h.envio.enviar).not.toHaveBeenCalled();
        foto.confirmar();
        expect(h.envio.enviar).toHaveBeenCalledTimes(1);
        expect(h.envio.descartar).not.toHaveBeenCalled();
    });

    it('sem gravar, confirmar e descartar não fazem nada', async () => {
        const foto = await prepararFotoAnexa({ name: 'a.jpg', type: 'image/jpeg', size: 1 });
        foto.confirmar();
        await foto.descartar();
        expect(h.ordem).toEqual(['processar']);
    });

    it('descartar solta a pendência e apaga os bytes que nenhuma entidade referencia', async () => {
        const foto = await prepararFotoAnexa({ name: 'a.jpg', type: 'image/jpeg', size: 1 });
        await foto.gravar();
        await foto.descartar();
        expect(h.ordem.slice(-2)).toEqual(['descartar', `apagar:${foto.item.id}`]);
        expect(h.envio.enviar).not.toHaveBeenCalled();
    });
});
