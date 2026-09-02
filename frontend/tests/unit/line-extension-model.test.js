// Path: tests/unit/line-extension-model.test.js

/**
 * @fileoverview O MODELO de CONTINUAR uma feição linear por uma das pontas, medido em node puro.
 *
 * O QUE ESTE ARQUIVO EXISTE PARA PRENDER, e é uma coisa só, escrita em muitos casos: o
 * `reverse` do lado inicial. Continuar pelo FIM é concatenação, e ninguém erra concatenação;
 * continuar pelo INÍCIO exige inverter os pontos antes de prepender, porque a pessoa clica PARA
 * FORA do primeiro vértice enquanto o eixo persistido tem de ler do ponto mais distante para
 * dentro. Sem o `reverse`, o desenho fica com os vértices novos em ordem trocada: a linha se
 * dobra sobre si mesma, a seta ganha uma quebra que ninguém desenhou, e nada dá erro.
 *
 * CONTROLE NEGATIVO EXECUTADO (2026-09-02): removido o `.reverse()` de `extendCoordinates`,
 * ficaram VERMELHOS quatro casos (o exemplo [A,B]+[C,D], a ida-e-volta, a dualidade de
 * `previewCoordinates` e a invariante de fast-check da contiguidade); restaurado, verde de novo.
 * Sem esse controle, os casos de `'end'` sozinhos passariam com o modelo quebrado pela metade.
 *
 * O QUE ELE NÃO ALCANÇA, declarado: nada de store, mapa, DOM ou permissão. `canExtendFeature`
 * aqui responde só pela FORMA da feição; o posto e as travas de mapa, camada e grupo são de
 * `extensionDenialReason` (`line-extension.helpers.js`), medido em
 * `continuar-feicao-afordancia.test.js`. E `storedSpineMatches` é medido como PREDICADO: que ele
 * seja de fato consultado antes de a fonte do MapLibre ser tocada é afirmação dos controles.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
    EXTENDABLE_SOURCES,
    EXTENSION_ENDS,
    LOCKED_FEATURE_NOTICE,
    MERGED_ARROW_NOTICE,
    NOT_EXTENDABLE_NOTICE,
    SHORT_SPINE_NOTICE,
    anchorFor,
    buildExtendedProperties,
    canExtendFeature,
    extendCoordinates,
    previewCoordinates,
    resolveEndpoints,
    storedSpineMatches,
} from '@tools/helpers/line-extension.model.js';

const A = [-43.2, -22.9];
const B = [-43.1, -22.8];
const C = [-43.0, -22.7];
const D = [-42.9, -22.6];

/** Uma feição linear mínima, com o eixo em `baseCoordinates` como o produto persiste. */
const linha = (coords, extra = {}) => ({
    type: 'Feature',
    id: 'geo-1',
    properties: { id: 'f-1', source: 'line', baseCoordinates: coords, ...extra },
    geometry: { type: 'LineString', coordinates: coords },
});

describe('o vocabulário', () => {
    it('são os TRÊS tipos lineares e as DUAS pontas, congelados', () => {
        expect([...EXTENDABLE_SOURCES]).toEqual(['line', 'arrow', 'boundary']);
        expect([...EXTENSION_ENDS]).toEqual(['start', 'end']);
        expect(Object.isFrozen(EXTENDABLE_SOURCES)).toBe(true);
        expect(Object.isFrozen(EXTENSION_ENDS)).toBe(true);
    });
});

