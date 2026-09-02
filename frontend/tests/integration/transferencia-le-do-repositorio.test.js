// Path: tests/integration/transferencia-le-do-repositorio.test.js

/**
 * @fileoverview TRANSFERIR UMA CAMADA LE E ESCREVE AS CAMADAS DO DESTINO PELO REPOSITORIO,
 * NUNCA PELA MEMORIA.
 *
 * O DEFEITO QUE ISTO IMPEDE. `memoryStore.layers` e' hidratado UM MAPA POR VEZ: quem hidrata
 * e' `setCurrentMap`, chamando `loadLayersToMemory` para o mapa que a pessoa acabou de
 * abrir, e nada carrega os demais no boot. `LayerManager._resolveMap` passa por
 * `_ensureMapLayersExist`, um ajudante de ESCRITA, entao o caminho de LEITURA FABRICA uma
 * lista com a camada padrao para qualquer mapa que a sessao nunca visitou. Escrever o
 * destino por ali (por `createLayerForImport`, digamos) persistiria essa lista fabricada POR
 * CIMA das camadas reais, sem um erro em lugar nenhum.
 *
 * A propriedade medida aqui e' a unica que separa as duas versoes: com o dado NO DISCO e a
 * memoria NAO HIDRATADA para o mapa de destino, a transferencia soma UMA camada as que ja'
 * existiam, em vez de substitui-las por duas.
 *
 * NADA E' DUBLADO NO CAMINHO DE LEITURA. O `localforage` e' o de producao sobre
 * `fake-indexeddb` (`tests/setup/indexeddb.setup.js`), o repositorio e' o real, os servicos
 * sobem como no produto e a operacao e' a real. Um duble de repositorio deixaria a fonte
 * invisivel, que e' exatamente o que este arquivo existe para medir.
 *
 * O QUE UM VERDE AQUI NAO PROVA:
 *  1. Nao prova nada sobre o par de teste vizinho (`tests/store/layer-transfer.test.js`),
 *     que mede a ORQUESTRACAO com repositorio dublado. Os dois eixos precisam dos dois.
 *  2. Nao prova frescura: a escrita de camada e' adiada por `DebouncedPersist`, e este
 *     arquivo escreve direto no repositorio, entao aquele passo nao e' exercitado.
 *  3. Nao prova o produto ponta a ponta: `fake-indexeddb` e' um processo so'.
 *
 * O CONTROLE que impede isto de virar cobertura vazia: o caso "mapa de destino VIRGEM", que
 * de fato nao tem camada nenhuma no disco, continua saindo com UMA camada (a padrao
 * sintetizada) mais a transferida. Sem ele, um `toHaveLength(4)` sozinho nao distinguiria
 * "leu do disco" de "leu qualquer coisa que por acaso tinha tres entradas".
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetIndexedDB } from '../helpers/idb-helpers.js';

// O toast e' a unica porta de saida de UI que o grafo do store abre em node.
vi.mock('@utils/toast_service.js', () => ({
    showToast: vi.fn(), showSuccess: vi.fn(), showError: vi.fn(), showWarning: vi.fn(),
    showInChannel: vi.fn()
}));

// `localStorage` nao existe no ambiente `node` do vitest, e o grafo do sync o le para o
// `clientId` persistido. Sem ele o import do barril quebra antes de qualquer medicao.
const memoriaLocal = (() => {
    let dados = new Map();
    return {
        getItem: (k) => (dados.has(k) ? dados.get(k) : null),
        setItem: (k, v) => { dados.set(k, String(v)); },
        removeItem: (k) => { dados.delete(k); },
        clear: () => { dados = new Map(); }
    };
})();
if (typeof globalThis.localStorage === 'undefined') {
    Object.defineProperty(globalThis, 'localStorage', { value: memoriaLocal, writable: true });
}

// ============================================================================
// O cenario
// ============================================================================

/** O mapa que a pessoa esta' vendo, dono da camada que viaja. */
const MAPA_CORRENTE = 'Principal';
/** O mapa de destino, que a sessao NUNCA visitou: tudo dele mora no disco. */
const MAPA_GUARDADO = 'Mapa Guardado';
/** O destino que de fato nao tem camada nenhuma no disco: o controle. */
const MAPA_VIRGEM = 'Mapa Sem Nada';

