import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises } from '../helpers/test-utils.js';

// ============================================================================
// Mock store-errors
// ============================================================================

vi.mock('../../src/js/store/store-errors.js', () => ({
    StoreErrorEvents: { STORE_PERSIST_ERROR: 'store:persistError' },
    emitStoreError: vi.fn()
}));

import { runTransaction } from '../../src/js/store/store-transaction.js';
import { emitStoreError } from '../../src/js/store/store-errors.js';

beforeEach(() => {
    vi.clearAllMocks();
});

// ============================================================================
// TESTS
// ============================================================================

describe('Transaction integrity under failure', () => {

    // ========================================================================
    // Persistence failure blocks all side effects
    // ========================================================================

    describe('persistence failure blocks all side effects', () => {
        it('persistFn throws → deferSync never called, deferAsync never called', async () => {
            const syncEffect = vi.fn();
            const asyncEffect = vi.fn().mockResolvedValue(undefined);

            await expect(
                runTransaction(async (tx) => {
                    tx.deferSync(syncEffect);
                    tx.deferAsync(asyncEffect);

                    return async () => {
                        throw new Error('IndexedDB quota exceeded');
                    };
                })
            ).rejects.toThrow('IndexedDB quota exceeded');

            expect(syncEffect).not.toHaveBeenCalled();
            expect(asyncEffect).not.toHaveBeenCalled();
        });

        it('STORE_PERSIST_ERROR emitted with operation context', async () => {
            try {
                await runTransaction(async () => {
                    return async () => {
                        throw new Error('disk full');
                    };
                });
            } catch {
                // Expected
            }

            expect(emitStoreError).toHaveBeenCalledWith(
                'store:persistError',
                expect.objectContaining({
                    operation: 'transaction',
                    error: 'disk full',
                    timestamp: expect.any(Number)
                })
            );
        });

        it('error is re-thrown for caller to handle', async () => {
            const error = new Error('write failure');
            await expect(
                runTransaction(async () => {
                    return async () => { throw error; };
                })
            ).rejects.toThrow('write failure');
        });
    });

    // ========================================================================
    // Sync side effect failure is non-fatal
    // ========================================================================

    describe('sync side effect failure is non-fatal', () => {
        it('deferSync throws → warning logged → deferAsync still executes', async () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const asyncEffect = vi.fn().mockResolvedValue(undefined);
            let persisted = false;

            await runTransaction(async (tx) => {
                tx.deferSync(() => {
                    throw new Error('color tracking failed');
                });
                tx.deferAsync(asyncEffect);

                return async () => { persisted = true; };
            });

            expect(persisted).toBe(true);
            expect(warnSpy).toHaveBeenCalledWith(
                'Sync side effect failed after persistence:',
                expect.any(Error)
            );
            expect(asyncEffect).toHaveBeenCalled();

            warnSpy.mockRestore();
        });

        it('multiple deferSync — one failing does not block others', async () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const order = [];

            await runTransaction(async (tx) => {
                tx.deferSync(() => { order.push('sync-1'); });
                tx.deferSync(() => { throw new Error('sync-2 failed'); });
                tx.deferSync(() => { order.push('sync-3'); });

                return async () => {};
            });

            expect(order).toEqual(['sync-1', 'sync-3']);
            warnSpy.mockRestore();
        });
    });

    // ========================================================================
    // Async side effect failure is non-fatal
    // ========================================================================

    describe('async side effect failure is non-fatal', () => {
        it('deferAsync rejects → warning logged, no throw', async () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            let persisted = false;

            await runTransaction(async (tx) => {
                tx.deferAsync(() => Promise.reject(new Error('sync queue down')));

                return async () => { persisted = true; };
            });

            expect(persisted).toBe(true);
            // The .catch() handler is fire-and-forget, so we need to flush microtasks
            await flushPromises();
            expect(warnSpy).toHaveBeenCalledWith(
                'Async side effect failed after persistence:',
                expect.any(Error)
            );
            warnSpy.mockRestore();
        });

        it('deferAsync that throws synchronously is caught', async () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            await runTransaction(async (tx) => {
                tx.deferAsync(() => { throw new Error('sync start failed'); });

                return async () => {};
            });

            expect(warnSpy).toHaveBeenCalledWith(
                'Async side effect failed to start:',
                expect.any(Error)
            );
            warnSpy.mockRestore();
        });
    });

    // ========================================================================
    // Side effect execution order
    // ========================================================================

    describe('side effect execution order', () => {
        it('deferSync runs in registration order, then deferAsync', async () => {
            const order = [];

            await runTransaction(async (tx) => {
                tx.deferSync(() => order.push('sync-1'));
                tx.deferSync(() => order.push('sync-2'));
                tx.deferAsync(() => {
                    order.push('async-1');
                    return Promise.resolve();
                });
                tx.deferAsync(() => {
                    order.push('async-2');
                    return Promise.resolve();
                });

                return async () => order.push('persist');
            });

            expect(order).toEqual(['persist', 'sync-1', 'sync-2', 'async-1', 'async-2']);
        });

        it('persist runs before any side effects', async () => {
            const order = [];

            await runTransaction(async (tx) => {
                tx.deferSync(() => order.push('side-effect'));

                return async () => order.push('persist');
            });

            expect(order[0]).toBe('persist');
            expect(order[1]).toBe('side-effect');
        });
    });

    // ========================================================================
    // Concurrent transactions
    // ========================================================================

    describe('concurrent transactions', () => {
        it('two runTransaction() calls complete independently', async () => {
            const results = [];

            const tx1 = runTransaction(async (tx) => {
                tx.deferSync(() => results.push('tx1-sync'));
                return async () => results.push('tx1-persist');
            });

            const tx2 = runTransaction(async (tx) => {
                tx.deferSync(() => results.push('tx2-sync'));
                return async () => results.push('tx2-persist');
            });

            await Promise.all([tx1, tx2]);

            expect(results).toContain('tx1-persist');
            expect(results).toContain('tx1-sync');
            expect(results).toContain('tx2-persist');
            expect(results).toContain('tx2-sync');
        });

        it('failure in one does not affect the other', async () => {
            const results = [];

            const tx1 = runTransaction(async () => {
                return async () => { throw new Error('tx1 failed'); };
            }).catch(() => results.push('tx1-failed'));

            const tx2 = runTransaction(async (tx) => {
                tx.deferSync(() => results.push('tx2-sync'));
                return async () => results.push('tx2-persist');
            });

            await Promise.all([tx1, tx2]);

            expect(results).toContain('tx1-failed');
            expect(results).toContain('tx2-persist');
            expect(results).toContain('tx2-sync');
        });
    });

    // ========================================================================
    // Re-entrancy guard (state machine)
    // ========================================================================

    describe('re-entrancy guard', () => {
        it('deferSync to committed tx throws', async () => {
            let capturedTx = null;

            await runTransaction(async (tx) => {
                capturedTx = tx;
                return async () => {};
            });

            // tx is now committed — attempting to defer should throw
            expect(() => capturedTx.deferSync(() => {}))
                .toThrow('Cannot defer to committed transaction');
        });

        it('deferAsync to committed tx throws', async () => {
            let capturedTx = null;

            await runTransaction(async (tx) => {
                capturedTx = tx;
                return async () => {};
            });

            expect(() => capturedTx.deferAsync(() => {}))
                .toThrow('Cannot defer to committed transaction');
        });

        it('deferSync to rolled_back tx throws', async () => {
            let capturedTx = null;

            try {
                await runTransaction(async (tx) => {
                    capturedTx = tx;
                    return async () => { throw new Error('fail'); };
                });
            } catch {
                // Expected
            }

            expect(() => capturedTx.deferSync(() => {}))
                .toThrow('Cannot defer to rolled_back transaction');
        });

        it('deferAsync to rolled_back tx throws', async () => {
            let capturedTx = null;

            try {
                await runTransaction(async (tx) => {
                    capturedTx = tx;
                    return async () => { throw new Error('fail'); };
                });
            } catch {
                // Expected
            }

            expect(() => capturedTx.deferAsync(() => {}))
                .toThrow('Cannot defer to rolled_back transaction');
        });
    });

    // ========================================================================
    // WorkFn failure (before persist function is returned)
    // ========================================================================

    describe('workFn failure', () => {
        it('error in workFn itself rolls back and emits error', async () => {
            const syncEffect = vi.fn();

            await expect(
                runTransaction(async (tx) => {
                    tx.deferSync(syncEffect);
                    throw new Error('data preparation failed');
                })
            ).rejects.toThrow('data preparation failed');

            expect(syncEffect).not.toHaveBeenCalled();
            expect(emitStoreError).toHaveBeenCalled();
        });

        it('workFn returning undefined causes TypeError (persistFn is not a function)', async () => {
            await expect(
                runTransaction(async () => {
                    // Forgot to return a persist function
                    return undefined;
                })
            ).rejects.toThrow();

            expect(emitStoreError).toHaveBeenCalledWith(
                'store:persistError',
                expect.objectContaining({
                    operation: 'transaction',
                    timestamp: expect.any(Number)
                })
            );
        });
    });
});
