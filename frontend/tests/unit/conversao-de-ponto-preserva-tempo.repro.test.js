// Path: tests/unit/conversao-de-ponto-preserva-tempo.repro.test.js
//
// ACHADO E1: CONVERTER UM PONTO EM SÍMBOLO MILITAR OU EM MEDIDA DE COORDENAÇÃO
// DESCARTAVA A JANELA DE VALIDADE, A TRAJETÓRIA E O RESTO DO DADO DO USUÁRIO.
//
// ================= A CAUSA ====================================================
//
// As duas conversões (`convertPointToMilitarySymbol` e `convertPointToCoordinationMeasure`,
// em `src/js/tool_manager/helpers/feature-header.helpers.js`) montavam a feição nova a
// partir dos padrões do DESTINO mais uma LISTA FIXA escrita à mão: `layerId`, `nome`,
// `descricao`, `visivel`, `bloqueado` e `opacity`. Tudo o que não estava na lista morria, e
// o ponto de origem era removido no MESMO lote, então não havia de onde recuperar. O que
// ficava de fora era justamente dado do usuário: `temporalInicio`/`temporalFim`,
// `trajetoria`, `attributes` e `images`.
//
// A ironia da classe é que ponto, símbolo militar e medida de coordenação são EXATAMENTE os
// três tipos que suportam trajetória: a travessia era entre dois tipos capazes de carregá-la
// e ela morria no meio. O irmão LINEAR já preservava a janela e os atributos por nome
// (`PRESERVED_KEYS`, `linear-conversion.model.js`); as conversões de ponto ficaram fora
// daquela mudança.
//
// ================= O QUE ESTE ARQUIVO MEDE, E O QUE NÃO =======================
//
// Ele mede o MODELO puro (`src/js/tool_manager/helpers/point-conversion.model.js`), que é
// onde o bloco de propriedades passou a ser montado. O ambiente aqui é node puro, sem DOM e
// sem MapLibre, então o `feature-header.helpers.js` (que importa o barril da store e o
// despachante de GeoJSON) não carrega: a FIAÇÃO entre o menu e o modelo é conferida por
// leitura textual do arquivo, no último bloco, que é o que impede o modelo de ficar certo e
// órfão.
//
// A REGRESSÃO ESTÁ PRESA POR PROPRIEDADE, NÃO POR EXEMPLO: o bloco de preservação varre
// `POINT_PRESERVED_KEYS`, de modo que uma chave nova na lista já entra na cobrança.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
    POINT_PRESERVED_KEYS,
    POINT_AUTO_DERIVATION_KEYS,
    buildConvertedPointProperties,
} from '@js/tool_manager/helpers/point-conversion.model.js';
import { PRESERVED_KEYS } from '@js/tool_manager/helpers/linear-conversion.model.js';

/** `DEFAULT_PROPERTIES` reduzido do controle de destino (símbolo militar). */
const SYMBOL_DEFAULTS = Object.freeze({
    source: 'military_symbol',
    size: 1,
    width: 100,
    height: 100,
    opacity: 1,
    rotation: 0,
    nome: '',
    descricao: '',
    visivel: true,
    bloqueado: false,
    direction: null,
    speed: null,
    dateTimeGroup: null,
});

/** Um ponto com TODO o dado de usuário que a conversão antiga descartava. */
function pontoCompleto(overrides = {}) {
    return {
        type: 'Feature',
        properties: {
            source: 'point',
            id: 'ponto-1',
            layerId: 'camada-7',
            nome: 'Posto de Comando',
            descricao: 'PC do 1º Batalhão',
            visivel: true,
            bloqueado: false,
            opacity: 0.4,
            attributes: { unidade: '1º BI', observacao: 'sob fumaça' },
            images: [{ id: 'foto-1', nome: 'aproximação.jpg' }],
            temporalInicio: 1750000000000,
            temporalFim: 1750003600000,
            trajetoria: [
                { t: 1750000000000, lng: -43.2, lat: -22.9 },
                { t: 1750003600000, lng: -43.1, lat: -22.8 },
            ],
            ...overrides,
        },
        geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
    };
}

