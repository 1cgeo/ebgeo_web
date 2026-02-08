import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runTransaction } from '../../src/js/store/store-transaction.js';

// Mock the store-errors module to prevent EventBus dependency
vi.mock('../../src/js/store/store-errors.js', () => ({
    StoreErrorEvents: { STORE_PERSIST_ERROR: 'store:persistError' },
    emitStoreError: vi.fn()
}));

import { emitStoreError } from '../../src/js/store/store-errors.js';

beforeEach(() => {
    vi.clearAllMocks();
});

// ============================================================================
// Successful transactions
// ============================================================================

describe('runTransaction - success path', () => {
    it('executes persistence function', async () => {
        const persistFn = vi.fn().mockResolvedValue(undefined);

        await runTransaction(async () => {
            return persistFn;
        });

        expect(persistFn).toHaveBeenCalledOnce();
    });

    it('runs deferred sync effects after persistence', async () => {
        const order = [];

        await runTransaction(async (tx) => {
            tx.deferSync(() => order.push('sync-effect'));
            return async () => { order.push('persist'); };
        });

        expect(order).toEqual(['persist', 'sync-effect']);
    });

    it('runs deferred async effects after sync effects', async () => {
        const order = [];

        await runTransaction(async (tx) => {
            tx.deferSync(() => order.push('sync'));
            tx.deferAsync(async () => order.push('async'));
            return async () => { order.push('persist'); };
        });

        expect(order).toEqual(['persist', 'sync', 'async']);
    });

    it('runs multiple deferred effects in order', async () => {
        const order = [];

        await runTransaction(async (tx) => {
            tx.deferSync(() => order.push('s1'));
            tx.deferSync(() => order.push('s2'));
            tx.deferAsync(async () => order.push('a1'));
            tx.deferAsync(async () => order.push('a2'));
            return async () => { order.push('persist'); };
        });

        expect(order).toEqual(['persist', 's1', 's2', 'a1', 'a2']);
    });
});

// ============================================================================
// Failed transactions (persistence failure)
// ============================================================================

describe('runTransaction - failure path', () => {
    it('does NOT run deferred effects when persistence fails', async () => {
        const syncEffect = vi.fn();
        const asyncEffect = vi.fn();

        await expect(runTransaction(async (tx) => {
            tx.deferSync(syncEffect);
            tx.deferAsync(asyncEffect);
            return async () => { throw new Error('IndexedDB write failed'); };
        })).rejects.toThrow('IndexedDB write failed');

        expect(syncEffect).not.toHaveBeenCalled();
        expect(asyncEffect).not.toHaveBeenCalled();
    });

    it('emits STORE_PERSIST_ERROR on failure', async () => {
        await expect(runTransaction(async () => {
            return async () => { throw new Error('DB error'); };
        })).rejects.toThrow('DB error');

        expect(emitStoreError).toHaveBeenCalledWith(
            'store:persistError',
            expect.objectContaining({
                operation: 'transaction',
                error: 'DB error'
            })
        );
    });

    it('re-throws the original error', async () => {
        const error = new Error('Specific error');
        await expect(runTransaction(async () => {
            return async () => { throw error; };
        })).rejects.toBe(error);
    });

    it('does NOT run effects when workFn throws', async () => {
        const syncEffect = vi.fn();

        await expect(runTransaction(async (tx) => {
            tx.deferSync(syncEffect);
            throw new Error('Preparation failed');
        })).rejects.toThrow('Preparation failed');

        expect(syncEffect).not.toHaveBeenCalled();
    });
});

// ============================================================================
// Transaction state invariants
// ============================================================================

describe('StoreTransaction state invariants', () => {
    it('cannot defer to committed transaction', async () => {
        let capturedTx;
        await runTransaction(async (tx) => {
            capturedTx = tx;
            return async () => {};
        });

        // Transaction is now committed — deferring should throw
        expect(() => capturedTx.deferSync(() => {}))
            .toThrow('Cannot defer to committed transaction');
    });

    it('cannot defer to rolled back transaction', async () => {
        let capturedTx;
        try {
            await runTransaction(async (tx) => {
                capturedTx = tx;
                return async () => { throw new Error('fail'); };
            });
        } catch (_) { /* expected */ }

        expect(() => capturedTx.deferSync(() => {}))
            .toThrow('Cannot defer to rolled_back transaction');
    });

    it('sync effect failure does not prevent other effects', async () => {
        const order = [];

        await runTransaction(async (tx) => {
            tx.deferSync(() => { throw new Error('effect 1 fails'); });
            tx.deferSync(() => order.push('effect 2 runs'));
            return async () => {};
        });

        expect(order).toEqual(['effect 2 runs']);
    });
});

// ============================================================================
// Backend integration scenarios
// ============================================================================

describe('Transaction patterns for backend integration', () => {
    it('simulates feature add: persist → color tracking → sync log', async () => {
        const results = [];

        await runTransaction(async (tx) => {
            // Prepare data
            const feature = { id: 'f1', type: 'Point', properties: { cor: '#ff0000' } };

            // Defer side effects
            tx.deferSync(() => results.push(`color:${feature.properties.cor}`));
            tx.deferAsync(async () => results.push(`sync:CREATE:${feature.id}`));

            // Return persistence function
            return async () => {
                results.push(`persist:${feature.id}`);
            };
        });

        expect(results).toEqual([
            'persist:f1',
            'color:#ff0000',
            'sync:CREATE:f1'
        ]);
    });

    it('simulates failed persist: no sync log emitted', async () => {
        const syncLogs = [];

        await expect(runTransaction(async (tx) => {
            tx.deferAsync(async () => syncLogs.push('logged'));
            return async () => { throw new Error('disk full'); };
        })).rejects.toThrow('disk full');

        expect(syncLogs).toHaveLength(0);
    });
});
