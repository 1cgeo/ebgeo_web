// Path: tests/unit/sync-status-frases.test.js

/**
 * @fileoverview A luz de sync responde "o meu trabalho está salvo?", e este teste cobra as
 * duas formas de ela mentir.
 *
 * A PRIMEIRA MENTIRA É O VERDE COM FILA CHEIA. Enquanto o controle mapeava só o estado do
 * SOCKET, "Conectado" aparecia com N operações paradas na fila de saída, e é esse sinal que
 * precede a perda de trabalho no logout. Por isso a asserção central aqui NÃO é uma lista de
 * exemplos: é uma INVARIANTE sobre a grade inteira de (conexão × pendências), a saber, com
 * pendência maior que zero nenhuma saída pode dizer "Tudo enviado" nem pintar de verde. Uma
 * lista de exemplos passa quando alguém acrescenta um ramo novo por descuido; a invariante
 * reprova, porque varre a grade.
 *
 * A SEGUNDA É O VERMELHO PERMANENTE NO ATLAS LOCAL. Logado num atlas que só existe neste
 * computador não há socket a conectar, e nunca haverá, então a luz ficava vermelha para
 * sempre num caminho perfeitamente normal do produto. Isso é mais caro do que parece: ensina
 * a pessoa a ignorar o vermelho, e o vermelho é o que ela precisa ver no dia em que houver
 * trabalho parado. O teste cobra que o atlas local NUNCA saia em tom de alarme, em nenhuma
 * conexão e com qualquer contagem.
 *
 * AS AUSÊNCIAS SÃO TRÊS E NÃO UMA, e o teste as separa: não medida ainda, medida que falhou,
 * e zero. Só a terceira autoriza "Tudo enviado".
 *
 * CONTROLE NEGATIVO, os dois defeitos revertidos um a um, conferido em 2026-08-23:
 *   1. `describeSyncWork` voltando a ignorar `pending` (só a conexão decide, como antes):
 *      8 casos reprovados, entre eles a invariante do verde;
 *   2. o ramo do atlas local desarmado (a condição `remote !== true` trocada por uma que
 *      nunca casa): 3 casos reprovados, incluindo o do tom de alarme permanente.
 * Rodar a suíte e ver verde não prova que ela discrimina; estas duas reversões provam.
 */

import { describe, it, expect } from 'vitest';
import { ConnectionStates } from '../../src/js/store/sync/connection-state.js';
import {
    SYNC_CONNECTION,
    SYNC_WORK_STATE,
    SYNC_TONE,
    toPendingCount,
    pendingLabel,
    pendingShortLabel,
    describeSyncWork,
} from '../../src/js/account/sync-phrases.js';

/** Todas as conexões reconhecidas, para varrer a grade. */
const CONEXOES = Object.values(SYNC_CONNECTION);

describe('SYNC_CONNECTION espelha ConnectionStates', () => {
    it('carrega exatamente os mesmos valores', () => {
        // O módulo de frases tem ZERO imports de propósito, então a cópia é inevitável.
        // O que não pode é ela divergir em silêncio: um estado novo lá que não chegue aqui
        // cairia no ramo DESCONHECIDO, e é melhor saber disso pelo teste.
        expect([...Object.values(SYNC_CONNECTION)].sort())
            .toEqual([...Object.values(ConnectionStates)].sort());
    });
});

describe('toPendingCount', () => {
    it('aceita contagem válida, inclusive zero', () => {
        expect(toPendingCount(0)).toBe(0);
        expect(toPendingCount(1)).toBe(1);
        expect(toPendingCount(42)).toBe(42);
        expect(toPendingCount('3')).toBe(3);
        expect(toPendingCount(2.7)).toBe(2);
    });

    it('devolve null para tudo o que NÃO é contagem', () => {
        // O ponto: nenhum destes pode virar 0, porque 0 é a única entrada que autoriza a
        // tela a dizer que o trabalho já está no servidor. `x ?? 0` não guardaria NaN.
        expect(toPendingCount(null)).toBeNull();
        expect(toPendingCount(undefined)).toBeNull();
        expect(toPendingCount(NaN)).toBeNull();
        expect(toPendingCount(Infinity)).toBeNull();
        expect(toPendingCount(-Infinity)).toBeNull();
        expect(toPendingCount(-1)).toBeNull();
        expect(toPendingCount('')).toBeNull();
        expect(toPendingCount('abc')).toBeNull();
        expect(toPendingCount({})).toBeNull();
    });
});

describe('concordância de número', () => {
    it('singular no um, plural no resto, zero inclusive', () => {
        expect(pendingLabel(0)).toBe('0 alterações');
        expect(pendingLabel(1)).toBe('1 alteração');
        expect(pendingLabel(2)).toBe('2 alterações');
        expect(pendingShortLabel(1)).toBe('1 pendente');
        expect(pendingShortLabel(7)).toBe('7 pendentes');
    });

    it('a contagem que veio como string não escapa da concordância', () => {
        expect(pendingLabel('1')).toBe('1 alteração');
        expect(pendingShortLabel('1')).toBe('1 pendente');
    });
});

