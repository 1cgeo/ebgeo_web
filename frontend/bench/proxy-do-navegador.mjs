// Path: bench/proxy-do-navegador.mjs

/**
 * @fileoverview O proxy que o Chromium da bancada usa, decidido SEM diálogo.
 *
 * A bancada roda com cabeça (GPU real) e o Chromium com cabeça herda o proxy do
 * sistema. Numa máquina atrás de proxy autenticado, todo pedido a host de fora
 * (tiles do demotiles, OSM, BDGEx) faz o navegador abrir a janela "o proxy pede
 * usuário e senha", que trava a rodada até alguém digitar. Em modo headless a
 * mesma situação vira 407 calado, que é por que a suíte de Playwright nunca viu
 * o problema e a bancada viu.
 *
 * Três modos, e a escolha é um argumento:
 *
 * - `ambiente` (padrão): a credencial já vive nas variáveis HTTPS_PROXY ou
 *   HTTP_PROXY do ambiente, na forma `http://usuario:senha@host:porta`. O
 *   Playwright recebe servidor, usuário e senha separados e o Chromium se
 *   autentica sozinho; NO_PROXY vira a lista de bypass. Sem credencial na URL, o
 *   diálogo voltaria, então o modo cai para `sem-proxy` e diz isso.
 * - `sem-proxy`: `--no-proxy-server`. Nunca abre diálogo; host de fora falha, o
 *   que a bancada trata como a fumaça que já é (o app está em localhost).
 * - `sistema`: o comportamento antigo, o proxy do sistema como estiver. Só para
 *   quem quer ver o diálogo.
 *
 * O valor da credencial e o host do proxy NUNCA saem daqui para log, JSON ou
 * relatório: a descrição cita a CHAVE da variável, e só.
 */

const MODOS = Object.freeze(['ambiente', 'sem-proxy', 'sistema']);

/**
 * Lê o proxy das variáveis do ambiente, na ordem HTTPS_PROXY, https_proxy,
 * HTTP_PROXY, http_proxy. Devolve null quando não há proxy ou quando a URL não
 * embute usuário E senha, porque sem os dois o Chromium abriria o diálogo.
 *
 * @param {Object} env - `process.env` ou um objeto equivalente
 * @returns {{ chave: string, server: string, username: string, password: string, bypass: string|undefined }|null}
 */
export function lerProxyDoAmbiente(env) {
    if (!env || typeof env !== 'object') return null;
    for (const chave of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']) {
        const bruto = env[chave];
        if (typeof bruto !== 'string' || !bruto.trim()) continue;
        let url;
        try {
            url = new URL(bruto.trim());
        } catch {
            return null;
        }
        if (!url.username || !url.password) return null;
        const bypass = lerBypass(env.NO_PROXY ?? env.no_proxy);
        return {
            chave,
            server: `${url.protocol}//${url.host}`,
            username: decodeURIComponent(url.username),
            password: decodeURIComponent(url.password),
            bypass,
        };
    }
    return null;
}

/**
 * NO_PROXY aceita vírgula ou espaço como separador; o Playwright quer vírgula.
 * @param {*} valor
 * @returns {string|undefined}
 */
function lerBypass(valor) {
    if (typeof valor !== 'string') return undefined;
    const itens = valor.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    return itens.length ? itens.join(',') : undefined;
}

/**
 * Decide o que passar ao `chromium.launch`.
 *
 * @param {string} modo - `ambiente`, `sem-proxy` ou `sistema`
 * @param {Object} env - `process.env` ou equivalente
 * @returns {{ modo: string, launch: { proxy?: Object, args: string[] }, descricao: string }}
 */
export function resolverProxyDoNavegador(modo, env) {
    if (!MODOS.includes(modo)) {
        throw new Error(`--proxy desconhecido: ${modo} (aceita ${MODOS.join(', ')})`);
    }
    if (modo === 'sistema') {
        return { modo, launch: { args: [] }, descricao: 'proxy do sistema, como estiver (pode abrir dialogo de credencial)' };
    }
    if (modo === 'ambiente') {
        const lido = lerProxyDoAmbiente(env);
        if (lido) {
            const proxy = { server: lido.server, username: lido.username, password: lido.password };
            if (lido.bypass) proxy.bypass = lido.bypass;
            return {
                modo,
                launch: { proxy, args: [] },
                descricao: `proxy de ${lido.chave} com credencial da propria variavel, sem dialogo${lido.bypass ? ', bypass de NO_PROXY' : ''}`,
            };
        }
        return {
            modo: 'sem-proxy',
            launch: { args: ['--no-proxy-server'] },
            descricao: 'sem proxy (HTTPS_PROXY/HTTP_PROXY ausente ou sem usuario:senha na URL): host de fora falha, nada abre dialogo',
        };
    }
    return { modo, launch: { args: ['--no-proxy-server'] }, descricao: 'sem proxy (--proxy sem-proxy): host de fora falha, nada abre dialogo' };
}

export { MODOS as MODOS_DE_PROXY };
