// Path: tests/unit/gdh-automatico-com-instante-ausente.repro.test.js
//
// REPRO (achado E8, o ESPELHO em `store/feature.operations.js`): COM O GDH AUTOMÁTICO LIGADO E
// O INSTANTE AUSENTE, O GDH VELHO FICAVA IMPRESSO NO SÍMBOLO E GRAVADO.
//
// O DEFEITO. `autoDtg` significa "o amplificador de data É a janela temporal escrita como
// texto". A re-derivação (`rederiveAutoDtg`) só escrevia quando o instante era finito:
//
//     if (Number.isFinite(p.temporalInicio)) p.dateTimeGroup = formatDTG(...);
//
// Sem `else`, uma janela que perdeu o Início mantinha o `dateTimeGroup` anterior, que passou a
// descrever um instante que a feição não tem mais. Numa carta, é data errada impressa ao lado
// do símbolo, sem nada na tela dizendo que ela está velha. O mesmo vale para `gdhIni`/`gdhFim`
// da medida de coordenação, onde uma janela sem Fim continuava anunciando o Fim antigo.
//
// O CONSERTO: instante ausente escreve vazio. `''` e não `null`/`undefined` porque o gerador do
// símbolo e o campo do painel leem isto como texto, e a chave ausente cairia no padrão do tipo
// em vez de limpar o amplificador.
//
// ESTE ARQUIVO DIRIGE A FUNÇÃO PÚBLICA (`shiftMapTemporalTimes`), nunca o ajudante privado, pelo
// mesmo motivo do irmão `rederiva-dtg-reagendar.repro.test.js`: um conserto que só renomeasse o
// ajudante não o satisfaria.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getEmptyMapData } from '../../src/js/store/repository.utils.js';

const { mockMapData, mockMapManager, mockLockedMaps, mockTemporalConfigs } = vi.hoisted(() => ({
    mockMapData: { value: null },
    mockTemporalConfigs: { value: new Map() },
    mockMapManager: {
        getCurrentMapName: vi.fn(() => 'TestMap'),
        getCurrentMapId: vi.fn(() => 'map-uuid-123'),
        getMapId: vi.fn(() => 'map-uuid-123'),
        getFeatureColor: vi.fn(() => null),
        getFeatureColors: vi.fn(() => []),
        updateColorUsage: vi.fn(),
        recordAction: vi.fn(),
    },
    mockLockedMaps: { value: new Set() },
}));

vi.mock('../../src/js/store/store-errors.js', () => ({
    StoreErrorEvents: {
        STORE_PERSIST_ERROR: 'store:persistError',
        STORE_OPERATION_BLOCKED: 'store:operationBlocked',
    },
    emitStoreError: vi.fn(),
}));

vi.mock('../../src/js/store/store-origin.js', () => ({
    StoreOriginKind: { LOCAL: 'local', REMOTE: 'remote' },
    isRemoteStoreSync: vi.fn(() => false),
    getStoreOriginSync: vi.fn(() => ({ kind: 'local', atlasId: null })),
    loadStoreOrigin: vi.fn(async () => ({ kind: 'local', atlasId: null })),
    setStoreOrigin: vi.fn(async () => {}),
    markStoreRemote: vi.fn(async () => {}),
    markStoreLocal: vi.fn(async () => {}),
}));

vi.mock('../../src/js/store/map.operations.js', () => ({
    isCurrentMapLockedSync: vi.fn(() => false),
}));

vi.mock('../../src/js/store/sync/index.js', () => ({
    logFeatureOperation: vi.fn().mockResolvedValue(undefined),
    OperationType: { CREATE: 'CREATE', UPDATE: 'UPDATE', DELETE: 'DELETE' },
}));

vi.mock('../../src/js/store/repositories/index.js', () => ({
    getMapDataCompat: vi.fn(async () => mockMapData.value),
    updateMapDataCompat: vi.fn(async (mapName, data) => { mockMapData.value = data; }),
    getLayersCompat: vi.fn(async () => []),
}));

vi.mock('../../src/js/store/store-state-manager.js', () => ({ default: mockMapManager }));

