// Path: tests/unit/self-registration.test.js
// auth-07: the self-registration gate decision. The /register route is mounted
// only when config.security.allowSelfRegistration is true (auth.routes.js:14), and
// that value comes from resolveAllowSelfRegistration(nodeEnv, ALLOW_SELF_REGISTRATION).
// The PRODUCTION DEFAULT (no override) must be DISABLED — a closed military network
// must not expose self-registration by accident. The routing wiring is a one-liner;
// this pins the security-critical decision logic (the e2e 404 path is infeasible in
// a single process because config is frozen at module load).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAllowSelfRegistration } from '../../src/config.js';

describe('resolveAllowSelfRegistration (self-registration gate)', () => {
  it('production WITHOUT override → disabled (the security default)', () => {
    assert.equal(resolveAllowSelfRegistration('production', undefined), false);
  });

  it('non-production WITHOUT override → enabled (dev/test convenience)', () => {
    assert.equal(resolveAllowSelfRegistration('development', undefined), true);
    assert.equal(resolveAllowSelfRegistration('test', undefined), true);
  });

  it('explicit override "true" wins, even in production', () => {
    assert.equal(resolveAllowSelfRegistration('production', 'true'), true);
  });

  it('explicit override "false" wins, even in dev', () => {
    assert.equal(resolveAllowSelfRegistration('development', 'false'), false);
  });

  it('an unrecognized override is ignored → falls back to the env default', () => {
    assert.equal(resolveAllowSelfRegistration('production', 'garbage'), false);
    assert.equal(resolveAllowSelfRegistration('development', ''), true);
  });
});
