// Path: tests/store/store-schema-migration-v2.3.test.js
//
// A migração 2.3 é o único passo irreversível da fase dos atlas locais nomeados: ela
// promove o workspace único de hoje a um atlas chamado "Meu Atlas", registrado no banco
// global e dono de um namespace. O desenho é ZERO-CÓPIA (o slot #1 tem sufixo vazio, então
// os bancos de sempre JÁ SÃO os bancos dele), e é justamente por isso que o teste precisa
// existir: uma migração que não copia nada passa verde por acidente se alguém trocar a
// adoção por bancos novos, e o sintoma seria um usuário abrindo um atlas vazio com todo o
// seu trabalho intacto num banco que ninguém mais abre.
//
// O que este arquivo prende:
//
//   1. ROUND-TRIP com dado real de CADA side-store (feição, camada, grupo, briefing,
//      comentário, 3D, 360, notas, grade, temporal, cores, imagem, trava de mapa), lido
//      DEPOIS da migração por um caminho independente: monta-se o escopo à mão a partir do
//      REGISTRO persistido e lê-se pelo `LocalRepository` de verdade. Reusar o helper da
//      migração para conferir a migração é a verificação-fantasma da casa;
//   2. contagem ABSOLUTA de chaves por banco (sem perda E sem duplicata) e ausência de
//      qualquer banco sufixado: comparar a lista com ela mesma passaria com lista vazia;
//   3. o carimbo de versão fica onde `detectMigrationNeeded` lê (nome FIXO), senão a
//      cadeia inteira, inclusive o v1→v2 que CRIA atlas, re-rodaria a cada boot;
//   4. cadeia interrompida DEPOIS de v2→v2.1 para em 2.2, e não em 2.3 (é o defeito do
//      carimbo antecipado, que o bump da constante transformaria em regressão imediata);
//   5. a invariante da fase: store de origem REMOTA é DESCARTADO antes de virar atlas
//      local, nunca adotado;
//   6. o teto de 10: a migração cria atlas só quando o registro está vazio.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Fake do localforage, keyed by database name. Uma instância por banco (dois
// `createInstance` com o mesmo nome alcançam o MESMO objeto, como o IndexedDB), e clone
// estruturado na entrada e na saída: sem ele um round-trip passaria por identidade de
// referência e esconderia qualquer mutação de forma.
// ============================================================================

const { databases, instances, makeStore, resetFake } = vi.hoisted(() => {
    const databases = new Map();
    const instances = new Map();

    const clone = (v) => (v === undefined ? v : structuredClone(v));

    function makeStore({ name, storeName = null }) {
        const key = storeName ? `${name}::${storeName}` : name;
        if (instances.has(key)) return instances.get(key);

        const backing = databases.get(key) ?? new Map();
        databases.set(key, backing);

        const instance = {
            __dbName: key,
            __backing: backing,
            setItem: vi.fn(async (k, v) => { backing.set(k, clone(v)); return v; }),
            getItem: vi.fn(async (k) => (backing.has(k) ? clone(backing.get(k)) : null)),
            removeItem: vi.fn(async (k) => { backing.delete(k); }),
            keys: vi.fn(async () => [...backing.keys()]),
            clear: vi.fn(async () => { backing.clear(); }),
            iterate: vi.fn(async (cb) => { for (const [k, v] of backing) cb(clone(v), k); })
        };
        instances.set(key, instance);
        return instance;
    }

    return {
        databases,
        instances,
        makeStore,
        resetFake: () => { databases.clear(); instances.clear(); }
    };
});

vi.mock('localforage', () => ({
    default: {
        createInstance: vi.fn((options) => makeStore(options)),
        dropInstance: vi.fn(async ({ name }) => { databases.delete(name); instances.delete(name); })
    }
}));

// `generateUUID` determinístico; `isValidUUID` REAL (o repositório decide por ele se uma
// chave de mapa é id ou nome, e um mock que devolve `true` sempre faria a leitura por nome
// passar por outro caminho que não o do app).
const { uuidCounter } = vi.hoisted(() => ({ uuidCounter: { value: 0 } }));

