// Path: tests/unit/catalog-layer-ref.test.js
//
// A CAMADA DE CATÁLOGO É UMA REFERÊNCIA, e este arquivo prende a resolução dela.
//
// Até a F11 o mapa guardava uma CÓPIA da linha de catálogo dentro de `catalogLayers`
// (`name` mais o `config` inteiro, com `source.url`). A cópia tinha dois sintomas de uma
// desnormalização só: ela VAZAVA (viajava no snapshot de sync, que é gateado em `read`,
// nível que um visitante anônimo de link público tem) e ENVELHECIA (nunca era atualizada,
// então a correção de URL feita pelo administrador não alcançava atlas nenhum).
//
// O que fica gravado hoje é referência (`id` prefixado + `type`) mais estado por atlas
// (`visible`, `status`, `styleOverrides`). Nome, `config`, legenda e bounds saem do
// catálogo vivo a cada leitura, e por isso o recurso que o usuário perdeu simplesmente
// não resolve.
//
// A DISCRIMINAÇÃO QUE MAIS IMPORTA AQUI é o HILLSHADE: ele não é recurso de catálogo, não
// tem linha em tabela nenhuma e a definição dele é estática. Tratá-lo como recurso tira o
// relevo sombreado do mapa de todo mundo, e a migração 003 semeou uma linha
// `analysis_layers` cujo id é literalmente `'hillshade'`, então a colisão de id é um
// caminho REAL até esse defeito, não hipótese. Duas defesas independentes, as duas
// medidas abaixo: o TIPO (só duas famílias resolvem) e o PREFIXO (o hillshade não produz
// chave de junção nenhuma).

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
    config: {
        map2d: { hillshade: { enabled: true, name: 'Sombreamento do Relevo', layer: { id: 'hillshade-layer' } } },
        analysisLayers: { enabled: true, layers: [] },
        dataLayers: { enabled: true, layers: [] },
        tilesets: []
    }
}));

vi.mock('../../src/js/config.js', () => ({ default: h.config }));

import {
    CATALOG_LAYER_DEFINITION_KEYS,
    CATALOG_LAYER_ID_PREFIX,
    catalogLayerDisplayName,
    catalogLayerReferenceId,
    catalogLayerResourceRef,
    pruneCatalogLayerDefinition,
    pruneCatalogLayerDefinitions,
    resolveCatalogLayerDefinition
} from '../../src/js/catalog/catalog-layer.ref.js';

import { CATALOG_ITEM_TYPES } from '../../src/js/catalog/catalog.constants.js';

// O ESPELHO: a mesma resolução do lado do servidor. Se as duas divergirem, o servidor
// reidrata uma camada que o cliente não sabe endereçar (ou o contrário), com as duas
// suítes verdes — que é o modo de falha que este import existe para fechar.
import {
    CATALOG_LAYER_DEFINITION_KEYS as BACKEND_DEFINITION_KEYS,
    CATALOG_LAYER_ID_PREFIX as BACKEND_PREFIX,
    catalogLayerResourceRef as backendResourceRef
} from '../../../backend/src/modules/catalog/catalog-layer.ref.js';

const ANALISE = CATALOG_ITEM_TYPES.ANALYSIS_LAYER;
const DADOS = CATALOG_ITEM_TYPES.DATA_LAYER;
const RELEVO = CATALOG_ITEM_TYPES.HILLSHADE;

beforeEach(() => {
    h.config.map2d = {
        hillshade: { enabled: true, name: 'Sombreamento do Relevo', layer: { id: 'hillshade-layer' } }
    };
    h.config.analysisLayers = { enabled: true, layers: [] };
    h.config.dataLayers = { enabled: true, layers: [] };
    h.config.tilesets = [];
});

// ============================================================================
// A referência
// ============================================================================

