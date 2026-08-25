// Path: tests/unit/filtro-de-camada-por-passo.test.js

/**
 * @fileoverview O FILTRO DE VISIBILIDADE DE CAMADA, e o contrato de passo que ele cumpre com o
 * temporal. `layers/visibility-filter.js` roda a cada rAF durante o playback, e o que o segura
 * ali NAO e um filtro barato: e um cache de uma entrada chaveado por
 * (inicio, fim, reveal, ids visiveis).
 *
 * O QUE ESTA SUITE PRENDE:
 *
 *  1. A FORMA do filtro montado: `VISIBLE_FILTER` na posicao 1, a pertinencia de camada na 2,
 *     e o ramo curto que `null`/`[]` de `additionalFilters` tomam (nenhum dos dois acrescenta
 *     elemento). O deep-equal e a asserção, nao a contagem.
 *  2. `createHatchLayerFilter`: DOIS sub-filtros quando hachurado, UM quando solido, e a clausula
 *     temporal SEMPRE no fim (o hatch nao passa por `additionalFilters`).
 *  3. `setRevealMode` suprime a clausula temporal nos DOIS construtores.
 *  4. A fronteira que a leitura do codigo nao entrega: `setTemporalCursor(0)` LIGA o filtro,
 *     porque a guarda e `Number.isFinite` e nao truthiness. Epoch 0 e instante legitimo.
 *  5. O CONTRATO DE PASSO, ponta a ponta e com o quantizador REAL (`temporal/temporal.utils.js`
 *     `quantizeCursor`, que e quem o `temporal-controller._filterWindow` usa): dois cursores
 *     DENTRO da mesma celula produzem a mesma janela, e portanto UMA reconstrucao de filtro; o
 *     cursor que cruza a fronteira produz outra. Este e o unico ponto do repositorio em que a
 *     promessa "os filtros so reconstroem na fronteira do passo" e medida com as duas metades
 *     juntas, e ela vale como PAR: `visibility-filter.js` sozinho NAO quantiza nada (ver o item
 *     abaixo do que a suite nao alcanca).
 *  6. `invalidateFilterCache`, o `mapInstance` nulo, e a camada cujo `setFilter` lanca (o erro e
 *     engolido e as demais camadas continuam sendo atualizadas).
 *
 * O QUE ELA NAO ALCANCA, declarado:
 *
 *  - A QUANTIZACAO NAO MORA NESTE MODULO. `setTemporalCursor` aceita a janela pronta; quem a
 *    calcula e `TemporalController._filterWindow`, com `quantizeCursor`. Passar dois instantes
 *    crus da mesma celula direto ao filtro RECONSTROI duas vezes, e isso e comportamento correto
 *    do modulo, nao defeito. O caso 5 existe para nao deixar essa distincao implicita.
 *  - `updateMeasurementLabelVisibility`, que varre o DOM (`document.querySelectorAll`) e pertence
 *    a camada de UI.
 *  - A escolha dos ids em `FEATURE_LAYER_IDS`/`HATCH_PATTERN_LAYERS`: a suite usa os reais, mas
 *    nao afirma que a lista esteja completa.
 *  - Se o filtro montado de fato esconde a feicao no MapLibre: isso e o motor de expressao dele.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// A unica coisa que `visibility-filter.js` importa da store e `getVisibleLayerIds`. Sem o mock a
// leitura viria do `memoryStore` real, que outra suite do mesmo processo pode ter mexido.
const visible = { ids: ['L1'] };
vi.mock('../../src/js/store/index.js', () => ({
    getVisibleLayerIds: () => visible.ids,
}));

const {
    setTemporalCursor,
    setRevealMode,
    createLayerVisibilityFilter,
    createHatchLayerFilter,
    updateAllLayerFilters,
    invalidateFilterCache,
} = await import('../../src/js/layers/visibility-filter.js');

const { quantizeCursor } = await import('../../src/js/temporal/temporal.utils.js');

const VISIBLE_FILTER = ['!=', ['get', 'visivel'], false];
const MIN_TS = -8.64e15;
const MAX_TS = 8.64e15;

/** The membership clause the module builds for a set of visible layer ids. */
function layerClause(ids) {
    return ['in', ['coalesce', ['get', 'layerId'], 'default'], ['literal', ids]];
}

/** The temporal clause for an explicit window, re-derived here instead of imported. */
function temporalClause(start, end) {
    return [
        'all',
        ['<=', ['coalesce', ['get', 'temporalInicio'], MIN_TS], end],
        ['>=', ['coalesce', ['get', 'temporalFim'], MAX_TS], start],
    ];
}

