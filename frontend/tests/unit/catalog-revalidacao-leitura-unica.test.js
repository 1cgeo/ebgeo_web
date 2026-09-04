// Path: tests/unit/catalog-revalidacao-leitura-unica.test.js
//
// UMA LEITURA DO DOCUMENTO DE MAPA POR REFRESH DO PAINEL, e não duas.
//
// `renderCatalogLayers` lia o documento de mapa INTEIRO do IndexedDB duas vezes por refresh
// (`revalidateCatalogLayers`, e logo depois `getCatalogLayers`) só para chegar a uma lista de
// duas ou três camadas de catálogo. O custo da leitura escala com o número de FEIÇÕES
// DESENHADAS, não com o tamanho do catálogo: quem desenhou muito paga o dobro por nada.
//
// O PIOR CASO QUE A RÉGUA EXISTE PARA REPROVAR: um documento de mapa carregando milhares de
// feições. O que se conta são LEITURAS do documento, e o caminho do painel tem de pagar
// exatamente uma. A contagem é o que faz a régua sobreviver a uma máquina rápida, e é o que
// reprova a versão que devolvia só `{ reactivated, stillUnavailable }`.
//
// O QUE MUDA AQUI EM RELAÇÃO À MAIN: a disponibilidade de uma camada de catálogo neste destino
// é resolvida por `catalog/catalog-layer.ref.js` (a entrada guardada é uma REFERÊNCIA, e a
// definição vem do catálogo vivo), então o documento de teste é escrito na forma nova, com o
// id prefixado (`analysis-`), e não com a cópia legada em `config`. Escrever a forma legada
// faria toda revalidação PODAR a entrada, e o teste estaria medindo a poda em vez da leitura.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

const { mapas, leituras } = vi.hoisted(() => ({
    mapas: { valor: {} },
    leituras: { valor: 0 }
}));

vi.mock('../../src/js/config.js', () => ({
    default: {
        map2d: { hillshade: { enabled: true, name: 'Sombreamento' } },
        analysisLayers: { enabled: true, layers: [{ id: 'declividade', name: 'Declividade' }] },
        dataLayers: { enabled: false, layers: [] },
        tilesets: []
    }
}));

// PARCIAL, e não total: o barril de repositórios é importado por meia dúzia de módulos que
// entram junto no grafo (`map.operations.js` e o que ela puxa), e um dublê total derruba a
// carga deles por falta de um export que este arquivo nem usa. Só as duas funções que a
// contagem precisa observar são trocadas.
vi.mock('../../src/js/store/repositories/index.js', async (importOriginal) => ({
    ...(await importOriginal()),
    getMapDataCompat: vi.fn(async (mapName) => {
        leituras.valor += 1;
        return mapas.valor[mapName];
    }),
    updateMapDataCompat: vi.fn(async (mapName, data) => {
        mapas.valor[mapName] = data;
    })
}));

vi.mock('../../src/js/store/store-state-manager.js', () => ({
    default: {
        getCurrentMapName: () => 'MapaTeste',
        getCurrentMapId: () => 'uuid-mapa-teste'
    }
}));

vi.mock('../../src/js/store/sync/index.js', () => ({
    logCatalogLayerOperation: vi.fn(),
    OperationType: { CREATE: 'CREATE', UPDATE: 'UPDATE', DELETE: 'DELETE' }
}));

vi.mock('../../src/js/store/sync/sync-metadata.js', () => ({
    createSyncMetadata: vi.fn(() => ({ version: 1 })),
    touchSyncMetadata: vi.fn((sync) => ({ ...sync, version: (sync.version || 0) + 1 }))
}));

const { revalidateCatalogLayers, getCatalogLayers } =
    await import('../../src/js/store/catalog.operations.js');

/** Lê um arquivo de `src/` pelo caminho relativo ao pacote. */
const fonte = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

/**
 * Documento degenerado: um desenho grande e um catálogo minúsculo. É a forma que faz a
 * leitura dobrada doer, e é por isso que ela é o insumo da régua.
 * @param {number} quantasFeicoes - Feições a pôr no documento
 * @returns {Object} Documento de mapa
 */
