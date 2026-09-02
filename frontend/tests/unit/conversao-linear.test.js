// Path: tests/unit/conversao-linear.test.js
//
// CONVERTER LINHA, SETA E LIMITE ENTRE SI: a decisão pura, nos seis sentidos.
//
// ================= O QUE ESTE ARQUIVO MEDE, E O QUE NÃO ======================
//
// Ele mede o MODELO (`src/js/tool_manager/helpers/linear-conversion.model.js`): quem vê o
// comando, o que atravessa a fronteira entre dois tipos e o que se perde nela. Que o menu de
// fato consulte a tabela, e que o item bloqueado saia com `aria-disabled` e SEM a propriedade
// `disabled`, é de `conversao-linear-menu-fiacao.test.js` (fiação textual) e do Playwright
// (`browser-collab-conversao-linear.spec.js`), porque o ambiente aqui é node puro, sem DOM.
//
// ================= OS DEFEITOS QUE ESTAS ASSERÇÕES PRENDEM ====================
//
// Cada bloco abaixo nasceu de um defeito medido nas DUAS conversões antigas
// (`convertLineToArrow` e `convertLineToBoundary`, que saíam de linha e mais nada):
//
//   - `||` COMENDO ZERO. `properties.opacity || defaultProps.fillOpacity` trocava uma
//     opacidade de 0 pela do padrão, e `layerId || 'default'` mandava para a camada
//     implícita quem tivesse `layerId` 0 ou `''`. Os dois casos têm CONTROLE NEGATIVO aqui:
//     a mesma entrada passa por uma reimplementação com `||` e o teste mostra que os dois
//     operadores DIVERGEM. Sem isso, um verde sobre `??` seria indistinguível de um verde
//     sobre `||` para toda entrada não-zero, que é a esmagadora maioria.
//   - CÓPIA RASA. `[...baseCoordinates]` compartilha cada par `[lng, lat]` com a origem, e
//     as instâncias de símbolo do limite iam por REFERÊNCIA do objeto estático da classe.
//   - NENHUM GATE. As duas ofereciam a conversão a um Leitor e num mapa travado.

import { describe, it, expect } from 'vitest';
import {
    DROPPED_BY_SOURCE,
    LINEAR_CONVERSION_CAPABILITIES,
    LINEAR_CONVERSION_LABELS,
    LINEAR_SOURCES,
    LINE_WIDTH_RANGE,
    LOCKED_FEATURE_NOTICE,
    LOCKED_MAP_NOTICE,
    MERGED_ARROW_NOTICE,
    PRESERVED_KEYS,
    SHORT_SPINE_NOTICE,
    buildConvertedProperties,
    canConvertLinear,
    describeConversionLoss,
    isMergedArrow,
    linearConversionActions,
    resolveSpineCoordinates,
} from '../../src/js/tool_manager/helpers/linear-conversion.model.js';
import { LOCKED_MAP_NOTICE as LOCKED_MAP_NOTICE_DO_MENU_DE_MAPA } from '../../src/js/sidebar/tabs/map-menu-actions.js';
import { readFileSync } from 'node:fs';

// ============================================================================
// OS PADRÕES DOS TRÊS CONTROLES
// ============================================================================

// Cópias literais dos `static DEFAULT_PROPERTIES` dos três controles. Eles NÃO se importam
// aqui: os três arquivos arrastam MapLibre, Turf e a store, e nenhum carrega em node puro.
// A cópia é presa pelo caso "os padrões copiados ainda existem nos controles", abaixo, que lê
// o TEXTO dos três arquivos e cobra cada chave de que estas asserções dependem — o que pega a
// forma de deriva que importa (uma chave renomeada ou removida) sem um extrator por arquivo.

const PADROES_LINHA = {
    lineColor: '#3f4fb5', lineWidth: 5, opacity: 0.7, lineStyle: 'solid',
    measure: false, profile: false, profileData: null, source: 'line',
    nome: '', descricao: '', visivel: true, bloqueado: false, observations: [],
};

const PADROES_SETA = {
    width: 500, fillColor: '#3f4fb5', lineColor: '#3f4fb5', lineWidth: 3,
    fillOpacity: 0.8, lineOpacity: 1.0, headLengthRatio: 1.5, showArrowHead: true,
    doubleHeaded: false, airmobile: false, airmobilePosition: 0.7,
    source: 'arrow', geometryType: 'arrow', baseCoordinates: [],
    nome: '', descricao: '', visivel: true, bloqueado: false,
};

const PADROES_LIMITE = {
    color: '#000000', lineWidth: 4, opacity: 1, source: 'boundary', type: 'boundary',
    symbol_instances: [{ ratio: 0.5, showLabels: true }], symbol_size: 1, text_size: 35,
    echelon: 'XXX', text_top: '', text_bottom: '', text_distance_ratio: 0.9,
    createdAtZoom: 0, zoomCorrectionEnabled: true,
    calculatedLineWidth: 4, calculatedTextSize: 35, calculatedStrokeWidth: 2,
    calculatedSymbolSize: 1, text_north_facing: false,
    nome: '', descricao: '', visivel: true, bloqueado: false,
};

const PADROES_POR_DESTINO = { line: PADROES_LINHA, arrow: PADROES_SETA, boundary: PADROES_LIMITE };

const EIXO = [[-43.20, -22.90], [-43.15, -22.85], [-43.10, -22.80]];