vi.mock('../../src/js/utilities/uuid.js', () => ({
    generateUUID: vi.fn(() => {
        uuidCounter.value += 1;
        return `00000000-0000-4000-8000-${String(uuidCounter.value).padStart(12, '0')}`;
    }),
    isValidUUID: vi.fn((v) => typeof v === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)),
    isLegacyId: vi.fn(() => false),
    isValidId: vi.fn(() => true)
}));

// ============================================================================
// Helpers
// ============================================================================

const MAP_A = 'Principal';
const MAP_B = 'Operações';
const BRIEFING_ID = 'briefing-alfa';
const IMAGE_ID = 'img-alfa';

/** Bancos por atlas do layout pré-namespace (os dez `perAtlas` com sufixo vazio). */
const LEGACY_DATABASES = [
    'ebgeo_atlas',
    'ebgeo_maps',
    'ebgeo_images',
    'ebgeo_app_settings',
    'ebgeo_groups',
    'ebgeo_layers',
    'ebgeo_cesium3d',
    'ebgeo_streetview360',
    'ebgeo_briefings',
    'ebgeo_comments'
];

/** Escreve direto no fake, sem passar por nada do código sob teste. */
function raw(dbName) {
    return makeStore({ name: dbName });
}

/** Carrega a cadeia num grafo de módulos NOVO (a fábrica e o registro têm estado de módulo). */
async function loadModules() {
    vi.resetModules();
    const [service, namespace, api, local, entity, origin] = await Promise.all([
        import('../../src/js/store/migration/migration.service.js'),
        import('../../src/js/store/atlas-namespace.js'),
        import('../../src/js/store/local-atlas.api.js'),
        import('../../src/js/store/repositories/local.repository.js'),
        import('../../src/js/store/atlas/atlas.entity.js'),
        import('../../src/js/store/store-origin.js')
    ]);
    return { service, namespace, api, local, entity, origin };
}

const point = (id, extra = {}) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [-43.17, -22.90] },
    properties: {
        id, source: 'point', nome: `Ponto ${id}`, layerId: 'default',
        sizeCreatedAtZoom: 12, attributes: {}, images: [],
        sync: { createdAt: 1, updatedAt: 1, version: 1 },
        ...extra
    }
});

const line = (id) => ({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [[-43.17, -22.90], [-43.18, -22.91]] },
    properties: {
        id, source: 'line', nome: `Linha ${id}`, layerId: 'camada-2',
        attributes: {}, images: [], sync: { createdAt: 1, updatedAt: 1, version: 1 }
    }
});

/**
 * Semeia um repositório REAL no formato pré-namespace (v2.2), com dado em todos os dez
 * bancos por atlas. Escreve pelo fake, nunca pelo repositório: a semente não pode depender
 * do código que a migração vai exercitar.
 */
