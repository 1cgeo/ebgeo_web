import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { activateScope, getActiveScope, remoteScope } from '../../src/js/store/atlas-namespace.js';
import { LocalRepository, localRepository } from '../../src/js/store/repositories/local.repository.js';
import { operationQueue } from '../../src/js/store/sync/operation-queue.js';
import { enableOperationLogging } from '../../src/js/store/sync/operation-dispatcher.js';
import { applyRemoteSnapshot, setRemoteHandlerEventBus } from '../../src/js/store/sync/remote-operation-handler.js';
import { createAtlas } from '../../src/js/store/atlas/atlas.entity.js';
import { createBriefing, updateBriefing, addSlide, updateSlide, removeSlide, reorderSlides, deleteBriefing, importBriefings }
    from '../../src/js/store/briefing.operations.js';

vi.mock('../../src/js/store/sync/permission-guard.js', async importOriginal => ({
    ...await importOriginal(), checkPermission: () => ({ allowed: true })
}));

beforeEach(async () => {
    vi.restoreAllMocks();
    const storage = new Map();
    vi.stubGlobal('localStorage', {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, String(value)),
        removeItem: key => storage.delete(key),
    });
    activateScope(remoteScope(crypto.randomUUID()));
    enableOperationLogging();
    setRemoteHandlerEventBus({ emit: vi.fn() });
});

const snapshot = (briefings = []) => ({ atlas: { ...createAtlas('Remoto'), id: getActiveScope().atlasId },
    maps: [], briefings, currentVersion: 1 });