/** Uma feição de origem com o eixo canônico e as propriedades dadas. */
function feicao(source, extra = {}) {
    return {
        type: 'Feature',
        id: 1782053337250,
        properties: {
            id: 'origem-0001', source, layerId: 'default',
            nome: '', descricao: '', visivel: true, bloqueado: false,
            baseCoordinates: EIXO.map((p) => [...p]),
            ...extra,
        },
        geometry: { type: 'LineString', coordinates: EIXO.map((p) => [...p]) },
    };
}

/** Monta o bloco de propriedades do destino, com os padrões reais daquele tipo. */
function converter(source, target, extra = {}, opcoes = {}) {
    return buildConvertedProperties({
        feature: feicao(source, extra),
        target,
        defaults: PADROES_POR_DESTINO[target],
        id: 'destino-0001',
        nome: 'Nome Gerado #1',
        currentZoom: 12,
        ...opcoes,
    });
}

/** Predicado que libera tudo (um Editor com as duas capacidades). */
const podeTudo = () => true;

// ============================================================================
// AS TABELAS
// ============================================================================

describe('as tabelas do modelo', () => {
    it('os três tipos lineares, congelados e na ordem do menu', () => {
        expect(LINEAR_SOURCES).toEqual(['line', 'arrow', 'boundary']);
        expect(Object.isFrozen(LINEAR_SOURCES)).toBe(true);
        expect(Object.isFrozen(LINEAR_CONVERSION_LABELS)).toBe(true);
        expect(Object.isFrozen(DROPPED_BY_SOURCE)).toBe(true);
        expect(Object.isFrozen(LINE_WIDTH_RANGE)).toBe(true);
    });

    it('todo tipo tem rótulo, faixa de espessura e lista de descarte', () => {
        for (const tipo of LINEAR_SOURCES) {
            expect(LINEAR_CONVERSION_LABELS[tipo], tipo).toBeTypeOf('string');
            expect(LINEAR_CONVERSION_LABELS[tipo].length, tipo).toBeGreaterThan(10);
            expect(LINE_WIDTH_RANGE[tipo], tipo).toBeTruthy();
            expect(Array.isArray(DROPPED_BY_SOURCE[tipo]), tipo).toBe(true);
        }
    });

    it('a conversão pede AS DUAS capacidades, e elas são chaves de GuardAction', () => {
        // Uma só ofereceria, a quem edita e não apaga, uma travessia que morre na metade e
        // deixa as DUAS feições vivas.
        expect([...LINEAR_CONVERSION_CAPABILITIES]).toEqual(['CREATE_FEATURE', 'DELETE_FEATURE']);
        expect(Object.isFrozen(LINEAR_CONVERSION_CAPABILITIES)).toBe(true);
    });

    it('a faixa de espessura da linha é MAIOR que a dos outros dois, que é o motivo do grampo', () => {
        expect(LINE_WIDTH_RANGE.line.max).toBe(15);
        expect(LINE_WIDTH_RANGE.arrow.max).toBe(10);
        expect(LINE_WIDTH_RANGE.boundary.max).toBe(10);
        expect(LINE_WIDTH_RANGE.line.max).toBeGreaterThan(LINE_WIDTH_RANGE.arrow.max);
    });

    it('a lista de descarte da SETA carrega `doubleHeaded`', () => {
        // Absoluta de propósito: `doubleHeaded` é a chave mais NOVA da seta, e é exatamente a
        // que uma lista escrita à mão perde. Uma feição que deixa de ser seta carregando
        // `isMerged` faz a geometria da seta tentar unir ramos que não existem mais.
        expect(DROPPED_BY_SOURCE.arrow).toContain('doubleHeaded');
        expect(DROPPED_BY_SOURCE.arrow).toContain('isMerged');
        expect(DROPPED_BY_SOURCE.arrow).toContain('branches');
    });

    it('a frase do mapa travado é IDÊNTICA à do menu por mapa', () => {
        // As duas cópias existem por fronteira de chunk (`tool_manager` é core,
        // `sidebar/tabs` é ui-components, e a aresta core -> ui-components é ciclo). O que não
        // pode acontecer é o produto dizer uma frase numa tela e outra noutra sobre o MESMO
        // cadeado, e esta é a única coisa que impede.
        expect(LOCKED_MAP_NOTICE).toBe(LOCKED_MAP_NOTICE_DO_MENU_DE_MAPA);
    });

    it('as quatro frases de estado são distintas e falam do estado, não do papel', () => {
        const frases = [LOCKED_MAP_NOTICE, LOCKED_FEATURE_NOTICE, MERGED_ARROW_NOTICE, SHORT_SPINE_NOTICE];
        expect(new Set(frases).size).toBe(4);
        for (const f of frases) {
            expect(f, f).toBeTypeOf('string');
            // Nenhuma pode nomear posto: a frase do ESTADO é sobre o estado. Nomear papel é o
            // defeito que `denial-phrases.js` existe para não repetir.
            expect(f.toLowerCase()).not.toMatch(/leitor|editor|gestor|dono|comentarista/);
        }
    });

    it('os padrões copiados ainda existem nos três controles', () => {
        // A cópia acima é a única forma de rodar isto em node; este caso é o que a mantém
        // honesta. Ele cobra PRESENÇA textual das chaves de que as asserções dependem, o que
        // pega renomeação e remoção sem um extrator por arquivo (que é o tipo de leitor que já
        // parou de ler calado neste repositório).
        const fonte = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
        const linha = fonte('../../src/js/draw_tools/line_tool/add_line_control.js');
        const seta = fonte('../../src/js/military_tools/arrow_tool/add_arrow_control.js');
        const limite = fonte('../../src/js/military_tools/boundary_tool/add_boundary_control.js');

        for (const chave of ['lineColor', 'lineWidth', 'opacity', 'lineStyle', 'measure', 'profile']) {
            expect(linha, `add_line_control perdeu '${chave}'`).toContain(`${chave}:`);
        }
        for (const chave of ['fillColor', 'lineColor', 'fillOpacity', 'lineOpacity', 'width', 'doubleHeaded', 'showArrowHead']) {
            expect(seta, `add_arrow_control perdeu '${chave}'`).toContain(`${chave}:`);
        }
        for (const chave of ['color', 'symbol_instances', 'symbol_size', 'text_size', 'echelon', 'createdAtZoom', 'zoomCorrectionEnabled', 'text_north_facing']) {
            expect(limite, `add_boundary_control perdeu '${chave}'`).toContain(`${chave}:`);
        }

        // DISCRIMINAÇÃO: o leitor não devolve verdadeiro para qualquer coisa.
        expect(seta).not.toContain('doubleHeadedness:');
    });
});

