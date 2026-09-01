import { describe, it, expect, vi } from 'vitest';

// The export builder reads the whole store through the `@store` barrel. Mock only the getters
// it uses, with controlled data, so we can assert the `.ebgeo` data object is COMPLETE — this is
// the layer where the "groups never exported" bug lived (a `.size`/Map check on a plain object).
vi.mock('@store', () => ({
    getAllMapNamesStore: vi.fn(async () => ['Mapa A']),
    getCurrentMapName: vi.fn(async () => 'Mapa A'),
    getCurrentMapNameSync: vi.fn(() => 'Mapa A'),
    getMapOrder: vi.fn(async () => ['Mapa A']),
    getCurrentMapFeatures: vi.fn(async () => ({
        points: [{ type: 'Feature', properties: { id: 'p1', source: 'point', nome: 'Alfa' }, geometry: { type: 'Point', coordinates: [-43.2123456789, -22.9123456789] } }],
        polygons: [{ type: 'Feature', properties: { id: 'poly1', source: 'polygon' }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } }],
    })),
    getMapPosition: vi.fn(async () => ({ zoom: 8, center_lat: -22.9, center_long: -43.2, bearing: 0, pitch: 0 })),
    getCatalogLayers: vi.fn(async () => []),
    getCurrentBaseLayer: vi.fn(async () => 'carta-ortoimagem'),
    getColorUsage: vi.fn(async () => ({ '#ff0000': 2 })),
    getMapNotes: vi.fn(async () => ({ title: 'Titulo', description: 'Desc' })),
    // QUATRO NOMES PARA DUAS COISAS, e a divisão é o assunto de 2026-09-01.
    //
    // O EXPORTADOR lê do REPOSITÓRIO (`getMapGroupsFromDB`, `getLayersRepo`), que é assíncrono e
    // alcança QUALQUER mapa. Enquanto ele lia os gêmeos SÍNCRONOS abaixo, que devolvem
    // `memoryStore` (hidratado só para o mapa corrente), exportar sem visitar um mapa mandava as
    // camadas dele como uma `default` inventada e a seção de grupos vazia.
    //
    // O IMPORT ADITIVO continua lendo os síncronos, para detectar colisão de nome e de id contra
    // o que já está na tela, e é por isso que os quatro precisam existir neste duplo.
    //
    // A forma devolvida é a mesma nos dois: OBJETO simples chaveado por id de grupo, nunca um
    // `Map`, que é a forma que o defeito de 1f2b3428 tratou errado. `importGroupsDirectly`
    // espera exatamente esta.
    getMapGroupsFromDB: vi.fn(async () => ({ g1: { id: 'g1', name: 'Grupo 1', features: [{ type: 'point', id: 'p1' }] } })),
    getLayersRepo: vi.fn(async () => [{ id: 'default', name: 'Padrão', order: 0, visible: true, locked: false, opacity: 1 }]),
    getMapGroups: vi.fn(() => ({ g1: { id: 'g1', name: 'Grupo 1', features: [{ type: 'point', id: 'p1' }] } })),
    getLayers: vi.fn(async () => [{ id: 'default', name: 'Padrão', order: 0, visible: true, locked: false, opacity: 1 }]),
    // Descarrega a escrita adiada de camada antes de o documento ser montado. Sem ela no duplo,
    // `buildExportDataObject` lança e TODO caso deste arquivo cai.
    flushPendingLayerWrites: vi.fn(async () => {}),
    getCesium3dDataForExport: vi.fn(async () => ({ cameraPositions: {}, markers: [{ id: 'm1', tilesetId: 't1' }], measurements: [], viewsheds: [] })),
    getStreetview360DataForExport: vi.fn(async () => ({ orientations: {}, markers: [{ id: 's1', photoName: 'p' }] })),
    getMapTemporalConfig: vi.fn(async () => ({ ativo: true, modo: 'absoluto', unidade: 'h', inicio: 0, fim: 1000, origem: 0 })),
    getGridStyle: vi.fn(async () => ({ format: 'utm', visible: true })),
    getComments: vi.fn(async () => ({ c1: { id: 'c1', parentId: null, lng: -43.2, lat: -22.9, text: 'Atenção neste ponto', status: 'open' } })),
    getBriefingsForExport: vi.fn(async () => [{ id: 'b1', name: 'Briefing', slides: [{ id: 's1', mapId: 'Mapa A' }] }]),
    getCustomIconsForExport: vi.fn(async () => [{ id: 'icon1', name: 'Icone', type: 'image/png' }]),
}));

