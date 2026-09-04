// Path: tests/unit/setup-mode.test.js

/**
 * @fileoverview O modo leve de `setupMapFeatures` so vale quando as DUAS coisas
 * sao verdade, e a segunda e a que salva: o chamador dizer que o mapa nao mudou
 * NAO basta, porque o MapLibre pode ter caido na remontagem do estilo do zero
 * (`Style.setState` levanta -> `_updateStyle`) e levado as sources do app junto.
 */
import { describe, it, expect } from 'vitest';

import { resolveSetupMode } from '../../src/js/layers/setup-mode.js';

describe('resolveSetupMode', () => {
    it('keeps the content only when the caller says so AND an application source survived', () => {
        expect(resolveSetupMode({ contentPreserved: true }, true)).toBe('preserved');
    });

    it('rebuilds when the caller did not say the map is the same (atlas map switch, undo/redo)', () => {
        expect(resolveSetupMode(undefined, true)).toBe('full');
        expect(resolveSetupMode({}, true)).toBe('full');
        expect(resolveSetupMode({ contentPreserved: false }, true)).toBe('full');
    });

    it('rebuilds when the style swap dropped the application sources (MapLibre full-rebuild fallback)', () => {
        expect(resolveSetupMode({ contentPreserved: true }, false)).toBe('full');
        expect(resolveSetupMode({ contentPreserved: true }, undefined)).toBe('full');
    });

    it('nao aceita valor aproximado em nenhum dos dois eixos', () => {
        // A comparacao e estrita nos dois lados de proposito: `map.getSource(id)`
        // devolve o objeto ou undefined, e o chamador passa o resultado de `!!`.
        // Um truthy solto aqui (uma string, um objeto) significaria que alguem
        // passou a source em vez do predicado, e o modo leve seria tomado por
        // engano num caminho que precisa remontar.
        expect(resolveSetupMode({ contentPreserved: 'sim' }, true)).toBe('full');
        expect(resolveSetupMode({ contentPreserved: 1 }, true)).toBe('full');
        expect(resolveSetupMode({ contentPreserved: true }, { type: 'geojson' })).toBe('full');
        expect(resolveSetupMode({ contentPreserved: true }, 1)).toBe('full');
        expect(resolveSetupMode(null, true)).toBe('full');
    });
});