// ============================================================================
// O EIXO
// ============================================================================

describe('resolveSpineCoordinates', () => {
    it('lê o array de `baseCoordinates` e devolve uma cópia PROFUNDA', () => {
        const f = feicao('line');
        const eixo = resolveSpineCoordinates(f);
        expect(eixo).toEqual(EIXO);

        // A origem está prestes a ser apagada: mexer num vértice do novo não pode mexer no
        // antigo enquanto ele ainda existir. `[...coords]` compartilhava cada par.
        eixo[0][0] = 999;
        expect(f.properties.baseCoordinates[0][0]).toBe(-43.20);
        expect(eixo).not.toBe(f.properties.baseCoordinates);
    });

    it('aceita `baseCoordinates` como STRING (o formato que volta do servidor)', () => {
        const f = feicao('boundary', { baseCoordinates: JSON.stringify(EIXO) });
        expect(resolveSpineCoordinates(f)).toEqual(EIXO);
    });

    it('string que não é JSON cai na reserva da geometria, e não lança', () => {
        const f = feicao('line', { baseCoordinates: '{isto nao e json' });
        // A reserva é a geometria `LineString` desta feição.
        expect(resolveSpineCoordinates(f)).toEqual(EIXO);
    });

    it('sem `baseCoordinates`, usa a geometria SÓ quando ela é LineString', () => {
        const semProps = {
            type: 'Feature',
            properties: { source: 'line' },
            geometry: { type: 'LineString', coordinates: EIXO },
        };
        expect(resolveSpineCoordinates(semProps)).toEqual(EIXO);
    });

    it('Polygon e MultiLineString NÃO servem de eixo: são a forma DESENHADA', () => {
        // A seta é um polígono (o contorno) e o limite é um MultiLineString (os segmentos com
        // os vãos do escalão recortados). Lê-los como eixo produziria uma conversão com a
        // forma desenhada no lugar da autoral.
        const poligono = {
            type: 'Feature',
            properties: { source: 'arrow' },
            geometry: { type: 'Polygon', coordinates: [[...EIXO, EIXO[0]]] },
        };
        const multi = {
            type: 'Feature',
            properties: { source: 'boundary' },
            geometry: { type: 'MultiLineString', coordinates: [EIXO] },
        };
        expect(resolveSpineCoordinates(poligono)).toBeNull();
        expect(resolveSpineCoordinates(multi)).toBeNull();
    });

    it('um vértice só não é eixo', () => {
        const soUmVertice = {
            type: 'Feature',
            properties: { source: 'line', baseCoordinates: [[-43.2, -22.9]] },
            geometry: { type: 'LineString', coordinates: [[-43.2, -22.9]] },
        };
        expect(resolveSpineCoordinates(soUmVertice)).toBeNull();
    });

    it('a reserva da geometria SALVA um `baseCoordinates` estragado, e é assim de propósito', () => {
        // Uma feição cujo `baseCoordinates` tem um vértice só, mas cuja geometria desenhada é
        // uma LineString íntegra, converte pela GEOMETRIA. Este caso existe para deixar claro
        // que o caso acima mede a falta dos DOIS, e não só do primeiro.
        const estragado = feicao('line', { baseCoordinates: [[-43.2, -22.9]] });
        expect(resolveSpineCoordinates(estragado)).toEqual(EIXO);
    });

    it('vértice não finito derruba o eixo inteiro (NaN, Infinity, string)', () => {
        const semGeometria = (coords) => ({ type: 'Feature', properties: { source: 'line', baseCoordinates: coords } });
        expect(resolveSpineCoordinates(semGeometria([[NaN, -22.9], [-43.1, -22.8]]))).toBeNull();
        expect(resolveSpineCoordinates(semGeometria([[-43.2, Infinity], [-43.1, -22.8]]))).toBeNull();
        expect(resolveSpineCoordinates(semGeometria([['-43.2', '-22.9'], [-43.1, -22.8]]))).toBeNull();
        expect(resolveSpineCoordinates(semGeometria([[-43.2], [-43.1, -22.8]]))).toBeNull();
    });

    it('entradas vazias devolvem null em vez de lançar', () => {
        expect(resolveSpineCoordinates(undefined)).toBeNull();
        expect(resolveSpineCoordinates(null)).toBeNull();
        expect(resolveSpineCoordinates({})).toBeNull();
        expect(resolveSpineCoordinates({ properties: {} })).toBeNull();
    });
});