import { ExportImportService } from '../../src/js/import_export/export-import.service.js';
import { getCatalogLayers, getMapGroups } from '@store';

function makeService() {
    return new ExportImportService(/* baseLayerControl */ {}, /* toolManager */ { deactivateCurrentTool: vi.fn() }, /* mapManager */ {}, null);
}

describe('ExportImportService.buildExportDataObject — .ebgeo coverage (P9/P11)', () => {
    it('includes EVERY persisted data type for the map', async () => {
        const data = await makeService().buildExportDataObject(['Mapa A']);

        // Map core
        const m = data.maps['Mapa A'];
        expect(m.baseLayer).toBe('carta-ortoimagem');
        expect(m.zoom).toBe(8);
        expect(m.features.points).toHaveLength(1);
        expect(m.features.polygons).toHaveLength(1);

        // Per-map side data — each of these was, or could become, a silent-drop bug.
        expect(data.layers['Mapa A']).toHaveLength(1);
        expect(data.mapNotes['Mapa A']).toEqual({ title: 'Titulo', description: 'Desc' });
        expect(data.colorUsage['Mapa A']).toEqual({ '#ff0000': 2 });
        expect(data.temporal['Mapa A'].ativo).toBe(true);
        expect(data.gridStyle['Mapa A']).toEqual({ format: 'utm', visible: true });
        expect(data.comments['Mapa A']).toEqual({ c1: { id: 'c1', parentId: null, lng: -43.2, lat: -22.9, text: 'Atenção neste ponto', status: 'open' } });
        expect(data.cesium3d['Mapa A'].markers).toHaveLength(1);
        expect(data.streetview360['Mapa A'].markers).toHaveLength(1);

        // Global
        expect(data.briefings).toHaveLength(1);
        expect(data.customIcons).toHaveLength(1);
        expect(data.mapOrder).toEqual(['Mapa A']);
    });

    it('REGRESSION: exports groups when getMapGroupsFromDB returns a plain object', async () => {
        // The bug: the export task used a Map-only check (`v?.size` / `Object.fromEntries`) against a
        // plain object, so groups NEVER reached the .ebgeo (local AND remote). Guard it: a non-empty
        // plain object MUST be exported, keyed by group id, matching importGroupsDirectly's contract.
        const data = await makeService().buildExportDataObject(['Mapa A']);
        expect(data.groups['Mapa A']).toEqual({
            g1: { id: 'g1', name: 'Grupo 1', features: [{ type: 'point', id: 'p1' }] },
        });
    });

    it('rounds feature coordinates to 6 decimals (optimizeFeature)', async () => {
        const data = await makeService().buildExportDataObject(['Mapa A']);
        const coords = data.maps['Mapa A'].features.points[0].geometry.coordinates;
        expect(coords).toEqual([-43.212346, -22.912346]);
    });

    // ------------------------------------------------------------------------
    // F11 — O DOCUMENTO ANTIGO DO USUÁRIO SAINDO PELO ARQUIVO.
    //
    // Até a F11 o mapa guardava uma CÓPIA da linha de catálogo (`name` + o `config` inteiro,
    // com `source.url`), e o `.ebgeo` viajava com ela: um arquivo trocado por e-mail levava a
    // URL de toda camada privada em texto claro, para quem não tem concessão nenhuma. A
    // decisão de migração da fase foi NÃO varrer os documentos guardados (a cópia é inerte,
    // apagá-la seria irreversível para nada), e o preço dessa decisão é que a garantia passa a
    // ser de FRONTEIRA: o documento antigo continua existindo, e é na saída que ele é podado.
    //
    // Esta é uma das DUAS saídas de documento inteiro (a outra é
    // `buildServerImportPayload`, em `local-atlas-to-server.test.js`), e nenhuma das duas
    // tinha teste de catálogo nenhum.
    // ------------------------------------------------------------------------
    it('F11: o `.ebgeo` leva a REFERÊNCIA, nunca a definição — inclusive de documento antigo', async () => {
        const URL_PRIVADA = 'https://interno.eb.mil.br/tiles/restrito/{z}/{x}/{y}.pbf';
        getCatalogLayers.mockResolvedValueOnce([
            // A forma dominante do documento pré-F11: id PREFIXADO e a cópia dentro.
            {
                id: 'analysis-declividade',
                type: 'analysis_layer',
                name: 'Declividade (rótulo de 2025)',
                visible: false,
                opacity: 0.7,
                styleOverrides: { raster: { 'raster-opacity': 0.3 } },
                config: { id: 'declividade', source: { url: URL_PRIVADA }, bounds: [0, 0, 1, 1] },
            },
            // A forma que um `.ebgeo` ANTIGO produz: id sem prefixo, e a única referência que
            // ela tem mora dentro do `config` que está prestes a ser removido.
            {
                id: 'legado-1',
                type: 'data_layer',
                name: 'Molduras',
                visible: true,
                config: { id: 'molduras', source: { url: URL_PRIVADA } },
            },
            // O relevo sombreado, que NÃO é recurso de catálogo: a referência dele é o id.
            { id: 'hillshade', type: 'hillshade', name: 'Sombreamento do Relevo', visible: true },
        ]);

        const data = await makeService().buildExportDataObject(['Mapa A']);
        const exportadas = data.maps['Mapa A'].catalogLayers;

        expect(exportadas).toHaveLength(3);
        for (const camada of exportadas) {
            expect(camada.config, `${camada.id} não pode levar config`).toBeUndefined();
            expect(camada.name, `${camada.id} não pode levar nome`).toBeUndefined();
        }

        // A REFERÊNCIA sobrevive nas três formas, senão o arquivo importado traria camadas
        // que nunca mais resolvem — troca de um vazamento por perda de dado.
        expect(exportadas[0].id).toBe('analysis-declividade');
        expect(exportadas[1].originalId).toBe('molduras');
        expect(exportadas[2].id).toBe('hillshade');

        // E o estado POR ATLAS continua no arquivo: é dele que o mapa é feito.
        expect(exportadas[0].visible).toBe(false);
        expect(exportadas[0].opacity).toBe(0.7);
        expect(exportadas[0].styleOverrides).toEqual({ raster: { 'raster-opacity': 0.3 } });

        // A busca no documento INTEIRO, não só no item: a mesma cópia poderia reaparecer por
        // outra chave do `.ebgeo`, e conferir só o item já deixou meio buraco aberto nesta fase.
        expect(JSON.stringify(data)).not.toContain(URL_PRIVADA);
    });

    it('F11: e o caminho sem camada de catálogo nenhuma continua omitindo a chave', async () => {
        // O par do caso acima, e ele não é decoração: a poda recebe o que o store devolver, e
        // um `[]` que virasse `[]` no arquivo mudaria o shape do `.ebgeo` de todo mundo.
        const data = await makeService().buildExportDataObject(['Mapa A']);
        expect(data.maps['Mapa A'].catalogLayers).toBeUndefined();
    });
});

