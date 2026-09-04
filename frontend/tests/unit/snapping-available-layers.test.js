// Path: tests/unit/snapping-available-layers.test.js
//
// A VARREDURA DAS CAMADAS AGARRÁVEIS, CONTADA.
//
// `resolve()` roda em todo mousemove de toda ferramenta de desenho, e ele perguntava ao mapa
// `getLayer` uma vez por entrada de `SNAPPABLE_LAYER_IDS` (dezoito delas) antes mesmo de poder
// montar a consulta. A resposta só muda quando o ESTILO muda, o que acontece um punhado de
// vezes numa sessão contra milhares de movimentos de mouse.
//
// A RÉGUA AQUI É UMA CONTAGEM, e não um tempo: cem `resolve()` podem custar no máximo UMA
// varredura, e um `styledata` compra exatamente mais uma. Contar é o que faz o teste sobreviver
// a uma máquina rápida, e é o que reprova a versão sem memória, que gasta 1800 chamadas de
// `getLayer` onde uma varredura basta.
//
// O QUE ELA NÃO ALCANÇA: a escolha de `SNAPPABLE_LAYER_IDS`. O que se afirma é que só as
// camadas EXISTENTES no mapa entram na consulta, nunca que a lista esteja certa.
//
// A INSTÂNCIA É SINGLETON POR CONSTRUÇÃO (`if (_instance) return _instance` no construtor),
// então cada caso tem de devolvê-la, exatamente como faz `snapping-vertice-aresta-e-ctrl.test.js`.
// Um `destroy()` esquecido faz o `new` seguinte reusar calado o gerente de estado deste caso.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SnappingService } from '../../src/js/snapping/snapping.service.js';
import { SNAPPABLE_LAYER_IDS } from '../../src/js/snapping/snapping.constants.js';

/** O mapa com que o serviço fala, contando o que lhe é perguntado. */
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
        /** Acrescenta uma camada como uma troca de estilo faria, sem disparar nada. */
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

/** O serviço precisa de um gerente de estado e dos dois alvos de DOM em que ele escuta. */
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
    it('cem resolve() custam no máximo uma varredura', () => {
        const map = mapaFalso();

        for (let i = 0; i < 100; i++) snapping.resolve(map, PONTO, FALLBACK);

        expect(map.chamadasQuery).toBe(100);
        expect(map.chamadasGetLayer).toBeLessThanOrEqual(SNAPPABLE_LAYER_IDS.length);
    });

    it('depois de styledata vem uma varredura nova, e só uma', () => {
        const map = mapaFalso();

        for (let i = 0; i < 100; i++) snapping.resolve(map, PONTO, FALLBACK);
        const primeira = map.chamadasGetLayer;

        map.emitir('styledata');
        for (let i = 0; i < 100; i++) snapping.resolve(map, PONTO, FALLBACK);

        expect(primeira).toBeLessThanOrEqual(SNAPPABLE_LAYER_IDS.length);
        expect(map.chamadasGetLayer).toBeLessThanOrEqual(SNAPPABLE_LAYER_IDS.length * 2);
        expect(map.chamadasGetLayer).toBeGreaterThan(primeira);
    });

    it('o ouvinte de styledata entra UMA vez por mapa, não uma por resolve', () => {
        const map = mapaFalso();

        for (let i = 0; i < 100; i++) snapping.resolve(map, PONTO, FALLBACK);
        map.emitir('styledata');
        for (let i = 0; i < 100; i++) snapping.resolve(map, PONTO, FALLBACK);

        expect(map.ouvintesDe('styledata')).toBe(1);
    });

    it('a memória é do MÓDULO, não da instância: um serviço novo herda a do mapa', () => {
        // O WeakMap e o WeakSet vivem em escopo de módulo de propósito, para o ouvinte de
        // `styledata` fechar sobre eles e sobre mais nada, e assim nunca manter viva uma
        // instância destruída. A consequência observável é esta: trocar o serviço não
        // reinicia a varredura, e é ela que este caso prende.
        const map = mapaFalso();
        snapping.resolve(map, PONTO, FALLBACK);
        const depoisDaPrimeira = map.chamadasGetLayer;

        snapping.destroy();
        snapping = servico();
        for (let i = 0; i < 50; i++) snapping.resolve(map, PONTO, FALLBACK);

        expect(map.chamadasGetLayer).toBe(depoisDaPrimeira);
        expect(map.ouvintesDe('styledata')).toBe(1);
    });
});

describe('a memoização não pode mentir sobre o estilo', () => {
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

    it('cada mapa tem a sua lista, e um não responde pelo outro', () => {
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
        // Um mapa que não avisa quando o estilo muda não tem como ser invalidado, e uma lista
        // guardada nele apontaria para camadas que sumiram. Melhor pagar a varredura do que
        // consultar uma camada que não existe mais, porque a consulta LANÇA e mata o snapping
        // em silêncio.
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
    it('uma varredura por resolve estoura o teto de uma só', () => {
        // A régua acima é uma contagem, e contagem só vale se REPROVA o gasto que ela existe
        // para pegar. Aqui ela mede a versão sem memória, escrita à mão, e tem de reprovar as
        // duas afirmações que aprovam a versão boa.
        const map = mapaFalso();
        const semMemoria = () => SNAPPABLE_LAYER_IDS.filter(id => map.getLayer(id));

        for (let i = 0; i < 100; i++) semMemoria();

        expect(map.chamadasGetLayer).toBe(SNAPPABLE_LAYER_IDS.length * 100);
        expect(map.chamadasGetLayer).toBeGreaterThan(SNAPPABLE_LAYER_IDS.length);
        expect(map.chamadasGetLayer).toBeGreaterThan(SNAPPABLE_LAYER_IDS.length * 2);
    });
});