function documentoPesado(quantasFeicoes) {
    const points = [];
    for (let i = 0; i < quantasFeicoes; i++) {
        points.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-53.1 + i * 1e-5, -29.7] },
            properties: { id: `p${i}`, source: 'point', color: '#ff0000' }
        });
    }
    return {
        name: 'MapaTeste',
        features: { points, lines: [], polygons: [] },
        catalogLayers: [
            {
                id: 'hillshade',
                type: 'hillshade',
                visible: true,
                opacity: 1,
                status: 'active',
                sync: { version: 1 }
            },
            {
                id: 'analysis-declividade',
                type: 'analysis_layer',
                visible: false,
                opacity: 1,
                status: 'active',
                sync: { version: 1 }
            }
        ]
    };
}

describe('revalidateCatalogLayers: uma leitura do documento por refresh', () => {
    beforeEach(() => {
        leituras.valor = 0;
        mapas.valor = { MapaTeste: documentoPesado(5000) };
    });

    it('devolve as camadas de catálogo junto com o resultado da revalidação', async () => {
        const resultado = await revalidateCatalogLayers();

        expect(Array.isArray(resultado.layers)).toBe(true);
        expect(resultado.layers.map(l => l.id)).toEqual(['hillshade', 'analysis-declividade']);
        expect(resultado.reactivated).toEqual([]);
        expect(resultado.stillUnavailable).toEqual([]);
    });

    it('paga UMA leitura do documento, não duas (o caminho do painel)', async () => {
        const { layers } = await revalidateCatalogLayers();

        expect(layers).toHaveLength(2);
        expect(leituras.valor).toBe(1);
    });

    it('o caminho ANTIGO (revalidar e depois getCatalogLayers) pagava duas', async () => {
        // O contraste explícito: `getCatalogLayers` continua existindo e continua custando uma
        // leitura inteira. O que mudou é que o painel não precisa mais dela.
        await revalidateCatalogLayers();
        await getCatalogLayers();

        expect(leituras.valor).toBe(2);
    });

    it('as camadas devolvidas já trazem o status revalidado', async () => {
        // A camada de análise deixa de existir no catálogo: tem de voltar como unavailable, e a
        // persistência desse status é uma ESCRITA, nunca uma segunda leitura.
        mapas.valor.MapaTeste.catalogLayers[1].id = 'analysis-inexistente';

        const { layers, stillUnavailable } = await revalidateCatalogLayers();

        expect(stillUnavailable).toEqual(['analysis-inexistente']);
        expect(layers[1].status).toBe('unavailable');
        expect(leituras.valor).toBe(1);
    });

    it('a camada que volta ao catálogo é reativada, e vem na mesma resposta', async () => {
        mapas.valor.MapaTeste.catalogLayers[1].status = 'unavailable';

        const { layers, reactivated } = await revalidateCatalogLayers();

        expect(reactivated).toEqual(['analysis-declividade']);
        expect(layers[1].status).toBe('active');
        expect(leituras.valor).toBe(1);
    });

    it('devolve lista vazia quando o mapa não tem catálogo, sem estourar', async () => {
        delete mapas.valor.MapaTeste.catalogLayers;

        const { layers } = await revalidateCatalogLayers();

        expect(layers).toEqual([]);
        expect(leituras.valor).toBe(1);
    });

    it('CONTROLE DE VÁCUO: o contador enxerga a leitura que ele existe para contar', async () => {
        // Sem este caso, um contador que nunca incrementasse deixaria todos os `toBe(1)` acima
        // passarem verde com ZERO leituras, que é o defeito oposto e igualmente invisível.
        expect(leituras.valor).toBe(0);
        await getCatalogLayers();
        expect(leituras.valor).toBe(1);
        await getCatalogLayers();
        expect(leituras.valor).toBe(2);
    });
});

describe('quem consome a revalidação: o painel de camadas de catálogo', () => {
    it('renderCatalogLayers usa as camadas devolvidas, sem uma segunda leitura', () => {
        // Varredura de texto: prende a LIGAÇÃO (o painel deixou de pedir a lista de novo), que é
        // onde a economia acontece de verdade. A régua acima mede o módulo; esta mede o chamador.
        const codigo = fonte('src/js/features_tab/catalog-layers.component.js');
        const onde = codigo.indexOf('export async function renderCatalogLayers(');
        expect(onde).toBeGreaterThan(-1);

        const corpo = codigo.slice(onde, codigo.indexOf('\n}', onde));
        expect(corpo).toMatch(/const \{ layers \} = await revalidateCatalogLayers\(\)/);
        expect(corpo).not.toMatch(/await getCatalogLayers\(\)/);
    });
});