describe('Briefing write-ahead persistence', () => {
    it('each accepted edit has its complete journal before entity persistence', async () => {
        const originalSave = LocalRepository.prototype.saveBriefing;
        const observed = [];
        vi.spyOn(LocalRepository.prototype, 'saveBriefing').mockImplementation(async function (id, value) {
            const pending = await operationQueue.getAll();
            const ready = await operationQueue.peek();
            const fresh = pending.filter(op => !observed.includes(op.id));
            expect(fresh.some(op => op.entityType === 'briefing' && op.entityId === id)).toBe(true);
            expect(ready.some(op => fresh.some(f => f.id === op.id))).toBe(false);
            observed.push(...fresh.map(op => op.id));
            return originalSave.call(this, id, value);
        });
        const briefing = await createBriefing({ name: 'Plano' });
        await updateBriefing(briefing.id, { name: 'Plano editado' });
        const slide = await addSlide(briefing.id, { title: 'Antes' });
        await updateSlide(briefing.id, slide.id, { title: 'Depois' });
        await reorderSlides(briefing.id, [slide.id]);
        await removeSlide(briefing.id, slide.id);
        expect((await operationQueue.peek()).length).toBe(observed.length);
        expect((await localRepository.getBriefing(briefing.id)).slides).toEqual([]);
    });

    it('journal failure prevents the briefing from being stored', async () => {
        const persist = vi.spyOn(LocalRepository.prototype, 'saveBriefing');
        await expect(createBriefing({ name: 'Nao aceito', settings: { invalid: () => {} } })).rejects.toThrow();
        expect(persist).not.toHaveBeenCalled();
        expect(await operationQueue.count()).toBe(0);
    });

    it('quota failure after the journal preserves one intention across queue reopening', async () => {
        vi.spyOn(LocalRepository.prototype, 'saveBriefing').mockRejectedValueOnce(new DOMException('quota', 'QuotaExceededError'));
        await expect(createBriefing({ name: 'Recuperavel' })).rejects.toThrow('quota');
        const pending = await operationQueue.getAll();
        expect(pending).toHaveLength(1);
        expect(pending[0].data.name).toBe('Recuperavel');
        expect(await localRepository.getBriefing(pending[0].entityId)).toBeNull();
        expect(await operationQueue.peek()).toEqual([]);
        expect(await operationQueue.forScope(getActiveScope()).getAll()).toEqual(pending);
    });

    it('concurrent slide additions keep every slide and both intentions per addition', async () => {
        const briefing = await createBriefing({ name: 'Concorrente' });
        const slides = await Promise.all(Array.from({ length: 8 }, (_, i) => addSlide(briefing.id, { title: `Slide ${i}` })));
        const stored = await localRepository.getBriefing(briefing.id);
        expect(new Set(stored.slides.map(slide => slide.id))).toEqual(new Set(slides.map(slide => slide.id)));
        expect(stored.slides.map(slide => slide.order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
        expect((await operationQueue.getAll()).filter(op => op.entityType === 'slide')).toHaveLength(8);
    });

    it('delete is journaled before the document disappears', async () => {
        const briefing = await createBriefing({ name: 'Excluir' });
        const originalDelete = LocalRepository.prototype.deleteBriefing;
        vi.spyOn(LocalRepository.prototype, 'deleteBriefing').mockImplementation(async function (id) {
            const pending = (await operationQueue.getAll()).filter(op => op.operationType === 'delete');
            expect(pending).toHaveLength(1);
            expect(pending[0].entityId).toBe(briefing.id);
            expect(await this.getBriefing(id)).not.toBeNull();
            return originalDelete.call(this, id);
        });
        expect(await deleteBriefing(briefing.id)).toBe(true);
        expect(await localRepository.getBriefing(briefing.id)).toBeNull();
    });

    it('publication is atomic if marking the second operation fails; snapshot recovers both original IDs', async () => {
        const originalDelete = IDBObjectStore.prototype.delete;
        let count = 0;
        vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function (key) {
            if (String(key).startsWith('__journal_state__') && ++count === 2) throw new Error('cut during publication');
            return originalDelete.call(this, key);
        });
        const slideId = crypto.randomUUID();
        await expect(createBriefing({ name: 'Completo', slides: [{ id: slideId, title: 'Preservado', order: 0 }] }))
            .rejects.toThrow('cut during publication');
        const pending = await operationQueue.getAll();
        expect(pending).toHaveLength(2);
        const projectedSlideId = pending.find(op => op.entityType === 'slide').entityId;
        expect(await operationQueue.peek()).toEqual([]);
        vi.restoreAllMocks();
        await applyRemoteSnapshot(snapshot());
        const reopened = new LocalRepository(getActiveScope());
        const briefingId = pending.find(op => op.entityType === 'briefing').entityId;
        expect((await reopened.getBriefing(briefingId)).slides.map(slide => slide.id)).toEqual([projectedSlideId]);
        expect((await operationQueue.peek()).map(op => op.id)).toEqual(pending.map(op => op.id));
        await applyRemoteSnapshot(snapshot());
        expect((await localRepository.getBriefing(briefingId)).slides.map(slide => slide.id)).toEqual([projectedSlideId]);
        expect(await operationQueue.getAll()).toEqual(pending);
    });

    it('recovers a prepared slide even when the parent envelope was already acknowledged', async () => {
        const briefing = await createBriefing({ name: 'Pai confirmado' });
        await operationQueue.dequeue((await operationQueue.getAll()).map(op => op.id));
        vi.spyOn(LocalRepository.prototype, 'saveBriefing').mockRejectedValueOnce(new Error('interrupted'));
        await expect(addSlide(briefing.id, { title: 'Slide pendente' })).rejects.toThrow('interrupted');
        const pending = await operationQueue.getAll();
        // Historical partial publication: parent delivery is known, child materialization was not marked.
        await operationQueue.dequeue([pending.find(op => op.entityType === 'briefing').id]);
        const slide = pending.find(op => op.entityType === 'slide');
        vi.restoreAllMocks();
        await applyRemoteSnapshot(snapshot([briefing]));
        const stored = await localRepository.getBriefing(briefing.id);
        expect(stored.slides.map(item => item.id)).toEqual([slide.entityId]);
        expect(stored.slides[0].title).toBe('Slide pendente');
        expect((await operationQueue.peek()).map(op => op.id)).toEqual([slide.id]);
    });

    it('a scope change during the read leaves both atlases and their queues untouched', async () => {
        const source = getActiveScope();
        let release;
        let entered;
        const reading = new Promise(resolve => { entered = resolve; });
        const gate = new Promise(resolve => { release = resolve; });
        vi.spyOn(LocalRepository.prototype, 'getBriefing').mockImplementationOnce(async () => {
            entered();
            await gate;
            return null;
        });
        const writing = createBriefing({ name: 'Escopo capturado' });
        const rejected = expect(writing).rejects.toThrow('atlas mudou');
        await reading;
        activateScope(remoteScope(crypto.randomUUID()));
        release();
        await rejected;
        expect(await operationQueue.forScope(source).getAll()).toEqual([]);
        expect(await operationQueue.count()).toBe(0);
        expect(await localRepository.forScope(source).getAllBriefings()).toEqual([]);
        expect(await localRepository.getAllBriefings()).toEqual([]);
    });

    it('remote import allocates fresh identities and journals the briefing and every slide', async () => {
        const imported = { id: crypto.randomUUID(), name: 'Importado',
            slides: [{ id: crypto.randomUUID(), title: 'Conteudo', order: 0 }] };
        const untouched = structuredClone(imported);
        expect(await importBriefings([imported])).toEqual({ imported: 1, skipped: 0 });
        expect(imported).toEqual(untouched);
        const briefings = await localRepository.getAllBriefings();
        expect(briefings).toHaveLength(1);
        expect(briefings[0].id).not.toBe(imported.id);
        expect(briefings[0].slides[0].id).not.toBe(imported.slides[0].id);
        expect(briefings[0].slides[0].title).toBe('Conteudo');
        expect((await operationQueue.peek()).map(op => op.entityType)).toEqual(['briefing', 'slide']);
    });
});
