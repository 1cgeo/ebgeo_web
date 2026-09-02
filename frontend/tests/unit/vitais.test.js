// Path: tests/unit/vitais.test.js

/**
 * @fileoverview AS WEB VITALS, e a propriedade que atravessa o arquivo inteiro: AUSÊNCIA NUNCA
 * VIRA ZERO.
 *
 * O CONTROLE NEGATIVO É UM SÓ E É O QUE IMPORTA. Trocar `if (finito(x)) saida.x = x` por
 * `saida.x = x ?? 0` (que é o que se escreve sem pensar, e o que um `Object.assign` de valores
 * padrão produz sozinho) faz um navegador sem `PerformanceObserver` publicar quatro zeros — e zero
 * milissegundo é a MELHOR nota possível em três das quatro medidas. O instrumento desligado
 * passaria a se ler como desempenho perfeito, e entraria assim no p75 do servidor, puxando-o para
 * baixo com amostras que não existem. Foi conferido revertendo.
 *
 * O `PerformanceObserver` É INJETADO, e o de mentira é dirigido: cada assinatura guarda o `type`
 * pedido e devolve um gatilho, para que o teste possa entregar entradas como o navegador entrega
 * (em lotes, fora de ordem, com campos faltando). Um teste que chamasse funções internas provaria
 * que a matemática está certa e nada sobre `observe()` ter sido chamado com o tipo certo.
 */

import { describe, it, expect } from 'vitest';
import {
    MARCA_INICIO,
    MARCA_MAPA,
    MEDIDA_ATE_MAPA,
    criarVitais,
} from '@js/session/vitais.js';

/**
 * Um `PerformanceObserver` de mentira, com o registro do que foi assinado.
 * @param {{recusar?: string[]}} [opcoes] - Tipos que este "navegador" não conhece.
 */
function criarObservador({ recusar = [] } = {}) {
    const assinaturas = [];
    const instancias = [];
    class ObservadorFalso {
        constructor(callback) {
            this._callback = callback;
        }

        observe(opcoes) {
            instancias.push(this);
            if (recusar.includes(opcoes?.type)) {
                // É o que o Chrome faz com um `type` desconhecido: lança `TypeError`.
                throw new TypeError(`type ${opcoes?.type} não suportado`);
            }
            assinaturas.push({ opcoes, entregar: (entradas) => {
                this._callback({ getEntries: () => entradas });
            } });
        }

        disconnect() {
            this.desconectado = true;
        }
    }
    return {
        Observador: ObservadorFalso,
        assinaturas,
        instancias,
        entregar(tipo, entradas) {
            for (const a of assinaturas) {
                if (a.opcoes.type === tipo) a.entregar(entradas);
            }
        },
    };
}

/** Um `performance` de mentira, com marcas e medidas de verdade. */
function criarPerformance() {
    const entradas = [];
    let relogio = 0;
    return {
        mark(nome) {
            relogio += 100;
            entradas.push({ name: nome, entryType: 'mark', startTime: relogio, duration: 0 });
        },
        measure(nome, inicio, fim) {
            const a = entradas.find((e) => e.name === inicio);
            const b = entradas.find((e) => e.name === fim);
            // É o que o navegador faz: sem a marca de INÍCIO, `measure` LANÇA.
            if (!a) throw new SyntaxError(`marca ${inicio} inexistente`);
            entradas.push({
                name: nome, entryType: 'measure', startTime: a.startTime,
                duration: b.startTime - a.startTime,
            });
        },
        getEntriesByName(nome) {
            return entradas.filter((e) => e.name === nome);
        },
        entradas,
    };
}

