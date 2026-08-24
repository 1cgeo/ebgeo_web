// Path: tests/unit/overwrite-notice.test.js
//
// O SINAL DE ATROPELO, que era a metade que faltava de um achado cuja outra metade já saiu.
//
// O defeito GRAVE deste assunto era o inverso e foi consertado antes: o autor que VENCIA no
// servidor continuava exibindo o valor do perdedor por até trinta segundos (atomicidade em
// três pontos, com repro próprio). O que sobrou é o caso oposto: quem PERDE converge para o
// valor do colega, corretamente e em silêncio, e vê a própria cor ou texto mudar sozinho.
//
// O modelo de conflito NÃO muda (LWW por ordem de chegada é decisão registrada). O que muda é
// que a pessoa passa a saber que houve um colega, e qual.
//
// A JANELA É A DECISÃO, e é o que este arquivo prende com mais cuidado: sem ela, todo
// movimento de um colega viraria toast, e numa sessão de várias pessoas isso é ruído contínuo
// que ensina a ignorar avisos.

import { describe, it, expect, beforeEach } from 'vitest';
import {
    noteLocalEdit,
    editedRecentlyLocally,
    clearLocalEditMarks,
    overwriteNotice,
    OVERWRITE_WINDOW_MS
} from '../../src/js/store/sync/overwrite-notice.js';

/** Um relógio injetado: o módulo recebe o instante, então o teste não depende do relógio real. */
const T0 = 1_700_000_000_000;

beforeEach(() => {
    clearLocalEditMarks();
});

describe('a janela de atropelo', () => {
    it('uma edição local recente conta', () => {
        noteLocalEdit('f1', T0);
        expect(editedRecentlyLocally('f1', T0)).toBe(true);
        expect(editedRecentlyLocally('f1', T0 + OVERWRITE_WINDOW_MS - 1)).toBe(true);
    });

    it('a BORDA da janela ainda conta, e um milissegundo depois não', () => {
        // A fronteira é o lugar onde um `<` no lugar de `<=` passa despercebido.
        noteLocalEdit('f1', T0);
        expect(editedRecentlyLocally('f1', T0 + OVERWRITE_WINDOW_MS)).toBe(true);
        expect(editedRecentlyLocally('f1', T0 + OVERWRITE_WINDOW_MS + 1)).toBe(false);
    });

    it('entidade que esta pessoa nunca tocou não conta', () => {
        noteLocalEdit('f1', T0);
        expect(editedRecentlyLocally('outra', T0)).toBe(false);
    });

    it('uma edição nova RE-ARMA a janela', () => {
        noteLocalEdit('f1', T0);
        noteLocalEdit('f1', T0 + OVERWRITE_WINDOW_MS);
        expect(editedRecentlyLocally('f1', T0 + OVERWRITE_WINDOW_MS + 10)).toBe(true);
    });

    it('trocar de atlas apaga as marcas', () => {
        // Id de entidade não é único ENTRE atlas: uma marca sobrevivente faria o próximo atlas
        // avisar de um atropelo que nunca houve.
        noteLocalEdit('f1', T0);
        clearLocalEditMarks();
        expect(editedRecentlyLocally('f1', T0)).toBe(false);
    });

    it('entrada inválida não registra nada e não lança', () => {
        for (const [id, quando] of [[null, T0], ['', T0], ['f', NaN], ['f', undefined]]) {
            expect(() => noteLocalEdit(id, quando)).not.toThrow();
        }
        expect(editedRecentlyLocally('f', T0)).toBe(false);
    });

    it('instante inválido na LEITURA responde falso em vez de avisar por engano', () => {
        noteLocalEdit('f1', T0);
        expect(editedRecentlyLocally('f1', NaN)).toBe(false);
        expect(editedRecentlyLocally('f1', undefined)).toBe(false);
    });

    it('o mapa não cresce sem limite: entradas velhas são podadas na escrita', () => {
        // Um atlas grande editado por horas acumularia uma entrada por entidade tocada.
        for (let i = 0; i < 300; i++) noteLocalEdit(`velha-${i}`, T0);
        // Muito depois da janela, uma escrita nova dispara a poda.
        const depois = T0 + OVERWRITE_WINDOW_MS * 10;
        noteLocalEdit('nova', depois);
        expect(editedRecentlyLocally('nova', depois)).toBe(true);
        expect(editedRecentlyLocally('velha-0', depois)).toBe(false);
    });
});

describe('overwriteNotice', () => {
    it('nomeia quem escreveu', () => {
        const frase = overwriteNotice('Cap. Silva');
        expect(frase).toContain('Cap. Silva');
        expect(frase).toMatch(/versão do servidor/i);
    });

    it('SEM NOME NÃO HÁ AVISO, e isso é decisão e não borda', () => {
        // O valor do aviso é dizer QUEM: é o que transforma "a tela mudou sozinha" em "o colega
        // está trabalhando aqui". Um toast anônimo gasta a atenção sem dar o que faria agir.
        for (const entrada of [null, undefined, '', '   ', 42, {}]) {
            expect(overwriteNotice(entrada), String(entrada)).toBeNull();
        }
    });

    it('não promete que o trabalho foi perdido, porque não foi', () => {
        // O modelo é LWW: o valor do servidor é o corrente, e a pessoa pode reeditar. Dizer
        // "seu trabalho foi perdido" seria mais alarmante que verdadeiro.
        const frase = overwriteNotice('Sgt. Costa');
        expect(frase).not.toMatch(/perdid|apagad|destru/i);
    });
});