describe('describeSyncWork: atlas local', () => {
    it('não fala de envio, em conexão nenhuma e com contagem nenhuma', () => {
        for (const connection of [...CONEXOES, undefined, 'estado-inventado']) {
            for (const pending of [undefined, null, 0, 1, 9]) {
                const saida = describeSyncWork({ remote: false, connection, pending });
                expect(saida.state, `${connection}/${pending}`).toBe(SYNC_WORK_STATE.LOCAL);
                expect(saida.label).toBe('Local');
                // A regressão que este bloco existe para impedir: alarme permanente no
                // caminho normal de quem trabalha sozinho.
                expect(saida.tone).toBe(SYNC_TONE.IDLE);
                expect(saida.tone).not.toBe(SYNC_TONE.WARN);
                expect(saida.detail.length).toBeGreaterThan(0);
            }
        }
    });

    it('`remote` ausente conta como local, e não como servidor incerto', () => {
        expect(describeSyncWork({}).state).toBe(SYNC_WORK_STATE.LOCAL);
        expect(describeSyncWork({ remote: undefined, connection: SYNC_CONNECTION.ONLINE }).state)
            .toBe(SYNC_WORK_STATE.LOCAL);
    });
});

describe('describeSyncWork: atlas de servidor', () => {
    it('zero pendente e online é o único caso que afirma "tudo enviado"', () => {
        const saida = describeSyncWork({
            remote: true,
            connection: SYNC_CONNECTION.ONLINE,
            pending: 0,
        });
        expect(saida.state).toBe(SYNC_WORK_STATE.SYNCED);
        expect(saida.tone).toBe(SYNC_TONE.OK);
        expect(saida.label).toBe('Tudo enviado');
        expect(saida.pending).toBe(0);
    });

    it('uma pendência online sai como envio em curso, no singular', () => {
        const saida = describeSyncWork({
            remote: true,
            connection: SYNC_CONNECTION.ONLINE,
            pending: 1,
        });
        expect(saida.state).toBe(SYNC_WORK_STATE.SENDING);
        expect(saida.tone).toBe(SYNC_TONE.BUSY);
        expect(saida.label).toBe('Enviando 1…');
        expect(saida.detail).toContain('1 alteração');
        expect(saida.detail).not.toContain('1 alterações');
    });

    it('várias pendências online mostram o número, no plural', () => {
        const saida = describeSyncWork({
            remote: true,
            connection: SYNC_CONNECTION.ONLINE,
            pending: 12,
        });
        expect(saida.state).toBe(SYNC_WORK_STATE.SENDING);
        expect(saida.label).toBe('Enviando 12…');
        expect(saida.detail).toContain('12 alterações');
    });

    it('pendência SEM conexão é o estado de alarme, e nomeia o risco do logout', () => {
        const saida = describeSyncWork({
            remote: true,
            connection: SYNC_CONNECTION.OFFLINE,
            pending: 3,
        });
        expect(saida.state).toBe(SYNC_WORK_STATE.PENDING_OFFLINE);
        expect(saida.tone).toBe(SYNC_TONE.WARN);
        expect(saida.label).toBe('3 pendentes');
        expect(saida.detail).toContain('3 alterações');
        expect(saida.detail).toContain('Sair da conta');
    });

    it('sem conexão e sem pendência NÃO é alarme, e também não é "tudo enviado" verde', () => {
        const saida = describeSyncWork({
            remote: true,
            connection: SYNC_CONNECTION.OFFLINE,
            pending: 0,
        });
        expect(saida.state).toBe(SYNC_WORK_STATE.OFFLINE_CLEAN);
        expect(saida.tone).toBe(SYNC_TONE.IDLE);
        expect(saida.label).toBe('Sem conexão');
    });

    it('conectando distingue fila vazia de fila cheia', () => {
        for (const connection of [SYNC_CONNECTION.CONNECTING, SYNC_CONNECTION.RECONNECTING]) {
            const vazia = describeSyncWork({ remote: true, connection, pending: 0 });
            expect(vazia.state, connection).toBe(SYNC_WORK_STATE.CONNECTING);
            expect(vazia.label).toBe('Conectando…');

            const cheia = describeSyncWork({ remote: true, connection, pending: 2 });
            expect(cheia.state, connection).toBe(SYNC_WORK_STATE.PENDING_RETRY);
            expect(cheia.tone).toBe(SYNC_TONE.BUSY);
            expect(cheia.label).toBe('2 pendentes');
        }
    });
});

