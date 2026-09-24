// Path: tests/integration/briefing-edicoes-sobre-o-disco.test.js

/**
 * @fileoverview AS DUAS PORTAS DE ESCRITA DO EDITOR DE BRIEFING ESCREVEM SOBRE O DISCO, NAO SOBRE A
 * COPIA DO EDITOR.
 *
 * `applyBriefingEdits` recebe o PATCH do que a pessoa mudou e o aplica ao documento lido DENTRO da
 * transacao; `appendSlides` anexa a lista que esta no disco agora. As duas existem porque o editor
 * gravava a copia que leu na abertura e apagava o que um colega tinha feito depois (medido com duas
 * browsers em `frontend/tests/e2e-ui/briefing-editor-copia-velha.repro.spec.js`). Aqui o "colega" e'
 * uma escrita direta no repositorio, que e' o que a aplicacao de uma op remota faz.
 *
 * O que se afirma, nos dois lados: o documento guardado e as ops enfileiradas (a op de slide so'
 * para o slide que a pessoa mudou, e nenhuma DELETE).
 */

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { activateScope, remoteScope } from '../../src/js/store/atlas-namespace.js';
import { localRepository } from '../../src/js/store/repositories/local.repository.js';
import { operationQueue } from '../../src/js/store/sync/operation-queue.js';
import { enableOperationLogging } from '../../src/js/store/sync/operation-dispatcher.js';
import { setRemoteHandlerEventBus } from '../../src/js/store/sync/remote-operation-handler.js';
import { createBriefing, addSlide, applyBriefingEdits, appendSlides }
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

/** Um briefing com dois slides, "Um" e "Dois", e a fila zerada. */
async function palco() {
    const briefing = await createBriefing({ name: 'Plano', settings: { panelWidth: 350 } });
    const um = await addSlide(briefing.id, { title: 'Um', content: '<p>a</p>' });
    const dois = await addSlide(briefing.id, { title: 'Dois' });
    const antes = new Set((await operationQueue.getAll()).map(op => op.id));
    return { id: briefing.id, um: um.id, dois: dois.id, antes };
}

/** O colega grava direto no disco, como a aplicacao de uma op remota. */
async function colega(id, muda) {
    const doc = await localRepository.getBriefing(id);
    await localRepository.saveBriefing(id, muda(structuredClone(doc)));
}

const opsNovas = async (antes) => (await operationQueue.getAll()).filter(op => !antes.has(op.id));

describe('applyBriefingEdits', () => {
    it('o slide que o colega CRIOU sobrevive, e so o slide mudado gera op', async () => {
        const { id, um, antes } = await palco();
        await colega(id, doc => ({ ...doc, slides: [...doc.slides, { id: crypto.randomUUID(), order: 2, title: 'Tres (do colega)' }] }));

        await applyBriefingEdits(id, { fields: {}, slides: { [um]: { title: 'Um (editado)' } } });

        const guardado = await localRepository.getBriefing(id);
        expect(guardado.slides.map(s => s.title)).toEqual(['Um (editado)', 'Dois', 'Tres (do colega)']);
        expect(guardado.slides[0].content).toBe('<p>a</p>'); // so a chave do patch mudou
        const ops = await opsNovas(antes);
        expect(ops.filter(op => op.entityType === 'slide').map(op => [op.operationType, op.entityId]))
            .toEqual([['update', um]]);
    });

    it('o titulo que o colega reescreveu num slide NAO tocado continua', async () => {
        const { id, um, dois } = await palco();
        await colega(id, doc => ({ ...doc, slides: doc.slides.map(s => (s.id === dois ? { ...s, title: 'Dois (do colega)' } : s)) }));
        await applyBriefingEdits(id, { fields: { name: 'Plano B' }, slides: { [um]: { content: '<p>b</p>' } } });
        const guardado = await localRepository.getBriefing(id);
        expect(guardado.name).toBe('Plano B');
        expect(guardado.slides.map(s => [s.title, s.content ?? ''])).toEqual([['Um', '<p>b</p>'], ['Dois (do colega)', '']]);
    });

    it('um slide que o colega APAGOU nao ressuscita por causa do patch', async () => {
        const { id, um, dois, antes } = await palco();
        await colega(id, doc => ({ ...doc, slides: doc.slides.filter(s => s.id !== um) }));
        await applyBriefingEdits(id, { slides: { [um]: { title: 'editado no slide apagado' } } });
        const guardado = await localRepository.getBriefing(id);
        expect(guardado.slides.map(s => s.id)).toEqual([dois]);
        expect((await opsNovas(antes)).some(op => op.entityType === 'slide')).toBe(false);
    });

    it('settings e mesclado CHAVE por chave', async () => {
        const { id } = await palco();
        await colega(id, doc => ({ ...doc, settings: { ...doc.settings, panelBackgroundColor: 'rgba(0,0,0,1)' } }));
        await applyBriefingEdits(id, { fields: { settings: { panelWidth: 420 } } });
        const guardado = await localRepository.getBriefing(id);
        expect(guardado.settings.panelWidth).toBe(420);
        expect(guardado.settings.panelBackgroundColor).toBe('rgba(0,0,0,1)');
    });

    it('identidade, ordem e sincronia do slide nao vem do patch', async () => {
        const { id, um } = await palco();
        await applyBriefingEdits(id, { slides: { [um]: { id: 'outro', order: 9, sync: { version: 99 }, title: 'x' } } });
        const slide = (await localRepository.getBriefing(id)).slides[0];
        expect(slide.id).toBe(um);
        expect(slide.order).toBe(0);
        expect(slide.sync.version).not.toBe(99);
        expect(slide.title).toBe('x');
    });
});

describe('appendSlides', () => {
    it('anexa a lista que esta no disco AGORA, sem apagar o slide do colega', async () => {
        const { id, antes } = await palco();
        const doColega = crypto.randomUUID();
        await colega(id, doc => ({ ...doc, slides: [...doc.slides, { id: doColega, order: 2, title: 'Tres (do colega)' }] }));
        const novo = crypto.randomUUID();
        expect(await appendSlides(id, [{ id: novo, title: 'Importado' }])).toBe(true);
        const guardado = await localRepository.getBriefing(id);
        expect(guardado.slides.map(s => s.title)).toEqual(['Um', 'Dois', 'Tres (do colega)', 'Importado']);
        expect(guardado.slides.map(s => s.order)).toEqual([0, 1, 2, 3]);
        const ops = (await opsNovas(antes)).filter(op => op.entityType === 'slide');
        expect(ops.map(op => [op.operationType, op.entityId])).toEqual([['create', novo]]);
    });
});
