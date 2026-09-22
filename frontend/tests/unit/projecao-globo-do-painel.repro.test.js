// Path: tests/unit/projecao-globo-do-painel.repro.test.js

/**
 * @fileoverview A CAIXA "PROJEÇÃO GLOBO" DO PAINEL ERA INERTE, e saiu (decisão do dono,
 * 2026-09-22). O relato: na aba Sistema de `admin.html`, desmarcá-la deixava o mapa em globo.
 *
 * THE ROOT CAUSE. On 2026-08-16 the projection became an ATLAS setting
 * (`atlas.settings.globeProjection`, globe unless the atlas chose "Plano"), and the map stopped
 * reading the deploy key `map2d.globe_projection`. The key stayed alive on every other link of the
 * chain: the Sistema tab drew the box and saved it, Joi validated it, the server merged it and
 * `GET /api/config` served it, all for a month with no reader. Unticking it changed nothing, which
 * reads exactly like an inverted control.
 *
 * THE DECISION. Not re-animating the key (a first fix did, and the owner declined it the same day):
 * the default is ALWAYS globe and the atlas is the only one who changes it. So the key is PRUNED
 * end to end, and this suite pins the four places it could come back:
 *
 * 1. The map's resolver ignores any deploy config (the behavioural half is in
 *    `atlas-appearance.test.js`; here, that the service does not even import the config shell).
 * 2. The Sistema tab does not draw the box nor send the key.
 * 3. The client's config shell does not declare it.
 * 4. The server does not serve it and refuses it in the body. The stored-row half (an install that
 *    saved the box before the update: read does not break, save heals the row) needs a database
 *    and lives in `backend/tests/integration/config-admin.test.js`.
 * 5. The atlas settings modal lights the EFFECTIVE value through the same resolver the map uses.
 *
 * The structural reads strip comments, because every one of these files now explains in prose why
 * the key is gone, and that prose names it on purpose. Each has a NEGATIVE CONTROL: the removed
 * line, put back into the source, must be caught by the same reading.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { MAP2D_BASE } from '../../../backend/src/modules/config/config.static.js';
import { configOverridesSchema } from '../../../backend/src/modules/config/config.admin.schemas.js';

const SRC_JS = new URL('../../src/js/', import.meta.url);

/**
 * Strips JS comments, walking string literals so a `//` inside a string survives.
 * @param {string} source - Source text
 * @returns {string} Source without comments
 */
function stripComments(source) {
    let out = '';
    let i = 0;
    while (i < source.length) {
        const current = source[i];
        const next = source[i + 1];
        if (current === '/' && next === '/') {
            while (i < source.length && source[i] !== '\n') i++;
            continue;
        }
        if (current === '/' && next === '*') {
            i += 2;
            while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
            i += 2;
            continue;
        }
        if (current === '"' || current === "'" || current === '`') {
            const quote = current;
            out += source[i++];
            while (i < source.length && source[i] !== quote) {
                if (source[i] === '\\') out += source[i++];
                if (i < source.length) out += source[i++];
            }
            if (i < source.length) out += source[i++];
            continue;
        }
        out += source[i++];
    }
    return out;
}

/**
 * Reads a source file under `src/js/`, comments stripped.
 * @param {string} relative - Path relative to `src/js/`
 * @returns {string}
 */
function code(relative) {
    return stripComments(readFileSync(new URL(relative, SRC_JS), 'utf8'));
}

/** Any trace of the pruned deploy key or of the box, in code. */
const CHAVE_OU_CAIXA = /globe_projection|admin-config-map2d-globe|Projeção globo/;

// ============================================================================
// 1. The map's resolver
// ============================================================================

describe('o resolvedor do mapa não lê config de deploy', () => {
    const SERVICE = code('store/atlas-appearance.service.js');

    it('o serviço de aparência não importa a casca de config nem cita a chave', () => {
        expect(SERVICE).not.toMatch(/from\s+'@js\/config\.js'|from\s+'\.\.\/config\.js'/);
        expect(SERVICE).not.toMatch(CHAVE_OU_CAIXA);
    });

    it('a regra é a de 2026-08-16: só `false` do atlas achata', () => {
        expect(SERVICE).toMatch(/export function resolveGlobeProjection\(atlasChoice\) \{\s*return atlasChoice !== false;\s*\}/);
    });

    it('CONTROLE: a reanimação, reposta na fonte, é acusada', () => {
        const reanimada = SERVICE.replace(
            'return atlasChoice !== false;',
            "return atlasChoice === true || atlasChoice === false ? atlasChoice : config.map2d?.globe_projection !== false;",
        );
        expect(reanimada).not.toBe(SERVICE);
        expect(reanimada).toMatch(CHAVE_OU_CAIXA);
    });
});

