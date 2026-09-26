// Path: tests/store/escrita-de-conteudo-em-mapa-inexistente.repro.test.js
//
// REPRO do ponto D2: ESCREVER CONTEÚDO NUM MAPA QUE NÃO EXISTE CRIAVA O MAPA (o FANTASMA).
//
// ================= O DEFEITO E A CAUSA =======================================
//
// `getMapDataCompat` (`store/repositories/index.js`) responde a um mapa AUSENTE com
// `getEmptyMapData()`: um documento COMPLETO, com os vinte e dois baldes de feição e `id: null`.
// Nada nele diz "este mapa não existe". Quem lê, muta e grava de volta cai em
// `LocalRepository.saveMap`, cujo `_resolveMapKey` devolve o PRÓPRIO NOME quando não resolve nada:
// nasce um registro cuja CHAVE e cujo `id` são o NOME. É o mapa FANTASMA.
//
// Em atlas de SERVIDOR o prejuízo é duplo e calado. O registro não corresponde a mapa nenhum do
// servidor, e a operação que o gesto enfileira sai com contexto de mapa que não é UUID, então o
// anti-vazamento a descarta ANTES do envio: o gesto é aceito na tela e jogado fora, sem um erro em
// lugar nenhum. Medido em 2026-09-21 no caminho do rename remoto (ver o cabeçalho de
// `applyRemoteMapRename`, `store/map.operations.js`): depois de um par renomear o mapa, a feição
// desenhada por este cliente ia parar num registro sob o nome VELHO, de onde a op nunca saiu.
//
// `addFeature` lia por `getMapDataCompat(targetMap)` DENTRO da transação e não tinha guarda
// nenhuma; o mesmo valia para `addFeatures` e para todo o resto de `feature.operations.js`.
//
// ================= O QUE MUDOU ===============================================
//
// `getExistingMapData` (`store/repositories/index.js`) é a leitura ESTRITA irmã: devolve o
// documento ou `null`, sem fabricar. `store/mapa-inexistente.js` é o ajudante único que a
// consulta e decide: em atlas de SERVIDOR o `null` vira recusa ESPERADA
// (`STORE_OPERATION_BLOCKED` com `reason: 'map_missing'`, `return` sem lançar); em atlas LOCAL ele
// cai no documento fabricado de sempre, porque ali um mapa chaveado por NOME é legítimo por
// desenho (o porquê por extenso está no cabeçalho daquele arquivo).
//
// A pergunta é a TERCEIRA: papel e trava continuam sendo perguntados antes, pelo `guardWrite`,
// porque um gesto merece UMA recusa e a primeira razão verdadeira é a que a pessoa precisa ler.
//
// ================= POR QUE ESTE DUPLO DE REPOSITÓRIO, E NÃO UM `vi.fn` MAGRO =
//
// O duplo abaixo reproduz as TRÊS peças reais do mecanismo, e sem as três o defeito não acontece:
// a leitura por chave OU por nome (`LocalRepository.getMap`), a fabricação do documento vazio
// (`getMapDataCompat`) e a queda de `_resolveMapKey` para o NOME dentro de `saveMap`, que é quem
// crava a chave. Um duplo que devolvesse `null` na leitura tolerante mediria um produto que não
// existe: foi exatamente assim que o caso "throws when target map does not exist" de
// `tests/store/move-features-map.test.js` passou verde durante meses sobre um `throw` que era
// código morto no código real.
//
// O restante é o módulo de verdade: `feature.operations.js`, `mapa-inexistente.js`,
// `store-transaction.js`, `document-lock.js` e `store-errors.js` entram inteiros, porque o defeito
// é de FIAÇÃO (qual leitura cada escrita faz) e um duplo do ajudante mediria a cópia dele.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    getEmptyCesium3dData,
    getEmptyMapData,
    getEmptyStreetview360Data
} from '../../src/js/store/repository.utils.js';

// ============================================================================
// Estado compartilhado
// ============================================================================

