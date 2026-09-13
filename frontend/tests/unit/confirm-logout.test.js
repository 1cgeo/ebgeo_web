import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
    list: vi.fn(), locals: vi.fn(), count: vi.fn(), confirm: vi.fn(), discard: vi.fn(),
    announce: vi.fn(), error: vi.fn(), quarantine: vi.fn(),
    pauseWrites: vi.fn(), pauseSends: vi.fn(), resumeWrites: vi.fn(), resumeSends: vi.fn(),
    holdBarrier: vi.fn(), releaseBarrier: vi.fn(),
}));
vi.mock('@store/remote-atlas.api.js', () => ({ listRemoteAtlases: fake.list, requestRemoteAtlasDiscard: fake.discard }));
vi.mock('@store/atlas-namespace.js', () => ({ readLocalAtlasRegistry: fake.locals, getActiveScope: () => ({ kind: 'remote' }) }));
vi.mock('@store/write-coordinator.js', () => ({
    pauseStoreWrites: fake.pauseWrites,
    holdLogoutBarrier: fake.holdBarrier,
}));
vi.mock('@store/sync/auto-flush-pause.js', () => ({ pauseAutoFlush: fake.pauseSends }));
vi.mock('@utils/tab-lock.js', () => ({ announceTabLockTeardown: fake.announce }));
vi.mock('@js/session/unsynced-work-exit.js', () => ({ countPendingOperationsFor: fake.count }));
vi.mock('@store/sync/quarantine-registry.js', () => ({ countQuarantine: fake.quarantine }));
vi.mock('@modals/confirm.modal.js', () => ({ showConfirm: fake.confirm }));
vi.mock('@utils/toast_service.js', () => ({ showError: fake.error }));
import { confirmLogoutWithPendingWork } from '@js/session/confirm-logout.js';

const A = { atlasId: 'A', dbSuffix: 'remote-A' };
const B = { atlasId: 'B', dbSuffix: 'remote-B' };
beforeEach(() => {
    vi.resetAllMocks();
    fake.list.mockResolvedValue([A, B]);
    fake.locals.mockResolvedValue([]);
    fake.count.mockResolvedValue(0);
    fake.quarantine.mockResolvedValue(0);
    fake.confirm.mockResolvedValue(false);
    fake.discard.mockResolvedValue([A, B]);
    fake.pauseWrites.mockReturnValue({ settled: Promise.resolve(), resume: fake.resumeWrites });
    fake.pauseSends.mockReturnValue({ settled: Promise.resolve(), resume: fake.resumeSends });
    fake.holdBarrier.mockResolvedValue({
        held: true, drained: true, supported: true, release: fake.releaseBarrier,
    });
});
afterEach(() => vi.useRealTimers());

