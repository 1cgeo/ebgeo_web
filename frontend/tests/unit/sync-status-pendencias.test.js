// Path: tests/unit/sync-status-pendencias.test.js

/**
 * @fileoverview O VERDE DA LUZ DE SYNC EXIGE TUDO APLICADO, e não "fila vazia com conexão de pé"
 * (achado F14 do plano de lançamento).
 *
 * O DEFEITO MEDIDO: `describeSyncWork` recebia três sinais (origem, conexão e UMA contagem) e o
 * ramo `n === 0 && online` devolvia "Tudo enviado" incondicionalmente. Havia quatro maneiras de
 * essa frase ser falsa exatamente quando era literalmente verdadeira, e as quatro terminam na
 * mesma tela: a pessoa lê verde e fecha o navegador.
 *
 *   1. um retrato ou replay sendo aplicado (a fila está sendo reescrita por baixo da leitura);
 *   2. trabalho na quarentena global, à espera de uma decisão que ninguém tomou;
 *   3. operação recusada pelo servidor, mais o que a fila bloqueia atrás dela (`problemas`), que
 *      é justamente o balde que a contagem de ENVIÁVEIS não inclui;
 *   4. bytes de figura que nunca subiram, que não têm operação incremental nenhuma.
 *
 * A ASSERÇÃO CENTRAL NÃO É UMA LISTA DE EXEMPLOS, é uma INVARIANTE sobre a grade das cinco
 * pendências: nenhuma combinação com qualquer uma delas acima de zero pode sair verde nem dizer
 * "Tudo enviado". Uma lista de exemplos passa no dia em que alguém acrescenta um ramo novo com
 * descuido; a invariante varre a grade e reprova.
 *
 * AS AUSÊNCIAS SÃO COBRADAS TAMBÉM NOS NÚMEROS NOVOS, pela mesma razão que já valia para a fila:
 * `null` é leitura que falhou e não zero, e falhar FECHADO é a propriedade que impede a tela de
 * afirmar sucesso a partir de ausência de medição.
 *
 * CONTROLE NEGATIVO, conferido em 2026-09-13 revertendo a decisão nova para a antiga (as quatro
 * guardas retiradas, de modo que só `n` e a conexão decidam, como antes deste lote): 17 dos 19
 * casos deste arquivo reprovados, entre eles a invariante do verde, mais 1 em
 * `sync-status-frases.test.js` (o alcance dos quatro estados novos). O mais
 * eloquente é `fila vazia com problema`, que volta a sair `enviado`/`ok`, que é o defeito por
 * extenso.
 */

import { describe, it, expect } from 'vitest';
import {
    SYNC_CONNECTION,
    SYNC_WORK_STATE,
    SYNC_TONE,
    describeSyncWork,
} from '../../src/js/account/sync-phrases.js';

/** O caso que a decisão antiga pintava de verde: atlas de servidor, conectado, fila em zero. */
const VERDE = Object.freeze({
    remote: true,
    connection: SYNC_CONNECTION.ONLINE,
    pending: 0,
});

/** As quatro pendências novas, uma por nome, com o estado que cada uma deve produzir. */
const PENDENCIAS = Object.freeze([
    ['recuperando', true, SYNC_WORK_STATE.RECOVERING],
    ['quarentena', 1, SYNC_WORK_STATE.CONFLICT],
    ['problemas', 1, SYNC_WORK_STATE.REFUSED],
    ['uploads', 1, SYNC_WORK_STATE.BLOB_PENDING],
]);

describe('o verde exige tudo aplicado', () => {
    it('CONTROLE DE VÁCUO: sem nenhuma pendência, e só assim, a saída é verde', () => {
        // Sem esta linha o arquivo inteiro poderia estar medindo uma função que nunca diz verde,
        // e todas as asserções de "não é verde" passariam sem provar nada.
        const saida = describeSyncWork(VERDE);
        expect(saida.state).toBe(SYNC_WORK_STATE.SYNCED);
        expect(saida.tone).toBe(SYNC_TONE.OK);
        expect(saida.label).toBe('Tudo enviado');
    });

    it.each(PENDENCIAS)('fila vazia com %s NÃO fica verde, e sai como %s', (campo, valor, estado) => {
        const saida = describeSyncWork({ ...VERDE, [campo]: valor });
        expect(saida.state).toBe(estado);
        expect(saida.state).not.toBe(SYNC_WORK_STATE.SYNCED);
        expect(saida.tone).not.toBe(SYNC_TONE.OK);
        expect(saida.label).not.toBe('Tudo enviado');
        // A frase NOMEIA a quantidade (ou, na recuperação, o que está acontecendo), porque um
        // rótulo sem número manda a pessoa adivinhar o tamanho do que está parado.
        expect(saida.detail.length).toBeGreaterThan(saida.label.length);
    });

    it('INVARIANTE: nenhuma combinação de pendência acima de zero sai verde', () => {
        let casos = 0;
        for (const recuperando of [false, true]) {
            for (const quarentena of [0, 2]) {
                for (const problemas of [0, 3]) {
                    for (const uploads of [0, 5]) {
                        for (const pending of [0, 4]) {
                            const saida = describeSyncWork({
                                ...VERDE, pending, recuperando, quarentena, problemas, uploads,
                            });
                            const limpo = !recuperando && quarentena === 0 && problemas === 0
                                && uploads === 0 && pending === 0;
                            const rotulo = `${recuperando}/${quarentena}/${problemas}/${uploads}/${pending}`;
                            if (limpo) {
                                expect(saida.state, rotulo).toBe(SYNC_WORK_STATE.SYNCED);
                            } else {
                                expect(saida.state, rotulo).not.toBe(SYNC_WORK_STATE.SYNCED);
                                expect(saida.tone, rotulo).not.toBe(SYNC_TONE.OK);
                            }
                            expect(Object.values(SYNC_WORK_STATE)).toContain(saida.state);
                            expect(Object.values(SYNC_TONE)).toContain(saida.tone);
                            casos++;
                        }
                    }
                }
            }
        }
        // Sem isto o laço poderia varrer coleção vazia e reportar sucesso sem verificar nada.
        expect(casos).toBe(2 * 2 * 2 * 2 * 2);
    });
});