describe('describeSyncWork: as três ausências, separadas', () => {
    it('fila ainda não lida é "verificando", não é zero e não é falha', () => {
        const saida = describeSyncWork({
            remote: true,
            connection: SYNC_CONNECTION.ONLINE,
            pending: undefined,
        });
        expect(saida.state).toBe(SYNC_WORK_STATE.CHECKING);
        expect(saida.tone).toBe(SYNC_TONE.UNKNOWN);
        expect(saida.pending).toBeNull();
        expect(saida.label).not.toBe('Tudo enviado');
    });

    it('fila ilegível é desconhecido, e diz que não é prova de nada', () => {
        const saida = describeSyncWork({
            remote: true,
            connection: SYNC_CONNECTION.ONLINE,
            pending: null,
        });
        expect(saida.state).toBe(SYNC_WORK_STATE.UNKNOWN);
        expect(saida.tone).toBe(SYNC_TONE.UNKNOWN);
        expect(saida.detail).toContain('fila de envio');
        expect(saida.pending).toBeNull();
    });

    it('contagem que não é contagem cai em desconhecido, nunca em zero', () => {
        for (const lixo of [NaN, -4, 'abc', {}, Infinity]) {
            const saida = describeSyncWork({
                remote: true,
                connection: SYNC_CONNECTION.ONLINE,
                pending: lixo,
            });
            expect(saida.state, String(lixo)).toBe(SYNC_WORK_STATE.UNKNOWN);
            expect(saida.label).not.toBe('Tudo enviado');
        }
    });

    it('estado de conexão não reconhecido não vira "desconectado" nem "enviado"', () => {
        for (const connection of ['banana', '', undefined, null, 42]) {
            const saida = describeSyncWork({ remote: true, connection, pending: 0 });
            expect(saida.state, String(connection)).toBe(SYNC_WORK_STATE.UNKNOWN);
            expect(saida.tone).toBe(SYNC_TONE.UNKNOWN);
            expect(saida.label).toBe('Sem confirmação');
        }
    });
});

describe('invariantes sobre a grade inteira', () => {
    it('CONTROLE NEGATIVO: com trabalho na fila, nada diz "tudo enviado" nem pinta de verde', () => {
        let casos = 0;
        for (const connection of CONEXOES) {
            for (const pending of [1, 2, 500]) {
                const saida = describeSyncWork({ remote: true, connection, pending });
                expect(saida.label, `${connection}/${pending}`).not.toBe('Tudo enviado');
                expect(saida.tone, `${connection}/${pending}`).not.toBe(SYNC_TONE.OK);
                expect(saida.state).not.toBe(SYNC_WORK_STATE.SYNCED);
                // O número precisa CHEGAR à tela: um estado certo com rótulo mudo não
                // responde à pergunta que a pessoa está fazendo.
                expect(saida.label).toContain(String(pending));
                expect(saida.pending).toBe(pending);
                casos++;
            }
        }
        // Sem isto o laço poderia varrer coleção vazia e passar verde sem verificar nada.
        expect(casos).toBe(CONEXOES.length * 3);
    });

    it('toda saída tem rótulo curto e frase longa, e a frase nunca é o rótulo', () => {
        let casos = 0;
        for (const remote of [true, false]) {
            for (const connection of [...CONEXOES, 'desconhecido-qualquer']) {
                for (const pending of [undefined, null, 0, 1, 30]) {
                    const saida = describeSyncWork({ remote, connection, pending });
                    expect(saida.label.length, `${remote}/${connection}/${pending}`)
                        .toBeGreaterThan(0);
                    // O rótulo cabe na barra; a frase inteira é o reforço do `title`.
                    expect(saida.label.length).toBeLessThanOrEqual(20);
                    expect(saida.detail.length).toBeGreaterThan(saida.label.length);
                    expect(Object.values(SYNC_WORK_STATE)).toContain(saida.state);
                    expect(Object.values(SYNC_TONE)).toContain(saida.tone);
                    casos++;
                }
            }
        }
        expect(casos).toBe(2 * (CONEXOES.length + 1) * 5);
    });

    it('todo estado declarado é alcançável por alguma entrada', () => {
        // Estado que nenhuma entrada produz é ramo morto, e ramo morto no CSS vira cor que
        // ninguém vê. A lista de entradas é a documentação de como se chega em cada um.
        const alcancados = new Set([
            describeSyncWork({ remote: false }).state,
            describeSyncWork({ remote: true, connection: SYNC_CONNECTION.ONLINE, pending: 0 }).state,
            describeSyncWork({ remote: true, connection: SYNC_CONNECTION.ONLINE, pending: 4 }).state,
            describeSyncWork({ remote: true, connection: SYNC_CONNECTION.RECONNECTING, pending: 4 }).state,
            describeSyncWork({ remote: true, connection: SYNC_CONNECTION.CONNECTING, pending: 0 }).state,
            describeSyncWork({ remote: true, connection: SYNC_CONNECTION.OFFLINE, pending: 4 }).state,
            describeSyncWork({ remote: true, connection: SYNC_CONNECTION.OFFLINE, pending: 0 }).state,
            describeSyncWork({ remote: true, connection: SYNC_CONNECTION.ONLINE }).state,
            describeSyncWork({ remote: true, connection: SYNC_CONNECTION.ONLINE, pending: null }).state,
        ]);
        expect([...alcancados].sort()).toEqual([...Object.values(SYNC_WORK_STATE)].sort());
    });
});
