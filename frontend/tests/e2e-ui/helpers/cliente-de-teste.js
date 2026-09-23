// Path: e2e-ui/helpers/cliente-de-teste.js

/**
 * @fileoverview AS DUAS PORTAS DE CREDENCIAL desta camada, e a razão de só haver duas.
 *
 * O DEFEITO QUE ELAS FECHAM. `ApiClient.login()` termina em `setTokens`, que termina em
 * `_persistTokens`, e esse é o único escritor da chave `ebgeo_auth` do `localStorage`. O boot do
 * MAPA lê essa chave em dois pontos: na Fase -1 (`shouldRouteToProjects` com
 * `apiClient.hasStoredTokens()`, e `window.location.replace('./atlas.html')` quando ela existe numa
 * URL nua) e na Fase 2.5 (`restoreSessionFromStorage` com `loadStoredTokens()`, e no fim da
 * cadeia `openAtlasChooserOnBoot`, que chama `openProjectPicker` e também navega para
 * `atlas.html`). Um teste que fazia `new ApiClient()` + `login()` dentro de `page.evaluate` numa
 * página `/` ainda bootando gravava a chave NO MEIO do boot: se ela chegasse antes da Fase -1, a
 * página navegava, os pedidos em voo morriam e os globais do teste sumiam. Medido em 2026-09-23:
 * no Firefox a Fase -1 roda de 714 a 942 ms depois do `goto` e o token chega em 175 a 255 ms, e o
 * sequestro foi de 10 em 10; no Chromium, 1 em 10. Segurando a trava do portão de migração numa
 * página irmã, 3 em 3 nos dois navegadores. Esperar não conserta: a janela vai do início do
 * documento até a Fase 2.5, e o teste não tem como saber em que ponto dela está.
 *
 * AS DUAS PORTAS:
 *   - `clienteNaPagina`: o cliente de TRANSPORTE do teste. Um `ApiClient` do próprio app, criado na
 *     página, com o ouvinte de outras abas desligado (`dispose`) e a credencial SÓ em memória
 *     (`setEphemeralToken`). Ele nunca grava `ebgeo_auth`, então vale em qualquer página e em
 *     qualquer instante do boot. É o que 9 de cada 10 sítios queriam: semear, conferir, ler.
 *   - `sessaoDoApp`: a ÚNICA escrita deliberada de sessão, para o teste que quer o APP logado
 *     (a store, o seletor de atlas, a abertura por `?atlas=`). O `login()` real acontece em
 *     `atlas.html`, que não boota o mapa e não navega por sessão, e só depois a página vai ao
 *     destino, que então boota COM sessão desde o primeiro byte. Não há corrida porque nenhum boot
 *     que decide rota pela sessão está em curso quando a chave nasce.
 *
 * O QUE NÃO SE FAZ MAIS, e o censo `frontend/tests/unit/login-programatico-so-pelo-helper.test.js`
 * reprova: `.login(`, `.setTokens(` e `setItem('ebgeo_auth', …)` dentro de função passada a
 * `evaluate`, `evaluateHandle`, `addInitScript` ou `waitForFunction`, fora deste arquivo e das
 * exceções declaradas lá com motivo.
 *
 * O LIMITE DECLARADO de `clienteNaPagina`: sem refresh token não há renovação, então o cliente
 * vale os 15 minutos do token de acesso, contados a partir do login que esta função faz. Caso que
 * dure mais que isso pede um cliente novo, e não um refresh.
 */

import { readState } from '../state.js';
import { APP_ORIGIN } from '../constants.js';

/** O módulo do cliente, pelo caminho que o servidor de desenvolvimento serve. */
const MODULO_DO_CLIENTE = '/src/js/store/sync/api-client.js';

/** Onde `sessaoDoApp` faz o login real: uma página do app que não decide rota pela sessão. */
const PAGINA_DO_LOGIN = '/atlas.html';

/** O caminho da página de protocolo: nada do app boota nela. */
export const CAMINHO_DA_PAGINA_DE_PROTOCOLO = '/__pagina-de-protocolo';

const PAGINA_DE_PROTOCOLO_HTML = '<!doctype html><meta charset="utf-8"><title>Página de protocolo</title>';

/** Páginas que já têm a rota instalada, para não empilhar um tratador por chamada. */
const paginasRoteadas = new WeakSet();

/**
 * @private A base ABSOLUTA da API do backend descartável. É a que o lado Node usa para o login, e
 * o padrão do cliente na página (o CORS do backend libera a origem do app).
 * @returns {string}
 */
