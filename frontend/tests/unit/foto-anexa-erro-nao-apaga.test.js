// Path: tests/unit/foto-anexa-erro-nao-apaga.test.js

/**
 * @fileoverview A PORTA DA FEIÇÃO (`userDataManager.addImage`): um erro na gravação não apaga a foto
 * (revisão da fase 2c, 2026-09-24).
 *
 * `runTransaction` pode lançar DEPOIS de a intenção estar no diário (persistência da entidade, cerca,
 * troca de escopo, marca de materialização). A intenção é reprojetada e ENVIADA no próximo connect,
 * citando a foto. Apagar os bytes e a pendência ali publicava, para todo par, a referência de uma
 * foto que ninguém ia mandar. A regra: num ERRO, mantém e envia; só a recusa LIMPA (nada gravado)
 * descarta. As portas do 3D e do 360 têm o mesmo caso nas suítes de `tests/store/`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ gravacao: 'ok', fotos: [] }));

vi.mock('@store', () => ({
    getMapData: vi.fn(async () => ({
        features: { points: [{ type: 'Feature', properties: { id: 'p1', source: 'point', images: [] }, geometry: { type: 'Point', coordinates: [0, 0] } }] },
    })),
    updateFeature: vi.fn(async (_tipo, feicao, _mapa, { transform }) => {
        if (h.gravacao === 'recusa') return undefined;
        transform(structuredClone(feicao));
        if (h.gravacao === 'erro') throw new Error('IndexedDB write failed');
        return undefined;
    }),
    getCurrentMapNameSync: () => 'Mapa',
    getStorageTypeFromSource: () => 'points',
    getEventBus: () => ({ emit: vi.fn(), on: vi.fn(), off: vi.fn() }),
}));
vi.mock('@store/photo-attach.js', () => ({
    prepararFotoAnexa: vi.fn(async (file) => {
        const foto = {
            item: { id: `foto-${h.fotos.length}`, name: file.name, thumbnail: 'data:image/jpeg;base64,/9j/' },
            bytes: 10,
            confirmar: vi.fn(),
            descartar: vi.fn(async () => {}),
        };
        h.fotos.push(foto);
        return foto;
    }),
}));
vi.mock('@utils/toast_service.js', () => ({ showWarning: vi.fn(), showToast: vi.fn(), showError: vi.fn(), showSuccess: vi.fn() }));
vi.mock('@sidebar/panels/notes-panel.js', () => ({ sanitizeHtml: (s) => s }));

const userDataManager = (await import('../../src/js/user_data/user_data_manager.js')).default;
const arquivo = () => ({ name: 'vistoria.jpg', type: 'image/jpeg', size: 1000 });

beforeEach(() => {
    h.fotos.length = 0;
    h.gravacao = 'ok';
});

describe('userDataManager.addImage: erro não é recusa', () => {
    it('a gravação que LANÇA manda a foto (confirmar), e não a apaga', async () => {
        h.gravacao = 'erro';
        // O gerente engole o erro e devolve null (o painel diz que não anexou); a foto, não.
        expect(await userDataManager.addImage('p1', 'point', arquivo())).toBeNull();
        expect(h.fotos[0].confirmar).toHaveBeenCalledTimes(1);
        expect(h.fotos[0].descartar).not.toHaveBeenCalled();
    });

    it('a recusa LIMPA (nada gravado) descarta', async () => {
        h.gravacao = 'recusa';
        expect(await userDataManager.addImage('p1', 'point', arquivo())).toBeNull();
        expect(h.fotos[0].descartar).toHaveBeenCalledTimes(1);
        expect(h.fotos[0].confirmar).not.toHaveBeenCalled();
    });

    it('a gravação que dá certo manda a foto', async () => {
        expect(await userDataManager.addImage('p1', 'point', arquivo())).toMatchObject({ id: 'foto-0' });
        expect(h.fotos[0].confirmar).toHaveBeenCalledTimes(1);
    });
});
