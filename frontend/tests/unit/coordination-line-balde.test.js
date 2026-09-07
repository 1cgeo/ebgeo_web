// Path: tests/unit/coordination-line-balde.test.js

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

/**
 * O balde `coordination_lines` existe nos TRES caminhos por onde um mapa entra.
 *
 * A falha que este arquivo existe para impedir e MUDA: um mapa sem o balde nao da erro, nao
 * loga e nao avisa. O setup de camadas monta a fonte a partir dessa colecao, e sem ela a
 * ferramenta ativa, aceita clique e nao desenha nada, porque toda escrita passa por
 * `getSource(...)?.setData` e o encadeamento opcional engole a ausencia.
 *
 * A VERSAO DE ESQUEMA NAO SUBIU (decisao de 2026-09-03): a v2.3 deste ramo e "Meu Atlas", de
 * nivel de INSTALACAO, e o ramo esta em desenvolvimento sem dado de usuario a preservar. Em
 * vez de gastar uma versao numa mudanca de FORMA, a normalizacao roda na LEITURA, nos tres
 * caminhos, todos chamando a mesma funcao pura. Este arquivo cobre os tres, e o piso e o
 * mapa que nunca teve o balde.
 *
 * O quarto caminho, `setupCoordinationLineLayers` sobre dado que nao passou por nenhum dos
 * tres, e a DEFESA, e mora em `coordination-line-camadas.test.js`.
 */

const h = vi.hoisted(() => ({ salvos: new Map() }));

// A mocada abaixo serve so ao bloco do SNAPSHOT: `remote-operation-handler.js` puxa o
// repositorio, o registro de controles e as operacoes de icone, nenhum deles carregavel no
// ambiente `node`. Os outros dois blocos importam modulos folha e nao dependem dela.
vi.mock('../../src/js/store/repositories/index.js', () => ({
    getRepository: () => ({
        getMap: vi.fn(),
        saveMap: async (id, data) => { h.salvos.set(id, data); },
        getAtlas: async () => ({ settings: {} }),
        saveAtlas: async () => {},
        saveSetting: async () => {},
        getSetting: async () => undefined,
    }),
}));

vi.mock('../../src/js/store/repositories/local.repository.js', () => ({
    localRepository: { saveBriefing: vi.fn(), getBriefing: vi.fn(), deleteBriefing: vi.fn() },
}));

vi.mock('../../src/js/store/control.registry.js', () => ({
    getControl: () => undefined,
    registerControl: vi.fn(),
}));

vi.mock('../../src/js/store/customIcons.operations.js', () => ({
    invalidateCustomIconsCache: vi.fn(),
}));

import {
    ensureCoordinationLines,
    ensureMapDataShape,
    getEmptyMapData,
} from '../../src/js/store/repository.utils.js';
import { normalizeMapDataForCurrentVersion } from '../../src/js/import_export/import-normalize.js';
// O catalogo do MD33 e uma folha sem import nenhum, entao ele carrega no ambiente `node`. O
// codigo da fonte esta aqui e NAO em `repository.utils.js`, pelo motivo do bloco final.
import {
    DEFAULT_SYMBOL_CODE,
    LINEAR_SYMBOLS,
} from '../../src/js/military_tools/coordination_line_tool/coordination_line_catalog.js';
import {
    applyRemoteSnapshot,
    setRemoteHandlerEventBus,
} from '../../src/js/store/sync/remote-operation-handler.js';

// ============================================================================
// A FUNCAO PURA
// ============================================================================