/** Quantas camadas o mapa guardado tem NO DISCO antes da transferencia. */
const CAMADAS_NO_DISCO = 3;

/**
 * As camadas do destino como o repositorio as guarda: array, na ordem, com os tres campos
 * de sync que uma camada carrega (`createdAt`, `updatedAt`, `version`) e nada alem deles.
 * @returns {Array<object>} As camadas a gravar.
 */
function camadasDeDisco() {
    const agora = 1_756_000_000_000;
    return Array.from({ length: CAMADAS_NO_DISCO }, (_, i) => ({
        id: `guardada-${i + 1}`,
        name: `Guardada ${i + 1}`,
        visible: true,
        locked: false,
        opacity: 1,
        order: i,
        createdAt: agora,
        updatedAt: agora,
        version: 1
    }));
}

/**
 * Uma feicao de ponto na camada que viaja.
 * @param {string} id - Id de sync.
 * @param {string} layerId - Camada de origem.
 * @returns {object} A feicao.
 */
function ponto(id, layerId) {
    return {
        type: 'Feature',
        id: 4242,
        geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
        properties: {
            id,
            source: 'point',
            nome: `Ponto ${id}`,
            layerId,
            createdAt: 1000,
            updatedAt: 1000,
            version: 1
        }
    };
}

// ============================================================================
// Modulos, importados DEPOIS do reset de modulos em cada caso
// ============================================================================

let transferLayerToMap;
let TransferMode;
let getLayersCompat;
let setLayersCompat;
let createMapCompat;
let updateMapDataCompat;
let getMapDataCompat;
let memoryStore;
let layerManager;

/** Teto de preparo: a primeira rodada paga a transformacao do grafo do store inteiro. */
const TETO_DE_PREPARO_MS = 60000;

beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    await resetIndexedDB();
    globalThis.localStorage.clear();

    const servicos = await import('@store/services.js');
    const { awaitMapResolverReady } = await import('@store/services/map-resolver.service.js');
    const { disableOperationLogging } = await import('@store/sync/operation-dispatcher.js');

    // Os servicos sobem como no produto: e' com eles de pe' que a versao defeituosa
    // fabricaria a lista de camadas do destino sem lancar.
    servicos.initServices();
    await awaitMapResolverReady();
    // A fila de saida nao e' o assunto: sem isto cada escrita enfileira uma op.
    disableOperationLogging();
    layerManager = servicos.getLayerManager();

    const repositorios = await import('@store/repositories/index.js');
    getLayersCompat = repositorios.getLayersCompat;
    setLayersCompat = repositorios.setLayersCompat;
    createMapCompat = repositorios.createMapCompat;
    updateMapDataCompat = repositorios.updateMapDataCompat;
    getMapDataCompat = repositorios.getMapDataCompat;
    ({ memoryStore } = await import('@store/memory-store.js'));

    const ops = await import('@store/layer-transfer.operations.js');
    transferLayerToMap = ops.transferLayerToMap;
    ({ TransferMode } = await import('@store/layer-transfer.model.js'));
}, TETO_DE_PREPARO_MS);

afterEach(() => {
    vi.restoreAllMocks();
});

// ============================================================================
// Ajudantes
// ============================================================================

/**
 * Grava no DISCO, pelos escritores reais do repositorio, os tres mapas do cenario, e deixa
 * o corrente hidratado em memoria com a camada que vai viajar.
 * @returns {Promise<void>} Resolve com o disco semeado.
 */
async function semearDisco() {
    await createMapCompat(MAPA_CORRENTE);
    await createMapCompat(MAPA_GUARDADO);
    await createMapCompat(MAPA_VIRGEM);

    await setLayersCompat(MAPA_CORRENTE, [
        {
            id: 'viajante', name: 'Inimigo', visible: true, locked: false, opacity: 0.4,
            order: 0, createdAt: 1000, updatedAt: 1000, version: 1
        }
    ]);
    await setLayersCompat(MAPA_GUARDADO, camadasDeDisco());

    const dados = await getMapDataCompat(MAPA_CORRENTE);
    dados.features.points.push(ponto('p1', 'viajante'));
    dados.features.points.push(ponto('p2', 'viajante'));
    await updateMapDataCompat(MAPA_CORRENTE, dados);

    // O mapa corrente e' o UNICO que a memoria conhece, que e' a condicao do defeito.
    memoryStore.currentMap = MAPA_CORRENTE;
    await layerManager.loadLayersToMemory(MAPA_CORRENTE);
}

