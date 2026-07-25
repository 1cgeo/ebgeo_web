// Path: eslint-rules/assert-utils.js
// Shared AST helpers for the local test-hygiene rules (no-conditional-assert,
// no-disjunctive-assert, no-unasserted-loop-assert).
//
// These rules encode the "escotilha" blind spot from testes-backend.md: an
// assertion that only runs when some unverified condition happens to hold is
// not an assertion, it is the constitution's "cobertura vazia" — it passes with
// the code arbitrarily wrong.
//
// APPROXIMATION (deliberately conservative — false negatives preferred over
// false positives). "The condition was asserted" is decided TEXTUALLY: we look
// for an assert call that appears BEFORE the construct, inside the same
// enclosing function, whose source text mentions the same key expression. This
// means:
//   - We do NOT understand semantics. `assert.ok(x !== undefined)` before
//     `if (x)` counts as coverage even though it does not pin `x` truthy.
//   - We do NOT track reassignment between the assertion and the condition.
//   - Assertions living in a `before()` hook or an earlier `it()` do NOT count
//     (scope stops at the enclosing function), so a genuinely covered case can
//     still be reported; assert next to the branch, or add an inline waiver.
//   - Only the leaf member paths of the condition are considered, and ANY one
//     of them being mentioned is enough (a conjunction where only one side was
//     asserted passes).
//   - `assert` is recognised by the callee text starting with `assert`, which is
//     the only style this suite uses. A helper that wraps assertions
//     (`expectScopedTo(...)`) is invisible to the rules.
//
// The negative control that keeps these approximations honest lives in
// ./probe.js + ./__fixtures__/, and runs as part of `npm run lint`.

const ASSERT_ROOT = /^assert\b/;

/** True for `assert(...)`, `assert.ok(...)`, `assert.strictEqual(...)`, ... */
export function isAssertCall(sourceCode, node) {
  return node.type === 'CallExpression' && ASSERT_ROOT.test(sourceCode.getText(node.callee));
}

/** `assert.fail(...)` inside a branch IS the assertion of that branch. */
export function isAssertFail(sourceCode, node) {
  return /^assert\.fail\b/.test(sourceCode.getText(node.callee));
}

const SKIP_KEYS = new Set(['parent', 'loc', 'range', 'start', 'end', 'tokens', 'comments']);

/** Depth-first walk over child AST nodes. */
export function walk(node, visit) {
  if (!node || typeof node.type !== 'string') return;
  visit(node);
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child && typeof child.type === 'string') walk(child, visit);
      }
    } else if (value && typeof value.type === 'string') {
      walk(value, visit);
    }
  }
}

/** First assert call found anywhere inside `node`, or null. */
export function findAssertIn(sourceCode, node) {
  let found = null;
  walk(node, (n) => {
    if (!found && isAssertCall(sourceCode, n)) found = n;
  });
  return found;
}

/**
 * Visits every node that runs BEFORE `node` within the same enclosing function.
 * Statement lists of every ancestor block up to (and excluding) the nearest
 * function are scanned.
 */
function forEachPreceding(node, visit) {
  let current = node;
  let parent = node.parent;
  while (parent) {
    const lists = [];
    if (parent.type === 'BlockStatement' || parent.type === 'Program') lists.push(parent.body);
    if (parent.type === 'SwitchCase') lists.push(parent.consequent);
    for (const list of lists) {
      const index = list.indexOf(current);
      if (index < 0) continue;
      for (let i = 0; i < index; i++) walk(list[i], visit);
    }
    if (/^(FunctionExpression|FunctionDeclaration|ArrowFunctionExpression)$/.test(parent.type)) {
      break;
    }
    current = parent;
    parent = parent.parent;
  }
}

/** Concatenated source of every assert call that runs before `node`. */
export function precedingAssertText(sourceCode, node) {
  const chunks = [];
  forEachPreceding(node, (n) => {
    if (isAssertCall(sourceCode, n)) chunks.push(sourceCode.getText(n));
  });
  return chunks.join('\n');
}