describe('catalogLayerResourceRef', () => {
    it('resolve as DUAS famílias que são recurso de catálogo', () => {
        expect(catalogLayerResourceRef('analysis-declividade', ANALISE))
            .toEqual({ resourceType: 'analysis_layer', resourceId: 'declividade' });
        expect(catalogLayerResourceRef('data-molduras', DADOS))
            .toEqual({ resourceType: 'data_layer', resourceId: 'molduras' });
    });

    it('o HILLSHADE não produz referência nenhuma (a primeira defesa: o TIPO)', () => {
        expect(catalogLayerResourceRef('hillshade', RELEVO)).toBeNull();
        // Nem quando o id imita o prefixo de outra família: o tipo é quem decide.
        expect(catalogLayerResourceRef('analysis-hillshade', RELEVO)).toBeNull();
    });

    it('exige o prefixo que o tipo pede (a segunda defesa: o PREFIXO)', () => {
        expect(catalogLayerResourceRef('declividade', ANALISE)).toBeNull();
        expect(catalogLayerResourceRef('data-molduras', ANALISE)).toBeNull();
        // Resto vazio não é id.
        expect(catalogLayerResourceRef('analysis-', ANALISE)).toBeNull();
    });

    it('recusa entrada que não é par de strings', () => {
        expect(catalogLayerResourceRef(null, ANALISE)).toBeNull();
        expect(catalogLayerResourceRef('analysis-x', null)).toBeNull();
        expect(catalogLayerResourceRef(42, ANALISE)).toBeNull();
        expect(catalogLayerResourceRef('analysis-x', 'tipo_que_nao_existe')).toBeNull();
    });
});

describe('catalogLayerReferenceId', () => {
    it('o PREFIXO do id vence os dois carregadores legados', () => {
        const layer = {
            id: 'analysis-declividade',
            type: ANALISE,
            originalId: 'outro',
            config: { id: 'terceiro' }
        };
        expect(catalogLayerReferenceId(layer)).toBe('declividade');
    });

    it('cai em originalId e depois em config.id, nessa ordem', () => {
        expect(catalogLayerReferenceId({ id: 'legado', type: ANALISE, originalId: 'real', config: { id: 'copia' } }))
            .toBe('real');
        expect(catalogLayerReferenceId({ id: 'legado', type: ANALISE, config: { id: 'copia' } }))
            .toBe('copia');
    });

    it('devolve null quando a entrada não carrega referência alguma', () => {
        expect(catalogLayerReferenceId({ id: 'hillshade', type: RELEVO })).toBeNull();
        expect(catalogLayerReferenceId(null)).toBeNull();
        expect(catalogLayerReferenceId({})).toBeNull();
    });
});

// ============================================================================
// A definição viva
// ============================================================================

