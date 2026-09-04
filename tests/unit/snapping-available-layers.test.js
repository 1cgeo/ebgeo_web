import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SnappingService } from '../../src/js/snapping/snapping.service.js';
import { SNAPPABLE_LAYER_IDS } from '../../src/js/snapping/snapping.constants.js';

/**
 * The snappable-layer sweep, counted.
 *
 * `resolve()` runs on every mousemove of every drawing tool, and it used to ask
 * the map `getLayer` once per entry of `SNAPPABLE_LAYER_IDS` (eighteen of them)
 * before it could even build the query. The answer only changes when the STYLE
 * changes, which is a handful of times in a session against thousands of mouse
 * movements.
 *
 * So the ruler here is a count, not a timing: a hundred `resolve()` calls may
 * cost at most ONE sweep, and a `styledata` must buy exactly one more. Counting
 * is what makes the test survive a fast machine, and it is what reproves the
 * unmemoized version, which spends 1800 `getLayer` calls where one sweep does.
 */

/** The map the service talks to, counting what it is asked. */
function mapaFalso({ camadas = SNAPPABLE_LAYER_IDS.slice(0, 3), comEventos = true } = {}) {
    const ouvintes = new Map();
    const presentes = new Set(camadas);

    const map = {
        chamadasGetLayer: 0,
        chamadasQuery: 0,
        getLayer(id) {
            map.chamadasGetLayer++;
            return presentes.has(id) ? { id } : undefined;
        },
        queryRenderedFeatures() {
            map.chamadasQuery++;
            return [];
        },
        /** Add a layer the way a style change would, without firing anything. */
        acrescentar(id) { presentes.add(id); },
        remover(id) { presentes.delete(id); },
        emitir(evento) {
            for (const fn of ouvintes.get(evento) ?? []) fn({ type: evento });
        },
        ouvintesDe(evento) { return (ouvintes.get(evento) ?? []).length; },
    };

    if (comEventos) {
        map.on = (evento, fn) => {
            if (!ouvintes.has(evento)) ouvintes.set(evento, []);
            ouvintes.get(evento).push(fn);
        };
        map.off = (evento, fn) => {
            const lista = ouvintes.get(evento) ?? [];
            const i = lista.indexOf(fn);
            if (i >= 0) lista.splice(i, 1);
        };
    }

    return map;
}

/** The service needs a state manager and the two DOM targets it listens on. */
function servico() {
    return new SnappingService({
        stateManager: { getUnsafe: (chave) => chave === 'ui.snapping.enabled' },
    });
}

const PONTO = { x: 100, y: 100 };
const FALLBACK = { lng: -53, lat: -30 };

let snapping;

beforeEach(() => {
    vi.stubGlobal('document', { addEventListener() {}, removeEventListener() {} });
    vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
    snapping = servico();
});

afterEach(() => {
    snapping.destroy();
    vi.unstubAllGlobals();
});

describe('_getAvailableLayers memoiza por mapa', () => {
    it('cem resolve() custam no maximo uma varredura', () => {
        const map = mapaFalso();

        for (let i = 0; i < 100; i++) snapping.resolve(map, PONTO, FALLBACK);

        expect(map.chamadasQuery).toBe(100);
        expect(map.chamadasGetLayer).toBeLessThanOrEqual(SNAPPABLE_LAYER_IDS.length);
    });

    it('depois de styledata vem uma varredura nova, e so uma', () => {
        const map = mapaFalso();

        for (let i = 0; i < 100; i++) snapping.resolve(map, PONTO, FALLBACK);
        const primeira = map.chamadasGetLayer;

        map.emitir('styledata');
        for (let i = 0; i < 100; i++) snapping.resolve(map, PONTO, FALLBACK);

        expect(primeira).toBeLessThanOrEqual(SNAPPABLE_LAYER_IDS.length);
        expect(map.chamadasGetLayer).toBeLessThanOrEqual(SNAPPABLE_LAYER_IDS.length * 2);
        expect(map.chamadasGetLayer).toBeGreaterThan(primeira);
    });

    it('o ouvinte de styledata entra UMA vez por mapa, nao uma por resolve', () => {
        const map = mapaFalso();

        for (let i = 0; i < 100; i++) snapping.resolve(map, PONTO, FALLBACK);
        map.emitir('styledata');
        for (let i = 0; i < 100; i++) snapping.resolve(map, PONTO, FALLBACK);

        expect(map.ouvintesDe('styledata')).toBe(1);
    });
});