/** A statement that unconditionally leaves the current path. */
function exitsUnconditionally(node) {
  if (!node) return false;
  if (/^(BreakStatement|ContinueStatement|ReturnStatement|ThrowStatement)$/.test(node.type)) {
    return true;
  }
  return node.type === 'BlockStatement' && node.body.some(exitsUnconditionally);
}

/**
 * Concatenated source of the conditions of every preceding early-exit guard
 * (`if (ops.length === 0) break;`). Such a guard PROVES the collection is
 * non-empty from that point on, which is exactly what the loop rule wants —
 * the proof just is not spelled as an assert.
 */
export function precedingExitGuardText(sourceCode, node) {
  const chunks = [];
  forEachPreceding(node, (n) => {
    if (n.type === 'IfStatement' && exitsUnconditionally(n.consequent)) {
      chunks.push(sourceCode.getText(n.test));
    }
  });
  return chunks.join('\n');
}

/**
 * Leaf identifier / member-expression source texts of an expression. Only the
 * outermost member path is kept (`res.body.data.isSnapshot`, not `res`), which
 * is what makes the textual match specific enough to be worth anything.
 */
export function keyPaths(sourceCode, node, out = new Set()) {
  if (!node || typeof node.type !== 'string') return out;
  if (node.type === 'MemberExpression' || node.type === 'Identifier') {
    out.add(sourceCode.getText(node));
    return out;
  }
  if (node.type === 'CallExpression') {
    keyPaths(sourceCode, node.callee, out);
    node.arguments.forEach((a) => keyPaths(sourceCode, a, out));
    return out;
  }
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const value = node[key];
    if (Array.isArray(value)) {
      value.forEach((c) => c && typeof c.type === 'string' && keyPaths(sourceCode, c, out));
    } else if (value && typeof value.type === 'string') {
      keyPaths(sourceCode, value, out);
    }
  }
  return out;
}

/**
 * Does `haystack` mention `path` as a whole expression? Guards against `res`
 * matching inside `result` and against `arr.length` matching `data.arr.length`.
 */
export function mentions(haystack, path) {
  if (path.length < 3) return false;
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\w$.])${escaped}(?![\\w$])`).test(haystack);
}

/** Resolve an identifier to its single `const`/`let` initializer, if any. */
function resolveInit(scope, name) {
  let current = scope;
  while (current) {
    const variable = current.variables.find((v) => v.name === name);
    if (variable) {
      const def = variable.defs.find((d) => d.type === 'Variable');
      return def && def.node.init ? def.node.init : null;
    }
    current = current.upper;
  }
  return null;
}

const OBJECT_PROJECTIONS = new Set(['entries', 'keys', 'values']);

/**
 * True when the collection is provably non-empty from the source alone (array
 * or object literal, or a binding initialised from one). Iterating a literal
 * table of cases is not the blind spot this rule is after.
 */
export function isStaticallyNonEmpty(sourceCode, scope, node, depth = 0) {
  if (!node || depth > 4) return false;
  if (node.type === 'ArrayExpression') return node.elements.length > 0;
  if (node.type === 'ObjectExpression') return node.properties.length > 0;
  if (node.type === 'Identifier') {
    return isStaticallyNonEmpty(sourceCode, scope, resolveInit(scope, node.name), depth + 1);
  }
  if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression') {
    const { object, property } = node.callee;
    if (property.type !== 'Identifier') return false;
    // Object.entries(x) / .keys(x) / .values(x): non-empty iff x is non-empty.
    if (
      object.type === 'Identifier' &&
      object.name === 'Object' &&
      OBJECT_PROJECTIONS.has(property.name) &&
      node.arguments.length === 1
    ) {
      return isStaticallyNonEmpty(sourceCode, scope, node.arguments[0], depth + 1);
    }
    // x.map(fn) preserves length; x.filter/flatMap do not.
    if (property.name === 'map') {
      return isStaticallyNonEmpty(sourceCode, scope, object, depth + 1);
    }
    return false;
  }
  return false;
}
