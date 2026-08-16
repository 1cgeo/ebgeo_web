// Path: tests/unit/atlas-appearance.test.js

/**
 * A parte de `atlas-appearance.service.js` que decide, e não a que grava: qual projeção o mapa
 * deve usar.
 *
 * DOIS ESTADOS, e o padrão é GLOBO. Houve um terceiro ("padrão do sistema", herdando a config de
 * deploy) que o dono cortou em 2026-08-16: uma escolha de duas respostas não precisa de uma
 * terceira que o usuário tenha de traduzir para saber o que vai ver. O que sobra a testar é a
 * assimetria — só `false` tira o globo, e ausência não é `false`.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@store/repositories/index.js', () => ({ getRepository: vi.fn() }));
vi.mock('@store/sync/operation-dispatcher.js', () => ({
    logSettingOperation: vi.fn(),
    OperationType: { UPDATE: 'update' },
}));

import {
    resolveGlobeProjection,
    setGlobeChoice,
    currentGlobeProjection,
    APPEARANCE_KEYS,
} from '@store/atlas-appearance.service.js';

describe('resolveGlobeProjection', () => {
    it('só `false` produz o mapa plano', () => {
        expect(resolveGlobeProjection(false)).toBe(false);
        expect(resolveGlobeProjection(true)).toBe(true);
    });

    it('sem escolha, globo — que é o padrão do produto', () => {
        expect(resolveGlobeProjection(null)).toBe(true);
        expect(resolveGlobeProjection(undefined)).toBe(true);
    });

    it('valor estranho NÃO vira plano', () => {
        // O caso que um `!atlasChoice` erraria: `0` e `''` são falsy e não significam "plano".
        // Eles vêm de `settings` antigo, e a resposta certa para lixo é o padrão.
        for (const lixo of [0, '', 'plano', 'globo', {}, [], NaN]) {
            expect(resolveGlobeProjection(lixo), String(lixo)).toBe(true);
        }
    });
});

describe('cache em memória', () => {
    it('guarda a escolha e responde igual ao resolvedor', () => {
        setGlobeChoice(false);
        expect(currentGlobeProjection()).toBe(false);
        setGlobeChoice(true);
        expect(currentGlobeProjection()).toBe(true);
        setGlobeChoice(null);
        expect(currentGlobeProjection()).toBe(true);
    });

    it('valor estranho degrada para o padrão, nunca para uma escolha inventada', () => {
        for (const lixo of ['sim', 0, 1, {}, []]) {
            setGlobeChoice(lixo);
            expect(currentGlobeProjection(), String(lixo)).toBe(true);
        }
    });
});

describe('APPEARANCE_KEYS', () => {
    it('é a autoridade que o guarda de compactação lê, e está congelada', () => {
        // `compactacao-id-nao-unico.test.js` extrai esta lista do código-fonte. Se ela deixar de
        // ser um `Object.freeze([...])` de literais, aquele extrator emagrece em silêncio.
        expect([...APPEARANCE_KEYS]).toEqual(['terrainExaggeration', 'globeProjection']);
        expect(Object.isFrozen(APPEARANCE_KEYS)).toBe(true);
    });
});