/** Map double: records every setFilter, and only knows the layers it was told about. */
function filterSpyMap(layerIds, { throwOn = null } = {}) {
    const calls = [];
    return {
        calls,
        getLayer: (id) => (layerIds.includes(id) ? { id } : undefined),
        setFilter: (id, filter) => {
            if (id === throwOn) throw new Error('setFilter refused');
            calls.push([id, filter]);
        },
    };
}

beforeEach(() => {
    visible.ids = ['L1'];
    setTemporalCursor(null);
    setRevealMode(false);
    invalidateFilterCache();
});

afterEach(() => {
    setTemporalCursor(null);
    setRevealMode(false);
    invalidateFilterCache();
});

describe('1. a forma do filtro, e o ramo curto de additionalFilters', () => {
    it('sem clausula extra nenhuma, o filtro tem exatamente visivel + pertinencia de camada', () => {
        expect(createLayerVisibilityFilter(['a', 'b'])).toEqual([
            'all',
            VISIBLE_FILTER,
            layerClause(['a', 'b']),
        ]);
    });

    it('null e [] produzem o MESMO filtro que a ausencia: nenhum dos dois acrescenta elemento', () => {
        const semNada = createLayerVisibilityFilter(['a']);
        expect(createLayerVisibilityFilter(['a'], null)).toEqual(semNada);
        expect(createLayerVisibilityFilter(['a'], [])).toEqual(semNada);
        expect(semNada).toHaveLength(3);
    });

    it('a clausula extra entra DEPOIS da pertinencia, preservando a ordem recebida', () => {
        const extra = [['==', ['get', 'x'], 1], ['has', 'y']];
        expect(createLayerVisibilityFilter(['a'], extra)).toEqual([
            'all',
            VISIBLE_FILTER,
            layerClause(['a']),
            ['==', ['get', 'x'], 1],
            ['has', 'y'],
        ]);
    });

    it('BORDA: lista de camadas visiveis VAZIA continua produzindo filtro bem formado', () => {
        // Vazio significa "nada e visivel", nao "sem restricao": o literal fica [].
        expect(createLayerVisibilityFilter([])).toEqual(['all', VISIBLE_FILTER, layerClause([])]);
    });

    it('a lista recebida NAO e copiada: o literal aponta para o mesmo array', () => {
        // Comportamento OBSERVADO, fixado para que uma futura copia defensiva seja deliberada.
        const ids = ['a'];
        const filter = createLayerVisibilityFilter(ids);
        expect(filter[2][2][1]).toBe(ids);
    });
});

describe('2. o filtro de hachura tem DOIS sub-filtros ligado e UM desligado', () => {
    it('hachurado exige hatchEnabled === true E a presenca do padrao', () => {
        expect(createHatchLayerFilter(['a'], true)).toEqual([
            'all',
            VISIBLE_FILTER,
            layerClause(['a']),
            ['==', ['get', 'hatchEnabled'], true],
            ['has', 'hatchPatternId'],
        ]);
    });

    it('solido e a NEGACAO por !=, que tambem aceita a feicao sem a propriedade', () => {
        expect(createHatchLayerFilter(['a'], false)).toEqual([
            'all',
            VISIBLE_FILTER,
            layerClause(['a']),
            ['!=', ['get', 'hatchEnabled'], true],
        ]);
        // A escolha de `!=` (e nao `== false`) e o que faz a feicao antiga, sem a chave, cair no
        // lado solido em vez de sumir das duas camadas.
        expect(createHatchLayerFilter(['a'], false)).toHaveLength(4);
    });

    it('a clausula temporal do hachurado vem por ULTIMO, depois dos dois sub-filtros', () => {
        setTemporalCursor(1000, 2000);
        const f = createHatchLayerFilter(['a'], true);
        expect(f).toHaveLength(6);
        expect(f[5]).toEqual(temporalClause(1000, 2000));
    });

    it('BORDA: hatchEnabled truthy que nao seja `true` cai no ramo hachurado do construtor', () => {
        // O argumento nao e normalizado: qualquer truthy escolhe o par de sub-filtros.
        expect(createHatchLayerFilter(['a'], 'sim')).toHaveLength(5);
        expect(createHatchLayerFilter(['a'], 0)).toHaveLength(4);
    });
});

