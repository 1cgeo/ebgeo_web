// Path: src/modules/auth/register-gate.js
import { ForbiddenError } from '../../utils/errors.js';
import { getAppConfig } from '../config/config.service.js';

/**
 * Gates `POST /auth/register` on the RUNTIME `features.self_registration` flag, so the
 * administrator can turn account self-creation on and off from the Sistema tab without a
 * redeploy.
 *
 * UNTIL 2026-08-29 the route was mounted-or-not ONCE at boot from the `ALLOW_SELF_REGISTRATION`
 * env (`config.security.allowSelfRegistration`), so the only way to disable it was an env change
 * plus a restart, and the admin toggle could not reach it. Now the route is ALWAYS mounted and
 * this gate reads the EFFECTIVE config every request: `features.self_registration` starts at the
 * env value and the admin override (stored in the config-overrides document, deep-merged over the
 * payload) flips it. The served config the signup button reads and the value enforced here are
 * therefore the SAME fact, never two copies.
 *
 * It fails CLOSED: a missing flag (a config that never set it) is treated as disabled, and the
 * memoized `getAppConfig()` is the same document the client reads, so the button and the route
 * never disagree.
 */
export async function requireSelfRegistrationEnabled(req, res, next) {
  try {
    const cfg = await getAppConfig();
    if (cfg?.features?.self_registration === true) return next();
    return next(new ForbiddenError('Auto-cadastro desabilitado. Peça uma conta ao administrador.'));
  } catch (err) {
    return next(err);
  }
}
