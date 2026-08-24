import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * REPRO — o autor VENCE a disputa no servidor e continua exibindo o valor do perdedor.
 *
 * Medido em 2026-08-23 com tres navegadores reais (fase 3 de
 * `frontend/tests/e2e-ui/browser-collab-three-client-flow.spec.js`): os tres clientes editam a
 * cor da MESMA feicao, o Postgres grava `#00ff00` (a cor de C) e C exibe `#ff0000` (a de A)
 * pelos 30 segundos inteiros do poll. `orphans: 0`, `acked-but-no-effect: 0`: as tres edicoes
 * foram aceitas, o servidor escolheu, e um cliente ficou preso num valor superado.
 *
 * MECANISMO. O guarda de convergencia (`markLocalEditPending` -> defer -> `resolveLocalEdit`)
 * depende de a marca de edicao local existir ANTES de a op do par ser aplicada, e ela nao existe:
 *  1. `markLocalEditPending` roda em `logOperation` (`operation-dispatcher.js`), chamado de
 *     `tx.deferAsync`, e `StoreTransaction.commit()` dispara esses efeitos SEM `await`
 *     (`store-transaction.js`), depois de um `await operationQueue.enqueue`. Entre a persistencia
 *     do valor local e a marca ha, no minimo, uma escrita de IndexedDB, FORA do lock do documento;
 *  2. mesmo com a marca adiantada, `applyRemoteOperation` LE o contador antes de
 *     `applyRemoteFeatureOp` tomar o lock do mapa, entao a op do par passa pelo guarda, espera o
 *     lock que a edicao local segura, e escreve DEPOIS dela.
 * Aplicada a op do par nessa janela, o autor nunca mais e corrigido: ele filtra o proprio eco no
 * WebSocket (`_isOwnClientId`, `ws-client.js`), entao o valor dele nao volta por caminho nenhum.
 *
 * A interleaving perdedora esta forcada aqui, sem estatistica de browser: a op de A e aplicada
 * ENTRE a escrita local de C e a marca. Contra o codigo anterior a este commit, os dois casos
 * falham 100% das vezes.
 */

// ============================================================================
// Mocks (mesmo conjunto minimo de remote-operation-handler.test.js)
// ============================================================================

const localStorageMock = (() => {
    const store = {};
    return {
        getItem: (key) => store[key] || null,
        setItem: (key, value) => { store[key] = String(value); },
        removeItem: (key) => { delete store[key]; }
    };
})();
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

const mapDataStore = new Map();

vi.mock('localforage', () => {
    const mockStore = new Map();
    return {
        default: {
            createInstance: () => ({
                setItem: vi.fn(async (key, value) => { mockStore.set(key, value); }),
                getItem: vi.fn(async (key) => mockStore.get(key) || null),
                removeItem: vi.fn(async (key) => { mockStore.delete(key); }),
                keys: vi.fn(async () => [...mockStore.keys()]),
            })
        }
    };
});

vi.mock('../../src/js/utilities/uuid.js', () => ({
    generateUUID: vi.fn(() => 'uuid-fixo'),
    isValidUUID: vi.fn(() => true),
}));

vi.mock('../../src/js/store/store-errors.js', () => ({
    StoreErrorEvents: { STORE_SYNC_ERROR: 'store:syncError' },
    emitStoreError: vi.fn()
}));

// `saveMap` e controlavel: a corrida de ordem entre a op vencedora de um par e o reparo do
// autor so vira teste DETERMINISTICO se a escrita do par puder ser segurada e solta no
// instante exato. `portaoDeEscrita` e null no caso comum, entao os demais casos nao mudam.
let portaoDeEscrita = null;
vi.mock('../../src/js/store/repositories/index.js', () => ({
    getRepository: vi.fn(() => ({
        getMap: vi.fn(async (mapId) => mapDataStore.get(mapId) || null),
        saveMap: vi.fn(async (mapId, data) => {
            if (portaoDeEscrita) await portaoDeEscrita;
            mapDataStore.set(mapId, data);
        }),
    })),
    setSettingCompat: vi.fn(async () => {}),
}));

