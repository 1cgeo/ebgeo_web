// Path: tests/integration/image-sync.test.js
// §17.14/§17.19: the image gateway uploads/fetches blobs to/from the backend, gated
// on a connected atlas, and degrades to null (never throws) so the UI can fall back.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
    fetchImageBlob: vi.fn(),
    enfileirarBlob: vi.fn(),
    retomarBlobsPendentes: vi.fn(async () => ({ tentadas: 0, confirmadas: 0, pendentes: 0, recusadas: 0 })),
    esquecerPendenciasEmMemoria: vi.fn(),
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
    blobUploadPending: () => false,
    BlobUploadState: Object.freeze({
        PENDENTE: 'pendente', CONFIRMADO: 'confirmado', RECUSADO: 'recusado',
    }),
}));
vi.mock('../../src/js/store/sync/connection-state.js', () => ({
    connectionState: { isOnline: () => true, onStateChanged: vi.fn(() => () => {}) },
    ConnectionStates: Object.freeze({
        OFFLINE: 'offline', CONNECTING: 'connecting', ONLINE: 'online', RECONNECTING: 'reconnecting',
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
} from '../../src/js/store/sync/image-sync.js';

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
            imageId: 'img-9', blob, atlasId: 'atlas-1', origem: 'icone-personalizado',
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