describe('ExportImportService.optimizeMapData / optimizeFeature (pure)', () => {
    it('does not crash on features without geometry/coordinates', () => {
        const svc = makeService();
        const out = svc.optimizeMapData({ baseLayer: 'osm', features: { texts: [{ properties: { id: 't1' } }] } });
        expect(out.baseLayer).toBe('osm');
        expect(out.features.texts[0].properties.id).toBe('t1');
    });
});

describe('ExportImportService.processGroupsForAdditiveImport — additive import of groups', () => {
    it('REGRESSION: processes groups when getMapGroups returns a plain object (not a Map)', async () => {
        // getMapGroups is sync and returns memoryStore.groups[map], a PLAIN OBJECT. Calling
        // `.values()` on it threw a TypeError caught by importGroupsAdditively, which aborted
        // the group import of EVERY map in the archive — no group ever survived an additive import.
        getMapGroups.mockReturnValueOnce({});

        const out = await makeService().processGroupsForAdditiveImport({
            g1: { id: 'g1', name: 'Grupo 1', features: [{ type: 'point', id: 'p1' }] },
            g2: { id: 'g2', name: 'Grupo 2', features: [{ type: 'point', id: 'p2' }] },
        }, 'Mapa A');

        const groups = Object.values(out);
        expect(groups).toHaveLength(2);
        expect(groups.map((g) => g.name).sort()).toEqual(['Grupo 1', 'Grupo 2']);
        // Groups are re-keyed by a NEW id, and the key matches the group's own id.
        expect(Object.keys(out)).not.toContain('g1');
        expect(Object.keys(out)).not.toContain('g2');
        for (const key of Object.keys(out)) expect(out[key].id).toBe(key);
    });

    it('EDGE: an empty target map and a target map with no group cache at all both work', async () => {
        // _ensureMapGroupsExist normally creates `{}`, but a defensive undefined must not throw.
        getMapGroups.mockReturnValueOnce(undefined);
        const out = await makeService().processGroupsForAdditiveImport(
            { g1: { id: 'g1', name: 'Grupo 1', features: [] } }, 'Mapa Novo',
        );
        expect(Object.values(out)).toHaveLength(1);
        expect(Object.values(out)[0].name).toBe('Grupo 1');
    });

    it('EDGE: disambiguates against a name already present in the target map', async () => {
        getMapGroups.mockReturnValueOnce({ gx: { id: 'gx', name: 'Grupo 1' } });
        const out = await makeService().processGroupsForAdditiveImport(
            { g1: { id: 'g1', name: 'Grupo 1', features: [] } }, 'Mapa A',
        );
        expect(Object.values(out)[0].name).toBe('Grupo 1_1');
    });

    it('remaps group members through the feature-id mapping of regenerateMapIds', async () => {
        // Feature ids are regenerated before the map is added, so a group that kept the OLD
        // ids points at features that no longer exist (imported group looks empty).
        getMapGroups.mockReturnValueOnce({});
        const idMapping = new Map([['p1', 'novo-p1'], ['p2', 'novo-p2']]);

        const out = await makeService().processGroupsForAdditiveImport({
            g1: {
                id: 'g1', name: 'Grupo 1',
                features: [{ type: 'point', id: 'p1' }, { type: 'point', id: 'p2' }, { type: 'line', id: 'sem-mapeamento' }],
            },
        }, 'Mapa A', idMapping);

        expect(Object.values(out)[0].features).toEqual([
            { type: 'point', id: 'novo-p1' },
            { type: 'point', id: 'novo-p2' },
            // EDGE: an id absent from the mapping is kept as-is, never turned into undefined.
            { type: 'line', id: 'sem-mapeamento' },
        ]);
    });
});

