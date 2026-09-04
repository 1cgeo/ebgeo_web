// Path: tests/unit/coordination-line-balde.test.js

import { describe, it, expect, vi, beforeEach } from 'vitest';

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