const h = vi.hoisted(() => ({
    /** O "disco": chave de armazenamento -> documento de mapa. */
    mapas: new Map(),
    /** O store LATERAL de 3D: chave `cesium3d_<chave resolvida>` -> documento. */
    laterais3d: new Map(),
    /** O store LATERAL de 360: chave `streetview360_<chave resolvida>` -> documento. */
    laterais360: new Map(),
    /** Uma entrada por chamada de `persistOperationIntents` (um lote lógico).
     *  NOS GESTOS DE 3D E 360 A ASSERÇÃO É SOBRE `intencoes.flat()`: a pergunta de existência mora
     *  DENTRO da transação (para ficar sob o carimbo de escopo), então a recusa abre a transação e
     *  registra um lote VAZIO. O que o caso cobra é que NENHUMA intenção nasceu, e não que a porta
     *  do diário ficou intocada, que é o custo declarado do desenho. */
    intencoes: [],
    /** O escopo ATIVO, trocado caso a caso. Identidade estável: `store-transaction` compara por `!==`. */
    escopo: { atual: null },
    escopos: {
        local: Object.freeze({ kind: 'local', atlasId: 'slot-1', dbSuffix: 'slot-1' }),
        remoto: Object.freeze({ kind: 'remote', atlasId: 'atlas-1', dbSuffix: 'remote-atlas-1' })
    },
    mapManager: {
        getCurrentMapName: vi.fn(() => 'Mapa que sumiu'),
        getCurrentMapId: vi.fn(() => 'uuid-corrente'),
        getMapId: vi.fn((nome) => `uuid-${nome}`),
        getFeatureColor: vi.fn(() => null),
        getFeatureColors: vi.fn(() => []),
        updateColorUsage: vi.fn(),
        recordAction: vi.fn()
    }
}));

// ============================================================================
// O DUPLO DE REPOSITÓRIO: as três peças do mecanismo real
// ============================================================================

vi.mock('../../src/js/store/repositories/index.js', () => {
    /** `LocalRepository.getMap`: chave direta, depois varredura por `name`/`id`. */
    const acharDocumento = (chaveOuNome) => {
        if (h.mapas.has(chaveOuNome)) return h.mapas.get(chaveOuNome);
        for (const doc of h.mapas.values()) {
            if (doc?.name === chaveOuNome || doc?.id === chaveOuNome) return doc;
        }
        return null;
    };

    /** `LocalRepository._resolveMapKey`: CAI PARA O PRÓPRIO NOME quando não resolve nada. */
    const resolverChave = (chaveOuNome) => {
        if (h.mapas.has(chaveOuNome)) return chaveOuNome;
        for (const [chave, doc] of h.mapas.entries()) {
            if (doc?.name === chaveOuNome || doc?.id === chaveOuNome) return chave;
        }
        return chaveOuNome;
    };

    // O STORE LATERAL: `LocalRepository.getCesium3d`/`saveCesium3d` e os gêmeos do 360. Eles
    // chaveiam por `_resolveMapKey` (o MESMO fallback para o nome) sob um PREFIXO, e leem
    // tolerante: ausência devolve o documento vazio. Nenhum deles toca o store de MAPAS, e é por
    // isso que o registro que eles deixam é órfão em vez de virar um cartão na aba Mapas.
    const lateral = (loja, prefixo, vazio) => ({
        ler: async (chaveOuNome) => loja.get(`${prefixo}${resolverChave(chaveOuNome)}`) ?? vazio(),
        gravar: async (chaveOuNome, dados) => {
            loja.set(`${prefixo}${resolverChave(chaveOuNome)}`, dados);
        }
    });
    const tresD = lateral(h.laterais3d, 'cesium3d_', getEmptyCesium3dData);
    const trescentos = lateral(h.laterais360, 'streetview360_', getEmptyStreetview360Data);

    return {
        getExistingMapData: vi.fn(async (chaveOuNome) => acharDocumento(chaveOuNome)),
        // A tolerante É a estrita MAIS a fabricação, como no módulo real.
        getMapDataCompat: vi.fn(async (chaveOuNome) => acharDocumento(chaveOuNome) ?? getEmptyMapData()),
        // `LocalRepository.saveMap`: o `id` do registro passa a ser a CHAVE RESOLVIDA, que é o
        // nome quando nada resolveu. É esta linha que crava o fantasma.
        updateMapDataCompat: vi.fn(async (chaveOuNome, documento) => {
            const chave = resolverChave(chaveOuNome);
            h.mapas.set(chave, { ...documento, id: chave, name: documento.name || chaveOuNome });
        }),
        getLayersCompat: vi.fn(async () => []),
        getCesium3dCompat: vi.fn(tresD.ler),
        setCesium3dCompat: vi.fn(tresD.gravar),
        getStreetview360Compat: vi.fn(trescentos.ler),
        setStreetview360Compat: vi.fn(trescentos.gravar)
    };
});