// ============================================================================
// A SETA COMBINADA
// ============================================================================

describe('isMergedArrow', () => {
    it('precisa das TRÊS condições, e dois ramos são o mínimo', () => {
        expect(isMergedArrow({ isMerged: true, branches: [{}, {}] })).toBe(true);
        // Um ramo só não é combinação: é uma seta comum com um sinalizador ligado.
        expect(isMergedArrow({ isMerged: true, branches: [{}] })).toBe(false);
        // `isMerged` sem array (uma separação interrompida) é o estado mentiroso.
        expect(isMergedArrow({ isMerged: true })).toBe(false);
        expect(isMergedArrow({ isMerged: true, branches: 'dois' })).toBe(false);
        expect(isMergedArrow({ branches: [{}, {}] })).toBe(false);
        // Truthy que não é `true` não conta.
        expect(isMergedArrow({ isMerged: 1, branches: [{}, {}] })).toBe(false);
        expect(isMergedArrow(undefined)).toBe(false);
    });
});

// ============================================================================
// A POSSIBILIDADE ESTRUTURAL
// ============================================================================

describe('canConvertLinear', () => {
    it('os SEIS sentidos entre os três tipos são possíveis', () => {
        const pares = [];
        for (const origem of LINEAR_SOURCES) {
            for (const destino of LINEAR_SOURCES) {
                if (origem === destino) continue;
                pares.push([origem, destino]);
                expect(canConvertLinear(feicao(origem), destino), `${origem} -> ${destino}`).toBe(true);
            }
        }
        expect(pares).toHaveLength(6);
    });

    it('converter para o MESMO tipo é recusado nos três', () => {
        for (const tipo of LINEAR_SOURCES) {
            expect(canConvertLinear(feicao(tipo), tipo), tipo).toBe(false);
        }
    });

    it('tipo não linear recusa, na origem e no destino', () => {
        expect(canConvertLinear(feicao('polygon'), 'line')).toBe(false);
        expect(canConvertLinear(feicao('point'), 'arrow')).toBe(false);
        expect(canConvertLinear(feicao('line'), 'polygon')).toBe(false);
        expect(canConvertLinear(feicao('line'), undefined)).toBe(false);
    });

    it('a seta COMBINADA recusa; a de um ramo só, não', () => {
        expect(canConvertLinear(feicao('arrow', { isMerged: true, branches: [{}, {}] }), 'line')).toBe(false);
        expect(canConvertLinear(feicao('arrow', { isMerged: true, branches: [{}] }), 'line')).toBe(true);
        expect(canConvertLinear(feicao('arrow', { isMerged: true }), 'line')).toBe(true);
    });

    it('sem eixo, recusa', () => {
        const semEixo = {
            type: 'Feature',
            properties: { source: 'line', baseCoordinates: [[-43.2, -22.9]] },
            geometry: { type: 'Polygon', coordinates: [] },
        };
        expect(canConvertLinear(semEixo, 'arrow')).toBe(false);
    });
});

// ============================================================================
// O BLOCO DE PROPRIEDADES
// ============================================================================

describe('buildConvertedProperties: o que atravessa', () => {
    it('a identidade é NOVA, e o eixo é o da origem', () => {
        const props = converter('line', 'arrow');
        expect(props.id).toBe('destino-0001');
        expect(props.id).not.toBe('origem-0001');
        expect(props.source).toBe('arrow');
        expect(props.baseCoordinates).toEqual(EIXO);
    });

    it('preserva nome, descrição, visibilidade e bloqueio', () => {
        const props = converter('line', 'boundary', {
            nome: 'Eixo Azul', descricao: '<p>nota</p>', visivel: false, bloqueado: true,
        });
        expect(props.nome).toBe('Eixo Azul');
        expect(props.descricao).toBe('<p>nota</p>');
        expect(props.visivel).toBe(false);
        expect(props.bloqueado).toBe(true);
    });

    it('sem nome na origem, usa o gerado', () => {
        expect(converter('line', 'arrow', { nome: '' }).nome).toBe('Nome Gerado #1');
        expect(converter('line', 'arrow', { nome: undefined }).nome).toBe('Nome Gerado #1');
    });

    it('preserva os atributos digitados pelo usuário, em CÓPIA', () => {
        const attributes = { unidade: '1º BI Mtz', efetivo: 120 };
        const props = converter('line', 'arrow', { attributes });
        expect(props.attributes).toEqual(attributes);
        expect(props.attributes).not.toBe(attributes);
    });

    it('preserva a janela temporal, zero inclusive', () => {
        const props = converter('boundary', 'line', { temporalInicio: 0, temporalFim: 1700000000000 });
        expect(props.temporalInicio).toBe(0);
        expect(props.temporalFim).toBe(1700000000000);
    });

    it('a lista de preservados é a que o código realmente atravessa', () => {
        expect([...PRESERVED_KEYS]).toContain('layerId');
        expect([...PRESERVED_KEYS]).toContain('attributes');
        expect(Object.isFrozen(PRESERVED_KEYS)).toBe(true);
    });

    it('devolve null quando a origem não tem eixo', () => {
        const props = buildConvertedProperties({
            feature: { type: 'Feature', properties: { source: 'line' }, geometry: null },
            target: 'arrow',
            defaults: PADROES_SETA,
            id: 'x',
        });
        expect(props).toBeNull();
    });
});

