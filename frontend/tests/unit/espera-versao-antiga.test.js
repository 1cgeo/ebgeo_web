// Path: tests/unit/espera-versao-antiga.test.js

/**
 * @fileoverview A regra de "a janela antiga sumiu" de `utilities/espera-versao-antiga.js`, com a
 * sonda dublada. O canal real e o protocolo da `main` estão em
 * `tests/integration/versao-antiga-aberta-e-espera.test.js`.
 */

import { describe, it, expect } from 'vitest';
import { AUSENCIAS_PARA_SEGUIR, aVersaoAntigaResponde, esperarAVersaoAntigaFechar } from '@js/utilities/espera-versao-antiga.js';

const semDormir = async () => {};
const roteiro = (respostas) => {
    const fila = [...respostas];
    return async () => {
        if (fila.length === 0) throw new Error('a espera perguntou além do roteiro');
        return fila.shift();
    };
};

describe('esperarAVersaoAntigaFechar', () => {
    it('uma ausência só não basta: uma aba ocupada pode perder uma sonda e responder na seguinte', async () => {
        expect(AUSENCIAS_PARA_SEGUIR).toBe(2);
        const { sondas } = await esperarAVersaoAntigaFechar({
            sondar: roteiro([true, false, true, true, false, false]), dormir: semDormir,
        });
        expect(sondas).toBe(6);
    });

    it('sem aba antiga termina nas duas primeiras sondas', async () => {
        const { sondas } = await esperarAVersaoAntigaFechar({ sondar: roteiro([false, false]), dormir: semDormir });
        expect(sondas).toBe(2);
    });

    it('dorme o intervalo entre as sondas, e nunca depois da última', async () => {
        const sonos = [];
        await esperarAVersaoAntigaFechar({
            sondar: roteiro([true, false, false]), dormir: async (ms) => { sonos.push(ms); }, intervaloMs: 250,
        });
        expect(sonos).toEqual([250, 250]);
    });
});

describe('aVersaoAntigaResponde', () => {
    it('lê a marca da sonda e SEMPRE a destrói, respondendo ou falhando', async () => {
        const destruidas = [];
        const sonda = (marca, falha = false) => () => ({
            legacyPeerDetected: marca,
            async acquire(_key, { settleMs }) { if (falha) throw new Error('canal'); this.janela = settleMs; },
            destroy() { destruidas.push(marca); },
        });
        expect(await aVersaoAntigaResponde({ criarSonda: sonda(true), janelaMs: 50 })).toBe(true);
        expect(await aVersaoAntigaResponde({ criarSonda: sonda(false) })).toBe(false);
        await expect(aVersaoAntigaResponde({ criarSonda: sonda(true, true) })).rejects.toThrow('canal');
        expect(destruidas).toEqual([true, false, true]);
    });
});
