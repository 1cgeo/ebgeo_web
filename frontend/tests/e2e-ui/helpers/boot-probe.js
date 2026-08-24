// Path: e2e-ui/helpers/boot-probe.js

/**
 * @fileoverview POR QUE O BOOT FALHOU, e não apenas que ele falhou.
 *
 * A espera que abre toda sessão desta camada é `[data-testid="account-control"]` anexado. Quando
 * ela estoura, a mensagem do Playwright é "element(s) not found", que é compatível com QUATRO
 * causas de naturezas diferentes e custos de correção opostos:
 *
 *   1. o `GET /api/config` falhou, e o app trocou a página pela tela "EBGeo indisponível" (o boot
 *      é fail-fast nele, sem fallback estático). Isto é ambiente ou backend, nunca o app;
 *   2. um erro de página derrubou o boot antes de a barra da conta montar. Isto é o app;
 *   3. o app ainda estava BOOTANDO quando o orçamento acabou. Isto é contenção de máquina, e a
 *      correção é o número da espera, não o código;
 *   4. a página não é a que se pensa (navegou, ou nunca carregou).
 *
 * Sem distinguir as quatro, a única saída que sobra a quem lê o vermelho é subir o timeout até
 * parar de doer, que é como um teste deixa de medir o que dizia medir. Esta sonda existe para que
 * a mensagem de falha responda QUAL das quatro, com número.
 *
 * ELA É PASSIVA E TEM CUSTO PRÓXIMO DE ZERO: três listeners de página que guardam num objeto por
 * página, sem `evaluate` no caminho feliz. E DEGRADA: um chamador que não instale a sonda recebe
 * um diagnóstico dizendo isso, em vez de um erro dentro do próprio instrumento.
 *
 * SONDAGEM DESTE INSTRUMENTO: 2026-08-23, viva nos TRÊS caminhos, por spec descartável que
 * exercitou (a) página que nunca bootou, onde a mensagem passou a nomear a causa em vez de dizer
 * "element(s) not found"; (b) página SEM a sonda instalada, onde o diagnóstico diz isso em vez de
 * quebrar dentro de si mesmo; (c) boot REAL, onde o tempo foi medido (364 ms numa máquina ociosa)
 * e a resposta do documento de configuração foi vista com status 200.
 *
 * A sondagem PEGOU UM DEFEITO REAL no próprio instrumento, e é a razão de esta linha existir com
 * data: o filtro da resposta casava `/api/config`, que é como a documentação chama a rota, mas o
 * caminho real é `/api/v1/config`. O campo nunca preenchia, e um diagnóstico que diz "não vi o
 * config" LÊ-SE como "o config falhou": o instrumento estava pronto para mandar quem diagnostica
 * investigar o backend com o backend intacto. Não foi leitura que pegou, foi a sondagem. Ao mexer
 * aqui, re-sonde e troque a data; sem isso, "sondado" é conselho sem prazo de validade.
 *
 * O TEMPO DE BOOT BEM-SUCEDIDO TAMBÉM É REGISTRADO, e é ele que responde a pergunta que o
 * vermelho isolado não responde: a cauda da distribuição cruza o orçamento? Uma medição só de
 * falhas conta quantas vezes doeu, nunca o quanto faltava. `EBGEO_E2E_BOOT_TIMING=1` imprime uma
 * linha por boot, que é como a série de medição lê o resultado sem instrumentar o corredor.
 */

import { expect } from '@playwright/test';

/** Estado por página. `WeakMap` para não segurar página fechada viva. */
const sondas = new WeakMap();

/** O testid da tela que o boot fail-fast mostra quando `GET /api/config` não responde. */
const TESTID_INDISPONIVEL = 'ebgeo-unavailable';

/**
 * Liga a sonda numa página RECÉM-CRIADA, antes do primeiro `goto`.
 *
 * Chamar depois do `goto` também funciona, mas perde os eventos anteriores, e é justamente o
 * erro de boot precoce que mais interessa aqui.
 * @param {import('@playwright/test').Page} page
 */
