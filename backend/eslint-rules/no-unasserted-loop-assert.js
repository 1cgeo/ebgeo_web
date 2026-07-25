// Path: eslint-rules/no-unasserted-loop-assert.js
// A loop body full of asserts over a collection that may be empty verifies
// nothing when the collection IS empty — zero iterations, zero assertions, and
// the test still reports success. Assert the size before iterating.
//
// Statically non-empty collections (array/object literals, bindings
// initialised from one, `Object.entries` over such a literal) are exempt: a
// literal table of cases cannot silently iterate zero times. A preceding
// early-exit guard (`if (ops.length === 0) break;`) is exempt too: it proves
// non-emptiness, it just does not spell the proof as an assert. See
// ./assert-utils.js for the resolution and its limits.
import {
  findAssertIn,
  isStaticallyNonEmpty,
  mentions,
  precedingAssertText,
  precedingExitGuardText,
} from './assert-utils.js';

const SIZE_PROPS = ['length', 'size', 'rowCount', 'count'];

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'proíbe assert dentro de laço sobre coleção cujo tamanho não foi asserido antes',
    },
    schema: [],
    messages: {
      unbounded:
        'assert dentro de laço sobre `{{coll}}` sem asserir o tamanho: coleção vazia = zero asserções = verde vazio. Asserte antes (ex.: `assert.ok({{coll}}.length > 0)`).',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;

    function check(node, collection, body) {
      if (!collection || !body) return;
      if (!findAssertIn(sourceCode, body)) return;
      if (isStaticallyNonEmpty(sourceCode, sourceCode.getScope(node), collection)) return;

      const collText = sourceCode.getText(collection);
      const before =
        precedingAssertText(sourceCode, node) +
        '\n' +
        precedingExitGuardText(sourceCode, node);

      // Size expressions that count as asserting this collection. Iterating
      // `Object.entries(x)` is equally pinned by `Object.keys(x).length`.
      const sizeTexts = SIZE_PROPS.map((p) => `${collText}.${p}`);
      if (
        collection.type === 'CallExpression' &&
        collection.callee.type === 'MemberExpression' &&
        collection.callee.object.type === 'Identifier' &&
        collection.callee.object.name === 'Object' &&
        collection.arguments.length === 1
      ) {
        const arg = sourceCode.getText(collection.arguments[0]);
        for (const proj of ['entries', 'keys', 'values']) {
          sizeTexts.push(`Object.${proj}(${arg}).length`);
        }
      }
      if (sizeTexts.some((t) => mentions(before, t))) return;
      // A full deep-equality on the collection itself already pins its contents.
      const deepEq = new RegExp(
        `assert\\.deep\\w*\\(\\s*${collText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*,`
      );
      if (deepEq.test(before)) return;

      context.report({
        node: collection,
        messageId: 'unbounded',
        data: { coll: collText.replace(/\s+/g, ' ').slice(0, 40) },
      });
    }

    return {
      ForOfStatement(node) {
        check(node, node.right, node.body);
      },
      ForStatement(node) {
        // for (let i = 0; i < xs.length; i++)
        const test = node.test;
        if (
          !test ||
          test.type !== 'BinaryExpression' ||
          !['<', '<='].includes(test.operator) ||
          test.right.type !== 'MemberExpression' ||
          test.right.property.type !== 'Identifier' ||
          !SIZE_PROPS.includes(test.right.property.name)
        ) {
          return;
        }
        check(node, test.right.object, node.body);
      },
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type !== 'MemberExpression' ||
          callee.computed ||
          callee.property.type !== 'Identifier' ||
          !['forEach', 'map'].includes(callee.property.name) ||
          node.arguments.length === 0
        ) {
          return;
        }
        check(node, callee.object, node.arguments[0]);
      },
    };
  },
};
