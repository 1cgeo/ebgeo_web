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
    holdLogoutBarriers,
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

/** Os outros dois namespaces do censo, com os nomes de lock também escritos à mão. */
const ATLAS_B = 'bbbb1111-1111-4111-8111-111111111111';
const NOME_B = 'ebgeo-atlas-logout:#remote-bbbb1111-1111-4111-8111-111111111111';
const ATLAS_C = 'cccc1111-1111-4111-8111-111111111111';
const NOME_C = 'ebgeo-atlas-logout:#remote-cccc1111-1111-4111-8111-111111111111';
/** O que NÃO está no censo, e por isso continua escrevendo. */
const ATLAS_FORA = 'dddd1111-1111-4111-8111-111111111111';

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
                // A frase viaja TAMBÉM em `message`: é esse campo que o ouvinte de erro de store
                // mostra à pessoa; só com `reason` o toast caía na sentença genérica de papel,
                // falsa para um bloqueio que é ESTADO (medido em 2026-09-19).
                message: LOGOUT_BARRIER_NOTICE,
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
        expect(await logoutBarrierBlocks(remoteScope(ATLAS))).toBe(true);

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
    it('a sondagem simultanea ao inicio da escrita nao simula um logout', async () => {
        const scope = remoteScope(ATLAS);
        const [blocked, writer] = await Promise.all([
            logoutBarrierBlocks(scope),
            enterCoordinatedWrite(scope),
        ]);
        try {
            expect(blocked).toBe(false);
            expect(writer.blocked).toBe(false);
            expect(await logoutBarrierBlocks(scope)).toBe(false);
        } finally {
            writer.release();
        }
    });

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

    it('a barreira de UM atlas não recusa a escrita de OUTRO (a regra continua sendo o endereço)', async () => {
        // O ENDEREÇAMENTO NÃO MUDOU EM 2026-09-19, e é fácil ler a cobertura nova como se tivesse
        // mudado: o que passou a ser plural é a LISTA que o diálogo cobre, não a regra de quem cada
        // nome recusa. Um atlas fora daquela lista segue escrevendo.
        const barreira = await holdLogoutBarriers([remoteScope(ATLAS), remoteScope(ATLAS_B)]);
        const escrita = await enterCoordinatedWrite(remoteScope(ATLAS_FORA));
        expect(escrita.blocked).toBe(false);
        expect(await logoutBarrierBlocks(remoteScope(ATLAS_FORA))).toBe(false);
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

describe('a cobertura é TODO namespace do censo, e o prazo é UM só (2026-09-19)', () => {
    /**
     * O DEFEITO QUE ESTE BLOCO FECHA, medido com duas abas reais em
     * `tests/e2e-ui/browser-logout-barrier-two-tabs.spec.js` antes de existir conserto: o diálogo
     * tomava a barreira do escopo ATIVO e só dele, enquanto o censo contava e o descarte marcava
     * TODO namespace de servidor do navegador. Cruzado com a regra do dono do tab-lock, isso
     * apontava a guarda para o lado errado: duas abas no MESMO atlas colidem, então a irmã que a
     * barreira recusava era sempre a BLOQUEADA, atrás de um overlay de tela inteira e sem gesto
     * possível, e a que ela deixava passar era a que continuava VIVA em outro atlas de servidor,
     * com barra de ferramentas. Hoje a cobertura é a lista inteira.
     */

    it('recusa a escrita em TODOS os namespaces cobertos, e solta todos ao cancelar', async () => {
        const cobertos = [remoteScope(ATLAS), remoteScope(ATLAS_B), remoteScope(ATLAS_C)];
        const barreira = await holdLogoutBarriers(cobertos);
        expect(barreira).toMatchObject({ held: true, drained: true, supported: true });

        for (const escopo of cobertos) {
            const recusada = await enterCoordinatedWrite(escopo);
            expect(recusada.blocked, `a escrita em ${escopo.dbSuffix} é recusada`).toBe(true);
            expect(await logoutBarrierBlocks(escopo)).toBe(true);
        }

        // CANCELAR SOLTA TODOS, e não só o primeiro: uma soltura parcial deixaria um namespace
        // recusando escrita para sempre, sem diálogo nenhum de pé para explicar por quê.
        await barreira.release();
        for (const escopo of cobertos) {
            expect(await logoutBarrierBlocks(escopo), `${escopo.dbSuffix} foi solto`).toBe(false);
            const liberada = await enterCoordinatedWrite(escopo);
            expect(liberada.blocked).toBe(false);
            liberada.release();
        }
    });

    it('um escritor em QUALQUER namespace coberto tira o censo do conjunto, e o ATIVO sozinho não veria', async () => {
        // O CONTROLE NEGATIVO DA COBERTURA, e é ele que mede a decisão: a irmã está escrevendo no
        // SEGUNDO namespace, não no ativo. Cobrindo a lista, o conjunto não drena e a contagem vira
        // desconhecida; cobrindo só o ativo (o desenho anterior), a MESMA cena drena e o diálogo
        // teria impresso um número contado enquanto alguém escrevia.
        const soltarIrma = await outraAbaEscrevendo(NOME_B);

        const doConjunto = await holdLogoutBarriers(
            [remoteScope(ATLAS), remoteScope(ATLAS_B)], { timeoutMs: 300 }
        );
        expect(doConjunto).toMatchObject({ held: false, drained: false, supported: true });

        const soDoAtivo = await holdLogoutBarrier(remoteScope(ATLAS), { timeoutMs: 300 });
        expect(
            soDoAtivo,
            'a cobertura antiga (só o escopo ativo) DRENA nesta mesma cena, que é exatamente o '
            + 'censo otimista que a mudança de 2026-09-19 fecha'
        ).toMatchObject({ held: true, drained: true });
        await soDoAtivo.release();

        await soltarIrma();
    });

    it('o prazo é ÚNICO para o conjunto, e não N prazos em série', async () => {
        // A PROPRIEDADE É DE TEMPO, então ela se mede com relógio, e o discriminante é largo de
        // propósito: em paralelo o conjunto estoura UM prazo; em série ele estouraria três, e a
        // pessoa esperaria o diálogo por tanto tempo quanto atlas de servidor tiver na máquina.
        const soltar = await Promise.all(
            [NOME, NOME_B, NOME_C].map(nome => outraAbaEscrevendo(nome))
        );

        const inicio = Date.now();
        const barreira = await holdLogoutBarriers(
            [remoteScope(ATLAS), remoteScope(ATLAS_B), remoteScope(ATLAS_C)], { timeoutMs: 400 }
        );
        const gasto = Date.now() - inicio;

        expect(barreira).toMatchObject({ held: false, drained: false, supported: true });
        expect(gasto, 'o prazo do conjunto foi de fato esperado').toBeGreaterThanOrEqual(400);
        expect(
            gasto,
            `três nomes em série custariam 1200 ms; foram ${gasto} ms, isto é, um prazo só`
        ).toBeLessThan(800);

        // E O PEDIDO ABANDONADO NÃO PODE SER HERDADO EM NENHUM DOS TRÊS: um exclusivo concedido
        // depois do prazo e segurado para sempre travaria a escrita daquele namespace em toda aba.
        for (const solta of soltar) await solta();
        await new Promise(resolve => setTimeout(resolve, 20));
        for (const escopo of [remoteScope(ATLAS), remoteScope(ATLAS_B), remoteScope(ATLAS_C)]) {
            expect(await logoutBarrierBlocks(escopo), `${escopo.dbSuffix} ficou livre`).toBe(false);
        }
    });

    it('lista vazia, lista só de locais e nome repetido não produzem barreira nem espera', async () => {
        // O NOME REPETIDO É O CASO QUE MORDE: o escopo ativo normalmente TAMBÉM está no censo, e um
        // segundo pedido exclusivo do mesmo nome esperaria pelo primeiro, isto é, a função esperaria
        // por si mesma até o prazo e devolveria "não drenou" com ninguém escrevendo.
        expect(await holdLogoutBarriers([])).toMatchObject({ supported: false, drained: true });
        expect(await holdLogoutBarriers([localScope('slot-1', 'local-1')]))
            .toMatchObject({ supported: false, drained: true });

        const inicio = Date.now();
        const repetida = await holdLogoutBarriers(
            [remoteScope(ATLAS), remoteScope(ATLAS)], { timeoutMs: 400 }
        );
        const gasto = Date.now() - inicio;
        expect(repetida).toMatchObject({ held: true, drained: true, supported: true });
        expect(gasto, 'o nome repetido não fez a barreira esperar por ela mesma').toBeLessThan(200);
        await repetida.release();
        expect(await logoutBarrierBlocks(remoteScope(ATLAS))).toBe(false);
    });
});
