// Path: js/store/namespace-generation.js

const PREFIX = 'ebgeo_atlas_generation:';

/** One atomic localStorage record selects both the data generation and its applied cursor. */
export function readGeneration(scope) {
    const raw = globalThis.localStorage?.getItem(PREFIX + scope.dbSuffix);
    if (!raw) return { active: null, known: [], cursor: 0 };
    const value = JSON.parse(raw);
    const valid = generation => generation === null || (typeof generation === 'string' && /^[a-zA-Z0-9-]+$/.test(generation));
    if (!value || !valid(value.active) || !Array.isArray(value.known) || !value.known.every(valid)
        || !Number.isSafeInteger(value.cursor) || value.cursor < 0) {
        throw new Error('O registro de recuperação deste atlas está inválido.');
    }
    return value;
}

export function writeGeneration(scope, value) {
    if (!globalThis.localStorage) throw new Error('Não foi possível guardar o registro de recuperação do atlas.');
    globalThis.localStorage.setItem(PREFIX + scope.dbSuffix, JSON.stringify(value));
}

export function captureDataScope(scope) {
    if (!scope || Object.hasOwn(scope, 'dataGeneration')) return scope;
    return { ...scope, dataGeneration: readGeneration(scope).active };
}

export function dataGenerationFor(scope) {
    return Object.hasOwn(scope, 'dataGeneration') ? scope.dataGeneration : readGeneration(scope).active;
}
