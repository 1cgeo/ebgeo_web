// Path: tests/unit/comparacao-de-conflito.test.js

/**
 * @fileoverview A COMPARAÇÃO ENTRE A CÓPIA LOCAL E A DO SERVIDOR (B5, item 1), nas duas metades em
 * que ela foi escrita: a aritmética (`comparacao-de-conflito.js`) e as palavras
 * (`comparacao-phrases.js`). Os dois são folhas de zero imports e rodam em node puro.
 *
 * O QUE ESTE ARQUIVO EXISTE PARA IMPEDIR. Um resumo de diferença é o tipo de código que passa verde
 * sobre qualquer entrada: ele sempre devolve UMA frase, e uma frase errada se lê igual a uma certa.
 * Por isso quase todo caso aqui carrega número de CONTROLE em absoluto (metros, contagem de
 * vértices, a lista de campos), e não só "difere" ou "não difere".
 */

import { describe, it, expect } from 'vitest';
import {
    compararFeicao,
    distanciaEmMetros,
    propriedadesQueDiferem,
    resumoDaGeometria,
} from '../../src/js/account/pendencias/comparacao-de-conflito.js';
import {
    comparacaoFrases,
    distanciaLabel,
    geometriaFrase,
    propriedadesFrase,
    tipoDeGeometriaLabel,
} from '../../src/js/account/pendencias/comparacao-phrases.js';

const ponto = (lng, lat) => ({ type: 'Point', coordinates: [lng, lat] });
const linha = (...pares) => ({ type: 'LineString', coordinates: pares });
const feicao = (geometry, properties = {}) => ({ type: 'Feature', geometry, properties });

describe('resumoDaGeometria', () => {
    it('conta o vértice de um ponto e devolve ele mesmo como centro', () => {
        expect(resumoDaGeometria(ponto(-43.2, -22.9)))
            .toEqual({ vertices: 1, lng: -43.2, lat: -22.9 });
    });

    it('atravessa qualquer aninhamento, do polígono ao conjunto de polígonos', () => {
        const poligono = {
            type: 'Polygon',
            coordinates: [[[0, 0], [0, 2], [2, 2], [2, 0]]],
        };
        expect(resumoDaGeometria(poligono)).toEqual({ vertices: 4, lng: 1, lat: 1 });

        const multi = {
            type: 'MultiPolygon',
            coordinates: [[[[0, 0], [0, 2]]], [[[4, 0], [4, 2]]]],
        };
        expect(resumoDaGeometria(multi)).toEqual({ vertices: 4, lng: 2, lat: 1 });
    });

    it('soma uma geometria composta PONDERANDO pelo número de vértices de cada filha', () => {
        // Sem a ponderação, uma coleção de um ponto e de uma linha de nove vértices teria o centro
        // no meio dos dois, o que é falso: o centro é a média dos VÉRTICES, não das geometrias.
        const composta = {
            type: 'GeometryCollection',
            geometries: [ponto(0, 0), linha([10, 0], [10, 0], [10, 0])],
        };
        expect(resumoDaGeometria(composta)).toEqual({ vertices: 4, lng: 7.5, lat: 0 });
    });

    it('devolve null para o que não tem vértice nenhum', () => {
        expect(resumoDaGeometria(null)).toBeNull();
        expect(resumoDaGeometria({ type: 'Point' })).toBeNull();
        expect(resumoDaGeometria({ type: 'LineString', coordinates: [] })).toBeNull();
        // Coordenada não finita é descartada, e uma geometria só com elas não tem centro.
        expect(resumoDaGeometria({ type: 'Point', coordinates: [NaN, 0] })).toBeNull();
    });
});

