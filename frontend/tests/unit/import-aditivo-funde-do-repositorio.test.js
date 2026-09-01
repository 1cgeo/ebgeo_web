// Path: tests/unit/import-aditivo-funde-do-repositorio.test.js
//
// O RAMO DE FUSAO DO IMPORT ADITIVO LE DO REPOSITORIO, NAO DA MEMORIA.
//
// POR QUE ELE EXISTE SE O RAMO ESTA MORTO. `importLayersAdditively` tem duas metades: mapa
// recem-criado, que recebe as camadas do arquivo direto, e mapa EXISTENTE, que funde com o que
// ja esta la. Hoje so a primeira roda, porque `handleImport` da a todo mapa do arquivo um nome
// inedito (sufixo `_1`, `_2`) e registra cada um em `newlyCreatedMaps`. Ou seja, a segunda
// metade e codigo morto no unico chamador de producao.
//
// Codigo morto que le a fonte errada e uma armadilha com prazo: ele acorda no dia em que o
// import aditivo passar a fundir com mapa existente, e acorda quebrado. O alvo de uma fusao e
// por definicao um mapa que JA EXISTIA, e pode nunca ter sido visitado na sessao; a memoria de
// camada e hidratada UM MAPA POR VEZ (`setCurrentMap`), entao `getLayers` devolveria a camada
// `default` FABRICADA por `_ensureMapLayersExist`. Foi essa mesma leitura de memoria que custou
// as camadas e os grupos de todo mapa nao visitado na saida do `.ebgeo`, corrigida em
// 2026-09-01.
//
// O QUE A FUSAO PERDERIA, e a ordem de gravidade e o motivo de o teste medir os DOIS conjuntos:
// `existingNames` nasceria pobre e produziria nome repetido, que e feio mas visivel; e
// `existingIds` nasceria SEM OS IDS REAIS, e uma camada importada reusaria o id de uma que ja
// esta no mapa. Colisao de id nao se ve na tela, ela sobrescreve.
//
// COMO O RAMO E ALCANCADO AQUI: chamando `importLayersAdditively` DIRETO com um
// `newlyCreatedMaps` vazio. Nao ha como chegar nele por `handleImport` sem desfazer a regra de
// nome unico, e um teste que reescrevesse aquela regra mediria o teste, nao o codigo.
//
// O QUE UM VERDE AQUI NAO PROVA: que o ramo seja alcancavel em producao (nao e), nem que a
// fusao esteja correta em qualquer outro aspecto alem da FONTE de `existingLayers`. Ele prende
// uma coisa so, que e de onde o metodo le.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
    /** O que o REPOSITORIO tem para o mapa alvo: duas camadas de verdade. */
    doRepositorio: [
        { id: 'default', name: 'Padrão', order: 0, visible: true, locked: false, opacity: 1 },
        { id: 'camada-real', name: 'Inteligência', order: 1, visible: true, locked: false, opacity: 1 },
    ],
    /** O que a MEMORIA devolveria para um mapa nao visitado: a padrao fabricada, e so. */
    daMemoria: [{ id: 'default', name: 'Padrão', order: 0, visible: true, locked: false, opacity: 1 }],
    gravado: [],
}));

vi.mock('@store', () => ({
    getAllMapNamesStore: vi.fn(async () => ['Mapa Alvo']),
    getCurrentMapName: vi.fn(async () => 'Outro Mapa'),
    getCurrentMapNameSync: vi.fn(() => 'Outro Mapa'),
    getMapOrder: vi.fn(async () => ['Mapa Alvo']),
    getCurrentMapFeatures: vi.fn(async () => ({})),
    getMapPosition: vi.fn(async () => ({ zoom: 8, center_lat: 0, center_long: 0, bearing: 0, pitch: 0 })),
    getCatalogLayers: vi.fn(async () => []),
    getCurrentBaseLayer: vi.fn(async () => 'carta-topografica'),
    getColorUsage: vi.fn(async () => ({})),
    getMapNotes: vi.fn(async () => null),
    // O PAR QUE ESTE ARQUIVO SEPARA. O de repositorio devolve a verdade do disco; o de memoria
    // devolve o que um mapa nao visitado renderia. Se o codigo chamar o errado, o teste ve.
    getLayersRepo: vi.fn(async () => h.doRepositorio),
    getLayers: vi.fn(() => h.daMemoria),
    getMapGroupsFromDB: vi.fn(async () => ({})),
    getMapGroups: vi.fn(() => ({})),
    flushPendingLayerWrites: vi.fn(async () => {}),
    setMapLayers: vi.fn(async (mapName, payload) => { h.gravado.push({ mapName, payload }); }),
    getCesium3dDataForExport: vi.fn(async () => null),
    getStreetview360DataForExport: vi.fn(async () => null),
    getMapTemporalConfig: vi.fn(async () => null),
    getGridStyle: vi.fn(async () => null),
    getComments: vi.fn(async () => ({})),
    getBriefingsForExport: vi.fn(async () => []),
    getCustomIconsForExport: vi.fn(async () => []),
}));

