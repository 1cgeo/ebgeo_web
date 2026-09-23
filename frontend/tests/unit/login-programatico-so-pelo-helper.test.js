// Path: tests/unit/login-programatico-so-pelo-helper.test.js
//
// CENSO: nos testes de navegador, sessão só entra pelas duas portas de
// `tests/e2e-ui/helpers/cliente-de-teste.js` (`clienteNaPagina` e `sessaoDoApp`).
//
// A ARMADILHA. `ApiClient.login()` termina em `setTokens`, que termina em `_persistTokens`, o único
// escritor da chave `ebgeo_auth`. O boot do MAPA lê essa chave na Fase -1 (`hasStoredTokens`, e
// `location.replace('./atlas.html')` numa URL nua) e na Fase 2.5 (`loadStoredTokens`, e no fim da
// cadeia `openAtlasChooserOnBoot` → `openProjectPicker`, que também navega). Um teste que logava
// dentro de `page.evaluate` numa página `/` ainda bootando gravava a chave NO MEIO do boot, e a
// página era levada para `atlas.html`, com os pedidos em voo mortos e os globais do teste apagados.
// Medido em 2026-09-23: no Firefox a Fase -1 roda de 714 a 942 ms depois do `goto` e o token chega
// em 175 a 255 ms, sequestro em 10 de 10; no Chromium, 1 de 10. Dois specs já tinham caído por
// isso na auditoria de lançamento. Esperar não conserta: a janela vai do início do documento até
// a Fase 2.5. A interleaving perdedora é reproduzida de forma determinística em
// `tests/e2e-ui/login-programatico-no-boot.spec.js`.
//
// POR QUE UM CENSO E NÃO UMA NOTA. A lição foi escrita em prosa em pelo menos três lugares
// (`seedSharedAtlas`, `desempenho-do-boot-do-mapa.spec.js`, o README desta camada), e cada um
// consertou o SEU sítio mudando a página para `atlas.html`, enquanto 73 sítios continuavam na
// forma que sequestra. Correção que recorre é guia que não pegou.
//
// O QUE ELE COBRA, em três partes, cada uma com o seu controle:
//   1. a PREMISSA, lida na fonte do PRODUTO: a Fase -1 lê `hasStoredTokens`, a restauração lê
//      `loadStoredTokens`, `openAtlasChooserOnBoot` chama `openProjectPicker` (que navega para
//      `atlas.html`), `setEphemeralToken` não persiste, e `_persistTokens` é o único escritor da
//      chave. Se uma delas cair, este caso diz qual, e a regra abaixo precisa ser relida;
//   2. o DETECTOR, contra fontes sintéticas, para que um detector quebrado não devolva censo vazio;
//   3. o CENSO, sobre todo `.js` de `frontend/tests/` que o git conhece (versionado ou ainda não):
//      acusa `.login(`, `.setTokens(` e escrita de `ebgeo_auth` dentro de função passada a
//      `evaluate`, `evaluateHandle`, `addInitScript` ou `waitForFunction` (e `$eval`, `$$eval`,
//      `evaluateAll`, pela mesma razão). O helper tem a contagem dele asserida, e as exceções são
//      declaradas com motivo e contadas em igualdade exata: consertar um sítio obriga a riscá-lo.
//
// O QUE ELE NÃO ALCANÇA: função de página que chega por identificador IMPORTADO de outro arquivo,
// ou repassada por parâmetro (o detector só resolve identificador declarado no MESMO arquivo), e o
// login do lado Node (`new ApiClient()` fora de `evaluate`), que não toca o navegador e não é o
// defeito. Uma chamada do helper com página em `about:blank` falha alto no próprio helper.
//
// A FORMA CERTA: `clienteNaPagina(page, conta)` para falar com o servidor (o token fica só em
// memória; vale 15 minutos, sem renovação), e `sessaoDoApp(page, conta, destino)` para o app logado.

import { describe, it, expect } from 'vitest';
import { parse } from 'acorn';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ_PACOTE = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** O único arquivo autorizado a escrever sessão, e quantas escritas ele tem (a de `sessaoDoApp`). */
const HELPER = 'tests/e2e-ui/helpers/cliente-de-teste.js';
const SITIOS_DO_HELPER = 1;

