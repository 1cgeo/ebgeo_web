// Path: tests/integration/customIcons.operations.test.js
// §17.19: custom marker icons become multiuser resources — when online the blob is
// uploaded so its id IS the backend image id (referenced on the feature), and a
// collaborator missing the blob locally fetches it from the backend on render.
//
// E DESDE 2026-09-13 A LISTA DO REGISTRO É WRITE-AHEAD, com o upload FORA da transação. A
// divisão é o que este arquivo mede, e ela não é estética: uma op descreve a LISTA, nunca os
// bytes, então o diário não tem como refazer um upload nem desfazer um blob. O que entra na
// transação é só a gravação da chave de atlas; o upload e o blob local rodam antes, e a
// compensação deles é o `deleteImageCompat` manual do `catch`.
//
// A fila aqui é a `operationQueue` de verdade, sobre `fake-indexeddb` e um escopo remoto ativo,
// porque o sujeito é a ORDEM entre duas gravações: um duplo de logging responderia "fui chamado"
// sem dizer quando.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { activateScope, getActiveScope, remoteScope } from '../../src/js/store/atlas-namespace.js';
import { operationQueue } from '../../src/js/store/sync/operation-queue.js';
import { enableOperationLogging } from '../../src/js/store/sync/operation-dispatcher.js';

const h = vi.hoisted(() => ({
    settings: new Map(),
    images: new Map(),
    uploadImageBlob: vi.fn(),
    fetchImageBlob: vi.fn(),
    setSetting: vi.fn(),
}));

vi.mock('../../src/js/store/repositories/index.js', () => ({
    getSettingCompat: async (k) => h.settings.get(k),
    setSettingCompat: (...a) => h.setSetting(...a),
    saveImageCompat: async (id, blob) => { h.images.set(id, blob); },
    getImageCompat: async (id) => h.images.get(id) || null,
    deleteImageCompat: async (id) => { h.images.delete(id); },
}));
vi.mock('../../src/js/store/services.js', () => ({
    getEventBus: () => ({ on: vi.fn(), emit: vi.fn() }),
}));
vi.mock('../../src/js/store/sync/image-sync.js', () => ({
    uploadImageBlob: (...a) => h.uploadImageBlob(...a),
    fetchImageBlob: (...a) => h.fetchImageBlob(...a),
}));
// Parcial: `generateUUID` fixo para o caso de fallback offline, e `isValidUUID` REAL, porque o
// recorte de id da porta write-ahead o consulta (um duplo sem ele derruba a transação com
// "No isValidUUID export is defined on the mock", que se lê como defeito do sujeito).
vi.mock('../../src/js/utilities/uuid.js', async (importOriginal) => ({
    ...await importOriginal(),
    generateUUID: () => 'local-uuid',
}));

import {
    addCustomIcon,
    getCustomIconBlob,
    getCustomIcons,
    invalidateCustomIconsCache,
} from '../../src/js/store/customIcons.operations.js';

beforeEach(() => {
    const storage = new Map();
    vi.stubGlobal('localStorage', {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, String(value)),
        removeItem: (key) => storage.delete(key),
    });
    h.settings.clear();
    h.images.clear();
    h.uploadImageBlob.mockReset();
    h.fetchImageBlob.mockReset();
    h.setSetting.mockReset();
    h.setSetting.mockImplementation(async (k, v) => { h.settings.set(k, v); });
    invalidateCustomIconsCache();
    activateScope(remoteScope(crypto.randomUUID()));
    enableOperationLogging();
});

const blob = () => new Blob([new Uint8Array([1, 2])], { type: 'image/png' });

describe('customIcons multiuser (§17.19)', () => {
    it('addCustomIcon uploads to the backend and uses the backend id when online', async () => {
        h.uploadImageBlob.mockResolvedValue({ id: 'backend-img' });
        const b = blob();
        const entry = await addCustomIcon({ name: 'Tank', blob: b, thumbnail: 'data:img' });
        expect(h.uploadImageBlob).toHaveBeenCalledWith(b, 'Tank.png');
        expect(entry.id).toBe('backend-img');         // feature.markerSymbol references this id
        expect(h.images.get('backend-img')).toBe(b);  // cached locally under the same id
        expect(h.settings.get('custom_icons').some((e) => e.id === 'backend-img')).toBe(true);
    });

    it('addCustomIcon falls back to a local UUID when offline (upload returns null)', async () => {
        h.uploadImageBlob.mockResolvedValue(null);
        const entry = await addCustomIcon({ name: 'X', blob: blob(), thumbnail: 't' });
        expect(entry.id).toBe('local-uuid');
        expect(h.images.has('local-uuid')).toBe(true);
    });

    it('getCustomIconBlob returns the local blob when present (no backend call)', async () => {
        const b = blob();
        h.images.set('id-1', b);
        expect(await getCustomIconBlob('id-1')).toBe(b);
        expect(h.fetchImageBlob).not.toHaveBeenCalled();
    });

    it('getCustomIconBlob fetches from the backend and caches when missing locally', async () => {
        const remote = blob();
        h.fetchImageBlob.mockResolvedValue(remote);
        const out = await getCustomIconBlob('backend-img');
        expect(h.fetchImageBlob).toHaveBeenCalledWith('backend-img');
        expect(out).toBe(remote);
        expect(h.images.get('backend-img')).toBe(remote); // cached for next render
    });

    it('getCustomIconBlob returns null when neither local nor backend has it', async () => {
        h.fetchImageBlob.mockResolvedValue(null);
        expect(await getCustomIconBlob('ghost')).toBeNull();
    });
});