describe('ensureCoordinationLines', () => {
    it('CRIA o balde no mapa que nunca teve a ferramenta', () => {
        const resultado = ensureCoordinationLines({ points: [], lines: [] });

        expect(resultado).not.toBeNull();
        expect(resultado.coordination_lines).toEqual([]);
    });

    it('preserva os outros baldes intactos', () => {
        const antes = { points: [{ id: 'p' }], lines: [{ id: 'l' }], boundarys: [] };
        const depois = ensureCoordinationLines(antes);

        expect(depois.points).toEqual([{ id: 'p' }]);
        expect(depois.lines).toEqual([{ id: 'l' }]);
        expect(depois.boundarys).toEqual([]);
        // Devolve objeto NOVO, e nao muta a entrada: o chamador compara por identidade.
        expect(depois).not.toBe(antes);
        expect(antes.coordination_lines).toBeUndefined();
    });

    it('nao toca no mapa que ja esta na forma nova', () => {
        // Devolver null e o que evita uma reescrita por mapa em toda leitura.
        expect(ensureCoordinationLines({ points: [], coordination_lines: [] })).toBeNull();
        expect(ensureCoordinationLines({ coordination_lines: [{ id: 'a' }] })).toBeNull();
    });

    it('nao apaga linha de coordenacao ja existente', () => {
        const existentes = [{ id: 'a' }, { id: 'b' }];
        expect(ensureCoordinationLines({ coordination_lines: existentes })).toBeNull();
    });

    it('e IDEMPOTENTE, que e o que faz o .ebgeo da main em 2.3 atravessar intacto', () => {
        const uma = ensureCoordinationLines({ points: [] });
        expect(ensureCoordinationLines(uma)).toBeNull();
    });

    it('PIOR CASO: insumo degenerado nao lanca', () => {
        const degenerados = [
            ['sem features', undefined],
            ['features nulo', null],
            ['features nao e objeto', 'lixo'],
            ['features vazio', {}],
            ['balde corrompido', { coordination_lines: 'nao sou array' }],
            ['balde nulo', { coordination_lines: null }],
        ];

        for (const [nome, features] of degenerados) {
            expect(() => ensureCoordinationLines(features), nome).not.toThrow();
            const resultado = ensureCoordinationLines(features);
            if (resultado) {
                expect(Array.isArray(resultado.coordination_lines), nome).toBe(true);
            }
        }
    });

    it('um balde corrompido e substituido por uma colecao valida', () => {
        // `setOrCreateSource` monta `{ type, features }` sem checar, entao um balde que nao e
        // array viraria GeoJSON invalido na fonte do MapLibre.
        expect(ensureCoordinationLines({ coordination_lines: 42 }).coordination_lines).toEqual([]);
    });

    it('o esqueleto de mapa vazio ja nasce com o balde', () => {
        expect(getEmptyMapData().features.coordination_lines).toEqual([]);
        expect(ensureCoordinationLines(getEmptyMapData().features)).toBeNull();
    });
});

describe('ensureMapDataShape', () => {
    it('devolve um documento NOVO quando o balde falta, sem mutar o antigo', () => {
        const antes = { id: 'm1', name: 'Alfa', features: { points: [] } };
        const depois = ensureMapDataShape(antes);

        expect(depois).not.toBe(antes);
        expect(depois.id).toBe('m1');
        expect(depois.name).toBe('Alfa');
        expect(depois.features.coordination_lines).toEqual([]);
        expect(antes.features.coordination_lines).toBeUndefined();
    });

    it('devolve null quando nada muda, e para todo insumo degenerado', () => {
        expect(ensureMapDataShape({ features: { coordination_lines: [] } })).toBeNull();
        expect(ensureMapDataShape(null)).toBeNull();
        expect(ensureMapDataShape(undefined)).toBeNull();
        expect(ensureMapDataShape('lixo')).toBeNull();
        expect(ensureMapDataShape({})).toBeNull();
    });
});

// ============================================================================
// CAMINHO 1: O ARQUIVO .ebgeo
// ============================================================================

/**
 * Um `.ebgeo` entra pelo importador, que valida a versao e normaliza a forma. Como
 * MIN_SCHEMA_VERSION e 1.3, todo arquivo aceito pode ter sido escrito antes desta ferramenta
 * e chegar sem o balde.
 */
