// Path: tests/unit/tiles-360-escopo-de-atlas.test.js
//
// O EMPRESTIMO POR ATLAS CHEGA AO TILE DO 360, E O TILE DO ATLAS ANTERIOR NAO E REUSADO.
//
// A decisao de 2026-08-18 ("o emprestimo por atlas alcanca o 360, e o UUID do atlas nao e
// senha") ligou o eixo no servidor: a rota do MVT valida `?atlasId=` como GUID, levanta-o com
// `liftOptionalAtlasId` e o submete a `requireAtlasScopeWhenPresent`, que compoe um
// `requireAtlasPermission('read')` de verdade. O cliente nunca exerceu isso: `/api/config`
// publica `${sv360ServiceUrl}/tiles/{z}/{x}/{y}.pbf` sem parametro nenhum e nada o acrescentava.
// Projeto 360 emprestado por atlas ficava invisivel na camada 2D, em todo deploy.
//
// TRES COISAS SAO MEDIDAS AQUI, E A TERCEIRA E A QUE REPROVA A IMPLEMENTACAO PREGUICOSA:
//
//   1. com atlas em foco, a URL da FONTE leva o `atlasId` certo;
//   2. sem atlas em foco, a fonte sai IDENTICA ao que e hoje — por identidade de objeto, nao
//      so por igualdade de texto, porque `atlasId=` vazio morreria em 422 no `.guid()` e
//      apagaria a camada para todo mundo, inclusive o anonimo;
//   3. ao TROCAR de atlas, a fonte e DEMOLIDA. Carimbar so no `transformRequest` produziria a
//      URL certa no primeiro pedido de cada tile e ainda assim serviria o tile do atlas A
//      dentro do atlas B, porque o MapLibre indexa o cache por `OverscaledTileID.key` e nunca
//      pela URL. O ultimo bloco deste arquivo le a FONTE do MapLibre instalado e prende essa
//      premissa: se uma atualizacao do MapLibre mudar o modelo de cache, o teste manda medir de
//      novo em vez de deixar a decisao de desenho apoiada numa lembranca. Na subida para a 6.7.0
//      (2026-09-04) ele fez o trabalho dele: o modelo de cache nao mudou, mas o comportamento de
//      `setTiles()` na fonte vetorial mudou, e esta escrito la.
//
// O QUE ESTE ARQUIVO NAO PRENDE: que o MapLibre de fato refaca o pedido de rede depois da
// demolicao. Isso e um mapa vivo com Web Worker, ou seja Playwright, e esta nomeado no
// relatorio em vez de simulado aqui.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { stampAtlasOnTiles, rebuildScopedSource } from '../../src/js/street_view_tool/tile-scope.js';

const ORIGEM_DA_PAGINA = 'https://mapa.example.mil.br';
const ATLAS_A = '11111111-2222-4333-8444-555555555555';
const ATLAS_B = '99999999-8888-4777-8666-555555555555';
const TEMPLATE = '/api/v1/sv360/tiles/{z}/{x}/{y}.pbf';

globalThis.window = { location: { origin: ORIGEM_DA_PAGINA } };

// ============================================================
// 1 e 2 — o carimbo na URL da fonte, e o controle negativo
// ============================================================

