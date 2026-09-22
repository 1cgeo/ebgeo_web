// Path: tests/unit/atlas-appearance.test.js

/**
 * A parte de `atlas-appearance.service.js` que decide, e não a que grava: qual projeção o mapa
 * deve usar.
 *
 * DOIS ESTADOS, e o padrão é GLOBO. Houve um terceiro ("padrão do sistema", herdando a config de
 * deploy) que o dono cortou em 2026-08-16: uma escolha de duas respostas não precisa de uma
 * terceira que o usuário tenha de traduzir para saber o que vai ver. O que sobra a testar é a
 * assimetria (só `false` tira o globo, e ausência não é `false`) e, desde 2026-09-22, que a config
 * de deploy NÃO entra na conta nem quando um servidor ainda carrega a chave antiga
 * (`map2d.globe_projection`, podada nos dois pacotes naquela data). O contrato inteiro, painel e
 * servidor incluídos, está em `projecao-globo-do-painel.repro.test.js`.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@store/repositories/index.js', () => ({ getRepository: vi.fn() }));
vi.mock('@store/sync/operation-dispatcher.js', () => ({
    logSettingOperation: vi.fn(),
    OperationType: { UPDATE: 'update' },
}));

import config from '@js/config.js';
import {
    resolveGlobeProjection,
    setGlobeChoice,
    currentGlobeProjection,
    APPEARANCE_KEYS,
} from '@store/atlas-appearance.service.js';

afterEach(() => {
    // The cases below plant the pruned key on the shared config singleton; take it back out.
    delete config.map2d.globe_projection;
    setGlobeChoice(null);
});

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

    it('a config de deploy NÃO decide, nem quando ainda carrega a chave antiga', () => {
        // An outdated server (or a hand-written payload) can still hydrate
        // `config.map2d.globe_projection: false`. The atlas that never chose stays a globe: the
        // deploy key was the admin box pruned on 2026-09-22, and reading it here is the
        // re-animation the owner declined.
        config.map2d.globe_projection = false;
        expect(resolveGlobeProjection(null)).toBe(true);
        expect(resolveGlobeProjection(undefined)).toBe(true);
        // And the atlas choice still decides in both directions.
        expect(resolveGlobeProjection(false)).toBe(false);
        expect(resolveGlobeProjection(true)).toBe(true);
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

    it('o caminho que o mapa aplica também ignora a chave de deploy', () => {
        // `currentGlobeProjection()` is what map_sig, the base-layer swap and the terrain toggle
        // call, so this is the path that decides what the map draws.
        config.map2d.globe_projection = false;
        setGlobeChoice(null);
        expect(currentGlobeProjection()).toBe(true);
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