describe('a ordem entre as pendências é contrato', () => {
    it('recuperação vem antes de tudo, porque explica todo o resto', () => {
        const saida = describeSyncWork({
            ...VERDE, pending: 7, recuperando: true, quarentena: 2, problemas: 3, uploads: 4,
        });
        expect(saida.state).toBe(SYNC_WORK_STATE.RECOVERING);
    });

    it('o que espera uma PESSOA vem antes do que espera a REDE', () => {
        // Quarentena e recusa não são consertadas por reconectar; o upload é. Anunciar o upload na
        // frente ensinaria a esperar por algo que não vai acontecer sozinho.
        expect(describeSyncWork({ ...VERDE, quarentena: 1, problemas: 1, uploads: 1 }).state)
            .toBe(SYNC_WORK_STATE.CONFLICT);
        expect(describeSyncWork({ ...VERDE, problemas: 1, uploads: 1 }).state)
            .toBe(SYNC_WORK_STATE.REFUSED);
    });

    it('recusa e revisão são alarme mesmo SEM conexão, e a frase cita a fila que espera junto', () => {
        // A gravidade do caso sem conexão não pode se perder ao dar precedência à recusa: o tom
        // continua de alarme, e o trabalho comum que espera atrás entra na frase.
        const saida = describeSyncWork({
            remote: true, connection: SYNC_CONNECTION.OFFLINE, pending: 6, problemas: 2,
        });
        expect(saida.state).toBe(SYNC_WORK_STATE.REFUSED);
        expect(saida.tone).toBe(SYNC_TONE.WARN);
        expect(saida.detail).toContain('6 alterações');
        expect(saida.pending).toBe(6);
    });

    it('upload só pendente é trabalho em curso; upload recusado em definitivo é alarme', () => {
        expect(describeSyncWork({ ...VERDE, uploads: 2 }).tone).toBe(SYNC_TONE.BUSY);
        const recusado = describeSyncWork({ ...VERDE, uploads: 2, uploadsRecusados: 1 });
        expect(recusado.state).toBe(SYNC_WORK_STATE.BLOB_PENDING);
        expect(recusado.tone).toBe(SYNC_TONE.WARN);
        // A frase nomeia QUANTAS o servidor recusou, entre as figuras paradas.
        expect(recusado.detail).toContain('recusou uma delas');
        expect(describeSyncWork({ ...VERDE, uploads: 5, uploadsRecusados: 3 }).detail)
            .toContain('recusou 3 delas');
    });
});

describe('ausência nos números novos falha FECHADO', () => {
    it.each(['quarentena', 'problemas', 'uploads'])('%s ilegível sai como desconhecido, nunca zero', (campo) => {
        const saida = describeSyncWork({ ...VERDE, [campo]: null });
        expect(saida.state).toBe(SYNC_WORK_STATE.UNKNOWN);
        expect(saida.tone).toBe(SYNC_TONE.UNKNOWN);
        expect(saida.label).toBe('Sem confirmação');
    });

    it.each([NaN, -1, 'abc', {}])('valor que não é contagem (%s) também não vira zero', (valor) => {
        expect(describeSyncWork({ ...VERDE, problemas: valor }).state)
            .toBe(SYNC_WORK_STATE.UNKNOWN);
    });

    it('a recuperação é lida ANTES da fila, então vale mesmo sem leitura nenhuma', () => {
        // Este é o caso real: o retrato começa a ser aplicado antes de a primeira leitura da fila
        // voltar, e a tela não pode ficar em "Verificando…" enquanto os bancos são reescritos.
        const saida = describeSyncWork({
            remote: true, connection: SYNC_CONNECTION.ONLINE, pending: undefined, recuperando: true,
        });
        expect(saida.state).toBe(SYNC_WORK_STATE.RECOVERING);
    });

    it('atlas local ignora as pendências novas e continua calmo', () => {
        // Num atlas que só existe neste computador não há para onde enviar, então nenhuma dessas
        // contagens tem significado, e alarme aqui é o vermelho permanente que ensina a ignorar.
        const saida = describeSyncWork({
            remote: false, quarentena: 9, problemas: 9, uploads: 9, recuperando: true,
        });
        expect(saida.state).toBe(SYNC_WORK_STATE.LOCAL);
        expect(saida.tone).toBe(SYNC_TONE.IDLE);
    });
});