describe('buildConvertedProperties: `??` e não `||` (o zero que era comido)', () => {
    it('CONTROLE NEGATIVO — opacidade 0 sobrevive, e `||` a comeria', () => {
        // A entrada: uma linha deliberadamente invisível.
        const origem = feicao('line', { opacity: 0 });
        const props = buildConvertedProperties({
            feature: origem, target: 'arrow', defaults: PADROES_SETA, id: 'x', currentZoom: 12,
        });

        // O que o código faz hoje.
        expect(props.fillOpacity).toBe(0);
        expect(props.lineOpacity).toBe(0);

        // O que o código ANTIGO fazia, reimplementado aqui na forma exata que ele tinha. Sem
        // este par, o verde acima seria indistinguível de um verde sobre `||`, porque os dois
        // operadores concordam em toda entrada que não seja falsy.
        const comOuOu = origem.properties.opacity || PADROES_SETA.fillOpacity;
        expect(comOuOu, 'o `||` devolve o PADRÃO para uma opacidade de 0').toBe(0.8);
        expect(props.fillOpacity, 'e é justamente por isso que os dois divergem').not.toBe(comOuOu);
    });

    it('CONTROLE NEGATIVO — `layerId` 0 e `\'\'` sobrevivem, e `||` os mandaria para a camada implícita', () => {
        for (const layerId of [0, '']) {
            const origem = feicao('line', { layerId });
            const props = buildConvertedProperties({
                feature: origem, target: 'boundary', defaults: PADROES_LIMITE, id: 'x', currentZoom: 12,
            });
            expect(props.layerId, `layerId ${JSON.stringify(layerId)}`).toBe(layerId);

            const comOuOu = origem.properties.layerId || 'default';
            expect(comOuOu).toBe('default');
            expect(props.layerId).not.toBe(comOuOu);
        }
    });

    it('opacidade 0 sobrevive TAMBÉM ao voltar de seta para linha', () => {
        const props = converter('arrow', 'line', { fillOpacity: 0, fillColor: '#112233' });
        expect(props.opacity).toBe(0);
    });
});

describe('buildConvertedProperties: cópia profunda e identidade', () => {
    it('as instâncias de símbolo do limite NÃO são as do objeto estático da classe', () => {
        // O padrão é um array COMPARTILHADO no `static DEFAULT_PROPERTIES`. Duas conversões
        // sem clone dividiam o mesmo array, e arrastar o símbolo de um limite movia o do outro.
        const a = converter('line', 'boundary');
        const b = converter('line', 'boundary');
        expect(a.symbol_instances).toEqual([{ ratio: 0.5, showLabels: true }]);
        expect(a.symbol_instances).not.toBe(PADROES_LIMITE.symbol_instances);
        expect(a.symbol_instances).not.toBe(b.symbol_instances);
        expect(a.symbol_instances[0]).not.toBe(PADROES_LIMITE.symbol_instances[0]);

        a.symbol_instances[0].ratio = 0.9;
        expect(PADROES_LIMITE.symbol_instances[0].ratio).toBe(0.5);
        expect(b.symbol_instances[0].ratio).toBe(0.5);
    });

    it('o eixo devolvido não compartilha nenhum par com a origem', () => {
        const origem = feicao('line');
        const props = buildConvertedProperties({
            feature: origem, target: 'arrow', defaults: PADROES_SETA, id: 'x', currentZoom: 12,
        });
        props.baseCoordinates[1][1] = 0;
        expect(origem.properties.baseCoordinates[1][1]).toBe(-22.85);
    });
});

describe('buildConvertedProperties: o estilo, por destino', () => {
    it('para SETA, a cor e a opacidade únicas viram DUAS de cada', () => {
        const props = converter('line', 'arrow', { lineColor: '#ee1111', opacity: 0.35 });
        expect(props.fillColor).toBe('#ee1111');
        expect(props.lineColor).toBe('#ee1111');
        expect(props.fillOpacity).toBe(0.35);
        expect(props.lineOpacity).toBe(0.35);
    });

    it('para LINHA, a cor da seta vem do PREENCHIMENTO', () => {
        const props = converter('arrow', 'line', { fillColor: '#00aa00', lineColor: '#ff0000', fillOpacity: 0.4 });
        expect(props.lineColor).toBe('#00aa00');
        expect(props.opacity).toBe(0.4);
    });

    it('para LIMITE, a cor vai para `color` e a largura para `lineWidth`', () => {
        const props = converter('line', 'boundary', { lineColor: '#123456', lineWidth: 7, opacity: 0.9 });
        expect(props.color).toBe('#123456');
        expect(props.lineWidth).toBe(7);
        expect(props.opacity).toBe(0.9);
    });

    it('a largura da seta e o tamanho do símbolo vêm do zoom, quando o chamador os passa', () => {
        const comSeta = converter('line', 'arrow', {}, { adaptiveWidth: 250 });
        expect(comSeta.width).toBe(250);

        const comLimite = converter('line', 'boundary', {}, { adaptiveSymbolSize: 3.5 });
        expect(comLimite.symbol_size).toBe(3.5);

        // Sem eles, o padrão do destino sobrevive: um `undefined` não pode virar `NaN`.
        expect(converter('line', 'arrow').width).toBe(500);
        expect(converter('line', 'boundary').symbol_size).toBe(1);
    });
});