describe('extendCoordinates: onde os pontos novos entram', () => {
    it('pelo FIM concatena na ordem de clique', () => {
        expect(extendCoordinates([A, B], [C, D], 'end')).toEqual([A, B, C, D]);
    });

    it('pelo INÍCIO prepende em ordem INVERTIDA de clique: [A,B] + [C,D] vira [D,C,A,B]', () => {
        // O caso que o `reverse` existe para produzir. Sem ele sairia [C,D,A,B], e o segmento
        // C->D apontaria de volta para dentro do desenho.
        expect(extendCoordinates([A, B], [C, D], 'start')).toEqual([D, C, A, B]);
    });

    it('a ida e a volta descrevem a MESMA geometria, lida ao contrário', () => {
        // Continuar pelo início e depois inverter o eixo tem de dar o mesmo que continuar pelo
        // fim de um eixo já invertido. É a afirmação que casa as duas metades do modelo.
        const peloInicio = extendCoordinates([A, B], [C, D], 'start');
        const peloFim = extendCoordinates([B, A], [C, D], 'end');
        expect([...peloInicio].reverse()).toEqual(peloFim);
    });

    it('DOIS vértices, o mínimo de um eixo, funcionam nos dois sentidos', () => {
        expect(extendCoordinates([A, B], [C], 'end')).toEqual([A, B, C]);
        expect(extendCoordinates([A, B], [C], 'start')).toEqual([C, A, B]);
    });

    it('`added` vazio devolve uma CÓPIA do eixo, nunca o array de entrada', () => {
        const existente = [A, B];
        const saida = extendCoordinates(existente, [], 'end');
        expect(saida).toEqual([A, B]);
        expect(saida).not.toBe(existente);
        // Cópia de PARES também: mexer no resultado não pode alcançar a feição de origem.
        saida[0][0] = 999;
        expect(existente[0][0]).toBe(A[0]);
    });

    it('nunca devolve um alias de nenhuma das entradas', () => {
        const existente = [A, B];
        const acrescentados = [C];
        const saida = extendCoordinates(existente, acrescentados, 'end');
        expect(saida).not.toBe(existente);
        expect(saida).not.toBe(acrescentados);
        expect(saida[0]).not.toBe(existente[0]);
    });

    it('entrada que não é array é lida como vazia, sem lançar', () => {
        expect(extendCoordinates(null, [C], 'end')).toEqual([C]);
        expect(extendCoordinates([A, B], null, 'end')).toEqual([A, B]);
        expect(extendCoordinates(undefined, undefined, 'start')).toEqual([]);
    });

    it('valores ruins ATRAVESSAM: validade é da ferramenta, não deste modelo', () => {
        // Descartar em silêncio devolveria ao chamador um eixo mais curto do que o pedido.
        const saida = extendCoordinates([A, B], [[NaN, 0]], 'end');
        expect(saida).toHaveLength(3);
        expect(Number.isNaN(saida[2][0])).toBe(true);
    });

    it('um `end` inválido LANÇA, porque é bug do chamador e não entrada do usuário', () => {
        expect(() => extendCoordinates([A, B], [C], 'END')).toThrow(/Invalid extension end/);
        expect(() => extendCoordinates([A, B], [C], 'meio')).toThrow(/Invalid extension end/);
        expect(() => extendCoordinates([A, B], [C], undefined)).toThrow(/Invalid extension end/);
    });
});

describe('previewCoordinates: o cursor é só mais um ponto acrescentado', () => {
    it('pelo FIM o cursor fica no ÚLTIMO índice', () => {
        expect(previewCoordinates([A, B], [C], D, 'end')).toEqual([A, B, C, D]);
    });

    it('pelo INÍCIO o cursor fica no índice ZERO, que é a dualidade do `reverse`', () => {
        expect(previewCoordinates([A, B], [C], D, 'start')).toEqual([D, C, A, B]);
    });

    it('sem cursor, degrada para o eixo já comprometido em vez de desenhar um buraco', () => {
        expect(previewCoordinates([A, B], [C], null, 'end')).toEqual([A, B, C]);
        expect(previewCoordinates([A, B], [], undefined, 'start')).toEqual([A, B]);
    });

    it('um `end` inválido LANÇA aqui também', () => {
        expect(() => previewCoordinates([A, B], [C], D, 'inicio')).toThrow(/Invalid extension end/);
    });
});