describe('distanciaEmMetros', () => {
    it('dois pontos idênticos dão ZERO, e não NaN', () => {
        // O caso que o `clamp` do cosseno existe para atender: sem ele o erro de ponto flutuante
        // põe o cosseno acima de 1 e `Math.acos` devolve NaN, justamente no caso mais comum.
        const p = { lng: -43.1729, lat: -22.9068 };
        expect(distanciaEmMetros(p, { ...p })).toBe(0);
    });

    it('um grau de latitude no equador dá cerca de 111 km', () => {
        const d = distanciaEmMetros({ lng: 0, lat: 0 }, { lng: 0, lat: 1 });
        expect(d).toBeGreaterThan(111000);
        expect(d).toBeLessThan(111400);
    });

    it('cem metros continuam cem metros na latitude do Rio', () => {
        // Controle ABSOLUTO com um deslocamento pequeno, que é a escala desta tela: 0,001 grau de
        // latitude é ~111 m em qualquer meridiano.
        const d = distanciaEmMetros({ lng: -43.2, lat: -22.9 }, { lng: -43.2, lat: -22.899 });
        expect(d).toBeGreaterThan(110);
        expect(d).toBeLessThan(112);
    });

    it('coordenada ausente ou não finita devolve null, nunca zero', () => {
        expect(distanciaEmMetros({ lng: 0, lat: 0 }, { lng: 0 })).toBeNull();
        expect(distanciaEmMetros({ lng: 0, lat: 0 }, { lng: Infinity, lat: 0 })).toBeNull();
        expect(distanciaEmMetros(null, null)).toBeNull();
    });
});

describe('propriedadesQueDiferem', () => {
    it('nomeia os campos que mudaram, em ordem, e ignora a contabilidade', () => {
        const locais = {
            nome: 'Posto A', descricao: 'x', cor: '#f00',
            id: 'local', confirmedVersion: 3, updatedAt: 10,
        };
        const remotas = {
            nome: 'Posto B', descricao: 'x', cor: '#f00',
            id: 'remoto', confirmedVersion: 9, updatedAt: 99,
        };
        expect(propriedadesQueDiferem(locais, remotas)).toEqual(['nome']);
    });

    it('campo que só existe de um lado conta como diferença', () => {
        expect(propriedadesQueDiferem({ nome: 'A' }, { nome: 'A', bloqueado: true }))
            .toEqual(['bloqueado']);
        expect(propriedadesQueDiferem({ nome: 'A', visivel: false }, { nome: 'A' }))
            .toEqual(['visivel']);
    });

    it('compara valor aninhado, e não identidade de objeto', () => {
        expect(propriedadesQueDiferem({ estilo: { cor: 'azul' } }, { estilo: { cor: 'azul' } }))
            .toEqual([]);
        expect(propriedadesQueDiferem({ estilo: { cor: 'azul' } }, { estilo: { cor: 'verde' } }))
            .toEqual(['estilo']);
    });

    it('entrada ausente dos dois lados não inventa diferença', () => {
        expect(propriedadesQueDiferem(null, undefined)).toEqual([]);
    });
});

describe('compararFeicao', () => {
    it('sem uma das metades do par, devolve null', () => {
        // A metade que falta é o `serverData`, e mostrar a cópia local duas vezes com cara de
        // comparação é exatamente o que o item 3 do B5 existia para impedir.
        expect(compararFeicao(feicao(ponto(0, 0)), null)).toBeNull();
        expect(compararFeicao(null, feicao(ponto(0, 0)))).toBeNull();
    });

    it('mesma geometria e mesmas propriedades: igual, e nenhum campo', () => {
        const a = feicao(ponto(-43.2, -22.9), { nome: 'Posto' });
        const b = feicao(ponto(-43.2, -22.9), { nome: 'Posto', confirmedVersion: 4 });
        const r = compararFeicao(a, b);
        expect(r.geometria.igual).toBe(true);
        expect(r.geometria.deslocamentoM).toBe(0);
        expect(r.propriedades).toEqual([]);
    });

    it('geometria movida: o deslocamento vem em metros e a igualdade cai', () => {
        const r = compararFeicao(
            feicao(ponto(-43.2, -22.9)),
            feicao(ponto(-43.2, -22.899)),
        );
        expect(r.geometria.igual).toBe(false);
        expect(r.geometria.deslocamentoM).toBeGreaterThan(110);
        expect(r.geometria.verticesLocal).toBe(1);
        expect(r.geometria.verticesServidor).toBe(1);
    });

    it('mesmo centro e contagem diferente NÃO é igual', () => {
        // O caso que impede a comparação de se reduzir a "o centro andou": duas linhas simétricas
        // em torno do mesmo ponto têm centro idêntico e formas diferentes.
        const r = compararFeicao(
            feicao(linha([-1, 0], [1, 0])),
            feicao(linha([-1, 0], [0, 0], [1, 0])),
        );
        expect(r.geometria.igual).toBe(false);
        expect(r.geometria.deslocamentoM).toBe(0);
        expect(r.geometria.verticesLocal).toBe(2);
        expect(r.geometria.verticesServidor).toBe(3);
    });

    it('tipo diferente NÃO é igual, mesmo com um vértice de cada lado no mesmo lugar', () => {
        const r = compararFeicao(
            feicao(ponto(0, 0)),
            feicao({ type: 'MultiPoint', coordinates: [[0, 0]] }),
        );
        expect(r.geometria.igual).toBe(false);
        expect(r.geometria.tipoLocal).toBe('Point');
        expect(r.geometria.tipoServidor).toBe('MultiPoint');
    });
});