describe('buildConvertedProperties: o grampo da espessura', () => {
    it('14 na linha vira 10 na seta e no limite (a faixa do painel deles para em 10)', () => {
        expect(converter('line', 'arrow', { lineWidth: 14 }).lineWidth).toBe(10);
        expect(converter('line', 'boundary', { lineWidth: 14 }).lineWidth).toBe(10);
        // E 14 continua 14 quando o destino é a linha, cuja faixa vai a 15.
        expect(converter('boundary', 'line', { lineWidth: 14 }).lineWidth).toBe(14);
    });

    it('0 vira 1, o mínimo da faixa dos três', () => {
        for (const destino of LINEAR_SOURCES) {
            const origem = destino === 'line' ? 'arrow' : 'line';
            expect(converter(origem, destino, { lineWidth: 0 }).lineWidth, destino).toBe(1);
        }
    });

    it('NaN e valores não numéricos caem no padrão do DESTINO, nunca em NaN', () => {
        // `x ?? 0` NÃO guarda NaN: `NaN` é um valor presente. Uma largura NaN é aceita pelo
        // MapLibre e desenhada como nada.
        expect(converter('line', 'arrow', { lineWidth: NaN }).lineWidth).toBe(PADROES_SETA.lineWidth);
        expect(converter('line', 'boundary', { lineWidth: undefined }).lineWidth).toBe(PADROES_LIMITE.lineWidth);
        expect(converter('line', 'arrow', { lineWidth: 'grossa' }).lineWidth).toBe(PADROES_SETA.lineWidth);
        expect(converter('arrow', 'line', { lineWidth: Infinity }).lineWidth).toBe(PADROES_LINHA.lineWidth);
    });

    it('a opacidade é grampeada em [0, 1] e nunca sai NaN', () => {
        expect(converter('line', 'boundary', { opacity: 5 }).opacity).toBe(1);
        expect(converter('line', 'boundary', { opacity: -3 }).opacity).toBe(0);
        expect(converter('line', 'boundary', { opacity: NaN }).opacity).toBe(PADROES_LIMITE.opacity);
    });
});

describe('buildConvertedProperties: a âncora de zoom do limite', () => {
    it('grava a âncora com uma casa decimal e liga a correção', () => {
        const props = converter('line', 'boundary', {}, { currentZoom: 12.3456 });
        expect(props.createdAtZoom).toBe(12.3);
        expect(props.zoomCorrectionEnabled).toBe(true);
        expect(props.text_north_facing).toBe(false);
    });

    it('os quatro derivados são recalculados DEPOIS do bloco inteiro, não herdados', () => {
        // O padrão carrega `calculatedTextSize: 35` e `calculatedLineWidth: 4`. Com a âncora
        // no zoom corrente, o fator é 1 e os derivados têm de refletir os valores AUTORAIS
        // (a largura de 9 que veio da linha), não os quatro números do padrão.
        const props = converter('line', 'boundary', { lineWidth: 9 }, { currentZoom: 12 });
        expect(props.lineWidth).toBe(9);
        expect(props.calculatedLineWidth).toBe(9);
        expect(props.calculatedTextSize).toBe(PADROES_LIMITE.text_size);
        expect(props.calculatedSymbolSize).toBe(props.symbol_size);
    });

    it('o limite NÃO herda a âncora de um limite anterior ao virar linha e voltar', () => {
        const props = converter('boundary', 'line', { createdAtZoom: 3, zoomCorrectionEnabled: false });
        expect(props.createdAtZoom).toBeUndefined();
        expect(props.zoomCorrectionEnabled).toBeUndefined();
    });
});

describe('buildConvertedProperties: o que NÃO atravessa', () => {
    it('nenhuma chave descartada da ORIGEM sobrevive, salvo as que o destino declara', () => {
        const cheia = {
            line: { measure: true, profile: true, profileData: '[]', lineStyle: 'dashed', observations: ['x'] },
            arrow: {
                width: 900, headLengthRatio: 2, showArrowHead: false, doubleHeaded: true,
                airmobile: true, airmobilePosition: 0.3, isMerged: true, branches: [{}], geometryType: 'arrow',
            },
            boundary: {
                echelon: 'XX', symbol_instances: [{ ratio: 0.2, showLabels: false }], symbol_size: 4,
                text_size: 60, text_top: 'A', text_bottom: 'B', text_distance_ratio: 0.5,
                text_north_facing: true, createdAtZoom: 8, zoomCorrectionEnabled: false,
                calculatedLineWidth: 9, calculatedTextSize: 90, calculatedStrokeWidth: 5, calculatedSymbolSize: 7,
            },
        };

        let checados = 0;
        for (const origem of LINEAR_SOURCES) {
            for (const destino of LINEAR_SOURCES) {
                if (origem === destino) continue;
                const props = converter(origem, destino, cheia[origem]);
                for (const chave of DROPPED_BY_SOURCE[origem]) {
                    if (Object.hasOwn(PADROES_POR_DESTINO[destino], chave)) continue;
                    expect(props, `${origem} -> ${destino} carregou '${chave}'`).not.toHaveProperty(chave);
                    checados++;
                }
            }
        }
        // PISO: sem ele, uma tabela de descarte esvaziada deixaria este caso verde sem medir nada.
        expect(checados, 'o laço não checou chave nenhuma').toBeGreaterThan(30);
    });

    it('em especial, uma seta COMBINADA que vira linha não leva `isMerged` nem os ramos', () => {
        const props = converter('arrow', 'line', { isMerged: true, branches: [{}, {}] });
        expect(props).not.toHaveProperty('isMerged');
        expect(props).not.toHaveProperty('branches');
        expect(props).not.toHaveProperty('doubleHeaded');
    });
});