describe('resolveCatalogLayerDefinition', () => {
    it('camada de ANÁLISE: devolve a linha VIVA do catálogo, não a cópia embutida', () => {
        h.config.analysisLayers = {
            enabled: true,
            layers: [{ id: 'declividade', name: 'Declividade', source: { url: 'https://novo/{z}.png' } }]
        };

        const layer = {
            id: 'analysis-declividade',
            type: ANALISE,
            name: 'Nome de ontem',
            config: { id: 'declividade', source: { url: 'https://endereco/velho.png' } }
        };

        expect(resolveCatalogLayerDefinition(layer).source.url).toBe('https://novo/{z}.png');
    });

    it('camada de DADOS: mesma resolução, contra a outra seção', () => {
        h.config.dataLayers = { enabled: true, layers: [{ id: 'molduras', name: 'Molduras' }] };
        expect(resolveCatalogLayerDefinition({ id: 'data-molduras', type: DADOS }).name).toBe('Molduras');
        // E não busca na seção errada: a chave de `config` é escolhida pelo tipo.
        expect(resolveCatalogLayerDefinition({ id: 'analysis-molduras', type: ANALISE })).toBeNull();
    });

    it('seção DESABILITADA não resolve, mesmo listando o id', () => {
        h.config.analysisLayers = { enabled: false, layers: [{ id: 'declividade' }] };
        expect(resolveCatalogLayerDefinition({ id: 'analysis-declividade', type: ANALISE })).toBeNull();
    });

    it('recurso ausente do singleton não resolve (é como o privado perdido chega aqui)', () => {
        h.config.dataLayers = { enabled: true, layers: [{ id: 'outro' }] };
        expect(resolveCatalogLayerDefinition({ id: 'data-restrito', type: DADOS })).toBeNull();
    });

    it('HILLSHADE resolve contra o bloco ESTÁTICO, e só quando habilitado', () => {
        const relevo = { id: 'hillshade', type: RELEVO };
        expect(resolveCatalogLayerDefinition(relevo).name).toBe('Sombreamento do Relevo');

        h.config.map2d.hillshade.enabled = false;
        expect(resolveCatalogLayerDefinition(relevo)).toBeNull();

        h.config.map2d = undefined;
        expect(resolveCatalogLayerDefinition(relevo)).toBeNull();
    });

    it('A ARMADILHA: uma linha de análise chamada `hillshade` NÃO sequestra o relevo', () => {
        // A migração 003 semeou exatamente esta linha no banco. Se a resolução juntasse
        // pelo id NU, o relevo sombreado passaria a resolver para ela — e a definição
        // estática, que é a que tem a URL do DEM, sumiria do mapa de todo mundo.
        h.config.analysisLayers = {
            enabled: true,
            layers: [{ id: 'hillshade', name: 'Sombreamento do Relevo', source: { url: 'https://impostor' } }]
        };

        const definicao = resolveCatalogLayerDefinition({ id: 'hillshade', type: RELEVO });
        expect(definicao).toBe(h.config.map2d.hillshade);
        expect(definicao.layer.id).toBe('hillshade-layer');
        expect(JSON.stringify(definicao)).not.toContain('impostor');
    });

    it('tipo desconhecido e entrada nula não resolvem', () => {
        expect(resolveCatalogLayerDefinition({ id: 'x', type: 'inventado' })).toBeNull();
        expect(resolveCatalogLayerDefinition(null)).toBeNull();
    });

    it('MODEL_3D continua respondido pelos carregadores legados (nunca é criado hoje)', () => {
        h.config.tilesets = [{ id: 'tileset-x', name: 'Modelo' }];
        expect(resolveCatalogLayerDefinition({
            id: 'local', type: CATALOG_ITEM_TYPES.MODEL_3D, originalId: 'tileset-x'
        }).name).toBe('Modelo');
        expect(resolveCatalogLayerDefinition({ id: 'local', type: CATALOG_ITEM_TYPES.MODEL_3D })).toBeNull();
    });
});

describe('catalogLayerDisplayName', () => {
    it('o nome VIVO do catálogo vence o nome guardado', () => {
        h.config.dataLayers = { enabled: true, layers: [{ id: 'molduras', name: 'Molduras (2026)' }] };
        expect(catalogLayerDisplayName({ id: 'data-molduras', type: DADOS, name: 'Molduras (2019)' }))
            .toBe('Molduras (2026)');
    });

    it('sem definição, cai no último rótulo conhecido e depois na referência', () => {
        expect(catalogLayerDisplayName({ id: 'data-restrito', type: DADOS, name: 'Restrito' }))
            .toBe('Restrito');
        expect(catalogLayerDisplayName({ id: 'data-restrito', type: DADOS })).toBe('restrito');
        // Rótulo em branco não conta como rótulo, e sem definição sobra o id.
        h.config.map2d.hillshade.enabled = false;
        expect(catalogLayerDisplayName({ id: 'hillshade', type: RELEVO, name: '  ' })).toBe('hillshade');
        expect(catalogLayerDisplayName(null)).toBe('Camada sem nome');
    });
});

// ============================================================================
// A poda de fronteira
// ============================================================================