describe('stampAtlasOnTiles: o atlas em foco entra na URL da FONTE', () => {
    it('carimba o template com o atlas em foco, e a fonte original nao muda', () => {
        const fonte = { type: 'vector', tiles: [TEMPLATE] };
        const saida = stampAtlasOnTiles(fonte, ATLAS_A);
        expect(saida.tiles).toEqual([`${TEMPLATE}?atlasId=${ATLAS_A}`]);
        expect(fonte.tiles).toEqual([TEMPLATE]);
        expect(saida.type).toBe('vector');
    });

    it('deixa os marcadores {z}/{x}/{y} literais: o MapLibre os troca por texto', () => {
        const [url] = stampAtlasOnTiles({ tiles: [TEMPLATE] }, ATLAS_A).tiles;
        expect(url).toContain('{z}');
        expect(url).toContain('{x}');
        expect(url).toContain('{y}');
        expect(url).not.toContain('%7B');
    });

    it('respeita uma query que ja existe, e o hash', () => {
        expect(stampAtlasOnTiles({ tiles: ['/t/{z}.pbf?v=3'] }, ATLAS_A).tiles)
            .toEqual([`/t/{z}.pbf?v=3&atlasId=${ATLAS_A}`]);
        expect(stampAtlasOnTiles({ tiles: ['/t/{z}.pbf#frag'] }, ATLAS_A).tiles)
            .toEqual([`/t/{z}.pbf?atlasId=${ATLAS_A}#frag`]);
    });

    it('e idempotente: uma segunda passada nao produz dois atlasId', () => {
        const uma = stampAtlasOnTiles({ tiles: [TEMPLATE] }, ATLAS_A);
        const duas = stampAtlasOnTiles(uma, ATLAS_A);
        expect(duas.tiles).toEqual(uma.tiles);
        const outra = stampAtlasOnTiles(uma, ATLAS_B);
        expect(outra.tiles).toEqual(uma.tiles);
    });

    it('carimba a origem CRUZADA tambem: o template nomeia o proprio servico do 360', () => {
        // Ao contrario do `assets3d`, aqui outra origem nao e terceiro: e o
        // SV360_SERVICE_URL, o unico processo que le o parametro.
        const abs = 'https://sv360.example.mil.br/api/v1/sv360/tiles/{z}/{x}/{y}.pbf';
        expect(stampAtlasOnTiles({ tiles: [abs] }, ATLAS_A).tiles)
            .toEqual([`${abs}?atlasId=${ATLAS_A}`]);
    });
});

describe('O CONTROLE NEGATIVO: sem atlas em foco a fonte sai exatamente como hoje', () => {
    it('sem atlas, a fonte volta POR IDENTIDADE, nao so igual', () => {
        const fonte = { type: 'vector', tiles: [TEMPLATE] };
        for (const semAtlas of [null, undefined, '', 0, false]) {
            expect(stampAtlasOnTiles(fonte, semAtlas)).toBe(fonte);
        }
    });

    it('nenhum parametro entra na URL do anonimo', () => {
        const saida = stampAtlasOnTiles({ type: 'vector', tiles: [TEMPLATE] }, null);
        expect(saida.tiles).toEqual([TEMPLATE]);
        expect(saida.tiles[0]).not.toContain('atlasId');
        expect(saida.tiles[0]).not.toContain('?');
    });

    it('forma de fonte que este ajudante nao entende sai intacta', () => {
        const vazia = { type: 'vector', tiles: [] };
        expect(stampAtlasOnTiles(vazia, ATLAS_A)).toBe(vazia);
        const semTiles = { type: 'geojson', data: {} };
        expect(stampAtlasOnTiles(semTiles, ATLAS_A)).toBe(semTiles);
        expect(stampAtlasOnTiles(undefined, ATLAS_A)).toBe(undefined);
        expect(stampAtlasOnTiles(null, ATLAS_A)).toBe(null);
        expect(stampAtlasOnTiles({ tiles: [42] }, ATLAS_A).tiles).toEqual([42]);
    });
});

// ============================================================
// 3 — a troca de atlas DEMOLE a fonte
// ============================================================

/**
 * Um mapa de mentira com a parte do contrato do MapLibre que importa aqui, mais um espiao:
 * `historico` guarda a ordem real das chamadas, porque a ordem e metade do que se afirma
 * (remover a camada ANTES da fonte, e devolve-la DEPOIS).
 */
function mapaFalso(camadas = [], fontes = {}) {
    const estado = {
        camadas: camadas.map((c) => ({ ...c })),
        fontes: { ...fontes },
        historico: [],
    };
    return {
        estado,
        getSource: (id) => estado.fontes[id],
        getStyle: () => ({ layers: estado.camadas.map((c) => ({ ...c })) }),
        removeLayer: (id) => {
            estado.historico.push(`removeLayer:${id}`);
            estado.camadas = estado.camadas.filter((c) => c.id !== id);
        },
        removeSource: (id) => {
            estado.historico.push(`removeSource:${id}`);
            delete estado.fontes[id];
        },
        addSource: (id, spec) => {
            estado.historico.push(`addSource:${id}`);
            estado.fontes[id] = spec;
        },
        addLayer: (spec, beforeId) => {
            estado.historico.push(`addLayer:${spec.id}${beforeId ? `>${beforeId}` : ''}`);
            const i = beforeId ? estado.camadas.findIndex((c) => c.id === beforeId) : -1;
            if (i < 0) estado.camadas.push({ ...spec });
            else estado.camadas.splice(i, 0, { ...spec });
        },
    };
}