describe('ExportImportService._importMappedData — import side of the round-trip', () => {
    // gridStyle, temporal, cesium3d and streetview360 all import back through _importMappedData;
    // this is the read-back half of their .ebgeo round-trip.
    it('applies each per-map value through the setter (with name remap when provided)', async () => {
        const svc = makeService();
        const setter = vi.fn(async () => {});
        await svc._importMappedData(
            { 'Mapa A': { format: 'utm' }, 'Mapa B': { format: 'mgrs' } },
            setter, null, 'grid style',
        );
        expect(setter).toHaveBeenCalledWith('Mapa A', { format: 'utm' });
        expect(setter).toHaveBeenCalledWith('Mapa B', { format: 'mgrs' });

        // name → finalMapName remap (additive import).
        const setter2 = vi.fn(async () => {});
        const mapping = new Map([['Mapa A', { finalMapName: 'Mapa A (2)' }]]);
        await svc._importMappedData({ 'Mapa A': { ativo: true } }, setter2, mapping, 'temporal');
        expect(setter2).toHaveBeenCalledWith('Mapa A (2)', { ativo: true });
    });

    it('is a no-op for undefined / empty / null-valued entries (old .ebgeo without the key)', async () => {
        const svc = makeService();
        const setter = vi.fn();
        await svc._importMappedData(undefined, setter, null, 'x');
        await svc._importMappedData({}, setter, null, 'x');
        await svc._importMappedData({ 'Mapa A': null }, setter, null, 'x');
        expect(setter).not.toHaveBeenCalled();
    });
});

