// Path: tests/integration/barreira-de-logout-entre-abas.test.js

/**
 * @fileoverview A BARREIRA DE ESCRITA DO LOGOUT, medida com o `navigator.locks` DE VERDADE.
 *
 * O achado F5: a pausa de escritores do logout era um `WeakMap` de módulo, isto é, por ABA. O
 * diálogo contava as pendências de todo namespace de servidor DESTE navegador e depois as
 * destruía, irmãs incluídas, com uma contagem tirada enquanto a irmã ainda escrevia. Nenhuma
 * mensagem prova que uma aba parou (uma aba congelada ou estrangulada não responde e volta a
 * escrever ao acordar), então a barreira é um Web Lock por escopo remoto: fato do agente de
 * usuário, não afirmação num canal.
 *
 * COMO ESTE ARQUIVO SIMULA DUAS ABAS. O lock da irmã é pedido DIRETAMENTE ao
 * `navigator.locks` (que existe no node que roda a suíte, medido em `atlas-namespace.test.js`),
 * fora do módulo sob teste, com o nome ESCRITO À MÃO. Duas razões, as mesmas de
 * `remote-atlas-api.test.js`: derivar o nome da mesma função que o código usa passaria verde com
 * a derivação errada, e um lock que não passa pelo módulo é, para ele, indistinguível do lock de
 * outro cliente.
 *
 * O QUE A MEDIÇÃO PROVA, e é a propriedade que a barreira compra: um pedido EXCLUSIVO meramente
 * PENDENTE já recusa todo `shared ifAvailable` posterior, porque a fila é FIFO por nome. Ou seja,
 * a escrita da irmã para no instante em que o diálogo pergunta, sem mensagem nenhuma, e a
 * CONCESSÃO do exclusivo é a evidência de que as escritas em voo terminaram. É essa concessão que
 * o diálogo espera antes de contar, com prazo; prazo estourado continua "quantidade desconhecida".
 */

import 'fake-indexeddb/auto';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { activateScope, clearActiveScope, remoteScope, localScope } from '../../src/js/store/atlas-namespace.js';
import {
    holdLogoutBarrier,
    enterCoordinatedWrite,
    logoutBarrierBlocks,
    logoutBarrierLockName,
    hasLogoutBarrierSupport,
    LOGOUT_BARRIER_NOTICE
} from '../../src/js/store/write-coordinator.js';
import { runTransaction } from '../../src/js/store/store-transaction.js';
import { StoreErrorEvents, setStoreErrorEventBus } from '../../src/js/store/store-errors.js';

const ATLAS = 'aaaa1111-1111-4111-8111-111111111111';
/** O nome escrito à mão, não derivado (ver o cabeçalho). */
const NOME = 'ebgeo-atlas-logout:#remote-aaaa1111-1111-4111-8111-111111111111';

/** Eventos de erro de store emitidos, na ordem. */
let emitidos = [];

/**
 * Segura a barreira como faria OUTRA ABA no meio de uma escrita: `shared`, pelo lock de verdade.
 * @param {string} nome - Nome do lock.
 * @returns {Promise<() => Promise<void>>} Função que solta (e espera a soltura).
 */
async function outraAbaEscrevendo(nome) {
    let release;
    let granted;
    const ateSoltar = new Promise(resolve => { release = resolve; });
    const concedido = new Promise(resolve => { granted = resolve; });
    const settled = navigator.locks.request(nome, { mode: 'shared' }, () => {
        granted();
        return ateSoltar;
    });
    settled.catch(() => undefined);
    await concedido;
    return async () => { release(); await settled; };
}

beforeEach(() => {
    emitidos = [];
    setStoreErrorEventBus({ emit: (type, payload) => emitidos.push({ type, payload }) });
    activateScope(remoteScope(ATLAS));
});
afterEach(() => {
    setStoreErrorEventBus(null);
    clearActiveScope();
});

describe('a barreira existe neste runtime', () => {
    it('o instrumento tem Web Locks, senão todo caso abaixo mediria o regime degradado', () => {
        // CONTROLE DE VÁCUO: sem esta asserção, um node sem `navigator.locks` deixaria os casos
        // de recusa verdes por nunca recusarem nada, que é cobertura vazia.
        expect(hasLogoutBarrierSupport()).toBe(true);
        expect(logoutBarrierLockName(`remote-${ATLAS}`)).toBe(NOME);
    });
});

