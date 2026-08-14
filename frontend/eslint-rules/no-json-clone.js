// Path: eslint-rules/no-json-clone.js
// `JSON.parse(JSON.stringify(x))` is not a clone, it is a round trip through a
// format that cannot represent what this app stores. The JSON idiom silently
// DROPS `undefined`, functions and `Symbol` keys, TURNS a `Date` into a string
// and a `Map`/`Set` into `{}`, collapses `NaN`/`Infinity` to `null`, and THROWS
// on a circular reference. None of that fails loudly here: a feature carrying
// sync metadata (`updatedAt`, `version`, `dirty`) survives the round trip
// looking fine, is persisted to IndexedDB, is pushed as an operation, and the
// corruption only surfaces later as a bad LWW comparison or a lost field on a
// peer. That is why the constitution makes `deepClone()`
// (`@utils/deep-utils.js`) mandatory: it preserves `Date`, keeps `undefined`
// values, and handles a `__proto__` data key without polluting the prototype.
//
// Deliberately NOT flagged (false positive here is worse than a miss: the
// frontend lints with `--max-warnings 0`, so a noisy rule gets switched off):
//   - the two-step form (`const s = JSON.stringify(x); JSON.parse(s)`) — it is
//     the same defect, but catching it needs flow analysis, and the guesswork
//     would cost more than it buys;
//   - a `JSON.stringify` with a real replacer (`JSON.parse(JSON.stringify(u,
//     ['id','nome']))`) — that is a deliberate PROJECTION of a subset of
//     fields, not an attempt to copy the object faithfully;
//   - a `JSON.parse` with a reviver — the reviver exists precisely to rebuild
//     what JSON lost (typically `Date`), so the author already knows;
//   - the explicit `structuredClone` feature-detection fallback
//     (`typeof structuredClone === 'function' ? structuredClone(v) : ...`) —
//     that is a polyfill, and the fast path is a real deep clone;
//   - `JSON.parse(text)` / `JSON.stringify(obj)` on their own, which are
//     ordinary serialization and none of this rule's business;
//   - an aliased `JSON` (`globalThis.JSON.parse(...)`, `const J = JSON`), which
//     does not occur in this codebase and is not worth the ambiguity.
//
// Scoping (the numbers, measured with the real `eslint .` file walk over 970
// files): `frontend/src/js/` has ZERO occurrences today, so the rule is a pure
// ratchet there. `frontend/tests/` has four, and at least one of them is a
// deliberate test double (`vi.mock(deep-utils, { deepClone: (o) =>
// JSON.parse(JSON.stringify(o)) })`) where "use deepClone()" is circular
// advice. Point the rule at product code (`src/**`), not at the test tree.

/** Matches `JSON.<name>` used as a callee, e.g. `JSON.parse`. */
function isJsonMember(node, name) {
    return (
        node.type === 'MemberExpression' &&
        !node.computed &&
        node.object.type === 'Identifier' &&
        node.object.name === 'JSON' &&
        node.property.type === 'Identifier' &&
        node.property.name === name
    );
}

/** `null` literal or the `undefined` identifier — i.e. "no replacer". */
function isNullish(node) {
    if (!node) return true;
    if (node.type === 'Literal' && node.value === null) return true;
    return node.type === 'Identifier' && node.name === 'undefined';
}

/**
 * True when the call sits in the fallback branch of an explicit
 * `structuredClone` availability check. Looking at the guard's source text is
 * enough: any test mentioning `structuredClone` around this call is a polyfill.
 */
function isStructuredCloneFallback(sourceCode, ancestors) {
    for (const ancestor of ancestors) {
        let guard = null;
        if (ancestor.type === 'ConditionalExpression' || ancestor.type === 'IfStatement') {
            guard = ancestor.test;
        } else if (ancestor.type === 'LogicalExpression') {
            guard = ancestor.left;
        }
        if (guard && sourceCode.getText(guard).includes('structuredClone')) return true;
    }
    return false;
}

export default {
    meta: {
        type: 'problem',
        docs: {
            description:
                'proíbe `JSON.parse(JSON.stringify(x))` como clonagem — use `deepClone()`',
        },
        schema: [],
        messages: {
            jsonClone:
                'Isto não é uma cópia, é uma ida e volta por JSON: perde `undefined`, função e `Symbol`, transforma `Date` em string, `Map`/`Set` em `{}`, `NaN`/`Infinity` em `null`, e estoura em referência circular. Use `deepClone(x)` de `@utils/deep-utils.js` (importe `import { deepClone } from \'@utils/deep-utils.js\';`); se o objeto for garantidamente serializável e você quiser a via nativa, use `structuredClone(x)`.',
        },
    },
    create(context) {
        const sourceCode = context.sourceCode;

        return {
            CallExpression(node) {
                if (!isJsonMember(node.callee, 'parse')) return;
                // A reviver rebuilds what JSON dropped — the author knows.
                if (node.arguments.length > 1) return;

                const inner = node.arguments[0];
                if (!inner || inner.type !== 'CallExpression') return;
                if (!isJsonMember(inner.callee, 'stringify')) return;
                // A real replacer means projection, not cloning.
                if (inner.arguments.length > 1 && !isNullish(inner.arguments[1])) return;

                if (isStructuredCloneFallback(sourceCode, sourceCode.getAncestors(node))) return;

                context.report({ node, messageId: 'jsonClone' });
            },
        };
    },
};