/**
 * A condicao sem a qual este arquivo nao mede nada: a memoria NAO conhece o destino.
 *
 * Conferida ANTES da transferencia, e nao depois, porque os getters sincronos criam a
 * entrada que leem (`_ensureMapLayersExist`): perguntar depois responderia sobre um estado
 * que a propria pergunta fabricou.
 * @param {string} mapName - O mapa que deve estar ausente da memoria.
 * @returns {void}
 */
function exigirMemoriaNaoHidratada(mapName) {
    expect(memoryStore.layers?.[mapName], `memoria de camadas de ${mapName}`).toBeUndefined();
}

// ============================================================================
// TESTES
// ============================================================================

describe('transferir camada le e escreve o destino pelo repositorio', () => {

    it('destino NAO hidratado: as tres camadas do disco continuam la, e a nova soma quatro', async () => {
        await semearDisco();
        exigirMemoriaNaoHidratada(MAPA_GUARDADO);

        const resultado = await transferLayerToMap('viajante', MAPA_GUARDADO, {
            mode: TransferMode.MOVE
        });

        expect(resultado.success, JSON.stringify(resultado)).toBe(true);

        const camadas = await getLayersCompat(MAPA_GUARDADO);
        // ABSOLUTO. Com a fonte errada este numero seria 2 (a `default` fabricada mais a
        // transferida), e um `> 0` passaria verde exatamente no defeito.
        expect(camadas).toHaveLength(CAMADAS_NO_DISCO + 1);
        expect(camadas.map((c) => c.name)).toEqual([
            'Guardada 1', 'Guardada 2', 'Guardada 3', 'Inimigo'
        ]);
        expect(camadas.map((c) => c.id)).toContain(resultado.targetLayerId);
        // Nenhuma camada `default` inventada entrou junto.
        expect(camadas.map((c) => c.id)).not.toContain('default');
    });

    it('as feicoes chegam ao destino apontando para a camada nova, e saem da origem', async () => {
        await semearDisco();
        exigirMemoriaNaoHidratada(MAPA_GUARDADO);

        const resultado = await transferLayerToMap('viajante', MAPA_GUARDADO, {
            mode: TransferMode.MOVE
        });

        expect(resultado.movedCount).toBe(2);

        const destino = await getMapDataCompat(MAPA_GUARDADO);
        expect(destino.features.points).toHaveLength(2);
        for (const feicao of destino.features.points) {
            expect(feicao.properties.layerId).toBe(resultado.targetLayerId);
        }

        const origem = await getMapDataCompat(MAPA_CORRENTE);
        expect(origem.features.points).toHaveLength(0);
    });

    it('a transferencia NAO fabrica cache em memoria para o destino', async () => {
        await semearDisco();
        exigirMemoriaNaoHidratada(MAPA_GUARDADO);

        await transferLayerToMap('viajante', MAPA_GUARDADO, { mode: TransferMode.MOVE });

        // Um cache meio construido e' indistinguivel de um hidratado, e o proximo persist
        // daquele mapa o escreveria por cima do disco.
        expect(memoryStore.layers?.[MAPA_GUARDADO]).toBeUndefined();
    });

    it('CONTROLE: destino VIRGEM sai com a padrao sintetizada mais a transferida', async () => {
        // O numero que separa "leu do disco" de "leu qualquer coisa". Aqui o repositorio de
        // fato nao tem camada, e `LocalRepository.getLayers` sintetiza a padrao.
        await semearDisco();
        exigirMemoriaNaoHidratada(MAPA_VIRGEM);

        const antes = await getLayersCompat(MAPA_VIRGEM);
        expect(antes).toHaveLength(1);

        const resultado = await transferLayerToMap('viajante', MAPA_VIRGEM, {
            mode: TransferMode.COPY
        });

        expect(resultado.success, JSON.stringify(resultado)).toBe(true);
        const depois = await getLayersCompat(MAPA_VIRGEM);
        expect(depois).toHaveLength(2);
        expect(depois.map((c) => c.name)).toEqual(['Padrão', 'Inimigo']);
    });
});
