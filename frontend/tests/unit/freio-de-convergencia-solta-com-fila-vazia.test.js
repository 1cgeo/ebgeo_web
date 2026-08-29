// Path: tests/unit/freio-de-convergencia-solta-com-fila-vazia.test.js

/**
 * @fileoverview O freio de convergência tem de ser reconciliado TAMBÉM quando não há nada a
 * enviar, que era exatamente o estado em que ele ficava preso para sempre.
 *
 * O DEFEITO, medido em 2026-08-29 no `browser-collab-three-client-flow`. Três clientes recolorem
 * a mesma linha ao mesmo tempo. O perdedor ficava com a PRÓPRIA cor por 30 s (o teste inteiro),
 * enquanto os outros dois convergiam para o valor do servidor. Os spans do perdedor mostraram o
 * quadro inteiro: os `ws.inbound` do vencedor CHEGAVAM e não havia um único `apply.persist`
 * atrás deles. As ops estavam DEFERIDAS pelo freio (`pendingLocalEditCount`), e nada as soltava.
 *
 * A rede de segurança existia — `reconcilePendingLocalEdits`, documentada como "chamada depois de
 * todo flush" — e tinha um buraco na forma como era alcançada: ela mora dentro de
 * `engine.flush()`, e `flushOnce` sai ANTES de chamar o flush quando a fila local está vazia
 * (`hasWorkToFlush`). Um cliente que acabou de mandar tudo o que tinha nunca mais reconciliava.
 * Assimetria entre incremento e decremento do contador (compactação de fila, lote, ack sem
 * versão, lote envenenado — as quatro causas que o próprio `reconcilePendingLocalEdits` cita)
 * bastava para congelar aquela entidade até um F5.
 *
 * O CONTROLE NEGATIVO deste arquivo é o segundo caso: com o freio SOLTO, o laço não pode pagar a
 * reconciliação. Sem ele, um `reconcileConvergenceGuard()` incondicional passaria verde aqui e
 * cobraria uma leitura de IndexedDB a cada 1,5 s, para sempre, em toda sessão conectada.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const guarda = vi.hoisted(() => ({ preso: false }));

vi.mock('@store/sync/remote-operation-handler.js', () => ({
    hasPendingLocalEdits: () => guarda.preso,
}));
vi.mock('@store/sync/connection-state.js', () => ({
    connectionState: { isOnline: () => true },
}));
vi.mock('@store/sync/operation-queue.js', () => ({
    operationQueue: { count: async () => 0 },   // FILA VAZIA: o estado que expunha o buraco.
}));
vi.mock('@store/services.js', () => ({ getEventBus: () => null }));
vi.mock('@utils/toast_service.js', () => ({ showWarning: vi.fn() }));
vi.mock('@store/sync/sync-engine.js', () => ({ syncEngine: {} }));

const { startAutoFlush, stopAutoFlush } = await import('@store/sync/sync-flush.js');

/** Um motor que conta as duas chamadas que este arquivo distingue. */
function motorEspiao() {
    return {
        flush: vi.fn(async () => {}),
        reconcileConvergenceGuard: vi.fn(async () => {}),
    };
}

describe('auto-flush com a fila vazia', () => {
    beforeEach(() => {
        guarda.preso = false;
        stopAutoFlush();
    });
    afterEach(() => stopAutoFlush());

    it('reconcilia o freio de convergência quando há edição local presa, mesmo sem nada a enviar', async () => {
        guarda.preso = true;
        const engine = motorEspiao();

        startAutoFlush(engine, { intervalMs: 60000 }); // o start já dispara um ciclo imediato
        await vi.waitFor(() => expect(engine.reconcileConvergenceGuard).toHaveBeenCalled());

        // E NÃO empurrou nada: a fila está vazia, então o flush continua fora de questão. As duas
        // asserções juntas é que dizem "soltou o freio sem inventar tráfego".
        expect(engine.flush, 'nada foi enviado: a fila está vazia').not.toHaveBeenCalled();
    });

    it('CONTROLE: com o freio solto, o ciclo não paga reconciliação nenhuma', async () => {
        guarda.preso = false;
        const engine = motorEspiao();

        startAutoFlush(engine, { intervalMs: 60000 });
        // Espera ativa curta: o ciclo imediato do start já rodou quando esta microtarefa resolve.
        await Promise.resolve();
        await Promise.resolve();

        expect(engine.reconcileConvergenceGuard,
            'sem freio posto, o laço ocioso não vai ao IndexedDB').not.toHaveBeenCalled();
        expect(engine.flush).not.toHaveBeenCalled();
    });
});