describe('resolveEndpoints e anchorFor: de onde a continuação parte', () => {
    it('devolve o eixo e as duas extremidades, como cópias', () => {
        const feature = linha([A, B, C]);
        const pontas = resolveEndpoints(feature);
        expect(pontas.spine).toEqual([A, B, C]);
        expect(pontas.start).toEqual(A);
        expect(pontas.end).toEqual(C);
        pontas.start[0] = 999;
        expect(feature.properties.baseCoordinates[0][0]).toBe(A[0]);
    });

    it('`baseCoordinates` como STRING JSON é aceita: `properties` viaja como JSONB', () => {
        const feature = linha([A, B]);
        feature.properties.baseCoordinates = JSON.stringify([A, B, C]);
        expect(resolveEndpoints(feature).spine).toEqual([A, B, C]);
    });

    it('sem `baseCoordinates`, um `LineString` serve de RESERVA', () => {
        const feature = linha([A, B]);
        delete feature.properties.baseCoordinates;
        expect(resolveEndpoints(feature)).not.toBeNull();
        expect(resolveEndpoints(feature).spine).toEqual([A, B]);
    });

    it('`Polygon` e `MultiLineString` NÃO servem de reserva: são a forma DESENHADA', () => {
        // A seta é um Polygon (o contorno) e o limite um MultiLineString (com os vãos do
        // escalão recortados). Lê-los como eixo continuaria a forma desenhada, não a autoral.
        const seta = {
            type: 'Feature',
            properties: { id: 'f-2', source: 'arrow' },
            geometry: { type: 'Polygon', coordinates: [[A, B, C, A]] },
        };
        const limite = {
            type: 'Feature',
            properties: { id: 'f-3', source: 'boundary' },
            geometry: { type: 'MultiLineString', coordinates: [[A, B], [C, D]] },
        };
        expect(resolveEndpoints(seta)).toBeNull();
        expect(resolveEndpoints(limite)).toBeNull();
    });

    it('menos de dois pontos não é eixo', () => {
        expect(resolveEndpoints(linha([A]))).toBeNull();
        expect(resolveEndpoints(linha([]))).toBeNull();
        expect(resolveEndpoints(undefined)).toBeNull();
    });

    it('`anchorFor` devolve o vértice da ponta pedida, copiado', () => {
        const spine = [A, B, C];
        expect(anchorFor(spine, 'start')).toEqual(A);
        expect(anchorFor(spine, 'end')).toEqual(C);
        expect(anchorFor(spine, 'start')).not.toBe(spine[0]);
        expect(anchorFor([], 'end')).toBeNull();
        expect(anchorFor(null, 'end')).toBeNull();
        expect(() => anchorFor(spine, 'fim')).toThrow(/Invalid extension end/);
    });
});

describe('canExtendFeature: só a FORMA, e cada recusa com a própria frase', () => {
    it('uma linha, uma seta e um limite com eixo passam', () => {
        expect(canExtendFeature(linha([A, B]))).toEqual({ ok: true });
        expect(canExtendFeature(linha([A, B], { source: 'arrow' }))).toEqual({ ok: true });
        expect(canExtendFeature(linha([A, B], { source: 'boundary' }))).toEqual({ ok: true });
    });

    it('tipo que não é linear é recusado nomeando os três que são', () => {
        expect(canExtendFeature(linha([A, B], { source: 'polygon' })))
            .toEqual({ ok: false, reason: NOT_EXTENDABLE_NOTICE });
        expect(canExtendFeature(linha([A, B], { source: 'point' })).ok).toBe(false);
        expect(canExtendFeature({ properties: {} }).ok).toBe(false);
        expect(canExtendFeature(undefined).ok).toBe(false);
    });

    it('feição com o próprio cadeado é recusada, e a frase diz como destravá-la', () => {
        expect(canExtendFeature(linha([A, B], { bloqueado: true })))
            .toEqual({ ok: false, reason: LOCKED_FEATURE_NOTICE });
        // `bloqueado: false` e ausente são o mesmo estado destravado.
        expect(canExtendFeature(linha([A, B], { bloqueado: false })).ok).toBe(true);
    });

    it('seta COMBINADA de verdade é recusada, e a frase nomeia o desfaz', () => {
        // Uma seta combinada desenha a partir de `branches`, então reescrever `baseCoordinates`
        // não mudaria nada na tela, e um gesto que parece não fazer nada é pior que uma recusa
        // que se lê. O desfaz ("Separar Setas") está no menu da própria feição.
        const combinada = linha([A, B], { source: 'arrow', isMerged: true, branches: [[A, B], [C, D]] });
        expect(canExtendFeature(combinada)).toEqual({ ok: false, reason: MERGED_ARROW_NOTICE });
    });

    it('`isMerged` SEM os ramos NÃO recusa: é a separação interrompida, e ali continuar funciona', () => {
        // O PREDICADO É O COMPARTILHADO (`isMergedArrow`), nunca a chave sozinha, e a diferença
        // tem consequência. `isMerged` já apareceu verdadeiro SEM os ramos (uma separação
        // interrompida), e nesse estado a feição é uma seta COMUM com um sinalizador mentiroso:
        // ela desenha por `baseCoordinates`, continuar funciona, e "Separar Setas" nem é
        // oferecido para limpar a chave. Recusar ali tiraria a alça sem uma palavra e sem saída.
        expect(canExtendFeature(linha([A, B], { source: 'arrow', isMerged: true })).ok).toBe(true);
        // Um ramo só é o mesmo caso: ainda não é união de coisa nenhuma.
        expect(canExtendFeature(linha([A, B], { source: 'arrow', isMerged: true, branches: [[A, B]] })).ok)
            .toBe(true);
        // E `branches` sem `isMerged` também passa: é a chave que declara a união.
        expect(canExtendFeature(linha([A, B], { source: 'arrow', branches: [[A, B], [C, D]] })).ok)
            .toBe(true);
    });

    it('eixo curto demais é recusado com a frase do eixo', () => {
        expect(canExtendFeature(linha([A]))).toEqual({ ok: false, reason: SHORT_SPINE_NOTICE });
        const semEixo = linha([A, B]);
        semEixo.properties.baseCoordinates = [[NaN, NaN], B];
        semEixo.geometry = { type: 'Point', coordinates: A };
        expect(canExtendFeature(semEixo)).toEqual({ ok: false, reason: SHORT_SPINE_NOTICE });
    });

    it('as quatro frases são DISTINTAS: uma recusa que não se distingue não informa nada', () => {
        const frases = [NOT_EXTENDABLE_NOTICE, LOCKED_FEATURE_NOTICE, MERGED_ARROW_NOTICE, SHORT_SPINE_NOTICE];
        expect(new Set(frases).size).toBe(4);
        for (const f of frases) expect(f.length).toBeGreaterThan(10);
    });
});