describe('buildConvertedProperties: ida e volta', () => {
    it('linha -> seta -> linha devolve cor, espessura, opacidade, nome e eixo', () => {
        const original = feicao('line', {
            lineColor: '#ee1111', lineWidth: 5, opacity: 0.7,
            nome: 'Eixo Azul', descricao: 'nota', layerId: 'camada-7',
        });

        const comoSeta = buildConvertedProperties({
            feature: original, target: 'arrow', defaults: PADROES_SETA, id: 'a1', currentZoom: 12,
        });
        const devolta = buildConvertedProperties({
            feature: { type: 'Feature', properties: comoSeta, geometry: null },
            target: 'line', defaults: PADROES_LINHA, id: 'l1', currentZoom: 12,
        });

        expect(devolta.lineColor).toBe('#ee1111');
        expect(devolta.lineWidth).toBe(5);
        expect(devolta.opacity).toBe(0.7);
        expect(devolta.nome).toBe('Eixo Azul');
        expect(devolta.descricao).toBe('nota');
        expect(devolta.layerId).toBe('camada-7');
        expect(devolta.baseCoordinates).toEqual(EIXO);
        expect(devolta.source).toBe('line');
    });

    it('linha -> limite -> linha também, e a volta não carrega o escalão', () => {
        const original = feicao('line', { lineColor: '#123456', lineWidth: 6, opacity: 0.5 });
        const comoLimite = buildConvertedProperties({
            feature: original, target: 'boundary', defaults: PADROES_LIMITE, id: 'b1', currentZoom: 12,
        });
        const devolta = buildConvertedProperties({
            feature: { type: 'Feature', properties: comoLimite, geometry: null },
            target: 'line', defaults: PADROES_LINHA, id: 'l1', currentZoom: 12,
        });

        expect(devolta.lineColor).toBe('#123456');
        expect(devolta.lineWidth).toBe(6);
        expect(devolta.opacity).toBe(0.5);
        expect(devolta).not.toHaveProperty('echelon');
    });
});

// ============================================================================
// A PERDA
// ============================================================================

describe('describeConversionLoss', () => {
    it('nomeia o que cada tipo de ORIGEM descarta', () => {
        expect(describeConversionLoss({ source: 'line', target: 'arrow' }))
            .toBe('A conversão descarta a medição, o perfil do terreno e o estilo do traço.');
        expect(describeConversionLoss({ source: 'arrow', target: 'line' }))
            .toBe('A conversão descarta a largura, a cabeça, a ponta dupla e o traçado aeromóvel.');
        expect(describeConversionLoss({ source: 'boundary', target: 'line' }))
            .toBe('A conversão descarta o escalão, os rótulos e o tamanho do símbolo.');
    });

    it('a saída do GRUPO entra na mesma frase, porque não tem volta', () => {
        // `removeFeature` chama `removeFeatureFromAllGroups`, e a store não tem operação que
        // acrescente uma feição a um grupo existente. Dizer na hora custa uma frase.
        const frase = describeConversionLoss({ source: 'line', target: 'boundary', inGroup: true });
        expect(frase).toContain('a participação no grupo');
        expect(frase).toContain('a medição');
        expect(frase.endsWith('.')).toBe(true);
    });

    it('sem grupo e sem descarte conhecido, não inventa frase', () => {
        expect(describeConversionLoss({ source: 'point', target: 'line' })).toBeNull();
        expect(describeConversionLoss({ source: 'line', target: 'line' })).toBeNull();
        expect(describeConversionLoss({})).toBeNull();
        // Mas um grupo sozinho ainda merece aviso.
        expect(describeConversionLoss({ source: 'point', target: 'line', inGroup: true }))
            .toBe('A conversão descarta a participação no grupo.');
    });
});

// ============================================================================
// POSTO: o comando SOME
// ============================================================================