describe('caminho do .ebgeo: normalizeMapDataForCurrentVersion', () => {
    it('PIOR CASO: o arquivo antigo, sem o balde, sai com ele', () => {
        const { mapData } = normalizeMapDataForCurrentVersion(
            { features: { points: [], lines: [] } }, () => ({ processed: [], unavailableCount: 0 }),
        );

        expect(mapData.features.coordination_lines).toEqual([]);
    });

    it('o arquivo sem `features` nenhum tambem sai com o balde', () => {
        const { mapData } = normalizeMapDataForCurrentVersion({}, () => ({ processed: [], unavailableCount: 0 }));

        expect(mapData.features.coordination_lines).toEqual([]);
    });

    it('o arquivo escrito pela main em 2.3 ja traz o balde, e ele nao e zerado', () => {
        const linhas = [{ properties: { id: 'cl-1' } }];
        const { mapData } = normalizeMapDataForCurrentVersion(
            { features: { points: [], coordination_lines: linhas } },
            () => ({ processed: [], unavailableCount: 0 }),
        );

        expect(mapData.features.coordination_lines).toEqual(linhas);
    });
});

// ============================================================================
// CAMINHO 2: O SNAPSHOT DO SERVIDOR
// ============================================================================

/**
 * O caminho que ninguem lembra: um mapa que so viveu no servidor chega com os baldes que o
 * par dele escreveu, e um par anterior a esta ferramenta nao escreve nenhum.
 */
describe('caminho do snapshot: applyRemoteSnapshot', () => {
    beforeEach(() => {
        h.salvos.clear();
        setRemoteHandlerEventBus({ emit: vi.fn(), on: vi.fn(), off: vi.fn() });
    });

    it('PIOR CASO: o mapa do servidor sem o balde e gravado COM ele', async () => {
        await applyRemoteSnapshot({
            maps: [{ id: 'map-remoto', name: 'Do Servidor', features: { points: [], lines: [] } }],
            briefings: [],
        });

        expect(h.salvos.get('map-remoto').features.coordination_lines).toEqual([]);
    });

    it('o mapa do servidor que ja traz linhas as conserva', async () => {
        const linhas = [{ properties: { id: 'cl-remota' } }];
        await applyRemoteSnapshot({
            maps: [{ id: 'map-remoto', name: 'Do Servidor', features: { coordination_lines: linhas } }],
            briefings: [],
        });

        expect(h.salvos.get('map-remoto').features.coordination_lines).toEqual(linhas);
    });
});

// ============================================================================
// O BALDE DA 2.2: `barrier_lines` -> `coordination_lines`
// ============================================================================

/**
 * B2-2. A Linha de Barreiras existiu na `main` 2.2 e escrevia no balde `barrier_lines`, com
 * `source: 'barrier_line'`. Na 2.3 ela virou a Linha de Coordenacao, cujo combobox escolhe o
 * simbolo do MD33 pelo codigo, e a linha de barreiras e o 290199 do catalogo.
 *
 * A migracao 2.2 -> 2.3 da `main` NAO moveu nada: ela so acrescentou o balde novo VAZIO. O
 * resultado medido pelo B2 em 2026-09-07, com insumo forjado de 5 linhas: o dado atravessa a
 * 2.3, a 2.4 e a 3.0 no disco e no `.ebgeo`, e `grep barrier_lines` da 0 ocorrencia no codigo
 * das tres. Nenhuma fonte do MapLibre se chama `barrier_lines`, entao a feicao nunca e
 * desenhada, listada, selecionada nem contada. Nao e perda de bytes, e perda de alcance.
 *
 * O PIOR CASO DESTE BLOCO e o insumo do B2 verbatim: uma feicao movida para `barrier_lines`
 * com nada alem do carimbo de `source`, SEM `baseCoordinates`. Ele existe porque a versao
 * ingenua do conserto (so trocar o balde de nome) e PIOR que o defeito:
 * `applyZoomCorrections` regenera a geometria de toda linha de coordenacao na carga, e
 * `generateCoordinationLineGeometry` sem `baseCoordinates` devolve
 * `{ LineString, [[0,0],[0,0]] }`, ou seja, as cinco linhas sairiam do lugar delas e iriam
 * para a Ilha Nula. Por isso a adocao deriva `baseCoordinates` da propria geometria quando
 * ela e um LineString, e SO nesse caso.
 */
