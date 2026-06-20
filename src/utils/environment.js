// Path: src/utils/environment.js
// Single source of truth for environment-derived decisions (cookie/cors/helmet/
// pool/useHttps). config.js reads .env; this derives DECISIONS from it.
import config from '../config.js';

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
      maxAge: 15 * 60 * 1000, // aligned with the access token (15m)
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
