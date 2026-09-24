// Path: tests/integration/recibo-briefing-slide-base-confirmada.repro.test.js
//
// A REVISÃO QUE O RECIBO CONFIRMA, NO BRIEFING E NO SLIDE (2026-09-23), o mesmo defeito que
// `recibo-3d-base-confirmada.repro.test.js` fechou para o 3D e o 360 um dia antes.
//
// O recibo de uma op que declarou base traz o `entityVersion` gravado, e `confirmEntityVersion` o
// carimba no documento local, para que a SEGUNDA edição seguida declare uma base que o servidor
// ainda reconhece. Logo depois, como BRIEFING e SLIDE são guardados (`CONVERGENCE_GUARDED`),
// `resolveLocalEdit` reaplica a própria op do autor pelo caminho de entrada, e os tratadores
// (`applyRemoteBriefingOp`, `applyLocalSlideIntent`) gravavam o payload da op POR CIMA, com o
// `confirmedVersion` de ANTES da edição. Três formas, as três aqui:
//
//  1. SLIDE: o autor muda o título, o recibo chega, muda de novo: a 2ª op declarava a base velha,
//     o servidor recusava "campos disputados", e o problema durável bloqueava o slide e, pelo
//     `batchId`, o lote inteiro. Variante no CREATE: o reparo apagava o carimbo, e a edição seguinte
//     saía sem base nenhuma (sem a proteção de base);
//  2. SLIDE de um COLEGA: o payload traz a base do AUTOR, que o servidor já passou, e ela era
//     gravada aqui como revisão confirmada; a próxima edição deste cliente era recusada;
//  3. BRIEFING: renomear duas vezes com um recibo no meio (e o mesmo para acrescentar dois slides,
//     que move a ordem do briefing).
//
// A regra consertada é a de `inboundSideEntity`: no reparo do autor, vale o carimbo do DISCO; na op
// do par, nenhuma base.
//
// CONTROLE NEGATIVO: sem `inboundSideEntity` em `applyLocalSlideIntent` os dois primeiros casos
// ficam vermelhos; sem ele em `applyRemoteBriefingOp`, o terceiro e o quarto.
//
// Casos derivados dos repros descartáveis da revisão da integração (rev4a).

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { activateScope, remoteScope } from '../../src/js/store/atlas-namespace.js';
import { localRepository } from '../../src/js/store/repositories/local.repository.js';
import { operationQueue } from '../../src/js/store/sync/operation-queue.js';
import { enableOperationLogging } from '../../src/js/store/sync/operation-dispatcher.js';
import {
    applyRemoteOperation,
    confirmEntityVersion,
    resolveLocalEdit,
    setRemoteHandlerEventBus,
    CONVERGENCE_GUARDED,
} from '../../src/js/store/sync/remote-operation-handler.js';
import { createBriefing, addSlide, updateSlide, updateBriefing } from '../../src/js/store/briefing.operations.js';

vi.mock('../../src/js/store/sync/permission-guard.js', async importOriginal => ({
    ...await importOriginal(), checkPermission: () => ({ allowed: true })
}));

/** A op mais recente da fila para aquela entidade e aquele tipo de operação. */
async function opNaFila(entityId, operationType) {
    const ops = (await operationQueue.getAll())
        .filter(op => op.entityId === entityId && op.operationType === operationType);
    return ops.at(-1);
}

/** O recibo de uma op, na ordem e com o portão de `sync-engine.js`. */
async function recibo(op, entityVersion, serverVersion) {
    expect(await confirmEntityVersion(op, entityVersion)).toBe(true);
    if (CONVERGENCE_GUARDED.has(op.entityType)) await resolveLocalEdit(op.entityId, serverVersion, op);
}

