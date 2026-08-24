// Path: tests/integration/wipe-de-salvar-no-servidor-sem-testemunha.repro.test.js

/**
 * @fileoverview REPRO: "Salvar atlas local no servidor" apagava bancos com um `granted` obtido por
 * AUSÊNCIA DE PROVA.
 *
 * ============================ A CAUSA RAIZ ============================
 *
 * `AccountControl.saveLocalToServer` (`src/js/account/account.control.js`) reivindicava o lock de
 * aba com `acquireTabLock(remoteAtlasKey(result.atlasId))`, SEM opções, e cerca de quarenta linhas
 * abaixo chamava `clearAllDataStore({ markLocal: false })`. Era o último dos cinco sítios
 * destrutivos ainda decidido só pelo SETTLE.
 *
 * O settle responde por ausência: ninguém objetou em 300 ms, logo ninguém está aí. A seção 5 de
 * `src/js/utilities/tab-lock.js` enumera as três coisas ordinárias que produzem esse silêncio com
 * um par bem vivo do outro lado (dois settles sobrepostos, uma aba de thread ocupada mais tempo que
 * a janela, e uma mensagem perdida no barramento de `localStorage`). A ordem total conserta o
 * ESTADO nos três casos; ela não desfaz bancos já esvaziados.
 *
 * A defesa que faltava é a TESTEMUNHA: o lock de montagem é fato do navegador
 * (`store/atlas-namespace.js`, Decisão 5), é solto pela MORTE do cliente e nunca pelo silêncio
 * dele, então uma aba congelada, estrangulada ou cuja mensagem se perdeu continua segurando-o.
 *
 * ============================ O QUE ESTE ARQUIVO MEDE ============================
 *
 * 1. O MECANISMO, com o módulo REAL e sem dublê de `acquire`: um lock sem transporte nenhum (o
 *    silêncio total, que é o pior caso do settle) concede a reivindicação; o MESMO lock, com a
 *    mesma reivindicação e uma testemunha que diz "ocupado", recusa com `deniedBy: 'witness'`.
 *    É a diferença que o sítio destrutivo estava jogando fora.
 * 2. QUE A TESTEMUNHA NÃO RECUSA O CASO LEGÍTIMO, que é a pergunta que decide se o conserto está
 *    certo. Aqui `selfHolds` é 0 (o atlas nasceu uma linha acima e `activateRemoteAtlas` ainda não
 *    rodou, então esta aba não montou nada com aquele nome), e `otherClientHoldsLock` com
 *    `selfHolds: 0` sobre um `LockManager` que não tem posse nenhuma naquele nome responde `false`.
 *    Com `selfHolds: 1` errado ela responderia `false` tarde demais, e com uma posse alheia
 *    responde `true`, que é o que se quer.
 * 3. A FIAÇÃO, estruturalmente: o sítio passa `witness: remoteMountWitness(...)` e o passa ANTES do
 *    `clearAllDataStore`. É esta asserção que fica vermelha se alguém desfizer o conserto, e ela
 *    não depende de montar o `AccountControl` inteiro (ele arrasta MapLibre, modais e a store).
 *
 * ============================ O QUE ELE NÃO MEDE ============================
 *
 * Não há aqui duas abas de verdade nem IndexedDB de verdade: a corrida entre um settle e um par
 * congelado é browser, e vive em `tests/e2e-ui/browser-multi-tab-namespace.spec.js`. O que se prende
 * aqui é a causa raiz (um pre-flight sem a segunda pergunta) e o conserto (o sítio faz a segunda
 * pergunta), que é exatamente o que um repro deve documentar.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTabLock, remoteAtlasKey, otherClientHoldsLock } from '@utils/tab-lock.js';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../../src/js');
const ATLAS_NOVO = '33333333-3333-4333-8333-333333333333';
const NOME_DO_LOCK = `ebgeo-atlas:#remote-${ATLAS_NOVO}`;

/** @type {Array<{destroy: () => void}>} */
const criados = [];
afterEach(() => {
    for (const lock of criados) lock.destroy();
    criados.length = 0;
});

/**
 * Um lock de aba SEM transporte, que é o silêncio total: nenhum par pode ser ouvido, que é o
 * estado em que o settle é mais generoso.
 * @returns {import('@utils/tab-lock.js').createTabLock extends (o: any) => infer R ? R : never}
 */
function lockMudo() {
    const lock = createTabLock({
        createTransport: () => null,
        overlayHost: null,
        autoPulse: false,
        settleMs: 0
    });
    criados.push(lock);
    return lock;
}

/**
 * Um `LockManager` de mentira, com as posses que o teste declara.
 * @param {string[]} nomes - Nomes de lock atualmente segurados por QUALQUER cliente.
 * @returns {{query: () => Promise<{held: Array<{name: string}>}>}}
 */
function gerenteDeLocks(nomes) {
    return { query: async () => ({ held: nomes.map((name) => ({ name })) }) };
}

