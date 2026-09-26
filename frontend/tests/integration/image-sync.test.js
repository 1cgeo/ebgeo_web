// Path: tests/integration/image-sync.test.js
// §17.14/§17.19: the image gateway uploads/fetches blobs to/from the backend, gated
// on a connected atlas, and degrades to null (never throws) so the UI can fall back.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
    fetchImageBlob: vi.fn(),
    enfileirarBlob: vi.fn(),
    retomarBlobsPendentes: vi.fn(async () => ({ tentadas: 0, confirmadas: 0, pendentes: 0, recusadas: 0 })),
    esquecerPendenciasEmMemoria: vi.fn(),
    registrarBlob: vi.fn(),
    enviarBlobRegistrado: vi.fn(),
}));
vi.mock('../../src/js/store/sync/api-client.js', () => ({
    apiClient: {
        fetchImageBlob: (...a) => h.fetchImageBlob(...a),
    },
}));

// O ENVIO NÃO PASSA MAIS PELO CLIENTE HTTP DAQUI, e o dublê diz isso: ele vai para a fila durável
// de blobs, que é quem escolhe a rota (a bulk, a única que preserva o id) e quem guarda a pendência
// antes do primeiro byte sair. O mecanismo dela é medido contra IndexedDB de verdade em
// tests/integration/blob-upload-queue.test.js; aqui se mede o SEAM.
vi.mock('../../src/js/store/sync/blob-upload-queue.js', () => ({
    enfileirarBlob: (...a) => h.enfileirarBlob(...a),
    retomarBlobsPendentes: (...a) => h.retomarBlobsPendentes(...a),
    esquecerPendenciasEmMemoria: (...a) => h.esquecerPendenciasEmMemoria(...a),
    registrarBlob: (...a) => h.registrarBlob(...a),
    enviarBlobRegistrado: (...a) => h.enviarBlobRegistrado(...a),
    descartarBlobRegistrado: vi.fn(async () => {}),
    blobUploadPending: () => false,
    BlobUploadState: Object.freeze({
        PENDENTE: 'pendente', CONFIRMADO: 'confirmado', RECUSADO: 'recusado',
    }),
}));
vi.mock('../../src/js/store/sync/connection-state.js', () => ({
    connectionState: { isOnline: () => true, onStateChanged: vi.fn(() => () => {}) },
    ConnectionStates: Object.freeze({
        OFFLINE: 'offline', CONNECTING: 'connecting', ONLINE: 'online', RECONNECTING: 'reconnecting',
        HTTP_ONLY: 'http-only',
    }),
}));
vi.mock('@utils/toast_service.js', () => ({
    showToast: vi.fn(), showSuccess: vi.fn(), showError: vi.fn(), showWarning: vi.fn(),
    showInChannel: vi.fn(),
}));

import {
    setImageSyncAtlas,
    isImageSyncOnline,
    uploadImageBlob,
    fetchImageBlob,
    registrarEnvioDeImagem,
} from '../../src/js/store/sync/image-sync.js';
import { showWarning } from '@utils/toast_service.js';

beforeEach(() => {
    h.fetchImageBlob.mockReset();
    h.enfileirarBlob.mockReset();
    h.retomarBlobsPendentes.mockClear();
    h.esquecerPendenciasEmMemoria.mockClear();
    setImageSyncAtlas(null);
});