beforeEach(() => {
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

describe('recibo de slide e de briefing: a próxima edição declara a revisão confirmada', () => {
    it('slide: criar, recibo, editar, recibo, editar de novo -> a 3a op declara a revisão do 2o recibo', async () => {
        const briefing = await createBriefing({ name: 'Plano' });
        const slide = await addSlide(briefing.id, { title: 'Antes' });

        // O recibo do CREATE carimba 5, e o reparo não pode apagar o carimbo.
        const criacao = await opNaFila(slide.id, 'create');
        await recibo(criacao, 5, 40);
        await operationQueue.dequeue((await operationQueue.getAll()).map(op => op.id));
        const depoisDaCriacao = (await localRepository.getBriefing(briefing.id)).slides.find(s => s.id === slide.id);
        expect(depoisDaCriacao.confirmedVersion, 'o reparo do CREATE manteve o carimbo').toBe(5);

        await updateSlide(briefing.id, slide.id, { title: 'Um' });
        const u1 = await opNaFila(slide.id, 'update');
        expect(u1.baseVersion, 'a 1a edição declara a revisão do recibo do CREATE').toBe(5);
        const todas = await operationQueue.getAll();
        for (const op of todas) await recibo(op, op.entityId === slide.id ? 6 : 2, 41);
        await operationQueue.dequeue(todas.map(op => op.id));

        await updateSlide(briefing.id, slide.id, { title: 'Dois' });
        const u2 = await opNaFila(slide.id, 'update');
        expect(u2.baseVersion, 'a 2a edição declara a revisão que o recibo confirmou').toBe(6);
    });

    it('slide de um COLEGA não vira base confirmada deste cliente', async () => {
        const bId = crypto.randomUUID();
        const sId = crypto.randomUUID();
        await localRepository.saveBriefing(bId, { id: bId, name: 'Plano', confirmedVersion: 2,
            slides: [{ id: sId, order: 0, title: 'Antes', confirmedVersion: 3 }] });
        // O colega editou a partir da base 3; o servidor gravou 4 e ecoa o payload do colega.
        await applyRemoteOperation({ id: crypto.randomUUID(), entityType: 'slide', operationType: 'update',
            entityId: sId, mapId: bId, serverVersion: 50,
            data: { id: sId, order: 0, title: 'Do colega', confirmedVersion: 3 } });
        const gravado = (await localRepository.getBriefing(bId)).slides[0];
        expect(gravado.title, 'a edição do colega chegou').toBe('Do colega');
        await updateSlide(bId, sId, { title: 'Minha, vendo a do colega' });
        const op = (await operationQueue.getAll()).filter(o => o.entityId === sId).at(-1);
        expect(op.baseVersion ?? null, 'sem base velha do autor').toBeNull();
    });

    it('briefing: renomear, recibo, renomear de novo -> a 2a op declara a revisão do recibo', async () => {
        const bId = crypto.randomUUID();
        await localRepository.saveBriefing(bId, { id: bId, name: 'Plano', confirmedVersion: 2, slides: [] });
        await updateBriefing(bId, { name: 'Um' });
        const todas = await operationQueue.getAll();
        const u1 = todas.find(o => o.entityId === bId);
        expect(u1.baseVersion).toBe(2);
        await recibo(u1, 3, 41);
        await operationQueue.dequeue(todas.map(o => o.id));
        expect((await localRepository.getBriefing(bId)).confirmedVersion, 'o reparo manteve o carimbo').toBe(3);
        await updateBriefing(bId, { name: 'Dois' });
        const u2 = (await operationQueue.getAll()).find(o => o.entityId === bId);
        expect(u2.baseVersion).toBe(3);
    });

    it('briefing de um COLEGA não vira base confirmada deste cliente', async () => {
        const bId = crypto.randomUUID();
        await localRepository.saveBriefing(bId, { id: bId, name: 'Plano', confirmedVersion: 2, slides: [] });
        await applyRemoteOperation({ id: crypto.randomUUID(), entityType: 'briefing', operationType: 'update',
            entityId: bId, serverVersion: 60,
            data: { id: bId, name: 'Do colega', confirmedVersion: 2, slides: [] } });
        const gravado = await localRepository.getBriefing(bId);
        expect(gravado.name, 'a edição do colega chegou').toBe('Do colega');
        await updateBriefing(bId, { name: 'Minha' });
        const op = (await operationQueue.getAll()).find(o => o.entityId === bId);
        expect(op.baseVersion ?? null, 'sem base velha do autor').toBeNull();
    });
});
