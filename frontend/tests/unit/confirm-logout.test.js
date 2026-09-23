import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
    list: vi.fn(), locals: vi.fn(), count: vi.fn(), confirm: vi.fn(), discard: vi.fn(),
    announce: vi.fn(), error: vi.fn(), quarantine: vi.fn(),
    pauseWrites: vi.fn(), pauseSends: vi.fn(), resumeWrites: vi.fn(), resumeSends: vi.fn(),
    holdBarrier: vi.fn(), releaseBarrier: vi.fn(), note: vi.fn(), saidaDaConta: vi.fn(),
}));
vi.mock('@js/session/uso-lote.js', async (importOriginal) => ({
    ...(await importOriginal()),
    anunciarSaidaDaConta: fake.saidaDaConta,
}));
vi.mock('@store/remote-atlas.api.js', () => ({
    listRemoteAtlases: fake.list,
    requestRemoteAtlasDiscard: fake.discard,
    noteRemoteNamespaceTeardown: fake.note,
}));
vi.mock('@store/atlas-namespace.js', () => ({
    readLocalAtlasRegistry: fake.locals,
    getActiveScope: () => ({ kind: 'remote', dbSuffix: 'remote-A' }),
    // O ESCOPO É CONSTRUÍDO A PARTIR DO ID, como a fábrica real faz, porque desde 2026-09-19 a
    // barreira é pedida sobre a LISTA do censo e não sobre o escopo ativo: sem este duplo, o
    // arquivo mediria a cobertura por um objeto que ninguém deriva.
    remoteScope: (atlasId) => ({ kind: 'remote', atlasId, dbSuffix: `remote-${atlasId}` }),
}));
vi.mock('@store/write-coordinator.js', () => ({
    pauseStoreWrites: fake.pauseWrites,
    holdLogoutBarriers: fake.holdBarrier,
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
    it('só a saída CONFIRMADA anuncia a saída da conta à telemetria de uso (decisão Q2 do dono)', async () => {
        // O Sair das quatro páginas passa por aqui, e é o único gesto que apaga os lotes de uso
        // pendentes da conta. Cancelar não pode apagar nada, e confirmar tem de anunciar uma vez.
        fake.count.mockResolvedValue(1);
        expect(await confirmLogoutWithPendingWork()).toBe(false);
        expect(fake.saidaDaConta).not.toHaveBeenCalled();

        fake.count.mockResolvedValue(0);
        expect(await confirmLogoutWithPendingWork()).toBe(true);
        expect(fake.saidaDaConta).toHaveBeenCalledOnce();
    });
    it('cancellation leaves every queue, namespace and peer untouched', async () => {
        fake.count.mockImplementation(async id => id === 'B' ? 2 : 0);
        expect(await confirmLogoutWithPendingWork()).toBe(false);
        // O diálogo nomeia a CONTAGEM somada do censo (0 em A, 2 em B), na palavra de quem lê
        // ("alteração"; "operação" era vocabulário da fila e saiu dos avisos em 2026-09-22).
        expect(fake.confirm.mock.calls[0][1].message).toContain('2 alterações que ainda não chegaram ao servidor');
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
        fake.announce.mockResolvedValue({ peers: 1, acked: 1, frozen: 1, timedOut: false, degraded: false });
        expect(await confirmLogoutWithPendingWork()).toBe(true);
        expect(fake.discard).toHaveBeenCalledOnce();
        expect(fake.announce).toHaveBeenCalledWith(['remote-A', 'remote-B']);
        // O RELATÓRIO FICA REGISTRADO: é ele que autoriza a destruição de um namespace que outra
        // aba ainda tem montado, e quem destrói roda depois (a varredura desta página, ou o
        // próximo boot deslogado). Descartá-lo fazia o descarte destruir às cegas.
        expect(fake.note).toHaveBeenCalledWith(
            ['remote-A', 'remote-B'],
            { peers: 1, acked: 1, frozen: 1, timedOut: false, degraded: false }
        );
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
        expect(semQuarentena).toContain('10 alterações que ainda não chegaram ao servidor');
        expect(semQuarentena).not.toContain('revisão');
    });
    it('quarentena ilegível continua avisando, com a frase de um número só', async () => {
        fake.count.mockResolvedValue(4);
        fake.quarantine.mockRejectedValue(new Error('disco indisponível'));
        expect(await confirmLogoutWithPendingWork()).toBe(false);
        const message = fake.confirm.mock.calls[0][1].message;
        expect(message).toContain('8 alterações que ainda não chegaram ao servidor');
        expect(message).not.toContain('guardada');
    });
    it('não pergunta nada à quarentena quando o censo é vazio', async () => {
        // A leitura extra é paga só quando há diálogo: fila vazia sai sem perguntar.
        expect(await confirmLogoutWithPendingWork()).toBe(true);
        expect(fake.quarantine).not.toHaveBeenCalled();
    });
    it('a barreira entre abas é tomada ANTES de qualquer contagem, sobre TODO o censo', async () => {
        // A ordem é metade do conteúdo desta guarda: contar com a irmã ainda escrevendo é a
        // contagem otimista do achado F5, e o pedido exclusivo é o que já recusa a próxima escrita
        // da irmã.
        //
        // A COBERTURA É A OUTRA METADE, desde 2026-09-19: a barreira é pedida sobre a MESMA lista
        // que o censo conta e que o descarte marca, e não sobre o escopo ativo. Enquanto foi só o
        // ativo, a guarda ficava apontada para a irmã BLOQUEADA (que não tem gesto possível) e
        // liberava a que seguia viva em outro atlas de servidor.
        fake.count.mockResolvedValue(1);
        await confirmLogoutWithPendingWork();
        expect(fake.holdBarrier).toHaveBeenCalledOnce();
        expect(
            fake.holdBarrier.mock.calls[0][0].map(s => s.dbSuffix).sort(),
            'os dois namespaces do censo entram na barreira',
        ).toEqual(['remote-A', 'remote-B']);
        expect(fake.holdBarrier.mock.invocationCallOrder[0])
            .toBeLessThan(fake.count.mock.invocationCallOrder[0]);
        // CONTROLE NEGATIVO do próprio caso: a pausa por aba continua vindo antes da barreira,
        // senão haveria uma janela entre as duas em que esta aba ainda aceitaria escrita.
        expect(fake.pauseWrites.mock.invocationCallOrder[0])
            .toBeLessThan(fake.holdBarrier.mock.invocationCallOrder[0]);
    });

    it('o namespace que um atlas LOCAL reivindica fica fora da barreira, como fica fora do censo', async () => {
        // A LISTA TEM DE SER A MESMA NOS DOIS USOS, e este é o lado que uma implementação
        // apressada erra: barrar um namespace que o descarte poupa custaria recusar a escrita de
        // um atlas resgatado que ninguém vai destruir. O ativo continua dentro por outro motivo,
        // que é esta aba escrever nele.
        fake.locals.mockResolvedValue([{ dbSuffix: 'remote-B' }]);
        fake.count.mockResolvedValue(1);
        await confirmLogoutWithPendingWork();
        expect(fake.holdBarrier.mock.calls[0][0].map(s => s.dbSuffix).sort())
            .toEqual(['remote-A']);
        expect(fake.count.mock.calls.map(c => c[0])).toEqual(['A']);
    });

    it('registro ilegível deixa a barreira no escopo ATIVO, em vez de não barrar nada', async () => {
        // DEGRADA PARA A COBERTURA ANTIGA, e não para nenhuma: uma listagem que falhou não sabe
        // quais namespaces existem, mas esta aba ainda sabe em qual está escrevendo.
        fake.list.mockRejectedValue(new Error('disk unavailable'));
        expect(await confirmLogoutWithPendingWork()).toBe(false);
        expect(fake.holdBarrier.mock.calls[0][0].map(s => s.dbSuffix)).toEqual(['remote-A']);
        expect(fake.count).not.toHaveBeenCalled();
        expect(fake.confirm.mock.calls[0][1].message).toContain('Não foi possível verificar');
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
