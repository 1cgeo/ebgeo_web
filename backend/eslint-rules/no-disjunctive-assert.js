// Path: eslint-rules/no-disjunctive-assert.js
// `assert.ok(A || B)` accepts two different worlds, so it pins neither. It is
// the same empty coverage as an unasserted `if`: the assertion survives the
// code being wrong in one of the two ways it tolerates.
//
// Scope: the truthiness forms `assert(...)` and `assert.ok(...)`, over TWO
// syntaxes of the same defect:
//   1. `A || B`             — the disjunction written out;
//   2. `[a, b].includes(x)` — the same disjunction as a literal set.
//
// The second was found by review, not by design: `assert.ok([403, 404].includes(res.status))`
// sat in a case whose own title said "responds 404 BEFORE the 403", and it passed
// with the two gates in either order. A rule that recognises only the `||` spelling
// is a rule the next author routes around without meaning to.
//
// The array literal is required on purpose. `LISTA.includes(x)`, with a named
// collection, is usually membership in a real domain (a role list, an enum) and
// not a hedge between two outcomes — flagging it would be the noise that gets a
// rule switched off. The hedge is precisely the one written INLINE, at the
// assertion, by someone who did not want to decide.
//
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
      includes:
        'assert sobre `[a, b].includes(x)`: é a mesma disjunção de `A || B` em outra sintaxe, e passa em qualquer um dos valores da lista. Escolha o esperado e use `assert.equal` (se o sujeito não consegue distinguir os dois, o sujeito está errado, não a asserção).',
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
        if (first.type === 'LogicalExpression' && first.operator === '||') {
          context.report({ node: first, messageId: 'disjunctive' });
          return;
        }
        // `[a, b].includes(x)`: array LITERAL only, and at least two members —
        // `[x].includes(y)` is an equality with extra steps, not a hedge.
        if (
          first.type === 'CallExpression'
          && first.callee.type === 'MemberExpression'
          && first.callee.property.type === 'Identifier'
          && first.callee.property.name === 'includes'
          && first.callee.object.type === 'ArrayExpression'
          && first.callee.object.elements.length >= 2
        ) {
          context.report({ node: first, messageId: 'includes' });
        }
      },
    };
  },
};
