// Path: tests/unit/syncledger-sonda-render.test.js
//
// A SONDA DE RENDER DO SYNCLEDGER LIA A FORMA ERRADA, E MENTIA SEMPRE O MESMO.
//
// `probeRenderSource` (store/sync/diag/bus-tap.js) lia `src._data.features`. No
// MapLibre 5 o `setData` guarda o que recebeu EMBRULHADO: o vendor deste
// repositorio traz, literalmente,
//
//     setData(e,t){this._data="string"==typeof e?{url:e}:{geojson:e}
//
// entao `_data.features` e `undefined` em toda chamada, `feats` e sempre null e
// todo span saia com `inSource:false`.
//
// POR QUE ISSO E PIOR QUE UM SPAN ERRADO. Quem esperava `inSource === true`
// (create/update) nunca via a condicao satisfeita; quem esperava
// `inSource === false` (delete) via na PRIMEIRA leitura, olhasse o mapa o que
// olhasse. Um dos dois lados falhava alto e o outro passava vazio, que e a
// combinacao que mantem o defeito vivo: o vazio nao incomoda ninguem.
//
// O teste cobre as DUAS formas de propria vontade: a correcao aceita tanto o
// embrulho quanto a colecao crua, para sobreviver ao wrapper mudar de novo.

import { test, describe, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert/strict';

import { installSyncTrace } from '@js/store/sync/diag/bus-tap.js';
import { setTracing, getTrace, clearTrace } from '@js/store/sync/diag/trace-core.js';
import { TraceStage } from '@js/store/sync/diag/trace-stages.js';
import { EventTypes } from '@js/events/event_types.js';

/** Event bus minimo com o `onAny` que o tap usa. */
function busFalso() {
    const handlers = [];
    return {
        onAny: (fn) => { handlers.push(fn); return () => {}; },
        emit: (evt, payload) => { for (const h of handlers) h(evt, payload); },
    };
}

/**
 * Mapa falso cuja source devolve `_data` na forma pedida.
 *
 * @param {Object} forma - o objeto que o MapLibre guardaria em `_data`
 * @returns {Object} objeto com getSource
 */
function mapaFalso(forma) {
    return { getSource: (id) => (id ? { _data: forma } : null) };
}

const COLECAO = {
    type: 'FeatureCollection',
    features: [
        { properties: { id: 'alvo' } },
        { properties: { id: 'outra' } },
    ],
};

let desinstala;
beforeEach(() => {
    clearTrace();
    setTracing(true);
    globalThis.__EBGEO_TRACE_RENDER__ = true;
});
afterEach(() => {
    if (desinstala) desinstala();
    delete globalThis.__ebgeoMap;
    delete globalThis.__EBGEO_TRACE_RENDER__;
    setTracing(false);
    clearTrace();
    vi.useRealTimers();
});

/**
 * Emite o evento de feicao e devolve o span de render gravado.
 *
 * @param {Object} forma - conteudo de `_data`
 * @param {string} idProcurado
 * @returns {Promise<Object|undefined>}
 */
async function sonda(forma, idProcurado) {
    globalThis.__ebgeoMap = mapaFalso(forma);
    const bus = busFalso();
    desinstala = installSyncTrace(bus);
    bus.emit(EventTypes.FEATURE_CREATED, {
        featureId: idProcurado, featureType: 'point', mapId: 'm1',
    });
    // A sonda e adiada de proposito, para nao pesar no caminho do evento.
    await new Promise((r) => setTimeout(r, 20));
    return getTrace().find((s) => s.stage === TraceStage.RENDER_SOURCE);
}

describe('sonda render.source do SyncLedger', () => {
    test('le a forma REAL do MapLibre 5, que embrulha em .geojson', async () => {
        const span = await sonda({ geojson: COLECAO }, 'alvo');
        assert.ok(span, 'nenhum span de render foi gravado');
        assert.equal(span.inSource, true);
        assert.equal(span.sourceCount, 2);
    });

    test('continua lendo a colecao crua, se o wrapper mudar de novo', async () => {
        const span = await sonda(COLECAO, 'alvo');
        assert.ok(span);
        assert.equal(span.inSource, true);
        assert.equal(span.sourceCount, 2);
    });

    test('feicao AUSENTE da fonte reporta false, e com contagem real', async () => {
        // O caso que separa "nao esta la" de "nao consegui ler": os dois davam
        // false antes, e e por isso que a espera do delete passava vazia.
        const span = await sonda({ geojson: COLECAO }, 'nao-existe');
        assert.ok(span);
        assert.equal(span.inSource, false);
        assert.equal(span.sourceCount, 2);   // leu a fonte, e ela tem duas
    });

    test('fonte vazia: false com contagem ZERO, nao contagem nula', async () => {
        const span = await sonda({ geojson: { type: 'FeatureCollection', features: [] } }, 'alvo');
        assert.ok(span);
        assert.equal(span.inSource, false);
        assert.equal(span.sourceCount, 0);
    });

    test('forma ilegivel nao vira falso silencioso: a contagem sai nula', async () => {
        // `{ url }` e o outro ramo do setData. Nao da para dizer nada sobre a
        // feicao, e o span precisa deixar isso visivel em vez de afirmar false
        // com ar de certeza.
        const span = await sonda({ url: 'https://exemplo/x.geojson' }, 'alvo');
        assert.ok(span);
        assert.equal(span.sourceCount, null);
        assert.equal(span.inSource, false);
    });

    test('sem mapa no globalThis, o span diz que nao estava disponivel', async () => {
        const bus = busFalso();
        desinstala = installSyncTrace(bus);
        bus.emit(EventTypes.FEATURE_CREATED, {
            featureId: 'alvo', featureType: 'point', mapId: 'm1',
        });
        await new Promise((r) => setTimeout(r, 20));
        const span = getTrace().find((s) => s.stage === TraceStage.RENDER_SOURCE);
        assert.ok(span);
        assert.equal(span.available, false);
    });

    test('com a flag desligada a sonda nao roda (custo zero fora do teste)', async () => {
        delete globalThis.__EBGEO_TRACE_RENDER__;
        globalThis.__ebgeoMap = mapaFalso({ geojson: COLECAO });
        const bus = busFalso();
        desinstala = installSyncTrace(bus);
        bus.emit(EventTypes.FEATURE_CREATED, {
            featureId: 'alvo', featureType: 'point', mapId: 'm1',
        });
        await new Promise((r) => setTimeout(r, 20));
        assert.equal(getTrace().find((s) => s.stage === TraceStage.RENDER_SOURCE), undefined);
    });
});
