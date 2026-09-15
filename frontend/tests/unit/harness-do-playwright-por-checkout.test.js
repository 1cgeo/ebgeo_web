// Path: tests/unit/harness-do-playwright-por-checkout.test.js

/**
 * @fileoverview O arquivo de estado e o de óbito do harness do Playwright são chaveados pelo
 * CHECKOUT, e não só pela porta. Enquanto a chave era só a porta, dois checkouts do mesmo
 * repositório (árvore principal e worktree) compartilhavam o mesmo caminho em `os.tmpdir()`, e
 * uma rodada recusada pela porta ocupada matava, no teardown, o backend da rodada vizinha pelo
 * pid lido do arquivo alheio (medido em 2026-09-13, três baterias perdidas).
 */

import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { STATE_FILE, OBITO_FILE, CHECKOUT_KEY, BACKEND_PORT, UI_E2E_DB_NAME } from '../e2e-ui/constants.js';

describe('harness do Playwright: estado e óbito por checkout', () => {
    it('a chave do checkout é um hash curto e estável', () => {
        expect(CHECKOUT_KEY).toMatch(/^[0-9a-f]{8}$/);
    });

    it('os dois arquivos levam a porta E a chave do checkout no nome', () => {
        for (const file of [STATE_FILE, OBITO_FILE]) {
            expect(path.dirname(file)).toBe(os.tmpdir());
            expect(path.basename(file)).toContain(`-${BACKEND_PORT}-${CHECKOUT_KEY}.json`);
        }
        expect(STATE_FILE).not.toBe(OBITO_FILE);
    });

    it('o banco descartável também deriva do checkout, salvo variável de ambiente', () => {
        expect(UI_E2E_DB_NAME).toBe(`ebgeo_ui_e2e_${CHECKOUT_KEY}`);
    });
});