const CAMADAS = [
    { id: 'basemap', source: 'osm' },
    { id: 'street-view-lines', source: 'fotos_linha', 'source-layer': 'fotos_linha' },
    { id: 'street-view-lines-hit', source: 'fotos_linha', 'source-layer': 'fotos_linha' },
    { id: 'streetview-markers-pins', source: 'streetview-markers-source' },
];

describe('rebuildScopedSource: trocar de atlas DERRUBA a fonte, nao a reafina', () => {
    let mapa;

    beforeEach(() => {
        mapa = mapaFalso(CAMADAS, {
            osm: { type: 'raster' },
            'fotos_linha': { type: 'vector', tiles: [`${TEMPLATE}?atlasId=${ATLAS_A}`] },
            'streetview-markers-source': { type: 'geojson' },
        });
    });

    it('a fonte do atlas A e REMOVIDA antes de a do atlas B entrar', () => {
        const nova = { type: 'vector', tiles: [`${TEMPLATE}?atlasId=${ATLAS_B}`] };
        expect(rebuildScopedSource(mapa, 'fotos_linha', nova)).toBe(true);

        // A afirmacao central: `removeSource` acontece. E ela que joga fora o TileManager,
        // com os tiles em vista e o cache fora de vista. Um `setTiles()` no lugar disto
        // trocaria o texto da URL e continuaria servindo os bytes do atlas A.
        expect(mapa.estado.historico).toEqual([
            'removeLayer:street-view-lines',
            'removeLayer:street-view-lines-hit',
            'removeSource:fotos_linha',
            'addSource:fotos_linha',
            'addLayer:street-view-lines>streetview-markers-pins',
            'addLayer:street-view-lines-hit>streetview-markers-pins',
        ]);
        expect(mapa.estado.fontes['fotos_linha']).toBe(nova);
        expect(mapa.estado.fontes['fotos_linha'].tiles[0]).toContain(ATLAS_B);
        expect(mapa.estado.fontes['fotos_linha'].tiles[0]).not.toContain(ATLAS_A);
    });

    it('as camadas voltam na MESMA posicao da pilha, nao no topo', () => {
        rebuildScopedSource(mapa, 'fotos_linha', { type: 'vector', tiles: [TEMPLATE] });
        expect(mapa.estado.camadas.map((c) => c.id)).toEqual(CAMADAS.map((c) => c.id));
    });

    it('a camada que estava por ULTIMO volta por ultimo (sem beforeId)', () => {
        const m = mapaFalso(
            [{ id: 'basemap', source: 'osm' }, { id: 'points', source: 'streetViewPointsSource' }],
            { osm: {}, streetViewPointsSource: { tiles: [TEMPLATE] } }
        );
        rebuildScopedSource(m, 'streetViewPointsSource', { tiles: [`${TEMPLATE}?atlasId=${ATLAS_B}`] });
        expect(m.estado.historico).toContain('addLayer:points');
        expect(m.estado.camadas.map((c) => c.id)).toEqual(['basemap', 'points']);
    });

    it('preserva o filtro VIVO da camada, que o minimapa muda em tempo de execucao', () => {
        const m = mapaFalso(
            [{ id: 'selected', source: 'streetViewPointsSource', filter: ['==', 'id', 'foto-77'] }],
            { streetViewPointsSource: { tiles: [TEMPLATE] } }
        );
        rebuildScopedSource(m, 'streetViewPointsSource', { tiles: [`${TEMPLATE}?atlasId=${ATLAS_B}`] });
        expect(m.estado.camadas[0].filter).toEqual(['==', 'id', 'foto-77']);
    });

    it('fonte que ainda nao existe no mapa nao e erro, e nada e tocado', () => {
        const m = mapaFalso(CAMADAS, { osm: {} });
        expect(rebuildScopedSource(m, 'fotos_linha', { tiles: [TEMPLATE] })).toBe(false);
        expect(m.estado.historico).toEqual([]);
    });

    it('estilo que nao serializa nao demole pela metade', () => {
        const m = mapaFalso(CAMADAS, { 'fotos_linha': { tiles: [TEMPLATE] } });
        m.getStyle = () => { throw new Error('Style is not done loading'); };
        expect(rebuildScopedSource(m, 'fotos_linha', { tiles: [TEMPLATE] })).toBe(false);
        expect(m.estado.historico).toEqual([]);
        expect(m.estado.fontes['fotos_linha']).toBeDefined();
    });

    it('entrada inutil devolve false em vez de estourar na criacao do mapa', () => {
        expect(rebuildScopedSource(null, 'x', {})).toBe(false);
        expect(rebuildScopedSource(mapa, '', { tiles: [] })).toBe(false);
        expect(rebuildScopedSource(mapa, 'fotos_linha', null)).toBe(false);
        expect(rebuildScopedSource({}, 'fotos_linha', { tiles: [] })).toBe(false);
    });
});