vi.mock('../../src/js/store/memory-store.js', () => ({
    memoryStore: {
        get lockedMaps() { return mockLockedMaps.value; },
        set lockedMaps(v) { mockLockedMaps.value = v; },
        get temporalConfigs() { return mockTemporalConfigs.value; },
        currentMap: 'TestMap',
    },
}));

import { shiftMapTemporalTimes } from '../../src/js/store/feature.operations.js';
import { updateMapDataCompat } from '../../src/js/store/repositories/index.js';

// 2024-11-20 14:00Z e 16:00Z, deslocados de três dias. As cadeias abaixo são LITERAIS: uma
// expectativa calculada pela função sob teste concordaria com ela por mais errada que estivesse.
const T0 = Date.UTC(2024, 10, 20, 14, 0);
const T_FIM = Date.UTC(2024, 10, 20, 16, 0);
const DELTA = 3 * 86_400_000;

const DTG_VELHO = '201400NOV24';
const GDH_INI_VELHO = '201400Z NOV';
const GDH_FIM_VELHO = '201600Z NOV';
const GDH_INI_NOVO = '231400Z NOV';

function feicao(id, props) {
    return {
        type: 'Feature',
        id,
        geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
        properties: { id, layerId: 'default', ...props },
    };
}

/** Propriedades como PERSISTIDAS pelo deslocamento. */
function persisted(bucket, id) {
    const data = updateMapDataCompat.mock.calls.at(-1)[1];
    return data.features[bucket].find((f) => f.properties.id === id).properties;
}