const { ExportImportService } = await import('../../src/js/import_export/export-import.service.js');
const { getLayers, getLayersRepo } = await import('@store');

/** O arquivo traz UMA camada, cujo id colide com a camada real que ja esta no mapa. */
const CAMADAS_DO_ARQUIVO = {
    'Mapa Alvo': [
        { id: 'camada-real', name: 'Inteligência', order: 0, visible: true, locked: false, opacity: 1 },
    ],
};

/** Sem `layerIdMapping`, para que o id do arquivo chegue cru ao teste de colisao. */
const MAPEAMENTO = new Map([['Mapa Alvo', { finalMapName: 'Mapa Alvo', layerIdMapping: null }]]);

function servico() {
    return new ExportImportService({}, { deactivateCurrentTool: vi.fn() }, {}, null);
}

/**
 * Roda o ramo de FUSAO: `newlyCreatedMaps` VAZIO e o unico jeito de alcanca-lo, porque a guarda
 * do metodo desvia para o ramo de mapa novo quando o nome esta la.
 * @returns {Promise<Array>} as camadas que o metodo gravou
 */
async function fundir() {
    h.gravado = [];
    await servico().importLayersAdditively(CAMADAS_DO_ARQUIVO, MAPEAMENTO, new Set());
    return h.gravado.at(-1)?.payload?.layers ?? [];
}

describe('o ramo de fusao do import aditivo le do repositorio', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('consulta o gemeo de REPOSITORIO e nao o de memoria', async () => {
        await fundir();
        // ABSOLUTO nos dois sentidos: um `toHaveBeenCalled` sozinho no primeiro passaria mesmo
        // se o segundo tambem fosse chamado, e e a AUSENCIA do de memoria que prende a fonte.
        expect(getLayersRepo).toHaveBeenCalledWith('Mapa Alvo');
        expect(getLayers).not.toHaveBeenCalled();
    });

    it('a camada real do disco sobrevive a fusao', async () => {
        const camadas = await fundir();
        // A fusao parte de `existingLayers`: lendo memoria, `Inteligência` do disco sumiria da
        // lista gravada, porque `setMapLayers` reescreve o mapa inteiro com o que foi fundido.
        expect(camadas.some((l) => l.id === 'camada-real' && l.name === 'Inteligência')).toBe(true);
        expect(camadas.some((l) => l.id === 'default')).toBe(true);
    });

    it('a COLISAO DE ID e detectada, que e o que a memoria fria deixaria passar', async () => {
        const camadas = await fundir();
        const ids = camadas.map((l) => l.id);
        // Nenhum id repetido: a camada do arquivo, que chega com `camada-real`, teve de ser
        // recunhada porque aquele id ja existe NO DISCO. Lendo memoria, `existingIds` seria
        // `{default}` e a importada entraria com `camada-real`, duplicando o id.
        expect(new Set(ids).size, `ids repetidos em ${JSON.stringify(ids)}`).toBe(ids.length);
        expect(ids.filter((id) => id === 'camada-real')).toHaveLength(1);
        // Tres camadas: as duas do disco mais a importada com id novo.
        expect(camadas).toHaveLength(3);
    });

    it('a COLISAO DE NOME tambem, e o nome novo deriva do que esta no disco', async () => {
        const camadas = await fundir();
        expect(camadas.map((l) => l.name).sort()).toEqual(['Inteligência', 'Inteligência_1', 'Padrão']);
    });

    it('CONTROLE: mapa em `newlyCreatedMaps` nao passa por fusao nenhuma', async () => {
        // O outro ramo, que e o unico que producao alcanca hoje. Sem ele nao da para saber se as
        // assercoes acima medem a fusao ou qualquer caminho do metodo.
        h.gravado = [];
        await servico().importLayersAdditively(CAMADAS_DO_ARQUIVO, MAPEAMENTO, new Set(['Mapa Alvo']));
        expect(getLayersRepo).not.toHaveBeenCalled();
        expect(h.gravado.at(-1).payload.layers).toHaveLength(1);
    });
});