describe('E1 — a janela de validade e a trajetória atravessam a conversão de ponto', () => {
    it('preserva janela, trajetória, atributos e imagens', () => {
        const props = buildConvertedPointProperties({
            feature: pontoCompleto(),
            defaults: SYMBOL_DEFAULTS,
            id: 'simbolo-1',
            nome: 'Símbolo 1',
        });

        expect(props.temporalInicio).toBe(1750000000000);
        expect(props.temporalFim).toBe(1750003600000);
        expect(props.trajetoria).toEqual([
            { t: 1750000000000, lng: -43.2, lat: -22.9 },
            { t: 1750003600000, lng: -43.1, lat: -22.8 },
        ]);
        expect(props.attributes).toEqual({ unidade: '1º BI', observacao: 'sob fumaça' });
        expect(props.images).toEqual([{ id: 'foto-1', nome: 'aproximação.jpg' }]);
    });

    it('preserva TODA chave declarada em POINT_PRESERVED_KEYS quando a origem a tem', () => {
        const origem = pontoCompleto({ _temporalHome: [-43.2, -22.9] });
        const props = buildConvertedPointProperties({
            feature: origem,
            defaults: SYMBOL_DEFAULTS,
            id: 'simbolo-1',
            nome: 'Símbolo 1',
        });

        // Asserção de PRESENÇA antes da comparação: uma lista vazia passaria verde sem
        // verificar nada (cobertura vazia).
        expect(POINT_PRESERVED_KEYS.length).toBeGreaterThan(10);
        for (const key of POINT_PRESERVED_KEYS) {
            expect(origem.properties[key]).toBeDefined();
            expect(props[key]).toEqual(origem.properties[key]);
        }
    });

    it('copia em PROFUNDIDADE: editar a feição nova não mexe na que vai ser apagada', () => {
        const origem = pontoCompleto();
        const props = buildConvertedPointProperties({
            feature: origem,
            defaults: SYMBOL_DEFAULTS,
            id: 'simbolo-1',
        });

        props.trajetoria[0].lng = 0;
        props.attributes.unidade = 'outra';
        props.images[0].nome = 'outra.jpg';

        expect(origem.properties.trajetoria[0].lng).toBe(-43.2);
        expect(origem.properties.attributes.unidade).toBe('1º BI');
        expect(origem.properties.images[0].nome).toBe('aproximação.jpg');
    });

    it('não inventa janela nem trajetória num ponto permanente e parado', () => {
        const props = buildConvertedPointProperties({
            feature: {
                type: 'Feature',
                properties: { source: 'point', id: 'p', nome: 'P' },
                geometry: { type: 'Point', coordinates: [0, 0] },
            },
            defaults: SYMBOL_DEFAULTS,
            id: 'simbolo-1',
            nome: 'Símbolo 1',
        });

        // Ausente continua AUSENTE: uma chave `undefined` no JSONB diria o mesmo com ruído.
        expect(Object.hasOwn(props, 'temporalInicio')).toBe(false);
        expect(Object.hasOwn(props, 'temporalFim')).toBe(false);
        expect(Object.hasOwn(props, 'trajetoria')).toBe(false);
        expect(Object.hasOwn(props, '_temporalHome')).toBe(false);
    });
});

describe('E1 — `_temporalHome`, que é o que impede o símbolo de se mudar de lugar', () => {
    it('viaja, porque `cleanFeature` o LÊ para persistir a casa em vez da posição interpolada', () => {
        const props = buildConvertedPointProperties({
            feature: pontoCompleto({ _temporalHome: [-43.2, -22.9] }),
            defaults: SYMBOL_DEFAULTS,
            id: 'simbolo-1',
        });

        expect(props._temporalHome).toEqual([-43.2, -22.9]);
    });

    it('viaja como ARRAY NOVO, não por referência à origem', () => {
        const origem = pontoCompleto({ _temporalHome: [-43.2, -22.9] });
        const props = buildConvertedPointProperties({
            feature: origem,
            defaults: SYMBOL_DEFAULTS,
            id: 'simbolo-1',
        });

        expect(props._temporalHome).not.toBe(origem.properties._temporalHome);
        props._temporalHome[0] = 0;
        expect(origem.properties._temporalHome[0]).toBe(-43.2);
    });

    it('recusa um par inutilizável em vez de carregar NaN para dentro da geometria', () => {
        for (const lixo of [[NaN, -22.9], ['-43.2', -22.9], [-43.2], 'x', null]) {
            const props = buildConvertedPointProperties({
                feature: pontoCompleto({ _temporalHome: lixo }),
                defaults: SYMBOL_DEFAULTS,
                id: 'simbolo-1',
            });
            expect(Object.hasOwn(props, '_temporalHome')).toBe(false);
        }
    });
});

describe('E1 — os interruptores de derivação nascem desligados', () => {
    it('apaga `autoDirection`/`autoSpeed`/`autoDtg` que um padrão de destino traga', () => {
        expect(POINT_AUTO_DERIVATION_KEYS).toEqual(['autoDirection', 'autoSpeed', 'autoDtg']);

        const props = buildConvertedPointProperties({
            feature: pontoCompleto(),
            defaults: { ...SYMBOL_DEFAULTS, autoDirection: true, autoSpeed: true, autoDtg: true },
            id: 'simbolo-1',
        });

        for (const key of POINT_AUTO_DERIVATION_KEYS) {
            expect(Object.hasOwn(props, key)).toBe(false);
        }
    });

    it('nem mesmo herda um interruptor posto na feição de PONTO de origem', () => {
        const props = buildConvertedPointProperties({
            feature: pontoCompleto({ autoDirection: true, autoDtg: true }),
            defaults: SYMBOL_DEFAULTS,
            id: 'simbolo-1',
        });

        expect(props.autoDirection).toBeUndefined();
        expect(props.autoDtg).toBeUndefined();
    });
});

