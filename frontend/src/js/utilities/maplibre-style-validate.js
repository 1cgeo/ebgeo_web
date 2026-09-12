// Path: js/utilities/maplibre-style-validate.js

/**
 * @fileoverview Minimal MapLibre GL style validation, used by the admin basemap-style editor to
 * reject a malformed style BEFORE it is saved (a broken style would brick the map). This is a
 * lightweight structural check (not the full style spec): it pins the invariants the app relies on
 * — `version: 8`, a `sources` object, and a `layers` array. Pure + Node-testable.
 */

/**
 * Structurally validates a parsed MapLibre style object.
 * @param {*} style - A parsed style object.
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateMapLibreStyle(style) {
    if (style === null || typeof style !== 'object' || Array.isArray(style)) {
        return { ok: false, errors: ['O estilo deve ser um objeto JSON.'] };
    }
    const errors = [];
    if (style.version !== 8) {
        errors.push('O estilo deve ter "version": 8.');
    }
    if (style.sources === null || typeof style.sources !== 'object' || Array.isArray(style.sources)) {
        errors.push('O estilo deve ter "sources" como objeto.');
    }
    const fontesOk = style.sources !== null && typeof style.sources === 'object' && !Array.isArray(style.sources);
    if (!Array.isArray(style.layers)) {
        errors.push('O estilo deve ter "layers" como um array.');
    } else {
        // O CONTRATO DA CAMADA, e ele nao e enfeite. Camada sem `type` o MapLibre nao
        // desenha, e o estilo passa a mostrar menos do que declara; camada apontando
        // fonte que o estilo nao tem e a mesma falha com causa mais barulhenta. As duas
        // passavam aqui: medido em 2026-09-11 contra o estilo Overture real, onde
        // `{ version: 8, sources: {}, layers: [{ id: 'x' }] }` era aceito.
        const vistos = new Set();
        style.layers.forEach((camada, i) => {
            if (camada === null || typeof camada !== 'object' || Array.isArray(camada)) {
                errors.push(`A camada no indice ${i} deve ser um objeto.`);
                return;
            }
            const nome = typeof camada.id === 'string' && camada.id ? `"${camada.id}"` : `no indice ${i}`;
            if (typeof camada.id !== 'string' || !camada.id) {
                errors.push(`A camada no indice ${i} deve ter "id" como string nao vazia.`);
            } else if (vistos.has(camada.id)) {
                errors.push(`Id de camada repetido: "${camada.id}".`);
            } else {
                vistos.add(camada.id);
            }
            if (typeof camada.type !== 'string' || !camada.type) {
                errors.push(`A camada ${nome} deve ter "type" como string nao vazia.`);
            }
            if (camada.source !== undefined && fontesOk
                && !Object.prototype.hasOwnProperty.call(style.sources, camada.source)) {
                errors.push(`A camada ${nome} aponta a fonte "${camada.source}", que o estilo nao declara.`);
            }
        });
    }
    return { ok: errors.length === 0, errors };
}

/**
 * Parses style JSON text and structurally validates it.
 * @param {string} text - JSON text.
 * @returns {{ ok: boolean, errors: string[], style: Object|null }}
 */
export function parseStyleJson(text) {
    let style;
    try {
        style = JSON.parse(text);
    } catch (e) {
        return { ok: false, errors: [`JSON inválido: ${e.message}`], style: null };
    }
    const result = validateMapLibreStyle(style);
    return { ok: result.ok, errors: result.errors, style: result.ok ? style : null };
}