vi.mock('../../src/js/store/repositories/local.repository.js', () => ({
    localRepository: {
        saveBriefing: vi.fn(async () => {}),
        getBriefing: vi.fn(async () => null),
        deleteBriefing: vi.fn(async () => {}),
    }
}));

// ============================================================================
// Imports
// ============================================================================

import {
    applyRemoteOperation,
    setRemoteHandlerEventBus,
    markLocalEditPending,
    resolveLocalEdit,
} from '../../src/js/store/sync/remote-operation-handler.js';
import { EntityType, OperationType } from '../../src/js/store/sync/operation-types.js';
import { installSyncTrace } from '../../src/js/store/sync/diag/bus-tap.js';
import { setTracing, clearTrace, getTrace } from '../../src/js/store/sync/diag/trace-core.js';

// ============================================================================
// Cenario
// ============================================================================

const MAP_ID = 'map-conflito';

/** A feicao INTEIRA, que e o que toda op de feicao carrega (create/update passam `cleanedFeature`). */
const linha = (id, cor) => ({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
    properties: { id, source: 'line', lineColor: cor },
});

/** Op de feicao no formato do envelope, servindo tanto de op remota quanto de op local acked. */
const opDeCor = (id, cor, serverVersion) => ({
    id: `op-${cor}-${serverVersion}`,
    entityType: EntityType.FEATURE,
    operationType: OperationType.UPDATE,
    entityId: id,
    mapId: MAP_ID,
    serverVersion,
    data: linha(id, cor),
});

function semearMapa(id, cor) {
    mapDataStore.set(MAP_ID, {
        features: { points: [], lines: [linha(id, cor)], polygons: [] },
    });
}

/** Escrita local do autor: e o que `persistFn` grava dentro do lock, antes de qualquer marca. */
function escritaLocal(id, cor) {
    const mapa = mapDataStore.get(MAP_ID);
    const i = mapa.features.lines.findIndex((f) => f.properties.id === id);
    mapa.features.lines[i] = linha(id, cor);
}

const corDe = (id) =>
    mapDataStore.get(MAP_ID).features.lines.find((f) => f.properties.id === id)?.properties.lineColor;