describe('3. reveal suprime a clausula temporal nos DOIS construtores', () => {
    it('com janela ativa e reveal desligado, a clausula esta la', () => {
        setTemporalCursor(1000, 2000);
        expect(createLayerVisibilityFilter(['a'])[3]).toEqual(temporalClause(1000, 2000));
    });

    it('reveal ligado remove a clausula sem mexer na janela guardada', () => {
        setTemporalCursor(1000, 2000);
        setRevealMode(true);
        expect(createLayerVisibilityFilter(['a'])).toHaveLength(3);
        expect(createHatchLayerFilter(['a'], true)).toHaveLength(5);
        // A janela nao foi perdida: desligar reveal a devolve, sem re-set.
        setRevealMode(false);
        expect(createLayerVisibilityFilter(['a'])[3]).toEqual(temporalClause(1000, 2000));
    });

    it('reveal e coagido a booleano: undefined desliga, objeto liga', () => {
        setTemporalCursor(1000, 2000);
        setRevealMode(undefined);
        expect(createLayerVisibilityFilter(['a'])).toHaveLength(4);
        setRevealMode({});
        expect(createLayerVisibilityFilter(['a'])).toHaveLength(3);
    });
});

describe('4. a fronteira do cursor: epoch 0 e instante, nao ausencia', () => {
    it('setTemporalCursor(0) LIGA o filtro temporal (guarda por Number.isFinite, nao por truthiness)', () => {
        setTemporalCursor(0);
        const f = createLayerVisibilityFilter(['a']);
        expect(f).toHaveLength(4);
        expect(f[3]).toEqual(temporalClause(0, 0));
    });

    it('null, NaN e Infinity desligam o filtro temporal', () => {
        for (const bad of [null, undefined, NaN, Infinity, -Infinity, '1000']) {
            setTemporalCursor(bad);
            expect(createLayerVisibilityFilter(['a'])).toHaveLength(3);
        }
    });

    it('fim nao finito colapsa para o instante do inicio, sem NaN dentro da expressao', () => {
        setTemporalCursor(5000, NaN);
        expect(createLayerVisibilityFilter(['a'])[3]).toEqual(temporalClause(5000, 5000));
        setTemporalCursor(5000, Infinity);
        expect(createLayerVisibilityFilter(['a'])[3]).toEqual(temporalClause(5000, 5000));
    });

    it('BORDA: cursor negativo (antes de 1970) e janela legitima', () => {
        setTemporalCursor(-86400000, -1);
        expect(createLayerVisibilityFilter(['a'])[3]).toEqual(temporalClause(-86400000, -1));
    });
});

describe('5. o contrato de passo: intra-celula nao reconstroi, a fronteira reconstroi', () => {
    const STEP = 3600000; // one hour
    const ORIGIN = 1000;

    /** Reproduces TemporalController._filterWindow with the REAL quantizer. */
    function filterWindow(cursor) {
        const start = quantizeCursor(cursor, STEP, ORIGIN);
        return { start, end: start + STEP };
    }

    it('dois instantes DENTRO da mesma celula produzem a MESMA janela e UMA so reconstrucao', () => {
        const map = filterSpyMap(['point-layer']);
        const a = filterWindow(ORIGIN + 10);
        const b = filterWindow(ORIGIN + STEP - 1);
        // Controle da premissa: os dois instantes sao DIFERENTES, e a celula e a mesma.
        expect(ORIGIN + 10).not.toBe(ORIGIN + STEP - 1);
        expect(a).toEqual(b);

        setTemporalCursor(a.start, a.end);
        updateAllLayerFilters(map);
        expect(map.calls).toHaveLength(1);

        setTemporalCursor(b.start, b.end);
        updateAllLayerFilters(map);
        expect(map.calls).toHaveLength(1);
    });

    it('o instante que CRUZA a fronteira produz outra janela e uma segunda reconstrucao', () => {
        const map = filterSpyMap(['point-layer']);
        const dentro = filterWindow(ORIGIN + STEP - 1);
        const depois = filterWindow(ORIGIN + STEP);
        expect(depois.start).toBe(dentro.start + STEP);

        setTemporalCursor(dentro.start, dentro.end);
        updateAllLayerFilters(map);
        setTemporalCursor(depois.start, depois.end);
        updateAllLayerFilters(map);
        expect(map.calls).toHaveLength(2);
        expect(map.calls[0][1]).not.toEqual(map.calls[1][1]);
    });

    it('CONTROLE NEGATIVO da propria suite: sem quantizar, cada instante reconstroi', () => {
        // Prova que o caso acima mede a QUANTIZACAO e nao apenas o cache: passando os instantes
        // crus da MESMA celula, o modulo reconstroi duas vezes, porque ele nao quantiza nada.
        const map = filterSpyMap(['point-layer']);
        setTemporalCursor(ORIGIN + 10, ORIGIN + 10);
        updateAllLayerFilters(map);
        setTemporalCursor(ORIGIN + STEP - 1, ORIGIN + STEP - 1);
        updateAllLayerFilters(map);
        expect(map.calls).toHaveLength(2);
    });

    it('trocar o conjunto de camadas visiveis reconstroi mesmo com a janela parada', () => {
        const map = filterSpyMap(['point-layer']);
        setTemporalCursor(1000, 2000);
        updateAllLayerFilters(map);
        expect(map.calls).toHaveLength(1);
        visible.ids = ['L1', 'L2'];
        updateAllLayerFilters(map);
        expect(map.calls).toHaveLength(2);
        expect(map.calls[1][1][2]).toEqual(layerClause(['L1', 'L2']));
    });

    it('trocar reveal reconstroi mesmo com janela e camadas paradas', () => {
        const map = filterSpyMap(['point-layer']);
        setTemporalCursor(1000, 2000);
        updateAllLayerFilters(map);
        setRevealMode(true);
        updateAllLayerFilters(map);
        expect(map.calls).toHaveLength(2);
        // point-layer carrega um filtro adicional proprio, entao o que reveal tira e SO a
        // clausula temporal: quatro elementos antes e depois, mas sem `temporalInicio` no fim.
        expect(map.calls[0][1]).toHaveLength(5);
        expect(map.calls[1][1]).toHaveLength(4);
        expect(JSON.stringify(map.calls[1][1])).not.toContain('temporalInicio');
    });
});