describe('buildExtendedProperties: continuar muda UMA coisa, o eixo', () => {
    const instancias = [{ ratio: 0.25 }, { ratio: 0.75 }];
    const atributos = { unidade: '1º BI Mtz' };
    const feature = linha([A, B], {
        source: 'boundary',
        nome: 'Limite Norte',
        createdAtZoom: 12.4,
        zoomCorrectionEnabled: true,
        text_north_facing: false,
        symbol_instances: instancias,
        calculatedLineWidth: 7,
        calculatedTextSize: 13,
        calculatedStrokeWidth: 2,
        calculatedSymbolSize: 0.8,
        attributes: atributos,
    });

    it('o eixo é o novo e o objeto é NOVO', () => {
        const props = buildExtendedProperties(feature, [A, B, C]);
        expect(props.baseCoordinates).toEqual([A, B, C]);
        expect(props).not.toBe(feature.properties);
        expect(feature.properties.baseCoordinates).toEqual([A, B]);
    });

    it('a ÂNCORA DE ZOOM atravessa por IDENTIDADE: recarimbá-la redimensionaria a feição', () => {
        const props = buildExtendedProperties(feature, [A, B, C]);
        expect(props.createdAtZoom).toBe(12.4);
        expect(props.zoomCorrectionEnabled).toBe(true);
        expect(props.text_north_facing).toBe(false);
    });

    it('`symbol_instances` atravessa pela MESMA referência: as razões do escalão são mantidas', () => {
        const props = buildExtendedProperties(feature, [A, B, C]);
        expect(props.symbol_instances).toBe(instancias);
        expect(props.attributes).toBe(atributos);
    });

    it('o cache `calculated*` atravessa intocado: quem o escreve é a passada de zoom', () => {
        const props = buildExtendedProperties(feature, [A, B, C]);
        expect(props.calculatedLineWidth).toBe(7);
        expect(props.calculatedTextSize).toBe(13);
        expect(props.calculatedStrokeWidth).toBe(2);
        expect(props.calculatedSymbolSize).toBe(0.8);
    });

    it('identidade e nome sobrevivem, porque a feição continua sendo a MESMA', () => {
        const props = buildExtendedProperties(feature, [A, B, C]);
        expect(props.id).toBe('f-1');
        expect(props.nome).toBe('Limite Norte');
        expect(props.source).toBe('boundary');
    });

    it('feição sem propriedades devolve só o eixo, sem lançar', () => {
        expect(buildExtendedProperties(undefined, [A, B])).toEqual({ baseCoordinates: [A, B] });
    });
});