// ============================================================================
// Mocks estreitos: só o que não carrega em node, e o escopo ativo
// ============================================================================

vi.mock('../../src/js/store/atlas-namespace.js', () => ({
    StoreScopeKind: Object.freeze({ LOCAL: 'local', REMOTE: 'remote' }),
    getActiveScope: () => h.escopo.atual,
    // Perguntado pela transação para saber se o escopo local é um slot RESGATADO; aqui nunca é.
    isRemoteDbSuffix: (sufixo) => typeof sufixo === 'string' && sufixo.startsWith('remote-')
}));

// O EIXO DO PAPEL E O DA TRAVA FICAM ABERTOS DE PROPÓSITO: este arquivo mede o TERCEIRO eixo, e
// um gate fechado antes dele esconderia o terceiro atrás do primeiro.
vi.mock('../../src/js/store/sync/permission-guard.js', () => ({
    checkPermission: vi.fn(() => ({ allowed: true })),
    GuardAction: {
        CREATE_FEATURE: 'EDIT',
        UPDATE_FEATURE: 'EDIT',
        DELETE_FEATURE: 'DELETE',
        CREATE_MARKER_3D: 'EDIT',
        DELETE_MARKER_3D: 'DELETE',
        CREATE_MARKER_360: 'EDIT',
        DELETE_MARKER_360: 'DELETE'
    }
}));

vi.mock('../../src/js/store/map.operations.js', () => ({
    isCurrentMapLockedSync: vi.fn(() => false)
}));

vi.mock('../../src/js/store/settings.operations.js', () => ({
    removeImage: vi.fn(async () => {})
}));

vi.mock('../../src/js/store/sync/index.js', async () => ({
    OperationType: (await import('../../src/js/store/sync/operation-types.js')).OperationType
}));

// A PORTA DO DIÁRIO. `runTransaction` a chama ANTES da função de persistência, então capturar
// aqui é o sinal de "a intenção nasceu", que é o que o servidor receberia.
vi.mock('../../src/js/store/sync/operation-dispatcher.js', () => ({
    persistOperationIntents: vi.fn(async (operations) => {
        h.intencoes.push(operations.map((op) => `${op.entityType}:${op.entityId}`));
        return async () => {};
    })
}));

vi.mock('../../src/js/store/store-state-manager.js', () => ({ default: h.mapManager }));

vi.mock('../../src/js/store/memory-store.js', () => ({
    memoryStore: {
        lockedMaps: new Set(),
        isUndoing: false,
        isRedoing: false,
        currentMap: 'Mapa que sumiu',
        // OS DOIS CACHES FICAM VAZIOS DE PROPÓSITO (`_mapName: null`): com o cache quente,
        // `getCesium3dDataWithCache` devolveria a memória e o teste mediria o cache em vez do
        // disco, que é a metade que produz a entrada órfã.
        cesium3d: { cameraPositions: {}, markers: [], measurements: [], viewsheds: [], _mapName: null },
        streetview360: { orientations: {}, markers: [], _mapName: null }
    }
}));

vi.mock('../../src/js/store/services/map-resolver.service.js', () => ({
    mapResolver: {
        isInitialized: true,
        resolveToId: vi.fn((x) => x),
        resolveToName: vi.fn((x) => x),
        // `document-lock.js` chaveia a trava por aqui; devolver o próprio nome mantém uma chave
        // por mapa, que é o que a fila FIFO precisa para serializar as escritas do mesmo mapa.
        getIdForName: vi.fn((x) => x),
        registerMap: vi.fn()
    }
}));

