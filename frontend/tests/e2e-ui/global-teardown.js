// Path: e2e-ui/global-teardown.js

/**
 * @fileoverview Playwright global teardown. Reads the state written by
 * global-setup.js, kills the spawned backend, and drops the throwaway DB.
 */

import fs from 'node:fs';
import { dropDatabase, killPid } from './backend.js';
import { STATE_FILE, OBITO_FILE } from './constants.js';

export default async function globalTeardown() {
    // O BACKEND MORREU NO MEIO? Este e o unico lugar da rodada em que essa pergunta ainda
    // tem resposta. Sem ele, a morte aparece como dezenas de casos falhando por um elemento
    // que nao existe (o app nao boota sem `GET /api/config`), e o diagnostico custa uma hora.
    try {
        const obito = JSON.parse(fs.readFileSync(OBITO_FILE, 'utf8'));
        console.error(
            '\n[ui-e2e] ATENCAO: o backend do harness MORREU durante a rodada '
            + `(code=${obito.code}, signal=${obito.signal}, as ${obito.quando}, pid=${obito.pid}). `
            + 'Toda reprovacao posterior a esse instante e consequencia disso, nao do codigo sob teste.\n',
        );
        fs.unlinkSync(OBITO_FILE);
    } catch { /* sem arquivo = o backend chegou vivo ao fim, que e o caso normal */ }

    let state;
    try {
        state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    } catch {
        return;
    }
    if (!state.skip) {
        killPid(state.pid);
        await dropDatabase(state.dbName).catch(() => {});
    }
    try {
        fs.unlinkSync(STATE_FILE);
    } catch {
        // already gone
    }
}