/**
 * AS EXCEÇÕES, cada uma com o motivo, contadas em igualdade exata. Não é dívida: em cada uma o
 * login programático é o SUJEITO, ou é o login do próprio app numa página que já passou do boot.
 * @type {Map<string, {sitios: number, motivo: string}>}
 */
const EXCECOES = new Map([
    ['tests/e2e-ui/atlas-switch-edge-cases.spec.js', {
        sitios: 1,
        motivo: 'o sujeito é a sessão VIVA do app trocando de atlas sem recarga. `syncEngine.login` é '
            + 'o login do próprio app (o mesmo que o modal chama), feito depois de `setup` esperar '
            + '`__ebgeoMap.loaded()` e a cortina cair, ou seja, com o boot já passado da Fase 2.5; '
            + 'o modal de login do mapa NAVEGA para `atlas.html`, então não há gesto de tela que '
            + 'logue no mesmo documento.',
    }],
    ['tests/e2e-ui/browser-auth-config.spec.js', {
        sitios: 2,
        motivo: 'o sujeito é o próprio `login()`/`refresh()` do transporte e a recusa de um refresh '
            + 'inválido (`setTokens` com refresh falso). O caso roda em `atlas.html` já bootada, que '
            + 'não navega por sessão, porque mede o pedido CRUZADO ao backend.',
    }],
    ['tests/e2e-ui/login-programatico-no-boot.spec.js', {
        sitios: 1,
        motivo: 'o caso (i) é o controle do instrumento: a forma crua, com o boot parado na trava do '
            + 'portão, TEM de levar a página para `atlas.html`.',
    }],
]);

/** Métodos do Playwright cuja função roda NA PÁGINA, e o índice do argumento que a carrega. */
const METODOS_DE_PAGINA = new Map([
    ['evaluate', 0], ['evaluateHandle', 0], ['addInitScript', 0], ['waitForFunction', 0],
    ['$eval', 1], ['$$eval', 1], ['evaluateAll', 0],
]);

/** A chave da sessão, escrita aqui à mão de propósito: a premissa abaixo confere a da fonte. */
const CHAVE_DA_SESSAO = 'ebgeo_auth';

// ---------------------------------------------------------------------------
// Análise
// ---------------------------------------------------------------------------

/** Visita toda a árvore, entregando o nó e a pilha de ancestrais. */
function visitar(no, fn, pais = []) {
    if (!no || typeof no.type !== 'string') return;
    fn(no, pais);
    const proximos = [...pais, no];
    for (const [chave, valor] of Object.entries(no)) {
        if (chave === 'loc') continue;
        if (Array.isArray(valor)) valor.forEach((filho) => visitar(filho, fn, proximos));
        else if (valor && typeof valor.type === 'string') visitar(valor, fn, proximos);
    }
}

/** @returns {string|null} O nome de membro não computado (`a.b` → `b`). */
function nomeDeMembro(no) {
    return no?.type === 'MemberExpression' && !no.computed && no.property?.type === 'Identifier'
        ? no.property.name : null;
}

/** @returns {string|null} O valor de um literal de texto, ou de template sem buraco. */
function textoLiteral(no) {
    if (no?.type === 'Literal' && typeof no.value === 'string') return no.value;
    if (no?.type === 'TemplateLiteral' && no.expressions.length === 0) return no.quasis[0].value.cooked;
    return null;
}