describe('o diálogo de logout contra a escrita de outra aba', () => {
    it('recusa a escrita da irmã enquanto o diálogo está aberto, e a libera ao cancelar', async () => {
        const barreira = await holdLogoutBarrier(remoteScope(ATLAS));
        expect(barreira).toMatchObject({ held: true, drained: true, supported: true });

        // A IRMÃ, agora: a mesma pergunta que `runTransaction` faz antes de preparar a edição.
        const recusada = await enterCoordinatedWrite(remoteScope(ATLAS));
        expect(recusada.blocked).toBe(true);
        expect(await logoutBarrierBlocks(remoteScope(ATLAS))).toBe(true);

        // E A RECUSA CHEGA PELA TRANSAÇÃO, com o evento da convenção e a frase em pt-BR.
        const persistiu = [];
        await expect(runTransaction(async () => {
            persistiu.push('persistência');
            return async () => { persistiu.push('gravou'); };
        })).rejects.toThrow(LOGOUT_BARRIER_NOTICE);
        expect(persistiu).toEqual([]);
        expect(emitidos).toEqual([{
            type: StoreErrorEvents.STORE_OPERATION_BLOCKED,
            payload: {
                operation: 'transaction',
                reason: LOGOUT_BARRIER_NOTICE,
                timestamp: expect.any(Number)
            }
        }]);
        // NÃO é `STORE_PERSIST_ERROR`: recusa esperada e perda de dado são classes diferentes, e
        // o `catch` da transação relabelaria a primeira como a segunda.
        expect(emitidos.map(e => e.type)).not.toContain(StoreErrorEvents.STORE_PERSIST_ERROR);

        // CANCELAR SOLTA: a mesma escrita, no mesmo escopo, passa em seguida.
        await barreira.release();
        emitidos = [];
        const liberada = await enterCoordinatedWrite(remoteScope(ATLAS));
        expect(liberada.blocked).toBe(false);
        liberada.release();
        await runTransaction(async () => async () => { persistiu.push('gravou'); });
        expect(persistiu).toEqual(['gravou']);
        expect(emitidos).toEqual([]);
    });

    it('o pedido PENDENTE já recusa, e a concessão é a evidência de que a irmã terminou', async () => {
        const soltarIrma = await outraAbaEscrevendo(NOME);

        // O diálogo pede e NÃO é atendido: a irmã está escrevendo.
        let resolvido = null;
        const pedido = holdLogoutBarrier(remoteScope(ATLAS), { timeoutMs: 5000 })
            .then(r => { resolvido = r; return r; });
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(resolvido).toBeNull();

        // ENQUANTO ISSO, a próxima escrita de qualquer aba já é recusada, sem mensagem nenhuma.
        expect((await enterCoordinatedWrite(remoteScope(ATLAS))).blocked).toBe(true);

        await soltarIrma();
        const barreira = await pedido;
        expect(barreira).toMatchObject({ held: true, drained: true });
        await barreira.release();
    });

    it('prazo estourado devolve drained:false e NÃO fica com o lock', async () => {
        const soltarIrma = await outraAbaEscrevendo(NOME);
        const barreira = await holdLogoutBarrier(remoteScope(ATLAS), { timeoutMs: 30 });
        expect(barreira).toMatchObject({ held: false, drained: false, supported: true });

        // O PEDIDO ABANDONADO NÃO PODE SER HERDADO. Se ele fosse atendido depois e ficasse
        // segurando o exclusivo, toda escrita de toda aba ficaria recusada para sempre.
        await soltarIrma();
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(await logoutBarrierBlocks(remoteScope(ATLAS))).toBe(false);
        const escrita = await enterCoordinatedWrite(remoteScope(ATLAS));
        expect(escrita.blocked).toBe(false);
        escrita.release();
    });
});

describe('o ENVIO também consulta a barreira', () => {
    it('a sondagem do auto-flush responde sim enquanto o diálogo está aberto', async () => {
        const { autoFlushBarredByLogout } = await import('../../src/js/store/sync/auto-flush-pause.js');
        expect(await autoFlushBarredByLogout()).toBe(false);

        const barreira = await holdLogoutBarrier(remoteScope(ATLAS));
        // Empurrar durante o diálogo faria o servidor receber trabalho que a pessoa acabou de
        // concordar em perder, e depois do censo que o contou.
        expect(await autoFlushBarredByLogout()).toBe(true);
        await barreira.release();
        expect(await autoFlushBarredByLogout()).toBe(false);
    });

    it('e o laço de envio de fato pergunta, antes de chamar o engine', async () => {
        // ESTRUTURAL, e a limitação é declarada: `flushOnce` é privada e o laço real precisa de
        // engine, barramento e fila, então o que se mede aqui é o SÍTIO e a ORDEM da pergunta. O
        // comportamento da barreira está medido nos casos acima com o lock de verdade.
        const { readFileSync } = await import('node:fs');
        const fonte = readFileSync(new URL('../../src/js/store/sync/sync-flush.js', import.meta.url), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, '');
        const inicio = fonte.indexOf('async function flushOnce(');
        expect(inicio).toBeGreaterThan(-1);
        const corpo = fonte.slice(inicio, fonte.indexOf('\n}', inicio));
        const pergunta = corpo.indexOf('await autoFlushBarredByLogout()');
        const envia = corpo.indexOf('await engine.flush()');
        expect(pergunta).toBeGreaterThan(-1);
        expect(envia).toBeGreaterThan(-1);
        expect(pergunta).toBeLessThan(envia);
    });
});

describe('o que a barreira NÃO alcança, por desenho', () => {
    it('atlas local não paga barreira, nem é recusado pela barreira de um remoto', async () => {
        const barreira = await holdLogoutBarrier(remoteScope(ATLAS));
        const local = localScope('slot-1', 'local-1');

        // A saída da conta não destrói atlas local, então pedir lock em toda edição local seria
        // custo sem arbitragem.
        expect(await holdLogoutBarrier(local)).toMatchObject({ supported: false, drained: true });
        expect((await enterCoordinatedWrite(local)).blocked).toBe(false);
        expect(await logoutBarrierBlocks(local)).toBe(false);

        // CONTROLE NEGATIVO DO ENDEREÇAMENTO: a recusa é por ENDEREÇO, não um "não" geral. Outro
        // atlas de servidor continua escrevendo enquanto este está sendo deixado.
        const outro = remoteScope('bbbb2222-2222-4222-8222-222222222222');
        expect(await logoutBarrierBlocks(outro)).toBe(false);
        const escrita = await enterCoordinatedWrite(outro);
        expect(escrita.blocked).toBe(false);
        escrita.release();

        await barreira.release();
    });

    it('duas escritas simultâneas nunca esperam uma pela outra', async () => {
        // `shared` é compatível com `shared`: a barreira só existe para o logout, e uma fila de
        // escritores seria uma interface congelada em toda edição concorrente.
        const a = await enterCoordinatedWrite(remoteScope(ATLAS));
        const b = await enterCoordinatedWrite(remoteScope(ATLAS));
        expect([a.blocked, b.blocked]).toEqual([false, false]);
        a.release();
        b.release();
    });
});