describe('as frases', () => {
    it('a distância muda de escala, e o zero não vira frase de distância', () => {
        expect(distanciaLabel(0.4)).toBe('40 cm');
        expect(distanciaLabel(3.6)).toBe('4 m');
        expect(distanciaLabel(999)).toBe('999 m');
        expect(distanciaLabel(1500)).toBe('1,5 km');
        expect(distanciaLabel(null)).toBeNull();
        expect(distanciaLabel(-1)).toBeNull();
    });

    it('o tipo de geometria é traduzido, e o desconhecido aparece CRU', () => {
        expect(tipoDeGeometriaLabel('Polygon')).toBe('polígono');
        // Esconder o que a tabela não conhece faria a tela dizer menos do que sabe.
        expect(tipoDeGeometriaLabel('Hipercubo')).toBe('Hipercubo');
        expect(tipoDeGeometriaLabel(null)).toBe('sem geometria');
    });

    it('geometria igual sai como UMA frase, e não como três "igual"', () => {
        const r = compararFeicao(feicao(ponto(0, 0)), feicao(ponto(0, 0)));
        expect(geometriaFrase(r.geometria)).toBe('Mesma geometria: nada mudou de forma nem de lugar.');
    });

    it('a frase de geometria NOMEIA OS DOIS LADOS quando eles diferem', () => {
        const r = compararFeicao(
            feicao(linha([-43.2, -22.9], [-43.19, -22.9])),
            feicao(linha([-43.2, -22.899], [-43.19, -22.899], [-43.18, -22.899])),
        );
        const frase = geometriaFrase(r.geometria);
        expect(frase).toContain('2 vértices aqui, 3 vértices no servidor');
        expect(frase).toContain('o centro está');
        // Sem os dois lados, a pessoa teria de lembrar de que lado ela está.
        expect(frase).not.toContain('a mais');
    });

    it('um vértice é singular, e a mudança de tipo aparece dos dois lados', () => {
        const r = compararFeicao(
            feicao(ponto(0, 0)),
            feicao(linha([0, 0], [0.001, 0])),
        );
        const frase = geometriaFrase(r.geometria);
        expect(frase).toContain('ponto aqui, linha no servidor');
        expect(frase).toContain('1 vértice aqui, 2 vértices no servidor');
    });

    it('a frase de propriedades nomeia os campos, e acima do teto vira contagem', () => {
        expect(propriedadesFrase([])).toBe('');
        expect(propriedadesFrase(['nome'])).toBe('Uma propriedade difere: nome.');
        expect(propriedadesFrase(['cor', 'nome']))
            .toBe('2 propriedades diferem: cor, nome.');
        expect(propriedadesFrase(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], 3))
            .toBe('8 propriedades diferem: a, b, c e mais 5.');
    });

    it('o bloco só carrega o que tem o que dizer', () => {
        const iguais = compararFeicao(
            feicao(ponto(0, 0), { nome: 'X' }),
            feicao(ponto(0, 0), { nome: 'X' }),
        );
        // Geometria igual ainda FALA (a ausência de mudança é informação); propriedade igual, não.
        expect(comparacaoFrases(iguais)).toEqual(['Mesma geometria: nada mudou de forma nem de lugar.']);
        expect(comparacaoFrases(null)).toEqual([]);

        const ambos = compararFeicao(
            feicao(ponto(0, 0), { nome: 'X' }),
            feicao(ponto(0, 0.01), { nome: 'Y' }),
        );
        expect(comparacaoFrases(ambos)).toHaveLength(2);
    });
});