async function seedLegacyRepository() {
    await raw('ebgeo_atlas').setItem('current_atlas', {
        id: 'atlas-antigo',
        name: 'Meu Atlas',
        sync: { createdAt: 1, updatedAt: 2, version: 3, ownerId: null, dirty: true, deleted: false },
        schemaVersion: '2.2',
        mapOrder: [MAP_A, MAP_B],
        lastActiveMapId: MAP_A,
        settings: { terrainExaggeration: 2.5 }
    });

    await raw('ebgeo_maps').setItem(MAP_A, {
        id: 'mapa-a', name: MAP_A, baseLayer: 'carta-topografica',
        features: {
            points: [point('p1'), point('p2', { temporalInicio: 1000, temporalFim: 2000 })],
            lines: [line('l1')],
            military_symbols: [],
            polygons: []
        },
        zoom: 12, center_lat: -22.9, center_long: -43.17
    });
    await raw('ebgeo_maps').setItem(MAP_B, {
        id: 'mapa-b', name: MAP_B, baseLayer: 'osm',
        features: { points: [point('p3')], lines: [], military_symbols: [], polygons: [] }
    });

    await raw('ebgeo_layers').setItem(`layers_${MAP_A}`, [
        { id: 'default', nome: 'Camada Padrão', visivel: true, bloqueado: false },
        { id: 'camada-2', nome: 'Obstáculos', visivel: false, bloqueado: true }
    ]);
    await raw('ebgeo_layers').setItem(`activeLayer_${MAP_A}`, 'camada-2');

    await raw('ebgeo_groups').setItem(MAP_A, {
        'grupo-1': { id: 'grupo-1', nome: 'Pelotão Alfa', features: [{ id: 'p1', type: 'points' }] }
    });

    await raw('ebgeo_cesium3d').setItem(`cesium3d_${MAP_A}`, {
        models: [{ id: 'modelo-1', nome: 'Torre', modelId: 'tileset-x' }],
        markers: [{ id: 'marcador-1', lng: -43.1, lat: -22.9 }],
        cameraPositions: [{ id: 'cam-1', nome: 'Vista sul' }]
    });

    await raw('ebgeo_streetview360').setItem(`streetview360_${MAP_A}`, {
        panoramas: [{ id: 'pano-1', nome: 'Entrada', andar: 0 }],
        markers: [{ id: 'alvo-1', nome: 'Portão' }]
    });

    await raw('ebgeo_briefings').setItem(BRIEFING_ID, {
        id: BRIEFING_ID, nome: 'Briefing Alfa', createdAt: 10, updatedAt: 20,
        slides: [{ id: 'slide-1', titulo: 'Situação', html: '<p>Texto</p>' }]
    });

    await raw('ebgeo_comments').setItem(`comments_${MAP_A}`, {
        'c-1': { id: 'c-1', texto: 'Verificar acesso', parentId: null, resolved: false },
        'c-2': { id: 'c-2', texto: 'Confirmado', parentId: 'c-1', resolved: false }
    });

    await raw('ebgeo_images').setItem(IMAGE_ID, new Blob(['conteudo-da-imagem'], { type: 'image/png' }));

    const app = raw('ebgeo_app_settings');
    await app.setItem('schemaVersion', '2.2');
    await app.setItem('lastActiveMap', MAP_A);
    await app.setItem('mapOrder', [MAP_A, MAP_B]);
    await app.setItem(`color_usage_${MAP_A}`, { '#ff0000': 3, '#00ff00': 1 });
    await app.setItem(`map_notes_${MAP_A}`, { title: 'Nota do mapa', description: 'Descrição com acento' });
    await app.setItem(`gridStyle_${MAP_A}`, { color: '#123456', width: 2, opacity: 0.5 });
    await app.setItem(`temporal_${MAP_A}`, {
        ativo: true, modo: 'relativo', unidade: 'hora', inicio: 1000, fim: 5000, origem: 900
    });
    await app.setItem(`mapLocked_${MAP_A}`, true);
}

/** Chaves semeadas por banco, para a asserção ABSOLUTA de "sem perda e sem duplicata". */
const SEEDED_KEYS = {
    ebgeo_atlas: ['current_atlas'],
    ebgeo_maps: [MAP_A, MAP_B],
    ebgeo_layers: [`layers_${MAP_A}`, `activeLayer_${MAP_A}`],
    ebgeo_groups: [MAP_A],
    ebgeo_cesium3d: [`cesium3d_${MAP_A}`],
    ebgeo_streetview360: [`streetview360_${MAP_A}`],
    ebgeo_briefings: [BRIEFING_ID],
    ebgeo_comments: [`comments_${MAP_A}`],
    ebgeo_images: [IMAGE_ID],
    ebgeo_app_settings: [
        'schemaVersion', 'lastActiveMap', 'mapOrder',
        `color_usage_${MAP_A}`, `map_notes_${MAP_A}`, `gridStyle_${MAP_A}`,
        `temporal_${MAP_A}`, `mapLocked_${MAP_A}`
    ]
};

/**
 * Caminho INDEPENDENTE de leitura: lê o registro persistido, monta o escopo à mão
 * (`localScope(entry.id, entry.dbSuffix)`, sem usar `scopeOfLocalAtlas`, que é o helper da
 * própria migração), ativa e devolve um `LocalRepository` de verdade.
 */