// ============================================================================
// A PODA DE SAÍDA no montador do `.ebgeo`.
//
// A bandeira é `buildPrunedExportData`, e ela existe SEPARADA de
// `buildExportDataObject` por uma razão de produto: "enviar ao servidor" NÃO é sair do
// servidor, e podar naquele caminho tiraria referência que o servidor pode legitimamente
// aceitar. Quem poda a entrada do servidor é o próprio servidor.
// ============================================================================

describe('ExportImportService.buildPrunedExportData — a poda de saída', () => {
    it('PISO: sem a bandeira, os dois ids RESTRITOS estão no documento', async () => {
        // É o estado de hoje, e é o piso que prova que a fixture tem o que podar: sem ele,
        // as asserções de "sumiu" passariam verdes sobre um documento vazio.
        const data = await makeService().buildExportDataObject(['Mapa A']);
        expect(JSON.stringify(data)).toContain('t1');
        expect(data.streetview360['Mapa A'].markers).toHaveLength(1);
    });

    it('com a bandeira, o restrito sai e o PÚBLICO fica', async () => {
        // O resolver de produção (`construirResolverDeSaida`) lê o singleton `config`, e a
        // classificação dele tem teste próprio (`poda-recusa-sem-soma.test.js`). Aqui ele é
        // injetado à mão para que o assunto deste caso seja a COMPOSIÇÃO sobre o documento
        // real do exportador, e nada mais.
        const { podarDocumentoDeExportacao } = await import('@catalog/private-reference-pruner.js');
        const bruto = await makeService().buildExportDataObject(['Mapa A']);
        const { documento, relatorio } = podarDocumentoDeExportacao(
            bruto,
            (grupo, id) => (id === 'carta-ortoimagem' ? 'public' : 'unknown')
        );

        // O restrito saiu…
        expect(documento.cesium3d['Mapa A'].markers).toHaveLength(0);
        expect(documento.streetview360['Mapa A'].markers).toHaveLength(0);
        // …e o público ficou. Uma bandeira que não faz nada reprova acima; uma que apaga
        // tudo reprova aqui.
        expect(documento.maps['Mapa A'].baseLayer).toBe('carta-ortoimagem');
        expect(documento.maps['Mapa A'].features.points).toHaveLength(1);
        expect(relatorio.total).toBe(2);
    });

    it('os ids de imagem são derivados do documento JÁ MONTADO, não colhidos à parte', async () => {
        // O guarda contra as duas cópias do bloco de montagem voltarem a divergir: `handleExport`
        // deixou de montar o documento por conta própria, e a coleta de imagens passou a ser
        // uma função do documento. Se alguém reintroduzir um segundo laço, este caso continua
        // verde — mas o caso estrutural abaixo não.
        const servico = makeService();
        const data = await servico.buildExportDataObject(['Mapa A']);
        const ids = [...servico.collectUsedImageIds(data)].sort();
        expect(ids).toEqual(['icon1', 'p1', 'poly1']);
    });

    it('ESTRUTURAL: o documento de exportação é montado num lugar SÓ', async () => {
        // As duas cópias do bloco eram declaradas ("This MIRRORS handleExport's data-building
        // block") e já divergiram uma vez, no bug dos grupos. A poda é justamente a regra que
        // não pode ter duas versões, então a segunda cópia foi removida — e é isto que impede
        // que ela volte.
        const { readFileSync } = await import('node:fs');
        const fonte = readFileSync(
            new URL('../../src/js/import_export/export-import.service.js', import.meta.url), 'utf8'
        );
        const montagens = fonte.split('\n').filter((l) => /version:\s*ATLAS_SCHEMA_VERSION/.test(l));
        expect(montagens).toHaveLength(1);
    });
});