function baseDoBackend() {
    const state = readState();
    if (state.skip || !state.baseUrl) {
        throw new Error(`cliente-de-teste: backend indisponível (${state.reason ?? 'sem baseUrl'})`);
    }
    return `${state.baseUrl}/api/v1`;
}

/**
 * @private Falha ALTO quando a página não está na origem do app: o cliente é importado do servidor
 * de desenvolvimento, e numa `about:blank` o `import()` morre com um erro que não diz isso.
 * @param {import('@playwright/test').Page} page
 * @param {string} quem
 */
function exigirOrigemDoApp(page, quem) {
    const url = page.url();
    if (!url.startsWith(APP_ORIGIN)) {
        throw new Error(`${quem}: a página está em "${url}", fora da origem do app (${APP_ORIGIN}). `
            + 'Navegue antes; qualquer página do app serve, inclusive a de protocolo '
            + '(`abrirPaginaDeProtocolo`).');
    }
}

/**
 * @private O token de acesso, pelo `POST /auth/login` feito do lado Node. Com usuário e senha
 * faz um login NOVO, e é o que dá os 15 minutos a partir de agora e o papel que a conta tem
 * AGORA (uma promoção por SQL depois de `createVerifiedUser` só aparece num token novo). Só com
 * `accessToken` (o que `createVerifiedUser` devolve) usa o que recebeu.
 * @param {{username?: string, password?: string, accessToken?: string}} credenciais
 * @param {string} base
 * @returns {Promise<string>}
 */