async function openSlotFromRegistry(mods) {
    const registry = await raw('ebgeo_global').getItem('local_atlases');
    const pointer = await raw('ebgeo_global').getItem('current_local_atlas');
    const entry = registry.atlases.find(e => e.id === pointer);
    mods.namespace.activateScope(mods.namespace.localScope(entry.id, entry.dbSuffix));
    return { entry, registry, repo: new mods.local.LocalRepository() };
}

beforeEach(() => {
    resetFake();
    uuidCounter.value = 0;
});

// ============================================================================
// Round-trip: dado real de cada side-store, lido pelo escopo do atlas registrado
// ============================================================================

describe('migração 2.3: round-trip de cada side-store', () => {
    /** @type {Awaited<ReturnType<typeof loadModules>>} */
    let mods;
    /** @type {{ entry: Object, repo: Object }} */
    let slot;

    beforeEach(async () => {
        await seedLegacyRepository();
        mods = await loadModules();
        await mods.service.safelyMigrate();
        slot = await openSlotFromRegistry(mods);
    });

    it('o registro descreve UM atlas "Meu Atlas" que adota os bancos pré-namespace', async () => {
        expect(slot.registry.atlases).toHaveLength(1);
        expect(slot.entry.name).toBe('Meu Atlas');
        expect(slot.entry.dbSuffix).toBe(mods.namespace.LEGACY_DB_SUFFIX);

        // A afirmação zero-cópia, em nome absoluto: o escopo do atlas registrado resolve
        // EXATAMENTE para os bancos que a semente escreveu.
        const scope = mods.namespace.localScope(slot.entry.id, slot.entry.dbSuffix);
        expect(mods.namespace.resolveDbName(mods.namespace.StoreName.MAPS, scope)).toBe('ebgeo_maps');
        expect(mods.namespace.resolveDbName(mods.namespace.StoreName.IMAGES, scope)).toBe('ebgeo_images');
    });

    it('atlas: mapOrder, lastActiveMapId, id e settings preservados, nome alinhado ao registro', async () => {
        const atlas = await slot.repo.getAtlas();
        expect(atlas.id).toBe('atlas-antigo');
        expect(atlas.name).toBe('Meu Atlas');
        expect(atlas.mapOrder).toEqual([MAP_A, MAP_B]);
        expect(atlas.lastActiveMapId).toBe(MAP_A);
        expect(atlas.settings).toEqual({ terrainExaggeration: 2.5 });
        expect(atlas.sync.version).toBe(3);
        expect(atlas.schemaVersion).toBe('2.3');
    });

    it('feições: os dois mapas e todas as feições, com propriedades intactas', async () => {
        const ids = await slot.repo.getAllMapIds();
        expect(ids.sort()).toEqual([MAP_A, MAP_B].sort());

        const mapa = await slot.repo.getMap(MAP_A);
        expect(mapa.features.points).toHaveLength(2);
        expect(mapa.features.lines).toHaveLength(1);
        expect(mapa.features.points.map(f => f.properties.id)).toEqual(['p1', 'p2']);
        expect(mapa.features.points[1].properties.temporalInicio).toBe(1000);
        expect(mapa.features.points[1].properties.temporalFim).toBe(2000);
        expect(mapa.features.points[0].geometry.coordinates).toEqual([-43.17, -22.90]);
        expect(mapa.baseLayer).toBe('carta-topografica');

        const outro = await slot.repo.getMap(MAP_B);
        expect(outro.features.points).toHaveLength(1);
        expect(outro.features.points[0].properties.id).toBe('p3');
    });

    it('camadas: as duas camadas e a camada ativa', async () => {
        const layers = await slot.repo.getLayers(MAP_A);
        expect(layers).toHaveLength(2);
        expect(layers.map(l => l.id)).toEqual(['default', 'camada-2']);
        expect(layers[1].nome).toBe('Obstáculos');
        expect(layers[1].bloqueado).toBe(true);
        expect(await slot.repo.getActiveLayerId(MAP_A)).toBe('camada-2');
    });

    it('grupos: o grupo e sua referência de feição', async () => {
        const groups = await slot.repo.getGroups(MAP_A);
        expect(Object.keys(groups)).toEqual(['grupo-1']);
        expect(groups['grupo-1'].nome).toBe('Pelotão Alfa');
        expect(groups['grupo-1'].features).toEqual([{ id: 'p1', type: 'points' }]);
    });

    it('3D: modelos, marcadores e posições de câmera', async () => {
        const data = await slot.repo.getCesium3d(MAP_A);
        expect(data.models).toHaveLength(1);
        expect(data.models[0].modelId).toBe('tileset-x');
        expect(data.markers).toHaveLength(1);
        expect(data.cameraPositions).toHaveLength(1);
    });

    it('360: panoramas e alvos', async () => {
        const data = await slot.repo.getStreetview360(MAP_A);
        expect(data.panoramas).toHaveLength(1);
        expect(data.panoramas[0].nome).toBe('Entrada');
        expect(data.markers).toHaveLength(1);
    });

    it('briefing: o briefing e seus slides', async () => {
        const briefing = await slot.repo.getBriefing(BRIEFING_ID);
        expect(briefing.nome).toBe('Briefing Alfa');
        expect(briefing.slides).toHaveLength(1);
        expect(briefing.slides[0].html).toBe('<p>Texto</p>');

        const todos = await slot.repo.getAllBriefings();
        expect(todos).toHaveLength(1);
    });

    it('comentários: a thread raiz e a resposta', async () => {
        const comments = await slot.repo.getMapComments(MAP_A);
        expect(Object.keys(comments).sort()).toEqual(['c-1', 'c-2']);
        expect(comments['c-2'].parentId).toBe('c-1');
    });

    it('imagem: o blob, com tamanho e tipo', async () => {
        const blob = await slot.repo.getImage(IMAGE_ID);
        expect(blob).toBeInstanceOf(Blob);
        expect(blob.size).toBe(new Blob(['conteudo-da-imagem']).size);
        expect(blob.type).toBe('image/png');
        expect(await slot.repo.hasImage(IMAGE_ID)).toBe(true);
    });

    it('notas, grade, temporal, cores e trava de mapa', async () => {
        expect(await slot.repo.getMapNotes(MAP_A)).toEqual({
            title: 'Nota do mapa', description: 'Descrição com acento'
        });
        expect(await slot.repo.getGridStyle(MAP_A)).toEqual({ color: '#123456', width: 2, opacity: 0.5 });
        expect(await slot.repo.getSetting(`temporal_${MAP_A}`)).toEqual({
            ativo: true, modo: 'relativo', unidade: 'hora', inicio: 1000, fim: 5000, origem: 900
        });
        expect(await slot.repo.getSetting(`color_usage_${MAP_A}`)).toEqual({ '#ff0000': 3, '#00ff00': 1 });
        expect(await slot.repo.getSetting(`mapLocked_${MAP_A}`)).toBe(true);
        expect(await slot.repo.getSetting('lastActiveMap')).toBe(MAP_A);
        expect(await slot.repo.getSetting('mapOrder')).toEqual([MAP_A, MAP_B]);
    });

    it('sem duplicata: cada banco mantém exatamente as chaves semeadas, e nenhum banco sufixado nasce', async () => {
        // Contagem primeiro, conjunto depois: conferir subconjunto e tratar como conjunto é
        // a armadilha registrada na constituição.
        for (const [dbName, keys] of Object.entries(SEEDED_KEYS)) {
            const found = await raw(dbName).keys();
            expect(`${dbName}:${found.length}`).toBe(`${dbName}:${keys.length}`);
            expect(found.sort()).toEqual([...keys].sort());
        }

        // A migração não copia: nenhum banco por atlas sufixado pode ter aparecido.
        const suffixed = [...databases.keys()].filter(n => n.includes('__') && n !== 'ebgeo_global');
        expect(suffixed).toEqual([]);

        // E os bancos globais existem, nominalmente (o registro mora num deles).
        expect(databases.has('ebgeo_global')).toBe(true);
    });
});