export function installBootProbe(page) {
    const estado = {
        erros: [],
        consoleErros: [],
        config: null,   // { url, status, ms } da última resposta do documento de configuração
        respostas: 0,   // quantas respostas HTTP a página viu, de qualquer URL
        t0: Date.now(),
        boots: [],      // { rotulo, ms } de cada espera de boot que passou
    };
    sondas.set(page, estado);

    page.on('pageerror', (erro) => {
        // Só a primeira linha: o stack inteiro de N erros afoga a mensagem que importa.
        estado.erros.push(String(erro?.message ?? erro).split('\n')[0].slice(0, 200));
    });
    page.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        estado.consoleErros.push(msg.text().slice(0, 200));
    });
    page.on('response', (res) => {
        estado.respostas += 1;
        // O CAMINHO E `/api/v1/config`, NAO `/api/config`, e esta linha ja nasceu errada uma
        // vez: o filtro casava `/api/config`, que e como a documentacao chama a rota, e nunca
        // casava nada. O sintoma seria o pior possivel, porque um campo que diz "nenhuma
        // resposta de /api/config vista" LE-SE como "o config falhou", que e a causa 1, e
        // mandaria quem diagnostica investigar backend com o backend intacto. Pego pela sonda
        // do proprio instrumento (`_sonda-do-instrumento.spec.js`), nao por leitura.
        //
        // Por PATHNAME e nao por `includes`: `/config/admin` e outra rota, e um `includes`
        // ingenuo carimbaria a resposta dela por cima da do boot.
        let caminho = '';
        try {
            caminho = new URL(res.url()).pathname;
        } catch {
            return;
        }
        if (!caminho.endsWith('/config')) return;
        estado.config = { url: caminho, status: res.status(), ms: Date.now() - estado.t0 };
    });
    return estado;
}

/**
 * O retrato do boot daquela página, seguro de chamar a qualquer momento.
 *
 * NUNCA LANÇA. Ele roda no caminho de FALHA, e um instrumento que quebra ao medir uma página
 * morta (contexto de execução destruído por navegação) troca o diagnóstico real por um erro
 * dentro do próprio diagnóstico. Cada leitura que pode falhar vira uma string dizendo isso.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<Object>}
 */
export async function bootDiagnostic(page) {
    const estado = sondas.get(page);
    const fora = async (fn, fallback) => {
        try {
            return await fn();
        } catch {
            return fallback;
        }
    };
    return {
        sonda: estado ? 'ligada' : 'AUSENTE (installBootProbe nao foi chamado nesta pagina)',
        url: await fora(() => page.url(), '(url ilegivel)'),
        readyState: await fora(() => page.evaluate(() => document.readyState), '(ilegivel)'),
        // A discriminação mais barata: a tela de indisponível é o desfecho declarado do boot
        // fail-fast, e a presença dela responde a causa 1 sozinha.
        telaIndisponivel: await fora(
            () => page.locator(`[data-testid="${TESTID_INDISPONIVEL}"]`).count().then((n) => n > 0),
            '(ilegivel)',
        ),
        mapLibreMontado: await fora(
            () => page.evaluate(() => Boolean(globalThis.__ebgeoMap)),
            '(ilegivel)',
        ),
        // "Nao vi o config" e "nao vi resposta nenhuma" sao diagnosticos diferentes: o primeiro
        // acusa a rota, o segundo acusa a rede ou a propria sonda. Sem a contagem ao lado, os
        // dois se leem igual.
        configResposta: estado?.config
            ?? `(nenhuma resposta terminando em /config; respostas HTTP vistas: ${estado?.respostas ?? 0})`,
        errosDePagina: estado?.erros ?? [],
        errosDeConsole: (estado?.consoleErros ?? []).slice(0, 5),
        bootsAnteriores: estado?.boots ?? [],
        msDesdeAAberturaDaPagina: estado ? Date.now() - estado.t0 : null,
    };
}

/**
 * Espera o app BOOTAR (a barra da conta anexada) e, ao estourar, diz por quê.
 *
 * O `catch` não engole a falha: ele relança com o diagnóstico junto, preservando a mensagem
 * original do Playwright. Engolir transformaria um vermelho legítimo em verde, que é o defeito
 * que esta camada inteira existe para não cometer.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{timeout?: number, rotulo?: string}} [opcoes]
 */
export async function expectAppBooted(page, { timeout = 20000, rotulo = 'boot' } = {}) {
    const t0 = Date.now();
    try {
        await expect(page.locator('[data-testid="account-control"]')).toBeAttached({ timeout });
    } catch (erro) {
        const diag = await bootDiagnostic(page);
        throw new Error(
            `[${rotulo}] o app nao bootou em ${timeout} ms (a barra da conta nunca anexou).\n`
            + `${JSON.stringify(diag, null, 2)}\n`
            + `--- erro original ---\n${String(erro?.message ?? erro).slice(0, 600)}`,
        );
    }
    const ms = Date.now() - t0;
    const estado = sondas.get(page);
    if (estado) estado.boots.push({ rotulo, ms });
    if (process.env.EBGEO_E2E_BOOT_TIMING === '1') {
        // Uma linha por boot no stdout do corredor: é assim que a série de medição lê a
        // distribuição sem que ninguém precise instrumentar o Playwright.
        process.stdout.write(`[boot-timing] ${rotulo} ${ms}ms\n`);
    }
    return ms;
}