async function tokenDeAcesso(credenciais, base) {
    if (credenciais?.username && credenciais?.password) {
        const res = await fetch(`${base}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: credenciais.username, password: credenciais.password }),
        });
        const texto = await res.text();
        if (!res.ok) {
            throw new Error(`cliente-de-teste: POST /auth/login de "${credenciais.username}" → `
                + `${res.status}: ${texto.slice(0, 300)}`);
        }
        const token = JSON.parse(texto)?.data?.accessToken;
        if (!token) throw new Error('cliente-de-teste: o login respondeu sem accessToken');
        return token;
    }
    if (credenciais?.accessToken) return credenciais.accessToken;
    throw new Error('cliente-de-teste: credenciais sem usuário e senha e sem accessToken');
}

/**
 * Leva a página a uma página VAZIA na origem do app, servida por rota do Playwright. Nada do app
 * boota nela, então nada lê nem escreve a sessão enquanto o teste fala com o servidor. É a página
 * de quem só precisa da origem do app sem nada rodando nela (a página irmã que segura uma trava em
 * `login-programatico-no-boot.spec.js`).
 *
 * UM DOCUMENTO SINTÉTICO FALA COM O SERVIDOR PELA MESMA ORIGEM. O `/api` da própria origem passa
 * pelo proxy do Vite até o backend descartável; um pedido CRUZADO, direto à porta do backend, sai
 * de um documento que o Chromium não classifica como vindo do loopback, e a classificação de
 * espaço de endereço o recusa. Medido em 2026-09-23: o `login()` cruzado desta página falhou no
 * Chromium com `TypeError: Failed to fetch` em 0,7 s e passou no Firefox (o aviso já estava em
 * `browser-sharing-lifecycle.spec.js`, e o R12 mediu o mesmo numa versão anterior de `sessaoDoApp`:
 * "Permission was denied ... `loopback` address space"). Por isso `sessaoDoApp` loga numa página
 * REAL do app, e quem precisa de rede nesta página usa `'/api/v1'`.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
export async function abrirPaginaDeProtocolo(page) {
    const endereco = `${APP_ORIGIN}${CAMINHO_DA_PAGINA_DE_PROTOCOLO}`;
    if (!paginasRoteadas.has(page)) {
        await page.route(endereco, (route) => route.fulfill({
            status: 200, contentType: 'text/html; charset=utf-8', body: PAGINA_DE_PROTOCOLO_HTML,
        }));
        paginasRoteadas.add(page);
    }
    await page.goto(endereco);
}

/**
 * O cliente de transporte do teste, vivo DENTRO da página e sem sessão persistida.
 *
 * Devolve um `JSHandle` do `ApiClient`. Ele se passa a `page.evaluate` como qualquer argumento,
 * inclusive dentro de um objeto: `page.evaluate(async ({ api, id }) => api.pullSync(id, 0),
 * { api: await clienteNaPagina(page, conta), id })`. Se a página navegar, o handle morre, e morre
 * alto ("Execution context was destroyed"), que é o desfecho certo para um teste que perdeu a
 * página.
 *
 * @param {import('@playwright/test').Page} page - Qualquer página na origem do app, em qualquer
 *   instante (o boot do mapa pode estar em curso).
 * @param {{username?: string, password?: string, accessToken?: string}} credenciais - Usuário e
 *   senha (login novo, do lado Node), ou só o `accessToken` que `createVerifiedUser` devolve.
 * @param {{baseUrl?: string}} [opcoes] - `baseUrl` do cliente NA PÁGINA; padrão, o backend
 *   descartável direto. Quem mede o proxy do Vite passa `'/api/v1'`. O login do lado Node vai
 *   sempre ao backend direto.
 * @returns {Promise<import('@playwright/test').JSHandle>} O `ApiClient` na página.
 */
export async function clienteNaPagina(page, credenciais, { baseUrl } = {}) {
    const token = await tokenDeAcesso(credenciais, baseDoBackend());
    const base = baseUrl ?? baseDoBackend();
    exigirOrigemDoApp(page, 'clienteNaPagina');
    return page.evaluateHandle(async ({ modulo, base: raiz, token: acesso }) => {
        const { ApiClient } = await import(modulo);
        const cliente = new ApiClient({ baseUrl: raiz });
        // Sem o ouvinte de `storage`: este cliente não adota o par que o APP gravar depois.
        cliente.dispose();
        // Só memória. Não passa por `_persistTokens`, então a chave da sessão não é tocada.
        cliente.setEphemeralToken(acesso);
        return cliente;
    }, { modulo: MODULO_DO_CLIENTE, base, token });
}

/**
 * A sessão do APP: faz o `login()` real em `atlas.html` e então vai ao `destino`, que boota já com
 * a sessão guardada, como depois de um F5 de quem entrou.
 *
 * POR QUE `atlas.html`. O login precisa de uma página que não DECIDA ROTA pela sessão: o boot do
 * mapa decide (Fase -1 e fim da cadeia), e `atlas.html` não, porque `restoreSession`
 * (`projects/projects-page.js`) desenha deslogado ou logado e fica, sem mandar ninguém de volta
 * ao mapa. Então o login pode cair em qualquer instante do boot dela. E ela é um documento REAL
 * do servidor, que fala com o backend como qualquer página do app; a página de protocolo, que é
 * servida por rota, não sai como loopback no Chromium (ver `abrirPaginaDeProtocolo`).
 *
 * O destino é o que o teste quer medir, e as regras de roteamento do produto valem para ele: uma
 * URL nua (`/`) com sessão vai para `atlas.html` (Fase -1), então quem quer o MAPA logado pede um
 * `?atlas=` ou passa por `atlas.html` e escolhe "Mapa local".
 *
 * @param {import('@playwright/test').Page} page
 * @param {{username: string, password: string}} credenciais - Usuário e senha: a sessão do app é o
 *   par que o login grava, com renovação, e um token avulso não tem.
 * @param {string} destino - Caminho do app a abrir depois do login (`/?atlas=…`, `/atlas.html`).
 * @param {{baseUrl?: string}} [opcoes] - `baseUrl` do login; padrão, o backend descartável direto.
 *   O par gravado vale para o backend inteiro, qualquer que seja o caminho por que foi pedido.
 * @returns {Promise<Object>} O usuário que o login devolveu.
 */
export async function sessaoDoApp(page, credenciais, destino, { baseUrl } = {}) {
    if (!credenciais?.username || !credenciais?.password) {
        throw new Error('sessaoDoApp: precisa de usuário e senha. A sessão do app é o par de tokens '
            + 'que o login grava, e um token de acesso avulso não se renova.');
    }
    if (typeof destino !== 'string' || !destino.startsWith('/')) {
        throw new Error(`sessaoDoApp: destino "${destino}" não é um caminho do app`);
    }
    await page.goto(PAGINA_DO_LOGIN);
    const usuario = await page.evaluate(async ({ modulo, base, u }) => {
        const { ApiClient } = await import(modulo);
        const cliente = new ApiClient({ baseUrl: base });
        cliente.dispose();
        // A ESCRITA DELIBERADA: o login grava `ebgeo_auth`, numa página que não decide rota por ela.
        return cliente.login(u.username, u.password);
    }, {
        modulo: MODULO_DO_CLIENTE,
        base: baseUrl ?? baseDoBackend(),
        u: { username: credenciais.username, password: credenciais.password },
    });
    await page.goto(destino);
    return usuario;
}
