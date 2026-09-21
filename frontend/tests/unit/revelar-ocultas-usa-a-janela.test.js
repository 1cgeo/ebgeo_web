// Path: tests/unit/revelar-ocultas-usa-a-janela.test.js

/**
 * @fileoverview O "REVELAR OCULTAS" MONTAVA O TESTE DE "ESTA ESCONDIDA" COM O CURSOR CRU
 * (achado M3), enquanto o filtro do mapa usa a CELULA QUANTIZADA do passo.
 *
 * DUAS CONSEQUENCIAS, e a segunda e' a cara. A primeira e' de correcao: com unidade HORA e o
 * cursor as 10:00, uma feicao que comeca as 10:20 esta VISIVEL no mapa e era ESCURECIDA pelo
 * revelar, isto e, o modo acusava de escondido justamente o que estava na tela. A segunda e' de
 * custo: o instante entrava DENTRO da expressao de tinta, entao a expressao mudava a cada quadro
 * e todas as camadas de feicao eram repintadas por quadro de reproducao, que e' o hot path.
 *
 * ESTE ARQUIVO MEDE A SEGUNDA METADE, pela porta de cima (`applyTemporalState`), com o aplicador
 * de opacidade DUBLADO: dois quadros com cursores diferentes DENTRO da mesma celula tem de
 * produzir UMA entrega ao aplicador, e o quadro que cruza a fronteira, outra. A primeira metade
 * (a expressao ser a mesma do filtro) esta em `opacidade-de-camada-nao-escreve-a-toa.test.js`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const entregas = [];

vi.mock('../../src/js/layers/layer-opacity-applier.js', () => ({
    setRevealDimWindow: (mapa, janela) => { entregas.push(janela); },
}));

vi.mock('../../src/js/store', () => ({
    getStateManager: () => ({ getUnsafe: () => [] }),
    getVisibleLayerIds: () => ['L1'],
    getLayers: () => [],
}));

const { applyTemporalState } = await import('../../src/js/temporal/temporal-render.service.js');

/** Mapa de mentira: sem camada e sem fonte, para que so o caminho do revelar conte. */
const mapa = {
    getLayer: () => undefined,
    getSource: () => null,
    setFilter: () => {},
};

const T0 = 1_700_000_000_000;
const HORA = 3600_000;

/** Um quadro de reproducao: cursor cru + a celula quantizada a que ele pertence. */
function quadro(cursor, celulaInicio) {
    return applyTemporalState(mapa, {
        enabled: true,
        cursor,
        filterStart: celulaInicio,
        filterEnd: celulaInicio + HORA,
        reveal: true,
    });
}

describe('applyTemporalState + revelar ocultas', () => {
    beforeEach(async () => {
        entregas.length = 0;
        // Zera o estado de modulo do guarda (a chave da ultima janela entregue).
        await applyTemporalState(mapa, { enabled: false, cursor: NaN });
        entregas.length = 0;
    });

    it('REGRESSAO: dois quadros na MESMA celula entregam a janela UMA vez', () => {
        return quadro(T0 + 10, T0)
            .then(() => quadro(T0 + HORA - 1, T0))
            .then(() => quadro(T0 + HORA / 2, T0))
            .then(() => {
                // Com o cursor cru na expressao, os tres quadros produziriam tres expressoes
                // diferentes e tres repinturas de todas as camadas de feicao.
                expect(entregas).toHaveLength(1);
                expect(entregas[0]).toEqual({ start: T0, end: T0 + HORA });
            });
    });

    it('CONTROLE DE VACUO: o quadro que CRUZA a fronteira do passo entrega de novo', async () => {
        await quadro(T0 + HORA - 1, T0);
        await quadro(T0 + HORA, T0 + HORA);

        expect(entregas).toHaveLength(2);
        expect(entregas[1]).toEqual({ start: T0 + HORA, end: T0 + 2 * HORA });
    });

    it('a janela entregue e a do FILTRO, nao o instante do cursor', async () => {
        await quadro(T0 + 42, T0);

        expect(entregas[0].start).toBe(T0);
        expect(entregas[0].end).toBe(T0 + HORA);
        expect(entregas[0].start).not.toBe(T0 + 42);
    });

    it('com o revelar desligado nada e entregue, e o hot path nao paga varredura', async () => {
        await applyTemporalState(mapa, {
            enabled: true, cursor: T0 + 10, filterStart: T0, filterEnd: T0 + HORA, reveal: false,
        });
        await applyTemporalState(mapa, {
            enabled: true, cursor: T0 + 20, filterStart: T0, filterEnd: T0 + HORA, reveal: false,
        });

        expect(entregas).toHaveLength(0);
    });

    it('desligar o revelar depois de ligado entrega nulo UMA vez (a restauracao)', async () => {
        await quadro(T0 + 10, T0);
        await applyTemporalState(mapa, {
            enabled: true, cursor: T0 + 20, filterStart: T0, filterEnd: T0 + HORA, reveal: false,
        });
        await applyTemporalState(mapa, {
            enabled: true, cursor: T0 + 30, filterStart: T0, filterEnd: T0 + HORA, reveal: false,
        });

        expect(entregas).toEqual([{ start: T0, end: T0 + HORA }, null]);
    });

    it('desligar o TEMPORAL tambem desliga o escurecimento', async () => {
        await quadro(T0 + 10, T0);
        await applyTemporalState(mapa, { enabled: false, cursor: T0 + 10, reveal: true });

        expect(entregas[entregas.length - 1]).toBeNull();
    });
});
