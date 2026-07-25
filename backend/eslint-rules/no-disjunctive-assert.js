// Path: eslint-rules/no-disjunctive-assert.js
// `assert.ok(A || B)` accepts two different worlds, so it pins neither. It is
// the same empty coverage as an unasserted `if`: the assertion survives the
// code being wrong in one of the two ways it tolerates.
//
// Scope: only the truthiness forms `assert(A || B)` and `assert.ok(A || B)`.
// `a || fallback` fed to a comparing assert (`assert.equal(x || 0, 0)`,
// `assert.match(msg || '', /re/)`) is a defaulting expression whose fallback
// still has to satisfy the comparison, so it is not this blind spot.
import { isAssertCall } from './assert-utils.js';

const TRUTHINESS = new Set(['ok']);

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'proíbe `assert.ok(A || B)` — disjunção que aceita os dois mundos',
    },
    schema: [],
    messages: {
      disjunctive:
        'assert sobre disjunção `A || B`: passa nos dois mundos, então não prende nenhum. Decida qual é o contrato e asserte-o (se os dois forem legítimos, asserte a condição que os separa).',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;

    return {
      CallExpression(node) {
        if (!isAssertCall(sourceCode, node) || node.arguments.length === 0) return;
        const callee = node.callee;
        if (callee.type === 'MemberExpression') {
          const name = callee.property.type === 'Identifier' ? callee.property.name : '';
          if (!TRUTHINESS.has(name)) return;
        }
        const first = node.arguments[0];
        if (first.type !== 'LogicalExpression' || first.operator !== '||') return;
        context.report({ node: first, messageId: 'disjunctive' });
      },
    };
  },
};
