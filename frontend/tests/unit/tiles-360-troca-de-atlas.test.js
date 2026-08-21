// Path: tests/unit/tiles-360-troca-de-atlas.test.js
//
// A FIACAO DA TROCA DE ATLAS, MEDIDA NO CONTROLE (e nao so nos ajudantes).
//
// `tiles-360-escopo-de-atlas.test.js` mede as duas pecas puras: o carimbo na URL da fonte e a
// demolicao da fonte. Este arquivo mede o que liga uma na outra e e onde a fiacao costuma
// morrer sem barulho: QUEM avisa que o atlas trocou, QUANDO o carimbo do controle avanca, e
// que um anuncio sem troca de atlas nao derruba fonte nenhuma.
//
// O anuncio e `ATLAS_SETTINGS_CHANGED`, que ja existe e ja e emitido pelo sync depois de
// `refreshVisibleResources(atlasId)` (montagem do atlas) e de novo no `disconnect` (saida).
// Nao ha segunda fonte de verdade para "qual atlas esta aberto": o controle le
// `currentResourceAtlasId()`, o mesmo registro que decide o payload aditivo e que invalida o
// cache de projetos do 360.
//
// O CASO QUE REPROVA A IMPLEMENTACAO PREGUICOSA e o terceiro: trocar de atlas com a camada JA
// desenhada tem de remover a fonte. Carimbar so no `transformRequest`, ou chamar `setTiles()`,
// deixaria os tiles do atlas anterior no cache do MapLibre (a evidencia esta no bundle, medida
// no arquivo irmao).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ORIGEM = 'https://mapa.example.mil.br';
const ATLAS_A = '11111111-2222-4333-8444-555555555555';
const ATLAS_B = '99999999-8888-4777-8666-555555555555';
const TEMPLATE = '/api/v1/sv360/tiles/{z}/{x}/{y}.pbf';

// O ambiente unitario e node. O controle e um control do MapLibre: toca `matchMedia` no
// construtor e `document` no `onAdd`. Nada disto e o que se mede aqui, entao vira tocos.
function stubGlobais() {
    globalThis.window = {
        location: { origin: ORIGEM },
        matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    };
    globalThis.document = {
        createElement: () => ({ style: {}, parentNode: null, appendChild() {} }),
        getElementById: () => null,
    };
    // O construtor devolve um mapa de mentira: `onAdd` monta o minimapa de verdade, e o
    // ultimo caso deste arquivo passa por ali sem ter um pronto.
    globalThis.maplibregl = { addProtocol() {}, Map: function Map() { return mapaFalso([], {}); } };
}
stubGlobais();

vi.mock('../../src/js/config.js', () => ({
    default: {
        features: { imagens_panoramicas: true },
        streetView360: {
            serviceUrl: '/api/v1/sv360',
            pointsSource: { type: 'vector', tiles: [TEMPLATE] },
            pointsSourceLayer: 'fotos',
            linesSource: { type: 'vector', tiles: [TEMPLATE] },
            linesSourceLayer: 'fotos_linha',
        },
    },
}));

vi.mock('../../src/js/store/sync/api-client.js', () => ({
    apiClient: { getAccessToken: () => null },
}));

// O barrel do store arrasta o motor de sync inteiro. So o que o controle usa e trocado.
const barramento = vi.hoisted(() => {
    const ouvintes = new Map();
    return {
        on(tipo, fn) {
            if (!ouvintes.has(tipo)) ouvintes.set(tipo, new Set());
            ouvintes.get(tipo).add(fn);
            return () => ouvintes.get(tipo).delete(fn);
        },
        emit(tipo, carga) {
            for (const fn of ouvintes.get(tipo) ?? []) fn(carga);
        },
        limpa: () => ouvintes.clear(),
        conta: (tipo) => (ouvintes.get(tipo)?.size ?? 0),
    };
});

vi.mock('@store', () => ({
    getEventBus: () => barramento,
    registerControl: () => {},
}));

// `saved_photos_markers.js` importa `getEventBus` de `@store/services.js` DIRETO, sem passar
// pelo barrel, e o singleton de servicos so existe depois do boot da aplicacao. Sem este
// segundo toco o `onAdd` morre antes de assinar coisa nenhuma.
vi.mock('@store/services.js', async (importOriginal) => ({
    ...(await importOriginal()),
    getEventBus: () => barramento,
}));