// ============================================================================
// 2. The Sistema tab
// ============================================================================

describe('a aba Sistema não oferece a caixa', () => {
    const TAB = code('admin/config-tab.js');

    it('nem desenha a caixa, nem manda a chave no salvamento', () => {
        expect(TAB).not.toMatch(CHAVE_OU_CAIXA);
    });

    it('a seção Mapa 2D continua, com o que sobrou nela', () => {
        // Guards the scan against an emptied file: the neighbours of the removed box are there.
        expect(TAB).toContain("heading(form, 'Mapa 2D')");
        expect(TAB).toContain("'admin-config-map2d-maxpitch'");
        expect(TAB).toContain("'admin-config-map2d-hillshade'");
        expect(TAB).toMatch(/diffNum\(map2dDiff,\s*'maxPitch'/);
    });

    it('CONTROLE: a caixa e o envio, repostos na fonte, são acusados', () => {
        const comCaixa = TAB.replace(
            "const sombreamento = check(",
            "const globe = check(form, 'Projeção globo', 'admin-config-map2d-globe', !!eff.map2d?.globe_projection);\n        const sombreamento = check(",
        );
        expect(comCaixa).not.toBe(TAB);
        expect(comCaixa).toMatch(CHAVE_OU_CAIXA);

        const comEnvio = TAB.replace(
            /diffNum\(map2dDiff,\s*'maxPitch'[^;]*;/,
            (linha) => `${linha}\n            diffBool(map2dDiff, 'globe_projection', true, false);`,
        );
        expect(comEnvio).not.toBe(TAB);
        expect(comEnvio).toMatch(CHAVE_OU_CAIXA);
    });
});

// ============================================================================
// 3. The client's config shell
// ============================================================================

describe('a casca de config do cliente não declara a chave', () => {
    it('config.js não carrega `globe_projection` no piso de map2d', () => {
        const SHELL = code('config.js');
        expect(SHELL).toContain('map2d: {');
        expect(SHELL).not.toMatch(/globe_projection/);
    });
});

// ============================================================================
// 4. The server
// ============================================================================

describe('o servidor não serve a chave e a recusa no corpo', () => {
    it('o estático de map2d não a tem, e as vizinhas continuam lá', () => {
        expect('globe_projection' in MAP2D_BASE).toBe(false);
        expect(typeof MAP2D_BASE.maxPitch).toBe('number');
        expect(MAP2D_BASE.minZoom).toBe(2);
    });

    it('o schema do painel recusa a chave nomeando-a, com o mesmo gesto do zoom', () => {
        // Same options as the `validate` middleware: with `stripUnknown` alone the key would pass
        // through `.unknown(true)`, be stored, and the dead key would be back.
        const opcoes = { abortEarly: false, stripUnknown: true };
        for (const valor of [true, false]) {
            const { error } = configOverridesSchema.validate({ map2d: { globe_projection: valor } }, opcoes);
            expect(error, `globe_projection: ${valor}`).toBeDefined();
            expect(error.details.map((d) => d.path.join('.'))).toContain('map2d.globe_projection');
        }
    });

    it('CONTROLE: o resto de map2d continua aceito', () => {
        const { error } = configOverridesSchema.validate(
            { map2d: { maxPitch: 70, hillshade: { enabled: true } } },
            { abortEarly: false, stripUnknown: true },
        );
        expect(error).toBeUndefined();
    });
});

// ============================================================================
// 5. The atlas settings modal
// ============================================================================

describe('o modal do atlas acende a projeção EFETIVA', () => {
    const MODAL = readFileSync(new URL('modals/atlas-settings.modal.js', SRC_JS), 'utf8');

    it('a barra decide pelo mesmo resolvedor do mapa', () => {
        expect(MODAL).toMatch(/const choiceId = resolveGlobeProjection\(this\._appearance\.globeProjection\) \? 'globo' : 'plano';/);
    });

    it('o texto de ajuda diz o que é verdade: todo atlas começa como globo', () => {
        expect(MODAL).toContain('Todo atlas começa como globo.');
        expect(MODAL).not.toMatch(/padrão definido pelo administrador/);
    });
});
