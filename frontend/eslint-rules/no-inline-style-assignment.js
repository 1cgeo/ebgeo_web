// Path: eslint-rules/no-inline-style-assignment.js
// A CSS block written inside the JS is invisible to the whole styling system:
// Stylelint never sees it, `design-tokens.css` cannot reach it, and a theme
// change leaves it behind. The failure mode is concrete and already in the
// tree: the vertex-removal warning toast is built three times, in three tools
// (line/arrow/boundary), each with its own copy of the same fifteen hardcoded
// declarations (`background-color: #f44336`, `z-index: 10000`, a font stack),
// so a token change updates none of them and the three copies drift apart.
//
// The constitution allows exactly ONE inline exception: a value COMPUTED at
// runtime (a color coming from the data, a position calculated from the map).
// This rule is built around that exception instead of around the syntax: it
// counts only declarations that are fully STATIC, and fires only when a single
// assignment carries MIN_STATIC_DECLARATIONS of them. A template whose
// declarations are all interpolated is, by construction, computed style and is
// never reported.
//
// DELIBERATELY NOT CAUGHT (measured over frontend/src/js/, 2026-08):
//   - `el.style.<prop> = value`, single-property assignment: 617 occurrences,
//     the large majority genuinely computed (`left = x + 'px'`, `display`
//     toggles, cursor swaps). Flagging it would produce hundreds of reports,
//     and under `--max-warnings 0` the next developer's cheapest fix is to
//     delete the rule. A lone property is also the shape the exception
//     actually takes.
//   - `el.style.setProperty(name, value)` (9 occurrences): that is how a custom
//     property is fed from JS, i.e. the tokens system working as designed.
//   - `cssText` fed an identifier, a call or a concatenation: not inspectable
//     here, and guessing produces false positives.
//   - `cssText` with one or two static declarations (e.g. the off-screen
//     `position:fixed;left:-9999px` textarea in the clipboard fallback): too
//     small to be a stylesheet in disguise, and usually a mechanical trick
//     rather than an appearance decision.
// False positives are worse than false negatives here: a rule nobody can
// afford to switch on is worth nothing.

// One declaration is a trick; three is a stylesheet in the wrong file.
const MIN_STATIC_DECLARATIONS = 3;

// Stands in for a `${...}` interpolation while the CSS text is scanned, so a
// declaration containing one is recognizable as computed. It must be a string
// that cannot occur in real CSS: an ordinary character (a space, say) would
// also match inside `position: absolute` and mark EVERY declaration computed,
// which is precisely how a rule stops reporting without ever saying so.
const HOLE = '@@ebgeo-expr@@';

/**
 * @param {import('estree').Node} node
 * @returns {boolean} true for `<something>.style`
 */
function isStyleMember(node) {
  if (!node || node.type !== 'MemberExpression') return false;
  if (node.computed) {
    return node.property.type === 'Literal' && node.property.value === 'style';
  }
  return node.property.type === 'Identifier' && node.property.name === 'style';
}

/**
 * @param {import('estree').Node} node
 * @returns {boolean} true for `<something>.style.cssText`
 */
function isCssTextTarget(node) {
  if (!node || node.type !== 'MemberExpression') return false;
  const name = node.computed
    ? node.property.type === 'Literal' && node.property.value
    : node.property.type === 'Identifier' && node.property.name;
  return name === 'cssText' && isStyleMember(node.object);
}

/**
 * Renders the assigned expression as CSS text with every interpolation replaced
 * by HOLE. Returns null when the expression cannot be read statically at all
 * (identifier, call, concatenation), which is left alone on purpose.
 * @param {import('estree').Node} node
 * @returns {string | null}
 */
function readCssText(node) {
  if (node.type === 'Literal') {
    return typeof node.value === 'string' ? node.value : null;
  }
  if (node.type === 'TemplateLiteral') {
    return node.quasis.map((q) => q.value.cooked ?? '').join(HOLE);
  }
  return null;
}

/**
 * Counts declarations carrying no interpolation, i.e. the ones the
 * runtime-computed-value exception does not cover.
 * @param {string} css
 * @returns {number}
 */
function countStaticDeclarations(css) {
  return css
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !part.includes(HOLE) && part.includes(':')).length;
}

export default {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'proíbe bloco de CSS estático dentro do JS (`style.cssText` e `Object.assign(el.style, {...})`)',
    },
    schema: [],
    messages: {
      cssTextBlock:
        'Bloco de CSS dentro do JS: {{count}} declarações fixas em `style.cssText`. Mova para uma classe BEM em `frontend/src/css/`, com os custom properties de `design-tokens.css`, e deixe aqui só `classList.add(...)`. Estilo inline vale para valor computado em runtime (cor vinda do dado, posição calculada), não para aparência fixa: assim escrita, ela não segue troca de tema e some do alcance do Stylelint.',
      styleObjectBlock:
        'Bloco de CSS dentro do JS: {{count}} propriedades fixas em `Object.assign(el.style, {...})`. Mova para uma classe BEM em `frontend/src/css/`, com os custom properties de `design-tokens.css`, e deixe aqui só `classList.add(...)`. Estilo inline vale para valor computado em runtime, não para aparência fixa.',
    },
  },
  create(context) {
    return {
      AssignmentExpression(node) {
        if (node.operator !== '=' && node.operator !== '+=') return;
        if (!isCssTextTarget(node.left)) return;
        const css = readCssText(node.right);
        if (css === null) return;
        const count = countStaticDeclarations(css);
        if (count < MIN_STATIC_DECLARATIONS) return;
        context.report({ node, messageId: 'cssTextBlock', data: { count } });
      },

      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type !== 'MemberExpression' ||
          callee.computed ||
          callee.property.type !== 'Identifier' ||
          callee.property.name !== 'assign' ||
          callee.object.type !== 'Identifier' ||
          callee.object.name !== 'Object'
        ) {
          return;
        }
        if (node.arguments.length < 2 || !isStyleMember(node.arguments[0])) return;
        // Every source object merged into `.style` counts toward the same block.
        let count = 0;
        for (const arg of node.arguments.slice(1)) {
          if (arg.type !== 'ObjectExpression') continue;
          for (const prop of arg.properties) {
            if (prop.type !== 'Property') continue;
            if (prop.value.type === 'Literal') count += 1;
          }
        }
        if (count < MIN_STATIC_DECLARATIONS) return;
        context.report({ node, messageId: 'styleObjectBlock', data: { count } });
      },
    };
  },
};
