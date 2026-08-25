// Path: tests/integration/atributo-reservado-em-camelcase-escapava.repro.test.js

/**
 * @fileoverview Repro: the reserved-name check let camelCase system properties through,
 * and the `attributes_imported` rename was dead code.
 *
 * TWO DEFECTS, ONE FILE, and they are mirror images of each other.
 *
 * 1. ROOT CAUSE (leak). `validateAttributeKey` asked
 *    `SYSTEM_PROPERTIES.has(trimmed.toLowerCase())`, and `SYSTEM_PROPERTIES` stores most
 *    of its names in camelCase (`fillColor`, `layerId`, `groupId`, `fontSize`, and
 *    dozens more). Lowercasing the key GUARANTEED the miss for every one of them: the
 *    only names actually protected were the handful already spelled lowercase.
 *    WHAT IT COST. The user could create a custom attribute named exactly like a real
 *    visual property, which then shadows it wherever the two meet.
 *    FIX. A lowercase index DERIVED from the set, so the two cannot drift the next time
 *    a name is added.
 *
 * 2. ROOT CAUSE (dead branch). `extractAttributesFromImport` carried an explicit branch
 *    renaming a scalar property literally named `attributes` to `attributes_imported`.
 *    But `'attributes'` is itself listed in SYSTEM_PROPERTIES (to stop the object form
 *    recursing), and the system skip ran FIRST, so the branch was unreachable.
 *    WHAT IT COST. An imported column named `attributes` was dropped without a trace,
 *    and its value never reached the sanitiser, which is how the branch was proved dead.
 *    FIX. Move the branch above the system skip, keeping the nullish skip ahead of the
 *    rename so a null does not become the string "null".
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const sanitizeHtml = vi.fn((s) => `[san]${s}`);

vi.mock('@store', () => ({
    getMapData: vi.fn(),
    updateFeature: vi.fn(),
    getCurrentMapNameSync: vi.fn(),
    getStorageTypeFromSource: vi.fn(),
    getEventBus: vi.fn(() => ({ emit: vi.fn(), on: vi.fn(), off: vi.fn() })),
}));
vi.mock('@utils', () => ({ IDUtils: { generateUniqueId: () => 'id-fixo' } }));
vi.mock('@sidebar/panels/notes-panel.js', () => ({
    sanitizeHtml: (...a) => sanitizeHtml(...a),
}));

const userDataManager = (await import('../../src/js/user_data/user_data_manager.js')).default;

beforeEach(() => {
    vi.clearAllMocks();
    sanitizeHtml.mockImplementation((s) => `[san]${s}`);
});

const validate = (key) => userDataManager.validateAttributeKey(key);
const extract = (props) => userDataManager.extractAttributesFromImport(props);

describe('nome reservado em camelCase nao escapa mais da validacao', () => {
    it('nenhum nome da lista de sistema valida como livre, em nenhuma grafia', () => {
        const system = userDataManager.getSystemProperties();
        // Cobertura vazia passaria verde com a lista vazia.
        expect(system.size).toBeGreaterThan(50);
        const escapando = [...system].filter((n) => validate(n).valid === true);
        expect(escapando).toEqual([]);
        const escapandoMaiuscula = [...system].filter((n) => validate(n.toUpperCase()).valid === true);
        expect(escapandoMaiuscula).toEqual([]);
    });

    it('os quatro nomes medidos como vazados sao recusados com a frase certa', () => {
        for (const nome of ['fillColor', 'layerId', 'groupId', 'fontSize']) {
            expect(validate(nome), nome)
                .toEqual({ valid: false, reason: 'Chave reservada pelo sistema' });
        }
    });

    it('CONTROLE: um nome fora da lista continua livre', () => {
        // Sem isto o conserto seria indistinguivel de recusar tudo.
        for (const nome of ['cota', 'minha cota', 'fillColorido', 'Observacao']) {
            expect(validate(nome), nome).toEqual({ valid: true });
        }
    });

    it('o indice e DERIVADO da lista, entao nao ha segunda lista para envelhecer', () => {
        // Propriedade estrutural: um nome novo na lista de sistema fica protegido
        // sem ninguem editar um segundo lugar. Provado pela igualdade de tamanho
        // do conjunto case-folded com o de nomes recusados.
        const system = [...userDataManager.getSystemProperties()];
        const recusados = system.filter((n) => validate(n).valid === false);
        expect(recusados).toHaveLength(system.length);
    });
});

describe('a coluna importada chamada "attributes" nao se perde mais', () => {
    it('um escalar vira `attributes_imported`, sanitizado', () => {
        expect(extract({ attributes: 'texto solto' }).attributes)
            .toEqual({ attributes_imported: '[san]texto solto' });
        expect(sanitizeHtml).toHaveBeenCalledWith('texto solto');
    });

    it('o zero e o falso tambem sobrevivem, como o resto do caminho de importacao', () => {
        expect(extract({ attributes: 0 }).attributes).toEqual({ attributes_imported: '[san]0' });
        expect(extract({ attributes: false }).attributes).toEqual({ attributes_imported: '[san]false' });
    });

    it('CONTROLE: a forma OBJETO continua sendo descartada, que era a intencao original', () => {
        // A entrada de `attributes` em SYSTEM_PROPERTIES existe para impedir recursao
        // sobre o proprio mapa de atributos, e isso nao mudou.
        expect(extract({ attributes: { a: 1 } }).attributes).toEqual({});
        expect(extract({ attributes: [1, 2] }).attributes).toEqual({});
    });

    it('CONTROLE: o nulo continua sendo descartado, e nao vira a string "null"', () => {
        // Mover o ramo para cima da guarda de nulo teria inventado um atributo.
        expect(extract({ attributes: null }).attributes).toEqual({});
        expect(extract({ attributes: undefined }).attributes).toEqual({});
    });

    it('o vizinho bem formado continua sendo extraido junto', () => {
        expect(extract({ attributes: 'x', cota: 900 }).attributes)
            .toEqual({ attributes_imported: '[san]x', cota: '[san]900' });
    });
});