describe('6. cache, mapa ausente e camada que recusa o filtro', () => {
    it('invalidateFilterCache forca a proxima passada, com tudo mais parado', () => {
        const map = filterSpyMap(['point-layer']);
        updateAllLayerFilters(map);
        updateAllLayerFilters(map);
        expect(map.calls).toHaveLength(1);
        invalidateFilterCache();
        updateAllLayerFilters(map);
        expect(map.calls).toHaveLength(2);
    });

    it('mapa nulo nao lanca e NAO consome o cache', () => {
        expect(() => updateAllLayerFilters(null)).not.toThrow();
        expect(() => updateAllLayerFilters(undefined)).not.toThrow();
        const map = filterSpyMap(['point-layer']);
        updateAllLayerFilters(map);
        expect(map.calls).toHaveLength(1);
    });

    it('camada ausente do estilo e simplesmente pulada', () => {
        const map = filterSpyMap([]);
        updateAllLayerFilters(map);
        expect(map.calls).toHaveLength(0);
    });

    it('setFilter que lanca numa camada nao interrompe as demais', () => {
        const map = filterSpyMap(['point-layer', 'line-layer', 'polygon-layer'], { throwOn: 'line-layer' });
        expect(() => updateAllLayerFilters(map)).not.toThrow();
        const ids = map.calls.map(([id]) => id);
        expect(ids).toHaveLength(2);
        expect(ids).toEqual(['point-layer', 'polygon-layer']);
    });

    it('a camada de padrao (hatch) recebe o construtor de hachura, e a comum o outro', () => {
        const map = filterSpyMap(['polygon-fill-pattern-layer', 'polygon-fill-layer', 'point-layer']);
        updateAllLayerFilters(map);
        expect(map.calls).toHaveLength(3);
        const byId = Object.fromEntries(map.calls);
        expect(byId['polygon-fill-pattern-layer']).toEqual(createHatchLayerFilter(['L1'], true));
        expect(byId['polygon-fill-layer']).toEqual(createHatchLayerFilter(['L1'], false));
        // point-layer traz o filtro adicional declarado em LAYER_ADDITIONAL_FILTERS.
        expect(byId['point-layer']).toHaveLength(4);
        expect(byId['point-layer'][3]).toEqual(
            ['any', ['!', ['has', 'markerSymbol']], ['==', ['get', 'markerSymbol'], 'circle']]
        );
    });

    it('OBSERVADO: a chave de cache junta os ids por virgula, entao ["a,b"] e ["a","b"] colidem', () => {
        // Fixa o custo declarado no proprio comentario do modulo ("um join e unico o bastante").
        // NAO e defeito alcancavel hoje: id de camada nasce de generateUniqueId (UUID) ou e
        // 'default', e nenhum dos dois contem virgula. O teste existe para que, no dia em que
        // alguem permitir id livre, a colisao ja esteja escrita e nomeada.
        const map = filterSpyMap(['point-layer']);
        visible.ids = ['a,b'];
        updateAllLayerFilters(map);
        expect(map.calls).toHaveLength(1);
        visible.ids = ['a', 'b'];
        updateAllLayerFilters(map);
        expect(map.calls).toHaveLength(1); // a segunda passada foi engolida pelo cache
        expect(map.calls[0][1][2]).toEqual(layerClause(['a,b']));
    });
});
