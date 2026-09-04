// Path: tests/unit/config-defaults.test.js
// Two properties of `config.appConfig` — the object GET /api/config hands to the
// browser — that nothing else in the suite holds.
//
// 1. No built-in default may point at the development machine (C6). It has
//    already happened twice (SEARCH_API_URL on :3001, SV360_SERVICE_URL on
//    localhost:3000), and config.js's own comments describe the damage: a value
//    that works only by accident of the Vite proxy, shipped to every browser via
//    /api/config, in an endpoint the frontend boot is fail-fast on.
//
// 2. `optionalInt` (config.js:14-19) parses the zoom knobs with parseInt and only
//    rejects NaN, so '12abc' becomes 12 and '-1' passes. Those values travel into
//    the frozen /api/config contract (config.service.js injects minzoom/maxzoom
//    into the MapLibre terrain/hillshade sources). The current behaviour is
//    PINNED here, traps marked as such, so that changing it is a decision rather
//    than an accident.
//
// config.js reads process.env in the module body, so every case re-imports it
// with a cache-busting query string after setting the env it means to test.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Every env var that feeds config.appConfig, paired with the key it produces.
const APPCONFIG_ENV = Object.freeze({
  TILE_SERVER_URL: 'tileServerUrl',
  TERRAIN_URL: 'terrainUrl',
  HILLSHADE_URL: 'hillshadeUrl',
  TERRAIN_MINZOOM: 'terrainMinzoom',
  TERRAIN_MAXZOOM: 'terrainMaxzoom',
  HILLSHADE_MINZOOM: 'hillshadeMinzoom',
  HILLSHADE_MAXZOOM: 'hillshadeMaxzoom',
  MAP3D_IMAGERY_URL: 'map3dImageryUrl',
  MAP3D_TERRAIN_URL: 'map3dTerrainUrl',
  SV360_SERVICE_URL: 'sv360ServiceUrl',
  OSM_TILE_URL: 'osmTileUrl',
  MAPLIBRE_GLYPHS_URL: 'glyphsUrl',
  IMAGENS_TILE_URL: 'imagensTileUrl',
  ORTOIMAGEM_TILE_URL: 'ortoimagemTileUrl',
  BDGEX_WMS_URL: 'bdgexWmsUrl',
  // O par do aviso de servidor secundário (2026-09-03). Elas entram nesta tabela pela razão
  // que a tabela existe: `importConfigWith()` APAGA toda chave listada aqui antes de medir os
  // defaults, então uma env que alimenta `appConfig` e fica de fora faz a medição do default
  // depender do ambiente de quem roda a suíte. `AVISO_SERVIDOR_SECUNDARIO` produz um BOOLEANO
  // e o scanner de máquina-de-desenvolvimento abaixo só olha strings, então ela passa ao largo
  // dele; `URL_SERVIDOR_PRINCIPAL` é uma URL absoluta e É escaneada, de propósito. O parse e a
  // fiação das duas vivem em `tests/unit/aviso-servidor-secundario.test.js`.
  AVISO_SERVIDOR_SECUNDARIO: 'avisoServidorSecundario',
  URL_SERVIDOR_PRINCIPAL: 'urlServidorPrincipal',
});

let importCounter = 0;

/**
 * Imports a FRESH copy of src/config.js with `vars` applied on top of the
 * appConfig env (any key of APPCONFIG_ENV not named in `vars` is deleted, so the
 * built-in defaults are what gets measured). Restores the env afterwards.
 * @param {Record<string,string>} vars
 * @returns {Promise<object>} the module's default export
 */
async function importConfigWith(vars = {}) {
  const keys = [...Object.keys(APPCONFIG_ENV), ...Object.keys(vars)];
  const saved = {};
  for (const k of keys) saved[k] = process.env[k];
  try {
    for (const k of Object.keys(APPCONFIG_ENV)) delete process.env[k];
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    const mod = await import(`../../src/config.js?cfgdefaults=${++importCounter}`);
    return mod.default;
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/**
 * Returns the appConfig keys whose STRING value points at the developer's own
 * machine, or pins a literal port on a host of its own. Relative values ('',
 * '/api/v1/sv360') are fine: they resolve against whatever origin serves the app,
 * which is exactly what a deploy-agnostic default must do.
 *
 * `{z}/{x}/{y}`-style placeholders make these strings invalid URLs for `new URL`,
 * so the host is extracted by pattern rather than parsed.
 * @param {object} appConfig
 * @returns {string[]} offending keys
 */
function devMachineOffenders(appConfig) {
  const offenders = [];
  for (const [key, value] of Object.entries(appConfig)) {
    if (typeof value !== 'string' || value === '') continue;
    const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(value);
    if (!m) continue; // relative path — deploy-agnostic by construction
    const authority = m[1];
    const host = authority.replace(/^[^@]*@/, '').replace(/:\d+$/, '');
    if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?)$/i.test(host)) {
      offenders.push(key);
      continue;
    }
    if (/:\d+$/.test(authority)) offenders.push(key); // literal port on its own host
  }
  return offenders;
}

