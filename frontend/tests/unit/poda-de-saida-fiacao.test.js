// Path: tests/unit/poda-de-saida-fiacao.test.js
//
// A FIAÇÃO DA PODA DE SAÍDA: que o `.ebgeo` que o exportador produz saia PODADO.
//
// O BURACO QUE ESTE ARQUIVO FECHA foi medido, não suposto. A onda que criou a poda de
// saída tinha seis arquivos de teste e NENHUM deles chamava `buildPrunedExportData`: o
// bloco que levava o nome do método injetava um resolver à mão e chamava
// `podarDocumentoDeExportacao` direto, o que mede o podador PURO (já medido em
// `poda-de-referencia-privada.test.js`) e não a ligação entre ele e o exportador.
// Substituir, em `handleExport`, a chamada podada pela crua deixava os 4651 casos do
// frontend IDÊNTICOS — zero vermelhos. O título da onda era "o `.ebgeo` podado".
//
// SÃO DUAS ASSERÇÕES DE NATUREZAS DIFERENTES, e as duas são necessárias:
//   1. COMPORTAMENTO: `buildPrunedExportData` roda a cadeia inteira (montador REAL +
//      resolver de produção REAL, lendo o `config` dublado) e o restrito não sai.
//   2. ESTRUTURA: `handleExport` chama a versão PODADA. Nenhum teste de comportamento do
//      `handleExport` é barato (ele zipa, baixa e abre diálogo), e é justamente a linha de
//      ligação que a reversão do controle negativo tocou.
//
// O RESOLVER AQUI É O DE PRODUÇÃO, e essa é a diferença que dá poder a este arquivo: o
// dublê é o `config` e a sessão, não a regra. Uma classificação errada em
// `construirResolverDeSaida` aparece aqui, e não apareceria num teste que injeta o
// veredito pronto.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

// O montador lê o store inteiro pelo barrel. Só os getters que ele usa, com dado
// controlado: um marcador 3D com tileset RESTRITO, um marcador 360 (sempre restrito, pela
// saída 3 da decisão do dono) e uma camada de base PÚBLICA, que é a metade positiva.
vi.mock('@store', () => ({
    getAllMapNamesStore: vi.fn(async () => ['Mapa A']),
    getCurrentMapName: vi.fn(async () => 'Mapa A'),
    getCurrentMapNameSync: vi.fn(() => 'Mapa A'),
    getMapOrder: vi.fn(async () => ['Mapa A']),
    getCurrentMapFeatures: vi.fn(async () => ({
        points: [{ type: 'Feature', properties: { id: 'p1', source: 'point', nome: 'Alfa' }, geometry: { type: 'Point', coordinates: [-43.2, -22.9] } }],
    })),
    getMapPosition: vi.fn(async () => ({ zoom: 8, center_lat: -22.9, center_long: -43.2, bearing: 0, pitch: 0 })),
    getCatalogLayers: vi.fn(async () => ([
        { id: 'data-camada-publica', type: 'data_layer', visible: true },
        { id: 'data-camada-restrita', type: 'data_layer', visible: true },
    ])),
    getCurrentBaseLayer: vi.fn(async () => 'carta-topografica'),
    getColorUsage: vi.fn(async () => ({})),
    getMapNotes: vi.fn(async () => null),
    getMapGroups: vi.fn(() => ({})),
    getLayers: vi.fn(async () => []),
    getCesium3dDataForExport: vi.fn(async () => ({
        cameraPositions: {}, markers: [{ id: 'm1', tilesetId: 'tileset-restrito' }], measurements: [], viewsheds: [],
    })),
    getStreetview360DataForExport: vi.fn(async () => ({ orientations: {}, markers: [{ id: 's1', photoName: 'foto-qualquer.jpg' }] })),
    getMapTemporalConfig: vi.fn(async () => null),
    getGridStyle: vi.fn(async () => null),
    getComments: vi.fn(async () => ({})),
    getBriefingsForExport: vi.fn(async () => []),
    getCustomIconsForExport: vi.fn(async () => []),
}));

// O CATÁLOGO QUE ESTE CLIENTE ENXERGA. `tileset-restrito` e `camada-restrita` NÃO estão
// aqui: é assim que o resolver de produção os classifica como `unknown`, que é o mesmo
// destino de `private` na regra keep-list.
vi.mock('@js/config.js', () => ({
    default: {
        basemaps: { 'carta-topografica': { name: 'Topográfica' } },
        tilesets: [],
        dataLayers: { enabled: true, layers: [{ id: 'camada-publica', name: 'Camada Pública' }] },
        analysisLayers: { enabled: true, layers: [] },
    },
}));

