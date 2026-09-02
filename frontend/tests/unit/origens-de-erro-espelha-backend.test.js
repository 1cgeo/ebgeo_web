// Path: tests/unit/origens-de-erro-espelha-backend.test.js

/**
 * @fileoverview The error-origin vocabulary lives in TWO leaf modules, one per package
 * (`frontend/src/js/session/origens-de-erro.js` and
 * `backend/src/modules/diag/origens-de-erro.js`), and the backend one is what the Joi of
 * `POST /diag/erro-cliente` and the CHECK of `client_errors.origem` derive from. A value
 * added on the client and not on the server is refused with 422 and the WHOLE report is
 * lost, which is the failure mode this test exists to make red at build time instead of at
 * runtime. Same shape as `sync-trace-espelha-backend.test.js`: floor against an empty
 * comparison, absolute list, then the two-way set comparison. Scope: VOCABULARY only; what
 * each origin means is not asserted here.
 */

import { describe, it, expect } from 'vitest';
import { OrigemDeErro, ORIGENS_DE_ERRO } from '../../src/js/session/origens-de-erro.js';
import {
    OrigemDeErro as BackendOrigemDeErro,
    ORIGENS_DE_ERRO as BACKEND_ORIGENS_DE_ERRO,
} from '../../../backend/src/modules/diag/origens-de-erro.js';

const ESPERADAS = [
    'boot', 'nao-tratado', 'rejeicao', 'console', 'store',
    'ws', 'maplibre', 'cesium', 'sv360', 'indisponivel', 'servidor',
];

describe('o vocabulário de origem de erro do backend espelha o do frontend', () => {
    it('os dois módulos foram de fato carregados (piso contra comparação vazia)', () => {
        expect(ORIGENS_DE_ERRO.length).toBeGreaterThan(5);
        expect(BACKEND_ORIGENS_DE_ERRO.length).toBeGreaterThan(5);
        expect(Object.keys(OrigemDeErro).length).toBe(ORIGENS_DE_ERRO.length);
        expect(Object.keys(BackendOrigemDeErro).length).toBe(BACKEND_ORIGENS_DE_ERRO.length);
    });

    it('os onze valores são exatamente os esperados, dos DOIS lados e na mesma ordem', () => {
        expect([...ORIGENS_DE_ERRO]).toEqual(ESPERADAS);
        expect([...BACKEND_ORIGENS_DE_ERRO]).toEqual(ESPERADAS);
    });

    it('as chaves do objeto também coincidem (o nome que o código cita)', () => {
        expect(Object.keys(OrigemDeErro).sort()).toEqual(Object.keys(BackendOrigemDeErro).sort());
        for (const chave of Object.keys(OrigemDeErro)) {
            expect(OrigemDeErro[chave]).toBe(BackendOrigemDeErro[chave]);
        }
    });

    it('os dois lados são congelados: acrescentar valor em runtime não é caminho', () => {
        expect(Object.isFrozen(OrigemDeErro)).toBe(true);
        expect(Object.isFrozen(ORIGENS_DE_ERRO)).toBe(true);
        expect(Object.isFrozen(BackendOrigemDeErro)).toBe(true);
        expect(Object.isFrozen(BACKEND_ORIGENS_DE_ERRO)).toBe(true);
    });
});
