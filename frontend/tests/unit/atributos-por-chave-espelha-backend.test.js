// Path: tests/unit/atributos-por-chave-espelha-backend.test.js

/**
 * @fileoverview O CLIENTE E O SERVIDOR CONCORDAM SOBRE A BOLSA DE ATRIBUTOS POR CHAVE.
 *
 * A convergência por chave (decisão do dono em 2026-09-24) tem duas cópias do mesmo vocabulário: o
 * nome da propriedade cuja unidade é a chave (`ATTRIBUTES`) e as chaves que o servidor recusa no
 * caminho de três segmentos (`UNSAFE_ATTRIBUTE_KEYS`). A do cliente mora em
 * `frontend/src/js/store/sync/feature-patch.js` e decide quando a bolsa viaja inteira; a do servidor
 * mora em `backend/src/modules/sync/feature-conflicts.js` e decide o que ele recusa. Uma deriva em
 * qualquer direção é silenciosa: uma chave que só o servidor recusa volta como patch inválido em toda
 * edição daquela feição, e uma que só o cliente recusa manda a bolsa inteira de volta à disputa que a
 * mudança tirou.
 *
 * O molde é `sync-trace-espelha-backend.test.js`: os DOIS módulos no mesmo processo, um piso contra
 * a comparação vazia, o valor absoluto dos dois lados e a igualdade nas duas direções.
 */

import { describe, it, expect } from 'vitest';
import {
    ATTRIBUTES as CLIENTE_ATTRIBUTES,
    UNSAFE_ATTRIBUTE_KEYS as CLIENTE_RECUSADAS,
    featureMutationContract,
} from '../../src/js/store/sync/feature-patch.js';
import {
    ATTRIBUTES as SERVIDOR_ATTRIBUTES,
    UNSAFE_ATTRIBUTE_KEYS as SERVIDOR_RECUSADAS,
} from '../../../backend/src/modules/sync/feature-conflicts.js';

describe('a bolsa de atributos por chave, dos dois lados', () => {
    it('os dois módulos foram de fato carregados (piso contra comparação vazia)', () => {
        expect(typeof CLIENTE_ATTRIBUTES).toBe('string');
        expect(typeof SERVIDOR_ATTRIBUTES).toBe('string');
        expect(CLIENTE_RECUSADAS).toBeInstanceOf(Set);
        expect(SERVIDOR_RECUSADAS).toBeInstanceOf(Set);
        expect(CLIENTE_RECUSADAS.size).toBeGreaterThan(0);
        expect(SERVIDOR_RECUSADAS.size).toBeGreaterThan(0);
    });

    it('os valores são os esperados, dos DOIS lados', () => {
        expect(CLIENTE_ATTRIBUTES).toBe('attributes');
        expect(SERVIDOR_ATTRIBUTES).toBe('attributes');
        expect([...CLIENTE_RECUSADAS]).toEqual(['__proto__']);
        expect([...SERVIDOR_RECUSADAS]).toEqual(['__proto__']);
    });

    it('as chaves recusadas são as mesmas nas duas direções', () => {
        expect([...CLIENTE_RECUSADAS].sort()).toEqual([...SERVIDOR_RECUSADAS].sort());
    });

    it('o cliente manda a bolsa inteira exatamente para as chaves que o servidor recusaria', () => {
        const ponto = (attributes) => ({
            type: 'Feature', geometry: null,
            properties: { id: 'p1', source: 'point', confirmedVersion: 3, [CLIENTE_ATTRIBUTES]: attributes },
        });
        for (const chave of ['__proto__', 'constructor', 'prototype', 'nome', 'x']) {
            const depois = ponto(JSON.parse(JSON.stringify({ outra: 'um' })));
            Object.defineProperty(depois.properties[CLIENTE_ATTRIBUTES], chave, { value: 'v', enumerable: true, writable: true, configurable: true });
            const { patch } = featureMutationContract('update', depois, ponto({ outra: 'um' }));
            const inteira = patch.length === 1 && patch[0].path.length === 2;
            expect(inteira, `a chave "${chave}"`).toBe(SERVIDOR_RECUSADAS.has(chave));
        }
    });
});