const { EventTypes } = await import('../../src/js/events/event_types.js');
const { setResourceScope, resetResourceScope, resourceScopeKey } = await import(
    '../../src/js/store/sync/resource-scope.js'
);
const { default: AddStreetViewControl } = await import(
    '../../src/js/street_view_tool/add_street_view_control.js'
);

/** Um mapa de mentira com a parte do contrato do MapLibre que este caminho usa. */
function mapaFalso(camadas, fontes) {
    const estado = { camadas: [...camadas], fontes: { ...fontes }, historico: [] };
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
        addLayer: (spec) => {
            estado.historico.push(`addLayer:${spec.id}`);
            estado.camadas.push({ ...spec });
        },
        getLayer: (id) => estado.camadas.find((c) => c.id === id),
        // O controle assina `load` no minimapa. O toco nunca dispara, entao a criacao das
        // camadas do minimapa nao roda aqui: o que este arquivo mede e a troca de atlas
        // sobre fontes JA desenhadas, montadas pelo ajudante abaixo.
        on: () => {},
        off: () => {},
    };
}

/** O controle montado com as duas fontes ja desenhadas sob `atlas`, como depois de ativar. */
function controleComFontesEm(atlas) {
    setResourceScope(resourceScopeKey('u-1', atlas));
    const controle = new AddStreetViewControl({});
    const idLinhas = controle.streetViewLinesLayer['source'];
    const idPontos = controle.pointsSourceRef.id;
    const sufixo = atlas ? `?atlasId=${atlas}` : '';

    const mapa = mapaFalso(
        [{ id: 'basemap', source: 'osm' }, { id: 'street-view-lines', source: idLinhas }],
        { osm: {}, [idLinhas]: { type: 'vector', tiles: [`${ORIGEM}${TEMPLATE}${sufixo}`] } }
    );
    const mini = mapaFalso(
        [{ id: 'points', source: idPontos }],
        { [idPontos]: { type: 'vector', tiles: [`${ORIGEM}${TEMPLATE}${sufixo}`] } }
    );

    controle.map = mapa;
    controle.miniMap = mini;
    controle._linesAtlasId = atlas;
    controle._pointsAtlasId = atlas;
    // A assinatura de verdade, pelo `onAdd`, e nao um `on()` escrito a mao aqui: o que este
    // arquivo prende e que o controle ESCUTA o anuncio que o sync ja emite.
    controle.onAdd(mapa);
    return { controle, mapa, mini, idLinhas, idPontos };
}

