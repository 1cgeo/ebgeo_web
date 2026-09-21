// Path: tests/unit/nomes-temporais-reservados.repro.test.js

/**
 * @fileoverview REPRO do achado I8 da auditoria do sistema temporal
 * (2026-09-21): a lista de propriedades de sistema conhecia 8 dos 26 nomes de
 * coluna temporal que a importação reconhece.
 *
 * A causa é uma cópia à mão. `user_data/user_data_manager.js` carregava um
 * bloco temporal escrito à mão (12 entradas, 8 nomes distintos em minúsculas) e
 * `temporal/temporal-import.js` reconhece 26. As 18 colunas que faltavam viravam
 * a janela de validade E permaneciam na feição como atributo do usuário: o
 * mesmo dado duas vezes, uma delas num campo que o painel de atributos mostra e
 * que a pessoa pode editar sem efeito nenhum sobre a linha do tempo.
 *
 * A segunda metade da causa: a consulta de importação comparava com distinção
 * de maiúsculas (`SYSTEM_PROPERTIES.has(key)`) embora o arquivo já derivasse um
 * índice em caixa baixa para a outra porta (`validateAttributeKey`), de modo que
 * uma coluna escrita `BEGIN` ou `Inicio` escapava do filtro.
 *
 * O conserto é derivar, não recopiar: `TEMPORAL_SOURCE_KEYS` é exportado pelo
 * importador e entra na lista de sistema por spread, então um nome novo lá é
 * reservado aqui no mesmo commit.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    TEMPORAL_SOURCE_KEYS,
    START_KEY_ORDER,
    END_KEY_ORDER,
    INSTANT_KEY_ORDER,
    extractTemporalProperties,
} from '../../src/js/temporal/temporal-import.js';

const sanitizeHtml = vi.fn((s) => `[san]${s}`);

vi.mock('@store', () => ({
    getMapData: vi.fn(),
    updateFeature: vi.fn(),
    getCurrentMapNameSync: vi.fn(),
    getStorageTypeFromSource: vi.fn(),
    getEventBus: vi.fn(() => ({ emit: vi.fn(), on: vi.fn(), off: vi.fn() })),
}));

vi.mock('@utils', () => ({
    IDUtils: { generateUniqueId: () => 'id-fixo' },
}));

vi.mock('@sidebar/panels/notes-panel.js', () => ({
    sanitizeHtml: (...a) => sanitizeHtml(...a),
}));

const userDataManager = (await import('../../src/js/user_data/user_data_manager.js')).default;

beforeEach(() => {
    vi.clearAllMocks();
    sanitizeHtml.mockImplementation((s) => `[san]${s}`);
});

const extract = (props) => userDataManager.extractAttributesFromImport(props);
const validate = (key) => userDataManager.validateAttributeKey(key);

describe('I8: os 26 nomes temporais são reservados, não 8', () => {
    it('o vocabulário do importador tem 26 nomes', () => {
        expect(TEMPORAL_SOURCE_KEYS.size).toBe(26);
        expect(START_KEY_ORDER).toHaveLength(11);
        expect(END_KEY_ORDER).toHaveLength(10);
        expect(INSTANT_KEY_ORDER).toHaveLength(5);
    });

    it('NENHUM deles vira atributo do usuário na importação', () => {
        for (const nome of TEMPORAL_SOURCE_KEYS) {
            const { attributes } = extract({ [nome]: '05/11/2024' });
            expect(attributes, `a coluna "${nome}" virou atributo`).toEqual({});
        }
    });

    it('nenhum deles pode ser criado à mão como atributo', () => {
        for (const nome of TEMPORAL_SOURCE_KEYS) {
            expect(validate(nome).valid, `a chave "${nome}" foi aceita`).toBe(false);
        }
    });

    it('a consulta é insensível à caixa, nos dois caminhos', () => {
        for (const nome of ['BEGIN', 'Inicio', 'Data_Fim', 'StartTime', 'WHEN']) {
            expect(extract({ [nome]: '05/11/2024' }).attributes).toEqual({});
            expect(validate(nome).valid).toBe(false);
        }
    });

    it('os 18 nomes que escapavam estão nomeados e fechados', () => {
        const escapavam = [
            'start', 'starttime', 'start_time', 'startdate', 'start_date',
            'datainicio', 'data_inicio', 'inicio',
            'endtime', 'end_time', 'enddate', 'end_date',
            'datafim', 'data_fim', 'fim',
            'time', 'date', 'datetime',
        ];
        expect(escapavam).toHaveLength(18);
        for (const nome of escapavam) {
            expect(TEMPORAL_SOURCE_KEYS.has(nome), `${nome} saiu do importador`).toBe(true);
            expect(extract({ [nome]: 1000 }).attributes).toEqual({});
        }
    });

    it('a MESMA coluna que vira janela não sobra como atributo (o defeito em uma linha)', () => {
        const linha = { inicio: '05/11/2024', fim: '25/12/2024', nome_da_om: '1 CGEO' };
        expect(extractTemporalProperties(linha)).toEqual({
            temporalInicio: new Date(2024, 10, 5).getTime(),
            temporalFim: new Date(2024, 11, 25).getTime(),
        });
        expect(extract(linha).attributes).toEqual({ nome_da_om: '[san]1 CGEO' });
    });
});

describe('I8: o que NÃO mudou', () => {
    it('coluna comum continua virando atributo, sanitizada', () => {
        expect(extract({ efetivo: 42, unidade_apoiada: 'x' }).attributes).toEqual({
            efetivo: '[san]42',
            unidade_apoiada: '[san]x',
        });
    });

    it('nome que apenas CONTÉM um nome temporal continua livre', () => {
        for (const nome of ['inicio_da_missao', 'data_inicio_real', 'begins']) {
            expect(validate(nome).valid).toBe(true);
            expect(Object.keys(extract({ [nome]: 'v' }).attributes)).toEqual([nome]);
        }
    });

    it('a trajetória e os campos canônicos seguem reservados', () => {
        for (const nome of ['trajetoria', 'temporalInicio', 'temporalFim', 'timespan']) {
            expect(extract({ [nome]: 'v' }).attributes).toEqual({});
        }
    });
});