vi.mock('../../src/js/events', () => ({
    EventTypes: {
        LAYERS_CHANGED: 'layers:changed',
        MARKERS_3D_CHANGED: 'markers3d:changed',
        CAMERA_3D_SAVED: 'camera3d:saved',
        MARKERS_360_CHANGED: 'markers360:changed',
        ORIENTATION_360_SAVED: 'orientation360:saved'
    }
}));

// ============================================================================
// Imports reais (store-errors inclusive: o evento é observado num barramento de verdade)
// ============================================================================

import {
    addFeature,
    addFeatures,
    addFeatureSilent,
    moveFeaturesToLayer,
    stampGeneratedBitmap,
    updateFeatureProperty,
    setFeatureDependencies
} from '../../src/js/store/feature.operations.js';
import {
    addMarker,
    saveCameraPosition,
    setCesium3dDependencies
} from '../../src/js/store/cesium3d.operations.js';
import {
    addMarker360,
    saveOrientation,
    setStreetview360Dependencies
} from '../../src/js/store/streetview360.operations.js';
import { StoreErrorEvents, setStoreErrorEventBus } from '../../src/js/store/store-errors.js';

const SUMIU = 'Mapa que sumiu';
const VIVO = 'Mapa vivo';
const CHAVE_VIVA = 'a1b2c3d4-0000-4000-8000-000000000001';

/** Eventos capturados do barramento, em ordem. */
let eventos;

function feicao(id) {
    return {
        type: 'Feature',
        id,
        geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
        properties: { id, source: 'point', nome: `Ponto ${id}`, layerId: 'default' }
    };
}

/** As recusas emitidas, como pares `operação:motivo`. */
function recusas() {
    return eventos
        .filter((e) => e.type === StoreErrorEvents.STORE_OPERATION_BLOCKED)
        .map((e) => `${e.payload.operation}:${e.payload.reason}`);
}

/** As CHAVES do store de mapas, que é onde o fantasma apareceria. */
const chaves = () => [...h.mapas.keys()].sort();

/** As CHAVES dos dois stores LATERAIS, que é onde a entrada ÓRFÃ apareceria. */
const chavesLaterais = () => [...h.laterais3d.keys(), ...h.laterais360.keys()].sort();

beforeEach(() => {
    vi.clearAllMocks();
    h.mapas.clear();
    h.laterais3d.clear();
    h.laterais360.clear();
    // UM mapa vivo, chaveado por UUID como num atlas de servidor.
    h.mapas.set(CHAVE_VIVA, { ...getEmptyMapData(), id: CHAVE_VIVA, name: VIVO });
    h.intencoes.length = 0;
    h.escopo.atual = h.escopos.remoto;
    h.mapManager.getCurrentMapName.mockReturnValue(SUMIU);
    eventos = [];
    const barramento = { emit: (type, payload) => eventos.push({ type, payload }), on: vi.fn(), off: vi.fn() };
    setStoreErrorEventBus(barramento);
    setFeatureDependencies({
        eventBus: barramento,
        groupManager: { removeFeatureFromAllGroups: vi.fn(() => null) },
        layerManager: {}
    });
    setCesium3dDependencies({ eventBus: barramento });
    setStreetview360Dependencies({ eventBus: barramento });
    eventos = [];
});

// ============================================================================
// 1. Piso: o duplo de fato reproduz o mecanismo, e o caminho feliz não mudou
// ============================================================================