describe('vitais — a coleta, e o que ela NUNCA publica', () => {
    it('assina os três tipos, com o buffer ligado e o limiar do INP', () => {
        const obs = criarObservador();
        const v = criarVitais({ performance: criarPerformance(), Observador: obs.Observador });
        expect(v.observar()).toBe(true);
        const tipos = obs.assinaturas.map((a) => a.opcoes.type);
        expect(tipos.sort()).toEqual(['event', 'largest-contentful-paint', 'layout-shift']);
        // `buffered` É O QUE FAZ O LCP EXISTIR: a maior parte das entradas acontece antes de
        // qualquer JavaScript nosso rodar.
        for (const a of obs.assinaturas) expect(a.opcoes.buffered).toBe(true);
        const evento = obs.assinaturas.find((a) => a.opcoes.type === 'event');
        expect(typeof evento.opcoes.durationThreshold).toBe('number');
    });

    it('o LCP é a ÚLTIMA entrada, e não a maior nem a primeira', () => {
        const obs = criarObservador();
        const v = criarVitais({ performance: criarPerformance(), Observador: obs.Observador });
        v.observar();
        obs.entregar('largest-contentful-paint', [{ startTime: 900 }, { startTime: 2500 }]);
        expect(v.ler().lcpMs).toBe(2500);
        // Uma revisão para BAIXO acontece de verdade (o elemento maior é removido do DOM), e o
        // valor final é o da última entrada, não o máximo.
        obs.entregar('largest-contentful-paint', [{ startTime: 1800 }]);
        expect(v.ler().lcpMs).toBe(1800);
    });

    it('o INP é a PIOR interação vista, entre lotes', () => {
        const obs = criarObservador();
        const v = criarVitais({ performance: criarPerformance(), Observador: obs.Observador });
        v.observar();
        obs.entregar('event', [{ duration: 48 }, { duration: 120 }]);
        obs.entregar('event', [{ duration: 60 }]);
        expect(v.ler().inpMs).toBe(120);
    });

    it('o CLS SOMA, e ignora o deslocamento com interação recente', () => {
        const obs = criarObservador();
        const v = criarVitais({ performance: criarPerformance(), Observador: obs.Observador });
        v.observar();
        obs.entregar('layout-shift', [
            { value: 0.05, hadRecentInput: false },
            // ESTE É O QUE NÃO PODE ENTRAR: um painel que abre depois do clique é a RESPOSTA ao
            // clique, e contá-lo faria toda interface interativa ter CLS ruim.
            { value: 0.40, hadRecentInput: true },
            { value: 0.02, hadRecentInput: false },
        ]);
        expect(v.ler().cls).toBeCloseTo(0.07, 10);
    });

    it('`observar()` DUAS vezes não dobra o CLS (e não assina de novo)', () => {
        // O CASO REAL: `instalarUso` chama `observar()` ANTES da guarda de idempotência de
        // `configurarUso`, então uma segunda instalação na mesma página (um `import()` repetido,
        // uma recarga parcial de HMR) chega aqui. Com dois observadores de `layout-shift` cada
        // entrada é entregue duas vezes e o CLS soma o DOBRO: uma página boa se declara ruim, e
        // nada fica vermelho porque o número continua bem formado. O LCP e o INP não sofrem (o
        // último e o máximo são idempotentes), o que torna a assimetria pior de achar.
        const obs = criarObservador();
        const v = criarVitais({ performance: criarPerformance(), Observador: obs.Observador });
        expect(v.observar()).toBe(true);
        expect(v.observar()).toBe(true);
        expect(obs.assinaturas, 'a segunda chamada assinou de novo').toHaveLength(3);
        obs.entregar('layout-shift', [{ value: 0.05, hadRecentInput: false }]);
        expect(v.ler().cls).toBeCloseTo(0.05, 10);
        obs.entregar('largest-contentful-paint', [{ startTime: 1500 }]);
        expect(v.ler().lcpMs).toBe(1500);
    });

    it('sem entrada nenhuma, NÃO existe campo (e não existe zero)', () => {
        const obs = criarObservador();
        const v = criarVitais({ performance: criarPerformance(), Observador: obs.Observador });
        v.observar();
        const lido = v.ler();
        expect(lido).toEqual({});
        for (const campo of ['lcpMs', 'inpMs', 'cls', 'tempoAteMapaMs']) {
            expect(campo in lido, `${campo} não pode existir sem medição`).toBe(false);
        }
    });

    it('sem `PerformanceObserver` nenhum, degrada para zero campos e não lança', () => {
        const v = criarVitais({ performance: criarPerformance(), Observador: null });
        expect(v.observar()).toBe(false);
        expect(v.ler()).toEqual({});
        expect(() => v.desinstalar()).not.toThrow();
    });

    it('um tipo que o navegador RECUSA não derruba os outros dois', () => {
        // É o caso real do Safari, que não conhece `event` (e portanto não tem INP).
        const obs = criarObservador({ recusar: ['event'] });
        const v = criarVitais({ performance: criarPerformance(), Observador: obs.Observador });
        expect(v.observar()).toBe(true);
        obs.entregar('largest-contentful-paint', [{ startTime: 1500 }]);
        const lido = v.ler();
        expect(lido.lcpMs).toBe(1500);
        expect('inpMs' in lido).toBe(false);
    });

    it('entrada malformada não vira medida: NaN, negativo e sem campo', () => {
        const obs = criarObservador();
        const v = criarVitais({ performance: criarPerformance(), Observador: obs.Observador });
        v.observar();
        obs.entregar('largest-contentful-paint', [{ startTime: Number.NaN }]);
        obs.entregar('event', [{ duration: -5 }, {}]);
        obs.entregar('layout-shift', [{ value: Number.POSITIVE_INFINITY, hadRecentInput: false }]);
        expect(v.ler()).toEqual({});
    });
});