describe('config.appConfig — no default may point at the dev machine (C6)', () => {
  it('every built-in default is deploy-agnostic', async () => {
    const cfg = await importConfigWith();
    const appConfig = cfg.appConfig;

    // GUARD (C4): without this the whole scan is vacuous the day `appConfig` is
    // renamed or restructured — an empty object yields zero offenders and a green
    // test that checked nothing. The count is asserted, not just non-emptiness.
    const keyCount = Object.keys(appConfig).length;
    assert.ok(
      keyCount >= 14,
      `guard: expected >= 14 appConfig keys to scan, found ${keyCount} — did appConfig move?`
    );
    const scanned = Object.values(appConfig).filter((v) => typeof v === 'string' && v !== '').length;
    assert.ok(scanned >= 8, `guard: expected >= 8 non-empty string defaults, scanned ${scanned}`);

    const offenders = devMachineOffenders(appConfig);
    assert.deepEqual(
      offenders,
      [],
      `these defaults are served to every browser and point at the dev machine: ${offenders.join(', ')}`
    );
  });

  it('the scanner itself accuses a localhost default (negative control)', async () => {
    // Proves the green above is a statement about the defaults and not about a
    // scanner that never fires. Re-introduces the exact value config.js's comment
    // records as the second real occurrence.
    const cfg = await importConfigWith({ SV360_SERVICE_URL: 'http://localhost:3000/api/v1/sv360' });
    const offenders = devMachineOffenders(cfg.appConfig);
    assert.deepEqual(offenders, ['sv360ServiceUrl'], 'the scanner must name the offending key');
  });

  it('a relative default is NOT flagged (sv360ServiceUrl, assets-style)', async () => {
    const cfg = await importConfigWith();
    assert.equal(cfg.appConfig.sv360ServiceUrl, '/api/v1/sv360');
    assert.deepEqual(devMachineOffenders({ sv360ServiceUrl: '/api/v1/sv360' }), []);
  });

  it('cors.origin is deliberately OUT of scope (it is not served to the browser)', async () => {
    // Scope stated explicitly rather than left implicit: the localhost default
    // here is a dev placeholder for a SERVER-side comparison, it never travels in
    // /api/config, and production refuses to boot without CORS_ORIGIN set.
    const cfg = await importConfigWith();
    assert.equal(cfg.cors.origin, 'http://localhost:3000');
    assert.ok(!('origin' in cfg.appConfig), 'cors.origin must not leak into appConfig');
  });
});

describe('config — optionalInt boundaries on the zoom knobs', () => {
  it('unset and empty yield undefined (the consumer picks the default)', async () => {
    const unset = await importConfigWith();
    assert.equal(unset.appConfig.terrainMinzoom, undefined);
    const empty = await importConfigWith({ TERRAIN_MINZOOM: '' });
    assert.equal(empty.appConfig.terrainMinzoom, undefined);
  });

  it("'0' survives as 0 and does NOT become undefined", async () => {
    // The falsy trap: an `||`-based read would turn a legitimate zoom 0 into
    // undefined and quietly drop the floor of the tile source.
    const cfg = await importConfigWith({ TERRAIN_MINZOOM: '0', HILLSHADE_MINZOOM: '0' });
    assert.equal(cfg.appConfig.terrainMinzoom, 0);
    assert.equal(cfg.appConfig.hillshadeMinzoom, 0);
  });

  it('garbage yields undefined', async () => {
    const cfg = await importConfigWith({ TERRAIN_MAXZOOM: 'abc' });
    assert.equal(cfg.appConfig.terrainMaxzoom, undefined);
  });

  it('TRAP (pinned, not endorsed): a partially-numeric value is TRUNCATED', async () => {
    // parseInt('12abc') === 12. NUMERIC_ENV_RULES rejects exactly this shape for
    // every knob it covers, but these four are read through optionalInt, OUTSIDE
    // that validation. Pinned so the day it is tightened, this line is the one
    // that has to change deliberately.
    const cfg = await importConfigWith({ TERRAIN_MINZOOM: '12abc' });
    assert.equal(cfg.appConfig.terrainMinzoom, 12, 'today 12abc silently becomes 12');
  });

  it('TRAP (pinned): a negative zoom passes through, and max < min is not rejected', async () => {
    const cfg = await importConfigWith({ TERRAIN_MINZOOM: '-1', TERRAIN_MAXZOOM: '-5' });
    assert.equal(cfg.appConfig.terrainMinzoom, -1, 'no floor is applied today');
    assert.equal(cfg.appConfig.terrainMaxzoom, -5);
    assert.ok(
      cfg.appConfig.terrainMaxzoom < cfg.appConfig.terrainMinzoom,
      'an inverted range is accepted today — pinned so that rejecting it is a decision'
    );
  });

  it('a well-formed pair is carried through unchanged', async () => {
    const cfg = await importConfigWith({
      TERRAIN_MINZOOM: '4', TERRAIN_MAXZOOM: '14',
      HILLSHADE_MINZOOM: '2', HILLSHADE_MAXZOOM: '12',
    });
    assert.deepEqual(
      [
        cfg.appConfig.terrainMinzoom, cfg.appConfig.terrainMaxzoom,
        cfg.appConfig.hillshadeMinzoom, cfg.appConfig.hillshadeMaxzoom,
      ],
      [4, 14, 2, 12]
    );
  });
});