describe('storedSpineMatches: a única confirmação de que a store gravou', () => {
    it('reconhece o eixo pedido depois de uma releitura bem-sucedida', () => {
        expect(storedSpineMatches(linha([A, B, C]), [A, B, C])).toBe(true);
    });

    it('reconhece o eixo mesmo quando a store devolve `baseCoordinates` como STRING', () => {
        const stored = linha([A, B]);
        stored.properties.baseCoordinates = JSON.stringify([A, B, C]);
        expect(storedSpineMatches(stored, [A, B, C])).toBe(true);
    });

    it('a recusa da store se lê como eixo ANTIGO, e o predicado devolve falso', () => {
        expect(storedSpineMatches(linha([A, B]), [A, B, C])).toBe(false);
    });

    it('feição sumida da store também é falso, que é o desfecho correto', () => {
        expect(storedSpineMatches(undefined, [A, B, C])).toBe(false);
        expect(storedSpineMatches(null, [A, B, C])).toBe(false);
    });

    it('mesmo comprimento com ponto diferente NÃO passa', () => {
        expect(storedSpineMatches(linha([A, B, D]), [A, B, C])).toBe(false);
    });

    it('um eixo pedido degenerado é falso, para não chancelar nada', () => {
        expect(storedSpineMatches(linha([A, B]), [A])).toBe(false);
        expect(storedSpineMatches(linha([A, B]), null)).toBe(false);
    });
});

// ============================================================================================
// INVARIANTES (fast-check): o que vale para TODO eixo e TODO lote de pontos novos
// ============================================================================================

/** Um par [lng, lat] dentro dos limites reais do globo. */
const arbPonto = fc.tuple(
    fc.double({ min: -180, max: 180, noNaN: true }),
    fc.double({ min: -85, max: 85, noNaN: true }),
);

/** Um eixo utilizável: dois pontos ou mais. */
const arbEixo = fc.array(arbPonto, { minLength: 2, maxLength: 12 });

/** Pontos acrescentados: pode ser vazio, que é o caso de cancelamento. */
const arbAcrescentados = fc.array(arbPonto, { minLength: 0, maxLength: 8 });

describe('invariantes do modelo', () => {
    it('o COMPRIMENTO é sempre a soma, nos dois sentidos', () => {
        fc.assert(fc.property(arbEixo, arbAcrescentados, fc.constantFrom('start', 'end'), (eixo, novos, ponta) => {
            expect(extendCoordinates(eixo, novos, ponta)).toHaveLength(eixo.length + novos.length);
        }));
    });

    it('o eixo ORIGINAL sobrevive CONTÍGUO e na ordem, em algum lugar do resultado', () => {
        // É esta que morre sem o `reverse`: pelo início, os pontos novos invertidos ficam antes
        // do eixo, então o eixo aparece contíguo no fim. Sem inverter, a fatia continua
        // contígua, mas a DUALIDADE do caso seguinte quebra.
        fc.assert(fc.property(arbEixo, arbAcrescentados, fc.constantFrom('start', 'end'), (eixo, novos, ponta) => {
            const saida = extendCoordinates(eixo, novos, ponta);
            const inicio = ponta === 'end' ? 0 : novos.length;
            expect(saida.slice(inicio, inicio + eixo.length)).toEqual(eixo);
        }));
    });

    it('DUALIDADE start/end: continuar pelo início é continuar pelo fim do eixo invertido', () => {
        fc.assert(fc.property(arbEixo, arbAcrescentados, (eixo, novos) => {
            const peloInicio = extendCoordinates(eixo, novos, 'start');
            const peloFim = extendCoordinates([...eixo].reverse(), novos, 'end');
            expect([...peloInicio].reverse()).toEqual(peloFim);
        }));
    });

    it('o ponto ÂNCORA é sempre o vértice da ponta escolhida', () => {
        fc.assert(fc.property(arbEixo, fc.constantFrom('start', 'end'), (eixo, ponta) => {
            const esperado = ponta === 'start' ? eixo[0] : eixo[eixo.length - 1];
            expect(anchorFor(eixo, ponta)).toEqual(esperado);
        }));
    });

    it('o CURSOR da prévia é sempre a ponta VIVA do desenho', () => {
        fc.assert(fc.property(arbEixo, arbAcrescentados, arbPonto, fc.constantFrom('start', 'end'), (eixo, novos, cursor, ponta) => {
            const previa = previewCoordinates(eixo, novos, cursor, ponta);
            expect(previa[ponta === 'end' ? previa.length - 1 : 0]).toEqual(cursor);
        }));
    });

    it('o eixo gravado com sucesso SEMPRE se reconhece na releitura', () => {
        fc.assert(fc.property(arbEixo, arbAcrescentados, fc.constantFrom('start', 'end'), (eixo, novos, ponta) => {
            const coords = extendCoordinates(eixo, novos, ponta);
            expect(storedSpineMatches(linha(coords), coords)).toBe(true);
        }));
    });
});
