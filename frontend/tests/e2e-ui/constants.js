// Path: e2e-ui/constants.js

/**
 * @fileoverview Shared constants for the Playwright browser-E2E layer.
 * The app is served by Vite (webServer in playwright.config.js) and the real
 * ebgeo_backend is spawned by the global setup with CORS allowing the app origin.
 */

import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * @private Uma porta do ambiente, ou o padrão. Valor inválido cai no padrão em vez
 * de virar `NaN`, que o `--strictPort` do Vite aceitaria como "porta 0".
 */
function porta(nome, padrao) {
    const v = Number(process.env[nome]);
    return Number.isInteger(v) && v > 0 && v < 65536 ? v : padrao;
}

// AS TRÊS COORDENADAS DESTA CAMADA SÃO FIXAS POR PADRÃO E SOBRESCRITÍVEIS POR ENV,
// e a razão é concreta: porta do Vite, porta do backend, arquivo de estado no temp
// e banco descartável têm nome FIXO, então duas cópias do repositório (dois
// worktrees, dois agentes) que rodem esta camada ao mesmo tempo colidem nas quatro.
// A colisão silenciosa é a pior: `reuseExistingServer` faz o Playwright REUSAR um
// Vite que já esteja na 4321 — servindo o `src/` do OUTRO checkout —, e a suíte
// passa a medir código que não é o que se está editando.
//
// Os padrões são exatamente os de antes, então nada muda para quem não define nada.

/** Fixed Vite dev port for the app under test (strictPort in playwright.config.js). */
export const APP_PORT = porta('EBGEO_UI_E2E_APP_PORT', 4321);
export const APP_ORIGIN = `http://localhost:${APP_PORT}`;

/** Port the spawned backend listens on (distinct from the vitest E2E port 3911). */
export const BACKEND_PORT = porta('EBGEO_UI_E2E_BACKEND_PORT', 3912);

/**
 * Banco descartável desta camada. Sobrescrever a porta SEM sobrescrever o banco
 * ainda colide (a segunda rodada dropa o banco da primeira), então quem isola uma
 * coisa precisa isolar a outra.
 */
export const UI_E2E_DB_NAME = process.env.EBGEO_UI_E2E_DB_NAME || 'ebgeo_ui_e2e';

/**
 * Absolute path to the backend, resolved FROM THIS REPO — the backend lives in
 * `backend/` of this same monorepo. Was a hardcoded machine-specific path, which
 * meant the whole browser-E2E layer only ran on one developer's computer (and
 * never in CI). `EBGEO_BACKEND_DIR` still overrides it, for a checkout that keeps
 * the backend somewhere else.
 */
// Tres niveis: tests/e2e-ui/ -> tests/ -> frontend/ -> raiz do monorepo. Eram dois
// ate o pacote web virar frontend/ (2026-07-18), quando isto passou a apontar para
// um `frontend/backend/` inexistente.
export const BACKEND_DIR =
    process.env.EBGEO_BACKEND_DIR ||
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../backend');

/**
 * Cross-process handoff file: globalSetup writes {skip,baseUrl,pid,dbName} here,
 * the specs read baseUrl/skip, and globalTeardown reads pid/dbName. Lives in the
 * OS temp dir so it never pollutes the repo.
 */
// O nome DERIVA da porta do backend, e não de uma variável própria: duas rodadas
// com portas diferentes precisam de arquivos diferentes, e uma terceira variável
// para dizer isso é uma a mais para esquecer — esquecê-la faria a segunda rodada
// sobrescrever o `pid`/`dbName` da primeira, e o teardown mataria o backend alheio.
export const STATE_FILE = path.join(os.tmpdir(), `ebgeo-ui-e2e-state-${BACKEND_PORT}.json`);
