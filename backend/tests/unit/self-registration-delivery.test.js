// Path: tests/unit/self-registration-delivery.test.js
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { canEnableSelfRegistration } from '../../src/utils/mailer.js';

it('runtime self-registration requires both SMTP and a configured app URL in production', () => {
  for (const [host, appBaseUrl, expected] of [
    ['', '', false], ['smtp.test', '', false], ['', 'https://app.test', false],
    ['smtp.test', 'https://app.test', true],
  ]) {
    assert.equal(canEnableSelfRegistration({ isProd: true, mail: { host, appBaseUrl } }), expected);
  }
  assert.equal(canEnableSelfRegistration({ isProd: false, mail: {} }), true);
});