describe('o controle do 360 reage a troca do atlas em foco', () => {
    beforeEach(() => {
        barramento.limpa();
        resetResourceScope();
    });

    afterEach(() => {
        resetResourceScope();
    });

    it('assina ATLAS_SETTINGS_CHANGED no onAdd e larga no onRemove', () => {
        const { controle } = controleComFontesEm(ATLAS_A);
        expect(barramento.conta(EventTypes.ATLAS_SETTINGS_CHANGED)).toBe(1);
        controle.onRemove();
        expect(barramento.conta(EventTypes.ATLAS_SETTINGS_CHANGED)).toBe(0);
    });

    it('ENTRAR num atlas carimba o atlasId nas duas fontes de tile', () => {
        const { mapa, mini, idLinhas, idPontos } = controleComFontesEm(null);
        expect(mapa.estado.fontes[idLinhas].tiles[0]).not.toContain('atlasId');

        setResourceScope(resourceScopeKey('u-1', ATLAS_A));
        barramento.emit(EventTypes.ATLAS_SETTINGS_CHANGED, { settings: {} });

        expect(mapa.estado.fontes[idLinhas].tiles[0]).toBe(`${ORIGEM}${TEMPLATE}?atlasId=${ATLAS_A}`);
        expect(mini.estado.fontes[idPontos].tiles[0]).toBe(`${ORIGEM}${TEMPLATE}?atlasId=${ATLAS_A}`);
    });

    it('TROCAR de atlas remove a fonte antes de recria-la (o caso que reprova o preguicoso)', () => {
        const { mapa, mini, idLinhas, idPontos } = controleComFontesEm(ATLAS_A);

        setResourceScope(resourceScopeKey('u-1', ATLAS_B));
        barramento.emit(EventTypes.ATLAS_SETTINGS_CHANGED, { settings: {} });

        // A demolicao, e nao um `setTiles()`: e o `removeSource` que joga fora o TileManager
        // com os tiles do atlas A ja carregados.
        expect(mapa.estado.historico).toContain(`removeSource:${idLinhas}`);
        expect(mapa.estado.historico.indexOf(`removeSource:${idLinhas}`))
            .toBeLessThan(mapa.estado.historico.indexOf(`addSource:${idLinhas}`));
        expect(mini.estado.historico).toContain(`removeSource:${idPontos}`);

        for (const [estado, id] of [[mapa.estado, idLinhas], [mini.estado, idPontos]]) {
            expect(estado.fontes[id].tiles[0]).toContain(ATLAS_B);
            expect(estado.fontes[id].tiles[0]).not.toContain(ATLAS_A);
        }
        // E a camada volta, senao o conserto seria uma camada apagada.
        expect(mapa.estado.camadas.map((c) => c.id)).toContain('street-view-lines');
        expect(mini.estado.camadas.map((c) => c.id)).toContain('points');
    });

    it('SAIR do atlas devolve a URL de hoje, sem parametro nenhum', () => {
        const { mapa, mini, idLinhas, idPontos } = controleComFontesEm(ATLAS_A);

        resetResourceScope(); // o que `clearVisibleResources()` faz no `disconnect`
        barramento.emit(EventTypes.ATLAS_SETTINGS_CHANGED, { settings: null });

        expect(mapa.estado.fontes[idLinhas].tiles).toEqual([`${ORIGEM}${TEMPLATE}`]);
        expect(mini.estado.fontes[idPontos].tiles).toEqual([`${ORIGEM}${TEMPLATE}`]);
    });

    it('anuncio SEM troca de atlas nao derruba fonte nenhuma', () => {
        const { mapa, mini } = controleComFontesEm(ATLAS_A);
        // `ATLAS_SETTINGS_CHANGED` tambem sai quando uma concessao muda no MESMO atlas.
        // O gatilho e a comparacao do carimbo, nao o evento.
        barramento.emit(EventTypes.ATLAS_SETTINGS_CHANGED, { reason: 'atlas_resources' });
        barramento.emit(EventTypes.ATLAS_SETTINGS_CHANGED, { reason: 'granted_resources' });
        expect(mapa.estado.historico).toEqual([]);
        expect(mini.estado.historico).toEqual([]);
    });

    it('loadData cria a fonte JA carimbada e grava o escopo que a criou', async () => {
        setResourceScope(resourceScopeKey('u-1', ATLAS_A));
        const controle = new AddStreetViewControl({});
        const idLinhas = controle.streetViewLinesLayer['source'];
        const mapa = mapaFalso([{ id: 'basemap', source: 'osm' }], { osm: {} });
        controle.miniMap = mapaFalso([], {});
        controle.onAdd(mapa);
        controle.map = mapa;

        // O caminho de producao, e nao o carimbo posto a mao pelo ajudante acima.
        await controle.loadData();

        expect(mapa.estado.fontes[idLinhas].tiles).toEqual([`${ORIGEM}${TEMPLATE}?atlasId=${ATLAS_A}`]);
        expect(controle._linesAtlasId).toBe(ATLAS_A);

        // E a troca subsequente e detectada a partir desse carimbo.
        setResourceScope(resourceScopeKey('u-1', ATLAS_B));
        barramento.emit(EventTypes.ATLAS_SETTINGS_CHANGED, { settings: {} });
        expect(mapa.estado.historico).toContain(`removeSource:${idLinhas}`);
        expect(mapa.estado.fontes[idLinhas].tiles[0]).toContain(ATLAS_B);
    });

    it('sem a fonte no mapa (ferramenta nunca ativada) o anuncio nao e erro', () => {
        setResourceScope(resourceScopeKey('u-1', null));
        const controle = new AddStreetViewControl({});
        const mapa = mapaFalso([{ id: 'basemap', source: 'osm' }], { osm: {} });
        controle.onAdd(mapa);
        controle.map = mapa;

        setResourceScope(resourceScopeKey('u-1', ATLAS_A));
        expect(() => barramento.emit(EventTypes.ATLAS_SETTINGS_CHANGED, { settings: {} })).not.toThrow();
        expect(mapa.estado.historico).toEqual([]);
        // O carimbo NAO avancou: quando a ferramenta for ativada, `loadData` cria a fonte
        // ja no atlas certo, e uma troca posterior continua sendo detectada.
        expect(controle._linesAtlasId).toBe(null);
    });
});