// ============================================================
// A PREMISSA MEDIDA NA FONTE DO MAPLIBRE INSTALADO
// ============================================================
//
// ATE 2026-09-04 ESTE BLOCO LIA O BUNDLE MINIFICADO de `public/vendors/maplibre-gl.js` (5.18) e
// cobrava trechos literais dele. O MapLibre passou a vir do npm (6.7.0, pinado exato) e aquele
// arquivo foi apagado. A releitura foi feita contra `node_modules/maplibre-gl/src/`, o TypeScript
// que o pacote PUBLICA, e nao contra o `dist/` minificado: e a mesma fonte primaria, sobrevive a
// troca de minificador, e diz o que o codigo faz em vez de como ele ficou espremido.
//
// E A RELEITURA MUDOU UM DOS TRES, que e exatamente por que este bloco existe: na 6.x
// `setTiles()` numa fonte VETORIAL passou a REFAZER o pedido. O detalhe esta no terceiro caso. A
// decisao de desenho (demolir a fonte, em vez de carimbar no `transformRequest`) NAO depende
// desse terceiro: ela se apoia no primeiro, e o primeiro continua verdadeiro.

describe('a evidencia que elimina o carimbo no transformRequest', () => {
    const RAIZ = '../../node_modules/maplibre-gl/src/';
    const ler = (rel) => readFileSync(fileURLToPath(new URL(RAIZ + rel, import.meta.url)), 'utf8');
    const tileManager = ler('tile/tile_manager.ts');
    const fonteVetorial = ler('source/vector_tile_source.ts');

    it('CONTROLE DE VACUO: os arquivos lidos existem e tem corpo', () => {
        // Sem isto, um pacote que parasse de publicar `src/` faria `readFileSync` estourar na
        // coleta (falha ruidosa, aceitavel), mas um arquivo VAZIO deixaria todo `toContain`
        // abaixo reprovando por motivo errado, e um dia alguem os "consertaria" apagando-os.
        expect(tileManager.length).toBeGreaterThan(5000);
        expect(fonteVetorial.length).toBeGreaterThan(3000);
    });

    it('o cache de tile e indexado pela CHAVE do tile, nunca pela URL transformada', () => {
        // `_addTile` responde dos dois caches antes de qualquer pedido, e os dois sao
        // consultados por `tileID.key` (z/x/y/wrap). Nada ali conhece a URL.
        // Inalterado da 5.18 para a 6.7.
        expect(tileManager).toContain('_addTile(tileID: OverscaledTileID): Tile {');
        expect(tileManager).toContain('let tile = this._inViewTiles.getTileById(tileID.key);');
        expect(tileManager).toContain('tile = this._outOfViewCache.getAndRemove(tileID);');
    });

    it('a URL do tile nasce da FONTE e so depois passa pelo transformRequest', () => {
        // Inalterado da 5.18 para a 6.7, tirando o `await` que a 6.x acrescentou (o
        // `transformRequest` agora PODE devolver Promise; o nosso e sincrono e continua valido).
        expect(fonteVetorial).toContain('const url = tile.tileID.canonical.url(this.tiles');
        expect(fonteVetorial)
            .toContain('this.map._requestManager.transformRequest(url, ResourceType.Tile)');
    });

    it('MUDOU NA 6.x: setTiles() numa fonte VETORIAL passou a REFAZER o pedido', () => {
        // 5.18: a fonte vetorial chamava `load()` sem argumento (so a raster chamava `load(!0)`),
        // entao `sourceDataChanged` ficava indefinido, `reload()` marcava o tile como "reloading"
        // e o `loadTile` mandava "RT" (reloadTile), que faz o worker REPARSEAR o que ja estava
        // carregado, sem rede.
        //
        // 6.7: `setSourceProperty` chama `load(true)` tambem na vetorial, `reload(true)` marca o
        // tile como "expired", e o `loadTile` cai no ramo `!tile.actor || tile.state === 'expired'`,
        // que troca a mensagem para `loadTile` e pede o tile de novo, pela rede.
        //
        // ISSO NAO REABILITA O CARIMBO NO `transformRequest`: o que o eliminou foi o caso 1 (o
        // cache por `tileID.key`), porque um tile do atlas A ja EM CACHE seria servido dentro do
        // atlas B sem pedido nenhum. Fica registrado porque a proxima pessoa que ler o desenho vai
        // querer saber se `setTiles` sozinho bastaria, e a resposta mudou com a versao.
        expect(fonteVetorial).toContain('callback();\n\n        this.load(true);');
        expect(tileManager).toContain("this._reloadTile(id, tile.state === 'errored' ? 'loading' : 'expired');");
        expect(fonteVetorial).toContain("if (!tile.actor || tile.state === 'expired') {");
        expect(fonteVetorial).toContain('messageType = MessageType.loadTile;');
    });
});