/** O código de um arquivo de `src/js`, sem comentário. @param {string} rel @returns {string} */
function codigoDe(rel) {
    return readFileSync(resolve(SRC, rel), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, (bloco) => bloco.replace(/[^\n]/g, ' '))
        .replace(/^([ \t]*)\/\/.*$/gm, (linha, indent) => indent
            + ' '.repeat(Math.max(0, linha.length - indent.length)));
}

describe('REPRO: o wipe de "Salvar no servidor" era autorizado por silêncio', () => {
    it('MECANISMO: sem testemunha o silêncio concede; com testemunha ocupada ele recusa', async () => {
        const semTestemunha = await lockMudo().acquire(remoteAtlasKey(ATLAS_NOVO));
        // Esta linha É o defeito: nenhum par foi ouvido porque nenhum par PODE ser ouvido, e o
        // pre-flight leu isso como "estou só". Quarenta linhas depois vinha o `clearAllDataStore`.
        expect(semTestemunha.granted).toBe(true);
        expect(semTestemunha.deniedBy).toBe(null);

        const comTestemunha = await lockMudo().acquire(remoteAtlasKey(ATLAS_NOVO), {
            witness: async () => true
        });
        expect(comTestemunha.granted).toBe(false);
        expect(comTestemunha.deniedBy).toBe('witness');
    });

    it('A TESTEMUNHA NÃO RECUSA O CASO LEGÍTIMO: `selfHolds` é 0 e o nome está livre', async () => {
        // O caso legítimo, medido: o atlas nasceu uma linha acima do pre-flight e
        // `activateRemoteAtlas` só roda DEPOIS dele, então nenhuma posse no nome
        // `ebgeo-atlas:#remote-<novo>` é desta aba, e nenhuma outra aba pode ter montado um atlas
        // que ainda não existia. `remoteMountWitness` deriva esse 0 sozinho, comparando o escopo
        // ATIVO (aqui, o LOCAL) com o do atlas pedido.
        const livre = await otherClientHoldsLock(
            gerenteDeLocks(['ebgeo-atlas:#local-abc']), NOME_DO_LOCK, 0
        );
        expect(livre, 'o salvamento legítimo passa').toBe(false);

        // Discriminação: se a testemunha respondesse `false` para tudo, a asserção acima seria
        // cobertura vazia. Uma posse alheia no MESMO nome tem de acusar.
        const ocupado = await otherClientHoldsLock(
            gerenteDeLocks([NOME_DO_LOCK]), NOME_DO_LOCK, 0
        );
        expect(ocupado, 'uma aba viva naquele namespace recusa').toBe(true);

        // E o `selfHolds` errado (1, o valor do wipe do atlas JÁ montado) apagaria justamente essa
        // recusa: é por isso que ele é calculado do escopo ativo e não escrito à mão.
        const cegoPorSelfHolds = await otherClientHoldsLock(
            gerenteDeLocks([NOME_DO_LOCK]), NOME_DO_LOCK, 1
        );
        expect(cegoPorSelfHolds).toBe(false);

        // Sem `LockManager` (HTTP puro) não há fato a ler, e `null` não é nem uma coisa nem outra.
        expect(await otherClientHoldsLock(null, NOME_DO_LOCK, 0)).toBe(null);
    });

    it('O CONSERTO: `saveLocalToServer` passa a testemunha, e ANTES do wipe', () => {
        const fonte = codigoDe('account/account.control.js');
        const inicio = fonte.indexOf('async saveLocalToServer(');
        expect(inicio, 'o método existe').toBeGreaterThan(-1);
        // O corte vai até o método seguinte, que é uma fronteira sintática do arquivo (todo método
        // de classe começa em coluna 4). Um corte por número de caracteres falharia nas duas
        // direções e falharia calado.
        const fim = fonte.indexOf('\n    async _handleDeleteAtlas(', inicio);
        expect(fim, 'a fronteira do próximo método existe').toBeGreaterThan(inicio);
        const corpo = fonte.slice(inicio, fim);

        const posAcquire = corpo.indexOf('acquireTabLock(');
        const posWipe = corpo.indexOf('clearAllDataStore(');
        expect(posAcquire, 'ele reivindica o lock').toBeGreaterThan(-1);
        expect(posWipe, 'ele apaga bancos').toBeGreaterThan(-1);
        expect(posAcquire, 'a reivindicação precede o wipe').toBeLessThan(posWipe);

        // A testemunha, e a FORMA dela: um `witness: null` literal satisfaria um `/witness\s*:/`
        // solto e seria o defeito de volta com outra cara.
        const argumentos = corpo.slice(posAcquire, posWipe);
        expect(argumentos).toMatch(/witness\s*:\s*remoteMountWitness\(/);
        // E a testemunha tem de nomear o atlas RECÉM-CRIADO, não uma variável qualquer: apontá-la
        // para outro namespace guardaria bancos que este caminho não vai tocar.
        expect(argumentos).toMatch(/remoteMountWitness\(\s*result\.atlasId\s*\)/);
    });
});
