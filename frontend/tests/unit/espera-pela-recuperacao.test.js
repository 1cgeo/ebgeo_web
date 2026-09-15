// Path: tests/unit/espera-pela-recuperacao.test.js
//
// UM GESTO QUE AINDA NÃO ENTROU NA STORE PODE ESPERAR A RECUPERAÇÃO; um que já tomou a trava do
// documento, não. `whenStoreWritesResume` é a metade que espera, e ela existe porque
// `beginStoreWrite` recusa: a recusa é certa para a POSIÇÃO do escritor (dentro de
// `runTransaction`, com a trava do mapa na mão, esperando por uma recuperação que toma a mesma
// trava por mapa) e errada para a pessoa, que perde o gesto por uma janela de centenas de
// milissegundos.
//
// `write-coordinator.js` é folha (zero imports), então tudo aqui roda em node puro.

import { describe, expect, it, vi } from 'vitest';
import {
    beginStoreWrite,
    pauseStoreWrites,
    storeWritesPaused,
    whenStoreWritesResume,
} from '../../src/js/store/write-coordinator.js';

/** Um escopo novo por caso: o mapa de estado é keyed por IDENTIDADE do objeto. */
const escopo = () => ({ kind: 'remote', dbSuffix: `remote-${Math.random().toString(16).slice(2)}` });

describe('whenStoreWritesResume', () => {
    it('responde na hora quando ninguém pausou, e sem criar entrada', async () => {
        await expect(whenStoreWritesResume(escopo())).resolves.toBe(true);
        // O escopo ausente é o regime degradado (sem escopo montado): responder `false` ali
        // recusaria todo gesto de um atlas local recém-aberto.
        await expect(whenStoreWritesResume(null)).resolves.toBe(true);
    });

    it('espera a pausa terminar e então libera', async () => {
        const alvo = escopo();
        const pausa = pauseStoreWrites(alvo);
        expect(storeWritesPaused(alvo)).toBe(true);

        let resolvido = null;
        const espera = whenStoreWritesResume(alvo).then((v) => { resolvido = v; });
        // A promessa NÃO pode resolver enquanto a pausa está de pé. Sem esta asserção o caso
        // passaria mesmo se a função devolvesse `true` imediatamente, que é o defeito oposto.
        await Promise.resolve();
        expect(resolvido).toBe(null);

        pausa.resume();
        await espera;
        expect(resolvido).toBe(true);
        expect(storeWritesPaused(alvo)).toBe(false);
    });

    it('só libera quando a ÚLTIMA pausa sai, porque elas se aninham', async () => {
        const alvo = escopo();
        const primeira = pauseStoreWrites(alvo);
        const segunda = pauseStoreWrites(alvo);

        let resolvido = null;
        const espera = whenStoreWritesResume(alvo).then((v) => { resolvido = v; });

        primeira.resume();
        await Promise.resolve();
        expect(resolvido, 'uma pausa ainda de pé segura o gesto').toBe(null);

        segunda.resume();
        await espera;
        expect(resolvido).toBe(true);
    });

    it('desiste no prazo, para que uma recuperação travada recuse em vez de congelar', async () => {
        vi.useFakeTimers();
        try {
            const alvo = escopo();
            pauseStoreWrites(alvo);
            const espera = whenStoreWritesResume(alvo, { timeoutMs: 5000 });
            await vi.advanceTimersByTimeAsync(4999);
            // O prazo é um TETO sobre recuperação travada, não a espera esperada: antes dele a
            // resposta continua pendente.
            let cedo = 'pendente';
            espera.then((v) => { cedo = v; });
            await Promise.resolve();
            expect(cedo).toBe('pendente');

            await vi.advanceTimersByTimeAsync(2);
            await expect(espera).resolves.toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it('a recusa de `beginStoreWrite` continua de pé: esperar não é conceder', () => {
        const alvo = escopo();
        pauseStoreWrites(alvo);
        // A espera é do GESTO; quem já está dentro da transação segue recusado, porque a pausa
        // pode começar entre a resposta da espera e a chamada da store.
        expect(() => beginStoreWrite(alvo)).toThrow(/recuperando/);
    });
});