// ============================================================
// A FIACAO: a fonte de verdade do atlas em foco e UMA so
// ============================================================

describe('o atlas em foco vem do registro que ja existe, e nao de um segundo', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('sv360TileSource segue o carimbo que refreshVisibleResources declara', async () => {
        vi.doMock('../../src/js/config.js', () => ({
            default: { streetView360: { serviceUrl: '/api/v1/sv360' } },
        }));
        vi.doMock('../../src/js/store/sync/api-client.js', () => ({
            apiClient: {
                getAccessToken: () => null,
                getVisibleResources: vi.fn(async () => ({
                    basemaps: [], tilesets: [], dataLayers: [], analysisLayers: [], views360: [],
                })),
            },
        }));
        vi.doMock('../../src/js/store/sync/atlas-settings.service.js', () => ({
            mergeGrantedIntoBaseline: vi.fn(),
            revertGrantedResources: vi.fn(),
        }));
        vi.doMock('../../src/js/store/sync/session-context.js', async (importOriginal) => ({
            ...(await importOriginal()),
            sessionContext: { userId: 'u-1', hasGlobalDataAccess: () => false },
        }));

        const { sv360AtlasScope, sv360TileSource } = await import(
            '../../src/js/street_view_tool/streetview-api.service.js'
        );
        const { refreshVisibleResources, clearVisibleResources } = await import(
            '../../src/js/store/sync/resource-access.service.js'
        );

        const fonte = { type: 'vector', tiles: [TEMPLATE] };
        const absoluto = `${ORIGEM_DA_PAGINA}${TEMPLATE}`;

        // Sem atlas: absoluto (pelo worker do MapLibre) e mais nada.
        expect(sv360AtlasScope()).toBe(null);
        expect(sv360TileSource(fonte).tiles).toEqual([absoluto]);

        // Entrando no atlas A: o mesmo registro que decide o payload aditivo decide a URL.
        await refreshVisibleResources(ATLAS_A);
        expect(sv360AtlasScope()).toBe(ATLAS_A);
        expect(sv360TileSource(fonte).tiles).toEqual([`${absoluto}?atlasId=${ATLAS_A}`]);

        // Trocando para B: a URL da fonte muda junto, que e o que faz a demolicao valer.
        await refreshVisibleResources(ATLAS_B);
        expect(sv360TileSource(fonte).tiles).toEqual([`${absoluto}?atlasId=${ATLAS_B}`]);

        // Saindo do atlas: de volta a URL de hoje, sem parametro nenhum.
        clearVisibleResources();
        expect(sv360AtlasScope()).toBe(null);
        expect(sv360TileSource(fonte).tiles).toEqual([absoluto]);
    });
});