describe('confirmed voluntary logout', () => {
    it('cancellation leaves every queue, namespace and peer untouched', async () => {
        fake.count.mockImplementation(async id => id === 'B' ? 2 : 0);
        expect(await confirmLogoutWithPendingWork()).toBe(false);
        expect(fake.confirm.mock.calls[0][1].message).toContain('2 operações');
        expect(fake.discard).not.toHaveBeenCalled();
        expect(fake.announce).not.toHaveBeenCalled();
        expect(fake.resumeWrites).toHaveBeenCalledOnce();
        expect(fake.resumeSends).toHaveBeenCalledOnce();
    });
    it('waits for a writer to finish before accepting an empty census', async () => {
        let finish;
        const settled = new Promise(resolve => { finish = resolve; });
        fake.pauseWrites.mockReturnValue({ settled, resume: fake.resumeWrites });
        const pending = confirmLogoutWithPendingWork();
        await Promise.resolve();
        await Promise.resolve();
        expect(fake.count).not.toHaveBeenCalled();
        fake.count.mockResolvedValue(1);
        finish();
        expect(await pending).toBe(false);
        expect(fake.confirm).toHaveBeenCalledOnce();
        expect(fake.discard).not.toHaveBeenCalled();
    });
    it('warns about unknown work when a send cannot settle within the deadline', async () => {
        vi.useFakeTimers();
        fake.pauseSends.mockReturnValue({ settled: new Promise(() => {}), resume: fake.resumeSends });
        const pending = confirmLogoutWithPendingWork();
        await vi.advanceTimersByTimeAsync(3001);
        expect(await pending).toBe(false);
        expect(fake.count).not.toHaveBeenCalled();
        expect(fake.confirm.mock.calls[0][1].message).toContain('Não foi possível verificar');
        expect(fake.resumeSends).toHaveBeenCalledOnce();
    });
    it('acceptance records discard before notifying other tabs', async () => {
        fake.count.mockResolvedValue(1);
        fake.confirm.mockResolvedValue(true);
        expect(await confirmLogoutWithPendingWork()).toBe(true);
        expect(fake.discard).toHaveBeenCalledOnce();
        expect(fake.announce).toHaveBeenCalledWith(['remote-A', 'remote-B']);
        expect(fake.confirm.mock.invocationCallOrder[0]).toBeLessThan(fake.discard.mock.invocationCallOrder[0]);
        expect(fake.discard.mock.invocationCallOrder[0]).toBeLessThan(fake.announce.mock.invocationCallOrder[0]);
    });
    it('an empty census exits without a dialog', async () => {
        expect(await confirmLogoutWithPendingWork()).toBe(true);
        expect(fake.count.mock.calls).toEqual([['A'], ['B']]);
        expect(fake.confirm).not.toHaveBeenCalled();
    });
    it('excludes rescued local namespaces even when the remote registry still contains them', async () => {
        fake.locals.mockResolvedValue([{ dbSuffix: 'remote-B' }]);
        await confirmLogoutWithPendingWork();
        expect(fake.count.mock.calls).toEqual([['A']]);
    });
    it.each([NaN, undefined])('unknown count %s requires confirmation', async value => {
        fake.count.mockResolvedValue(value);
        expect(await confirmLogoutWithPendingWork()).toBe(false);
        expect(fake.confirm.mock.calls[0][1].message).toContain('Não foi possível verificar');
        expect(fake.discard).not.toHaveBeenCalled();
    });
    it('a stalled queue read becomes an explicit unknown warning', async () => {
        vi.useFakeTimers();
        fake.count.mockImplementation(() => new Promise(() => {}));
        const result = confirmLogoutWithPendingWork();
        await vi.advanceTimersByTimeAsync(3001);
        expect(await result).toBe(false);
        expect(fake.confirm).toHaveBeenCalledOnce();
    });
    it('nomeia a quarentena separada do que aguarda envio', async () => {
        // 5 pendentes por atlas, 2 em quarentena: a frase diz 3 aguardando envio e 2 guardadas,
        // porque as 2 SOBREVIVEM ao descarte (D2) e o resto não. Dois atlas, então 10 e 4.
        fake.count.mockResolvedValue(5);
        fake.quarantine.mockResolvedValue(2);
        expect(await confirmLogoutWithPendingWork()).toBe(false);
        const message = fake.confirm.mock.calls[0][1].message;
        expect(message).toContain('6 alterações aguardando envio ao servidor e 4 guardadas para revisão');
        expect(message).toContain('continuam neste navegador');

        // CONTROLE NEGATIVO: sem quarentena, a frase é a de antes e nada promete sobrevivência.
        fake.confirm.mockClear();
        fake.quarantine.mockResolvedValue(0);
        await confirmLogoutWithPendingWork();
        const semQuarentena = fake.confirm.mock.calls[0][1].message;
        expect(semQuarentena).toContain('10 operações com envio pendente');
        expect(semQuarentena).not.toContain('revisão');
    });
    it('quarentena ilegível continua avisando, com a frase de um número só', async () => {
        fake.count.mockResolvedValue(4);
        fake.quarantine.mockRejectedValue(new Error('disco indisponível'));
        expect(await confirmLogoutWithPendingWork()).toBe(false);
        const message = fake.confirm.mock.calls[0][1].message;
        expect(message).toContain('8 operações com envio pendente');
        expect(message).not.toContain('guardada');
    });
    it('não pergunta nada à quarentena quando o censo é vazio', async () => {
        // A leitura extra é paga só quando há diálogo: fila vazia sai sem perguntar.
        expect(await confirmLogoutWithPendingWork()).toBe(true);
        expect(fake.quarantine).not.toHaveBeenCalled();
    });
    it('a barreira entre abas é tomada ANTES de qualquer contagem', async () => {
        // A ordem é o conteúdo desta guarda: contar com a irmã ainda escrevendo é a contagem
        // otimista do achado F5. A barreira é pedida sobre o escopo REMOTO montado, e o pedido
        // exclusivo é o que já recusa a próxima escrita da irmã.
        fake.count.mockResolvedValue(1);
        await confirmLogoutWithPendingWork();
        expect(fake.holdBarrier).toHaveBeenCalledOnce();
        expect(fake.holdBarrier.mock.calls[0][0]).toEqual({ kind: 'remote' });
        expect(fake.holdBarrier.mock.invocationCallOrder[0])
            .toBeLessThan(fake.count.mock.invocationCallOrder[0]);
        // CONTROLE NEGATIVO do próprio caso: a pausa por aba continua vindo antes da barreira,
        // senão haveria uma janela entre as duas em que esta aba ainda aceitaria escrita.
        expect(fake.pauseWrites.mock.invocationCallOrder[0])
            .toBeLessThan(fake.holdBarrier.mock.invocationCallOrder[0]);
    });
    it('cancelar solta a barreira, e confirmar também', async () => {
        fake.count.mockResolvedValue(1);
        expect(await confirmLogoutWithPendingWork()).toBe(false);
        expect(fake.releaseBarrier).toHaveBeenCalledOnce();

        fake.releaseBarrier.mockClear();
        fake.confirm.mockResolvedValue(true);
        expect(await confirmLogoutWithPendingWork()).toBe(true);
        expect(fake.releaseBarrier).toHaveBeenCalledOnce();
        // Soltar DEPOIS de marcar e avisar: a barreira cobre a janela inteira, e do anúncio em
        // diante quem recusa escrita tardia é o fence de época.
        expect(fake.announce.mock.invocationCallOrder[0])
            .toBeLessThan(fake.releaseBarrier.mock.invocationCallOrder[0]);
    });
    it('barreira que não drenou no prazo mantém a quantidade DESCONHECIDA', async () => {
        // A fila é legível e diz zero, e mesmo assim o diálogo aparece: o que não se sabe é se a
        // irmã parou de escrever, então o zero é sobre um instante que já passou.
        fake.count.mockResolvedValue(0);
        fake.holdBarrier.mockResolvedValue({
            held: false, drained: false, supported: true, release: fake.releaseBarrier,
        });
        expect(await confirmLogoutWithPendingWork()).toBe(false);
        expect(fake.count).not.toHaveBeenCalled();
        expect(fake.confirm.mock.calls[0][1].message).toContain('Não foi possível verificar');
        expect(fake.releaseBarrier).toHaveBeenCalledOnce();

        // CONTROLE NEGATIVO: com a MESMA fila vazia e a barreira drenada, não há diálogo nenhum.
        fake.confirm.mockClear();
        fake.holdBarrier.mockResolvedValue({
            held: true, drained: true, supported: true, release: fake.releaseBarrier,
        });
        expect(await confirmLogoutWithPendingWork()).toBe(true);
        expect(fake.confirm).not.toHaveBeenCalled();
    });
    it('failed registry reads require confirmation and failed writes cannot report success', async () => {
        fake.list.mockRejectedValue(new Error('disk unavailable'));
        expect(await confirmLogoutWithPendingWork()).toBe(false);
        expect(fake.discard).not.toHaveBeenCalled();
        fake.confirm.mockResolvedValue(true);
        fake.discard.mockRejectedValue(new Error('quota'));
        expect(await confirmLogoutWithPendingWork()).toBe(false);
        expect(fake.error).toHaveBeenCalledOnce();
        expect(fake.announce).not.toHaveBeenCalled();
    });
});