describe('Convergencia: o autor que VENCE no servidor tem de exibir o proprio valor', () => {
    beforeEach(() => {
        mapDataStore.clear();
        setRemoteHandlerEventBus({ emit: vi.fn(), on: vi.fn(), off: vi.fn() });
    });

    // A interleaving exata que a fase 3 produziu: C escreve verde, a op de A (mais VELHA) chega
    // na janela antes da marca e e aplicada, a op de B chega ja com a marca de pe e e adiada, e o
    // ack revela que C venceu. Antes do reparo, C terminava em #ff0000 (a cor de A) para sempre.
    it('repara o valor local quando a op MAIS VELHA de um par escapou pela janela antes da marca', async () => {
        const f = 'feicao-disputada';
        semearMapa(f, '#000000');

        escritaLocal(f, '#00ff00');                                   // C persiste o proprio verde
        await applyRemoteOperation(opDeCor(f, '#ff0000', 10));        // A escapa pela janela
        expect(corDe(f), 'a janela existe: a op de A foi aplicada sobre o valor local').toBe('#ff0000');

        markLocalEditPending(f);                                      // a marca chega tarde demais
        await applyRemoteOperation(opDeCor(f, '#0000ff', 11));        // B chega com a marca de pe
        expect(corDe(f), 'com a marca de pe, a op de B e adiada').toBe('#ff0000');

        // O push ack: a op de C entrou no servidor DEPOIS das outras duas, entao C venceu.
        await resolveLocalEdit(f, 12, opDeCor(f, '#00ff00', 12));

        expect(corDe(f), 'C venceu no servidor e tem de exibir a propria cor').toBe('#00ff00');
    });

    // A mesma janela sem nenhuma op adiada: nao ha replay para disfarcar, o unico caminho de
    // correcao e o ack. Prende o caso em que o `deferredRemoteOps` esta vazio.
    it('repara mesmo sem nenhuma op adiada para reprocessar', async () => {
        const f = 'feicao-sem-defer';
        semearMapa(f, '#000000');

        escritaLocal(f, '#00ff00');
        await applyRemoteOperation(opDeCor(f, '#ff0000', 10));
        markLocalEditPending(f);

        await resolveLocalEdit(f, 12, opDeCor(f, '#00ff00', 12));

        expect(corDe(f)).toBe('#00ff00');
    });

    // CONTROLE POSITIVO do outro lado: quem PERDE nao pode ser reparado. Sem esta assercao o
    // reparo poderia ser incondicional (o autor sempre volta a mostrar o proprio valor), que e
    // divergencia na direcao oposta e passaria verde nos dois casos acima.
    it('NAO repara quando o par venceu: a op mais nova do par continua valendo', async () => {
        const f = 'feicao-perdida';
        semearMapa(f, '#000000');

        escritaLocal(f, '#00ff00');
        markLocalEditPending(f);
        await applyRemoteOperation(opDeCor(f, '#ff0000', 30));  // adiada
        expect(corDe(f)).toBe('#00ff00');

        await resolveLocalEdit(f, 25, opDeCor(f, '#00ff00', 25)); // 25 < 30: o par venceu

        expect(corDe(f), 'o vencedor por ordem de chegada e o par').toBe('#ff0000');
    });

    // A FORMA ESPELHADA, medida em campo em 2026-08-23 (`servidor=#0000ff
    // clientes=#0000ff,#0000ff,#00ff00`): uma op mais VELHA de um par escapa pela janela E o
    // VENCEDOR chega adiado. O reparo roda (houve atropelo por versao menor) e nao pode se
    // sobrepor ao vencedor: ele acontece ANTES do replay das adiadas de proposito. Sem esta
    // assercao, a ordem das duas metades de `resolveLocalEdit` poderia inverter sem ficar vermelha,
    // e o autor ficaria exibindo o proprio valor perdido para sempre.
    it('com atropelo E vencedor adiado, o vencedor prevalece sobre o reparo', async () => {
        const f = 'feicao-espelhada';
        semearMapa(f, '#000000');

        escritaLocal(f, '#00ff00');                              // C persiste o proprio verde
        await applyRemoteOperation(opDeCor(f, '#ff0000', 10));   // A (mais velha) escapa pela janela
        expect(corDe(f)).toBe('#ff0000');

        markLocalEditPending(f);
        await applyRemoteOperation(opDeCor(f, '#0000ff', 12));   // B (o VENCEDOR) chega adiado

        await resolveLocalEdit(f, 11, opDeCor(f, '#00ff00', 11)); // C perdeu: 11 < 12

        expect(corDe(f), 'o vencedor por ordem de chegada e B, nao o reparo de C').toBe('#0000ff');
    });

    // O mesmo com o vencedor APLICADO pela janela, junto com uma op mais velha: e o `max` de
    // `markRemoteApplied` que decide, e trocar o max pelo ULTIMO aplicado inverteria isto.
    it('com duas ops de par aplicadas pela janela, o reparo nao dispara se o par venceu', async () => {
        const f = 'feicao-janela-dupla';
        semearMapa(f, '#000000');

        escritaLocal(f, '#00ff00');
        await applyRemoteOperation(opDeCor(f, '#ff0000', 10));   // A escapa
        await applyRemoteOperation(opDeCor(f, '#0000ff', 12));   // B escapa e vence
        markLocalEditPending(f);

        await resolveLocalEdit(f, 11, opDeCor(f, '#00ff00', 11));

        expect(corDe(f)).toBe('#0000ff');
    });

    // A CORRIDA DE ORDEM entre a op VENCEDORA do par e o reparo do autor, forcada.
    //
    // O guarda de versao so decide alguma coisa se checar, escrever e registrar forem UM passo, e
    // nao eram: `applyRemoteOperation` le `shouldApplyVersion` e so depois chama o handler, que
    // espera o lock do documento. Duas aplicacoes passam pela checagem e chegam no disco na ordem
    // do LOCK, que e a ordem inversa. Aqui a op de B e segurada DENTRO do `saveMap` (ja passou pela
    // checagem, ja tem o lock) e o reparo e disparado nesse instante: sem a cadeia de serializacao
    // o reparo escreve o verde de C DEPOIS do azul vencedor de B e o autor fica com o valor
    // superado, que e a assinatura medida em campo (`servidor=#0000ff clientes=...,#00ff00`).
    it('o reparo NAO pode escrever depois da op vencedora que entrou no meio', async () => {
        const f = 'feicao-corrida';
        semearMapa(f, '#000000');

        escritaLocal(f, '#00ff00');
        await applyRemoteOperation(opDeCor(f, '#ff0000', 10));   // A escapa pela janela: ha atropelo
        expect(corDe(f)).toBe('#ff0000');

        // B chega SEM marca de pe (a mesma janela 1 que abriu o defeito), entao ele nao e adiado:
        // passa pela checagem de versao com `lastApplied = 10` e trava DENTRO do `saveMap`, ja
        // segurando o lock do documento.
        let soltar;
        portaoDeEscrita = new Promise((resolve) => { soltar = resolve; });
        const pB = applyRemoteOperation(opDeCor(f, '#0000ff', 12));
        for (let i = 0; i < 8; i += 1) await Promise.resolve();

        // O ack de C chega exatamente aqui: o reparo ve o atropelo (10 < 11) e a versao aplicada
        // ainda e 10, porque B so registra a dele DEPOIS de escrever. Sem serializacao os dois
        // passam pela checagem e a ordem final e a do LOCK, que poe o reparo por ultimo.
        const pAck = resolveLocalEdit(f, 11, opDeCor(f, '#00ff00', 11));
        for (let i = 0; i < 8; i += 1) await Promise.resolve();

        soltar();
        portaoDeEscrita = null;
        await Promise.all([pB, pAck]);

        expect(corDe(f), 'B venceu por ordem de chegada: o reparo tem de ser descartado').toBe('#0000ff');
    });

    // O reparo nao pode ressuscitar um valor intermediario: com DUAS edicoes locais em voo, so o
    // ack da ULTIMA repara, e com os dados dela.
    it('com duas edicoes locais em voo, so a ultima repara', async () => {
        const f = 'feicao-dupla';
        semearMapa(f, '#000000');

        escritaLocal(f, '#111111');
        await applyRemoteOperation(opDeCor(f, '#ff0000', 10));  // escapa pela janela
        markLocalEditPending(f);                                // marca da 1a edicao
        escritaLocal(f, '#222222');
        markLocalEditPending(f);                                // marca da 2a edicao

        await resolveLocalEdit(f, 12, opDeCor(f, '#111111', 12)); // ack da 1a: NAO repara
        expect(corDe(f), 'o ack intermediario nao pode ressuscitar a 1a edicao').toBe('#222222');

        await resolveLocalEdit(f, 13, opDeCor(f, '#222222', 13)); // ack da 2a: repara com ELA
        expect(corDe(f)).toBe('#222222');
    });
});

