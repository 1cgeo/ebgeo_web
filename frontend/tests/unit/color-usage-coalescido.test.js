// Path: tests/unit/color-usage-coalescido.test.js
//
// UMA GRAVAÇÃO DE USO DE COR POR RAJADA, e não uma por cor por feição.
//
// `updateColorUsage` agendava um `setTimeout` e uma escrita no IndexedDB por COR e por FEIÇÃO
// enquanto o mapa fosse o corrente. O ramo dos OUTROS mapas já era coalescido; o do mapa
// corrente não era. Importar ou colar um lote disparava centenas de temporizadores que
// gravavam todos o mesmo objeto, porque `saveColorUsageToDB` sempre escreve o estado FINAL do
// cache em memória.
//
// O PIOR CASO QUE A RÉGUA EXISTE PARA REPROVAR: 20 feições carregando 3 cores cada, todas
// registradas no mesmo tick, contra o mapa CORRENTE. Antes do conserto o contador lê 60; tem
// de ler 1.
//
// O QUE MUDA AQUI EM RELAÇÃO À MAIN: nada na régua, e um caso a mais. O coalescedor é
// `_scheduleCurrentColorPersist`, guardado pelo campo `_currentColorTimer`, e um temporizador
// que atravessa uma TROCA DE MAPA gravaria o cache do mapa que entra sob o nome do que sai.
// `setCurrentMap` cancela o pendente antes da gravação explícita, e o último caso é esse.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { setColorUsageMock, getColorUsageMock, coresGravadas } = vi.hoisted(() => {
    const armazem = { valor: {} };
    return {
        coresGravadas: armazem,
        setColorUsageMock: vi.fn(async (mapName, data) => { armazem.valor[mapName] = data; }),
        getColorUsageMock: vi.fn(async (mapName) => armazem.valor[mapName] || {})
    };
});

// PARCIAL: o barril de repositórios serve meio store, e um dublê total derruba a carga de
// módulos que este arquivo nem exercita. Trocadas só as funções que a contagem observa e as
// que fariam a troca de mapa bater num banco de verdade.
vi.mock('../../src/js/store/repositories/index.js', async (importOriginal) => ({
    ...(await importOriginal()),
    setSettingCompat: vi.fn(async () => {}),
    getSettingCompat: vi.fn(async () => null),
    getColorUsageCompat: getColorUsageMock,
    setColorUsageCompat: setColorUsageMock,
    removeColorUsageCompat: vi.fn(async () => {}),
    getAllMapKeysCompat: vi.fn(async () => ['MapaA', 'MapaB']),
    getMapDataCompat: vi.fn(async () => ({ features: {} })),
    deleteImageCompat: vi.fn(async () => {})
}));

vi.mock('../../src/js/store/services.js', () => ({
    getGroupManager: () => ({ loadGroupsToMemory: vi.fn(async () => {}) })
}));

vi.mock('../../src/js/store/services/map-resolver.service.js', () => ({
    mapResolver: { resolveToId: (nome) => nome, getIdForName: (nome) => nome, isInitialized: true }
}));

const mapManager = (await import('../../src/js/store/store-state-manager.js')).default;

const CORES = ['#ff0000', '#00ff00', '#0000ff'];

/** Zera o gerente para o estado que os casos assumem: mapa corrente MapaA, cache vazio. */
function estadoLimpo() {
    setColorUsageMock.mockClear();
    getColorUsageMock.mockClear();
    coresGravadas.valor = {};
    mapManager._currentColorTimer = null;
    mapManager.memoryStore.currentMap = 'MapaA';
    mapManager.memoryStore.colorUsageCache = new Map();
}

