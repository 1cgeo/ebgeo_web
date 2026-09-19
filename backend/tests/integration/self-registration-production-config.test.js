// Path: tests/integration/self-registration-production-config.test.js
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

it('production runtime override cannot enable signup without delivery configuration', async () => {
  const script = `
    import assert from 'node:assert/strict';
    import { updateConfigOverrides, getAppConfig } from './src/modules/config/config.service.js';
    import { db, pgp } from './src/database/index.js';
    try {
      await assert.rejects(updateConfigOverrides({features:{self_registration:true}}, null), /SMTP_HOST/);
      await db.none("INSERT INTO config_settings(key,value) VALUES('app_config',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value", [{features:{self_registration:true}}]);
      const effective = await getAppConfig();
      assert.equal(effective.features.self_registration, false);
    } finally {
      await db.none("DELETE FROM config_settings WHERE key='app_config'");
      pgp.end();
    }
  `;
  const { stderr } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'production', ALLOW_SELF_REGISTRATION: 'false', SMTP_HOST: '', APP_BASE_URL: '', LOG_LEVEL: 'silent' },
    timeout: 20000,
  });
  assert.equal(stderr, '');
});