describe('pruneCatalogLayerDefinition', () => {
    it('tira a definição e deixa referência e estado por atlas intactos', () => {
        const podada = pruneCatalogLayerDefinition({
            id: 'analysis-declividade',
            type: ANALISE,
            name: 'Declividade',
            config: { id: 'declividade', source: { url: 'https://interno/privado.png' } },
            visible: false,
            status: 'active',
            opacity: 0.4,
            styleOverrides: { raster: { 'raster-opacity': 0.5 } },
            sync: { version: 2 }
        });

        expect(podada).toEqual({
            id: 'analysis-declividade',
            type: ANALISE,
            visible: false,
            status: 'active',
            opacity: 0.4,
            styleOverrides: { raster: { 'raster-opacity': 0.5 } },
            sync: { version: 2 }
        });
    });

    it('é DENYLIST: chave desconhecida atravessa (o shape é contrato com o snapshot)', () => {
        const podada = pruneCatalogLayerDefinition({ id: 'x', type: ANALISE, chaveNova: 42 });
        expect(podada.chaveNova).toBe(42);
    });

    it('preserva a referência da linha legada, que só existia dentro de `config`', () => {
        const podada = pruneCatalogLayerDefinition({
            id: 'legado-1', type: DADOS, config: { id: 'molduras', source: { url: 'https://x' } }
        });
        expect(podada.originalId).toBe('molduras');
        expect(podada.config).toBeUndefined();
    });

    it('NÃO inventa originalId quando o id já carrega a referência', () => {
        const podada = pruneCatalogLayerDefinition({
            id: 'analysis-declividade', type: ANALISE, config: { id: 'declividade' }
        });
        expect(podada.originalId).toBeUndefined();
        expect(catalogLayerReferenceId(podada)).toBe('declividade');
    });

    it('é idempotente e tolera entrada que não é objeto', () => {
        const uma = pruneCatalogLayerDefinition({ id: 'legado', type: DADOS, config: { id: 'm' } });
        expect(pruneCatalogLayerDefinition(uma)).toEqual(uma);
        expect(pruneCatalogLayerDefinition(null)).toBeNull();
        expect(pruneCatalogLayerDefinition('nao-e-objeto')).toBe('nao-e-objeto');
    });

    it('a versão de lista devolve o que não é lista sem tocar', () => {
        expect(pruneCatalogLayerDefinitions(undefined)).toBeUndefined();
        expect(pruneCatalogLayerDefinitions(null)).toBeNull();
        expect(pruneCatalogLayerDefinitions([{ id: 'a', type: ANALISE, name: 'A' }]))
            .toEqual([{ id: 'a', type: ANALISE }]);
    });
});

// ============================================================================
// O ESPELHO DO BACKEND
// ============================================================================

describe('a resolução de referência ESPELHA o backend', () => {
    it('a tabela de prefixos é a mesma, chave por chave', () => {
        expect(CATALOG_LAYER_ID_PREFIX).toEqual(BACKEND_PREFIX);
        // E o hillshade está ausente dos DOIS: é a defesa que some primeiro se alguém
        // "completar" a tabela por simetria com `CATALOG_ITEM_TYPES`.
        expect(Object.keys(BACKEND_PREFIX).sort()).toEqual(['analysis_layer', 'data_layer']);
        expect(BACKEND_PREFIX[RELEVO]).toBeUndefined();
    });

    it('a denylist de definição é a mesma', () => {
        expect([...CATALOG_LAYER_DEFINITION_KEYS]).toEqual([...BACKEND_DEFINITION_KEYS]);
    });

    it('as duas cópias respondem igual em toda a tabela de casos', () => {
        const casos = [
            ['analysis-declividade', ANALISE],
            ['data-molduras', DADOS],
            ['hillshade', RELEVO],
            ['analysis-hillshade', RELEVO],
            ['declividade', ANALISE],
            ['data-molduras', ANALISE],
            ['analysis-', ANALISE],
            ['analysis-x', 'tipo_que_nao_existe'],
            [null, ANALISE],
            ['analysis-x', null]
        ];

        for (const [id, tipo] of casos) {
            expect(catalogLayerResourceRef(id, tipo), `divergiram em ${id} / ${tipo}`)
                .toEqual(backendResourceRef(id, tipo));
        }

        // ASSERÇÃO ABSOLUTA junto da comparativa: duas cópias erradas do mesmo jeito
        // passariam no laço acima sem ela.
        expect(backendResourceRef('analysis-declividade', ANALISE))
            .toEqual({ resourceType: 'analysis_layer', resourceId: 'declividade' });
        expect(backendResourceRef('hillshade', RELEVO)).toBeNull();
    });
});