describe('piso: o mapa EXISTE e a escrita segue igual', () => {
    it('addFeature grava no mapa vivo, registra a intenção e não cria chave nova', async () => {
        const antes = chaves();

        const gravada = await addFeature('points', feicao('p1'), VIVO);

        expect(gravada?.properties?.id).toBe('p1');
        expect(chaves()).toEqual(antes);
        expect(h.mapas.get(CHAVE_VIVA).features.points).toHaveLength(1);
        expect(h.intencoes).toEqual([['feature:p1']]);
        expect(recusas()).toEqual([]);
    });

    it('o duplo tolerante FABRICA um documento para o mapa ausente (é o defeito, reproduzido)', async () => {
        // Sem esta afirmação os casos abaixo passariam verde num duplo que devolvesse `null` na
        // leitura tolerante, isto é, medindo um produto que não existe. Ver o cabeçalho.
        const { getMapDataCompat, getExistingMapData } =
            await import('../../src/js/store/repositories/index.js');

        expect(await getExistingMapData(SUMIU)).toBeNull();
        const fabricado = await getMapDataCompat(SUMIU);
        expect(fabricado).not.toBeNull();
        expect(Object.keys(fabricado).length).toBeGreaterThan(5);
        expect(Array.isArray(fabricado.features?.points)).toBe(true);
        // SEM IDENTIDADE, que é a única coisa que distinguia o documento fabricado de um real, e
        // distinguia mal: `Boolean(id)` e não `toBeNull`, porque existem DUAS cópias de
        // `getEmptyMapData` nesta árvore (`repositories/local.repository.js` escreve `id: null`,
        // `store/repository.utils.js` não escreve a chave) e a ausência vale nas duas.
        expect(Boolean(fabricado.id)).toBe(false);
    });
});

// ============================================================================
// 2. O defeito: atlas de SERVIDOR, mapa corrente que o disco não tem
// ============================================================================

describe('atlas de SERVIDOR com o mapa corrente ausente do disco', () => {
    it('addFeature recusa, NÃO cria registro nenhum e NÃO registra intenção', async () => {
        const antes = chaves();

        const gravada = await addFeature('points', feicao('p1'));

        // A CHAVE PRIMEIRO, de propósito: é ela o defeito, e é a mensagem que quem reverter o
        // conserto precisa ler. Afirmar o retorno antes faria o vermelho falar de outra coisa.
        expect(chaves(), 'nasceu um mapa FANTASMA sob a chave do nome').toEqual(antes);
        expect(h.mapas.has(SUMIU)).toBe(false);
        expect(h.intencoes).toEqual([]);
        expect(gravada).toBeUndefined();
        expect(recusas()).toEqual(['addFeature:map_missing']);
    });

    it('addFeatures recusa, NÃO cria registro nenhum e NÃO registra intenção', async () => {
        const antes = chaves();

        await addFeatures({ points: [feicao('p1'), feicao('p2')] });

        expect(chaves()).toEqual(antes);
        expect(h.intencoes).toEqual([]);
        expect(recusas()).toEqual(['addFeatures:map_missing']);
    });

    it('updateFeatureProperty recusa devolvendo falso, sem registro e sem intenção', async () => {
        const antes = chaves();

        await expect(updateFeatureProperty('points', 'p1', 'nome', 'Novo')).resolves.toBe(false);

        expect(chaves()).toEqual(antes);
        expect(h.intencoes).toEqual([]);
        expect(recusas()).toEqual(['updateFeatureProperty:map_missing']);
    });

    it('moveFeaturesToLayer recusa devolvendo falso, sem registro e sem intenção', async () => {
        const antes = chaves();

        await expect(moveFeaturesToLayer(['camada-velha'], 'camada-nova')).resolves.toBe(false);

        expect(chaves()).toEqual(antes);
        expect(h.intencoes).toEqual([]);
        expect(recusas()).toEqual(['moveFeaturesToLayer:map_missing']);
    });

    it('a recusa nomeia o MAPA ALVO, e um mapa vivo ao lado continua aceitando', async () => {
        // A outra metade do defeito: uma guarda que recusasse TUDO teria os casos acima verdes e
        // seria igualmente errada.
        await addFeature('points', feicao('p1'), SUMIU);
        const bloqueio = eventos.find((e) => e.type === StoreErrorEvents.STORE_OPERATION_BLOCKED);
        expect(bloqueio.payload.mapName).toBe(SUMIU);

        eventos = [];
        const gravada = await addFeature('points', feicao('p2'), VIVO);
        expect(gravada?.properties?.id).toBe('p2');
        expect(recusas()).toEqual([]);
    });
});

// ============================================================================
// 2b. O PAR LATERAL: 3D e 360 não tocam o documento do mapa, e sofrem do mesmo
// ============================================================================