describe('vitais — as marcas e o tempo até o mapa', () => {
    it('a MEDIDA vence a marca, quando `app-init` existe', () => {
        const perf = criarPerformance();
        const v = criarVitais({ performance: perf, Observador: null });
        v.marcar(MARCA_INICIO);
        expect(v.marcarMapaPronto()).toBe(true);
        expect(perf.getEntriesByName(MEDIDA_ATE_MAPA)).toHaveLength(1);
        expect(v.ler().tempoAteMapaMs).toBe(100);
    });

    it('sem `app-init`, a MEDIDA falha e a MARCA vira a reserva', () => {
        // ESTE CASO ACONTECE: `app-init` é posta no `DOMContentLoaded`, e um boot muito rápido
        // pode chegar ao `load` do mapa antes dele. Perder a medida não pode custar a marca.
        const perf = criarPerformance();
        const v = criarVitais({ performance: perf, Observador: null });
        expect(v.marcarMapaPronto()).toBe(true);
        expect(perf.getEntriesByName(MEDIDA_ATE_MAPA)).toHaveLength(0);
        expect(perf.getEntriesByName(MARCA_MAPA)).toHaveLength(1);
        // A reserva conta desde o começo da NAVEGAÇÃO, então ela erra para MAIS, que é o lado
        // seguro de errar num indicador de lentidão.
        expect(v.ler().tempoAteMapaMs).toBe(100);
    });

    it('sem `performance` nenhum, nada lança e nada é publicado', () => {
        const v = criarVitais({ performance: null, Observador: null });
        expect(v.marcar(MARCA_MAPA)).toBe(false);
        expect(v.marcarMapaPronto()).toBe(false);
        expect(v.ler()).toEqual({});
    });

    it('`marcar` recusa nome vazio e nome que não é texto, sem lançar', () => {
        const perf = criarPerformance();
        const v = criarVitais({ performance: perf, Observador: null });
        expect(v.marcar('')).toBe(false);
        expect(v.marcar(null)).toBe(false);
        expect(v.marcar(42)).toBe(false);
        expect(perf.entradas).toHaveLength(0);
    });

    it('`desinstalar` DESCONECTA cada observador, e não só esvazia a lista', () => {
        // O TÍTULO ANTERIOR PROMETIA ISTO E NÃO ASSERIA NADA: um `observadores.splice(0)` sem o
        // `disconnect()` deixa os três vivos no navegador, entregando entradas para um objeto que
        // ninguém mais lê, e o caso passava verde.
        const obs = criarObservador();
        const v = criarVitais({ performance: criarPerformance(), Observador: obs.Observador });
        v.observar();
        expect(obs.assinaturas).toHaveLength(3);
        v.desinstalar();
        expect(obs.instancias).toHaveLength(3);
        for (const o of obs.instancias) expect(o.desconectado).toBe(true);
        // Uma segunda chamada não pode explodir: o produto não a faz, mas o HMR faz.
        expect(() => v.desinstalar()).not.toThrow();
        // E depois de soltar, `observar()` volta a assinar: o flag de idempotência é liberado.
        expect(v.observar()).toBe(true);
        expect(obs.assinaturas).toHaveLength(6);
    });
});
