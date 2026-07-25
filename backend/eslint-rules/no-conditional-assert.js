// Path: eslint-rules/no-conditional-assert.js
// An assert that only runs when an unverified condition happens to hold is not
// an assert: if the condition never holds, the test passes green having checked
// nothing. Assert the condition first, then assert the content.
//
// The approximation used to decide "the condition was asserted" (and what it
// deliberately does not catch) is documented in ./assert-utils.js.
import {
  findAssertIn,
  isAssertFail,
  keyPaths,
  mentions,
  precedingAssertText,
} from './assert-utils.js';

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'proíbe assert dentro de bloco `if` cuja condição não foi ela mesma asserida antes',
    },
    schema: [],
    messages: {
      conditional:
        'assert dentro de `if ({{cond}})` sem asserir a condição: se ela for falsa o teste passa verde sem verificar nada. Asserte a condição antes (ex.: `assert.equal({{cond}}, ...)`) e então tire o assert do `if`.',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;

    return {
      IfStatement(node) {
        const branches = [node.consequent, node.alternate].filter(Boolean);
        let assertNode = null;
        for (const branch of branches) {
          // `else if` is its own IfStatement and gets its own visit.
          if (branch.type === 'IfStatement') continue;
          assertNode = assertNode || findAssertIn(sourceCode, branch);
        }
        if (!assertNode) return;
        // `assert.fail()` in a branch IS the assertion of that branch.
        if (isAssertFail(sourceCode, assertNode)) return;

        const before = precedingAssertText(sourceCode, node);
        const paths = [...keyPaths(sourceCode, node.test)];
        if (paths.some((p) => mentions(before, p))) return;

        context.report({
          node: node.test,
          messageId: 'conditional',
          data: { cond: sourceCode.getText(node.test).replace(/\s+/g, ' ').slice(0, 60) },
        });
      },
    };
  },
};