describe('gestos de 3D e 360 com o mapa corrente ausente do disco', () => {
    // A DIFERENÇA QUE TORNA ESTE MEIO PIOR, e não menor: eles gravam `cesium3d_<chave>` e
    // `streetview360_<chave>`, que `_resolveMapKey` chaveia pelo MESMO nome não resolvido. Não
    // nasce cartão nenhum na aba Mapas, então o registro órfão não tem sintoma na tela; a op segue
    // com contexto que não é UUID e morre no anti-vazamento, e o marcador some no F5 seguinte sem
    // que nada tenha reclamado.

    it('o PISO: com o mapa vivo, um marcador 3D grava o lateral e registra a intenção', async () => {
        // Sem este caso os cinco abaixo passariam verdes num mundo em que o 3D não escrevesse
        // nada, e mediriam a ausência do recurso em vez da guarda.
        expect(chavesLaterais()).toEqual([]);

        const criado = await addMarker('tileset-1', { position: { x: 1 } }, VIVO);

        expect(criado?.id).toBeTruthy();
        // A CHAVE É A DO UUID, e não a do nome: é o contraste que dá sentido às entradas órfãs
        // dos casos abaixo.
        expect(chavesLaterais()).toEqual([`cesium3d_${CHAVE_VIVA}`]);
        expect(h.intencoes).toEqual([[`marker3d:${criado.id}`]]);
        expect(recusas()).toEqual([]);
    });

    it('addMarker recusa, NÃO cria entrada lateral e NÃO registra intenção', async () => {
        const criado = await addMarker('tileset-1', { position: { x: 1 } });

        expect(chavesLaterais(), 'nasceu uma entrada LATERAL órfã sob a chave do nome').toEqual([]);
        expect(h.intencoes.flat()).toEqual([]);
        // O valor de recusa é o `missing` que a própria entrada já declarava.
        expect(criado).toBeNull();
        expect(recusas()).toEqual(['addMarker:map_missing']);
    });

    it('saveCameraPosition recusa: ela é GESTO (um botão), não escrita derivada', async () => {
        // A CLASSIFICAÇÃO QUE A INTUIÇÃO ERRA. "Posição de câmera" soa a estado gravado sozinho ao
        // navegar, e nesta árvore não é: os dois únicos chamadores são o clique em "salvar-camera"
        // (`3d_models_viewer_tool/map_3d.js`) e a lixeira da aba de feições. Por isso ela FALA.
        await saveCameraPosition('tileset-1', { longitude: 1, latitude: 2, height: 3 },
            { heading: 0, pitch: 0, roll: 0 });

        expect(chavesLaterais()).toEqual([]);
        expect(h.intencoes.flat()).toEqual([]);
        expect(recusas()).toEqual(['saveCameraPosition:map_missing']);
    });

    it('addMarker360 recusa, NÃO cria entrada lateral e NÃO registra intenção', async () => {
        const criado = await addMarker360('foto-1', { position: { lon: 1, lat: 2 } });

        expect(chavesLaterais()).toEqual([]);
        expect(h.intencoes.flat()).toEqual([]);
        expect(criado).toBeNull();
        expect(recusas()).toEqual(['addMarker360:map_missing']);
    });

    it('saveOrientation recusa, e ela também é GESTO (o botão do visualizador 360)', async () => {
        await saveOrientation('foto-1', { lon: 10, lat: 20, fov: 75 });

        expect(chavesLaterais()).toEqual([]);
        expect(h.intencoes.flat()).toEqual([]);
        expect(recusas()).toEqual(['saveOrientation:map_missing']);
    });

    it('a pergunta NÃO custa uma leitura do documento em atlas LOCAL', async () => {
        // A ORDEM INVERTIDA DENTRO DE `mapExistsForGesture`, medida em vez de prometida: o escopo é
        // perguntado ANTES do disco, porque `getExistingMapData` traz o documento INTEIRO do mapa
        // (todas as feições desenhadas) para responder um sim ou não, e num atlas local a resposta
        // é sempre verdadeira. Sem esta inversão, cada marcador colocado pagaria essa leitura.
        const { getExistingMapData } = await import('../../src/js/store/repositories/index.js');
        h.escopo.atual = h.escopos.local;
        getExistingMapData.mockClear();

        await addMarker('tileset-1', { position: { x: 1 } }, VIVO);

        expect(getExistingMapData).not.toHaveBeenCalled();
        expect(chavesLaterais()).toEqual([`cesium3d_${CHAVE_VIVA}`]);
    });
});