describe('a memoizacao nao pode mentir sobre o estilo', () => {
    it('camada que aparece depois de styledata entra na consulta', () => {
        const map = mapaFalso({ camadas: ['point-layer'] });
        let ultimaConsulta = null;
        map.queryRenderedFeatures = (_bbox, opcoes) => {
            ultimaConsulta = opcoes.layers;
            return [];
        };

        snapping.resolve(map, PONTO, FALLBACK);
        expect(ultimaConsulta).toEqual(['point-layer']);

        map.acrescentar('line-layer');
        map.emitir('styledata');
        snapping.resolve(map, PONTO, FALLBACK);

        expect(ultimaConsulta).toEqual(['point-layer', 'line-layer']);
    });

    it('camada que some depois de styledata sai da consulta', () => {
        const map = mapaFalso({ camadas: ['point-layer', 'line-layer'] });
        let ultimaConsulta = null;
        map.queryRenderedFeatures = (_bbox, opcoes) => {
            ultimaConsulta = opcoes.layers;
            return [];
        };

        snapping.resolve(map, PONTO, FALLBACK);
        expect(ultimaConsulta).toEqual(['point-layer', 'line-layer']);

        map.remover('line-layer');
        map.emitir('styledata');
        snapping.resolve(map, PONTO, FALLBACK);

        expect(ultimaConsulta).toEqual(['point-layer']);
    });

    it('cada mapa tem a sua lista, e um nao responde pelo outro', () => {
        const primeiro = mapaFalso({ camadas: ['point-layer'] });
        const segundo = mapaFalso({ camadas: ['polygon-layer', 'circle-layer'] });
        const consultas = [];
        for (const map of [primeiro, segundo]) {
            map.queryRenderedFeatures = (_bbox, opcoes) => { consultas.push(opcoes.layers); return []; };
        }

        snapping.resolve(primeiro, PONTO, FALLBACK);
        snapping.resolve(segundo, PONTO, FALLBACK);
        snapping.resolve(primeiro, PONTO, FALLBACK);
        snapping.resolve(segundo, PONTO, FALLBACK);

        expect(consultas).toEqual([
            ['point-layer'],
            ['polygon-layer', 'circle-layer'],
            ['point-layer'],
            ['polygon-layer', 'circle-layer'],
        ]);
    });

    it('mapa sem `on` continua respondendo, medindo toda vez', () => {
        // Um mapa que nao avisa quando o estilo muda nao tem como ser invalidado,
        // e uma lista guardada nele apontaria para camadas que sumiram. Melhor
        // pagar a varredura do que consultar uma camada que nao existe mais.
        const map = mapaFalso({ comEventos: false });
        let ultimaConsulta = null;
        map.queryRenderedFeatures = (_bbox, opcoes) => { ultimaConsulta = opcoes.layers; return []; };

        snapping.resolve(map, PONTO, FALLBACK);
        map.acrescentar('polygon-layer');
        snapping.resolve(map, PONTO, FALLBACK);

        expect(ultimaConsulta).toContain('polygon-layer');
        expect(map.chamadasGetLayer).toBe(SNAPPABLE_LAYER_IDS.length * 2);
    });
});

describe('pior caso: a contagem reprova a varredura por mousemove', () => {
    it('uma varredura por resolve estoura o teto de uma so', () => {
        // A regua acima e uma contagem, e contagem so vale se REPROVA o gasto que
        // ela existe para pegar. Aqui ela mede a versao sem memoria, escrita a
        // mao, e tem de reprovar as duas afirmacoes que aprovam a versao boa.
        const map = mapaFalso();
        const semMemoria = () => SNAPPABLE_LAYER_IDS.filter(id => map.getLayer(id));

        for (let i = 0; i < 100; i++) semMemoria();

        expect(map.chamadasGetLayer).toBe(SNAPPABLE_LAYER_IDS.length * 100);
        expect(map.chamadasGetLayer).toBeGreaterThan(SNAPPABLE_LAYER_IDS.length);
        expect(map.chamadasGetLayer).toBeGreaterThan(SNAPPABLE_LAYER_IDS.length * 2);
    });
});