describe('ensureCoordinationLines: o balde `barrier_lines` da 2.2', () => {
    /** Uma feicao como a que o B2 forjou: linha comum, so com o carimbo de `source`. */
    const forjadaB2 = (n) => ({
        type: 'Feature',
        id: 1700000000000 + n,
        properties: {
            id: `b-${n}`, source: 'barrier_line', color: '#000000', lineWidth: 4, opacity: 1,
            nome: `Linha #${n}`, visivel: true, bloqueado: false, layerId: 'default',
        },
        geometry: { type: 'LineString', coordinates: [[-43.2 - n / 100, -22.9], [-43.1 - n / 100, -22.8]] },
    });

    /** Uma Linha de Barreiras AUTENTICA da 2.2, com o bloco inteiro que o controle escrevia. */
    const autentica2_2 = () => ({
        type: 'Feature',
        id: 1700000000099,
        properties: {
            id: 'bl-autentica',
            source: 'barrier_line',
            color: '#123456',
            lineWidth: 6,
            opacity: 0.7,
            symbol_size: 1.25,
            symbol_spacing: 3.75,
            createdAtZoom: 12.4,
            zoomCorrectionEnabled: false,
            calculatedLineWidth: 6,
            calculatedSymbolSize: 1.25,
            calculatedSymbolSpacing: 3.75,
            baseCoordinates: [[-43.5, -22.5], [-43.4, -22.4], [-43.3, -22.45]],
            nome: 'Linha de Barreiras #3',
            descricao: 'obstaculo do vale',
            visivel: true,
            bloqueado: false,
            layerId: 'camada-2',
        },
        geometry: { type: 'MultiLineString', coordinates: [[[-43.5, -22.5], [-43.45, -22.45]]] },
    });

    it('PIOR CASO (insumo do B2): 5 no balde velho saem 5 no balde novo, e o velho SOME', () => {
        const antes = { lines: [], barrier_lines: [1, 2, 3, 4, 5].map(forjadaB2) };
        const depois = ensureCoordinationLines(antes);

        expect(depois).not.toBeNull();
        expect(depois.coordination_lines).toHaveLength(5);
        expect('barrier_lines' in depois).toBe(false);
        for (const feicao of depois.coordination_lines) {
            expect(feicao.properties.source).toBe('coordination_line');
            expect(feicao.properties.symbol_code).toBe('290199');
        }
        // A entrada nao e mutada: o chamador compara por identidade para decidir se grava.
        expect(antes.barrier_lines).toHaveLength(5);
        expect(antes.barrier_lines[0].properties.source).toBe('barrier_line');
    });

    it('PIOR CASO: sem `baseCoordinates` a adocao as deriva do LineString, em vez de mandar a feicao para [0,0]', () => {
        const depois = ensureCoordinationLines({ barrier_lines: [forjadaB2(1)] });

        expect(depois.coordination_lines[0].properties.baseCoordinates)
            .toEqual([[-43.21, -22.9], [-43.11, -22.8]]);
    });

    it('nao INVENTA coordenadas quando a geometria nao e um LineString', () => {
        // A geometria de uma linha de barreiras desenhada e um MultiLineString (espinha
        // interrompida mais um anel por losango); dela nao se recupera a espinha autorada.
        const semBase = autentica2_2();
        delete semBase.properties.baseCoordinates;
        const depois = ensureCoordinationLines({ barrier_lines: [semBase] });

        expect(depois.coordination_lines[0].properties.baseCoordinates).toBeUndefined();
    });

    it('a linha AUTENTICA atravessa com tamanho, espacamento e ancora de zoom intactos', () => {
        const depois = ensureCoordinationLines({ barrier_lines: [autentica2_2()] });
        const p = depois.coordination_lines[0].properties;

        expect(p.source).toBe('coordination_line');
        expect(p.symbol_code).toBe('290199');
        expect(p.symbol_size).toBe(1.25);
        expect(p.symbol_spacing).toBe(3.75);
        expect(p.createdAtZoom).toBe(12.4);
        expect(p.zoomCorrectionEnabled).toBe(false);
        expect(p.baseCoordinates).toEqual([[-43.5, -22.5], [-43.4, -22.4], [-43.3, -22.45]]);
        // O que e do usuario nao se reescreve: nome, descricao, cor, camada e id.
        expect(p.nome).toBe('Linha de Barreiras #3');
        expect(p.descricao).toBe('obstaculo do vale');
        expect(p.color).toBe('#123456');
        expect(p.lineWidth).toBe(6);
        expect(p.opacity).toBe(0.7);
        expect(p.layerId).toBe('camada-2');
        expect(p.id).toBe('bl-autentica');
        // A geometria segue inteira; `applyZoomCorrections` a regenera na carga.
        expect(depois.coordination_lines[0].geometry.type).toBe('MultiLineString');
        expect(depois.coordination_lines[0].id).toBe(1700000000099);
    });

    it('a feicao sem o par de tamanho ganha o PADRAO da ferramenta nova, nunca um zero', () => {
        const p = ensureCoordinationLines({ barrier_lines: [forjadaB2(1)] }).coordination_lines[0].properties;

        expect(p.symbol_size).toBe(0.5);
        expect(p.symbol_spacing).toBe(1.5);
        expect(p.createdAtZoom).toBe(0);
        expect(p.zoomCorrectionEnabled).toBe(true);
    });

    it('`properties.type` legado acompanha o `source`', () => {
        const f = forjadaB2(1);
        f.properties.type = 'barrier_line';
        const p = ensureCoordinationLines({ barrier_lines: [f] }).coordination_lines[0].properties;

        expect(p.type).toBe('coordination_line');
    });

    it('e IDEMPOTENTE: a segunda passada nao acha mais nada', () => {
        const uma = ensureCoordinationLines({ points: [], barrier_lines: [forjadaB2(1), forjadaB2(2)] });
        expect(ensureCoordinationLines(uma)).toBeNull();
        expect(uma.coordination_lines).toHaveLength(2);
    });

    it('linha de coordenacao JA existente nao e tocada, e a legada entra depois dela', () => {
        const existente = {
            type: 'Feature',
            properties: { id: 'cl-1', source: 'coordination_line', symbol_code: '290307' },
            geometry: null,
        };
        const depois = ensureCoordinationLines({ coordination_lines: [existente], barrier_lines: [forjadaB2(7)] });

        expect(depois.coordination_lines).toHaveLength(2);
        expect(depois.coordination_lines[0]).toBe(existente);
        expect(depois.coordination_lines[0].properties.symbol_code).toBe('290307');
        expect(depois.coordination_lines[1].properties.id).toBe('b-7');
    });

    it('o balde velho VAZIO some sem inventar feicao nenhuma', () => {
        // E o que o `05-completo-2.2.ebgeo` de verdade traz: o balde existe e esta vazio.
        const depois = ensureCoordinationLines({ points: [], barrier_lines: [], coordination_lines: [] });

        expect(depois).not.toBeNull();
        expect('barrier_lines' in depois).toBe(false);
        expect(depois.coordination_lines).toEqual([]);
    });

    it('PIOR CASO: balde velho degenerado nao lanca e nao contamina o novo', () => {
        const degenerados = [
            ['balde nao e array', { barrier_lines: 'nao sou array' }],
            ['balde nulo', { barrier_lines: null }],
            ['balde com membro nulo', { barrier_lines: [null, undefined] }],
            ['balde com membro que nao e objeto', { barrier_lines: ['lixo', 42] }],
            ['membro sem properties', { barrier_lines: [{ type: 'Feature', geometry: null }] }],
        ];

        for (const [nome, features] of degenerados) {
            expect(() => ensureCoordinationLines(features), nome).not.toThrow();
            const resultado = ensureCoordinationLines(features);
            expect(resultado, nome).not.toBeNull();
            expect('barrier_lines' in resultado, nome).toBe(false);
            expect(Array.isArray(resultado.coordination_lines), nome).toBe(true);
            for (const feicao of resultado.coordination_lines) {
                expect(feicao?.properties?.source, nome).toBe('coordination_line');
            }
        }
    });

    it('o mapa sem balde velho nenhum continua devolvendo null', () => {
        // O caso comum, e o que impede uma reescrita por mapa em toda leitura.
        expect(ensureCoordinationLines({ points: [], coordination_lines: [] })).toBeNull();
    });

    it('`ensureMapDataShape` carrega o rename um nivel acima', () => {
        const antes = { id: 'm1', name: 'Alfa', features: { coordination_lines: [], barrier_lines: [forjadaB2(1)] } };
        const depois = ensureMapDataShape(antes);

        expect(depois).not.toBeNull();
        expect(depois.features.coordination_lines).toHaveLength(1);
        expect('barrier_lines' in depois.features).toBe(false);
        expect(antes.features.barrier_lines).toHaveLength(1);
    });

    it('o caminho do .ebgeo tambem renomeia', () => {
        const { mapData } = normalizeMapDataForCurrentVersion(
            { features: { points: [], barrier_lines: [forjadaB2(1)] } },
            () => ({ processed: [], unavailableCount: 0 }),
        );

        expect(mapData.features.coordination_lines).toHaveLength(1);
        expect(mapData.features.coordination_lines[0].properties.source).toBe('coordination_line');
        expect('barrier_lines' in mapData.features).toBe(false);
    });

    it('o caminho do snapshot do servidor tambem renomeia', async () => {
        h.salvos.clear();
        setRemoteHandlerEventBus({ emit: vi.fn(), on: vi.fn(), off: vi.fn() });
        await applyRemoteSnapshot({
            maps: [{ id: 'map-2-2', name: 'Do Servidor', features: { barrier_lines: [forjadaB2(1)] } }],
            briefings: [],
        });

        const gravado = h.salvos.get('map-2-2').features;
        expect(gravado.coordination_lines).toHaveLength(1);
        expect(gravado.coordination_lines[0].properties.source).toBe('coordination_line');
        expect('barrier_lines' in gravado).toBe(false);
    });
});

