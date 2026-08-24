// Path: tests/unit/verify-antes-do-mapa.test.js

/**
 * @fileoverview O `?verify=` É CONSUMIDO ANTES DE O MAPA MONTAR (achado B7 da auditoria do
 * visitante deslogado, 2026-08-24).
 *
 * O defeito: quem clica num link de confirmação de e-mail veio ler UMA frase, e a lia depois de
 * `createControls` ter sido aguardado (preflight de streetview incluído) e depois do controlador
 * de modo de visão, isto é, depois de o mapa inteiro montar. (A auditoria original dizia "depois
 * do `bootRendered`"; isso é FALSO, a chamada estava antes dele. O atraso real é o dos controles,
 * que basta sozinho.)
 *
 * A ORDEM DO BOOT DE `index.js` É CONTRATO (`.claude/rules/architecture.md`, §"Roteamento do boot,
 * em ordem"), então este arquivo prende as duas metades: a chamada subiu, E as invariantes que
 * não podiam se mexer continuam de pé.
 *
 * CONTROLE NEGATIVO:
 *   - devolver a chamada para depois de `await controlsPromise`: reprova em "antes dos serviços",
 *     "antes do mapa" e "antes dos controles".
 *   - subi-la acima de `applyRuntimeConfig`: reprova em "depois da configuração de runtime", que
 *     é o piso real (sem URL de base o `apiClient` não tem para onde perguntar).
 *   - subi-la acima da Fase -1: reprova em "depois do roteamento de página".
 *   - deixar uma segunda chamada para trás: reprova em "uma vez só".
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const INDEX = readFileSync(resolve(FRONT, 'src/js/index.js'), 'utf8');

/** O corpo de `initApp`, do `async function` à chave de coluna zero que o fecha. */
function corpoDoBoot() {
    const inicio = INDEX.indexOf('async function initApp(');
    if (inicio < 0) return null;
    const fim = INDEX.indexOf('\n}', inicio);
    return fim < 0 ? INDEX.slice(inicio) : INDEX.slice(inicio, fim + 2);
}

/** Posição de um marco dentro do corpo do boot, exigindo que ele exista. */
function marco(corpo, agulha) {
    const i = corpo.indexOf(agulha);
    expect(i, `o marco de boot \`${agulha}\` sumiu — o guarda perdeu o alvo`).toBeGreaterThan(-1);
    return i;
}

describe('a confirmação de e-mail fala antes de o mapa montar', () => {
    const corpo = corpoDoBoot();

    it('o extrator achou o boot e realmente recorta', () => {
        expect(corpo).not.toBeNull();
        expect(corpo.length).toBeLessThan(INDEX.length / 2);
        expect(corpo).not.toContain('async function openPublicAtlasFromUrl(');
    });

    it('a chamada existe UMA vez só no arquivo inteiro', () => {
        const chamadas = INDEX.match(/await handleEmailVerificationFromUrl\(\);/g) || [];
        expect(chamadas.length).toBe(1);
    });

    it('roda antes dos serviços, do mapa e dos controles', () => {
        const verify = marco(corpo, 'await handleEmailVerificationFromUrl();');
        expect(verify).toBeLessThan(marco(corpo, 'initServices();'));
        expect(verify).toBeLessThan(marco(corpo, '= createMap();'));
        expect(verify).toBeLessThan(marco(corpo, 'createControls(map,'));
        expect(verify).toBeLessThan(marco(corpo, 'await controlsPromise;'));
    });

    it('mas depois da configuração de runtime, que é o piso da chamada', () => {
        // `apiClient` não tem URL de base antes de `applyRuntimeConfig`, então esta é a primeira
        // linha do boot em que a chamada pode sequer existir.
        const verify = marco(corpo, 'await handleEmailVerificationFromUrl();');
        expect(verify).toBeGreaterThan(marco(corpo, 'await applyRuntimeConfig({ apiClient })'));
        expect(verify).toBeGreaterThan(marco(corpo, 'showUnavailableScreen();'));
    });

    it('e depois da Fase -1, que precisa ver o parâmetro na URL', () => {
        // `shouldRouteToProjects` mantém no MAPA o boot que carrega um `?verify=`; consumido antes
        // dela, um visitante com sessão seria mandado para `atlas.html` e nunca leria a frase.
        const verify = marco(corpo, 'await handleEmailVerificationFromUrl();');
        expect(verify).toBeGreaterThan(marco(corpo, 'shouldRouteToProjects(bootAtlasLink'));
    });

    it('e continua antes da cadeia de roteamento do boot', () => {
        const verify = marco(corpo, 'await handleEmailVerificationFromUrl();');
        expect(verify).toBeLessThan(marco(corpo, 'openPublicAtlasFromUrl(bootPublicLink)'));
        expect(verify).toBeLessThan(marco(corpo, 'openAtlasFromUrl(bootAtlasLink)'));
        expect(verify).toBeLessThan(marco(corpo, 'enterLocalMapOnBoot()'));
        expect(verify).toBeLessThan(marco(corpo, 'openAtlasChooserOnBoot()'));
    });

    it('e continua sendo o PRIMEIRO parâmetro de uma vez só a falar', () => {
        // `?sessao=`/`?trabalho=`/`?calibracao=` vêm depois, como antes.
        const verify = marco(corpo, 'await handleEmailVerificationFromUrl();');
        expect(verify).toBeLessThan(marco(corpo, 'explainEndedSessionFromUrl();'));
    });

    it('a Fase -1 continua sendo a primeira coisa do boot', () => {
        // A invariante que a mudança não podia tocar: a captura dos links no topo, antes de todo
        // `await`, e o roteamento de página logo depois.
        const captura = marco(corpo, "get('atlasPublico')");
        expect(captura).toBeLessThan(marco(corpo, 'shouldRouteToProjects(bootAtlasLink'));
        expect(captura).toBeLessThan(marco(corpo, 'await applyRuntimeConfig({ apiClient })'));
    });
});