// ============================================================================
// Carimbo de versão e encadeamento
// ============================================================================

describe('migração 2.3: carimbo e encadeamento', () => {
    it('carimba 2.3 onde detectMigrationNeeded lê (nome FIXO), fechando a detecção', async () => {
        await seedLegacyRepository();
        const mods = await loadModules();

        await mods.service.safelyMigrate();

        expect(await raw('ebgeo_app_settings').getItem('schemaVersion')).toBe('2.3');
        expect((await raw('ebgeo_atlas').getItem('current_atlas')).schemaVersion).toBe('2.3');
        expect(mods.entity.ATLAS_SCHEMA_VERSION).toBe('2.3');

        const detected = await mods.service.detectMigrationNeeded();
        expect(detected.needed).toBe(false);
        expect(detected.targetVersion).toBe('2.3');
    });

    it('é idempotente: rodar de novo não cria um segundo atlas nem reescreve dado', async () => {
        await seedLegacyRepository();
        const mods = await loadModules();
        await mods.service.safelyMigrate();

        const antes = await raw('ebgeo_global').getItem('local_atlases');
        expect(antes.atlases).toHaveLength(1);

        // Segundo boot: módulos novos, mesmo disco.
        const mods2 = await loadModules();
        await mods2.service.safelyMigrate();
        const depois = await raw('ebgeo_global').getItem('local_atlases');

        expect(depois.atlases).toHaveLength(1);
        expect(depois.atlases[0].id).toBe(antes.atlases[0].id);
        expect(depois.atlases[0].dbSuffix).toBe(antes.atlases[0].dbSuffix);

        // E o dado continua onde estava.
        const slot = await openSlotFromRegistry(mods2);
        expect((await slot.repo.getMap(MAP_A)).features.points).toHaveLength(2);
    });

    it('um workspace local com nome próprio é registrado com ELE, não renomeado para "Meu Atlas"', async () => {
        // O caso do dono ("vira Meu Atlas") é o normal, porque todo registro local nasce com
        // esse nome; o que não pode acontecer é a migração renomear o que já tinha outro,
        // numa fase cuja restrição é não mudar comportamento visível.
        await seedLegacyRepository();
        const atlas = await raw('ebgeo_atlas').getItem('current_atlas');
        await raw('ebgeo_atlas').setItem('current_atlas', { ...atlas, name: 'Exercício Guararapes' });

        const mods = await loadModules();
        await mods.service.safelyMigrate();

        const registry = await raw('ebgeo_global').getItem('local_atlases');
        expect(registry.atlases[0].name).toBe('Exercício Guararapes');
        expect((await raw('ebgeo_atlas').getItem('current_atlas')).name).toBe('Exercício Guararapes');
    });

    it('roda a cadeia inteira a partir de um repositório v1.x e termina com registro + 2.3', async () => {
        await raw('ebgeo_maps').setItem('Cidade', {
            features: { points: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { id: 'f1', layerId: 'default' } }] }
        });
        await raw('ebgeo_app_settings').setItem('schemaVersion', '1.3');

        const mods = await loadModules();
        await mods.service.safelyMigrate();

        const registry = await raw('ebgeo_global').getItem('local_atlases');
        expect(registry.atlases).toHaveLength(1);
        expect(registry.atlases[0].name).toBe('Meu Atlas');
        expect(await raw('ebgeo_app_settings').getItem('schemaVersion')).toBe('2.3');

        // O backfill do degrau 2.1 continua acontecendo (a cadeia não foi curto-circuitada).
        const mapa = await raw('ebgeo_maps').getItem('Cidade');
        expect(mapa.features.points[0].properties.sizeCreatedAtZoom).toBe(10);
    });

    it('cadeia interrompida DENTRO do degrau 2.2 para em 2.1, e não em 2.3', async () => {
        // Controle direto do carimbo do degrau v2→v2.1: se ele voltar a gravar
        // ATLAS_SCHEMA_VERSION, esta interrupção deixaria o marcador em 2.3 e a migração
        // de namespacing nunca mais rodaria.
        await raw('ebgeo_maps').setItem('Cidade', {
            features: { points: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { id: 'f1', layerId: 'default' } }] }
        });
        await raw('ebgeo_app_settings').setItem('schemaVersion', '1.3');

        const app = raw('ebgeo_app_settings');
        const realSet = app.setItem.getMockImplementation();
        app.setItem.mockImplementation(async (k, v) => {
            if (k === 'schemaVersion' && v === '2.2') throw new Error('quota exceeded');
            return realSet(k, v);
        });

        const mods = await loadModules();
        await expect(mods.service.safelyMigrate()).rejects.toThrow('quota exceeded');

        expect(await raw('ebgeo_app_settings').getItem('schemaVersion')).toBe('2.1');
        expect(await raw('ebgeo_global').getItem('local_atlases')).toBeNull();
        expect((await mods.service.detectMigrationNeeded()).needed).toBe(true);

        app.setItem.mockImplementation(realSet);
        const mods2 = await loadModules();
        await mods2.service.safelyMigrate();
        expect(await raw('ebgeo_app_settings').getItem('schemaVersion')).toBe('2.3');
        expect((await raw('ebgeo_global').getItem('local_atlases')).atlases).toHaveLength(1);
    });

    it('cadeia interrompida DEPOIS de v2→v2.1 para em 2.2, e não em 2.3', async () => {
        // Este é o defeito do carimbo antecipado: enquanto os degraus intermediários
        // gravavam ATLAS_SCHEMA_VERSION, o bump da constante para 2.3 fazia o degrau 2.1
        // declarar 2.3, e uma interrupção antes da 2.3 marcava o banco como migrado para
        // sempre — o registro de atlas locais nunca nasceria, sem um único erro.
        await raw('ebgeo_maps').setItem('Cidade', {
            features: { points: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { id: 'f1', layerId: 'default' } }] }
        });
        await raw('ebgeo_app_settings').setItem('schemaVersion', '1.3');

        // Quebra o degrau 2.3 na primeira escrita do banco global (persistRegistry).
        const globalStore = raw('ebgeo_global');
        const realSet = globalStore.setItem.getMockImplementation();
        globalStore.setItem.mockRejectedValueOnce(new Error('quota exceeded'));

        const mods = await loadModules();
        await expect(mods.service.safelyMigrate()).rejects.toThrow('quota exceeded');

        expect(await raw('ebgeo_app_settings').getItem('schemaVersion')).toBe('2.2');
        expect((await raw('ebgeo_atlas').getItem('current_atlas')).schemaVersion).toBe('2.2');
        expect(await raw('ebgeo_global').getItem('local_atlases')).toBeNull();

        // O boot seguinte ainda sabe que há trabalho, e o completa.
        globalStore.setItem.mockImplementation(realSet);
        const mods2 = await loadModules();
        expect((await mods2.service.detectMigrationNeeded()).needed).toBe(true);
        await mods2.service.safelyMigrate();

        expect(await raw('ebgeo_app_settings').getItem('schemaVersion')).toBe('2.3');
        expect((await raw('ebgeo_global').getItem('local_atlases')).atlases).toHaveLength(1);
    });
});