describe('updateColorUsage: uma gravação por rajada, não uma por cor por feição', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        estadoLimpo();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('60 chamadas no mesmo tick para o mapa corrente gravam UMA vez', async () => {
        for (let feicao = 0; feicao < 20; feicao++) {
            for (const cor of CORES) {
                mapManager.updateColorUsage(null, cor, 'MapaA');
            }
        }

        expect(setColorUsageMock).toHaveBeenCalledTimes(0);

        await vi.advanceTimersByTimeAsync(200);

        expect(setColorUsageMock).toHaveBeenCalledTimes(1);
    });

    it('a única gravação carrega a contagem FINAL das 60 chamadas', async () => {
        for (let feicao = 0; feicao < 20; feicao++) {
            for (const cor of CORES) {
                mapManager.updateColorUsage(null, cor, 'MapaA');
            }
        }

        await vi.advanceTimersByTimeAsync(200);

        const [mapName, gravado] = setColorUsageMock.mock.calls[0];
        expect(mapName).toBe('MapaA');
        expect(gravado).toEqual({ '#ff0000': 20, '#00ff00': 20, '#0000ff': 20 });
    });

    it('uma rajada por mapa: uma gravação para o corrente e uma para o outro', async () => {
        for (let feicao = 0; feicao < 20; feicao++) {
            for (const cor of CORES) {
                mapManager.updateColorUsage(null, cor, 'MapaA');
                mapManager.updateColorUsage(null, cor, 'MapaB');
            }
        }

        await vi.advanceTimersByTimeAsync(200);

        expect(setColorUsageMock).toHaveBeenCalledTimes(2);
        const mapasGravados = setColorUsageMock.mock.calls.map(c => c[0]).sort();
        expect(mapasGravados).toEqual(['MapaA', 'MapaB']);
    });

    it('uma rajada seguinte, depois do flush, agenda uma nova gravação', async () => {
        mapManager.updateColorUsage(null, '#ff0000', 'MapaA');
        await vi.advanceTimersByTimeAsync(200);
        expect(setColorUsageMock).toHaveBeenCalledTimes(1);

        mapManager.updateColorUsage(null, '#00ff00', 'MapaA');
        await vi.advanceTimersByTimeAsync(200);
        expect(setColorUsageMock).toHaveBeenCalledTimes(2);
    });

    it('o cache em memória continua exato, cor a cor', () => {
        for (let feicao = 0; feicao < 20; feicao++) {
            for (const cor of CORES) {
                mapManager.updateColorUsage(null, cor, 'MapaA');
            }
        }
        // Tira as cores de uma feição
        for (const cor of CORES) {
            mapManager.updateColorUsage(cor, null, 'MapaA');
        }

        for (const cor of CORES) {
            expect(mapManager.memoryStore.colorUsageCache.get(cor)).toBe(19);
        }
    });
});

describe('a troca de mapa não pode deixar um temporizador atravessar', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        estadoLimpo();
        // O mapa que ENTRA já tem cores gravadas, para a carga não disparar a análise inicial
        // (que agenda o seu próprio temporizador e sujaria a contagem).
        coresGravadas.valor.MapaB = { '#123456': 7 };
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('setCurrentMap cancela a gravação pendente e grava o mapa que SAI uma vez só', async () => {
        mapManager.updateColorUsage(null, '#ff0000', 'MapaA');
        expect(mapManager._currentColorTimer).not.toBeNull();

        await mapManager.setCurrentMap('MapaB');

        expect(mapManager._currentColorTimer).toBeNull();
        const gravacoesDeA = setColorUsageMock.mock.calls.filter(c => c[0] === 'MapaA');
        expect(gravacoesDeA).toHaveLength(1);
        expect(gravacoesDeA[0][1]).toEqual({ '#ff0000': 1 });
    });

    it('o temporizador cancelado não grava o cache do mapa que ENTRA sob o nome do que sai', async () => {
        mapManager.updateColorUsage(null, '#ff0000', 'MapaA');
        await mapManager.setCurrentMap('MapaB');

        // Depois da troca, o cache em memória é o do MapaB. Um temporizador sobrevivente
        // dispararia agora e escreveria ESSE cache com o nome MapaA, apagando as contagens do
        // mapa que acabou de sair.
        setColorUsageMock.mockClear();
        await vi.advanceTimersByTimeAsync(500);

        expect(setColorUsageMock.mock.calls.filter(c => c[0] === 'MapaA')).toHaveLength(0);
        expect(coresGravadas.valor.MapaA).toEqual({ '#ff0000': 1 });
    });
});