describe('GDH automático com instante ausente', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockMapData.value = getEmptyMapData();
        mockLockedMaps.value = new Set();
        mockTemporalConfigs.value = new Map();
    });

    it('REPRO: símbolo militar sem Início não pode manter o dateTimeGroup antigo', () => {
        mockMapData.value.features.military_symbols.push(
            feicao('s1', { autoDtg: true, temporalFim: T_FIM, dateTimeGroup: DTG_VELHO }),
        );

        return shiftMapTemporalTimes('TestMap', DELTA).then(() => {
            const p = persisted('military_symbols', 's1');
            expect(p.dateTimeGroup).toBe('');
            // E o resto do deslocamento aconteceu, senão o vazio seria "nada rodou".
            expect(p.temporalFim).toBe(T_FIM + DELTA);
        });
    });

    it('REPRO: medida de coordenação sem Fim não pode manter o gdhFim antigo', async () => {
        mockMapData.value.features.coordination_measures.push(
            feicao('c1', {
                autoDtg: true, temporalInicio: T0,
                gdhIni: GDH_INI_VELHO, gdhFim: GDH_FIM_VELHO,
            }),
        );

        await shiftMapTemporalTimes('TestMap', DELTA);

        const p = persisted('coordination_measures', 'c1');
        // O lado que TEM instante continua sendo re-derivado (controle positivo na mesma
        // feição): sem ele, um `gdhFim` vazio seria indistinguível de "a derivação parou".
        expect(p.gdhIni).toBe(GDH_INI_NOVO);
        expect(p.gdhFim).toBe('');
    });

    it('com os DOIS instantes presentes nada se apaga', async () => {
        mockMapData.value.features.coordination_measures.push(
            feicao('c1', {
                autoDtg: true, temporalInicio: T0, temporalFim: T_FIM,
                gdhIni: GDH_INI_VELHO, gdhFim: GDH_FIM_VELHO,
            }),
        );

        await shiftMapTemporalTimes('TestMap', DELTA);

        const p = persisted('coordination_measures', 'c1');
        expect(p.gdhIni).toBe(GDH_INI_NOVO);
        expect(p.gdhFim).toBe('231600Z NOV');
    });

    it('CONTROLE: com o vínculo automático DESLIGADO, o GDH escrito à mão sobrevive', async () => {
        mockMapData.value.features.military_symbols.push(
            feicao('s1', { temporalFim: T_FIM, dateTimeGroup: DTG_VELHO }),
        );
        mockMapData.value.features.coordination_measures.push(
            feicao('c1', { temporalInicio: T0, gdhIni: GDH_INI_VELHO, gdhFim: GDH_FIM_VELHO }),
        );

        await shiftMapTemporalTimes('TestMap', DELTA);

        // A limpeza é do VÍNCULO, nunca do campo: quem digitou o amplificador é dono dele.
        expect(persisted('military_symbols', 's1').dateTimeGroup).toBe(DTG_VELHO);
        expect(persisted('coordination_measures', 'c1').gdhFim).toBe(GDH_FIM_VELHO);
        // …e o deslocamento aconteceu, então "não mexeu" não é "não rodou".
        expect(persisted('military_symbols', 's1').temporalFim).toBe(T_FIM + DELTA);
    });

    it('o vazio NÃO é gravado por cima de campo ausente: nada de propriedade inventada', async () => {
        // Uma feição que nunca teve `dateTimeGroup` não pode ganhar `''`: seria uma mudança de
        // propriedade, e mudança de propriedade vira op de sync que os pares aplicam por nada.
        mockMapData.value.features.military_symbols.push(
            feicao('s1', { autoDtg: true, temporalFim: T_FIM }),
        );

        await shiftMapTemporalTimes('TestMap', DELTA);

        expect(persisted('military_symbols', 's1').dateTimeGroup).toBeUndefined();
        expect('dateTimeGroup' in persisted('military_symbols', 's1')).toBe(false);
    });

    it('no modo RELATIVO a derivação CONTINUA: a lente não muda o dado', async () => {
        // CASO INVERTIDO EM 2026-09-21, no mesmo dia em que nasceu. Ele exigia o contrário
        // (que a lente D+N PAUSASSE a derivação, para casar com o que a caixa do painel
        // dizia), e a pausa criava um defeito maior: o "Reagendar" SÓ existe no modo
        // relativo, porque só ali a engrenagem o desenha. Ou seja, no único caminho de
        // produção que chega a `rederiveAutoDtg` a rederivação nunca acontecia, e o símbolo
        // ficava com o GDH velho descrevendo a janela que acabara de andar. Um GDH absoluto
        // fresco num mapa D+N é no máximo estranho; um GDH velho é dado ERRADO impresso.
        //
        // A invariante que este caso prende: `autoDtg` ligado implica GDH igual à janela, em
        // qualquer lente (modelo de lente pura, `.claude/rules/architecture.md`).
        mockTemporalConfigs.value = new Map([['TestMap', { modo: 'relativo' }]]);
        mockMapData.value.features.coordination_measures.push(
            feicao('c1', {
                autoDtg: true, temporalInicio: T0, temporalFim: T_FIM,
                gdhIni: GDH_INI_VELHO, gdhFim: GDH_FIM_VELHO,
            }),
        );

        await shiftMapTemporalTimes('TestMap', DELTA);

        const p = persisted('coordination_measures', 'c1');
        expect(p.gdhIni).toBe(GDH_INI_NOVO);
        expect(p.gdhFim).toBe('231600Z NOV');
        // E o deslocamento em si aconteceu, senão o GDH novo seria coincidência.
        expect(p.temporalInicio).toBe(T0 + DELTA);
    });

    it('e o vazio do E8 também não depende da lente', async () => {
        // A outra metade da mesma invariante: sob D+N, um limite que sumiu continua
        // apagando o amplificador. Sem este caso, repor a pausa só para o ramo "tem
        // instante" passaria despercebido.
        mockTemporalConfigs.value = new Map([['TestMap', { modo: 'relativo' }]]);
        mockMapData.value.features.military_symbols.push(
            feicao('s1', { autoDtg: true, temporalFim: T_FIM, dateTimeGroup: DTG_VELHO }),
        );

        await shiftMapTemporalTimes('TestMap', DELTA);

        expect(persisted('military_symbols', 's1').dateTimeGroup).toBe('');
    });

    it('um tipo sem amplificador de data continua sem ganhar campo nenhum', async () => {
        mockMapData.value.features.points.push(feicao('p1', { autoDtg: true, temporalInicio: T0 }));

        await shiftMapTemporalTimes('TestMap', DELTA);

        const p = persisted('points', 'p1');
        expect(p.dateTimeGroup).toBeUndefined();
        expect(p.gdhIni).toBeUndefined();
        expect(p.gdhFim).toBeUndefined();
    });
});