describe('E1 — bordas que a lista fixa antiga acertava por acaso ou errava', () => {
    it('`layerId` de `0` ou `` continua sendo o da origem (o `||` mandava para `default`)', () => {
        for (const layerId of [0, '']) {
            const props = buildConvertedPointProperties({
                feature: pontoCompleto({ layerId }),
                defaults: SYMBOL_DEFAULTS,
                id: 'simbolo-1',
            });
            expect(props.layerId).toBe(layerId);
            // Controle negativo do operador: o `||` da versão antiga divergiria aqui.
            expect(layerId || 'default').toBe('default');
        }
    });

    it('opacidade `0` sobrevive e opacidade `NaN` cai no padrão', () => {
        const zero = buildConvertedPointProperties({
            feature: pontoCompleto({ opacity: 0 }),
            defaults: SYMBOL_DEFAULTS,
            id: 'x',
        });
        expect(zero.opacity).toBe(0);

        const nan = buildConvertedPointProperties({
            feature: pontoCompleto({ opacity: NaN }),
            defaults: SYMBOL_DEFAULTS,
            id: 'x',
        });
        expect(nan.opacity).toBe(1);
        // `??` deixaria o NaN passar, e o MapLibre desenha NaN como nada.
        expect(Number.isNaN(NaN ?? 1)).toBe(true);
    });

    it('nome vazio cai no gerado, nome escrito sobrevive, `bloqueado` é estrito', () => {
        const semNome = buildConvertedPointProperties({
            feature: pontoCompleto({ nome: '' }),
            defaults: SYMBOL_DEFAULTS,
            id: 'x',
            nome: 'Símbolo 3',
        });
        expect(semNome.nome).toBe('Símbolo 3');

        const comNome = buildConvertedPointProperties({
            feature: pontoCompleto(),
            defaults: SYMBOL_DEFAULTS,
            id: 'x',
            nome: 'Símbolo 3',
        });
        expect(comNome.nome).toBe('Posto de Comando');

        const truthy = buildConvertedPointProperties({
            feature: pontoCompleto({ bloqueado: 'sim' }),
            defaults: SYMBOL_DEFAULTS,
            id: 'x',
        });
        // Estrito: qualquer truthy que não seja `true` vira `false`, como no irmão linear.
        expect(truthy.bloqueado).toBe(false);
    });

    it('não vaza o `id` nem o `source` do ponto de origem', () => {
        const props = buildConvertedPointProperties({
            feature: pontoCompleto(),
            defaults: SYMBOL_DEFAULTS,
            id: 'simbolo-1',
        });
        expect(props.id).toBe('simbolo-1');
        expect(props.source).toBe('military_symbol');
    });

    it('clona os padrões do destino, que são objeto ESTÁTICO de classe', () => {
        const defaults = { ...SYMBOL_DEFAULTS, selectionBox: { coords: [1, 2] } };
        const props = buildConvertedPointProperties({
            feature: pontoCompleto(),
            defaults,
            id: 'x',
        });
        props.selectionBox.coords[0] = 99;
        expect(defaults.selectionBox.coords[0]).toBe(1);
    });

    it('sobrevive a entrada degenerada sem lançar', () => {
        expect(() => buildConvertedPointProperties()).not.toThrow();
        expect(buildConvertedPointProperties({}).id).toBeUndefined();
        expect(buildConvertedPointProperties({ feature: {}, defaults: null, id: 'x' }).id).toBe('x');
    });
});

describe('E1 — a fiação: as DUAS conversões de ponto usam o modelo', () => {
    const fonte = readFileSync(
        fileURLToPath(new URL('../../src/js/tool_manager/helpers/feature-header.helpers.js', import.meta.url)),
        'utf8'
    );

    it('o menu chama `buildConvertedPointProperties` duas vezes, uma por conversão', () => {
        const chamadas = fonte.match(/buildConvertedPointProperties\(\{/g) || [];
        expect(chamadas.length).toBe(2);
    });

    it('nenhuma das duas volta a montar a lista fixa à mão', () => {
        // A forma antiga, que é a que se reescreve sem querer numa refatoração.
        expect(fonte).not.toMatch(/layerId:\s*pointFeature\.properties\.layerId/);
        expect(fonte).not.toMatch(/descricao:\s*pointFeature\.properties\.descricao/);
        expect(fonte).not.toMatch(/opacity:\s*pointFeature\.properties\.opacity/);
    });
});

describe('E1 — o modelo de ponto e o linear declaram o mesmo dado de usuário', () => {
    it('tudo o que o linear preserva, o de ponto também preserva', () => {
        expect(PRESERVED_KEYS.length).toBeGreaterThan(0);
        for (const key of PRESERVED_KEYS) {
            expect(POINT_PRESERVED_KEYS).toContain(key);
        }
    });

    it('e o de ponto acrescenta o que só o ponto tem: trajetória, casa e opacidade', () => {
        for (const key of ['trajetoria', '_temporalHome', 'opacity']) {
            expect(POINT_PRESERVED_KEYS).toContain(key);
            expect(PRESERVED_KEYS).not.toContain(key);
        }
    });
});
