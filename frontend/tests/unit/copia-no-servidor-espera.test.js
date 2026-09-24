// Path: tests/unit/copia-no-servidor-espera.test.js

/**
 * The decision of the wait before a SERVER copy of a map, and the words of the two copy doors.
 *
 * The end-to-end proof is `tests/e2e-ui/copia-sem-figura-recem-posta.repro.spec.js`: a picture
 * placed a moment before a copy came out missing from it. Here the pure part: when the door is
 * ready, when it keeps waiting, and when it must ask, including the inputs a broken read produces.
 *
 * AND THE SPLIT THE REVIEW ASKED FOR (2026-09-24): work still on its way and work the server
 * refused need different advice. Waiting, or opening the atlas, sends the first and never the
 * second, so a sentence telling the person to wait about a refusal gives advice that never works.
 * The cases below pin that the refused-only debt ends the wait AT ONCE and that its sentence names
 * the Pendências button, never "espere" nor "para que elas sejam enviadas".
 */

import { describe, it, expect } from 'vitest';
import {
    decidirEsperaDaCopia, partesDaDivida, DesfechoDaEspera, ESPERAR, PRAZO_DA_ESPERA_DA_COPIA_MS,
} from '../../src/js/store/sync/espera-do-envio-do-mapa.js';
import {
    avisoDeCopiaComPendencias, PortaDeCopia, FRASE_DA_ESPERA_DA_COPIA,
} from '../../src/js/store/sync/copia-no-servidor-phrases.js';

const d = (operacoes, problemas, figuras, esgotado = false) => decidirEsperaDaCopia({ operacoes, problemas, figuras, esgotado });

describe('decidirEsperaDaCopia', () => {
    it('nothing owed: sent, even past the deadline', () => {
        expect(d(0, 0, 0)).toBe(DesfechoDaEspera.ENVIADO);
        expect(d(0, 0, 0, true)).toBe(DesfechoDaEspera.ENVIADO);
    });

    it('a picture still uploading keeps the door waiting, and ends PENDING once the deadline passes', () => {
        // The held feature operation and its bytes: the case the repro measured.
        expect(d(1, 0, 1)).toBe(ESPERAR);
        expect(d(1, 0, 1, true)).toBe(DesfechoDaEspera.PENDENTE);
        // Bytes registered and the feature not written yet.
        expect(d(0, 0, 1)).toBe(ESPERAR);
    });

    it('an edit waiting for the next flush keeps the door waiting', () => {
        expect(d(3, 0, 0)).toBe(ESPERAR);
        expect(d(3, 1, 0)).toBe(ESPERAR);
        expect(d(3, 1, 0, true)).toBe(DesfechoDaEspera.PENDENTE);
    });

    it('only refused work left: ends REFUSED at once, because waiting cannot change it', () => {
        expect(d(2, 2, 0)).toBe(DesfechoDaEspera.RECUSADO);
        expect(d(2, 2, 0, true)).toBe(DesfechoDaEspera.RECUSADO);
        // A refused operation next to a picture still uploading: the picture can still land.
        expect(d(2, 2, 1)).toBe(ESPERAR);
    });

    it('a read that produced no number ends UNKNOWN, never sent', () => {
        expect(d(NaN, 0, 0)).toBe(DesfechoDaEspera.DESCONHECIDO);
        expect(d(0, undefined, 0)).toBe(DesfechoDaEspera.DESCONHECIDO);
        expect(d(0, 0, Infinity)).toBe(DesfechoDaEspera.DESCONHECIDO);
        expect(d(-1, 0, 0)).toBe(DesfechoDaEspera.DESCONHECIDO);
    });

    it('the deadline is short: the person is looking at the screen', () => {
        expect(PRAZO_DA_ESPERA_DA_COPIA_MS).toBeGreaterThanOrEqual(3000);
        expect(PRAZO_DA_ESPERA_DA_COPIA_MS).toBeLessThanOrEqual(15000);
    });
});

describe('partesDaDivida', () => {
    it('separates what is on its way from what was refused', () => {
        expect(partesDaDivida({ operacoes: 1, problemas: 0, figuras: 1 })).toEqual({ enviaveis: true, recusadas: false });
        expect(partesDaDivida({ operacoes: 2, problemas: 2, figuras: 0 })).toEqual({ enviaveis: false, recusadas: true });
        expect(partesDaDivida({ operacoes: 3, problemas: 1, figuras: 0 })).toEqual({ enviaveis: true, recusadas: true });
        expect(partesDaDivida({ operacoes: 0, problemas: 0, figuras: 0 })).toEqual({ enviaveis: false, recusadas: false });
    });
});

describe('avisoDeCopiaComPendencias', () => {
    it('pending, atlas door: names the atlas and sends the person to open it', () => {
        const a = avisoDeCopiaComPendencias(PortaDeCopia.ATLAS, { enviaveis: true });
        expect(a.titulo).toBe('Há alterações deste computador ainda não enviadas neste atlas');
        expect(a.corpo).toBe('A cópia não as terá. Abra o atlas para que elas sejam enviadas e copie depois.');
        expect(a.confirmar).toBe('Copiar mesmo assim');
    });

    it('pending, map door: names the map and asks to wait', () => {
        const m = avisoDeCopiaComPendencias(PortaDeCopia.MAPA, { enviaveis: true });
        expect(m.titulo).toBe('Há alterações deste computador ainda não enviadas neste mapa');
        expect(m.corpo).toBe('A cópia não as terá. Espere o envio terminar e duplique de novo.');
        expect(m.confirmar).toBe('Duplicar mesmo assim');
    });

    it('refused only: says the server refused, and points to Pendências, never to waiting or opening', () => {
        for (const porta of [PortaDeCopia.ATLAS, PortaDeCopia.MAPA]) {
            const r = avisoDeCopiaComPendencias(porta, { recusadas: true });
            expect(r.titulo).toMatch(/^O servidor recusou alterações deste computador neste (atlas|mapa)$/);
            expect(r.corpo).toContain('Pendências');
            expect(r.corpo).not.toMatch(/[Ee]spere|para que elas sejam enviadas/);
        }
        expect(avisoDeCopiaComPendencias(PortaDeCopia.MAPA, { recusadas: true }).corpo)
            .toBe('A cópia não as terá. Veja o que fazer com elas no botão Pendências do mapa.');
        expect(avisoDeCopiaComPendencias(PortaDeCopia.ATLAS, { recusadas: true }).corpo)
            .toBe('A cópia não as terá. Abra o atlas e veja o que fazer com elas no botão Pendências do mapa.');
    });

    it('both: the pending advice first, and the refused ones named apart', () => {
        const b = avisoDeCopiaComPendencias(PortaDeCopia.MAPA, { enviaveis: true, recusadas: true });
        expect(b.titulo).toBe('Há alterações deste computador ainda não enviadas neste mapa');
        expect(b.corpo).toBe('A cópia não as terá. Espere o envio terminar e duplique de novo. '
            + 'As que o servidor recusou estão no botão Pendências do mapa.');
    });

    it('an unreadable count does not claim there IS pending work, and still warns', () => {
        const u = avisoDeCopiaComPendencias(PortaDeCopia.ATLAS, { desconhecido: true, recusadas: true });
        expect(u.titulo).toMatch(/^Não foi possível conferir/);
        expect(u.titulo).not.toMatch(/^Há |^O servidor recusou/);
        expect(u.corpo).toContain('Abra o atlas');
    });

    it('the waiting notice says why the copy is not immediate', () => {
        expect(FRASE_DA_ESPERA_DA_COPIA).toBe('Enviando as alterações deste mapa antes de duplicar.');
    });
});
