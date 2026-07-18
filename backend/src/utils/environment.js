// Path: src/utils/environment.js
// Single source of truth for environment-derived decisions (cookie/cors/helmet/
// pool/useHttps). config.js reads .env; this derives DECISIONS from it.
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

  corsOptions() {
    return { origin: config.cors.origin, credentials: true };
  }

  dbPoolMax() {
    return this.isProduction ? config.db.poolMax : Math.min(config.db.poolMax, 5);
  }
}

export const env = new EnvironmentManager();
export default env;