// ============================================================================
// A invariante da fase: dado remoto não vira atlas local
// ============================================================================

describe('migração 2.3: store de origem REMOTA', () => {
    it('descarta o atlas de servidor em vez de adotá-lo, e volta a marcar o store LOCAL', async () => {
        await seedLegacyRepository();
        // Marcador no lugar pré-namespace, que é onde ele está para quem já usa o app.
        await raw('ebgeo_app_settings').setItem('__store_origin__', { kind: 'remote', atlasId: 'atlas-do-servidor' });

        const mods = await loadModules();
        await mods.service.safelyMigrate();

        // Os DEZ bancos por atlas ficaram vazios: nenhuma cópia editável do atlas de
        // servidor sobrevive para o usuário deslogado encontrar.
        expect(LEGACY_DATABASES).toHaveLength(10);
        for (const dbName of LEGACY_DATABASES) {
            const keys = await raw(dbName).keys();
            const inertes = keys.filter(k => k !== 'schemaVersion');
            expect(`${dbName}:${inertes.length}`).toBe(`${dbName}:0`);
        }

        // O marcador global diz LOCAL, e o slot existe e está vazio, pronto para uso.
        expect(await raw('ebgeo_global').getItem('__store_origin__')).toEqual({ kind: 'local', atlasId: null });
        const registry = await raw('ebgeo_global').getItem('local_atlases');
        expect(registry.atlases).toHaveLength(1);
        expect(registry.atlases[0].dbSuffix).toBe('');
    });

    it('o atlas de servidor descartado NÃO empresta o nome dele ao atlas local', async () => {
        await seedLegacyRepository();
        await raw('ebgeo_atlas').setItem('current_atlas', {
            id: 'atlas-do-servidor', name: '2ª Bda C Mec — Operação Cerrado',
            sync: { createdAt: 1, updatedAt: 1, version: 1 },
            schemaVersion: '2.2', mapOrder: [], lastActiveMapId: null
        });
        await raw('ebgeo_app_settings').setItem('__store_origin__', { kind: 'remote', atlasId: 'atlas-do-servidor' });

        const mods = await loadModules();
        await mods.service.safelyMigrate();

        const registry = await raw('ebgeo_global').getItem('local_atlases');
        expect(registry.atlases[0].name).toBe(mods.api.DEFAULT_LOCAL_ATLAS_NAME);
        expect(registry.atlases[0].name).toBe('Meu Atlas');
    });

    it('a fila de saída (global) NÃO é tocada pelo descarte', async () => {
        await seedLegacyRepository();
        await raw('ebgeo_app_settings').setItem('__store_origin__', { kind: 'remote', atlasId: 'atlas-do-servidor' });
        const queue = makeStore({ name: 'ebgeo', storeName: 'operation_queue' });
        await queue.setItem('op-1', { id: 'op-1', type: 'feature.create' });

        const mods = await loadModules();
        await mods.service.safelyMigrate();

        expect(await queue.keys()).toEqual(['op-1']);
    });
});

