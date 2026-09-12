import { collabTest, expect } from './helpers/collab.fixtures.js';

collabTest.use({ collabOptions: { peers: 1, permission: 'write' } });

const readBriefings = page => page.evaluate(async () => {
    const store = await import('/src/js/store/briefing.operations.js');
    return store.getAllBriefings();
});

collabTest('offline briefing edits survive F5 with slides persisted on the server and peer', async ({ collab }, testInfo) => {
    const A = collab.author;
    const B = collab.peers[0];
    await A.locator('.sidebar-nav-btn[data-tab="briefings"]').click();
    await expect(A.locator('.briefings-create-btn')).toBeVisible();
    await A.context().setOffline(true);
    await A.locator('.briefings-create-btn').click();
    await expect(A.locator('#briefing-editor')).toBeVisible();
    await A.locator('.briefing-editor-name-input').fill('Plano preservado');
    await A.locator('.briefing-editor-name-input').blur();
    await A.locator('.briefing-editor-add-slide-btn[title="Adicionar slide"]').click();
    await expect(A.locator('.briefing-editor-slide-card')).toHaveCount(2);
    await expect(A.locator('.briefing-editor-slide-title-input')).toBeVisible();
    await A.locator('.briefing-editor-slide-title-input').fill('Reconhecimento');
    await A.locator('.briefing-editor-slide-title-input').blur();
    await expect.poll(async () => (await readBriefings(A))[0]?.slides.some(slide => slide.title === 'Reconhecimento')).toBe(true);
    const before = (await readBriefings(A))[0];
    const slideId = before.slides.find(slide => slide.title === 'Reconhecimento').id;
    const queued = await A.evaluate(async () => {
        const { operationQueue } = await import('/src/js/store/sync/operation-queue.js');
        return operationQueue.getAll();
    });
    expect(queued.some(op => op.entityType === 'slide' && op.entityId === slideId)).toBe(true);
    await A.context().setOffline(false);
    await A.reload();
    await expect.poll(async () => (await collab.db.raw.any('SELECT title FROM slides WHERE id=$1', [slideId]))[0]?.title,
        { timeout: 30000 }).toBe('Reconhecimento');
    await expect.poll(async () => (await readBriefings(B)).find(b => b.id === before.id)?.slides.find(s => s.id === slideId)?.title,
        { timeout: 20000 }).toBe('Reconhecimento');
    await expect.poll(async () => (await readBriefings(A)).find(b => b.id === before.id)?.slides.find(s => s.id === slideId)?.title).toBe('Reconhecimento');
    expect((await readBriefings(A)).find(b => b.id === before.id)?.slides).toHaveLength(2);
    await expect.poll(async () => (await collab.db.raw.any('SELECT op_id FROM operations WHERE atlas_id=$1 AND op_id=ANY($2::text[])',
        [collab.atlasId, queued.map(op => op.id)])).length).toBe(queued.length);
    await A.locator('.sidebar-nav-btn[data-tab="briefings"]').click();
    const card = A.locator(`.briefing-card[data-briefing-id="${before.id}"]`);
    await expect(card).toContainText('Plano preservado');
    await card.locator('.edit-btn').click();
    await expect(A.locator('.briefing-editor-name-input')).toHaveValue('Plano preservado');
    await expect(A.locator('.briefing-editor-slide-card')).toHaveCount(2);
    await A.locator(`.briefing-editor-slide-card[data-slide-id="${slideId}"]`).click();
    await expect(A.locator('.briefing-editor-slide-title-input')).toHaveValue('Reconhecimento');
    await A.screenshot({ path: testInfo.outputPath('briefing-recuperado.png'), animations: 'disabled' });
});

collabTest('new briefings and imported copies persist every initial slide with distinct identities', async ({ collab }) => {
    const A = collab.author;
    const result = await A.evaluate(async () => {
        const { createBriefing, importBriefings, getAllBriefings } = await import('/src/js/store/briefing.operations.js');
        const original = await createBriefing({ name: 'Original', slides: [
            { id: crypto.randomUUID(), title: 'Primeiro', content: '<p>Conteúdo preservado</p>', order: 0, mode: '2d' },
            { id: crypto.randomUUID(), title: 'Segundo', content: '<p>Referência</p>', order: 1, mode: '2d' }
        ] });
        const input = structuredClone(original);
        await importBriefings([input]);
        return { original, input, all: await getAllBriefings() };
    });
    expect(result.input).toEqual(result.original);
    expect(result.all).toHaveLength(2);
    const ids = result.all.flatMap(b => b.slides.map(s => s.id));
    expect(new Set(ids).size).toBe(4);
    await expect.poll(async () => (await collab.db.raw.any('SELECT id FROM slides WHERE id=ANY($1::uuid[])', [ids])).length,
        { timeout: 30000 }).toBe(4);
    await A.reload();
    await expect.poll(async () => (await readBriefings(A)).flatMap(b => b.slides.map(s => s.id)).sort()).toEqual(ids.sort());
    for (const briefing of await readBriefings(A)) {
        expect(briefing.slides.map(s => s.title)).toEqual(['Primeiro', 'Segundo']);
        expect(briefing.slides[0].content).toBe('<p>Conteúdo preservado</p>');
    }
});

collabTest('F5 recovers a prepared briefing and slide after an entity write failure', async ({ collab }) => {
    const A = collab.author;
    const pending = await A.evaluate(async () => {
        const { LocalRepository } = await import('/src/js/store/repositories/local.repository.js');
        const { createBriefing } = await import('/src/js/store/briefing.operations.js');
        const { operationQueue } = await import('/src/js/store/sync/operation-queue.js');
        const original = LocalRepository.prototype.saveBriefing;
        let error;
        LocalRepository.prototype.saveBriefing = async () => { throw new DOMException('quota injected', 'QuotaExceededError'); };
        try {
            await createBriefing({ name: 'Recuperação após falha', slides: [
                { title: 'Intenção recuperada', content: '<p>Preservado</p>', mode: '2d', order: 0 }
            ] });
        } catch (failure) {
            error = failure.name;
        } finally {
            LocalRepository.prototype.saveBriefing = original;
        }
        return { error, operations: await operationQueue.getAll(), ready: await operationQueue.peek() };
    });
    expect(pending.error).toBe('QuotaExceededError');
    expect(pending.ready).toEqual([]);
    expect(pending.operations.map(op => op.entityType)).toEqual(['briefing', 'slide']);
    const briefingId = pending.operations[0].entityId;
    const slideId = pending.operations[1].entityId;
    expect(await collab.db.raw.any('SELECT id FROM briefings WHERE id=$1', [briefingId])).toEqual([]);
    await A.reload();
    await expect.poll(async () => (await collab.db.raw.any('SELECT title FROM slides WHERE id=$1', [slideId]))[0]?.title,
        { timeout: 30000 }).toBe('Intenção recuperada');
    await expect.poll(async () => (await readBriefings(A)).find(b => b.id === briefingId)?.slides.map(s => s.id)).toEqual([slideId]);
    await expect.poll(async () => (await collab.db.raw.any('SELECT op_id FROM operations WHERE atlas_id=$1 AND op_id=ANY($2::text[])',
        [collab.atlasId, pending.operations.map(op => op.id)])).length).toBe(2);
});