describe('linearConversionActions: POSTO', () => {
    it('com as duas capacidades, os DOIS destinos aparecem, na ordem da tabela', () => {
        expect(linearConversionActions({ source: 'line', can: podeTudo, feature: feicao('line') })
            .map((a) => a.target)).toEqual(['arrow', 'boundary']);
        expect(linearConversionActions({ source: 'arrow', can: podeTudo, feature: feicao('arrow') })
            .map((a) => a.target)).toEqual(['line', 'boundary']);
        expect(linearConversionActions({ source: 'boundary', can: podeTudo, feature: feicao('boundary') })
            .map((a) => a.target)).toEqual(['line', 'arrow']);
    });

    it('CREATE negado esconde os dois comandos', () => {
        const acoes = linearConversionActions({
            source: 'line',
            can: (k) => k !== 'CREATE_FEATURE',
            feature: feicao('line'),
        });
        expect(acoes).toEqual([]);
    });

    it('CONTROLE NEGATIVO — SÓ o DELETE negado também esconde os dois', () => {
        // Este é o caso que um gate de UMA capacidade deixaria passar, e é o pior desfecho:
        // a travessia começaria (o CREATE é aceito) e morreria na remoção, deixando as DUAS
        // feições vivas no mapa e uma op recusada na fila de saída.
        const negaSoODelete = (k) => k !== 'DELETE_FEATURE';
        expect(linearConversionActions({ source: 'line', can: negaSoODelete, feature: feicao('line') }))
            .toEqual([]);

        // O par que prova que o predicado NÃO é um "nega tudo" disfarçado: ele libera o CREATE.
        expect(negaSoODelete('CREATE_FEATURE')).toBe(true);
        expect(negaSoODelete('DELETE_FEATURE')).toBe(false);

        // E o controle POSITIVO ao lado: com as duas liberadas, os mesmos argumentos devolvem
        // dois comandos. Sem ele, um modelo quebrado que devolvesse sempre `[]` passaria aqui.
        expect(linearConversionActions({ source: 'line', can: podeTudo, feature: feicao('line') }))
            .toHaveLength(2);
    });

    it('FALHA FECHADA: predicado que lança esconde tudo', () => {
        const acoes = linearConversionActions({
            source: 'line',
            can: () => { throw new Error('sessão ainda hidratando'); },
            feature: feicao('line'),
        });
        expect(acoes).toEqual([]);
    });

    it('FALHA FECHADA: truthy que não é `true` esconde tudo', () => {
        for (const valor of ['sim', 1, {}, []]) {
            expect(linearConversionActions({ source: 'line', can: () => valor, feature: feicao('line') }),
                JSON.stringify(valor)).toEqual([]);
        }
    });

    it('tipo não linear não recebe comando nenhum, mesmo com posto total', () => {
        expect(linearConversionActions({ source: 'polygon', can: podeTudo, feature: feicao('polygon') })).toEqual([]);
        expect(linearConversionActions({ source: undefined, can: podeTudo })).toEqual([]);
        expect(linearConversionActions()).toEqual([]);
    });

    it('POSTO vence ESTADO: sem a capacidade, o mapa travado não desenha item bloqueado', () => {
        const acoes = linearConversionActions({
            source: 'line', can: () => false, mapLocked: true, feature: feicao('line'),
        });
        expect(acoes).toEqual([]);
    });
});

// ============================================================================
// ESTADO: o comando é desenhado e o CLIQUE recusa
// ============================================================================

describe('linearConversionActions: ESTADO', () => {
    it('mapa travado: DOIS itens, com a frase do cadeado', () => {
        const acoes = linearConversionActions({
            source: 'line', can: podeTudo, mapLocked: true, feature: feicao('line'),
        });
        expect(acoes).toHaveLength(2);
        for (const acao of acoes) expect(acao.blocked).toBe(LOCKED_MAP_NOTICE);
    });

    it('o item devolvido tem EXATAMENTE duas chaves, e `disabled` não é uma delas', () => {
        // A propriedade `disabled` mata o clique, e o clique É o portador do motivo. O modelo
        // não pode nem sugerir a forma errada ao desenhista.
        const [acao] = linearConversionActions({
            source: 'line', can: podeTudo, mapLocked: true, feature: feicao('line'),
        });
        expect(Object.keys(acao).sort()).toEqual(['blocked', 'target']);
    });

    it('feição bloqueada: DOIS itens, com a frase do cadeado da feição', () => {
        const acoes = linearConversionActions({
            source: 'boundary', can: podeTudo, featureLocked: true, feature: feicao('boundary'),
        });
        expect(acoes).toHaveLength(2);
        expect(acoes.every((a) => a.blocked === LOCKED_FEATURE_NOTICE)).toBe(true);
    });

    it('seta combinada: DOIS itens, com a frase que manda separar', () => {
        // Reversível, e o desfaz ("Separar Setas") está no MESMO menu: esconder ensinaria
        // menos que recusar nomeando.
        const acoes = linearConversionActions({
            source: 'arrow', can: podeTudo,
            feature: feicao('arrow', { isMerged: true, branches: [{}, {}] }),
        });
        expect(acoes.map((a) => a.target)).toEqual(['line', 'boundary']);
        expect(acoes.every((a) => a.blocked === MERGED_ARROW_NOTICE)).toBe(true);
    });

    it('eixo curto: DOIS itens, com a frase do eixo', () => {
        const curta = {
            type: 'Feature',
            properties: { source: 'line', baseCoordinates: [[-43.2, -22.9]] },
            geometry: { type: 'LineString', coordinates: [[-43.2, -22.9]] },
        };
        const acoes = linearConversionActions({ source: 'line', can: podeTudo, feature: curta });
        expect(acoes).toHaveLength(2);
        expect(acoes.every((a) => a.blocked === SHORT_SPINE_NOTICE)).toBe(true);
    });

    it('o cadeado do MAPA tem precedência sobre os outros estados', () => {
        const acoes = linearConversionActions({
            source: 'arrow', can: podeTudo, mapLocked: true, featureLocked: true,
            feature: feicao('arrow', { isMerged: true, branches: [{}, {}] }),
        });
        expect(acoes.every((a) => a.blocked === LOCKED_MAP_NOTICE)).toBe(true);
    });

    it('sem estado nenhum, `blocked` é null nos dois', () => {
        const acoes = linearConversionActions({ source: 'line', can: podeTudo, feature: feicao('line') });
        expect(acoes.every((a) => a.blocked === null)).toBe(true);
    });

    it('devolve um array NOVO a cada chamada', () => {
        const a = linearConversionActions({ source: 'line', can: podeTudo, feature: feicao('line') });
        const b = linearConversionActions({ source: 'line', can: podeTudo, feature: feicao('line') });
        expect(a).not.toBe(b);
        a.pop();
        expect(b).toHaveLength(2);
    });
});