describe('image-sync gateway (§17.14/§17.19)', () => {
    it('is offline until an atlas is set, online after', () => {
        expect(isImageSyncOnline()).toBe(false);
        setImageSyncAtlas('atlas-1');
        expect(isImageSyncOnline()).toBe(true);
        setImageSyncAtlas(null);
        expect(isImageSyncOnline()).toBe(false);
    });

    it('uploadImageBlob não enfileira nada quando não há atlas conectado', async () => {
        const blob = new Blob([new Uint8Array([1])], { type: 'image/png' });
        expect(await uploadImageBlob(blob, 'img-9'))
            .toEqual({ confirmado: false, registrado: false, estado: null });
        expect(h.enfileirarBlob).not.toHaveBeenCalled();
    });

    it('uploadImageBlob entrega blob, id e atlas à fila durável', async () => {
        setImageSyncAtlas('atlas-1');
        h.enfileirarBlob.mockResolvedValue({
            registrado: true, confirmado: true, estado: 'confirmado', motivo: '',
        });
        const blob = new Blob([new Uint8Array([1])], { type: 'image/png' });
        expect(await uploadImageBlob(blob, 'img-9', { origem: 'icone-personalizado' }))
            .toEqual({ confirmado: true, registrado: true, estado: 'confirmado' });
        expect(h.enfileirarBlob).toHaveBeenCalledWith({
            imageId: 'img-9', blob, atlasId: 'atlas-1', origem: 'icone-personalizado', foraDaFila: false,
        });
    });

    it('uploadImageBlob não lança quando a fila devolve pendência', async () => {
        setImageSyncAtlas('atlas-1');
        h.enfileirarBlob.mockResolvedValue({
            registrado: true, confirmado: false, estado: 'pendente', motivo: 'rede',
        });
        const blob = new Blob([new Uint8Array([1])], { type: 'image/png' });
        expect(await uploadImageBlob(blob, 'img-9'))
            .toEqual({ confirmado: false, registrado: true, estado: 'pendente' });
    });

    it('fetchImageBlob is null offline, delegates online', async () => {
        expect(await fetchImageBlob('img-9')).toBeNull();
        expect(h.fetchImageBlob).not.toHaveBeenCalled();

        setImageSyncAtlas('atlas-1');
        const blob = new Blob([new Uint8Array([2])], { type: 'image/png' });
        h.fetchImageBlob.mockResolvedValue(blob);
        expect(await fetchImageBlob('img-9')).toBe(blob);
        expect(h.fetchImageBlob).toHaveBeenCalledWith('atlas-1', 'img-9');
    });

    it('fetchImageBlob swallows errors (returns null)', async () => {
        setImageSyncAtlas('atlas-1');
        h.fetchImageBlob.mockRejectedValue(new Error('404'));
        expect(await fetchImageBlob('x')).toBeNull();
    });
});

// O AVISO DE RECUSA NOMEIA O QUE FOI RECUSADO (2026-09-24, segunda revisão das fotos anexas): uma FOTO
// é dita foto, pelo nome do arquivo, com o desfecho dela; a figura do mapa continua sendo figura. Antes,
// a foto antiga que uma edição converteu era "a figura", e a frase mandava inseri-la em outro formato.
describe('registrarEnvioDeImagem: o aviso de uma recusa definitiva', () => {
    async function recusado(origem, nome) {
        setImageSyncAtlas('atlas-1');
        h.registrarBlob.mockResolvedValue({ imageId: 'img-1' });
        h.enviarBlobRegistrado.mockResolvedValue({ confirmado: false, estado: 'recusado', causa: 'recusa', status: 400 });
        vi.mocked(showWarning).mockClear();
        const envio = await registrarEnvioDeImagem(new Blob([new Uint8Array([1])]), 'img-1', { origem, nomeDaFigura: () => nome });
        await envio.enviar();
        return vi.mocked(showWarning).mock.calls.map(([texto]) => texto);
    }

    it('foto anexada: nomeia a foto e diz que os colegas veem só a miniatura', async () => {
        expect(await recusado('foto-anexa', 'vistoria.jpg')).toEqual([
            'A foto "vistoria.jpg" não foi enviada ao servidor, e os colegas veem só a miniatura. Ela está nas pendências para revisão.',
        ]);
        expect(await recusado('foto-anexa-360', 'vistoria.jpg')).toHaveLength(1);
    });

    it('foto antiga convertida por uma edição: diz que a edição ficou nas pendências, sem mandar inserir nada', async () => {
        const [aviso] = await recusado('foto-convertida', 'antiga.jpg');
        expect(aviso).toBe('A foto "antiga.jpg" não foi enviada ao servidor, e a edição que a levava ficou nas pendências. Abra as pendências para decidir.');
        expect(aviso).not.toMatch(/figura|insira|formato/);
    });

    it('figura do mapa continua sendo figura', async () => {
        const [aviso] = await recusado('imagem', 'Imagem 3');
        expect(aviso.startsWith('A figura "Imagem 3" não foi enviada ao servidor')).toBe(true);
    });
});
