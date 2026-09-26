// Path: tests/unit/sem-tempo-real.test.js

/**
 * The pure decisions of the mode without real time (`store/sync/sem-tempo-real.js`): when a failed
 * socket means "go on over HTTP", how the pull backs off, and what a failed pull means.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
    seguirSemTempoReal,
    proximoIntervaloDoPoll,
    desfechoDaFalhaDoPoll,
    PRAZO_DO_TEMPO_REAL_CODE,
    POLL_BASE_MS,
    POLL_OCIOSO_MAX_MS,
    POLL_FALHA_MAX_MS,
} from '../../src/js/store/sync/sem-tempo-real.js';
import { WS_HANDSHAKE_CLOSED } from '../../src/js/store/sync/ws-client.js';
import { avisoDeSemTempoReal } from '../../src/js/store/sync/sem-tempo-real-phrases.js';

describe('seguirSemTempoReal: quando o socket falhado vira modo HTTP', () => {
    it('o handshake fechado antes do `connected` (upgrade recusado) segue sem tempo real', () => {
        // The code is read from the ws-client itself, so a rename there turns this red.
        expect(seguirSemTempoReal({ code: WS_HANDSHAKE_CLOSED })).toBe(true);
    });

    it('o prazo de espera do `connected` vencido segue sem tempo real', () => {
        expect(seguirSemTempoReal({ code: PRAZO_DO_TEMPO_REAL_CODE })).toBe(true);
    });

    it('qualquer outra falha continua falhando a abertura', () => {
        for (const erro of [
            null, undefined, {}, new Error('x'), { name: 'AbortError' }, { code: 'STALE_SYNC_SNAPSHOT' },
            { status: 403 }, { code: 'ws_handshake_closed' },
        ]) {
            expect(seguirSemTempoReal(erro)).toBe(false);
        }
    });
});

describe('proximoIntervaloDoPoll: o recuo do pull', () => {
    it('um pull que trouxe operações volta à base', () => {
        expect(proximoIntervaloDoPoll({ anterior: 9000, trouxeOperacoes: true })).toBe(POLL_BASE_MS);
    });

    it('pulls vazios crescem até o teto ocioso, e ficam nele', () => {
        let intervalo = POLL_BASE_MS;
        const serie = [];
        for (let i = 0; i < 8; i++) {
            intervalo = proximoIntervaloDoPoll({ anterior: intervalo });
            serie.push(intervalo);
        }
        expect(serie[0]).toBe(4500);
        expect(serie.at(-1)).toBe(POLL_OCIOSO_MAX_MS);
        expect(serie.every((v, i) => i === 0 || v >= serie[i - 1])).toBe(true);
    });

    it('falhas dobram até o teto de falha', () => {
        let intervalo = POLL_BASE_MS;
        for (let i = 0; i < 10; i++) intervalo = proximoIntervaloDoPoll({ anterior: intervalo, falhou: true });
        expect(intervalo).toBe(POLL_FALHA_MAX_MS);
        expect(proximoIntervaloDoPoll({ anterior: POLL_BASE_MS, falhou: true })).toBe(6000);
    });

    it('lixo no intervalo anterior nunca vira laço sem espera', () => {
        for (const anterior of [undefined, null, NaN, -1, 0, Infinity, '3000']) {
            const v = proximoIntervaloDoPoll({ anterior });
            expect(v).toBeGreaterThanOrEqual(POLL_BASE_MS);
            expect(Number.isFinite(v)).toBe(true);
        }
    });

    it('invariante: o intervalo fica sempre entre a base e o teto de falha', () => {
        fc.assert(fc.property(
            fc.oneof(fc.double(), fc.integer()), fc.boolean(), fc.boolean(),
            (anterior, trouxeOperacoes, falhou) => {
                const v = proximoIntervaloDoPoll({ anterior, trouxeOperacoes, falhou });
                return Number.isFinite(v) && v >= POLL_BASE_MS && v <= POLL_FALHA_MAX_MS;
            },
        ));
    });
});

describe('desfechoDaFalhaDoPoll: o que um pull recusado quer dizer', () => {
    it('403, 404 e 410 são o fim do acesso, para conta e visitante', () => {
        for (const status of [403, 404, 410]) {
            expect(desfechoDaFalhaDoPoll(status)).toBe('fim-do-acesso');
            expect(desfechoDaFalhaDoPoll(status, { visitante: true })).toBe('fim-do-acesso');
        }
    });

    it('401 é credencial vencida só para o visitante de link público', () => {
        expect(desfechoDaFalhaDoPoll(401, { visitante: true })).toBe('credencial-vencida');
        expect(desfechoDaFalhaDoPoll(401)).toBe('tentar-de-novo');
    });

    it('rede, 5xx e 429 são tentar de novo', () => {
        for (const status of [undefined, null, 0, 500, 502, 503, 429, 400]) {
            expect(desfechoDaFalhaDoPoll(status)).toBe('tentar-de-novo');
        }
    });
});

describe('avisoDeSemTempoReal: o que a pessoa lê ao entrar no modo', () => {
    it('a conta lê que o trabalho dela é salvo, e o que fazer se continuar', () => {
        const frase = avisoDeSemTempoReal();
        expect(frase).toMatch(/^Sem tempo real/);
        expect(frase).toContain('suas alterações são salvas no servidor');
        expect(frase).toContain('alguns segundos');
        expect(frase).toContain('avise o administrador');
        expect(avisoDeSemTempoReal({ visitante: false })).toBe(frase);
    });

    it('o visitante, que não envia nada, não lê a promessa sobre as alterações dele', () => {
        const frase = avisoDeSemTempoReal({ visitante: true });
        expect(frase).toMatch(/^Sem tempo real/);
        expect(frase).not.toContain('suas alterações');
        expect(frase).toContain('avise o administrador');
    });

    it('nenhuma das duas carrega jargão de transporte nem afirma a causa', () => {
        for (const frase of [avisoDeSemTempoReal(), avisoDeSemTempoReal({ visitante: true })]) {
            expect(frase).not.toMatch(/websocket|socket|\bhttp\b|\bfila\b|upgrade|proxy|firewall/i);
        }
    });

    it('só `true` escolhe a frase do visitante: lixo cai na da conta', () => {
        for (const visitante of [undefined, null, 1, 'sim', {}]) {
            expect(avisoDeSemTempoReal({ visitante })).toBe(avisoDeSemTempoReal());
        }
    });
});
