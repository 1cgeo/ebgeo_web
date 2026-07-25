// Path: eslint-rules/index.js
// Local ESLint plugin: test-hygiene rules that encode the "escotilha"
// structural blind spot (an assertion guarded by an unverified condition,
// which passes green with the code arbitrarily wrong).
import noConditionalAssert from './no-conditional-assert.js';
import noDisjunctiveAssert from './no-disjunctive-assert.js';
import noUnassertedLoopAssert from './no-unasserted-loop-assert.js';

export default {
  meta: { name: 'ebgeo-tests', version: '1.0.0' },
  rules: {
    'no-conditional-assert': noConditionalAssert,
    'no-disjunctive-assert': noDisjunctiveAssert,
    'no-unasserted-loop-assert': noUnassertedLoopAssert,
  },
};