// OS DOIS SINGLETONS ENTRAM POR `importOriginal`, e nao por substituicao total: os dois
// modulos exportam mais coisa do que a poda usa (`PermissionAction`, o barrel de sync
// inteiro), e um duble completo derruba o grafo de import antes do primeiro caso rodar.
vi.mock('@store/sync/resource-access.service.js', async (importOriginal) => ({
    ...(await importOriginal()),
    _grantedScope: () => null,           // a soma ACONTECEU (sem atlas em foco)
    isPrivateResource: () => false,
    retryVisibleResources: async () => true,
}));

vi.mock('@store/sync/session-context.js', async (importOriginal) => {
    const actual = await importOriginal();
    const sessionContext = Object.create(Object.getPrototypeOf(actual.sessionContext));
    Object.assign(sessionContext, actual.sessionContext);
    sessionContext.isAuthenticated = () => true;
    return { ...actual, sessionContext };
});

import { ExportImportService } from '../../src/js/import_export/export-import.service.js';

const FONTE = new URL('../../src/js/import_export/export-import.service.js', import.meta.url);

function makeService() {
    return new ExportImportService({}, { deactivateCurrentTool: vi.fn() }, {}, null);
}

describe('a poda de saída está LIGADA no montador do `.ebgeo`', () => {
    it('PISO: o documento CRU carrega os três ids restritos', async () => {
        // Sem este piso, as asserções de "sumiu" abaixo passariam verdes sobre um documento
        // vazio ou sobre uma fixture com erro de digitação.
        const cru = JSON.stringify(await makeService().buildExportDataObject(['Mapa A']));
        expect(cru).toContain('tileset-restrito');
        expect(cru).toContain('camada-restrita');
        expect(cru).toContain('foto-qualquer.jpg');
    });

    it('`buildPrunedExportData` poda o documento que o exportador monta', async () => {
        const { data, relatorio } = await makeService().buildPrunedExportData(['Mapa A']);
        const json = JSON.stringify(data);

        // O restrito saiu, pelas TRÊS famílias.
        expect(json).not.toContain('tileset-restrito');
        expect(json).not.toContain('camada-restrita');
        expect(json).not.toContain('foto-qualquer.jpg');

        // DISCRIMINAÇÃO: uma poda que apagasse tudo passaria nas três linhas de cima. O
        // público sobrevive, e o dado desenhado pelo usuário também.
        expect(json).toContain('camada-publica');
        expect(data.maps['Mapa A'].baseLayer).toBe('carta-topografica');
        expect(data.maps['Mapa A'].features.points).toHaveLength(1);

        // O relatório é o que alimenta o aviso ao usuário: três perdas, três superfícies.
        expect(relatorio.total).toBe(3);
        expect(Object.keys(relatorio.porSuperficie).sort())
            .toEqual(['cesium3d.markers', 'mapa.catalogLayers', 'sv360.markers']);
    });

    it('ESTRUTURAL: `handleExport` chama a versão PODADA, e o montador cru tem UM leitor', async () => {
        // A LINHA QUE O CONTROLE NEGATIVO TOCOU. Trocar `buildPrunedExportData` por
        // `buildExportDataObject` dentro de `handleExport` desfaz a onda inteira e nenhum
        // teste de comportamento do exportador chega lá (ele zipa, baixa e abre diálogo).
        const fonte = readFileSync(FONTE, 'utf8');

        const corpo = fonte.slice(fonte.indexOf('async handleExport('));
        expect(corpo.length).toBeGreaterThan(500);
        expect(corpo).toMatch(/await this\.buildPrunedExportData\(mapsToExport\)/);

        // E o montador CRU é chamado num lugar só, de dentro do podado: um segundo leitor
        // seria a segunda porta de saída, que é como a poda deixa de valer para metade dos
        // caminhos sem ninguém notar. (`local-atlas-to-server.js` o chama de fora, e é
        // deliberado: enviar ao servidor NÃO é sair do servidor.)
        expect(fonte.match(/await this\.buildExportDataObject\(/g)).toHaveLength(1);
    });
});
