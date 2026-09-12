import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
    list: vi.fn(), locals: vi.fn(), count: vi.fn(), confirm: vi.fn(), discard: vi.fn(),
    announce: vi.fn(), error: vi.fn(),
}));
vi.mock('@store/remote-atlas.api.js', () => ({ listRemoteAtlases: fake.list, requestRemoteAtlasDiscard: fake.discard }));
vi.mock('@store/atlas-namespace.js', () => ({ readLocalAtlasRegistry: fake.locals }));
vi.mock('@utils/tab-lock.js', () => ({ announceTabLockTeardown: fake.announce }));
vi.mock('@js/session/unsynced-work-exit.js', () => ({ countPendingOperationsFor: fake.count }));
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
    fake.confirm.mockResolvedValue(false);
    fake.discard.mockResolvedValue([A, B]);
});
afterEach(() => vi.useRealTimers());

describe('confirmed voluntary logout', () => {
    it('cancellation leaves every queue, namespace and peer untouched', async () => {
        fake.count.mockImplementation(async id => id === 'B' ? 2 : 0);
        expect(await confirmLogoutWithPendingWork()).toBe(false);
        expect(fake.confirm.mock.calls[0][1].message).toContain('2 operações');
        expect(fake.discard).not.toHaveBeenCalled();
        expect(fake.announce).not.toHaveBeenCalled();
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