/** @returns {boolean} Se o nó é função (declaração, expressão ou seta). */
const ehFuncao = (no) => /^(?:FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(no?.type ?? '');

function arvoreDe(fonte) {
    return parse(fonte, { ecmaVersion: 'latest', sourceType: 'module', locations: true, allowHashBang: true });
}

/**
 * Os sítios proibidos DENTRO de uma função que roda na página.
 * @param {Object} funcao - Nó de função.
 * @param {Array<{forma: string, linha: number}>} saida
 */
function sitiosNaFuncao(funcao, saida) {
    visitar(funcao, (no) => {
        if (no.type === 'CallExpression') {
            const nome = nomeDeMembro(no.callee);
            if (nome === 'login' || nome === 'setTokens') saida.push({ forma: nome, linha: no.loc.start.line });
            if (nome === 'setItem' && textoLiteral(no.arguments[0]) === CHAVE_DA_SESSAO) {
                saida.push({ forma: 'setItem', linha: no.loc.start.line });
            }
        }
        if (no.type === 'AssignmentExpression' && no.left.type === 'MemberExpression') {
            const alvo = no.left.computed ? textoLiteral(no.left.property) : nomeDeMembro(no.left);
            if (alvo === CHAVE_DA_SESSAO) saida.push({ forma: 'atribuicao', linha: no.loc.start.line });
        }
    });
}

/** O mesmo, para código de página passado como TEXTO (`addInitScript('...')`, `{ content }`). */
function sitiosNoTexto(texto, linha, saida) {
    const formas = [
        ['login', /\.login\s*\(/g],
        ['setTokens', /\.setTokens\s*\(/g],
        ['setItem', new RegExp(`\\.setItem\\s*\\(\\s*['"\`]${CHAVE_DA_SESSAO}['"\`]`, 'g')],
    ];
    for (const [forma, regra] of formas) {
        for (const _ of texto.matchAll(regra)) saida.push({ forma, linha });
    }
}

/**
 * Todos os sítios proibidos de uma fonte: `.login(`, `.setTokens(` e escrita da chave da sessão
 * dentro de função passada a um método de página do Playwright.
 * @param {string} fonte
 * @returns {Array<{forma: string, linha: number}>}
 */
export function sitiosDeLoginNaPagina(fonte) {
    const arvore = arvoreDe(fonte);
    const funcoesPorNome = new Map();
    const registrar = (nome, funcao) => {
        if (!funcoesPorNome.has(nome)) funcoesPorNome.set(nome, []);
        funcoesPorNome.get(nome).push(funcao);
    };
    visitar(arvore, (no) => {
        if (no.type === 'FunctionDeclaration' && no.id) registrar(no.id.name, no);
        if (no.type === 'VariableDeclarator' && no.id?.type === 'Identifier' && ehFuncao(no.init)) {
            registrar(no.id.name, no.init);
        }
    });
    const saida = [];
    const vistas = new Set();
    visitar(arvore, (no) => {
        if (no.type !== 'CallExpression') return;
        const metodo = nomeDeMembro(no.callee);
        if (!METODOS_DE_PAGINA.has(metodo)) return;
        const alvo = no.arguments[METODOS_DE_PAGINA.get(metodo)];
        if (!alvo) return;
        let funcoes = [];
        if (ehFuncao(alvo)) {
            funcoes = [alvo];
        } else if (alvo.type === 'Identifier') {
            funcoes = funcoesPorNome.get(alvo.name) ?? [];
        } else if (textoLiteral(alvo) !== null) {
            sitiosNoTexto(textoLiteral(alvo), no.loc.start.line, saida);
        } else if (alvo.type === 'ObjectExpression') {
            const conteudo = alvo.properties.find((p) => p.type === 'Property' && !p.computed
                && (p.key.name === 'content' || p.key.value === 'content'));
            if (conteudo && textoLiteral(conteudo.value) !== null) {
                sitiosNoTexto(textoLiteral(conteudo.value), no.loc.start.line, saida);
            }
        }
        for (const funcao of funcoes) {
            // Uma função nomeada passada a dois `evaluate` conta uma vez: o sítio é o código.
            if (vistas.has(funcao)) continue;
            vistas.add(funcao);
            sitiosNaFuncao(funcao, saida);
        }
    });
    return saida;
}

/** Todo `.js` de `frontend/tests/`, versionado ou ainda não commitado. */
function inventario() {
    let saida;
    try {
        saida = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'tests'], {
            cwd: RAIZ_PACOTE, encoding: 'utf8',
        });
    } catch (err) {
        throw new Error(`o inventário deste censo vem de "git ls-files" e o comando FALHOU (${err.message}). `
            + 'Sem inventário não há censo: conserte o comando em vez de afrouxar o piso.');
    }
    return [...new Set(saida.split('\n').map((l) => l.trim()).filter((l) => l.endsWith('.js')))]
        // Apagado na árvore e ainda no índice: não há o que ler, e não é sítio.
        .filter((rel) => existsSync(join(RAIZ_PACOTE, rel)))
        .sort();
}

// ---------------------------------------------------------------------------
// Premissa: o produto lê e escreve a sessão como este censo supõe
// ---------------------------------------------------------------------------

const lerFonte = (rel) => readFileSync(join(RAIZ_PACOTE, rel), 'utf8');

/** A função declarada (ou método de classe) com esse nome, ou null. */
function funcaoChamada(arvore, nome) {
    let achada = null;
    visitar(arvore, (no) => {
        if (achada) return;
        if (no.type === 'FunctionDeclaration' && no.id?.name === nome) {
            achada = no;
        } else if (no.type === 'MethodDefinition' && no.key?.name === nome) {
            achada = no.value;
        }
    });
    return achada;
}

/** As chamadas de dentro de um nó, como texto `objeto.metodo` ou `funcao`. */
function chamadasEm(no, fonte) {
    const chamadas = [];
    visitar(no, (x) => {
        if (x.type === 'CallExpression') chamadas.push({ no: x, texto: fonte.slice(x.callee.start, x.callee.end) });
    });
    return chamadas;
}

/**
 * A Fase -1 do boot do mapa: existe em `initApp` um `if` cujo teste chama `shouldRouteToProjects`
 * com `apiClient.hasStoredTokens()` e cujo corpo navega para `./atlas.html`.
 * @param {string} fonte - `src/js/index.js`.
 */
export function faseMenosUmLeASessao(fonte) {
    const initApp = funcaoChamada(arvoreDe(fonte), 'initApp');
    if (!initApp) return false;
    let achou = false;
    visitar(initApp, (no) => {
        if (no.type !== 'IfStatement') return;
        const doTeste = chamadasEm(no.test, fonte).map((c) => c.texto);
        if (!doTeste.includes('shouldRouteToProjects') || !doTeste.includes('apiClient.hasStoredTokens')) return;
        const navega = chamadasEm(no.consequent, fonte).some((c) => c.texto === 'window.location.replace'
            && textoLiteral(c.no.arguments[0]) === './atlas.html');
        if (navega) achou = true;
    });
    return achou;
}

/**
 * A Fase 2.5 e o fim da cadeia: `initApp` chama `restoreSessionFromStorage`, que chama
 * `apiClient.loadStoredTokens`; e chama `openAtlasChooserOnBoot`, que chama `openProjectPicker`.
 * @param {string} fonte - `src/js/index.js`.
 */
export function restauracaoLeASessao(fonte) {
    const arvore = arvoreDe(fonte);
    const initApp = funcaoChamada(arvore, 'initApp');
    const restaurar = funcaoChamada(arvore, 'restoreSessionFromStorage');
    const seletor = funcaoChamada(arvore, 'openAtlasChooserOnBoot');
    if (!initApp || !restaurar || !seletor) return false;
    const doBoot = chamadasEm(initApp, fonte).map((c) => c.texto);
    return doBoot.includes('restoreSessionFromStorage')
        && doBoot.includes('openAtlasChooserOnBoot')
        && chamadasEm(restaurar, fonte).some((c) => c.texto === 'apiClient.loadStoredTokens')
        && chamadasEm(seletor, fonte).some((c) => /\bopenProjectPicker$/.test(c.texto));
}

/**
 * `openProjectPicker` NAVEGA para `atlas.html`.
 * @param {string} fonte - `src/js/account/account.control.js`.
 */
export function seletorNavega(fonte) {
    const metodo = funcaoChamada(arvoreDe(fonte), 'openProjectPicker');
    if (!metodo) return false;
    return chamadasEm(metodo, fonte).some((c) => c.texto === 'window.location.assign'
        && /atlas\.html/.test(fonte.slice(c.no.arguments[0]?.start ?? 0, c.no.arguments[0]?.end ?? 0)));
}

/**
 * O contrato de escrita da sessão no cliente: a chave é `ebgeo_auth`; `login` → `setTokens` →
 * `_persistTokens`; `setEphemeralToken` não persiste nem toca o armazenamento; e a ÚNICA escrita
 * da chave no arquivo está em `_persistTokens`.
 * @param {string} fonte - `src/js/store/sync/api-client.js`.
 * @returns {{chave: boolean, loginPersiste: boolean, efemeroNaoPersiste: boolean, escritorUnico: boolean}}
 */
export function contratoDaSessao(fonte) {
    const arvore = arvoreDe(fonte);
    const chave = /const TOKEN_STORAGE_KEY = 'ebgeo_auth';/.test(fonte);
    const login = funcaoChamada(arvore, 'login');
    const setTokens = funcaoChamada(arvore, 'setTokens');
    const efemero = funcaoChamada(arvore, 'setEphemeralToken');
    const persistir = funcaoChamada(arvore, '_persistTokens');
    const loginPersiste = Boolean(login && setTokens
        && chamadasEm(login, fonte).some((c) => c.texto === 'this.setTokens')
        && chamadasEm(setTokens, fonte).some((c) => c.texto === 'this._persistTokens'));
    const trechoEfemero = efemero ? fonte.slice(efemero.start, efemero.end) : null;
    const efemeroNaoPersiste = trechoEfemero !== null
        && !/_persistTokens|localStorage|sessionStorage|setItem|setTokens/.test(trechoEfemero);
    const escritas = [];
    visitar(arvore, (no) => {
        if (no.type !== 'CallExpression' || nomeDeMembro(no.callee) !== 'setItem') return;
        const primeiro = no.arguments[0];
        if (primeiro?.type === 'Identifier' && primeiro.name === 'TOKEN_STORAGE_KEY') escritas.push(no);
        else if (textoLiteral(primeiro) === CHAVE_DA_SESSAO) escritas.push(no);
    });
    const escritorUnico = Boolean(persistir) && escritas.length === 1
        && escritas[0].start >= persistir.start && escritas[0].end <= persistir.end;
    return { chave, loginPersiste, efemeroNaoPersiste, escritorUnico };
}

/**
 * Os arquivos de `src/js` com a chave da sessão num LITERAL de código (comentário não conta: a
 * prosa que cita a chave não a escreve).
 * @returns {string[]}
 */
function arquivosDoProdutoQueCitamAChave() {
    const saida = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'src/js'], {
        cwd: RAIZ_PACOTE, encoding: 'utf8',
    });
    return saida.split('\n').map((l) => l.trim()).filter((l) => l.endsWith('.js'))
        .filter((rel) => existsSync(join(RAIZ_PACOTE, rel)))
        .filter((rel) => lerFonte(rel).includes(CHAVE_DA_SESSAO))
        .filter((rel) => {
            let cita = false;
            visitar(arvoreDe(lerFonte(rel)), (no) => {
                if (textoLiteral(no) === CHAVE_DA_SESSAO) cita = true;
            });
            return cita;
        })
        .sort();
}

