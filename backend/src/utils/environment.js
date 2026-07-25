// Path: src/utils/environment.js
// Environment-derived DECISIONS: config.js reads .env, this turns it into choices.
//
// Scope is exactly what has a caller: the boolean getters and `cookieOptions()`
// (middleware/flexible-auth.js). This header used to advertise "single source of
// truth for cookie/cors/helmet/pool", which was false in three of the five: there
// never was a helmet method, and the cors/pool ones had ZERO callers in src/ while
// the real consumers read config directly (`config.cors.origin` in app.js,
// `config.db.poolMax` in database/index.js). The pool one was the expensive lie: it
// capped non-production at 5 connections and an operator reading it believed in a
// limit the running system never applied. Both were removed on 2026-07-25, together
// with the tautological assert that "pinned" the cap. If you reintroduce either,
// wire the real consumer to it in the same commit or it is dead again.
import config from '../config.js';
import { parseDuration } from './duration.js';

class EnvironmentManager {
  get isProduction() {
    return config.isProd;
  }
  get isDevelopment() {
    return config.isDev;
  }
  get isTest() {
    return config.isTest;
  }
  get useHttps() {
    return config.isProd;
  }

  cookieOptions() {
    return {
      httpOnly: true,
      secure: this.useHttps,
      sameSite: this.isProduction ? 'strict' : 'lax',
      // L5 — DERIVED from the access-token lifetime instead of a hardcoded 15m.
      // JWT_ACCESS_EXPIRY is configurable, so the constant silently desynced from
      // it: raise the expiry and the cookie still died at 15 minutes, logging the
      // user out while their token was perfectly valid. `validateEnvVariables`
      // rejects a malformed value at boot, so parseDuration cannot return 0 here;
      // the fallback only covers a programmatic misuse.
      maxAge: parseDuration(config.jwt.accessExpiry) || 15 * 60 * 1000,
    };
  }
}

export const env = new EnvironmentManager();
export default env;