// O reparo reentra pelo caminho de ENTRADA de proposito (mesmos handlers, mesmos locks, mesmos
// eventos de ciclo de vida para a tela), e isso o faria emitir `remote.applied` no PROPRIO autor.
// `reduceLedger` (`frontend/tests/e2e-ui/helpers/ledger.js`) monta `appliedOn` a partir desse
// estagio SEM excluir o autor, entao o span faria a op parecer aplicada em alguem e calaria o
// detector de orfa justamente nas ops em disputa. O marcador `localRepair` existe so para isso.
describe('O reparo do autor nao pode se disfarcar de par no SyncLedger', () => {
    let onAny;

    beforeEach(() => {
        onAny = null;
        installSyncTrace({ onAny: (fn) => { onAny = fn; return () => {}; } });
        setTracing(true);
        clearTrace();
    });

    const evento = (operation) => onAny('sync:remoteOperationApplied', { operation });
    const spansRemoteApplied = () => getTrace().filter((s) => s.stage === 'remote.applied');

    it('a op de um par continua registrando remote.applied', () => {
        evento({ id: 'op-par', entityType: EntityType.FEATURE, operationType: OperationType.UPDATE, entityId: 'e1' });
        expect(spansRemoteApplied().map((s) => s.opId)).toEqual(['op-par']);
    });

    it('a op reaplicada pelo proprio autor NAO registra remote.applied', () => {
        evento({ id: 'op-reparo', entityType: EntityType.FEATURE, operationType: OperationType.UPDATE, entityId: 'e1', localRepair: true });
        expect(spansRemoteApplied()).toEqual([]);
    });
});
