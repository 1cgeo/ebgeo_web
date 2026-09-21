// Path: tests/store/escrita-de-camada-e-grupo-em-mapa-inexistente.repro.test.js
//
// REPRO do ponto D2, a ÚLTIMA PORTA: ESCRITA DE CAMADA E DE GRUPO NUM MAPA QUE NÃO EXISTE.
//
// ================= O DEFEITO E A CAUSA =======================================
//
// `LayerManager._writeLayers` (`layers/layer.manager.js`) e `GroupManager._writeGroups`
// (`tool_manager/group_manager.js`) são os dois funis por onde passa TODA escrita de camada e de
// grupo por GESTO: criar, renomear, mostrar, travar, opacizar, reordenar e excluir camada;
// agrupar, combinar, desagrupar e alternar grupo. Os dois resolvem o mapa alvo por
// `mapResolver.resolveToId(targetMap)` e gravam um documento LATERAL (`layers_<chave>` e o
// documento de grupos), que `LocalRepository._resolveMapKey` chaveia pelo PRÓPRIO NOME quando não
// resolve nada.
//
// Em atlas de SERVIDOR o prejuízo é duplo e calado, e é o mesmo do par de 3D e 360: o registro
// lateral fica ÓRFÃO (nenhum cartão nasce na aba Mapas para denunciá-lo) e a op que o gesto
// enfileira sai com contexto de mapa que não é UUID, então o anti-vazamento a descarta ANTES do
// envio. Renomear uma camada ou agrupar duas feições num mapa que o atlas não tem mais é aceito na
// tela e jogado fora, sem um erro em lugar nenhum.
//
// Antes dos dois funis havia ainda `_ensureMapLayersExist`/`_ensureMapGroupsExist`, que FABRICAM a
// estrutura em memória de qualquer nome que lhes cheguem. Essa metade não vai para o disco, mas
// deixa `memoryStore.layers[<nome do mapa morto>]` de pé para o resto da sessão.
//
// ================= O QUE MUDOU ===============================================
//
// Os dois funis passaram a perguntar por `mapExistsForGesture(targetMap, label)`
// (`store/mapa-inexistente.js`), DENTRO da transação (para ficar sob o carimbo de escopo) e ANTES
// do `_ensure...` (senão a memória já foi fabricada quando a recusa chega). A recusa devolve uma
// persistência vazia e o funil devolve `undefined`, que é o valor que a fachada e as telas já
// tratam como "não fiz nada"; o motivo sai no `STORE_OPERATION_BLOCKED` com `reason: 'map_missing'`.
//
// Em atlas LOCAL nada muda, porque ali um mapa chaveado por NOME é legítimo por desenho. O bloco
// final é o controle positivo dessa fronteira.
//
// ================= POR QUE UM ARQUIVO IRMÃO, E NÃO O REPRO DE HOJE ===========
//
// `tests/store/escrita-de-conteudo-em-mapa-inexistente.repro.test.js` dubla
// `repositories/index.js` com a superfície do documento do mapa e dos laterais de 3D/360, e os
// módulos que ele exercita importam o repositório DIRETO. Os dois funis desta porta ficam fora de
// `src/js/store/` e alcançam o repositório pelo BARRIL (`import { setLayersRepo } from '../store'`),
// então eles precisam de um duplo do barril, do `IDUtils` e do barril de eventos, que aquele
// arquivo não tem e que dobrá-lo para ter tornaria ilegível. O "disco" aqui reproduz as mesmas três
// peças do mecanismo real: leitura por chave ou por nome, leitura tolerante do lateral (lista
// padrão / objeto vazio) e a queda de `_resolveMapKey` para o NOME na gravação.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Estado compartilhado
// ============================================================================