// ============================================================================
// 3. Borda: escrita DERIVADA no mesmo estado PULA EM SILÊNCIO
// ============================================================================

describe('escrita derivada com o mapa ausente: sem registro E sem recusa', () => {
    // Medido em 2026-09-21: abrir e trocar de mapa já grava contagem de cores e ponteiro de mapa
    // corrente sem edição nenhuma. Uma recusa anunciada nesses caminhos apareceria a cada troca de
    // mapa, dizendo que algo falhou quando ninguém apertou nada.
    it('stampGeneratedBitmap devolve falso, não cria registro e não emite recusa', async () => {
        const antes = chaves();

        const carimbou = await stampGeneratedBitmap(
            { properties: { id: 'ms1', source: 'military_symbol' } },
            { width: 10, height: 10 },
            SUMIU
        );

        expect(carimbou).toBe(false);
        expect(chaves()).toEqual(antes);
        expect(recusas()).toEqual([]);
    });

    it('addFeatureSilent não cria registro e não emite recusa', async () => {
        const antes = chaves();

        await addFeatureSilent('points', feicao('p1'), SUMIU);

        expect(chaves()).toEqual(antes);
        expect(recusas()).toEqual([]);
    });
});

// ============================================================================
// 4. Atlas LOCAL: o comportamento de hoje NÃO muda (controle positivo da decisão)
// ============================================================================

describe('atlas LOCAL: um mapa chaveado por NOME é legítimo, e nada muda', () => {
    // A fronteira é a mesma de `refusesMissingRemoteMap` (`store/map.operations.js`) e da guarda
    // gêmea de `editCatalogLayers`. Sem este bloco a correção poderia ter fechado a metade local
    // do produto sem nada ficar vermelho: é ali que `addMap` grava sob o nome com o sync desligado,
    // e é ali que `mapaDeEmergencia` pode devolver um nome que o disco não tem.
    beforeEach(() => { h.escopo.atual = h.escopos.local; });

    it('addFeature continua gravando, sob a chave do NOME, sem recusa nenhuma', async () => {
        const gravada = await addFeature('points', feicao('p1'), SUMIU);

        expect(gravada?.properties?.id).toBe('p1');
        expect(h.mapas.has(SUMIU)).toBe(true);
        expect(h.mapas.get(SUMIU).features.points).toHaveLength(1);
        expect(recusas()).toEqual([]);
    });

    it('addFeatures continua gravando e registrando a intenção', async () => {
        await addFeatures({ points: [feicao('p1'), feicao('p2')] }, SUMIU);

        expect(h.mapas.get(SUMIU).features.points).toHaveLength(2);
        expect(h.intencoes).toEqual([['feature:p1', 'feature:p2']]);
        expect(recusas()).toEqual([]);
    });

    it('SEM ESCOPO ATIVO o comportamento é o do atlas local (o boot, antes de montar nada)', async () => {
        h.escopo.atual = null;

        await addFeature('points', feicao('p1'), SUMIU);

        expect(h.mapas.has(SUMIU)).toBe(true);
        expect(recusas()).toEqual([]);
    });

    it('os gestos de 3D e 360 também continuam gravando, sob a chave do NOME', async () => {
        // O controle positivo do par LATERAL. A metade local dele é a mesma decisão da de cima, e
        // sem este caso a guarda nova poderia ter fechado o 3D e o 360 do atlas local inteiro
        // (desenho de marcador, calibração, o `.ebgeo`) sem nada ficar vermelho.
        const criado = await addMarker('tileset-1', { position: { x: 1 } }, SUMIU);
        await saveOrientation('foto-1', { lon: 10, lat: 20, fov: 75 }, SUMIU);

        expect(criado?.id).toBeTruthy();
        expect(chavesLaterais()).toEqual([`cesium3d_${SUMIU}`, `streetview360_${SUMIU}`].sort());
        expect(recusas()).toEqual([]);
    });
});
