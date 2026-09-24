// Path: tests/unit/copia-no-servidor-espera.test.js

/**
 * The decision of the wait before a SERVER copy of a map, and the words of the two copy doors.
 *
 * The end-to-end proof is `tests/e2e-ui/copia-sem-figura-recem-posta.repro.spec.js`: a picture
 * placed a moment before a copy came out missing from it. Here the pure part: when the door is
 * ready, when it keeps waiting, and when it must ask, including the inputs a broken read produces.
 */

import { describe, it, expect } from 'vitest';
import {
    decidirEsperaDaCopia, PassoDaEspera, PRAZO_DA_ESPERA_DA_COPIA_MS,
} from '../../src/js/store/sync/espera-do-envio-do-mapa.js';
import {
    avisoDeCopiaComPendencias, PortaDeCopia, FRASE_DA_ESPERA_DA_COPIA,
} from '../../src/js/store/sync/copia-no-servidor-phrases.js';

const d = (operacoes, problemas, figuras, esgotado = false) => decidirEsperaDaCopia({ operacoes, problemas, figuras, esgotado });

describe('decidirEsperaDaCopia', () => {
    it('nothing owed: ready, even past the deadline', () => {
        expect(d(0, 0, 0)).toBe(PassoDaEspera.PRONTO);
        expect(d(0, 0, 0, true)).toBe(PassoDaEspera.PRONTO);
    });

    it('a picture still uploading keeps the door waiting, and asks once the deadline passes', () => {
        // The held feature operation and its bytes: the case the repro measured.
        expect(d(1, 0, 1)).toBe(PassoDaEspera.ESPERAR);
        expect(d(1, 0, 1, true)).toBe(PassoDaEspera.PERGUNTAR);
        // Bytes registered and the feature not written yet.
        expect(d(0, 0, 1)).toBe(PassoDaEspera.ESPERAR);
    });

    it('an edit waiting for the next flush keeps the door waiting', () => {
        expect(d(3, 0, 0)).toBe(PassoDaEspera.ESPERAR);
        expect(d(3, 1, 0)).toBe(PassoDaEspera.ESPERAR);
    });

    it('only refused work left: asks at once, because waiting cannot change it', () => {
        expect(d(2, 2, 0)).toBe(PassoDaEspera.PERGUNTAR);
        // A refused operation next to a picture still uploading: the picture can still land.
        expect(d(2, 2, 1)).toBe(PassoDaEspera.ESPERAR);
    });

    it('a read that produced no number asks, never answers ready', () => {
        expect(d(NaN, 0, 0)).toBe(PassoDaEspera.PERGUNTAR);
        expect(d(0, undefined, 0)).toBe(PassoDaEspera.PERGUNTAR);
        expect(d(0, 0, Infinity)).toBe(PassoDaEspera.PERGUNTAR);
        expect(d(-1, 0, 0)).toBe(PassoDaEspera.PERGUNTAR);
    });

    it('the deadline is short: the person is looking at the screen', () => {
        expect(PRAZO_DA_ESPERA_DA_COPIA_MS).toBeGreaterThanOrEqual(3000);
        expect(PRAZO_DA_ESPERA_DA_COPIA_MS).toBeLessThanOrEqual(15000);
    });
});

describe('avisoDeCopiaComPendencias', () => {
    it('the atlas door names the atlas and sends the person to open it', () => {
        const a = avisoDeCopiaComPendencias(PortaDeCopia.ATLAS);
        expect(a.titulo).toBe('Há alterações deste computador ainda não enviadas neste atlas');
        expect(a.corpo).toBe('A cópia não as terá. Abra o atlas para que elas sejam enviadas e copie depois.');
        expect(a.confirmar).toBe('Copiar mesmo assim');
    });

    it('the map door names the map and asks to wait', () => {
        const m = avisoDeCopiaComPendencias(PortaDeCopia.MAPA);
        expect(m.titulo).toBe('Há alterações deste computador ainda não enviadas neste mapa');
        expect(m.corpo).toBe('A cópia não as terá. Espere o envio terminar e duplique de novo.');
        expect(m.confirmar).toBe('Duplicar mesmo assim');
    });

    it('an unreadable count does not claim there IS pending work, and still warns', () => {
        const u = avisoDeCopiaComPendencias(PortaDeCopia.ATLAS, { desconhecido: true });
        expect(u.titulo).toMatch(/^Não foi possível conferir/);
        expect(u.titulo).not.toMatch(/^Há /);
        expect(u.corpo).toContain('Abra o atlas');
    });

    it('the waiting notice says why the copy is not immediate', () => {
        expect(FRASE_DA_ESPERA_DA_COPIA).toBe('Enviando as alterações deste mapa antes de duplicar.');
    });
});
