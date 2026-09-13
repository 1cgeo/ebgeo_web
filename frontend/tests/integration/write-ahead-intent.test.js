import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { activateScope, remoteScope, localScope } from '../../src/js/store/atlas-namespace.js';
import { runTransaction } from '../../src/js/store/store-transaction.js';
import { operationQueue } from '../../src/js/store/sync/operation-queue.js';
import {
    enableOperationLogging,
    disableOperationLogging,
    OperationIntentRefusedError,
} from '../../src/js/store/sync/operation-dispatcher.js';
import { StoreErrorEvents, setStoreErrorEventBus } from '../../src/js/store/store-errors.js';

const atlasId = '11111111-1111-4111-8111-111111111111';
const mapId = '22222222-2222-4222-8222-222222222222';
const entityId = '33333333-3333-4333-8333-333333333333';

let bus;

beforeEach(async () => {
    vi.restoreAllMocks();
    activateScope(remoteScope(atlasId));
    await operationQueue.clear();
    enableOperationLogging();
    bus = { emit: vi.fn(), on: vi.fn(), off: vi.fn() };
    setStoreErrorEventBus(bus);
});

describe('Write-ahead edit intention', () => {
    it('intention is durable but not flushable before entity materialization', async () => {
        await runTransaction(async tx => {
            tx.recordOperation('feature', 'create', entityId, mapId, { properties: { id: entityId } });
            return async () => {
                expect(await operationQueue.count()).toBe(1);
                expect(await operationQueue.peek()).toEqual([]);
            };
        });
        expect(await operationQueue.peek()).toHaveLength(1);
    });

    it('a failed entity write preserves the intention for idempotent recovery', async () => {
        const effect = vi.fn();
        await expect(runTransaction(async tx => {
            tx.recordOperation('feature', 'create', entityId, mapId, { properties: { id: entityId } });
            tx.deferSync(effect);
            return async () => { throw new Error('cut after journal'); };
        })).rejects.toThrow('cut after journal');
        expect(effect).not.toHaveBeenCalled();
        const pending = await operationQueue.getAll();
        expect(pending).toHaveLength(1);
        expect(await operationQueue.peek()).toEqual([]);
        await operationQueue.markMaterialized(pending);
        expect((await operationQueue.peek())[0].id).toBe(pending[0].id);
    });

    it('a failed journal batch prevents entity and UI writes', async () => {
        const persist = vi.fn();
        const effect = vi.fn();
        await expect(runTransaction(async tx => {
            tx.recordOperation('feature', 'create', entityId, mapId, { invalid: () => {} });
            tx.deferSync(effect);
            return persist;
        })).rejects.toThrow();
        expect(persist).not.toHaveBeenCalled();
        expect(effect).not.toHaveBeenCalled();
        expect(await operationQueue.count()).toBe(0);
    });

    it('local editing without logging does not create a remote intention', async () => {
        // O ATLAS LOCAL E A METADE QUE CONTINUA IGUAL: ele nao tem fila de envio, entao o
        // registro desligado nao perde nada e a entidade grava normalmente.
        activateScope(localScope('local-1', 'local-1'));
        disableOperationLogging();
        const persist = vi.fn();
        await runTransaction(async tx => {
            tx.recordOperation('feature', 'create', entityId, mapId, {});
            return persist;
        });
        expect(persist).toHaveBeenCalledOnce();
        expect(await operationQueue.count()).toBe(0);
    });

    // F7. A janela entre montar o namespace remoto e terminar a negociacao tinha escopo
    // remoto com o registro desligado, e uma edicao ali gravava a entidade e devolvia
    // `undefined`: nenhuma op, nenhum erro, nenhum sinal em producao (o trace sai desligado).
    // CONTROLE NEGATIVO: trocando o `throw` de `persistOperationIntents` pelo `return` antigo,
    // `persist` passa a ser chamado e a asserção seguinte cai.
    it('remote editing without logging is refused instead of persisting without an intention', async () => {
        disableOperationLogging();
        const persist = vi.fn();
        const effect = vi.fn();
        await expect(runTransaction(async tx => {
            tx.recordOperation('feature', 'create', entityId, mapId, { properties: { id: entityId } });
            tx.deferSync(effect);
            return persist;
        })).rejects.toBeInstanceOf(OperationIntentRefusedError);
        expect(persist).not.toHaveBeenCalled();
        expect(effect).not.toHaveBeenCalled();
        expect(await operationQueue.count()).toBe(0);
        // A recusa CHEGA ao produtor: `runTransaction` a converte no evento de perda de dado.
        expect(bus.emit).toHaveBeenCalledWith(
            StoreErrorEvents.STORE_PERSIST_ERROR,
            expect.objectContaining({ operation: 'transaction' })
        );
    });

    // A outra metade do mesmo buraco: as descricoes existem, mas nenhuma delas pode virar op
    // (mapId que nao e UUID e' mapa local, que o servidor recusa com 22P02). Em atlas de
    // servidor isso e' bug do chamador, e nao silencio.
    it('a remote edit whose identities are all un-pushable is a caller error', async () => {
        const persist = vi.fn();
        await expect(runTransaction(async tx => {
            tx.recordOperation('feature', 'create', entityId, 'Principal', { properties: { id: entityId } });
            return persist;
        })).rejects.toBeInstanceOf(OperationIntentRefusedError);
        expect(persist).not.toHaveBeenCalled();
        expect(await operationQueue.count()).toBe(0);
    });
});