describe('customIcons write-ahead', () => {
    it('a intenção da lista é registrada antes de a chave ir ao disco', async () => {
        h.uploadImageBlob.mockResolvedValue({ id: 'backend-img' });
        const scope = getActiveScope();
        h.setSetting.mockImplementation(async (k, v) => {
            const journal = await operationQueue.getAll();
            expect(journal).toHaveLength(1);
            expect(journal[0].entityType).toBe('setting');
            expect(journal[0].entityId).toBe(scope.atlasId);
            expect(journal[0].mapId).toBeNull();
            expect(journal[0].data.customIcons.map((e) => e.id)).toEqual(['backend-img']);
            expect(journal[0].previousData).toEqual({ customIcons: [] });
            // Preparada: a projeção local é esta gravação, que só agora acontece.
            expect(await operationQueue.peek()).toEqual([]);
            h.settings.set(k, v);
        });

        await addCustomIcon({ name: 'Tank', blob: blob(), thumbnail: 'data:img' });

        expect(h.setSetting).toHaveBeenCalledTimes(1);
        expect(await operationQueue.peek()).toHaveLength(1);
        expect(await getCustomIcons()).toHaveLength(1);
    });

    it('falha do diário não grava a chave, não move o cache e desfaz o blob', async () => {
        // A miniatura não é serializável, e é o diário que tenta cloná-la: a recusa acontece
        // antes de a chave ser gravada.
        h.uploadImageBlob.mockResolvedValue({ id: 'backend-img' });
        await expect(addCustomIcon({ name: 'X', blob: blob(), thumbnail: () => 'nao-clonavel' }))
            .rejects.toThrow();

        expect(h.setSetting).not.toHaveBeenCalled();
        expect(await operationQueue.count()).toBe(0);
        expect(await getCustomIcons()).toEqual([]);
        // O blob já estava no disco quando o diário recusou: a compensação manual o tira.
        expect(h.images.has('backend-img')).toBe(false);
    });

    it('falha na gravação da chave desfaz o blob e deixa a intenção recuperável', async () => {
        h.uploadImageBlob.mockResolvedValue({ id: 'backend-img' });
        h.setSetting.mockRejectedValueOnce(new DOMException('quota', 'QuotaExceededError'));

        await expect(addCustomIcon({ name: 'X', blob: blob(), thumbnail: 't' }))
            .rejects.toThrow('quota');

        // O cache de módulo NÃO andou (ele é efeito diferido, e efeito diferido só roda depois
        // da persistência): a paleta não oferece um ícone que o disco não tem.
        expect(await getCustomIcons()).toEqual([]);
        expect(h.images.has('backend-img')).toBe(false);
        // A intenção fica no diário, preparada e por isso NÃO enviável. Ela descreve a lista, e a
        // lista aponta para um blob que o rollback tirou desta máquina: o blob subiu ao servidor,
        // então quem a reprojeta o busca de lá. Quando o upload falha e o id é local, esse par
        // fica quebrado, e é a fila durável de blobs (bloco B8 do plano) que fecha o caso.
        expect(await operationQueue.count()).toBe(1);
        expect(await operationQueue.peek()).toEqual([]);
    });

    it('sem permissão não sobe blob, não grava chave e não registra intenção', async () => {
        const guard = await import('../../src/js/store/sync/permission-guard.js');
        vi.spyOn(guard, 'checkPermission')
            .mockReturnValue({ allowed: false, reason: 'read_only', required: 'EDIT' });

        expect(await addCustomIcon({ name: 'X', blob: blob(), thumbnail: 't' })).toBeNull();

        expect(h.uploadImageBlob).not.toHaveBeenCalled();
        expect(h.setSetting).not.toHaveBeenCalled();
        expect(await operationQueue.count()).toBe(0);
        vi.restoreAllMocks();
    });
});