// ============================================================================
// O teto de 10
// ============================================================================

describe('migração 2.3: teto de atlas locais', () => {
    it('não cria atlas quando o registro já tem entradas, então nunca estoura o teto', async () => {
        await seedLegacyRepository();

        // Registro já cheio (dez), nenhuma delas adotando os bancos pré-namespace.
        const atlases = Array.from({ length: 10 }, (_, i) => ({
            id: `atlas-${i}`, name: `Atlas ${i}`, dbSuffix: `atlas-${i}`, createdAt: i, updatedAt: i
        }));
        await raw('ebgeo_global').setItem('local_atlases', { version: 1, atlases });
        await raw('ebgeo_global').setItem('current_local_atlas', 'atlas-3');

        const mods = await loadModules();
        expect(mods.api.MAX_LOCAL_ATLASES).toBe(10);
        await expect(mods.service.safelyMigrate()).resolves.toEqual({ success: true });

        const registry = await raw('ebgeo_global').getItem('local_atlases');
        expect(registry.atlases).toHaveLength(10);
        // Carimbou onde a detecção lê, então não re-roda a cadeia inteira a cada boot.
        expect(await raw('ebgeo_app_settings').getItem('schemaVersion')).toBe('2.3');
        // E o dado pré-namespace continua intacto (a migração não o move nem o apaga).
        expect((await raw('ebgeo_maps').keys()).sort()).toEqual([MAP_A, MAP_B].sort());
    });

    it('respeita um registro pré-existente que já adotou os bancos (bootstrap antes da migração)', async () => {
        await seedLegacyRepository();
        await raw('ebgeo_global').setItem('local_atlases', {
            version: 1,
            atlases: [{ id: 'slot-1', name: 'Meu Atlas', dbSuffix: '', createdAt: 1, updatedAt: 1 }]
        });
        await raw('ebgeo_global').setItem('current_local_atlas', 'slot-1');

        const mods = await loadModules();
        await mods.service.safelyMigrate();

        const registry = await raw('ebgeo_global').getItem('local_atlases');
        expect(registry.atlases).toHaveLength(1);
        expect(registry.atlases[0].id).toBe('slot-1');

        const slot = await openSlotFromRegistry(mods);
        expect((await slot.repo.getMap(MAP_A)).features.points).toHaveLength(2);
        expect((await slot.repo.getAtlas()).schemaVersion).toBe('2.3');
    });
});