// ============================================================================
// A COPIA DO CATALOGO
// ============================================================================

/**
 * `repository.utils.js` guarda `'290199'` e o par de tamanho por COPIA, nao por import: ele e
 * ansioso na pagina do mapa, e importar `military_tools/` de la reprovaria
 * `teto-de-peso-da-pagina-do-mapa.test.js`, cujo orcamento para aquela pasta e ZERO modulo
 * ansioso. Copia sem guarda envelhece calada, entao a guarda e este bloco: ele le as duas
 * pontas e as compara.
 */
describe('a copia de `290199` e dos padroes bate com a fonte', () => {
    const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const utils = readFileSync(join(RAIZ, 'src/js/store/repository.utils.js'), 'utf8');
    const controle = readFileSync(
        join(RAIZ, 'src/js/military_tools/coordination_line_tool/add_coordination_line_control.js'),
        'utf8',
    );

    const valorNoBloco = (texto, marcador, chave) => {
        const bloco = texto.slice(texto.indexOf(marcador));
        const achado = bloco.match(new RegExp(`\\b${chave}:\\s*([^,\\n]+)`));
        return achado ? achado[1].trim() : null;
    };

    it('`290199` e mesmo a Linha de barreiras do MD33, e o padrao da ferramenta nova', () => {
        expect(LINEAR_SYMBOLS['290199'].name).toBe('Linha de barreiras');
        expect(LINEAR_SYMBOLS['290199'].glyph).toBe('diamond');
        expect(DEFAULT_SYMBOL_CODE).toBe('290199');
        expect(valorNoBloco(utils, 'COORDINATION_LINE_FALLBACKS', 'symbol_code')).toBe("'290199'");
    });

    it('o par de tamanho e a ancora copiados sao os do `DEFAULT_PROPERTIES` da ferramenta', () => {
        for (const chave of ['symbol_size', 'symbol_spacing', 'createdAtZoom', 'zoomCorrectionEnabled']) {
            expect(valorNoBloco(utils, 'COORDINATION_LINE_FALLBACKS', chave), chave)
                .toBe(valorNoBloco(controle, 'static DEFAULT_PROPERTIES', chave));
        }
    });

    it('o caminhador do bloco acima nao aprova por vacuo', () => {
        // Uma regex que nao casa devolveria null dos dois lados e o teste acima passaria
        // comparando nada com nada.
        expect(valorNoBloco(utils, 'COORDINATION_LINE_FALLBACKS', 'symbol_size')).toBe('0.5');
        expect(valorNoBloco(controle, 'static DEFAULT_PROPERTIES', 'symbol_size')).toBe('0.5');
        expect(valorNoBloco(utils, 'COORDINATION_LINE_FALLBACKS', 'chave_que_nao_existe')).toBeNull();
    });
});