const h = vi.hoisted(() => ({
    /** O "disco" de MAPAS: chave de armazenamento -> documento. */
    mapas: new Map(),
    /** O lateral de CAMADAS: `layers_<chave resolvida>` -> array. */
    camadas: new Map(),
    /** O lateral de GRUPOS: `groups_<chave resolvida>` -> objeto. */
    grupos: new Map(),
    /** Uma entrada por chamada de `persistOperationIntents` (um lote lógico).
     *  A ASSERÇÃO É SOBRE `intencoes.flat()`: a pergunta mora DENTRO da transação, então a recusa
     *  abre a transação e registra um lote VAZIO. O que o caso cobra é que NENHUMA intenção nasceu,
     *  e não que a porta do diário ficou intocada, que é o custo declarado do desenho. */
    intencoes: [],
    /** O escopo ATIVO. Identidade estável: `store-transaction` compara por `!==`. */
    escopo: { atual: null },
    escopos: {
        local: Object.freeze({ kind: 'local', atlasId: 'slot-1', dbSuffix: 'slot-1' }),
        remoto: Object.freeze({ kind: 'remote', atlasId: 'atlas-1', dbSuffix: 'remote-atlas-1' })
    },
    memoryStore: {
        currentMap: 'Mapa que sumiu',
        layers: {},
        groups: {},
        activeLayerId: null
    },
    contador: { camada: 0 }
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
    h.resolverChave = resolverChave;

    return {
        getExistingMapData: vi.fn(async (chaveOuNome) => acharDocumento(chaveOuNome)),
        // A tolerante É a estrita MAIS a fabricação, como no módulo real.
        getMapDataCompat: vi.fn(async (chaveOuNome) => acharDocumento(chaveOuNome) ?? { features: {} }),
        // Os dois laterais leem TOLERANTE (lista padrão / objeto vazio) e gravam sob a chave
        // resolvida, que é o nome quando nada resolveu. São estas duas linhas que cravam o órfão.
        getLayersCompat: vi.fn(async (m) => h.camadas.get(`layers_${resolverChave(m)}`) ?? []),
        setLayersCompat: vi.fn(async (m, lista) => { h.camadas.set(`layers_${resolverChave(m)}`, lista); }),
        getGroupsCompat: vi.fn(async (m) => h.grupos.get(`groups_${resolverChave(m)}`) ?? {}),
        setGroupsCompat: vi.fn(async (m, obj) => { h.grupos.set(`groups_${resolverChave(m)}`, obj); }),
        getActiveLayerIdCompat: vi.fn(async () => 'default'),
        setActiveLayerIdCompat: vi.fn(async () => {})
    };
});

// O BARRIL DO STORE, que é por onde os dois funis alcançam o repositório. Ele DELEGA ao duplo
// acima em vez de ter um disco próprio: dois discos fariam o caso do lateral e o caso do mapa
// medirem mundos diferentes.
vi.mock('../../src/js/store/index.js', async () => {
    const repo = await import('../../src/js/store/repositories/index.js');
    return {
        memoryStore: h.memoryStore,
        setLayersRepo: repo.setLayersCompat,
        getLayersRepo: repo.getLayersCompat,
        setActiveLayerIdRepo: repo.setActiveLayerIdCompat,
        getActiveLayerIdRepo: repo.getActiveLayerIdCompat,
        setMapGroups: repo.setGroupsCompat,
        getMapGroupsFromDB: repo.getGroupsCompat,
        getDefaultLayer: () => ({
            id: 'default', name: 'Padrão', visible: true, locked: false, opacity: 1, order: 0,
            createdAt: 1, updatedAt: 1, version: 1
        }),
        // A recusa que este arquivo mede NÃO passa por aqui: ela é emitida por
        // `mapa-inexistente.js`, que importa `store-errors.js` DIRETO e fica real. O par abaixo
        // serve só ao `onError` do debounce da camada ativa, que nenhum caso dispara.
        StoreErrorEvents: { STORE_PERSIST_ERROR: 'store:persist-error' },
        emitStoreError: vi.fn()
    };
});

// ============================================================================
// Mocks estreitos: só o que não carrega em node, e o escopo ativo
// ============================================================================

vi.mock('../../src/js/store/atlas-namespace.js', () => ({
    StoreScopeKind: Object.freeze({ LOCAL: 'local', REMOTE: 'remote' }),
    getActiveScope: () => h.escopo.atual
}));

// O barril de utilitários arrastaria a store inteira pelo caminho transitivo; só `IDUtils` é lido.
vi.mock('../../src/js/utilities', () => ({
    IDUtils: {
        generateUniqueId: (prefixo) => `${prefixo}-${++h.contador.camada}`,
        generateUniqueLayerName: (lista, prefixo) => `${prefixo} ${lista.length + 1}`
    }
}));

vi.mock('../../src/js/events', () => ({
    EventTypes: { LAYERS_CHANGED: 'layers:changed', GROUPS_CHANGED: 'groups:changed' }
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

// A PORTA DO DIÁRIO. `runTransaction` a chama ANTES da função de persistência, então capturar
// aqui é o sinal de "a intenção nasceu", que é o que o servidor receberia.
vi.mock('../../src/js/store/sync/operation-dispatcher.js', () => ({
    persistOperationIntents: vi.fn(async (operations) => {
        h.intencoes.push(operations.map((op) => `${op.entityType}:${op.entityId}`));
        return async () => {};
    })
}));

// ---------------------------------------------------------------------------
// Só para o bloco de `transferLayerToMap`: as costuras que ele tem e os dois funis não.
// Nenhuma delas é alcançada quando a recusa acontece, que é justamente o ponto do caso.
// ---------------------------------------------------------------------------

vi.mock('../../src/js/store/memory-store.js', () => ({ memoryStore: h.memoryStore }));

vi.mock('../../src/js/store/store-state-manager.js', () => ({
    default: {
        getCurrentMapName: () => h.memoryStore.currentMap,
        getMapId: (nome) => nome
    }
}));

// O EIXO DO PAPEL E O DA TRAVA FICAM ABERTOS DE PROPÓSITO: este arquivo mede o TERCEIRO eixo, e
// um gate fechado antes dele esconderia o terceiro atrás do primeiro.
vi.mock('../../src/js/store/sync/permission-guard.js', () => ({
    checkPermission: vi.fn(() => ({ allowed: true })),
    GuardAction: { CREATE_FEATURE: 'EDIT', DELETE_FEATURE: 'DELETE' }
}));

vi.mock('../../src/js/store/map.operations.js', () => ({
    isCurrentMapLockedSync: vi.fn(() => false),
    isMapLocked: vi.fn(async () => false)
}));

vi.mock('../../src/js/store/settings.operations.js', () => ({
    getImage: vi.fn(async () => null),
    storeImage: vi.fn(async () => {}),
    removeImage: vi.fn(async () => {})
}));

vi.mock('../../src/js/store/upload-copied-blobs.js', () => ({
    uploadCopiedBlobsIfRemote: vi.fn(async () => {})
}));

vi.mock('../../src/js/store/feature.operations.js', () => ({
    addFeatures: vi.fn(async () => {}),
    deleteLayerFeatures: vi.fn(async () => {}),
    getLayerFeaturesByStorageType: vi.fn(async () => ({}))
}));

vi.mock('../../src/js/store/layer.operations.js', () => ({
    deleteLayerOnly: vi.fn(async () => ({ success: true }))
}));

vi.mock('../../src/js/store/sync/index.js', async () => ({
    OperationType: (await import('../../src/js/store/sync/operation-types.js')).OperationType
}));

// ============================================================================
// Imports reais (store-errors inclusive: o evento é observado num barramento de verdade)
// ============================================================================

import { createLayerManager } from '../../src/js/layers/layer.manager.js';
import { createGroupManager } from '../../src/js/tool_manager/group_manager.js';
import { StoreErrorEvents, setStoreErrorEventBus } from '../../src/js/store/store-errors.js';
import {
    transferLayerToMap,
    setLayerTransferDependencies
} from '../../src/js/store/layer-transfer.operations.js';
import { TransferMode } from '../../src/js/store/layer-transfer.model.js';
import { addFeatures } from '../../src/js/store/feature.operations.js';
import { deleteLayerOnly } from '../../src/js/store/layer.operations.js';
import { setLayersCompat } from '../../src/js/store/repositories/index.js';

const SUMIU = 'Mapa que sumiu';
const VIVO = 'Mapa vivo';
const CHAVE_VIVA = 'a1b2c3d4-0000-4000-8000-000000000001';

/** Eventos capturados do barramento, em ordem. */
let eventos;
let lm;
let gm;

/** As recusas emitidas, como pares `operação:motivo`. */
function recusas() {
    return eventos
        .filter((e) => e.type === StoreErrorEvents.STORE_OPERATION_BLOCKED)
        .map((e) => `${e.payload.operation}:${e.payload.reason}`);
}

/** As CHAVES dos dois stores LATERAIS, que é onde o registro ÓRFÃO apareceria. */
const chavesLaterais = () => [...h.camadas.keys(), ...h.grupos.keys()].sort();

/** Os nomes de mapa para os quais a MEMÓRIA tem balde fabricado. */
const memoriaFabricada = () =>
    [...Object.keys(h.memoryStore.layers), ...Object.keys(h.memoryStore.groups)].sort();

function feicao(id) {
    return { properties: { id, source: 'point' } };
}

beforeEach(() => {
    vi.clearAllMocks();
    h.mapas.clear();
    h.camadas.clear();
    h.grupos.clear();
    // UM mapa vivo, chaveado por UUID como num atlas de servidor.
    h.mapas.set(CHAVE_VIVA, { id: CHAVE_VIVA, name: VIVO, features: {} });
    h.intencoes.length = 0;
    h.escopo.atual = h.escopos.remoto;
    h.memoryStore.currentMap = SUMIU;
    h.memoryStore.layers = {};
    h.memoryStore.groups = {};
    h.memoryStore.activeLayerId = null;
    h.contador.camada = 0;
    eventos = [];
    const barramento = { emit: (type, payload) => eventos.push({ type, payload }), on: vi.fn(), off: vi.fn() };
    setStoreErrorEventBus(barramento);
    lm = createLayerManager(barramento);
    gm = createGroupManager(barramento);
    eventos = [];
});

// ============================================================================
// 1. Piso: o duplo reproduz o mecanismo, e o caminho feliz não mudou
// ============================================================================

describe('piso: o mapa EXISTE e a escrita de camada e de grupo segue igual', () => {
    it('criar camada grava o lateral sob a chave UUID e registra a intenção', async () => {
        // Sem este caso os de baixo passariam verdes num mundo em que a camada não escrevesse nada,
        // e mediriam a ausência do recurso em vez da guarda.
        expect(chavesLaterais()).toEqual([]);

        const nova = await lm.createLayer('Alfa', VIVO);

        expect(nova?.name).toBe('Alfa');
        // A CHAVE É A DO UUID, e não a do nome: é o contraste que dá sentido aos órfãos abaixo.
        expect(chavesLaterais()).toEqual([`layers_${CHAVE_VIVA}`]);
        expect(h.intencoes).toEqual([[`layer:${nova.id}`]]);
        expect(recusas()).toEqual([]);
    });

    it('criar grupo grava o lateral sob a chave UUID e registra 1 + N intenções', async () => {
        const grupo = await gm.createGroup([feicao('f1'), feicao('f2')], VIVO);

        expect(grupo?.id).toBeTruthy();
        expect(chavesLaterais()).toEqual([`groups_${CHAVE_VIVA}`]);
        // O `group` CREATE vem PRIMEIRO e os `group_feature` depois: o insert de membro no servidor
        // é gateado por um EXISTS sobre a tabela de grupos.
        expect(h.intencoes).toHaveLength(1);
        expect(h.intencoes[0][0]).toBe(`group:${grupo.id}`);
        expect(h.intencoes[0].slice(1).every((s) => s.startsWith('group_feature:'))).toBe(true);
        expect(recusas()).toEqual([]);
    });

    it('o duplo do lateral é TOLERANTE: mapa ausente lê lista vazia, sem dizer que não existe', async () => {
        // O piso do MECANISMO. Sem esta afirmação os casos abaixo passariam verdes num duplo que
        // devolvesse `null` na leitura do lateral, isto é, medindo um produto que não existe.
        const { getLayersCompat, getGroupsCompat, getExistingMapData } =
            await import('../../src/js/store/repositories/index.js');

        expect(await getExistingMapData(SUMIU)).toBeNull();
        expect(await getLayersCompat(SUMIU)).toEqual([]);
        expect(await getGroupsCompat(SUMIU)).toEqual({});
        // E a gravação cai sob a chave do NOME, que é o registro órfão.
        expect(h.resolverChave(SUMIU)).toBe(SUMIU);
    });
});

// ============================================================================
// 2. O defeito: atlas de SERVIDOR, mapa corrente que o disco não tem
// ============================================================================

describe('atlas de SERVIDOR com o mapa corrente ausente do disco', () => {
    it('criar camada recusa, NÃO cria lateral, NÃO registra intenção e NÃO fabrica memória', async () => {
        const nova = await lm.createLayer('Alfa');

        // O LATERAL PRIMEIRO, de propósito: é ele o defeito, e é a mensagem que quem reverter o
        // conserto precisa ler. Afirmar o retorno antes faria o vermelho falar de outra coisa.
        expect(chavesLaterais(), 'nasceu um lateral de CAMADAS órfão sob a chave do nome').toEqual([]);
        expect(h.intencoes.flat()).toEqual([]);
        expect(memoriaFabricada(), 'a memória ficou com o balde de um mapa que não existe').toEqual([]);
        // `undefined` é o valor que a fachada e as telas já tratam (`if (!novaCamada) return;`).
        expect(nova).toBeUndefined();
        expect(recusas()).toEqual(['createLayer:map_missing']);
    });

    it('renomear camada recusa, sem lateral, sem intenção e sem memória fabricada', async () => {
        // A borda que separa esta recusa da de "camada não encontrada": com a memória semeada, a
        // camada EXISTE do ponto de vista do funil, então o único motivo de recusa é o mapa. Sem
        // isto o caso passaria verde pelo `throw` de camada ausente, que é outra coisa.
        h.memoryStore.layers[SUMIU] = new Map([['l1', { id: 'l1', name: 'Camada l1', order: 0, version: 1 }]]);

        const renomeada = await lm.renameLayer('l1', 'Batalhão');

        expect(chavesLaterais()).toEqual([]);
        expect(h.intencoes.flat()).toEqual([]);
        expect(h.memoryStore.layers[SUMIU].get('l1').name, 'a memória mudou sem nada ter sido gravado')
            .toBe('Camada l1');
        expect(renomeada).toBeUndefined();
        // O rótulo é o do FUNIL (`updateLayer`), o mesmo que a trava de documento usa; a fachada
        // (`store/layer.operations.js`) é que fala em `renameLayer` nas recusas de papel.
        expect(recusas()).toEqual(['updateLayer:map_missing']);
    });

    it('criar grupo recusa, NÃO cria lateral, NÃO registra intenção e NÃO fabrica memória', async () => {
        const grupo = await gm.createGroup([feicao('f1'), feicao('f2')]);

        expect(chavesLaterais(), 'nasceu um lateral de GRUPOS órfão sob a chave do nome').toEqual([]);
        expect(h.intencoes.flat()).toEqual([]);
        expect(memoriaFabricada()).toEqual([]);
        expect(grupo).toBeUndefined();
        expect(recusas()).toEqual(['createGroup:map_missing']);
    });

    it('excluir camada e reordenar recusam pelo mesmo funil', async () => {
        h.memoryStore.layers[SUMIU] = new Map([
            ['l1', { id: 'l1', name: 'Camada l1', order: 0, version: 1 }],
            ['l2', { id: 'l2', name: 'Camada l2', order: 1, version: 1 }]
        ]);

        const excluida = await lm.deleteLayer('l2');
        await lm.reorderLayers(['l2', 'l1']);

        expect(chavesLaterais()).toEqual([]);
        expect(h.intencoes.flat()).toEqual([]);
        expect(excluida).toBeUndefined();
        expect(h.memoryStore.layers[SUMIU].has('l2')).toBe(true);
        expect(recusas()).toEqual(['deleteLayer:map_missing', 'reorderLayers:map_missing']);
    });

    it('a recusa nomeia o MAPA ALVO, e um mapa vivo ao lado continua aceitando', async () => {
        // A outra metade do defeito: uma guarda que recusasse TUDO teria os casos acima verdes e
        // seria igualmente errada.
        await lm.createLayer('Alfa', SUMIU);
        const bloqueio = eventos.find((e) => e.type === StoreErrorEvents.STORE_OPERATION_BLOCKED);
        expect(bloqueio.payload.mapName).toBe(SUMIU);

        eventos = [];
        const nova = await lm.createLayer('Bravo', VIVO);
        expect(nova?.name).toBe('Bravo');
        expect(recusas()).toEqual([]);
    });

    it('a pergunta NÃO custa uma leitura do documento em atlas LOCAL', async () => {
        // A ORDEM INVERTIDA DENTRO DE `mapExistsForGesture`, medida em vez de prometida: o escopo é
        // perguntado ANTES do disco, porque `getExistingMapData` traz o documento INTEIRO do mapa
        // para responder um sim ou não, e num atlas local a resposta é sempre verdadeira.
        const { getExistingMapData } = await import('../../src/js/store/repositories/index.js');
        h.escopo.atual = h.escopos.local;
        getExistingMapData.mockClear();

        await lm.createLayer('Alfa', VIVO);

        expect(getExistingMapData).not.toHaveBeenCalled();
    });
});

// ============================================================================
// 3. Atlas LOCAL: o comportamento de hoje NÃO muda (controle positivo da decisão)
// ============================================================================

describe('atlas LOCAL: um mapa chaveado por NOME é legítimo, e nada muda', () => {
    // A fronteira é a mesma do par do documento e do par de 3D/360. Sem este bloco a correção
    // poderia ter fechado a metade local do produto sem nada ficar vermelho: é ali que `addMap`
    // grava sob o nome com o sync desligado, e é ali que o boot pode devolver um nome que o disco
    // ainda não tem.
    beforeEach(() => { h.escopo.atual = h.escopos.local; });

    it('criar camada continua gravando, sob a chave do NOME, sem recusa nenhuma', async () => {
        const nova = await lm.createLayer('Alfa', SUMIU);

        expect(nova?.name).toBe('Alfa');
        // A `default` vem junto porque `_ensureMapLayersExist` semeia a camada padrão em atlas
        // LOCAL (e só nele): é exatamente a fabricação que o ramo remoto recusa, e aqui ela é o
        // caminho normal.
        expect(h.camadas.get(`layers_${SUMIU}`).map((l) => l.id)).toEqual(['default', nova.id]);
        expect(recusas()).toEqual([]);
    });

    it('criar grupo continua gravando, sob a chave do NOME, sem recusa nenhuma', async () => {
        const grupo = await gm.createGroup([feicao('f1'), feicao('f2')], SUMIU);

        expect(grupo?.id).toBeTruthy();
        expect(Object.keys(h.grupos.get(`groups_${SUMIU}`))).toEqual([grupo.id]);
        expect(recusas()).toEqual([]);
    });

    it('SEM ESCOPO ATIVO o comportamento é o do atlas local (o boot, antes de montar nada)', async () => {
        h.escopo.atual = null;

        const nova = await lm.createLayer('Alfa', SUMIU);

        expect(nova?.name).toBe('Alfa');
        expect(h.camadas.has(`layers_${SUMIU}`)).toBe(true);
        expect(recusas()).toEqual([]);
    });
});

// ============================================================================
// 4. A COMPOSTA: `transferLayerToMap` escreve o registro de camada FORA do funil
// ============================================================================

describe('transferir camada para um mapa de DESTINO que não existe', () => {
    // POR QUE ELA PRECISA DA PERGUNTA POR CONTA PRÓPRIA. A transferência é composta e escreve o
    // registro da camada de destino por `setLayersCompat` numa transação só dela, sem passar por
    // `_writeLayers`. O inventário anterior a deu por "guardada transitivamente": `addFeatures`
    // recusa no destino, a releitura conta menos feições do que mandou e `rollbackTargetLayer`
    // desfaz. Isso é trabalho feito e desfeito, e NÃO cobre a camada VAZIA, onde `total === 0` pula
    // a releitura inteira: a operação voltava `success: true` deixando `layers_<nome>` órfão e uma
    // op `layer` com contexto que não é UUID, descartada pelo anti-vazamento.
    const ORIGEM = 'Mapa de origem';

    beforeEach(() => {
        h.memoryStore.currentMap = ORIGEM;
        h.mapas.set('a1b2c3d4-0000-4000-8000-000000000002', {
            id: 'a1b2c3d4-0000-4000-8000-000000000002', name: ORIGEM, features: {}
        });
        setLayerTransferDependencies({
            eventBus: { emit: vi.fn() },
            layerManager: {
                getLayerById: () => ({ id: 'l1', name: 'Camada l1', locked: false, order: 0 })
            }
        });
        eventos = [];
    });

    it('a camada VAZIA recusa antes de qualquer escrita, e UMA recusa só', async () => {
        const resultado = await transferLayerToMap('l1', SUMIU, { mode: TransferMode.COPY });

        expect(resultado).toEqual({ success: false, reason: 'map_missing', mode: TransferMode.COPY });
        expect(setLayersCompat, 'o registro da camada de destino foi gravado assim mesmo')
            .not.toHaveBeenCalled();
        expect(h.camadas.size).toBe(0);
        expect(h.intencoes.flat()).toEqual([]);
        expect(addFeatures).not.toHaveBeenCalled();
        // UMA recusa: a pergunta já emite, então passar o retorno pelo `refuse` local emitiria o
        // mesmo bloqueio duas vezes, e a tela mostraria dois avisos para um gesto.
        expect(recusas()).toEqual(['transferLayerToMap:map_missing']);
    });

    it('o CONTROLE: o mesmo gesto para um destino que existe continua passando', async () => {
        const resultado = await transferLayerToMap('l1', VIVO, { mode: TransferMode.COPY });

        expect(resultado.success).toBe(true);
        expect(h.camadas.get(`layers_${CHAVE_VIVA}`)).toHaveLength(1);
        expect(h.intencoes.flat()).toHaveLength(1);
        expect(recusas()).toEqual([]);
    });

    it('o FALSO SUCESSO que a porta nova criou: exclusão recusada não conta como removida', async () => {
        // `deleteLayerOnly` delega a `layerManager.deleteLayer`, que com a porta nova devolve
        // `undefined` quando o mapa de ORIGEM sumiu no meio da transferência (um par o apagou). O
        // `undefined` é falso SEM ser `success === false`, então a leitura anterior
        // (`deletion && deletion.success === false`) o tratava como remoção bem-sucedida e a frase
        // final dizia que a camada saiu da origem enquanto ela continuava lá.
        vi.mocked(deleteLayerOnly).mockResolvedValueOnce(undefined);

        const resultado = await transferLayerToMap('l1', VIVO, { mode: TransferMode.MOVE });

        expect(resultado.success).toBe(true);
        expect(resultado.sourceLayerRemoved, 'a recusa da exclusão foi contada como remoção').toBe(false);
    });

    it('em atlas LOCAL o destino inexistente continua aceito, como no resto da porta', async () => {
        h.escopo.atual = h.escopos.local;

        const resultado = await transferLayerToMap('l1', SUMIU, { mode: TransferMode.COPY });

        expect(resultado.success).toBe(true);
        expect(h.camadas.has(`layers_${SUMIU}`)).toBe(true);
        expect(recusas()).toEqual([]);
    });
});