describe('login programático na página só pelas portas de cliente-de-teste.js', () => {
    describe('PREMISSA, lida na fonte do produto', () => {
        it('a Fase -1 lê a sessão guardada e navega para atlas.html; controle: sem a leitura, a checagem cai', () => {
            const fonte = lerFonte('src/js/index.js');
            expect(faseMenosUmLeASessao(fonte), 'a Fase -1 do boot mudou: releia a regra deste censo').toBe(true);
            const semLeitura = fonte.replace('apiClient.hasStoredTokens()', 'false');
            expect(semLeitura).not.toBe(fonte);
            expect(faseMenosUmLeASessao(semLeitura)).toBe(false);
        });

        it('a Fase 2.5 restaura a sessão guardada e o fim da cadeia abre o seletor; controle incluso', () => {
            const fonte = lerFonte('src/js/index.js');
            expect(restauracaoLeASessao(fonte)).toBe(true);
            const semRestaurar = fonte.replace('apiClient.loadStoredTokens()', 'false');
            expect(semRestaurar).not.toBe(fonte);
            expect(restauracaoLeASessao(semRestaurar)).toBe(false);

            const conta = lerFonte('src/js/account/account.control.js');
            expect(seletorNavega(conta), '`openProjectPicker` deixou de navegar para atlas.html').toBe(true);
            const semNavegar = conta.replaceAll('window.location.assign(', 'console.info(');
            expect(semNavegar).not.toBe(conta);
            expect(seletorNavega(semNavegar)).toBe(false);
        });

        it('login grava pela única escrita, e o token efêmero não grava; controles incluídos', () => {
            const fonte = lerFonte('src/js/store/sync/api-client.js');
            expect(contratoDaSessao(fonte)).toEqual({
                chave: true, loginPersiste: true, efemeroNaoPersiste: true, escritorUnico: true,
            });
            // CONTROLE 1: o token efêmero passando a persistir é acusado.
            const efemeroPersiste = fonte.replace(
                /(setEphemeralToken\(token\) \{\s*this\._accessToken = token \|\| null;)/,
                '$1\n        this._persistTokens();',
            );
            expect(efemeroPersiste).not.toBe(fonte);
            expect(contratoDaSessao(efemeroPersiste).efemeroNaoPersiste).toBe(false);
            // CONTROLE 2: um segundo escritor da chave é acusado.
            const doisEscritores = fonte.replace(
                /(loadStoredTokens\(\) \{)/,
                "$1\n        localStorage.setItem(TOKEN_STORAGE_KEY, '{}');",
            );
            expect(doisEscritores).not.toBe(fonte);
            expect(contratoDaSessao(doisEscritores).escritorUnico).toBe(false);
            // CONTROLE 3: `setTokens` deixando de persistir é acusado.
            const inicio = fonte.indexOf('setTokens({ accessToken, refreshToken }) {');
            const chamada = fonte.indexOf('this._persistTokens();', inicio);
            expect(inicio).toBeGreaterThan(0);
            expect(chamada).toBeGreaterThan(inicio);
            const semPersistir = fonte.slice(0, chamada) + fonte.slice(chamada + 'this._persistTokens();'.length);
            expect(contratoDaSessao(semPersistir).loginPersiste).toBe(false);
        });

        it('fora do cliente, nenhum arquivo do produto cita a chave da sessão por extenso', () => {
            expect(arquivosDoProdutoQueCitamAChave()).toEqual(['src/js/store/sync/api-client.js']);
        });
    });

    describe('CONTROLE do detector, contra fontes sintéticas', () => {
        const formas = (fonte) => sitiosDeLoginNaPagina(fonte).map((s) => s.forma);

        it('acusa login, setTokens e escrita da chave dentro de função de página', () => {
            expect(formas('await page.evaluate(async ({ u }) => { await api.login(u.username, u.password); });'))
                .toEqual(['login']);
            expect(formas("await page.evaluate(() => { c.setTokens({ accessToken: 't' }); });")).toEqual(['setTokens']);
            expect(formas("await page.addInitScript(() => localStorage.setItem('ebgeo_auth', '{}'));")).toEqual(['setItem']);
            expect(formas("await page.addInitScript(() => { localStorage['ebgeo_auth'] = '{}'; });")).toEqual(['atribuicao']);
            expect(formas('await page.waitForFunction(() => window.cliente.login("a", "b"));')).toEqual(['login']);
            expect(formas('const h = await page.evaluateHandle(async () => { await x.login(1, 2); return x; });'))
                .toEqual(['login']);
            expect(formas("await page.$eval('#a', (el) => el.x.login(1, 2));")).toEqual(['login']);
        });

        it('segue identificador declarado no mesmo arquivo, e função aninhada', () => {
            expect(formas('async function semear() { await c.login(1, 2); }\nawait page.evaluate(semear);'))
                .toEqual(['login']);
            expect(formas('const semear = async () => { await c.login(1, 2); };\nawait page.evaluate(semear, 1);'))
                .toEqual(['login']);
            expect(formas('await page.evaluate(async () => { const f = async () => { await c.login(1, 2); }; await f(); });'))
                .toEqual(['login']);
            // A mesma função em dois `evaluate` é UM sítio.
            expect(formas('const f = async () => { await c.login(1, 2); };\nawait p.evaluate(f);\nawait q.evaluate(f);'))
                .toEqual(['login']);
        });

        it('acusa o código de página passado como texto', () => {
            expect(formas("await page.addInitScript(\"localStorage.setItem('ebgeo_auth', '{}')\");")).toEqual(['setItem']);
            expect(formas("await page.addInitScript({ content: 'window.c.login(1, 2)' });")).toEqual(['login']);
        });

        it('poupa o que não grava sessão na página', () => {
            // Login do lado Node, fora de função de página.
            expect(formas('const api = new ApiClient({});\nawait api.login(u, p);')).toEqual([]);
            // Leitura da chave, e escrita de OUTRA chave.
            expect(formas("await page.evaluate(() => localStorage.getItem('ebgeo_auth'));")).toEqual([]);
            expect(formas("await page.evaluate(() => localStorage.setItem('outra', 'x'));")).toEqual([]);
            // A porta certa.
            expect(formas("await page.evaluate(({ c }) => c.setEphemeralToken('t'), { c });")).toEqual([]);
            // Prosa não é código.
            expect(formas('// await page.evaluate(() => api.login(u, p));\nconst a = 1;')).toEqual([]);
            // Método homônimo que não é de página.
            expect(formas('modelo.avaliar(() => api.login(1, 2));')).toEqual([]);
        });
    });

    describe('o censo', () => {
        const arquivos = inventario();
        const achados = new Map();
        for (const rel of arquivos) {
            const sitios = sitiosDeLoginNaPagina(readFileSync(join(RAIZ_PACOTE, rel), 'utf8'));
            if (sitios.length) achados.set(rel, sitios);
        }

        it('o inventário é o de verdade, e não um vácuo', () => {
            // Piso de vácuo: um inventário vazio deixaria as igualdades abaixo verdes sem ter lido nada.
            expect(arquivos.length).toBeGreaterThan(100);
            expect(arquivos).toContain(HELPER);
            expect(arquivos).toContain('tests/e2e-ui/helpers/collab-helpers.js');
        });

        it('o helper tem exatamente a escrita deliberada de `sessaoDoApp`', () => {
            // Também é o CONTROLE POSITIVO sobre código real: o detector acha o login do helper.
            expect((achados.get(HELPER) ?? []).map((s) => s.forma)).toEqual(['login']);
            expect(achados.get(HELPER)?.length).toBe(SITIOS_DO_HELPER);
        });

        it('nenhum sítio fora do helper e das exceções, e cada exceção contada exatamente', () => {
            const fora = {};
            for (const [rel, sitios] of achados) {
                if (rel === HELPER) continue;
                fora[rel] = sitios.length;
            }
            const declaradas = Object.fromEntries([...EXCECOES].map(([rel, { sitios }]) => [rel, sitios]));
            const detalhe = [...achados].filter(([rel]) => rel !== HELPER && !EXCECOES.has(rel))
                .map(([rel, sitios]) => `${rel}: ${sitios.map((s) => `${s.forma}@${s.linha}`).join(', ')}`)
                .join('\n');
            expect(fora, `sessão gravada por função de página fora das duas portas:\n${detalhe}\n`
                + 'Use `clienteNaPagina` (transporte) ou `sessaoDoApp` (app logado), de '
                + '`tests/e2e-ui/helpers/cliente-de-teste.js`.').toEqual(declaradas);
        });

        it('toda exceção tem motivo escrito', () => {
            expect(EXCECOES.size).toBeGreaterThan(0);
            for (const [rel, { motivo }] of EXCECOES) {
                expect(motivo.length, `${rel} precisa de motivo`).toBeGreaterThan(40);
            }
        });
    });
});
